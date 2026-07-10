/*
 * db.js — SQLite schema + seed for the Liburan di Jakarta API.
 *
 * Uses Node's built-in `node:sqlite` (no native build step). The relational
 * model follows PRD §4.2. Seed data is imported directly from the frontend's
 * `data.js` so there is a single source of truth — no copy/paste of activities.
 */
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

import {
  RAW, HARI, WINDOW, PERIOD, EXTRA, SUB, CATLABEL
} from '../../data.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// File-backed by default (persist across restarts via the mounted volume).
// Set DB_PATH=':memory:' for an ephemeral DB.
const DB_PATH = process.env.DB_PATH || resolve(__dirname, '../data/app.db');
if (DB_PATH !== ':memory:') mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

function createSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS organizer (
      id TEXT PRIMARY KEY, nama TEXT NOT NULL, instansi TEXT, kontak TEXT
    );
    CREATE TABLE IF NOT EXISTS activity (
      id TEXT PRIMARY KEY,
      nama TEXT NOT NULL,
      penyelenggara_id TEXT REFERENCES organizer(id),
      penyelenggara TEXT NOT NULL,
      color TEXT, emoji TEXT, deskripsi TEXT,
      usia_min INTEGER, usia_max INTEGER,
      lokasi_nama TEXT, area TEXT,
      tanggal TEXT, jam TEXT, biaya TEXT, link TEXT,
      media_url TEXT,
      lat REAL, lng REAL, map_x REAL, map_y REAL,
      primary_category TEXT, time_mode TEXT, visit_minutes INTEGER, venue_id TEXT,
      perlu_daftar INTEGER DEFAULT 0, rutin INTEGER DEFAULT 0, kontak_wa TEXT,
      window_mulai TEXT, window_selesai TEXT
    );
    CREATE TABLE IF NOT EXISTS activity_category (
      activity_id TEXT REFERENCES activity(id), kategori TEXT,
      PRIMARY KEY (activity_id, kategori)
    );
    CREATE TABLE IF NOT EXISTS occurrence (
      activity_id TEXT REFERENCES activity(id), dow INTEGER,
      PRIMARY KEY (activity_id, dow)
    );
    CREATE TABLE IF NOT EXISTS ticket_tier (
      activity_id TEXT REFERENCES activity(id), urutan INTEGER, label TEXT, harga TEXT
    );
    CREATE TABLE IF NOT EXISTS transport (
      activity_id TEXT REFERENCES activity(id), urutan INTEGER, teks TEXT
    );
    CREATE TABLE IF NOT EXISTS sub_event (
      activity_id TEXT REFERENCES activity(id), heading TEXT, urutan INTEGER, nama TEXT, meta TEXT
    );

    -- Curators: human "personas" (e.g. "Keluarga Muda") that handpick activities.
    -- curator_pick is a many-to-many join so one activity can sit in many curations.
    CREATE TABLE IF NOT EXISTS curator (
      id TEXT PRIMARY KEY,
      nama TEXT NOT NULL,
      tagline TEXT,
      emoji TEXT,
      bio TEXT,
      accent TEXT,
      sort_order INTEGER DEFAULT 0,
      aktif INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS curator_pick (
      curator_id TEXT REFERENCES curator(id),
      activity_id TEXT REFERENCES activity(id),
      blurb TEXT,
      urutan INTEGER DEFAULT 0,
      PRIMARY KEY (curator_id, activity_id)
    );

    CREATE TABLE IF NOT EXISTS analytics_event (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      activity_id TEXT,
      plan_size INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS shared_plan (
      id TEXT PRIMARY KEY,
      items_json TEXT NOT NULL,
      share_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const cols = db.prepare('PRAGMA table_info(activity)').all().map(c => c.name);
  if (!cols.includes('media_url')) db.exec('ALTER TABLE activity ADD COLUMN media_url TEXT');
  if (!cols.includes('primary_category')) db.exec('ALTER TABLE activity ADD COLUMN primary_category TEXT');
  if (!cols.includes('time_mode')) db.exec('ALTER TABLE activity ADD COLUMN time_mode TEXT');
  if (!cols.includes('visit_minutes')) db.exec('ALTER TABLE activity ADD COLUMN visit_minutes INTEGER');
  if (!cols.includes('venue_id')) db.exec('ALTER TABLE activity ADD COLUMN venue_id TEXT');
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function seed() {
  const count = db.prepare('SELECT COUNT(*) c FROM activity').get().c;
  if (count > 0) return; // already seeded

  const insOrg = db.prepare('INSERT OR IGNORE INTO organizer (id,nama,instansi,kontak) VALUES (?,?,?,?)');
  const insAct = db.prepare(`INSERT INTO activity
    (id,nama,penyelenggara_id,penyelenggara,color,emoji,deskripsi,usia_min,usia_max,lokasi_nama,area,tanggal,jam,biaya,link,media_url,lat,lng,map_x,map_y,primary_category,time_mode,visit_minutes,venue_id,perlu_daftar,rutin,kontak_wa,window_mulai,window_selesai)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insCat = db.prepare('INSERT OR IGNORE INTO activity_category (activity_id,kategori) VALUES (?,?)');
  const insOcc = db.prepare('INSERT OR IGNORE INTO occurrence (activity_id,dow) VALUES (?,?)');
  const insTier = db.prepare('INSERT INTO ticket_tier (activity_id,urutan,label,harga) VALUES (?,?,?,?)');
  const insTr = db.prepare('INSERT INTO transport (activity_id,urutan,teks) VALUES (?,?,?)');
  const insSub = db.prepare('INSERT INTO sub_event (activity_id,heading,urutan,nama,meta) VALUES (?,?,?,?,?)');

  const tx = db.prepare('SELECT 1'); // no-op; we wrap manually
  db.exec('BEGIN');
  try {
    for (const p of RAW) {
      const ex = EXTRA[p.id] || {};
      const orgId = slug(p.penyelenggara);
      insOrg.run(orgId, p.penyelenggara, p.penyelenggara, ex.kontak || null);
      const win = WINDOW[p.id] || PERIOD;
      insAct.run(
        p.id, p.nama, orgId, p.penyelenggara, p.color, p.emoji, p.deskripsi,
        p.usia_min, p.usia_max, p.lokasiNama, p.area, p.tanggal, p.jam, p.biaya, p.link, p.mediaUrl || null,
        p.lat ?? null, p.lng ?? null, p.x ?? null, p.y ?? null,
        p.primaryCategory || null, p.timeMode || null, p.visitMinutes || null, p.venueId || null,
        ex.daftar ? 1 : 0, ex.rutin ? 1 : 0, ex.kontak || null,
        win[0], win[1]
      );
      p.kategori.forEach(k => insCat.run(p.id, k));
      (HARI[p.id] || []).forEach(d => insOcc.run(p.id, d));
      (ex.tiket || []).forEach(([label, harga], i) => insTier.run(p.id, i, label, harga));
      (ex.transport || []).forEach((teks, i) => insTr.run(p.id, i, teks));
      const sub = SUB[p.id];
      if (sub) sub.items.forEach((it, i) => insSub.run(p.id, sub.heading, i, it.nama, it.meta || ''));
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  void tx;
}

function syncSeedCategories() {
  const exists = db.prepare('SELECT 1 FROM activity WHERE id = ?');
  const insCat = db.prepare('INSERT OR IGNORE INTO activity_category (activity_id,kategori) VALUES (?,?)');
  const updMeta = db.prepare('UPDATE activity SET primary_category = ?, time_mode = ?, visit_minutes = ?, venue_id = ? WHERE id = ?');
  db.exec('BEGIN');
  try {
    for (const p of RAW) {
      if (!exists.get(p.id)) continue;
      (p.kategori || []).forEach(k => insCat.run(p.id, k));
      updMeta.run(p.primaryCategory || null, p.timeMode || null, p.visitMinutes || null, p.venueId || null, p.id);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// Example personas so the feature is populated out-of-the-box. Admin can edit/
// add/remove via /admin/curators. Picks reference seeded activity ids above.
const CURATOR_SEED = [
  {
    id: 'keluarga-muda', nama: 'Keluarga Muda', tagline: 'Seru bareng anak, ramah kantong',
    emoji: '👨‍👩‍👧', accent: '#F15A22', sort_order: 1,
    bio: 'Pilihan kegiatan yang aman, edukatif, dan menyenangkan buat dibawa anak-anak — tanpa bikin dompet nangis.',
    picks: [
      ['kuliner', 'Jajan rame-rame, ada panggung budaya buat anak.'],
      ['hutan', 'Anak belajar soal alam sambil main di luar.'],
      ['museum', 'Gratis tiap akhir pekan, ada tur pemandu.'],
      ['perpus', 'Mendongeng & kelas kreatif buat si kecil.'],
      ['prj', 'Sekali setahun — wahana & kuliner lengkap.']
    ]
  },
  {
    id: 'anak-seni', nama: 'Anak Seni', tagline: 'Buat yang hidupnya estetik',
    emoji: '🎨', accent: '#7B3FE4', sort_order: 2,
    bio: 'Kurasi buat kamu yang suka seni, pertunjukan, dan bikin karya sendiri.',
    picks: [
      ['tim', 'Pusatnya seni Jakarta — teater, galeri, workshop.'],
      ['batik', 'Bikin batik Betawi langsung dari pengrajin.'],
      ['orchestra', 'Pinjam alat musik gratis, tampil di akhir program.'],
      ['film', 'Nobar + diskusi bareng sineas muda.']
    ]
  },
  {
    id: 'anak-aktif', nama: 'Anak Aktif', tagline: 'Gerak terus, gabut minggat',
    emoji: '⚽', accent: '#00A98F', sort_order: 3,
    bio: 'Buat yang nggak bisa diem — olahraga, turnamen, dan kegiatan luar ruang.',
    picks: [
      ['gor', 'Futsal/basket/voli gratis, ada pelatih.'],
      ['esports', 'Turnamen ML & Valorant antar pelajar.'],
      ['hutan', 'Jelajah hutan kota pagi-pagi.']
    ]
  }
];

function seedCurators() {
  const count = db.prepare('SELECT COUNT(*) c FROM curator').get().c;
  if (count > 0) return;
  const insCur = db.prepare('INSERT INTO curator (id,nama,tagline,emoji,bio,accent,sort_order,aktif) VALUES (?,?,?,?,?,?,?,1)');
  const insPick = db.prepare('INSERT OR IGNORE INTO curator_pick (curator_id,activity_id,blurb,urutan) VALUES (?,?,?,?)');
  db.exec('BEGIN');
  try {
    for (const c of CURATOR_SEED) {
      insCur.run(c.id, c.nama, c.tagline, c.emoji, c.bio, c.accent, c.sort_order);
      c.picks.forEach(([aid, blurb], i) => insPick.run(c.id, aid, blurb, i));
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export const PERIOD_RANGE = PERIOD;
export const CATEGORIES = CATLABEL;

export function init() {
  createSchema();
  seed();
  syncSeedCategories();
  seedCurators();
  return db;
}

// Allow `npm run seed` / `node src/db.js` to (re)initialise standalone.
if (import.meta.url === `file://${process.argv[1]}`) {
  init();
  const n = db.prepare('SELECT COUNT(*) c FROM activity').get().c;
  console.log(`DB ready at ${DB_PATH} — ${n} activities seeded.`);
}
