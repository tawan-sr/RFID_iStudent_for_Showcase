// โหมด Local — ไม่ต้องใช้อินเทอร์เน็ตเลย
// อ่านรายชื่อจาก data/attendees.csv และบันทึกการเช็คอินลง data/checkins.csv
import fs from 'node:fs';
import path from 'node:path';
import { parseCSV, toCSV } from './csv.mjs';
import { toAttendees, applyCheckIns, findAttendee, STATUS_CHECKED } from './core.mjs';

const DIR = path.join(process.cwd(), 'data');
const ATT = path.join(DIR, 'attendees.csv');
const LOG = path.join(DIR, 'checkins.csv');

function readLog() {
  if (!fs.existsSync(LOG)) return [];
  return parseCSV(fs.readFileSync(LOG, 'utf8'))
    .slice(1)
    .map(([key, rfid, id, time]) => ({ key, rfid, id, time }));
}

export function localGetAttendees() {
  if (!fs.existsSync(ATT)) throw new Error('ไม่พบไฟล์ data/attendees.csv');
  const r = toAttendees(parseCSV(fs.readFileSync(ATT, 'utf8')));
  for (const l of readLog()) {
    const a = findAttendee(r.attendees, l.rfid || l.id || l.key);
    if (a && !a.checkedIn) {
      a.checkedIn = true;
      a.status = STATUS_CHECKED;
      a.time = l.time;
    }
  }
  return r;
}

export function localCheckIn(items) {
  const { attendees } = localGetAttendees();
  const { results, changed } = applyCheckIns(attendees, items);
  if (changed.length) {
    if (!fs.existsSync(LOG)) fs.writeFileSync(LOG, '﻿' + toCSV([['key', 'rfid', 'id', 'time']]));
    fs.appendFileSync(LOG, toCSV(changed.map((a) => [a.rfid || a.id, a.rfid, a.id, a.time])));
  }
  return results;
}
