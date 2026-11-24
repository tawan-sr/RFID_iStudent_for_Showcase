'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { norm, findAttendee } from '../lib/core.mjs';
import { TEAM_INFO } from '../lib/teams.mjs';

const LS = { pin: 'ck.pin', cache: 'ck.cache', queue: 'ck.queue', marks: 'ck.marks' };
const SYNC_EVERY_MS = 15000;
const RESULT_SHOW_MS = 7000;

const lsGet = (k, d) => {
  try {
    const v = localStorage.getItem(k);
    return v ? JSON.parse(v) : d;
  } catch {
    return d;
  }
};
const lsSet = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {}
};

const keyOf = (a) => norm(a.rfid) || '#' + norm(a.id);

const fullName = (a) => {
  const t = a.title || '';
  const sep = /[A-Za-z.]$/.test(t) ? ' ' : '';
  return `${t}${sep}${a.name || ''} ${a.surname || ''}`.trim();
};

// ตัวเลข → "ชั้นปีที่ 4" ส่วนข้อความอื่น เช่น "อาจารย์" แสดงตามที่กรอก
const yearText = (y) => {
  const v = String(y ?? '').trim();
  if (!v) return '';
  return /^\d+$/.test(v) ? `ชั้นปีที่ ${v}` : v;
};

