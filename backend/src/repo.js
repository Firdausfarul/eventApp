/*
 * repo.js — Query layer. Builds the activity DTO (shape the frontend consumes,
 * PRD §3.4) and implements the server-side logic from PRD §4.4:
 *   - schedule expansion (hariBerlaku × window → real dates)
 *   - age-band overlap, interest, when, and text filtering
 *   - geo-sort by Haversine distance from the user's lat/lng (not persisted)
 */
import { db, init, PERIOD_RANGE, CATEGORIES } from './db.js';
import { AGEBANDS, AGEGROUPS, INTERESTS, CATLABEL } from '../../data.js';

init();

// ── prepared statements ─────────────────────────────────────────────────
const qActivity = db.prepare('SELECT * FROM activity WHERE id = ?');
const qAllActivities = db.prepare('SELECT * FROM activity ORDER BY rowid');
const qCats = db.prepare('SELECT kategori FROM activity_category WHERE activity_id = ?');
const qOcc = db.prepare('SELECT dow FROM occurrence WHERE activity_id = ? ORDER BY dow');
const qTiers = db.prepare('SELECT label,harga FROM ticket_tier WHERE activity_id = ? ORDER BY urutan');
const qTransport = db.prepare('SELECT teks FROM transport WHERE activity_id = ? ORDER BY urutan');
const qSub = db.prepare('SELECT heading,nama,meta FROM sub_event WHERE activity_id = ? ORDER BY urutan');

// ── DTO ─────────────────────────────────────────────────────────────────
function toDTO(row) {
  if (!row) return null;
  const id = row.id;
  const subRows = qSub.all(id);
  const subAcara = subRows.length
    ? { heading: subRows[0].heading, items: subRows.map(s => ({ nama: s.nama, meta: s.meta })) }
    : null;
  return {
    id,
    nama: row.nama,
    penyelenggara: row.penyelenggara,
    kategori: qCats.all(id).map(c => c.kategori),
    color: row.color,
    emoji: row.emoji,
    deskripsi: row.deskripsi,
    usia_min: row.usia_min,
    usia_max: row.usia_max,
    lokasiNama: row.lokasi_nama,
    area: row.area,
    tanggal: row.tanggal,
    jam: row.jam,
    biaya: row.biaya,
    link: row.link,
    lat: row.lat,
    lng: row.lng,
    x: row.map_x,
    y: row.map_y,
    hariBerlaku: qOcc.all(id).map(o => o.dow),
    window: { mulai: row.window_mulai, selesai: row.window_selesai },
    rutin: !!row.rutin,
    perlu_daftar: !!row.perlu_daftar,
    kontak: row.kontak_wa,
    tiket: qTiers.all(id).map(t => [t.label, t.harga]),
    transport: qTransport.all(id).map(t => t.teks),
    subAcara
  };
}

const allDTOs = () => qAllActivities.all().map(toDTO);

