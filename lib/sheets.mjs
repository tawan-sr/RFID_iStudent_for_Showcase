// โหมด Google Sheets — เชื่อมผ่าน Service Account
import { google } from 'googleapis';
import { toAttendees, applyCheckIns, colLetter } from './core.mjs';

const tab = () => process.env.SHEET_TAB || 'Attendees';

// รับ private key ได้หลายแบบ: วางมีหรือไม่มีเครื่องหมายคำพูด, มี \n แบบตัวอักษร,
// ขึ้นบรรทัดจริง, วางทั้งไฟล์ JSON หรือเข้ารหัส base64 มา
export function readCredentials(env = process.env) {
  let email = (env.GOOGLE_CLIENT_EMAIL || '').trim().replace(/^["']|["']$/g, '');
  let raw = (env.GOOGLE_SERVICE_ACCOUNT_JSON || env.GOOGLE_PRIVATE_KEY || '').trim();

  const unquote = (s) => {
    s = s.trim();
    while (s.length > 1 && ((s[0] === '"' && s.at(-1) === '"') || (s[0] === "'" && s.at(-1) === "'"))) {
      s = s.slice(1, -1).trim();
    }
    return s;
  };
  raw = unquote(raw);

  if (raw && !raw.includes('BEGIN') && !raw.startsWith('{')) {
    try {
      const decoded = Buffer.from(raw, 'base64').toString('utf8');
      if (decoded.includes('BEGIN') || decoded.trim().startsWith('{')) raw = decoded.trim();
    } catch {}
  }
  if (raw.startsWith('{')) {
    try {
      const j = JSON.parse(raw);
      raw = j.private_key || '';
      email = email || j.client_email || '';
    } catch {
      throw new Error('GOOGLE_PRIVATE_KEY เป็น JSON ที่ไม่สมบูรณ์ — วางไฟล์ JSON ทั้งไฟล์ หรือวางเฉพาะค่า private_key');
    }
  }

  let key = unquote(raw).replace(/\\r/g, '').replace(/\\n/g, '\n').replace(/\r/g, '');
  const m = key.match(/-----BEGIN PRIVATE KEY-----([\s\S]*?)-----END PRIVATE KEY-----/);
  if (m) {
    const body = m[1].replace(/[^A-Za-z0-9+/=]/g, '');
    key = `-----BEGIN PRIVATE KEY-----\n${body.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n`;
  } else if (key) {
    throw new Error('GOOGLE_PRIVATE_KEY ไม่ครบ — ต้องมีทั้ง -----BEGIN PRIVATE KEY----- และ -----END PRIVATE KEY-----');
  }
  return { email, key };
}

function client() {
  const { email, key } = readCredentials();
  const spreadsheetId = (process.env.GOOGLE_SHEET_ID || '').trim();
  if (!email || !key || !spreadsheetId) {
    throw new Error('ยังไม่ได้ตั้งค่า GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY / GOOGLE_SHEET_ID');
  }
  const auth = new google.auth.JWT({
    email,
    key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return { api: google.sheets({ version: 'v4', auth }), spreadsheetId };
}

async function read(api, spreadsheetId) {
  const res = await api.spreadsheets.values.get({ spreadsheetId, range: `'${tab()}'` });
  return toAttendees(res.data.values || []);
}

export async function sheetGetAttendees() {
  const { api, spreadsheetId } = client();
  return read(api, spreadsheetId);
}

// อ่าน 1 ครั้ง + เขียน 1 ครั้งต่อชุด ไม่ว่าจะส่งมากี่รายการ (ประหยัดโควตา API)
export async function sheetCheckIn(items) {
  const { api, spreadsheetId } = client();
  const { idx, attendees } = await read(api, spreadsheetId);
  if (idx.status < 0) throw new Error('ไม่พบคอลัมน์ "Status" ในแถวแรกของชีต');
  const { results, changed } = applyCheckIns(attendees, items);
  if (changed.length) {
    const data = [];
    for (const a of changed) {
      data.push({ range: `'${tab()}'!${colLetter(idx.status)}${a.row}`, values: [[a.status]] });
      if (idx.time >= 0) {
        data.push({ range: `'${tab()}'!${colLetter(idx.time)}${a.row}`, values: [[a.time]] });
      }
    }
    await api.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: { valueInputOption: 'RAW', data },
    });
  }
  return results;
}
