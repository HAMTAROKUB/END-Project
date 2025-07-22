package Trips

import (
	"net/http"
	"encoding/json"
	"io"
	"bytes"
	"strings"
	"fmt"

	"github.com/gin-gonic/gin"
	"github.com/gtwndtl/trip-spark-builder/entity"
	"gorm.io/gorm"
)

type TripsController struct {
	DB *gorm.DB
}

func NewTripsController(db *gorm.DB) *TripsController {
	return &TripsController{DB: db}
}

// POST /trips
func (ctrl *TripsController) CreateTrip(c *gin.Context) {
	var trip entity.Trips
	if err := c.ShouldBindJSON(&trip); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := ctrl.DB.Create(&trip).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ไม่สามารถบันทึกข้อมูลได้"})
		return
	}
	c.JSON(http.StatusOK, trip)
}

// GET /trips
func (ctrl *TripsController) GetAllTrips(c *gin.Context) {
	var trips []entity.Trips
	if err := ctrl.DB.
		Preload("Con").
		Preload("Acc").
		Preload("ShortestPaths", func(db *gorm.DB) *gorm.DB {
			return db.Order("day, path_index")
		}).
		Find(&trips).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ไม่สามารถดึงข้อมูลได้"})
		return
	}
	c.JSON(http.StatusOK, trips)
}

// GET /trips/:id
func (ctrl *TripsController) GetTripByID(c *gin.Context) {
	id := c.Param("id")
	var trip entity.Trips
	if err := ctrl.DB.
		Preload("Con").
		Preload("Acc").
		Preload("ShortestPaths", func(db *gorm.DB) *gorm.DB {
			return db.Order("day, path_index")
		}).
		First(&trip, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "ไม่พบข้อมูลทริป"})
		return
	}
	c.JSON(http.StatusOK, trip)
}

// PUT /trips/:id
func (ctrl *TripsController) UpdateTrip(c *gin.Context) {
	id := c.Param("id")

	var trip entity.Trips
	if err := ctrl.DB.First(&trip, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "ไม่พบข้อมูลทริป"})
		return
	}

	var input entity.Trips
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	trip.Name = input.Name
	trip.Types = input.Types
	trip.Days = input.Days
	trip.Con_id = input.Con_id
	trip.Acc_id = input.Acc_id

	if err := ctrl.DB.Save(&trip).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ไม่สามารถอัพเดตข้อมูลได้"})
		return
	}

	c.JSON(http.StatusOK, trip)
}

// DELETE /trips/:id
func (ctrl *TripsController) DeleteTrip(c *gin.Context) {
	id := c.Param("id")

	if err := ctrl.DB.Where("trip_id = ?", id).Delete(&entity.Shortestpath{}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ไม่สามารถลบเส้นทางได้"})
		return
	}

	if err := ctrl.DB.Delete(&entity.Trips{}, id).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ไม่สามารถลบทริปได้"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "ลบข้อมูลสำเร็จ"})
}

// GET /trips/:id/export
func (ctrl *TripsController) ExportTripToTemplate(c *gin.Context) {
	id := c.Param("id")

	var trip entity.Trips
	if err := ctrl.DB.
		Preload("Con").
		Preload("Acc").
		Preload("ShortestPaths", func(db *gorm.DB) *gorm.DB {
			return db.Order("day, path_index")
		}).
		First(&trip, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "ไม่พบข้อมูลทริป"})
		return
	}

	// Sanitize Condition & Accommodation
	var condition string
	if trip.Con != nil {
		condition = sanitizeString(trip.Con.Style)
	}
	var accommodation string
	if trip.Acc != nil {
		accommodation = sanitizeString(trip.Acc.Name)
	}

	// เตรียม payload ที่จะส่งให้ apitemplate.io
	payload := map[string]interface{}{
		"merge_fields": map[string]interface{}{
			"trip_name":     sanitizeString(trip.Name),
			"trip_type":     sanitizeString(trip.Types),
			"condition":     condition,
			"accommodation": accommodation,
			"paths":         formatPaths(trip.ShortestPaths),
		},
	}

	// แปลงเป็น JSON
	body, err := json.Marshal(payload)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ไม่สามารถแปลง payload เป็น JSON ได้"})
		return
	}

	// สร้าง POST Request
	req, err := http.NewRequest("POST", "https://api.apitemplate.io/v1/create?template_id=09a77b23698af788", bytes.NewBuffer(body))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ไม่สามารถสร้างคำขอได้"})
		return
	}
	req.Header.Set("X-API-KEY", "c3c0MzQxMDk6MzEyOTQ6cW5hbHhhRmpldUs4UnR3MQ=")
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ไม่สามารถเรียก API Template ได้"})
		return
	}
	defer resp.Body.Close()

	// ตรวจสอบ response
	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":  "API Template ตอบกลับผิดพลาด",
			"status": resp.StatusCode,
			"body":   string(respBody),
		})
		return
	}

	var result map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ไม่สามารถอ่านผลลัพธ์จาก API"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
	"status":       "success",
	"download_url": result["download_url"],
})

	c.JSON(http.StatusOK, result)
}


func formatPaths(paths []entity.Shortestpath) []map[string]interface{} {
	formatted := []map[string]interface{}{}
	for _, path := range paths {
		formatted = append(formatted, map[string]interface{}{
			"day":         path.Day,
			"path_index":  path.PathIndex,
			"from":        sanitizeString(path.FromCode),
			"distance":    sanitizeString(fmt.Sprintf("%v", path.Distance)),
			"description": sanitizeString(path.ActivityDescription),
			"start_time":  sanitizeString(path.StartTime),
			"end_time":    sanitizeString(path.EndTime),
		})
	}
	return formatted
}


func sanitizeString(str string) string {
	return strings.NewReplacer(
		"#", "",
		"{", "",
		"}", "",
		"<", "",
		">", "",
		"&", "",
		"*", "",
		"\"", "",
		"'", "",     // ลบ single quote เพิ่ม
		"\n", " ",   // ลบ newline
		"\r", "",
	).Replace(str)
}
