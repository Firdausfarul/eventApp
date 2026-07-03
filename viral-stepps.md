# Muhasabah Virality — Internacia Jakarta × STEPPS

> Analisis shareability app pakai framework STEPPS (Jonah Berger, *Contagious*).
> Status: **backlog #1–#5 DIKERJAKAN 2026-07-04** — lihat checklist di bawah.

## Skor per huruf

### S — Social Currency · 5/10 (potensi gede, belum dipakai)
Wizard secara struktur udah *quiz* (usia, minat) dan persona kurator (Keluarga Muda /
Anak Seni / Anak Aktif) udah bahasa identitas — tapi hasilnya berhenti jadi filter
internal. Mekanik "hasil quiz yang di-share" (ala Spotify Wrapped / MBTI) itu social
currency klasik: orang pamer **identitas**, bukan pamer aplikasi.
"Gue tim Anak Seni 🎨, weekend gue: TIM, Perpus Cikini, JAKfilm" = kartu yang orang
mau tempel di story. Artefaknya belum ada.

### T — Triggers · 7/10 (copy udah bener)
"Weekend gabut?" = trigger anchoring yang tepat — *gabut* dan *weekend* kejadian
berulang tiap minggu (prinsip Kit Kat–kopi). Yang bolong: gak ada mekanisme yang
nyolek balik user pas trigger kejadian (Jumat sore = momen planning). Weekly digest
rilis tiap Jumat = kawinkan trigger dengan kebiasaan.

### E — Emotion · 4/10 (paling datar)
Tone sekarang informatif-praktis (bagus buat trust, jelek buat spread). High-arousal
yang cocok di domain ini: **antisipasi + FOMO**, bukan lucu-lucuan. Data udah punya
bahannya: PRJ selesai 14 Juli → badge "⏳ 2 minggu terakhir!" itu emosi, bukan
dekorasi. Sticker "Kegiatan baru" di hero udah searah, tapi belum masuk ke kartu/list
tempat keputusan dibuat.

### P — Public · 3/10 (paling lemah, paling murah dibenerin)
Pemakaian app sepenuhnya privat. Satu-satunya jejak publik = share WA (`?plan=` +
teks) — dan di Indonesia itu *tepat* (virality lokal hidup di grup WA, bukan feed).
Masalah: link `?plan=` unfurl-nya polos. SPA statis gak bisa kasih OG meta dinamis ke
crawler WA — tapi backend `/plan/share` udah ada; tinggal serve halaman share dengan
`og:title` ("Rencana Sabtu: 3 kegiatan gratis di Jakpus") + `og:image`. Link yang
menarik di grup WA = satu-satunya "billboard" app ini.
Bonus: analytics udah nge-track `plan`/`view` → "🔥 ditambahin ke 40 rencana minggu
ini" = social proof dari data yang udah ada.

### P — Practical Value · 9/10 (otot utama)
"Kegiatan gratis & murah + jarak + transit + jadwal harian" = *news you can use*
paling murni — kategori konten yang paling sering di-forward di grup keluarga/sekolah.
Catatan: **unit yang berguna buat penerima ≠ rencana pribadi.** "Jadwal gue Sabtu"
berguna buatku; "5 kegiatan gratis akhir pekan ini deket MRT" berguna buat semua
orang di grup. Unit kedua itu yang nyebar.

### S — Stories · 4/10
Belum ada bungkus cerita. Blurb kurator udah suara personal (proto-story). Trojan
horse realistis: cerita satu keluarga ngejalanin satu rencana ("Sabtu kemarin:
3 tempat, Rp 0, naik TransJakarta doang") — format yang orang ceritain ulang.

## Backlog (ranked effort → impact) — status 2026-07-04

1. ✅ **OG meta untuk link `?plan=`** (Public) — `GET /s/plan?ids=` di server.js:
   halaman unfurl server-rendered (og:title/desc dinamis dari kegiatan, og:image
   `/og-image.png`), crawler baca OG, manusia di-redirect ke SPA `?plan=`.
   FE `sharePlanUrl()` otomatis pakai halaman ini saat backend hidup (`apiOk`).
   `og-image.png` 1200×630 digenerate dari template branded (juga dipakai
   `index.html` yang sekarang punya OG baseline). Nginx forward Host +
   X-Forwarded-Proto ✓.
2. ✅ **Kartu persona shareable** (Social Currency) — tombol "📤 Bagikan kartu" di
   `.cur-banner`; `drawCuratorCard()` canvas 1080×1920 (pola band, brand, emoji
   persona, "Tim X", tagline, max 4 picks, CTA host) → Web Share API (file) atau
   download PNG. Hook test: `App._drawCard(objOrId)`.
3. ✅ **Badge urgensi** (Emotion) — `endDateOf`/`urgencyOf` di logic.js (parse
   "12 Juni–14 Juli 2026" & "Sepanjang Juni 2026"; jadwal rutin tanpa akhir tidak
   pernah urgent). "⏳ Tinggal N hari" (≤14) di compact card + detail modal.
4. ✅ **Counter social proof** (Public) — `GET /analytics/popular` (plan_add 7 hari,
   id+count doang) + `POPULAR` map di FE → "🔥 Ditambahin ke N rencana minggu ini"
   (tampil saat N≥2) di card + detail. Smoke test 8/8 lulus.
5. ✅ **Digest mingguan (lean)** (Trigger + Practical Value) — `GET /digest`:
   "Weekend ini di Jakarta: N kegiatan seru, M gratis", listing akhir pekan
   (filter `when=weekend` repo), OG lengkap, CTA ke app. URL stabil buat di-drop
   ke grup WA tiap Jumat. Belum ada: otomasi posting & og:image khusus digest.

## Kesimpulan

Kuat di huruf yang bikin orang **bertahan** (Practical Value, Trigger); lemah di huruf
yang bikin orang **dateng** (Public, Social Currency, Emotion). Tiga yang lemah paling
murah ditambal — bahan bakunya (persona, analytics, tanggal, endpoint share) udah ada
semua di codebase.
