// โหมด Google Sheets — เชื่อมผ่าน Service Account
import { google } from 'googleapis';
import { toAttendees, applyCheckIns, colLetter } from './core.mjs';

const tab = () => process.env.SHEET_TAB || 'Attendees';

function client() {
  const email = process.env.GOOGLE_CLIENT_EMAIL;
  const key = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
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
