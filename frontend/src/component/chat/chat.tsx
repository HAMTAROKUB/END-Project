import './chat.css';
import { Input, Button } from 'antd';
import { useState, useRef, useEffect } from 'react';
import doraemon from '../../assets/doraemon.jpg';
import type { LandmarkInterface } from '../../interfaces/Landmark';
import type { TripInterface } from '../../interfaces/Trips';
import type { ShortestpathInterface } from '../../interfaces/Shortestpath';
import {
  GetAllLandmarks,
  GetRouteFromAPI,
  PostGroq,
  CreateTrip,
  CreateShortestPath,
  ExportTripToTemplate
} from '../../services/https';



// ฟังก์ชัน parse ข้อความแผนทริป LLM เป็น array กิจกรรม {day, startTime, endTime, description}
function parseTripPlanTextToActivities(text: string) {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '');
  const activities = [];
  let currentDay = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // รองรับ วันที่ 1**, ### วันที่ 1, วันที่ 1 **
    const dayMatch = line.match(/(?:#+\s*)?วันที่\s*(\d+)\**/i);
    if (dayMatch) {
      currentDay = parseInt(dayMatch[1], 10);
      continue;
    }

    if (currentDay === 0) continue;

    // ✅ เคส: "08:00 - 09:00 เช็คอินที่ ..."
    const timeDescInlineMatch = line.match(/^(\d{2}:\d{2})\s*[–\-]\s*(\d{2}:\d{2})\s+(.+)/);
    if (timeDescInlineMatch) {
      const [, startTime, endTime, description] = timeDescInlineMatch;
      activities.push({ day: currentDay, startTime, endTime, description });
      continue;
    }

    // ✅ เคส: "08:00 - 09:00" + บรรทัดต่อไปเป็นคำอธิบาย
    const timeOnlyMatch = line.match(/^(\d{2}:\d{2})\s*[–\-]\s*(\d{2}:\d{2})$/);
    if (timeOnlyMatch && i + 1 < lines.length) {
      const startTime = timeOnlyMatch[1];
      const endTime = timeOnlyMatch[2];
      const description = lines[i + 1];
      activities.push({ day: currentDay, startTime, endTime, description });
      i++;
      continue;
    }

    // ✅ เคสพิเศษ: "20:00 เป็นต้นไป พักผ่อนที่ ..." → แปลงเป็น 20:00–21:00
    const singleLineSpecial = line.match(/^(\d{2}:\d{2})\s+(.+)/);
    if (singleLineSpecial) {
      const [_, startTime, description] = singleLineSpecial;
      const [h, m] = startTime.split(':').map(Number);
      const endH = Math.min(h + 1, 23);
      const endTime = `${endH.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
      activities.push({ day: currentDay, startTime, endTime, description });
      continue;
    }
  }

  console.log('✅ parsed activities:', activities);
  return activities;
}

// ฟังก์ชันช่วยจัดรูปแบบข้อความแผนทริปให้อ่านง่าย
const formatTripPlanText = (text: string) => {
  const lines = text.split('\n');

  return lines.map((line, i) => {
    const trimmed = line.trim();

    if (trimmed === '') return <br key={'br' + i} />;

    if (/^\*\*\s*วันที่/.test(trimmed)) {
      return (
        <h4 key={'day' + i} style={{ marginTop: 20, marginBottom: 10, color: '#333' }}>
          {trimmed.replace(/^\*\*\s*/, '')}
        </h4>
      );
    }

    if (/^\d{2}:\d{2}[–-]\d{2}:\d{2}/.test(trimmed)) {
      const times = trimmed.match(/^(\d{2}:\d{2})[–-](\d{2}:\d{2})/);
      if (!times) return trimmed;

      const start = times[1];
      const end = times[2];

      return (
        <div key={'time' + i} style={{ marginTop: 6, marginBottom: 4 }}>
          <b>
            {start} - {end}
          </b>
          <br />
          <span>{trimmed.replace(/^\d{2}:\d{2}[–-]\d{2}:\d{2}\s*/, '')}</span>
        </div>
      );
    }

    return <p key={'p' + i}>{trimmed}</p>;
  });
};

const Chat = () => {
  const [chatInput, setChatInput] = useState('');
  const [messages, setMessages] = useState<
    { text: string; sender: 'user' | 'bot'; data?: any; isTripPlan?: boolean }[]
  >([
    {
      text:
        'สวัสดีค่ะ! ฉันช่วยวางแผนทริปให้คุณได้เลย ลองบอกมาว่าคุณอยากไปที่ไหน? เช่น "ฉันอยากไปวัดพระแก้ว 3 วัน"',
      sender: 'bot',
    },
  ]);
  const [landmarks, setLandmarks] = useState<LandmarkInterface[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchLandmarks = async () => {
      try {
        const data = await GetAllLandmarks();
        setLandmarks(data);
      } catch (error) {
        console.error('โหลดข้อมูล landmark ล้มเหลว', error);
      }
    };
    fetchLandmarks();
  }, []);

  const extractKeywordAndDays = (text: string) => {
    const match = text.match(/อยากไป(.*?)(\d+)\s*วัน/);
    if (match) {
      return { keyword: match[1].trim(), days: parseInt(match[2], 10) };
    }
    const match2 = text.match(/อยากไป\s*(.+)/);
    if (match2) {
      return { keyword: match2[1].trim(), days: null };
    }
    return null;
  };

  const generateRouteAndPlan = async (id: number, keyword: string, days: number) => {
    try {
      setLoading(true);
      setMessages((prev) => [...prev, { text: `กำลังสร้างแผนทริปสำหรับ "${keyword}"...`, sender: 'bot' }]);

      const routeData = await GetRouteFromAPI(id, days);
      console.log('GetRouteFromAPI ได้ข้อมูล:', routeData);

      const prompt = `
คุณคือผู้ช่วยวางแผนทริปท่องเที่ยวมืออาชีพ โปรดจัดแผนการเดินทางในกรุงเทพฯ เป็นเวลา ${days} วัน โดยเริ่มจาก "${routeData.start_name}"

ด้านล่างคือข้อมูลเส้นทางระหว่างสถานที่ (paths) และแผนรายวัน (trip_plan):
${JSON.stringify(routeData.paths, null, 2)}

${JSON.stringify(routeData.trip_plan, null, 2)}

กรุณาจัดแผนทริปให้ครบทั้ง ${days} วัน โดยมีรายละเอียดดังนี้:

- แบ่งแผนตามวัน เช่น “วันที่ 1”, “วันที่ 2” พร้อมระบุช่วงเวลา (เช่น 09:00–10:30) ให้เหมาะสมกับจำนวนกิจกรรมในแต่ละวัน
- ใช้ช่วงเวลาแต่ละกิจกรรมประมาณ 1.5–3 ชั่วโมง และจัดตามลำดับใน paths และ trip_plan
- เริ่มกิจกรรมแต่ละวันเวลาประมาณ 08:00
- ห้ามใช้คำว่า “เป็นต้นไป” ให้ระบุช่วงเวลาอย่างชัดเจนเท่านั้น เช่น 18:00–20.00
- วันแรกให้เริ่มต้นด้วยกิจกรรม “เช็คอินที่ <ชื่อที่พัก>” เวลา 08:00–09:00
- สิ้นสุดทุกวันด้วย “พักผ่อนที่ <ชื่อที่พัก>” ช่วงเย็น
- วันสุดท้ายให้ปิดท้ายด้วย “เช็คเอาท์และเดินทางกลับ” หลังจบกิจกรรมสุดท้าย และต้องมีเวลา เริ่มต้น - จบ เสมอ เช่น 19:00-20:00
- ห้ามใช้รหัสสถานที่ (เช่น P123, R99, A1) ในคำอธิบาย
- เขียนคำอธิบายกิจกรรมตามประเภท:
  - P = สถานที่ท่องเที่ยว เช่น "เที่ยวชม...", "เดินเล่นที่...", "ถ่ายรูปที่..."
  - R = ร้านอาหาร เช่น "รับประทานอาหารกลางวันที่...", "แวะชิมของว่างที่..."
  - A = ที่พัก เช่น "เช็คอินที่...", "พักผ่อนที่...", "เช็คเอาท์และเดินทางกลับ"
- หากมีสถานที่ซ้ำในหลายวัน ให้ปรับคำอธิบายกิจกรรมให้หลากหลาย ไม่ซ้ำซาก
- ใช้ภาษาสุภาพ กระชับ อ่านง่าย และจัดรูปแบบให้อ่านสบาย มีการเว้นบรรทัดอย่างเหมาะสม
`;

      const groqRes = await PostGroq(prompt);
      const tripPlanText = groqRes?.choices?.[0]?.message?.content?.trim();

      if (!tripPlanText) {
        throw new Error('Groq ไม่ได้ตอบกลับข้อความที่ต้องการ');
      }

      setMessages((prev) => [...prev, { text: tripPlanText, sender: 'bot', isTripPlan: true }]);

      // สร้างข้อมูล Trip
      const newTrip: TripInterface = {
        Name: keyword,
        Types: 'custom',
        Days: days,
        Con_id: 1,
        Acc_id: routeData.accommodation ?? null,
      };
      console.log('Payload to create trip:', newTrip);

      // บันทึก Trip
      const savedTrip = await CreateTrip(newTrip);
      console.log('บันทึก Trip สำเร็จ:', savedTrip);
      setMessages((prev) => [...prev, { text: `บันทึกทริปสำเร็จ! (ID: ${savedTrip.ID})`, sender: 'bot' }]);
      localStorage.setItem('TripID', savedTrip.ID!.toString());

      // แปลงข้อความแผนทริปเป็นกิจกรรม
      const activities = parseTripPlanTextToActivities(tripPlanText);
      console.log('parsed activities:', activities);

      let PathIndex = 1;

      // เก็บดัชนีการเดินในแต่ละวัน เพื่อ map FromCode/ToCode
      const dayPlanIndices: { [day: number]: number } = {};

      for (const act of activities) {
        // หาแผนของวันนั้น
        const dayPlan = routeData.trip_plan.find((d: { day: number; }) => d.day === act.day);
        if (!dayPlan) {
          console.warn(`ไม่พบแผนสำหรับวัน ${act.day}`);
          continue;
        }

        const accommodationCode = dayPlan.accommodation || 'A1'; // รหัสที่พักของวัน

        // ดัชนีกิจกรรมในวันนี้ (เริ่ม 0)
        const currentIndex = dayPlanIndices[act.day] ?? 0;

        let fromCode = '';
        let toCode = '';

        // เช็คกิจกรรมประเภทเช็คอิน, พักผ่อน, เช็คเอาท์
        if (/เช็คอิน|พักผ่อน|เช็คเอาท์/.test(act.description)) {
          fromCode = accommodationCode;
          toCode = accommodationCode;
        } else {
          // กิจกรรมอื่น ๆ ใน trip_plan.plan
          if (currentIndex === 0) {
            // กิจกรรมแรกของวัน จากที่พักไปสถานที่แรก
            fromCode = accommodationCode;
            toCode = dayPlan.plan[0];
          } else {
            fromCode = dayPlan.plan[currentIndex - 1];
            toCode = dayPlan.plan[currentIndex];
          }
        }

        const shortestPathData: ShortestpathInterface = {
          TripID: savedTrip.ID,
          Day: act.day,
          PathIndex: PathIndex++,
          FromCode: fromCode,
          ToCode: toCode,
          Type: 'Activity',
          Distance: 0,
          ActivityDescription: act.description,
          StartTime: act.startTime,
          EndTime: act.endTime,
        };

        try {
          const spRes = await CreateShortestPath(shortestPathData);
          console.log('CreateShortestPath success:', spRes);
        } catch (err) {
          console.error('CreateShortestPath failed:', err, 'with data:', shortestPathData);
        }

        if (!/เช็คอิน|พักผ่อน|เช็คเอาท์/.test(act.description)) {
          // เพิ่มดัชนีเฉพาะกิจกรรมใน trip_plan.plan
          dayPlanIndices[act.day] = currentIndex + 1;
        }
      }

            // ✅ เรียก ExportTripToTemplate หลังจากบันทึก Path ทั้งหมดแล้ว
try {
  const exportResult = await ExportTripToTemplate(savedTrip.ID!);
  console.log('📄 สร้างเอกสารจาก template สำเร็จ:', exportResult);

  // ส่งลิงก์ให้ผู้ใช้เปิดดู
  console.log('📄 exportResult ได้ค่า:', exportResult);
  if (exportResult) {
  setMessages((prev) => [
    ...prev,
    {
      text: `คลิกที่นี่เพื่อดูแผนทริปของคุณ: [ดูแผนทริป](${exportResult})`,
      sender: 'bot',
    },
  ]);
}
} catch (err) {
  console.error('❌ ExportTripToTemplate ล้มเหลว:', err);
  setMessages((prev) => [
    ...prev,
    {
      text: 'ไม่สามารถสร้างแผนทริปในรูปแบบเอกสารได้ในขณะนี้ กรุณาลองใหม่ภายหลัง',
      sender: 'bot',
    },
  ]);
}

    } catch (error) {
      console.error('Error generating route or calling Groq', error);
      setMessages((prev) => [
        ...prev,
        { text: 'ขออภัย เกิดข้อผิดพลาดระหว่างการสร้างแผนทริป กรุณาลองใหม่ภายหลัง', sender: 'bot' },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleUserMessage = async (userMessage: string) => {
    if (!userMessage.trim()) return;
    setMessages((prev) => [...prev, { text: userMessage, sender: 'user' }]);
    console.log('handleUserMessage รับข้อความ:', userMessage);

    const lastConfirm = [...messages]
      .reverse()
      .find((m) => m.sender === 'bot' && m.data && m.data.id && !m.data.days);

    if (lastConfirm) {
      const days = parseInt(userMessage.replace(/[^\d]/g, ''), 10);
      if (!isNaN(days) && days > 0) {
        console.log('วิเคราะห์ข้อความ (confirm):', { keyword: lastConfirm.data.keyword, days });
        generateRouteAndPlan(lastConfirm.data.id, lastConfirm.data.keyword, days);
        return;
      } else {
        setMessages((prev) => [
          ...prev,
          {
            text: 'กรุณาพิมพ์จำนวนวันเป็นตัวเลข เช่น 3',
            sender: 'bot',
          },
        ]);
        return;
      }
    }

    const analysis = extractKeywordAndDays(userMessage);
    console.log('วิเคราะห์ข้อความ:', analysis);
    if (analysis?.keyword) {
      const keyword = analysis.keyword.toLowerCase();
      const matched = landmarks.find((l) => l.Name?.toLowerCase().includes(keyword));

      if (matched && matched.ID != null) {
        if (analysis.days) {
          generateRouteAndPlan(matched.ID, analysis.keyword, analysis.days);
        } else {
          setMessages(() => [
            {
              text: `คุณต้องการไป "${analysis.keyword}" กี่วันคะ? กรุณาพิมพ์จำนวนวันเป็นตัวเลข`,
              sender: 'bot',
              data: { keyword: analysis.keyword, id: matched.ID, days: null },
            },
          ]);
        }
      } else {
        setMessages((prev) => [...prev, { text: `ไม่พบสถานที่ "${analysis.keyword}"`, sender: 'bot' }]);
      }
      return;
    }

    setMessages((prev) => [
      ...prev,
      {
        text: 'ขอบคุณสำหรับข้อความค่ะ หากต้องการวางแผนทริป พิมพ์ว่า "ฉันอยากไป..." พร้อมจำนวนวัน',
        sender: 'bot',
      },
    ]);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (chatInput.trim()) {
        handleUserMessage(chatInput.trim());
        setChatInput('');
      }
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="chat-container">
      <div className="chat-header">
        <h3>Let me help you to plan your trip</h3>
        <p>Just describe your stay preferences and I’ll bring you the most personalised results.</p>
      </div>

      <div className="chat-messages">
        {messages.map((msg, index) =>
          msg.sender === 'bot' ? (
            <div key={index} className="bot-message-wrapper">
              <img src={doraemon} alt="Bot Avatar" className="bot-avatar" />
              <div className="chat-message bot-message" style={{ whiteSpace: 'normal', lineHeight: 1.5 }}>
                {msg.isTripPlan ? formatTripPlanText(msg.text) : msg.text}
              </div>
            </div>
          ) : (
            <div key={index} className="chat-message user-message">
              {msg.text}
            </div>
          )
        )}
        {loading && (
          <div className="bot-message-wrapper">
            <img src={doraemon} alt="Bot Avatar" className="bot-avatar" />
            <div className="chat-message bot-message">กำลังพิมพ์...</div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input">
        <Input
          placeholder="Ask anything..."
          value={chatInput}
          onChange={(e) => setChatInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={loading}
          style={{ flexGrow: 1 }}
          bordered={false}
        />
        <Button
          type="text"
          onClick={() => {
            if (chatInput.trim()) {
              handleUserMessage(chatInput.trim());
              setChatInput('');
            }
          }}
          disabled={loading}
        >
          Send
        </Button>
      </div>
    </div>
  );
};

export default Chat;