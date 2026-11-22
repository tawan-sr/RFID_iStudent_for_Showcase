import { sheetGetAttendees, sheetCheckIn } from './sheets.mjs';
import { localGetAttendees, localCheckIn } from './local.mjs';

export const MODE = process.env.DATA_MODE === 'local' ? 'local' : 'sheets';

export async function getAttendees() {
  return MODE === 'local' ? localGetAttendees() : sheetGetAttendees();
}

export async function checkIn(items) {
  return MODE === 'local' ? localCheckIn(items) : sheetCheckIn(items);
}

// ถ้าตั้ง STATION_PIN ไว้ ทุกเครื่องสแกนต้องใส่ PIN ก่อนใช้งาน (กันคนนอกเปิดลิงก์แล้วเห็นรายชื่อ)
export function guard(req) {
  const pin = process.env.STATION_PIN;
  if (!pin || req.headers.get('x-station-pin') === pin) return null;
  return Response.json({ error: 'PIN ไม่ถูกต้อง' }, { status: 401 });
}
