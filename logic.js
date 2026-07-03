/*
 * logic.js — Pure, framework-free selectors & helpers.
 *
 * Everything here is a pure function of (state, data): no DOM, no side effects.
 * This is the heart of PRD §3.2 — combined client filtering, daily-plan routing
 * heuristics, calendar occurrence expansion, and WA/.ics artifact generation.
 * Keeping it pure makes it trivially unit-testable and easy to port server-side.
 */
import { RAW, HARI, PERIOD, WINDOW, SUB, AGEBANDS, INTERESTS, CATLABEL, CAT_COLOR, EXTRA } from './data.js';

// ── time / distance / money helpers ───────────────────────────────────────
// "15.30–23.00 WIB" → { start: 930, end: 1380 } (minutes past midnight)
export function parseJam(j) {
  const m = String(j).match(/(\d{1,2})\.(\d{2})\D+(\d{1,2})\.(\d{2})/);
  return m ? { start: +m[1] * 60 + +m[2], end: +m[3] * 60 + +m[4] } : { start: 0, end: 0 };
}
export const fmtMin = (t) => { const h = Math.floor(t / 60), m = t % 60; return (h < 10 ? '0' + h : h) + '.' + (m < 10 ? '0' + m : m); };
export const fmtDur = (t) => { const h = Math.floor(t / 60), m = t % 60; return h ? (h + ' jam' + (m ? ' ' + m + ' mnt' : '')) : (m + ' mnt'); };
// Great-circle distance (Haversine) between two activities, in km, from real
// lat/lng. Falls back to 0 if coordinates are missing.
export function distKm(a, b) {
  if (a.lat == null || b.lat == null) return 0;
  const R = 6371, toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
export function biayaMin(p) {
  const ex = EXTRA[p.id] || {};
  if (ex.tiket) return parseInt(ex.tiket[0][1].replace(/\D/g, ''), 10) || 0;
  return p.biaya === 'gratis' ? 0 : (parseInt(String(p.biaya).replace(/\D/g, ''), 10) || 0);
}
export const halteShort = (arr) => (arr && arr[0]) ? arr[0].split(' · ')[0] : 'lokasi event';
export const fmtRp = (n) => n ? ('Rp ' + n.toLocaleString('id-ID')) : 'Gratis';
export const biayaLabelOf = (p) => { const ex = EXTRA[p.id] || {}; return ex.tiket ? ('Mulai Rp ' + ex.tiket[0][1]) : (p.biaya === 'gratis' ? 'Gratis' : ('Rp ' + p.biaya)); };
export const usiaLabelOf = (p) => (p.usia_min <= 6 && p.usia_max >= 24) ? 'Semua umur' : (p.usia_max >= 99 ? (p.usia_min + ' thn ke atas') : (p.usia_min + '–' + p.usia_max + ' tahun'));
export const catLabelOf = (p) => CATLABEL[p.kategori[0]] || p.kategori[0];
// Display color comes from the FIRST category, never from the per-item `color`
// column — keeps every card/pin/badge of one category the same hue.
export const catColorOf = (p) => CAT_COLOR[(p.kategori || [])[0]] || '#FC351C';

// ── urgency ("minggu terakhir!") from the human-readable tanggal field ─────
// Only bounded runs produce an end date: "12 Juni–14 Juli 2026" and
// "Sepanjang Juni 2026". Recurring schedules ("Setiap Sabtu", "Senin–Jumat")
// have no end and never show urgency.
const MONTHS_ID = { januari: 0, februari: 1, maret: 2, april: 3, mei: 4, juni: 5, juli: 6, agustus: 7, september: 8, oktober: 9, november: 10, desember: 11 };
export function endDateOf(p, fallbackYear = 2026) {
  const t = String(p.tanggal || '').toLowerCase();
  let m = t.match(/[–—-]\s*(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?/); // range end "…–14 juli 2026"
  if (m && MONTHS_ID[m[2]] != null) return new Date(+(m[3] || fallbackYear), MONTHS_ID[m[2]], +m[1], 23, 59);
  m = t.match(/sepanjang\s+([a-z]+)(?:\s+(\d{4}))?/); // "sepanjang juni 2026" → last day
  if (m && MONTHS_ID[m[1]] != null) return new Date(+(m[2] || fallbackYear), MONTHS_ID[m[1]] + 1, 0, 23, 59);
  return null;
}
export function urgencyOf(p, now = new Date()) {
  const end = endDateOf(p);
  if (!end) return '';
  const days = Math.floor((end - now) / 86400000);
  if (days < 0) return '';
  if (days === 0) return 'Hari terakhir!';
  if (days === 1) return 'Besok hari terakhir!';
  if (days <= 14) return `Tinggal ${days} hari`;
  return '';
}

// ── filtering (band usia ∩ minat ∩ query ∩ waktu) ──────────────────────────
export function activeCats(state) {
  const cats = new Set();
  state.interests.forEach(label => {
    const m = INTERESTS.find(i => i[0] === label);
    if (m && m[2]) cats.add(m[2]);
  });
  return cats;
}

export function filtered(state) {
  const band = AGEBANDS[state.ageGroup] || [0, 99];
  const cats = activeCats(state);
  const useCat = cats.size > 0;
  const q = (state.query || '').trim().toLowerCase();
  const when = state.when;
  let targetDays = null;
  if (when !== 'all') {
    const dow = new Date().getDay();
    targetDays = when === 'today' ? [dow] : when === 'tomorrow' ? [(dow + 1) % 7] : [6, 0];
  }
  return RAW.filter(p => {
    if (!(p.usia_min <= band[1] && band[0] <= p.usia_max)) return false;
    if (targetDays) { const hari = HARI[p.id] || []; if (!hari.some(d => targetDays.includes(d))) return false; }
    if (useCat && !p.kategori.some(k => cats.has(k))) return false;
    if (q) {
      const hay = (p.nama + ' ' + p.penyelenggara + ' ' + p.lokasiNama + ' ' + p.kategori.map(k => CATLABEL[k] || k).join(' ')).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

// ── daily plan: order by start time, compute segments, totals, conflicts ───
export function planComputed(state) {
  const events = state.plan.map(id => RAW.find(p => p.id === id)).filter(Boolean)
    .map(p => ({ ...p, t: parseJam(p.jam) }))
    .sort((a, b) => a.t.start - b.t.start);

  const items = events.map((p, i) => {
    const next = events[i + 1];
    let seg = null;
    if (next) {
      const km = distKm(p, next);
      const menit = Math.round(km / 18 * 60 + 8); // ~18 km/h + 8 min fixed overhead
      const overlap = next.t.start < p.t.end;
      const tight = !overlap && next.t.start < (p.t.end + menit);
      const warn = overlap || tight;
      const exA = EXTRA[p.id] || {}, exB = EXTRA[next.id] || {};
      const kmLabel = (km < 1 ? (Math.round(km * 10) / 10) : Math.round(km)) + ' km';
      seg = {
        warn,
        head: '🚌 ' + kmLabel + ' · ±' + menit + ' mnt' + (overlap ? ' · ⚠ jadwal bentrok' : (tight ? ' · ⚠ waktu pindah mepet' : '')),
        route: halteShort(exA.transport) + '  ➜  ' + halteShort(exB.transport)
      };
    }
    return { ...p, jamLabel: p.jam, biayaLabel: biayaLabelOf(p), seg };
  });

  let totalTravel = 0, conflictCount = 0;
  for (let i = 0; i < events.length - 1; i++) {
    const a = events[i], b = events[i + 1];
    const menit = Math.round(distKm(a, b) / 18 * 60 + 8);
    totalTravel += menit;
    if (b.t.start < a.t.end || b.t.start < a.t.end + menit) conflictCount++;
  }
  const totalBiaya = events.reduce((sum, p) => sum + biayaMin(p), 0);
  const dayStart = events.length ? fmtMin(events[0].t.start) : '';
  const dayEnd = events.length ? fmtMin(Math.max.apply(null, events.map(e => e.t.end))) : '';

  return { events, items, totalTravel, conflictCount, totalBiaya, dayStart, dayEnd };
}

// WhatsApp share URL + .ics data-URI for a computed plan.
export function planExports(plan) {
  if (!plan.events.length) return { share: '', ics: '' };
  const fee = (p) => { const ex = EXTRA[p.id] || {}; return ex.tiket ? ('mulai Rp ' + ex.tiket[0][1]) : (p.biaya === 'gratis' ? 'gratis' : ('Rp ' + p.biaya)); };
  const lines = plan.events.map(p => '• ' + fmtMin(p.t.start) + ' ' + p.nama + ' — ' + p.area + ' (' + fee(p) + ')');
  const text = '🗓️ Rencana Harian — Internacia Jakarta\n' + plan.dayStart + '–' + plan.dayEnd + ' · ' + plan.events.length + ' kegiatan\n\n' + lines.join('\n') + '\n\nDisusun di Internacia Jakarta.';
  const share = 'https://wa.me/?text=' + encodeURIComponent(text);

  const now = new Date(), pad = (n) => String(n).padStart(2, '0');
  const dt = '' + now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate());
  let ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//LiburanJKT//ID\r\n';
  plan.events.forEach(p => {
    const t = p.t;
    ics += 'BEGIN:VEVENT\r\nUID:' + p.id + '-' + dt + '@liburanjkt\r\nDTSTART:' + dt + 'T' + pad(Math.floor(t.start / 60)) + pad(t.start % 60) + '00\r\nDTEND:' + dt + 'T' + pad(Math.floor(t.end / 60)) + pad(t.end % 60) + '00\r\nSUMMARY:' + p.nama + '\r\nLOCATION:' + (p.lokasiNama || p.area) + '\r\nEND:VEVENT\r\n';
  });
  ics += 'END:VCALENDAR';
  return { share, ics: 'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics) };
}

// ── calendar (June–July 2026 only) ─────────────────────────────────────────
const pad2 = (n) => String(n).padStart(2, '0');
export const isoOf = (y, m, d) => y + '-' + pad2(m + 1) + '-' + pad2(d);

// Activities occurring on day `d` of (calYear, calMonth) — expands HARI × WINDOW.
export function occOn(calYear, calMonth, d) {
  const dt = new Date(calYear, calMonth, d), dow = dt.getDay(), ds = isoOf(calYear, calMonth, d);
  return RAW.filter(p => {
    if (!(HARI[p.id] || []).includes(dow)) return false;
    const w = WINDOW[p.id] || PERIOD;
    return ds >= w[0] && ds <= w[1];
  });
}

export function calendarModel(state) {
  const calYear = 2026, calMonth = state.calMonth;
  const tNow = new Date();
  const todayIso = isoOf(tNow.getFullYear(), tNow.getMonth(), tNow.getDate());
  const startDow = new Date(calYear, calMonth, 1).getDay();
  const dim = new Date(calYear, calMonth + 1, 0).getDate();
  const monthPrefix = calYear + '-' + pad2(calMonth + 1);

  let selDs = (state.calDay && state.calDay.startsWith(monthPrefix)) ? state.calDay : null;
  // Optional range end (state.calEnd): only honored inside the shown month and
  // alongside a valid start. ISO strings compare lexicographically, so <> works.
  let endDs = (selDs && state.calEnd && state.calEnd.startsWith(monthPrefix)) ? state.calEnd : null;
  if (endDs && endDs < selDs) { const t = selDs; selDs = endDs; endDs = t; }
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push({ blank: true });
  let firstWith = null;
  const monthMap = new Map(); // unique programs occurring at least once this month
  for (let d = 1; d <= dim; d++) {
    const evs = occOn(calYear, calMonth, d), ds = isoOf(calYear, calMonth, d);
    if (evs.length && !firstWith) firstWith = ds;
    evs.forEach(e => monthMap.set(e.id, e));
    const dow = new Date(calYear, calMonth, d).getDay();
    cells.push({
      blank: false, ds, day: d, count: evs.length, hasEvents: evs.length > 0,
      colors: evs.slice(0, 3).map(e => e.color), emojis: evs.slice(0, 2).map(e => e.emoji),
      we: dow === 0 || dow === 6, today: ds === todayIso,
    });
  }
  if (!selDs) selDs = todayIso.startsWith(monthPrefix) ? todayIso : (firstWith || isoOf(calYear, calMonth, 1));
  cells.forEach(c => {
    if (c.blank) return;
    c.selected = c.ds === selDs || c.ds === endDs;
    c.inrange = !!endDs && c.ds > selDs && c.ds < endDs;
  });

  const selDateObj = new Date(selDs + 'T00:00:00');
  const selDayEvents = occOn(calYear, calMonth, selDateObj.getDate());
  // One entry per selected day (single date → one entry), each with its own
  // occurrences — the day panel renders these as per-day groups.
  const d1 = selDateObj.getDate(), d2 = endDs ? +endDs.slice(8) : d1;
  const selDays = [];
  for (let d = d1; d <= d2; d++) {
    selDays.push({ ds: isoOf(calYear, calMonth, d), dateObj: new Date(calYear, calMonth, d), events: occOn(calYear, calMonth, d) });
  }
  const rangeIds = new Set();
  selDays.forEach(x => x.events.forEach(e => rangeIds.add(e.id)));
  const monthPrograms = [...monthMap.values()];
  const busiest = cells.reduce((a, c) => (!c.blank && c.count > (a ? a.count : 0) ? c : a), null);
  return {
    calYear, calMonth, cells, selDs, endDs, selDateObj, selDayEvents, selDays,
    rangeTotal: rangeIds.size,
    monthTotal: monthPrograms.length,
    monthFree: monthPrograms.filter(e => e.biaya === 'gratis').length,
    busiest,
  };
}

export { SUB, EXTRA, CATLABEL };
