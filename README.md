# iSchool Showcase 9th — ระบบเช็คอินด้วยบัตร RFID

Next.js (ขึ้น Vercel ได้) + Google Sheets เป็นฐานข้อมูล
รองรับเน็ตไม่เสถียร: เครื่องสแกนเก็บรายชื่อและคิวการเช็คอินไว้ในเบราว์เซอร์ แล้วส่งขึ้นชีตเองเมื่อเน็ตกลับมา

---

## 1. เตรียม Google Sheet

สร้างชีตแท็บชื่อ **`Attendees`** แถวแรกเป็นหัวคอลัมน์ (ลำดับสลับได้ แต่ชื่อต้องตรง):

| RFID | ID | Title | Name | Surname | Nickname | Team | Status | CheckinTime |
|---|---|---|---|---|---|---|---|---|

- `CheckinTime` ไม่บังคับ ถ้ามีระบบจะเขียนเวลาเช็คอินให้
- ตอนเช็คอิน ระบบจะเขียนคำว่า `เช็คอินแล้ว` ลงช่อง Status
- เลขบัตรจะมีหรือไม่มีเลข 0 นำหน้าก็ได้ (`0018238379` = `18238379`)
- พิมพ์รหัสนักศึกษาแทนการแตะบัตรก็ได้ (กรณีลืมบัตร) ขีด `-` ไม่มีผล

## 2. สร้าง Service Account (ทำครั้งเดียว)

1. เข้า https://console.cloud.google.com → สร้าง Project ใหม่
2. **APIs & Services → Library** → ค้นหา **Google Sheets API** → Enable
3. **APIs & Services → Credentials → Create credentials → Service account** ตั้งชื่อ เช่น `checkin-bot` → Done
4. คลิก service account ที่สร้าง → แท็บ **Keys → Add key → Create new key → JSON** จะได้ไฟล์ .json
5. เปิด Google Sheet → **แชร์** ให้อีเมลของ service account (`...@...iam.gserviceaccount.com`) สิทธิ์ **ผู้แก้ไข (Editor)**

จากไฟล์ JSON ใช้ 2 ค่า: `client_email` และ `private_key`
`GOOGLE_SHEET_ID` คือส่วนในลิงก์ชีต `docs.google.com/spreadsheets/d/`**`ตรงนี้`**`/edit`

## 3. Deploy ขึ้น Vercel

1. push โฟลเดอร์นี้ขึ้น GitHub
2. Vercel → **Add New → Project** → เลือก repo
3. ใส่ **Environment Variables** (ดูตัวอย่างใน `.env.example`):

| ชื่อ | ค่า |
|---|---|
| `GOOGLE_SHEET_ID` | ไอดีชีต |
| `SHEET_TAB` | `Attendees` |
| `GOOGLE_CLIENT_EMAIL` | `client_email` จาก JSON |
| `GOOGLE_PRIVATE_KEY` | `private_key` จาก JSON (วางทั้งก้อน รวม `-----BEGIN...` และ `\n`) |
| `STATION_PIN` | PIN สำหรับเครื่องสแกน เช่น `2468` |

4. Deploy → เปิดลิงก์ → ใส่ PIN ครั้งเดียว เครื่องจะจำไว้

> อย่าตั้ง `DATA_MODE=local` บน Vercel — Vercel เขียนไฟล์ไม่ได้

## 4. ใช้งานหน้างาน

- เสียบเครื่องอ่าน RFID แบบ USB เปิดหน้าเว็บ แล้วแตะบัตรได้เลย ไม่ต้องคลิกช่องไหน
- ตั้งแป้นพิมพ์เป็นภาษาไทยอยู่ก็ใช้ได้ ระบบอ่านจากตำแหน่งปุ่มโดยตรง
- เมนู `⋯` มุมขวาล่าง: ซิงก์ตอนนี้ · เต็มจอ (หรือกด F11) · เปลี่ยน PIN · ดาวน์โหลดสำรอง CSV
- ปุ่ม `Esc` ล้างหน้าจอผลลัพธ์

**สีไฟสถานะ:** เขียว = ส่งข้อมูลขึ้นชีตครบ · เหลือง = มีคิวรอส่ง · แดง = ออฟไลน์ (ยังสแกนได้ตามปกติ)

**ข้อควรทำก่อนวันงาน:** เปิดหน้าเว็บบนทุกเครื่องสแกนตอนมีเน็ต 1 ครั้ง เพื่อให้เครื่องโหลดรายชื่อเก็บไว้ ถ้าเน็ตหลุดวันงาน เครื่องจะยังตรวจรายชื่อได้

**ข้อจำกัดตอนออฟไลน์:** แต่ละเครื่องรู้แค่การเช็คอินของตัวเอง ถ้ามีหลายจุดสแกนและคนคนเดียวแตะสองจุดตอนเน็ตหลุด ทั้งสองจุดจะขึ้นสำเร็จ แต่ชีตจะบันทึกแค่ครั้งแรก (ไม่มีข้อมูลซ้ำ)

## 5. รันแบบ Local (บนโน้ตบุ๊ก)

ต้องมี Node.js 20 ขึ้นไป

```bash
npm install
cp .env.example .env.local   # แล้วแก้ค่าในไฟล์
npm run build
npm start                    # เปิด http://localhost:3000
```

### แบบ A — Local + Google Sheet (แนะนำเมื่อมีเน็ตบ้าง)
ตั้ง `DATA_MODE=sheets` ใน `.env.local` ทำงานเหมือนบน Vercel แต่ไม่ต้องพึ่ง Vercel

### แบบ B — Local เต็มรูปแบบ ไม่ใช้เน็ตเลย
1. ใน Google Sheet: **ไฟล์ → ดาวน์โหลด → .csv** → บันทึกทับ `data/attendees.csv`
2. ตั้ง `DATA_MODE=local` ใน `.env.local` → `npm run build && npm start`
3. การเช็คอินจะบันทึกลง `data/checkins.csv`
4. หลังงาน (มีเน็ตแล้ว) ตั้งค่า Google ใน `.env.local` แล้วรัน `npm run sync` ระบบจะเขียนสถานะและเวลาเช็คอินลงชีต

### หลายจุดสแกนใช้โน้ตบุ๊กเครื่องเดียวเป็นเซิร์ฟเวอร์
```bash
npm run start:lan
```
เครื่องอื่นในวง Wi-Fi เดียวกันเปิด `http://<IP ของโน้ตบุ๊ก>:3000` (ดู IP ด้วย `ipconfig` บน Windows)

## 6. ข้อมูลทีม

ใส่ข้อความเพิ่มใต้ชื่อทีม (เช่น โซน/บูธ) ได้ที่ `lib/teams.mjs`

## หมายเหตุเครื่องอ่านบัตร

เครื่องต้องส่ง Enter หลังเลขบัตร (ค่าเริ่มต้นของรุ่นส่วนใหญ่) ทดสอบได้โดยแตะบัตรใน Notepad แล้วดูว่าขึ้นบรรทัดใหม่หรือไม่
