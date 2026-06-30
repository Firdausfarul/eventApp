/*
 * data.js — Static seed data for "Liburan di Jakarta".
 *
 * This mirrors the data contract in PRD §3.4. In production these objects are
 * replaced by the backend REST API (see note.md). The frontend never assumes
 * anything about the data source beyond this shape, so swapping `RAW` for a
 * `fetch('/activities')` call is the only change needed later.
 */

// One object per activity. `lat`,`lng` are real coordinates (used by the Leaflet
// map and Haversine distance); `x`,`y` are legacy illustrative percent coords.
export const RAW = [
  { id:'prj', nama:'Jakarta Fair Kemayoran (PRJ)', penyelenggara:'Jakarta International Expo', kategori:['festival'], color:'#E6298E', emoji:'🎡', deskripsi:'Festival terbesar se-Asia Tenggara — ribuan stan UMKM, wahana, kuliner, pameran otomotif, dan konser musik gratis tiap malam.', usia_min:6, usia_max:99, lokasiNama:'JIExpo Kemayoran, Jakarta Pusat', area:'Jakarta Pusat', tanggal:'12 Juni–14 Juli 2026', jam:'15.30–23.00 WIB', biaya:'50.000', link:'https://jakarta.go.id', x:54, y:28, lat:-6.1490, lng:106.8451 },
  { id:'kuliner', nama:'Festival Kuliner Nusantara', penyelenggara:'Dinas Parekraf DKI Jakarta', kategori:['festival','memasak'], color:'#FFC222', emoji:'🍢', deskripsi:'Bazaar jajanan khas Betawi & Nusantara, demo masak, dan panggung budaya di akhir pekan. Cocok buat jalan-jalan rame-rame.', usia_min:6, usia_max:99, lokasiNama:'Lapangan Banteng, Jakarta Pusat', area:'Jakarta Pusat', tanggal:'Setiap akhir pekan', jam:'16.00–22.00 WIB', biaya:'gratis', link:'https://jakarta.go.id', x:48, y:38, lat:-6.1702, lng:106.8345 },
  { id:'sale', nama:'Jakarta Great Sale & Bazaar Pelajar', penyelenggara:'Dinas PPKUKM DKI', kategori:['belanja'], color:'#F15A22', emoji:'🛍️', deskripsi:'Festival belanja diskon di mal-mal Jakarta plus bazaar produk kreatif pelajar dan UMKM lokal — thrift, fashion, sampai gadget.', usia_min:6, usia_max:99, lokasiNama:'Berbagai mal, Jakarta', area:'Se-Jakarta', tanggal:'Sepanjang Juni 2026', jam:'10.00–22.00 WIB', biaya:'gratis', link:'https://jakarta.go.id', x:64, y:64, lat:-6.2246, lng:106.8095 },
  { id:'perpus', nama:'Perpustakaan Jakarta — Workshop & Baca', penyelenggara:'Dispusip DKI Jakarta', kategori:['literasi'], color:'#1497C0', emoji:'📚', deskripsi:'Ruang baca nyaman plus workshop menulis, mendongeng, dan kelas kreatif tiap akhir pekan untuk segala usia.', usia_min:6, usia_max:99, lokasiNama:'Cikini, Jakarta Pusat', area:'Jakarta Pusat', tanggal:'Setiap Sabtu', jam:'09.00–15.00 WIB', biaya:'gratis', link:'https://jakarta.go.id', x:35, y:43, lat:-6.1899, lng:106.8400 },
  { id:'gor', nama:'Gelanggang Olahraga Remaja (GOR)', penyelenggara:'Dispora DKI Jakarta', kategori:['olahraga'], color:'#F15A22', emoji:'⚽', deskripsi:'Lapangan futsal, basket, dan voli gratis untuk remaja, lengkap dengan pelatih pendamping di sore hari.', usia_min:12, usia_max:24, lokasiNama:'Ragunan, Jakarta Selatan', area:'Jakarta Selatan', tanggal:'Senin–Jumat', jam:'15.00–18.00 WIB', biaya:'gratis', link:'https://jakarta.go.id', x:42, y:80, lat:-6.3060, lng:106.8200 },
  { id:'tim', nama:'TIM — Workshop & Pertunjukan', penyelenggara:'Jakpro / Taman Ismail Marzuki', kategori:['seni','pertunjukan'], color:'#7B3FE4', emoji:'🎨', deskripsi:'Kelas seni rupa, teater, dan pertunjukan langsung di pusat kebudayaan ikonik Jakarta.', usia_min:6, usia_max:99, lokasiNama:'Cikini, Jakarta Pusat', area:'Jakarta Pusat', tanggal:'Jadwal mingguan', jam:'16.00–21.00 WIB', biaya:'gratis', link:'https://jakarta.go.id', x:37, y:37, lat:-6.1893, lng:106.8395 },
  { id:'coding', nama:'Program Coding Kids', penyelenggara:'BPSDM DKI Jakarta', kategori:['coding','sains'], color:'#7B3FE4', emoji:'💻', deskripsi:'Belajar dasar pemrograman, Scratch, dan robotika lewat proyek seru bersama mentor.', usia_min:10, usia_max:17, lokasiNama:'Jatinegara, Jakarta Timur', area:'Jakarta Timur', tanggal:'Setiap Minggu', jam:'10.00–13.00 WIB', biaya:'gratis', link:'https://jakarta.go.id', x:72, y:50, lat:-6.2150, lng:106.8700 },
  { id:'orchestra', nama:'Jakarta Youth Orchestra', penyelenggara:'Dinas Kebudayaan DKI', kategori:['musik'], color:'#E6298E', emoji:'🎵', deskripsi:'Latihan orkestra untuk pelajar dari nol — pinjam alat musik gratis dan tampil di konser akhir program.', usia_min:12, usia_max:22, lokasiNama:'Kuningan, Jakarta Selatan', area:'Jakarta Selatan', tanggal:'Latihan tiap Sabtu', jam:'13.00–16.00 WIB', biaya:'gratis', link:'https://jakarta.go.id', x:50, y:62, lat:-6.2300, lng:106.8290 },
  { id:'esports', nama:'Esports Tournament Pelajar', penyelenggara:'Dispora DKI Jakarta', kategori:['gaming'], color:'#00A98F', emoji:'🎮', deskripsi:'Turnamen Mobile Legends & Valorant antar pelajar se-Jakarta dengan hadiah dan kelas literasi digital.', usia_min:13, usia_max:24, lokasiNama:'Kemayoran, Jakarta Pusat', area:'Jakarta Pusat', tanggal:'12–14 Juli 2026', jam:'09.00–17.00 WIB', biaya:'gratis', link:'https://jakarta.go.id', x:52, y:30, lat:-6.1560, lng:106.8550 },
  { id:'batik', nama:'Workshop Batik Betawi', penyelenggara:'Dinas Kebudayaan DKI', kategori:['seni','budaya'], color:'#FFC222', emoji:'🖌️', deskripsi:'Belajar membatik motif khas Betawi langsung dari pengrajin di kampung budaya Setu Babakan.', usia_min:10, usia_max:24, lokasiNama:'Setu Babakan, Jakarta Selatan', area:'Jakarta Selatan', tanggal:'Setiap Minggu', jam:'08.00–11.00 WIB', biaya:'gratis', link:'https://jakarta.go.id', x:46, y:90, lat:-6.3370, lng:106.8160 },
  { id:'hutan', nama:'Hutan Kota & Nature Education', penyelenggara:'Dinas LH DKI Jakarta', kategori:['alam'], color:'#2FA84F', emoji:'🌿', deskripsi:'Jelajah hutan kota, kelas berkebun, dan edukasi lingkungan untuk keluarga dan anak muda.', usia_min:6, usia_max:99, lokasiNama:'GBK, Jakarta Pusat', area:'Jakarta Pusat', tanggal:'Sabtu & Minggu', jam:'06.00–10.00 WIB', biaya:'gratis', link:'https://jakarta.go.id', x:44, y:54, lat:-6.2185, lng:106.8020 },
  { id:'film', nama:'JAKfilm Screening Gratis', penyelenggara:'Diskominfotik DKI', kategori:['film'], color:'#1A1A2E', emoji:'🎬', deskripsi:'Nonton bareng film pilihan dan diskusi ringan bersama sineas muda Jakarta, terbuka untuk umum.', usia_min:6, usia_max:99, lokasiNama:'Monas, Jakarta Pusat', area:'Jakarta Pusat', tanggal:'Jumat malam', jam:'19.00–22.00 WIB', biaya:'gratis', link:'https://jakarta.go.id', x:40, y:47, lat:-6.1754, lng:106.8272 },
  { id:'lansia', nama:'Senam & Kelas Sehat Lansia', penyelenggara:'Dinas Kesehatan DKI Jakarta', kategori:['olahraga'], color:'#2FA84F', emoji:'🧘', deskripsi:'Senam pagi, posyandu lansia, dan kelas hidup sehat bareng di RPTRA — gratis untuk warga senior.', usia_min:55, usia_max:99, lokasiNama:'RPTRA terdekat, Jakarta', area:'Se-Jakarta', tanggal:'Selasa & Kamis', jam:'06.30–09.00 WIB', biaya:'gratis', link:'https://jakarta.go.id', x:30, y:66, lat:-6.2400, lng:106.8000 },
  { id:'museum', nama:'Museum Gratis Akhir Pekan', penyelenggara:'Dinas Kebudayaan DKI', kategori:['museum'], color:'#78716C', emoji:'🏛️', deskripsi:'Kunjungi museum-museum Kota Tua tanpa tiket setiap akhir pekan, lengkap dengan tur pemandu.', usia_min:6, usia_max:99, lokasiNama:'Kota Tua, Jakarta Barat', area:'Jakarta Barat', tanggal:'Sabtu & Minggu', jam:'09.00–15.00 WIB', biaya:'gratis', link:'https://jakarta.go.id', x:19, y:42, lat:-6.1352, lng:106.8133 }
];

