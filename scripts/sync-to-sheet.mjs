// ส่งข้อมูลเช็คอินจากโหมด Local (data/checkins.csv) ขึ้น Google Sheet ภายหลัง
// ใช้: npm run sync
import fs from 'node:fs';
import path from 'node:path';
import { parseCSV } from '../lib/csv.mjs';
import { sheetCheckIn } from '../lib/sheets.mjs';

const LOG = path.join(process.cwd(), 'data', 'checkins.csv');
if (!fs.existsSync(LOG)) {
  console.log('ไม่มีไฟล์ data/checkins.csv — ยังไม่มีข้อมูลให้ส่ง');
  process.exit(0);
}

const items = parseCSV(fs.readFileSync(LOG, 'utf8'))
  .slice(1)
  .map(([key, rfid, id, time]) => ({ key: rfid || id || key, time }));

console.log(`กำลังส่ง ${items.length} รายการขึ้น Google Sheet...`);
const results = await sheetCheckIn(items);
const count = (r) => results.filter((x) => x.result === r).length;
console.log(`บันทึกใหม่ ${count('ok')} · เช็คอินไว้แล้ว ${count('already')} · ไม่พบในชีต ${count('not_found')}`);
for (const x of results.filter((x) => x.result === 'not_found')) console.log('  ไม่พบ:', x.key);
