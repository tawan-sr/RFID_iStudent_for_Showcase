// ตรรกะกลางที่ใช้ร่วมกันทั้งโหมด Google Sheets และโหมด Local (ไฟล์ CSV)

export const STATUS_CHECKED = process.env.STATUS_CHECKED || 'เช็คอินแล้ว';

// ทำให้รหัสบัตร/รหัสนักศึกษาเทียบกันได้เสมอ:
// ตัดช่องว่าง ขีด จุลภาค และเลข 0 นำหน้า เช่น "0018238379" = "18238379" = "18,238,379"
export function norm(v) {
  return String(v ?? '')
    .trim()
    .toUpperCase()
    .replace(/[\s,\-]/g, '')
    .replace(/^0+(?=.)/, '');
}

// ชื่อหัวคอลัมน์ในแถวแรกของชีต (ไม่สนตัวพิมพ์เล็ก/ใหญ่ และลำดับคอลัมน์)
const FIELDS = {
  rfid: 'RFID',
  id: 'ID',
  title: 'Title',
  name: 'Name',
  surname: 'Surname',
  nickname: 'Nickname',
  team: 'Team',
  status: 'Status',
  time: 'CheckinTime', // ไม่บังคับ ถ้ามีคอลัมน์นี้ระบบจะบันทึกเวลาให้
};

export function mapHeaders(header) {
  const h = header.map((x) => String(x ?? '').trim().toLowerCase());
  const idx = {};
  for (const [k, label] of Object.entries(FIELDS)) idx[k] = h.indexOf(label.toLowerCase());
  return idx;
}

export function toAttendees(values) {
  const [header = [], ...rows] = values;
  const idx = mapHeaders(header);
  if (idx.rfid < 0) throw new Error('ไม่พบคอลัมน์ "RFID" ในแถวแรกของชีต');
  const g = (r, k) => (idx[k] >= 0 ? String(r[idx[k]] ?? '').trim() : '');
  const attendees = rows
    .map((r, i) => ({
      row: i + 2,
      rfid: g(r, 'rfid'),
      id: g(r, 'id'),
      title: g(r, 'title'),
      name: g(r, 'name'),
      surname: g(r, 'surname'),
      nickname: g(r, 'nickname'),
      team: g(r, 'team'),
      status: g(r, 'status'),
      time: g(r, 'time'),
    }))
    .filter((a) => a.rfid || a.id)
    .map((a) => ({ ...a, checkedIn: a.status === STATUS_CHECKED }));
  return { idx, attendees };
}

export function findAttendee(list, key) {
  const k = norm(key);
  if (!k) return null;
  return list.find((a) => norm(a.rfid) === k) || list.find((a) => norm(a.id) === k) || null;
}

// เวลาไทย รูปแบบ 2026-11-06 18:35:00
export function bkkTime(ms) {
  return new Date(ms).toLocaleString('sv-SE', { timeZone: 'Asia/Bangkok' });
}

export function colLetter(i) {
  let s = '';
  let n = i + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// items: [{ key, at?, time? }] → คืนผลแต่ละรายการ + รายชื่อที่ต้องบันทึกจริง
export function applyCheckIns(attendees, items) {
  const results = [];
  const changed = [];
  for (const it of items) {
    const a = findAttendee(attendees, it.key);
    if (!a) {
      results.push({ key: it.key, result: 'not_found' });
      continue;
    }
    if (a.checkedIn) {
      results.push({ key: it.key, result: 'already', time: a.time });
      continue;
    }
    a.checkedIn = true;
    a.status = STATUS_CHECKED;
    a.time = it.time || bkkTime(Number(it.at) || Date.now());
    changed.push(a);
    results.push({ key: it.key, result: 'ok', time: a.time });
  }
  return { results, changed };
}