// Day-of-week occurrences per activity (0=Sunday … 6=Saturday).
export const HARI = { prj:[0,1,2,3,4,5,6], kuliner:[6,0], sale:[0,1,2,3,4,5,6], perpus:[6], gor:[1,2,3,4,5], tim:[4,5,6], coding:[0], orchestra:[6], esports:[0,1,2], batik:[0], hutan:[6,0], film:[5], lansia:[2,4], museum:[6,0] };

// Global validity window for the school holiday season.
export const PERIOD = ['2026-06-01','2026-07-31'];

// Per-activity validity windows that override PERIOD (one-off / seasonal events).
export const WINDOW = { prj:['2026-06-12','2026-07-14'], sale:['2026-06-01','2026-06-30'], esports:['2026-07-12','2026-07-14'] };

// Sub-events shown inside the detail view.
export const SUB = {
  film:    { heading: '🎬 Film yang diputar pekan ini', items: [ { nama:'"Laskar Pelangi"', meta:'19.00 · layar utama' }, { nama:'Film pendek: "Tilik"', meta:'20.30' }, { nama:'Diskusi & QnA sineas muda', meta:'21.15' } ] },
  prj:     { heading: '🎪 Acara di dalam PRJ', items: [ { nama:'Konser musik panggung utama', meta:'Tiap malam · 20.00' }, { nama:'Pameran otomotif & UMKM', meta:'Setiap hari' }, { nama:'Lomba & games keluarga', meta:'Akhir pekan' } ] },
  kuliner: { heading: '🍢 Isi festival', items: [ { nama:'Bazaar 50+ tenant kuliner', meta:'Sepanjang acara' }, { nama:'Demo masak chef tamu', meta:'17.00' }, { nama:'Panggung musik & budaya', meta:'19.30' } ] },
  esports: { heading: '🎮 Cabang yang dipertandingkan', items: [ { nama:'Mobile Legends', meta:'12–13 Jul' }, { nama:'Valorant', meta:'13–14 Jul' }, { nama:'Kelas literasi digital', meta:'Setiap sesi' } ] },
  tim:     { heading: '🎭 Program di TIM', items: [ { nama:'Pentas teater', meta:'Sabtu · 19.00' }, { nama:'Workshop seni rupa', meta:'Sabtu · 16.00' }, { nama:'Pameran galeri seni', meta:'Setiap hari' } ] }
};