// ── helpers ───────────────────────────────────────────────────────────────
function haversineKm(a, b) {
  if (a.lat == null || b.lat == null) return Infinity;
  const R = 6371, toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function whenToDays(when) {
  if (!when || when === 'all') return null;
  const dow = new Date().getDay();
  if (when === 'today') return [dow];
  if (when === 'tomorrow') return [(dow + 1) % 7];
  if (when === 'weekend') return [6, 0];
  return null;
}

// ── public queries ──────────────────────────────────────────────────────
export function getActivity(id) { return toDTO(qActivity.get(id)); }

export function listActivities({ age, interests, q, when, lat, lng, page, pageSize } = {}) {
  const band = AGEBANDS[age] || [0, 99];
  const cats = (interests ? String(interests).split(',') : []).map(s => s.trim()).filter(Boolean);
  const useCat = cats.length > 0;
  const query = (q || '').trim().toLowerCase();
  const targetDays = whenToDays(when);

  let list = allDTOs().filter(p => {
    if (!(p.usia_min <= band[1] && band[0] <= p.usia_max)) return false;
    if (targetDays && !p.hariBerlaku.some(d => targetDays.includes(d))) return false;
    if (useCat && !p.kategori.some(k => cats.includes(k))) return false;
    if (query) {
      const hay = (p.nama + ' ' + p.penyelenggara + ' ' + p.lokasiNama + ' ' +
        p.kategori.map(k => CATLABEL[k] || k).join(' ')).toLowerCase();
      if (!hay.includes(query)) return false;
    }
    return true;
  });

  // Geo-sort (privacy: lat/lng used only here, never stored — PRD §4.5).
  const uLat = parseFloat(lat), uLng = parseFloat(lng);
  if (!Number.isNaN(uLat) && !Number.isNaN(uLng)) {
    const u = { lat: uLat, lng: uLng };
    list = list
      .map(p => ({ p, d: haversineKm(u, p) }))
      .sort((a, b) => a.d - b.d)
      .map(x => ({ ...x.p, jarak_km: Math.round(x.d * 10) / 10 }));
  }

  const total = list.length;
  const ps = Math.max(1, parseInt(pageSize, 10) || total || 1);
  const pg = Math.max(1, parseInt(page, 10) || 1);
  const items = parseInt(pageSize, 10) ? list.slice((pg - 1) * ps, pg * ps) : list;
  return { total, page: pg, pageSize: ps, items };
}

// Occurrence expansion for the calendar grid (inclusive [from,to]).
export function calendar(from, to) {
  const start = from || PERIOD_RANGE[0];
  const end = to || PERIOD_RANGE[1];
  const list = allDTOs();
  const out = {};
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());

  const dStart = new Date(start + 'T00:00:00');
  const dEnd = new Date(end + 'T00:00:00');
  for (let d = new Date(dStart); d <= dEnd; d.setDate(d.getDate() + 1)) {
    const ds = iso(d), dow = d.getDay();
    const evs = list.filter(p =>
      p.hariBerlaku.includes(dow) && ds >= p.window.mulai && ds <= p.window.selesai);
    if (evs.length) out[ds] = evs;
  }
  return out;
}

export function categories() {
  return Object.entries(CATEGORIES).map(([slug, label]) => ({ slug, label }));
}

export function ageBands() {
  // Merge AGEBANDS ranges with the AGEGROUPS labels/emoji for a friendly payload.
  return AGEGROUPS.map(([key, label, emoji, sub]) => ({
    key, label, emoji, sub,
    min: (AGEBANDS[key] || [0, 99])[0],
    max: (AGEBANDS[key] || [0, 99])[1]
  }));
}

export function interestsMeta() {
  return INTERESTS.map(([label, emoji, kategori]) => ({ label, emoji, kategori }));
}

// ── curators (read) ───────────────────────────────────────────────────────
const qCurators = db.prepare('SELECT * FROM curator WHERE aktif = 1 ORDER BY sort_order, nama');
const qCuratorsAll = db.prepare('SELECT * FROM curator ORDER BY sort_order, nama');
const qCurator = db.prepare('SELECT * FROM curator WHERE id = ?');
const qPicks = db.prepare('SELECT activity_id, blurb FROM curator_pick WHERE curator_id = ? ORDER BY urutan, rowid');

// Picks return only activity ids + blurbs; the client already has the full
// activity dataset and resolves ids locally (keeps payload small + always fresh).
function curatorDTO(row) {
  if (!row) return null;
  const picks = qPicks.all(row.id).map(p => ({ id: p.activity_id, blurb: p.blurb || '' }));
  return {
    id: row.id, nama: row.nama, tagline: row.tagline, emoji: row.emoji,
    bio: row.bio, accent: row.accent, sortOrder: row.sort_order, aktif: !!row.aktif,
    picks, pickCount: picks.length
  };
}

// includeInactive=true is for the admin console (shows hidden curators too).
export function listCurators({ includeInactive = false } = {}) {
  return (includeInactive ? qCuratorsAll : qCurators).all().map(curatorDTO);
}
export function getCurator(id) { return curatorDTO(qCurator.get(id)); }

