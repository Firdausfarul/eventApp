# Backend Spec — "Liburan di Jakarta"

> ✅ **SUDAH DIIMPLEMENTASIKAN** di `backend/` (Node + Express + `node:sqlite`).
> Dokumen ini sekarang berfungsi sebagai **referensi API + kontrak data**. Lihat
> `backend/src/{db,repo,server}.js`, test di `backend/test/`, dan
> `README.md → Backend API`. Frontend sudah otomatis pakai API ini (boot
> `GET /api/activities` lalu `hydrateActivities()` di `data.js`, dengan fallback
> ke data bundel kalau API mati).
>
> Prinsip utama: **kontrak data di `data.js` / §"Response shape" di bawah adalah
> batas antara FE & BE.** Frontend tidak berasumsi apa pun soal sumber data
> selain bentuk ini.

---

## 0. Konteks singkat
Aplikasi mengumpulkan kegiatan gratis/murah Pemprov DKI + komunitas, lalu
mempersonalisasi rekomendasi (wizard usia/minat/lokasi), menampilkan daftar +
peta + kalender, dan menyusun **rencana harian** (urut jam, estimasi rute,
deteksi bentrok, ekspor WA/.ics). Fokus: Libur Sekolah **Juni–Juli 2026**.

Stack bebas (rekomendasi: **Node + Express + PostgreSQL**, atau FastAPI + SQLite
untuk cepat). Yang penting endpoint & bentuk response sesuai di bawah.

---

## 1. Yang HARUS dipertahankan (kontrak FE)
Frontend `logic.js` mengandalkan field-field ini **persis**. Jangan rename.

Tiap activity (lihat array `RAW` di `data.js`) punya:

```jsonc
{
  "id": "prj",                       // string unik, slug
  "nama": "Jakarta Fair Kemayoran (PRJ)",
  "penyelenggara": "Jakarta International Expo",
  "kategori": ["festival"],          // array slug kategori
  "color": "#E6298E",                // hex, dipakai untuk marker/badge
  "emoji": "🎡",
  "deskripsi": "…",
  "usia_min": 6,
  "usia_max": 99,
  "lokasiNama": "JIExpo Kemayoran, Jakarta Pusat",
  "area": "Jakarta Pusat",
  "tanggal": "12 Juni–14 Juli 2026", // string tampilan (human-readable)
  "jam": "15.30–23.00 WIB",          // FE parse regex (\d{1,2})\.(\d{2})…
  "biaya": "50.000",                 // "gratis" | string angka rupiah
  "link": "https://jakarta.go.id",
  "lat": -6.1490, "lng": 106.8451,   // koordinat asli — dipakai peta Leaflet + Haversine
  "x": 54, "y": 28                   // legacy peta ilustratif (persen) — boleh diabaikan
}
```

> **Map sudah pakai lat/lng asli.** FE sekarang render peta **Leaflet** nyata
> (lihat `app.js` + `config.js`) dan hitung jarak antar-kegiatan dengan
> **Haversine** atas `lat`/`lng`. Backend WAJIB kirim `lat`/`lng` per activity
> (dari tabel `Location`). `x`/`y` legacy, tidak wajib.

Data turunan yang sekarang ada di objek terpisah (`data.js`) — backend harus
sediakan, boleh digabung ke dalam activity atau lewat endpoint detail:

- `HARI[id]` → `hariBerlaku: number[]` (0=Minggu … 6=Sabtu). Hari okurensi rutin.
- `WINDOW[id]` → `window: { mulai, selesai }` ISO date. Default ke `PERIOD`
  (`2026-06-01` … `2026-07-31`) kalau tidak ada.
- `EXTRA[id]` → `rutin: bool`, `daftar: bool` (perlu_daftar), `kontak` (WA),
  `tiket: [["label","harga"], …]`, `transport: string[]` (sudah ada emoji + jarak).
- `SUB[id]` → `subAcara: { heading, items: [{nama, meta}] }` (opsional).

> **PENTING — format `jam` & `biaya`:** FE parsing bergantung pada format ini.
> `jam` harus `HH.MM–HH.MM WIB` (pakai titik, en-dash). `biaya` = `"gratis"` atau
> string angka (boleh pakai titik ribuan). Kalau backend mau kirim angka mentah,
> tambahkan field baru (mis. `jam_mulai`/`jam_selesai` menit) DAN update `logic.js`
> — jangan diam-diam ubah format string lama.

`x`/`y` (persen) cuma untuk **peta ilustratif** sekarang. Produksi simpan
`lat`/`lng` asli (lihat model di bawah); FE versi peta nyata = fase 2.

---

## 2. Model data (relasional)

| Entitas | Field |
|---|---|
| **Organizer** | `id, nama, instansi, kontak` |
| **Activity** | `id, nama, penyelenggara_id→Organizer, kategori[] (text[]/join table), emoji, color, deskripsi, usia_min, usia_max, biaya_jenis('gratis'\|'berbayar'), biaya_teks, perlu_daftar(bool), rutin(bool), kontak_wa, link, map_x, map_y` |
| **Location** | `activity_id, lokasi_nama, area, lat, lng` (produksi: lat/lng asli) |
| **Occurrence** | `activity_id, hari_berlaku int[] (0–6), jam_mulai('HH:MM'), jam_selesai, window_mulai(date), window_selesai(date)` |
| **TicketTier** | `activity_id, label, harga` |
| **Transport** | `activity_id, urutan, moda, nama_halte, jarak` (FE sekarang terima sudah-terformat string; sediakan juga string siap-tampil) |
| **SubEvent** | `activity_id, heading?, nama, meta` |

Kategori valid (slug): `festival, belanja, olahraga, seni, pertunjukan, coding,
sains, musik, gaming, budaya, alam, film, museum, memasak, literasi`.
Label tampilan ada di `CATLABEL` (`data.js`) — boleh juga dilayani via `/categories`.

