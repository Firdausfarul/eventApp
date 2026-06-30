# Liburan di Jakarta — Frontend

Portal kegiatan warga Jakarta (Libur Sekolah Juni–Juli 2026). Implementasi
frontend dari desain Claude Design (`Liburan di Jakarta.dc.html` +
`… - Phone.dc.html`) — **satu SPA responsif** yang memakai layout desktop di
layar lebar dan pola phone (bottom nav, toggle Daftar/Peta, bottom sheet) di
≤760px.

## Jalankan
Butuh static server (pakai ES modules, jadi tidak bisa `file://`).

**Cepat (tanpa Docker):**
```bash
python3 -m http.server 5173
# buka http://localhost:5173
```

**Docker (rekomendasi untuk self-host):**
```bash
docker compose up -d           # frontend di http://localhost:8088
                               # default pakai tile publik OpenStreetMap
```
Default peta pakai tile publik OSM (cocok untuk dev/demo — **jangan** untuk
produksi berat, lihat di bawah). Untuk tile sendiri, jalankan profil `tiles`:
```bash
docker compose --profile tiles up -d
```

## Struktur
| File | Isi |
|---|---|
| `index.html` | Entry point, load font + Leaflet (vendored) + CSS + `app.js` (module). |
| `styles.css` | Design tokens + class komponen; responsive desktop→phone. |
| `config.js` | **Satu** konstanta sumber tile peta + setting view (lihat di bawah). |
| `data.js` | Data seed (kontrak §3.4 PRD). **Diganti backend** — lihat `note.md`. |
| `logic.js` | Fungsi murni: filter, rencana harian (Haversine), kalender, ekspor WA/.ics. |
| `app.js` | State + render + event handling + peta Leaflet + persist `localStorage`. |
| `vendor/leaflet/` | Leaflet 1.9.4 di-host lokal (no CDN). |
| `backend/` | REST API (Node + Express + `node:sqlite`) — sumber data produksi. |
| `note.md` | Referensi API + kontrak data FE↔BE. |

## Backend API
Node + Express + **`node:sqlite`** (SQLite bawaan Node 24 — tanpa native build).
Di-seed dari `data.js` yang sama (satu sumber kebenaran, tanpa duplikasi data).

```bash
cd backend
npm install
npm start            # http://localhost:3000  (set PORT untuk ganti)
npm test             # 6 smoke test (filter, geo-sort, kalender, dst.)
```

Endpoint (PRD §4.3):
| Method | Path | Catatan |
|---|---|---|
| GET | `/activities` | query: `age, interests(csv slug), q, when, lat, lng, page, pageSize`. Tanpa `pageSize` → balikin **array** (drop-in untuk `data.js`). Dgn `lat,lng` → geo-sort Haversine (+`jarak_km`). |
| GET | `/activities/:id` | detail lengkap (sub-acara, tiket, transport, kontak). |
| GET | `/calendar?from=&to=` | ekspansi okurensi → `{ "YYYY-MM-DD": [activity…] }`. |
| GET | `/categories`, `/age-bands`, `/interests` | metadata filter. |
| POST | `/plan/share` | body `{items:[id…]}` → `{ ics, count }` (.ics data-URI, stateless). |
| GET | `/health` | healthcheck. |

**Integrasi FE:** `app.js` boot → `fetch('/api/activities')` → `hydrateActivities()`.
Kalau API tak terjangkau (mis. dibuka via static server tanpa backend), FE diam-diam
pakai data bundel `data.js`. Atur base URL di `config.js → API_BASE` (`''` =
bundel saja). Privasi: `lat/lng` user hanya dipakai untuk sort, **tidak disimpan**.

## Admin (input & edit kegiatan)
Halaman **`/admin.html`** — UI buat tambah/edit/hapus kegiatan, dengan **peta
Leaflet klik-untuk-set-lokasi** (titik yang kamu klik = `lat/lng` yang dirender
map publik). Form lengkap: kategori, hari berlaku, window tanggal, tiket
berjenjang, transport, sub-acara.

Auth **HTTP Basic** — diatur lewat env di service `api`:
```yaml
ADMIN_USER=admin
ADMIN_PASS=changeme     # WAJIB ganti sebelum produksi
```
Kalau `ADMIN_USER`/`ADMIN_PASS` kosong → endpoint admin balikin `503` (admin mati,
biar nggak kebuka nggak sengaja). Endpoint:
`POST /admin/activities`, `PUT /admin/activities/:id`, `DELETE /admin/activities/:id`,
`GET /admin/ping`. Perubahan langsung kelihatan di situs (data dari DB yang sama).

Akses via Docker: buka `http://localhost:8088/admin.html`, login pakai kredensial di atas.

## Peta (Leaflet) & self-hosting tiles
Peta hasil pakai **Leaflet** dengan marker di `lat`/`lng` asli; jarak rencana
harian dihitung **Haversine**. Sumber tile diatur di **satu** tempat:
`config.js` → `MAP.tileUrl`. Ganti nilainya, tidak perlu ubah kode lain.

**Opsi A — OSM raster tile server (sudah ada di `docker-compose.yml`, profil `tiles`).**
1. Download extract Geofabrik (mis. `indonesia-latest.osm.pbf`) ke `./osm/`.
2. Import sekali (isi volume `osm-data`):
   ```bash
   docker compose run --rm \
     -v "$PWD/osm/indonesia-latest.osm.pbf:/data/region.osm.pbf" \
     tileserver import
   ```
3. Jalankan: `docker compose --profile tiles up -d` → tiles di `http://localhost:8080`.
4. Set di `config.js`: `tileUrl: 'http://localhost:8080/tile/{z}/{x}/{y}.png'`,
   `subdomains: ''`, lalu `docker compose build app && docker compose up -d app`.

Detail lengkap: https://switch2osm.org/serving-tiles/.

**Opsi B — folder PNG statis (paling ringan, offline).** Pre-render/-download
tile Jakarta ke folder `tiles/{z}/{x}/{y}.png`, sajikan dgn static server yang
sama, lalu set:
```js
// config.js
tileUrl: './tiles/{z}/{x}/{y}.png',
subdomains: ''   // tidak pakai {s}
```

> Leaflet sendiri sudah di-vendor di `vendor/leaflet/` (di-download dari unpkg).
> Untuk update versi: ambil `leaflet.js`, `leaflet.css`, dan folder `images/`
> dari rilis Leaflet, taruh di situ.

## Fitur (sesuai PRD)
- Landing → Wizard 3 langkah (usia, minat, lokasi; semua opsional).
- Hasil: split peta + daftar, filter waktu, search, panel Filter, empty-state.
- Peta Leaflet nyata: marker per `lat`/`lng`, klik → fly-to & highlight, "Perkecil peta".
- Kalender Jun–Jul 2026: dot per kategori, pilih tanggal → daftar.
- Detail kegiatan: sub-acara, tiket berjenjang, transport, WA, lihat di peta.
- Rencana harian: urut per jam, segmen rute + waktu tempuh, deteksi bentrok,
  total biaya/durasi, ekspor WhatsApp + `.ics`.
- Persist pencarian & rencana di `localStorage`. Disclaimer + Call Center 1500-177.

## Catatan teknis
- Re-render penuh `#app` tiap perubahan state (dataset kecil → cukup cepat).
  Caret input dipertahankan via `_activeInput`.
- Nilai dinamis (warna kategori, posisi marker, lebar progress) inline; sisanya
  class di `styles.css`.
- Tweak desain (`heroStyle`, `cardStyle`) ada di state — default Bold/Detailed.