// Age band ranges keyed by ageGroup.
export const AGEBANDS = { all:[0,99], anak:[6,12], remaja:[13,17], muda:[18,24], dewasa:[25,59], lansia:[60,99] };

// [key, label, emoji, sublabel]
export const AGEGROUPS = [['all','Semua umur','✨','tampilkan semua'],['anak','Anak','🧒','6–12 thn'],['remaja','Remaja','🧑','13–17 thn'],['muda','Dewasa muda','🧑‍🎓','18–24 thn'],['dewasa','Dewasa','🧑‍💼','25–59 thn'],['lansia','Lansia','🧓','60 thn ke atas']];

// [label, emoji, category-slug] — wizard/filter interest chips map to categories.
export const INTERESTS = [['Festival & Bazaar','🎡','festival'],['Belanja & Kuliner','🛍️','belanja'],['Olahraga','⚽','olahraga'],['Seni & Kerajinan','🎨','seni'],['Games/Gaming','🎮','gaming'],['Buku','📚','literasi'],['Musik','🎵','musik'],['Film','🎬','film'],['Museum','🏛️','museum'],['Sains & Teknologi','🔬','sains'],['Pertunjukan Langsung','🎭','pertunjukan'],['Alam & Lingkungan','🌿','alam'],['Memasak','🍳','memasak'],['Coding & Digital','💻','coding']];