// ── admin: write side (CRUD) ────────────────────────────────────────────
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const err = (status, message) => Object.assign(new Error(message), { status });

const wOrg = db.prepare('INSERT OR REPLACE INTO organizer (id,nama,instansi,kontak) VALUES (?,?,?,?)');
const wAct = db.prepare(`INSERT OR REPLACE INTO activity
  (id,nama,penyelenggara_id,penyelenggara,color,emoji,deskripsi,usia_min,usia_max,lokasi_nama,area,tanggal,jam,biaya,link,lat,lng,map_x,map_y,perlu_daftar,rutin,kontak_wa,window_mulai,window_selesai)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
const dCat = db.prepare('DELETE FROM activity_category WHERE activity_id = ?');
const dOcc = db.prepare('DELETE FROM occurrence WHERE activity_id = ?');
const dTier = db.prepare('DELETE FROM ticket_tier WHERE activity_id = ?');
const dTr = db.prepare('DELETE FROM transport WHERE activity_id = ?');
const dSub = db.prepare('DELETE FROM sub_event WHERE activity_id = ?');
const wCat = db.prepare('INSERT OR IGNORE INTO activity_category (activity_id,kategori) VALUES (?,?)');
const wOcc = db.prepare('INSERT OR IGNORE INTO occurrence (activity_id,dow) VALUES (?,?)');
const wTier = db.prepare('INSERT INTO ticket_tier (activity_id,urutan,label,harga) VALUES (?,?,?,?)');
const wTr = db.prepare('INSERT INTO transport (activity_id,urutan,teks) VALUES (?,?,?)');
const wSub = db.prepare('INSERT INTO sub_event (activity_id,heading,urutan,nama,meta) VALUES (?,?,?,?,?)');
const existsAct = db.prepare('SELECT 1 FROM activity WHERE id = ?');

function validate(p, { id }) {
  if (!id || !/^[a-z0-9-]+$/.test(id)) throw err(400, 'id wajib, hanya huruf kecil/angka/strip');
  if (!p.nama || !String(p.nama).trim()) throw err(400, 'nama wajib');
  if (!Array.isArray(p.kategori) || !p.kategori.length) throw err(400, 'kategori minimal 1');
  if (!Number.isFinite(+p.usia_min) || !Number.isFinite(+p.usia_max)) throw err(400, 'usia_min/usia_max harus angka');
  if (!Number.isFinite(+p.lat) || !Number.isFinite(+p.lng)) throw err(400, 'lat/lng harus angka (set lokasi di peta)');
  if (p.hariBerlaku && (!Array.isArray(p.hariBerlaku) || p.hariBerlaku.some(d => d < 0 || d > 6))) throw err(400, 'hariBerlaku harus array 0–6');
}

// Insert-or-replace an activity and all its child rows in one transaction.
function writeActivity(id, p) {
  const win = p.window && p.window.mulai ? [p.window.mulai, p.window.selesai] : PERIOD_RANGE;
  const orgId = slug(p.penyelenggara || 'penyelenggara');
  db.exec('BEGIN');
  try {
    wOrg.run(orgId, p.penyelenggara || '', p.penyelenggara || '', p.kontak || null);
    wAct.run(
      id, p.nama, orgId, p.penyelenggara || '', p.color || '#F15A22', p.emoji || '📍', p.deskripsi || '',
      +p.usia_min, +p.usia_max, p.lokasiNama || '', p.area || '', p.tanggal || '', p.jam || '', p.biaya || 'gratis', p.link || '',
      +p.lat, +p.lng, p.x ?? null, p.y ?? null,
      p.perlu_daftar ? 1 : 0, p.rutin ? 1 : 0, p.kontak || null, win[0], win[1]
    );
    dCat.run(id); dOcc.run(id); dTier.run(id); dTr.run(id); dSub.run(id);
    p.kategori.forEach(k => wCat.run(id, k));
    (p.hariBerlaku || []).forEach(d => wOcc.run(id, +d));
    (p.tiket || []).forEach(([label, harga], i) => wTier.run(id, i, label, harga));
    (p.transport || []).forEach((teks, i) => wTr.run(id, i, teks));
    if (p.subAcara && Array.isArray(p.subAcara.items)) {
      p.subAcara.items.forEach((it, i) => wSub.run(id, p.subAcara.heading || '', i, it.nama, it.meta || ''));
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return getActivity(id);
}

export function createActivity(p) {
  const id = slug(p.id);
  validate(p, { id });
  if (existsAct.get(id)) throw err(409, `id "${id}" sudah ada`);
  return writeActivity(id, p);
}

export function updateActivity(id, p) {
  if (!existsAct.get(id)) throw err(404, 'not_found');
  validate({ ...p, kategori: p.kategori || ['festival'] }, { id });
  return writeActivity(id, p);
}

export function deleteActivity(id) {
  if (!existsAct.get(id)) throw err(404, 'not_found');
  db.exec('BEGIN');
  try {
    dCat.run(id); dOcc.run(id); dTier.run(id); dTr.run(id); dSub.run(id);
    db.prepare('DELETE FROM curator_pick WHERE activity_id = ?').run(id); // drop dangling picks
    db.prepare('DELETE FROM activity WHERE id = ?').run(id);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return { deleted: id };
}

// ── admin: curators (write) ───────────────────────────────────────────────
const wCur = db.prepare(`INSERT OR REPLACE INTO curator
  (id,nama,tagline,emoji,bio,accent,sort_order,aktif) VALUES (?,?,?,?,?,?,?,?)`);
const dPicks = db.prepare('DELETE FROM curator_pick WHERE curator_id = ?');
const wPick = db.prepare('INSERT OR IGNORE INTO curator_pick (curator_id,activity_id,blurb,urutan) VALUES (?,?,?,?)');
const existsCur = db.prepare('SELECT 1 FROM curator WHERE id = ?');

function validateCurator(c, { id }) {
  if (!id || !/^[a-z0-9-]+$/.test(id)) throw err(400, 'id wajib, hanya huruf kecil/angka/strip');
  if (!c.nama || !String(c.nama).trim()) throw err(400, 'nama wajib');
  if (c.picks && !Array.isArray(c.picks)) throw err(400, 'picks harus array');
}

// Write a curator and replace its full pick list in one transaction.
// picks: [{ id, blurb }] or ['activityId', …] — order in the array = display order.
function writeCurator(id, c) {
  const picks = (c.picks || [])
    .map(p => (typeof p === 'string' ? { id: p, blurb: '' } : { id: p.id, blurb: p.blurb || '' }))
    .filter(p => p.id && existsAct.get(p.id)); // ignore picks for unknown activities
  db.exec('BEGIN');
  try {
    wCur.run(id, c.nama, c.tagline || '', c.emoji || '⭐', c.bio || '', c.accent || '#F15A22',
      Number.isFinite(+c.sortOrder) ? +c.sortOrder : 0, c.aktif === false ? 0 : 1);
    dPicks.run(id);
    picks.forEach((p, i) => wPick.run(id, p.id, p.blurb, i));
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return getCurator(id);
}

export function createCurator(c) {
  const id = slug(c.id || c.nama);
  validateCurator(c, { id });
  if (existsCur.get(id)) throw err(409, `id "${id}" sudah ada`);
  return writeCurator(id, c);
}

export function updateCurator(id, c) {
  if (!existsCur.get(id)) throw err(404, 'not_found');
  validateCurator({ ...c, nama: c.nama }, { id });
  return writeCurator(id, c);
}

export function deleteCurator(id) {
  if (!existsCur.get(id)) throw err(404, 'not_found');
  db.exec('BEGIN');
  try {
    dPicks.run(id);
    db.prepare('DELETE FROM curator WHERE id = ?').run(id);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return { deleted: id };
}
