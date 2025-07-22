package main

import (
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"

	"github.com/gtwndtl/trip-spark-builder/config"
	"github.com/gtwndtl/trip-spark-builder/controller/Accommodation"
	"github.com/gtwndtl/trip-spark-builder/controller/Condition"
	"github.com/gtwndtl/trip-spark-builder/controller/Landmark"
	"github.com/gtwndtl/trip-spark-builder/controller/Restaurant"
	"github.com/gtwndtl/trip-spark-builder/controller/Shortestpath"
	"github.com/gtwndtl/trip-spark-builder/controller/Trips"
	"github.com/gtwndtl/trip-spark-builder/controller/User"
	"github.com/gtwndtl/trip-spark-builder/controller/GenTrip"
		"github.com/gtwndtl/trip-spark-builder/controller/GroqApi"
	"github.com/gtwndtl/trip-spark-builder/middlewares"
)

func main() {
	// Database setup
	config.ConnectionDB()
	db := config.DB()
	config.SetupDatabase()
	config.LoadExcelData(db)

	r := gin.Default()

	// (ถ้าต้องการเปิด CORS ให้เปิด comment ตามที่ตั้งใจไว้)
	r.Use(cors.New(cors.Config{
		AllowOrigins:     []string{"http://localhost:5173"}, // เปลี่ยนให้ตรงกับ origin frontend
		AllowMethods:     []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Authorization"},
		ExposeHeaders:    []string{"Content-Length"},
		AllowCredentials: true,
		MaxAge:           12 * time.Hour,
	}))

	// Controller instances
	accommodationCtrl := Accommodation.NewAccommodationController(db)
	conditionCtrl := Condition.NewConditionController(db)
	landmarkCtrl := Landmark.NewLandmarkController(db)
	restaurantCtrl := Restaurant.NewRestaurantController(db)
	userCtrl := User.NewUserController(db)
	tripsCtrl := Trips.NewTripsController(db)
	shortestpathCtrl := Shortestpath.NewShortestPathController(db)
	routeCtrl := &GenTrip.RouteController{}

	// Public routes (ไม่ต้องตรวจสอบ token)
	r.POST("/signinuser", userCtrl.SignInUser)

	// สร้าง group สำหรับ route ที่ต้องตรวจสอบ token (AuthMiddleware)
	authorized := r.Group("/")
	authorized.Use(middlewares.AuthMiddleware())

	// Accommodation routes (ต้องล็อกอิน)
	authorized.POST("/accommodations", accommodationCtrl.CreateAccommodation)
	r.GET("/accommodations", accommodationCtrl.GetAll)
	authorized.GET("/accommodations/:id", accommodationCtrl.GetByID)
	authorized.PUT("/accommodations/:id", accommodationCtrl.Update)
	authorized.DELETE("/accommodations/:id", accommodationCtrl.Delete)

	// Condition routes
	authorized.POST("/conditions", conditionCtrl.Create)
	authorized.GET("/conditions", conditionCtrl.GetAll)
	authorized.GET("/conditions/:id", conditionCtrl.GetByID)
	authorized.PUT("/conditions/:id", conditionCtrl.Update)
	authorized.DELETE("/conditions/:id", conditionCtrl.Delete)

	// Landmark routes
	authorized.POST("/landmarks", landmarkCtrl.CreateLandmark)
	r.GET("/landmarks", landmarkCtrl.GetAllLandmarks)
	authorized.GET("/landmarks/:id", landmarkCtrl.GetLandmarkByID)
	authorized.PUT("/landmarks/:id", landmarkCtrl.UpdateLandmark)
	authorized.DELETE("/landmarks/:id", landmarkCtrl.DeleteLandmark)

	// Restaurant routes
	authorized.POST("/restaurants", restaurantCtrl.CreateRestaurant)
	r.GET("/restaurants", restaurantCtrl.GetAllRestaurants)
	authorized.GET("/restaurants/:id", restaurantCtrl.GetRestaurantByID)
	authorized.PUT("/restaurants/:id", restaurantCtrl.UpdateRestaurant)
	authorized.DELETE("/restaurants/:id", restaurantCtrl.DeleteRestaurant)

	// User routes (ยกเว้นสร้าง user และ login ที่ public)
	r.GET("/users", userCtrl.GetAllUsers)
	authorized.GET("/users/:id", userCtrl.GetUserByID)
	authorized.PUT("/users/:id", userCtrl.UpdateUser)
	authorized.DELETE("/users/:id", userCtrl.DeleteUser)
	authorized.POST("/users", userCtrl.CreateUser) // ถ้าต้องการให้สร้าง user ต้องล็อกอินก่อน ถ้าไม่ก็เอาไว้ public ก็ได้

	// Trips routes
	r.POST("/trips", tripsCtrl.CreateTrip)
	authorized.GET("/trips", tripsCtrl.GetAllTrips)
	authorized.GET("/trips/:id", tripsCtrl.GetTripByID)
	r.GET("/trips/:id/export", tripsCtrl.ExportTripToTemplate)
	authorized.PUT("/trips/:id", tripsCtrl.UpdateTrip)
	authorized.DELETE("/trips/:id", tripsCtrl.DeleteTrip)

	// Shortest Path routes
	r.POST("/shortest-paths", shortestpathCtrl.CreateShortestPath)
	authorized.GET("/shortest-paths", shortestpathCtrl.GetAllShortestPaths)
	authorized.GET("/shortest-paths/:id", shortestpathCtrl.GetShortestPathByID)
	authorized.PUT("/shortest-paths/:id", shortestpathCtrl.UpdateShortestPath)
	authorized.DELETE("/shortest-paths/:id", shortestpathCtrl.DeleteShortestPath)

    r.GET("/gen-route", routeCtrl.GenerateRoute)
	r.POST("/api/groq", GroqApi.PostGroq)

	// Run server
	r.Run(":8080")
}