// Pretty labels per category slug.
export const CATLABEL = { literasi:'Literasi', olahraga:'Olahraga', seni:'Seni', pertunjukan:'Pertunjukan', coding:'Coding', sains:'Sains', musik:'Musik', gaming:'Gaming', budaya:'Budaya', alam:'Alam', film:'Film', museum:'Museum', memasak:'Memasak', festival:'Festival', belanja:'Belanja' };

// Logistics: registration flag, recurring flag, WA contact, tiered tickets, transport.
export const EXTRA = {
  prj:      { rutin:false, daftar:false, kontak:'0811-2026-700', tiket:[['Senin–Jumat','40.000'],['Sabtu–Minggu & libur','50.000']], transport:['🚌 TransJakarta — Halte Kemayoran · 600 m','🚆 Stasiun Kemayoran (KRL) · 1,2 km'] },
  kuliner:  { rutin:true,  daftar:false, kontak:'0811-2026-701', transport:['🚌 TransJakarta — Halte Lapangan Banteng · 200 m','🚇 MRT Stasiun Bundaran HI · 1,5 km'] },
  sale:     { rutin:false, daftar:false, kontak:'0811-2026-702', transport:['🚌 Halte TransJakarta di tiap mal','🚇 MRT / LRT sesuai lokasi mal'] },
  perpus:   { rutin:true,  daftar:false, kontak:'0811-2026-703', transport:['🚆 Stasiun Cikini (KRL) · 400 m','🚌 TransJakarta — Halte Cikini · 300 m'] },
  gor:      { rutin:true,  daftar:false, kontak:'0811-2026-704', transport:['🚌 TransJakarta — Halte Ragunan · 350 m'] },
  tim:      { rutin:true,  daftar:false, kontak:'0811-2026-705', transport:['🚆 Stasiun Cikini (KRL) · 450 m','🚌 TransJakarta — Halte TIM · 150 m'] },
  coding:   { rutin:true,  daftar:true,  kontak:'0811-2026-706', transport:['🚆 Stasiun Jatinegara (KRL) · 500 m','🚌 TransJakarta — Halte Jatinegara · 400 m'] },
  orchestra:{ rutin:true,  daftar:true,  kontak:'0811-2026-707', transport:['🚇 MRT Stasiun Setiabudi · 700 m','🚌 TransJakarta — Halte Kuningan · 300 m'] },
  esports:  { rutin:false, daftar:true,  kontak:'0811-2026-708', transport:['🚌 TransJakarta — Halte Kemayoran · 650 m'] },
  batik:    { rutin:true,  daftar:true,  kontak:'0811-2026-709', transport:['🚆 Stasiun Lenteng Agung (KRL) · 2 km','🚌 JakLingko menuju Setu Babakan'] },
  hutan:    { rutin:true,  daftar:false, kontak:'0811-2026-710', transport:['🚇 MRT Stasiun Senayan · 400 m','🚌 TransJakarta — Halte GBK · 250 m'] },
  film:     { rutin:true,  daftar:false, kontak:'0811-2026-711', transport:['🚆 Stasiun Gambir (KRL) · 600 m','🚌 TransJakarta — Halte Monas · 200 m'] },
  lansia:   { rutin:true,  daftar:false, kontak:'0811-2026-712', transport:['🚌 Halte TransJakarta / JakLingko terdekat dari RPTRA'] },
  museum:   { rutin:true,  daftar:false, kontak:'0811-2026-713', transport:['🚆 Stasiun Jakarta Kota (KRL) · 300 m','🚌 TransJakarta — Halte Kota · 350 m'] }
};