Age bands (lihat `AGEBANDS`): `all[0,99] anak[6,12] remaja[13,17] muda[18,24]
dewasa[25,59] lansia[60,99]`.

---

## 3. Endpoint (REST)

| Method | Path | Query / Body | Keterangan |
|---|---|---|---|
| GET | `/activities` | `age, interests (csv kategori), q, when(all\|today\|tomorrow\|weekend), lat, lng, page` | List terfilter. **Boleh** filter server-side (lihat §4) atau kirim semua & biarkan FE filter (FE sudah punya logika lengkap). Minimal kirim full list dgn bentuk §1. |
| GET | `/activities/:id` | — | Detail lengkap: sub-acara, tiket, transport, kontak. |
| GET | `/calendar` | `from, to` (ISO date) | Okurensi per tanggal untuk grid kalender. Lihat §4 ekspansi. |
| GET | `/categories` | — | `[{slug,label}]` metadata filter. |
| GET | `/age-bands` | — | `[{key,label,min,max}]`. |
| POST | `/plan/share` *(opsional)* | body: `{items:[id…]}` | Simpan rencana → short-link + .ics server-side. (FE saat ini generate sendiri.) |
| POST/PUT/DELETE | `/admin/activities[/:id]` ✅ | HTTP Basic | CRUD — **sudah jadi** (`admin.html` + `server.js`). |

### Response shape `/activities` (yang dipakai FE)
Kirim **array** objek persis bentuk §1. Contoh paling aman: replikasi `RAW` +
gabungkan `hariBerlaku`, `window`, `tiket`, `transport`, `daftar`, `rutin`,
`kontak`, `subAcara` ke tiap objek. Lalu di FE, `data.js` diganti:

```js
export async function loadActivities() {
  const res = await fetch('/api/activities');
  return res.json(); // harus sesuai bentuk RAW
}
```

(FE refactor kecil: `logic.js` jadikan fungsi terima `data` sbg argumen, atau
inject ke module. Sekarang `logic.js` import `RAW` dkk statis dari `data.js`.)

---

## 4. Logika yang HARUS di backend (atau direplikasi)

Frontend `logic.js` sudah mengimplementasikan semua ini secara klien. Backend
boleh memindahkannya server-side (lebih benar untuk produksi):

1. **Ekspansi jadwal** (`occOn` di `logic.js`): untuk rentang `from..to`, untuk
   tiap activity, untuk tiap tanggal `d`: kalau `dow(d) ∈ hariBerlaku` DAN
   `window.mulai ≤ d ≤ window.selesai` → activity muncul di tanggal itu.
   Dipakai `/calendar` dan filter `when`.
2. **Filter usia**: overlap band user `[bandMin,bandMax]` dgn `[usia_min,usia_max]`
   → `usia_min ≤ bandMax && bandMin ≤ usia_max`.
3. **Filter minat**: `interests` (csv kategori) ∩ `activity.kategori` ≠ ∅.
4. **Filter waktu `when`**: `today`=hari ini, `tomorrow`=besok, `weekend`=[Sab,Min];
   cocokkan ke `hariBerlaku`.
5. **Search `q`**: substring case-insensitive atas `nama + penyelenggara +
   lokasiNama + label kategori`.
6. **Geo-sort** *(produksi)*: urut hasil per jarak Haversine dari `lat,lng` user.
   (FE sekarang tidak sort jarak; pakai urutan dataset. Helper Haversine sudah
   ada di `logic.js` → `distKm`, bisa dipakai ulang.)
7. **Rencana harian** (tetap di FE — lihat `planComputed`): urut per `jam_mulai`,
   jarak antar-kegiatan **Haversine** atas `lat`/`lng` (sudah diimplementasikan),
   waktu tempuh `≈ km/18*60 + 8` menit, deteksi overlap & "mepet", total biaya/
   durasi, ekspor `wa.me` + data-URI `.ics`. **Routing transum nyata = fase 2**
   (ganti heuristik km/18 dgn layanan peta/transum).

---

## 5. Non-fungsional
- **Privasi:** lokasi user **TIDAK disimpan** — hanya parameter sort sesaat.
  Jangan log lat/lng ke storage persisten.
- Read endpoint **cache-able** (data jarang berubah harian) — set `Cache-Control`.
- Validasi & moderasi konten ingest; `link` & `kontak_wa` diverifikasi.
- CORS: izinkan origin frontend.
- Format `jam`/`biaya`: lihat peringatan §1.

---

## 6. Di luar lingkup v1
Akun/login, push, pendaftaran in-app, beli tiket, rating, navigasi turn-by-turn
nyata (pakai heuristik dulu).

---

## 7. Quick start saran (Node/Express + Postgres)
1. Schema sesuai §2 (migrations). Seed dari `data.js` (`RAW`+`HARI`+`WINDOW`+
   `EXTRA`+`SUB`) — gampang di-port jadi INSERT.
2. `GET /activities` → join semua, bentuk objek sesuai §1 (+turunan), return array.
3. `GET /activities/:id` → satu objek lengkap.
4. `GET /calendar?from=&to=` → ekspansi (§4.1), return `{ "2026-06-29": [activity…], … }`.
5. `GET /categories`, `/age-bands` → dari `CATLABEL` & `AGEBANDS`.
6. Frontend: ganti import statis `data.js` → `await loadActivities()`; sisanya
   (`logic.js`) tetap, cuma ubah dari konstanta jadi argumen/await.

Kalau mau zero-refactor di FE dulu: cukup hidangkan file `data.js`-equivalent
sebagai `GET /api/activities` yang mengembalikan array `RAW`, lalu kita sambungkan.