const hhmm = (v) => {
  if (!v) return '';
  if (typeof v === 'number')
    return new Date(v).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' });
  const m = String(v).match(/(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : String(v);
};

// อ่านปุ่มจาก e.code แทน e.key — แม้เครื่องจะตั้งแป้นพิมพ์ภาษาไทยอยู่ ตัวเลขจากเครื่องอ่านบัตรก็ยังถูกต้อง
const charFromCode = (code) => {
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return code.slice(6);
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (code === 'Minus' || code === 'NumpadSubtract') return '-';
  return '';
};

let audioCtx;
function beep(kind) {
  try {
    const C = window.AudioContext || window.webkitAudioContext;
    audioCtx = audioCtx || new C();
    const seq = kind === 'ok' ? [880, 1320] : kind === 'dup' ? [620, 620] : [200];
    seq.forEach((f, i) => {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      const t = audioCtx.currentTime + i * 0.15;
      const len = kind === 'err' ? 0.5 : 0.12;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.35, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      o.connect(g).connect(audioCtx.destination);
      o.start(t);
      o.stop(t + len + 0.05);
    });
  } catch {}
}

export default function Station() {
  const [ready, setReady] = useState(false);
  const [pin, setPin] = useState('');
  const [needPin, setNeedPin] = useState(false);
  const [pinDraft, setPinDraft] = useState('');
  const [list, setList] = useState([]);
  const [marks, setMarks] = useState({}); // เช็คอินจากเครื่องนี้: key -> เวลา (ms)
  const [queue, setQueue] = useState([]);
  const [online, setOnline] = useState(true);
  const [mode, setMode] = useState('');
  const [lastSync, setLastSync] = useState(null);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [buffer, setBuffer] = useState('');
  const [menu, setMenu] = useState(false);
  const [clock, setClock] = useState('');

  const S = useRef({});
  S.current = { pin, list, marks };
  const queueRef = useRef([]);
  const flushing = useRef(false);

  const saveQueue = (q) => {
    queueRef.current = q;
    setQueue(q);
    lsSet(LS.queue, q);
  };

  async function refresh() {
    try {
      const r = await fetch('/api/attendees', { headers: { 'x-station-pin': S.current.pin }, cache: 'no-store' });
      if (r.status === 401) return setNeedPin(true);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'โหลดรายชื่อไม่สำเร็จ');
      setList(j.attendees);
      lsSet(LS.cache, { attendees: j.attendees, at: j.at, mode: j.mode });
      setMode(j.mode);
      setLastSync(j.at);
      setOnline(true);
      setError('');
    } catch (e) {
      if (e instanceof TypeError) setOnline(false);
      else {
        setOnline(true);
        setError(e.message);
      }
    }
  }

  async function flush() {
    if (flushing.current || !queueRef.current.length) return;
    flushing.current = true;
    const batch = queueRef.current.slice(0, 100);
    try {
      const r = await fetch('/api/checkin', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-station-pin': S.current.pin },
        body: JSON.stringify({ items: batch.map(({ key, at }) => ({ key, at })) }),
      });
      if (r.status === 401) return setNeedPin(true);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'บันทึกไม่สำเร็จ');
      const sent = new Set(batch.map((b) => b.uid));
      saveQueue(queueRef.current.filter((x) => !sent.has(x.uid)));
      setOnline(true);
      setError('');
    } catch (e) {
      if (e instanceof TypeError) setOnline(false);
      else {
        setOnline(true);
        setError(e.message);
      }
    } finally {
      flushing.current = false;
    }
  }

  function enqueue(key, at) {
    saveQueue([...queueRef.current, { uid: `${at}-${Math.random().toString(36).slice(2, 8)}`, key, at }]);
    flush();
  }

  function handleScan(raw) {
    const input = String(raw || '').trim();
    if (!input) return;
    const { list, marks } = S.current;
    const now = Date.now();
    const a = findAttendee(list, input);

    if (!a) {
      if (!list.length) {
        // ยังไม่เคยโหลดรายชื่อได้เลย: รับไว้ก่อนแล้วให้เซิร์ฟเวอร์ตรวจทีหลัง
        enqueue(input, now);
        setResult({ kind: 'pending', key: input, at: now });
        beep('dup');
      } else {
        setResult({ kind: 'err', key: input, at: now });
        beep('err');
      }
      return;
    }

    const key = keyOf(a);
    if (a.checkedIn || marks[key]) {
      setResult({ kind: 'dup', a, time: a.checkedIn ? a.time : marks[key], at: now });
      beep('dup');
      return;
    }

    const next = { ...marks, [key]: now };
    setMarks(next);
    lsSet(LS.marks, next);
    enqueue(a.rfid || a.id, now);
    setResult({ kind: 'ok', a, time: now, at: now });
    beep('ok');
  }

  const handleRef = useRef(handleScan);
  handleRef.current = handleScan;

  // เริ่มต้น: โหลดข้อมูลที่เก็บไว้ในเครื่องก่อน แล้วค่อยซิงก์กับเซิร์ฟเวอร์
  useEffect(() => {
    const p = lsGet(LS.pin, '');
    S.current.pin = p;
    setPin(p);
    const cache = lsGet(LS.cache, null);
    if (cache) {
      setList(cache.attendees || []);
      setLastSync(cache.at || null);
      setMode(cache.mode || '');
    }
    setMarks(lsGet(LS.marks, {}));
    const q = lsGet(LS.queue, []);
    queueRef.current = q;
    setQueue(q);
    setReady(true);

    const tick = async () => {
      await flush();
      await refresh();
    };
    tick();
    const id = setInterval(tick, SYNC_EVERY_MS);
    const onOnline = () => tick();
    window.addEventListener('online', onOnline);
    return () => {
      clearInterval(id);
      window.removeEventListener('online', onOnline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // รับค่าจากเครื่องอ่านบัตร (ทำงานเหมือนคีย์บอร์ด: พิมพ์เลขบัตร + Enter)
  useEffect(() => {
    let buf = '';
    const onKey = (e) => {
      if (e.target?.closest?.('input, textarea, select, [data-nokey]')) return;
      if (e.key === 'Enter' || e.code === 'Enter' || e.code === 'NumpadEnter') {
        e.preventDefault();
        const v = buf;
        buf = '';
        setBuffer('');
        handleRef.current(v);
      } else if (e.key === 'Escape') {
        buf = '';
        setBuffer('');
        setResult(null);
      } else if (e.key === 'Backspace') {
        buf = buf.slice(0, -1);
        setBuffer(buf);
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const c = charFromCode(e.code);
        if (c) {
          buf += c;
          setBuffer(buf);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!result) return;
    const t = setTimeout(() => setResult(null), RESULT_SHOW_MS);
    return () => clearTimeout(t);
  }, [result]);

  useEffect(() => {
    const f = () => setClock(new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' }));
    f();
    const id = setInterval(f, 10000);
    return () => clearInterval(id);
  }, []);

  const byKey = useMemo(() => new Map(list.map((a) => [keyOf(a), a])), [list]);
  const checkedCount = useMemo(() => list.filter((a) => a.checkedIn || marks[keyOf(a)]).length, [list, marks]);
  const recent = useMemo(
    () =>
      Object.entries(marks)
        .sort((x, y) => y[1] - x[1])
        .slice(0, 8)
        .map(([k, t]) => ({ k, t, a: byKey.get(k) }))
        .filter((x) => x.a),
    [marks, byKey]
  );

  function submitPin(e) {
    e.preventDefault();
    lsSet(LS.pin, pinDraft);
    S.current.pin = pinDraft;
    setPin(pinDraft);
    setNeedPin(false);
    setPinDraft('');
    flush().then(refresh);
  }

  function exportBackup() {
    const rows = [['RFID', 'ID', 'Title', 'Name', 'Surname', 'Nickname', 'Team', 'CheckinTime']];
    Object.entries(marks)
      .sort((x, y) => x[1] - y[1])
      .forEach(([k, t]) => {
        const a = byKey.get(k) || { rfid: k };
        rows.push([a.rfid, a.id, a.title, a.name, a.surname, a.nickname, a.team, new Date(t).toLocaleString('sv-SE', { timeZone: 'Asia/Bangkok' })]);
      });
    const csv = '﻿' + rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `checkin-backup-${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function clearLocal() {
    if (queueRef.current.length && !confirm(`ยังมี ${queueRef.current.length} รายการที่ยังไม่ได้ส่งขึ้นชีต ต้องการลบจริงหรือไม่?`)) return;
    if (!confirm('ล้างข้อมูลการเช็คอินที่เก็บไว้ในเครื่องนี้?')) return;
    setMarks({});
    lsSet(LS.marks, {});
    saveQueue([]);
    refresh();
  }

  const btn = (fn) => (e) => {
    e.currentTarget.blur();
    fn();
  };

  const status = !online || error ? 'offline' : queue.length ? 'pending' : 'online';
  const statusText = !online
    ? 'ออฟไลน์ · เก็บข้อมูลไว้ในเครื่อง'
    : error
      ? 'เชื่อมต่อฐานข้อมูลไม่ได้ · เก็บข้อมูลไว้ในเครื่อง'
      : queue.length
        ? 'กำลังส่งข้อมูล'
        : 'เชื่อมต่อแล้ว';

  return (
    <main className="stage">
      <div className="frame" aria-hidden="true">
        <i className="c tl" />
        <i className="c tr" />
        <i className="c bl" />
        <i className="c br" />
      </div>

      <header className="top">
        <link rel="icon" href="/my-icon.png" />
        <div className="brand">
          <span className="eyebrow">Check-in Station</span>
          <h1>
            iSchool Showcase <span className="ord">9<sup>th</sup></span>
          </h1>
        </div>
        <div className="count">
          <span className="count-num">{checkedCount}</span>
          <span className="count-total">/ {list.length || '—'}</span>
          <span className="count-label">เช็คอินแล้ว</span>
        </div>
      </header>

      <section className="center" aria-live="assertive">
        {result ? <ResultCard r={result} /> : <Idle hasList={list.length > 0} ready={ready} />}
      </section>

      <aside className="recent">
        <h2>ล่าสุดที่จุดนี้</h2>
        {recent.length === 0 ? (
          <p className="muted">ยังไม่มีการเช็คอิน</p>
        ) : (
          <ol>
            {recent.map(({ k, t, a }) => (
              <li key={k}>
                <span className="r-time">{hhmm(t)}</span>
                <span className="r-name">{fullName(a)}</span>
                <span className="r-team">{[yearText(a.year), a.team].filter(Boolean).join(' · ')}</span>
              </li>
            ))}
          </ol>
        )}
      </aside>

      <footer className="bar">
        <span className={`dot ${status}`} />
        <span>{statusText}</span>
        {queue.length > 0 && <span className="pill">รอส่ง {queue.length}</span>}
        {mode === 'local' && <span className="pill">โหมด Local</span>}
        <span className="muted hide-sm">ซิงก์ล่าสุด {lastSync ? hhmm(lastSync) : '—'}</span>
        {error && <span className="err-text">{error}</span>}
        <span className="spacer" />
        {buffer && <span className="buffer">{buffer}</span>}
        <span className="clock">{clock}</span>
        <button type="button" data-nokey className="icon-btn" onClick={btn(() => setMenu((m) => !m))} aria-label="ตั้งค่า">
          ⋯
        </button>
      </footer>

      {menu && (
        <div className="menu" data-nokey>
          <button type="button" onClick={btn(() => { flush().then(refresh); setMenu(false); })}>ซิงก์ตอนนี้</button>
          <button type="button" onClick={btn(() => { document.documentElement.requestFullscreen?.(); setMenu(false); })}>เต็มจอ</button>
          <button type="button" onClick={btn(() => { setNeedPin(true); setMenu(false); })}>เปลี่ยน PIN</button>
          <button type="button" onClick={btn(exportBackup)}>ดาวน์โหลดสำรอง (CSV)</button>
          <button type="button" className="danger" onClick={btn(clearLocal)}>ล้างข้อมูลในเครื่องนี้</button>
        </div>
      )}

      {needPin && (
        <div className="modal">
          <form className="modal-card" onSubmit={submitPin}>
            <h2>ใส่ PIN ของจุดเช็คอิน</h2>
            <p className="muted">ใช้ครั้งเดียว เครื่องจะจำไว้</p>
            <input autoFocus type="password" inputMode="numeric" value={pinDraft} onChange={(e) => setPinDraft(e.target.value)} />
            <button type="submit">ยืนยัน</button>
          </form>
        </div>
      )}
    </main>
  );
}

function Idle({ hasList, ready }) {
  return (
    <div className="idle">
      <div className="rings" aria-hidden="true">
        <span />
        <span />
        <span />
        <svg viewBox="0 0 64 64" className="card-ico">
          <rect x="10" y="16" width="44" height="32" rx="4" />
          <path d="M18 26h14M18 33h20M18 40h10" />
          <path d="M44 25a6 6 0 0 1 0 10M47.5 22a11 11 0 0 1 0 16" />
        </svg>
      </div>
      <p className="idle-th">แตะบัตรที่เครื่องอ่านเพื่อเช็คอิน</p>
      <p className="idle-en">Tap your card to check in</p>
      {ready && !hasList && <p className="warn">ยังไม่มีรายชื่อในเครื่อง — ต่ออินเทอร์เน็ตครั้งแรกเพื่อโหลดรายชื่อ</p>}
    </div>
  );
}

function ResultCard({ r }) {
  if (r.kind === 'err') {
    return (
      <div className="card card-err" key={r.at}>
        <div className="mark">✕</div>
        <p className="label">ไม่พบบัตรนี้ในระบบ</p>
        <p className="code">{r.key}</p>
        <p className="sub">กรุณาติดต่อเจ้าหน้าที่ลงทะเบียน</p>
      </div>
    );
  }
  if (r.kind === 'pending') {
    return (
      <div className="card card-dup" key={r.at}>
        <div className="mark">…</div>
        <p className="label">รับข้อมูลแล้ว · รอตรวจสอบ</p>
        <p className="code">{r.key}</p>
        <p className="sub">ระบบจะยืนยันกับฐานข้อมูลเมื่อกลับมาออนไลน์</p>
      </div>
    );
  }
  const a = r.a;
  const info = TEAM_INFO[a.team];
  const ok = r.kind === 'ok';
  return (
    <div className={`card ${ok ? 'card-ok' : 'card-dup'}`} key={r.at}>
      <div className="mark">{ok ? '✓' : '!'}</div>
      <p className="label">{ok ? 'เข้าร่วมแล้ว' : `เช็คอินแล้ว · เมื่อ ${hhmm(r.time)} น.`}</p>
      <p className="name">
        <span>{fullName({ ...a, surname: '' })}</span> <span>{a.surname}</span>
      </p>
      {a.nickname && <p className="nick">“{a.nickname}”</p>}
      {yearText(a.year) && <p className="year">{yearText(a.year)}</p>}
      {a.team && (
        <div className="team">
          <span className="team-label">ทีม</span>
          <span className="team-name">{a.team}</span>
          {info?.note && <span className="team-note">{info.note}</span>}
        </div>
      )}
    </div>
  );
}