// Landing page category showcase: [label, emoji, color].
export const CATPALETTE = [['Festival','🎡','#E6298E'],['Belanja','🛍️','#F15A22'],['Olahraga','⚽','#F15A22'],['Seni','🎨','#7B3FE4'],['Musik','🎵','#E6298E'],['Film','🎬','#1A1A2E'],['Alam','🌿','#2FA84F'],['Gaming','🎮','#00A98F'],['Museum','🏛️','#78716C'],['Literasi','📚','#1497C0']];

export const MONTH_NAMES = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
export const HARI_NAMES = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];

/*
 * hydrateActivities(list) — replace the bundled seed with data from the backend
 * (GET /activities). The exported RAW/HARI/WINDOW/EXTRA/SUB are mutated IN PLACE
 * so existing `import`s in logic.js / app.js keep pointing at the live data.
 * `list` items must follow the DTO shape returned by the API (see note.md §1).
 */
export function hydrateActivities(list) {
  if (!Array.isArray(list) || !list.length) return false;
  RAW.length = 0;
  for (const k of Object.keys(HARI)) delete HARI[k];
  for (const k of Object.keys(WINDOW)) delete WINDOW[k];
  for (const k of Object.keys(EXTRA)) delete EXTRA[k];
  for (const k of Object.keys(SUB)) delete SUB[k];

  for (const p of list) {
    RAW.push({
      id: p.id, nama: p.nama, penyelenggara: p.penyelenggara, kategori: p.kategori || [],
      color: p.color, emoji: p.emoji, deskripsi: p.deskripsi,
      usia_min: p.usia_min, usia_max: p.usia_max, lokasiNama: p.lokasiNama, area: p.area,
      tanggal: p.tanggal, jam: p.jam, biaya: p.biaya, link: p.link,
      lat: p.lat, lng: p.lng, x: p.x, y: p.y
    });
    if (p.hariBerlaku) HARI[p.id] = p.hariBerlaku;
    if (p.window && p.window.mulai) WINDOW[p.id] = [p.window.mulai, p.window.selesai];
    EXTRA[p.id] = {
      rutin: !!p.rutin, daftar: !!p.perlu_daftar, kontak: p.kontak || undefined,
      tiket: (p.tiket && p.tiket.length) ? p.tiket : undefined,
      transport: p.transport || []
    };
    if (p.subAcara) SUB[p.id] = p.subAcara;
  }
  return true;
}
