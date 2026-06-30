/*
 * admin.js — Admin console for Liburan di Jakarta.
 * HTTP Basic auth (credentials kept in localStorage, sent as Authorization
 * header). Location is set by clicking the Leaflet map → fills lat/lng, which is
 * exactly what the public map renders. CRUD against /admin/activities.
 */
import { API_BASE, MAP } from './config.js';

const AUTH_KEY = 'ldj.admin.auth';
const root = document.getElementById('admin');
let auth = localStorage.getItem(AUTH_KEY) || null;
let list = [], cats = [], selectedId = null, map = null, marker = null;
// Curator console state.
let curators = [], curSelectedId = null, currentView = 'activities';

// ── api ──────────────────────────────────────────────────────────────────
async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (auth) headers.Authorization = 'Basic ' + auth;
  if (opts.body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers });
  return res;
}
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function toast(msg, isErr) {
  const t = document.createElement('div');
  t.className = 'toast' + (isErr ? ' err' : '');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

// ── login ─────────────────────────────────────────────────────────────────
function renderLogin(errMsg) {
  root.innerHTML = `
  <div class="login">
    <h1>Admin</h1>
    <p>Masuk untuk kelola kegiatan.</p>
    <label>Username</label>
    <input id="lg-user" class="input" autocomplete="username">
    <label>Password</label>
    <input id="lg-pass" class="input" type="password" autocomplete="current-password">
    <div class="err">${errMsg ? esc(errMsg) : ''}</div>
    <button id="lg-btn" class="btn btn-primary" style="width:100%;margin-top:14px;padding:13px">Masuk</button>
  </div>`;
  const submit = async () => {
    const u = document.getElementById('lg-user').value.trim();
    const p = document.getElementById('lg-pass').value;
    auth = btoa(`${u}:${p}`);
    const res = await api('/admin/ping').catch(() => null);
    if (res && res.ok) { localStorage.setItem(AUTH_KEY, auth); boot(); }
    else if (res && res.status === 503) renderLogin('Admin belum diaktifkan di server (set ADMIN_USER & ADMIN_PASS).');
    else { auth = null; renderLogin('Username / password salah.'); }
  };
  document.getElementById('lg-btn').onclick = submit;
  document.getElementById('lg-pass').addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
}

function logout() { localStorage.removeItem(AUTH_KEY); auth = null; renderLogin(); }

// ── tabs (Kegiatan / Kurator) ───────────────────────────────────────────────
function tabsHtml(active) {
  return `<div class="admin-tabs">
    <button id="tab-act" class="tab${active === 'activities' ? ' active' : ''}">🎫 Kegiatan</button>
    <button id="tab-cur" class="tab${active === 'curators' ? ' active' : ''}">✨ Kurator</button>
  </div>`;
}
function wireTabs() {
  const a = document.getElementById('tab-act'), c = document.getElementById('tab-cur');
  if (a) a.onclick = () => { currentView = 'activities'; renderShell(); renderList(); };
  if (c) c.onclick = () => { currentView = 'curators'; renderCuratorShell(); renderCuratorList(); };
}

// ── app shell ──────────────────────────────────────────────────────────────
function renderShell() {
  const catBoxes = cats.map(c => `<label><input type="checkbox" name="cat" value="${c.slug}">${esc(c.label)}</label>`).join('');
  const dayNames = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
  const dayBoxes = dayNames.map((d, i) => `<label>${d}<input type="checkbox" name="dow" value="${i}"></label>`).join('');
  root.innerHTML = `
  <div class="admin-shell">
    <div class="admin-bar">
      <div class="brand"><span class="logo">+</span><span class="title">Admin · Internacia Jakarta</span></div>
      ${tabsHtml('activities')}
      <div style="display:flex;align-items:center;gap:12px">
        <a class="btn btn-pill" style="padding:8px 14px;font-size:13px;text-decoration:none" href="./index.html" target="_blank">Lihat situs ↗</a>
        <button id="logout" class="btn btn-ghost" style="font-size:13px">Keluar</button>
      </div>
    </div>
    <div class="layout">
      <div class="list-card">
        <div class="lc-head"><h2>Kegiatan (<span id="ev-count">0</span>)</h2>
          <button id="new-btn" class="btn btn-primary" style="padding:7px 14px;font-size:13px">＋ Baru</button></div>
        <div id="ev-list"></div>
      </div>
      <div class="form-card">
        <h2 id="form-title">Kegiatan baru</h2>
        <div class="grid3">
          <div class="fld"><label>ID (slug)</label><input id="f-id" class="input" placeholder="cth. prj"><div class="hint">huruf kecil/angka/strip</div></div>
          <div class="fld"><label>Emoji</label><input id="f-emoji" class="input" placeholder="🎡"></div>
          <div class="fld"><label>Warna</label><input id="f-color" class="input" type="color" value="#F15A22" style="height:42px;padding:4px"></div>
        </div>
        <div class="fld"><label>Nama</label><input id="f-nama" class="input"></div>
        <div class="fld"><label>Penyelenggara</label><input id="f-penyelenggara" class="input"></div>
        <div class="fld"><label>Deskripsi</label><textarea id="f-deskripsi" class="ta"></textarea></div>

        <div class="fld"><label>Kategori</label><div class="cat-grid" id="cat-grid">${catBoxes}</div></div>

        <div class="grid2">
          <div class="fld"><label>Usia min</label><input id="f-usia_min" class="input" type="number" value="6"></div>
          <div class="fld"><label>Usia max</label><input id="f-usia_max" class="input" type="number" value="99"></div>
        </div>

        <div class="fld"><label>Lokasi (klik di peta untuk set titik)</label><div id="admin-map"></div>
          <div class="grid2" style="margin-top:8px">
            <input id="f-lat" class="input" placeholder="lat" readonly>
            <input id="f-lng" class="input" placeholder="lng" readonly>
          </div>
        </div>
        <div class="grid2">
          <div class="fld"><label>Nama lokasi</label><input id="f-lokasiNama" class="input" placeholder="JIExpo Kemayoran, Jakarta Pusat"></div>
          <div class="fld"><label>Area</label><input id="f-area" class="input" placeholder="Jakarta Pusat"></div>
        </div>

        <div class="grid2">
          <div class="fld"><label>Tanggal (teks tampilan)</label><input id="f-tanggal" class="input" placeholder="12 Juni–14 Juli 2026"></div>
          <div class="fld"><label>Jam</label><input id="f-jam" class="input" placeholder="15.30–23.00 WIB"><div class="hint">format HH.MM–HH.MM</div></div>
        </div>
        <div class="grid2">
          <div class="fld"><label>Biaya</label><input id="f-biaya" class="input" placeholder="gratis / 50.000"></div>
          <div class="fld"><label>Kontak WA</label><input id="f-kontak" class="input" placeholder="0811-2026-700"></div>
        </div>
        <div class="fld"><label>Link</label><input id="f-link" class="input" placeholder="https://jakarta.go.id"></div>

        <div class="fld"><label>Hari berlaku</label><div class="days" id="days">${dayBoxes}</div></div>
        <div class="grid2">
          <div class="fld"><label>Window mulai</label><input id="f-wmulai" class="input" type="date" value="2026-06-01"></div>
          <div class="fld"><label>Window selesai</label><input id="f-wselesai" class="input" type="date" value="2026-07-31"></div>
        </div>
        <div class="grid2">
          <label style="display:flex;align-items:center;gap:8px;font-weight:700;font-size:14px"><input id="f-perlu_daftar" type="checkbox"> Perlu daftar</label>
          <label style="display:flex;align-items:center;gap:8px;font-weight:700;font-size:14px"><input id="f-rutin" type="checkbox"> Kegiatan rutin</label>
        </div>

        <div class="fld"><label>Tiket — satu per baris: <code>label|harga</code></label>
          <textarea id="f-tiket" class="ta" placeholder="Senin–Jumat|40.000&#10;Sabtu–Minggu & libur|50.000"></textarea></div>
        <div class="fld"><label>Transport — satu per baris</label>
          <textarea id="f-transport" class="ta" placeholder="🚌 TransJakarta — Halte Kemayoran · 600 m"></textarea></div>
        <div class="fld"><label>Sub-acara — heading</label><input id="f-sub-heading" class="input" placeholder="🎬 Film yang diputar"></div>
        <div class="fld"><label>Sub-acara items — satu per baris: <code>nama|meta</code></label>
          <textarea id="f-sub-items" class="ta" placeholder='"Laskar Pelangi"|19.00 · layar utama'></textarea></div>

        <div class="form-actions">
          <button id="save-btn" class="btn btn-primary" style="padding:13px 26px">Simpan</button>
          <button id="del-btn" class="danger" style="display:none">Hapus</button>
        </div>
      </div>
    </div>
  </div>`;

  document.getElementById('logout').onclick = logout;
  document.getElementById('new-btn').onclick = () => { selectedId = null; fillForm(null); renderList(); };
  document.getElementById('save-btn').onclick = save;
  document.getElementById('del-btn').onclick = del;
  wireTabs();
  initMap();
  fillForm(null);
}

// ── map picker ──────────────────────────────────────────────────────────────
function setPoint(lat, lng) {
  document.getElementById('f-lat').value = (+lat).toFixed(5);
  document.getElementById('f-lng').value = (+lng).toFixed(5);
  if (!marker) marker = L.marker([lat, lng]).addTo(map);
  else marker.setLatLng([lat, lng]);
}
function initMap() {
  map = L.map('admin-map', { center: MAP.center, zoom: MAP.zoom, minZoom: MAP.minZoom, maxZoom: MAP.maxZoom });
  L.tileLayer(MAP.tileUrl, { attribution: MAP.attribution, subdomains: MAP.subdomains, maxZoom: MAP.maxZoom }).addTo(map);
  map.on('click', (e) => setPoint(e.latlng.lat, e.latlng.lng));
  setTimeout(() => map.invalidateSize(), 50);
}

// ── form <-> data ───────────────────────────────────────────────────────────
const setVal = (id, v) => { document.getElementById(id).value = v ?? ''; };
const setChk = (id, v) => { document.getElementById(id).checked = !!v; };

function fillForm(a) {
  document.getElementById('form-title').textContent = a ? `Edit: ${a.nama}` : 'Kegiatan baru';
  document.getElementById('del-btn').style.display = a ? 'inline-block' : 'none';
  const idEl = document.getElementById('f-id');
  idEl.readOnly = !!a; idEl.style.opacity = a ? .6 : 1;

  setVal('f-id', a?.id); setVal('f-emoji', a?.emoji || '📍'); document.getElementById('f-color').value = a?.color || '#F15A22';
  setVal('f-nama', a?.nama); setVal('f-penyelenggara', a?.penyelenggara); setVal('f-deskripsi', a?.deskripsi);
  setVal('f-usia_min', a?.usia_min ?? 6); setVal('f-usia_max', a?.usia_max ?? 99);
  setVal('f-lokasiNama', a?.lokasiNama); setVal('f-area', a?.area);
  setVal('f-tanggal', a?.tanggal); setVal('f-jam', a?.jam); setVal('f-biaya', a?.biaya || 'gratis');
  setVal('f-kontak', a?.kontak); setVal('f-link', a?.link);
  setVal('f-wmulai', a?.window?.mulai || '2026-06-01'); setVal('f-wselesai', a?.window?.selesai || '2026-07-31');
  setChk('f-perlu_daftar', a?.perlu_daftar); setChk('f-rutin', a?.rutin);
  setVal('f-tiket', (a?.tiket || []).map(t => `${t[0]}|${t[1]}`).join('\n'));
  setVal('f-transport', (a?.transport || []).join('\n'));
  setVal('f-sub-heading', a?.subAcara?.heading);
  setVal('f-sub-items', (a?.subAcara?.items || []).map(it => `${it.nama}|${it.meta || ''}`).join('\n'));

  document.querySelectorAll('input[name=cat]').forEach(c => { c.checked = (a?.kategori || []).includes(c.value); });
  document.querySelectorAll('input[name=dow]').forEach(c => { c.checked = (a?.hariBerlaku || []).includes(+c.value); });

  // map point
  if (marker) { map.removeLayer(marker); marker = null; }
  if (a && a.lat != null) { setPoint(a.lat, a.lng); map.setView([a.lat, a.lng], 14); }
  else { document.getElementById('f-lat').value = ''; document.getElementById('f-lng').value = ''; map.setView(MAP.center, MAP.zoom); }
  setTimeout(() => map.invalidateSize(), 30);
}

const lines = (id) => document.getElementById(id).value.split('\n').map(s => s.trim()).filter(Boolean);

function readForm() {
  const subItems = lines('f-sub-items').map(l => { const [nama, meta] = l.split('|'); return { nama: (nama || '').trim(), meta: (meta || '').trim() }; });
  const heading = document.getElementById('f-sub-heading').value.trim();
  return {
    id: document.getElementById('f-id').value.trim(),
    nama: document.getElementById('f-nama').value.trim(),
    penyelenggara: document.getElementById('f-penyelenggara').value.trim(),
    emoji: document.getElementById('f-emoji').value.trim() || '📍',
    color: document.getElementById('f-color').value,
    deskripsi: document.getElementById('f-deskripsi').value.trim(),
    kategori: [...document.querySelectorAll('input[name=cat]:checked')].map(c => c.value),
    usia_min: +document.getElementById('f-usia_min').value,
    usia_max: +document.getElementById('f-usia_max').value,
    lokasiNama: document.getElementById('f-lokasiNama').value.trim(),
    area: document.getElementById('f-area').value.trim(),
    tanggal: document.getElementById('f-tanggal').value.trim(),
    jam: document.getElementById('f-jam').value.trim(),
    biaya: document.getElementById('f-biaya').value.trim() || 'gratis',
    kontak: document.getElementById('f-kontak').value.trim(),
    link: document.getElementById('f-link').value.trim(),
    lat: parseFloat(document.getElementById('f-lat').value),
    lng: parseFloat(document.getElementById('f-lng').value),
    hariBerlaku: [...document.querySelectorAll('input[name=dow]:checked')].map(c => +c.value),
    window: { mulai: document.getElementById('f-wmulai').value, selesai: document.getElementById('f-wselesai').value },
    perlu_daftar: document.getElementById('f-perlu_daftar').checked,
    rutin: document.getElementById('f-rutin').checked,
    tiket: lines('f-tiket').map(l => { const [label, harga] = l.split('|'); return [(label || '').trim(), (harga || '').trim()]; }),
    transport: lines('f-transport'),
    subAcara: (heading || subItems.length) ? { heading, items: subItems } : null
  };
}

// ── list ────────────────────────────────────────────────────────────────────
function renderList() {
  const el = document.getElementById('ev-list');
  document.getElementById('ev-count').textContent = list.length;
  el.innerHTML = list.map(a => `
    <div class="ev-row${a.id === selectedId ? ' active' : ''}" data-id="${a.id}">
      <div class="em" style="background:${a.color}1A">${a.emoji}</div>
      <div class="nm"><b>${esc(a.nama)}</b><span>${esc(a.area)} · ${esc(a.id)}</span></div>
    </div>`).join('');
  el.querySelectorAll('.ev-row').forEach(r => r.onclick = () => {
    selectedId = r.dataset.id;
    fillForm(list.find(a => a.id === selectedId));
    renderList();
  });
}

async function loadData() {
  cats = await (await api('/categories')).json();
  list = await (await api(`/activities?_=${Date.now()}`)).json();
  curators = await (await api(`/admin/curators?_=${Date.now()}`)).json();
}

// ── save / delete ──────────────────────────────────────────────────────────
async function save() {
  const payload = readForm();
  if (Number.isNaN(payload.lat) || Number.isNaN(payload.lng)) return toast('Set lokasi dulu (klik peta).', true);
  if (!payload.kategori.length) return toast('Pilih minimal 1 kategori.', true);
  const editing = !!selectedId;
  const res = await api(editing ? `/admin/activities/${selectedId}` : '/admin/activities', {
    method: editing ? 'PUT' : 'POST', body: JSON.stringify(payload)
  });
  if (res.ok) {
    const saved = await res.json();
    toast(editing ? 'Tersimpan.' : 'Kegiatan dibuat.');
    selectedId = saved.id;
    await loadData(); renderList(); fillForm(list.find(a => a.id === selectedId));
  } else if (res.status === 401) { toast('Sesi habis, login lagi.', true); logout(); }
  else { const e = await res.json().catch(() => ({})); toast('Gagal: ' + (e.error || res.status), true); }
}

async function del() {
  if (!selectedId || !confirm(`Hapus "${selectedId}"?`)) return;
  const res = await api(`/admin/activities/${selectedId}`, { method: 'DELETE' });
  if (res.ok) { toast('Dihapus.'); selectedId = null; await loadData(); renderShellAndKeep(); }
  else if (res.status === 401) { toast('Sesi habis, login lagi.', true); logout(); }
  else toast('Gagal hapus.', true);
}
// after delete the form fields exist; just refill empty + list
function renderShellAndKeep() { renderList(); fillForm(null); }

// ── curator console ───────────────────────────────────────────────────────
function renderCuratorShell() {
  root.innerHTML = `
  <div class="admin-shell">
    <div class="admin-bar">
      <div class="brand"><span class="logo">+</span><span class="title">Admin · Internacia Jakarta</span></div>
      ${tabsHtml('curators')}
      <div style="display:flex;align-items:center;gap:12px">
        <a class="btn btn-pill" style="padding:8px 14px;font-size:13px;text-decoration:none" href="./index.html" target="_blank">Lihat situs ↗</a>
        <button id="logout" class="btn btn-ghost" style="font-size:13px">Keluar</button>
      </div>
    </div>
    <div class="layout">
      <div class="list-card">
        <div class="lc-head"><h2>Kurator (<span id="cur-count">0</span>)</h2>
          <button id="cur-new-btn" class="btn btn-primary" style="padding:7px 14px;font-size:13px">＋ Baru</button></div>
        <div id="cur-list"></div>
      </div>
      <div class="form-card">
        <h2 id="cur-form-title">Kurator baru</h2>
        <div class="grid3">
          <div class="fld"><label>ID (slug)</label><input id="cf-id" class="input" placeholder="cth. keluarga-muda"><div class="hint">huruf kecil/angka/strip</div></div>
          <div class="fld"><label>Emoji</label><input id="cf-emoji" class="input" placeholder="👨‍👩‍👧"></div>
          <div class="fld"><label>Warna aksen</label><input id="cf-accent" class="input" type="color" value="#F15A22" style="height:42px;padding:4px"></div>
        </div>
        <div class="fld"><label>Nama</label><input id="cf-nama" class="input" placeholder="Keluarga Muda"></div>
        <div class="fld"><label>Tagline</label><input id="cf-tagline" class="input" placeholder="Seru bareng anak, ramah kantong"></div>
        <div class="fld"><label>Bio</label><textarea id="cf-bio" class="ta" placeholder="Deskripsi singkat persona ini..."></textarea></div>
        <div class="grid2">
          <div class="fld"><label>Urutan tampil</label><input id="cf-sort" class="input" type="number" value="0"><div class="hint">kecil = tampil duluan</div></div>
          <label style="display:flex;align-items:center;gap:8px;font-weight:700;font-size:14px;margin-top:24px"><input id="cf-aktif" type="checkbox" checked> Aktif (tampil di situs)</label>
        </div>
        <div class="fld"><label>Pilihan kegiatan — centang & beri catatan</label>
          <div class="hint" style="margin-bottom:8px">Yang dicentang muncul di kurasi ini, urut sesuai daftar di bawah (pilihan tampil duluan).</div>
          <div id="cf-picks" class="picks"></div>
        </div>
        <div class="form-actions">
          <button id="cur-save-btn" class="btn btn-primary" style="padding:13px 26px">Simpan</button>
          <button id="cur-del-btn" class="danger" style="display:none">Hapus</button>
        </div>
      </div>
    </div>
  </div>`;
  document.getElementById('logout').onclick = logout;
  document.getElementById('cur-new-btn').onclick = () => { curSelectedId = null; fillCuratorForm(null); renderCuratorList(); };
  document.getElementById('cur-save-btn').onclick = saveCurator;
  document.getElementById('cur-del-btn').onclick = delCurator;
  wireTabs();
  fillCuratorForm(null);
}

function renderCuratorList() {
  const el = document.getElementById('cur-list');
  if (!el) return;
  document.getElementById('cur-count').textContent = curators.length;
  el.innerHTML = curators.map(c => `
    <div class="ev-row${c.id === curSelectedId ? ' active' : ''}" data-id="${c.id}">
      <div class="em" style="background:${(c.accent || '#F15A22')}1A">${c.emoji || '⭐'}</div>
      <div class="nm"><b>${esc(c.nama)}${c.aktif ? '' : ' <span style="color:#9CA3AF;font-weight:700">(nonaktif)</span>'}</b><span>${c.pickCount} kegiatan · ${esc(c.id)}</span></div>
    </div>`).join('');
  el.querySelectorAll('.ev-row').forEach(r => r.onclick = () => {
    curSelectedId = r.dataset.id;
    fillCuratorForm(curators.find(c => c.id === curSelectedId));
    renderCuratorList();
  });
}

// Build the picks editor: picked activities first (in saved order), then the rest.
function renderPicks(c) {
  const pickMap = new Map((c?.picks || []).map((p, i) => [p.id, { blurb: p.blurb || '', i }]));
  const picked = (c?.picks || []).map(p => list.find(a => a.id === p.id)).filter(Boolean);
  const rest = list.filter(a => !pickMap.has(a.id));
  const rows = [...picked, ...rest].map(a => {
    const on = pickMap.has(a.id);
    const blurb = pickMap.get(a.id)?.blurb || '';
    return `<label class="pick-row${on ? ' on' : ''}" data-id="${a.id}">
      <input type="checkbox" class="pk-on" ${on ? 'checked' : ''}>
      <span class="pk-em" style="background:${a.color}1A">${a.emoji}</span>
      <span class="pk-nm"><b>${esc(a.nama)}</b><small>${esc(a.area)}</small></span>
      <input type="text" class="pk-blurb input" placeholder="catatan kurator (opsional)" value="${esc(blurb)}">
    </label>`;
  }).join('');
  const box = document.getElementById('cf-picks');
  box.innerHTML = rows;
  // toggle .on styling live
  box.querySelectorAll('.pick-row').forEach(r => {
    const cb = r.querySelector('.pk-on');
    cb.onchange = () => r.classList.toggle('on', cb.checked);
  });
}

function fillCuratorForm(c) {
  document.getElementById('cur-form-title').textContent = c ? `Edit: ${c.nama}` : 'Kurator baru';
  document.getElementById('cur-del-btn').style.display = c ? 'inline-block' : 'none';
  const idEl = document.getElementById('cf-id');
  idEl.readOnly = !!c; idEl.style.opacity = c ? .6 : 1;
  setVal('cf-id', c?.id); setVal('cf-emoji', c?.emoji || '⭐'); setVal('cf-nama', c?.nama);
  setVal('cf-tagline', c?.tagline); setVal('cf-bio', c?.bio); setVal('cf-sort', c?.sortOrder ?? 0);
  document.getElementById('cf-accent').value = c?.accent || '#F15A22';
  document.getElementById('cf-aktif').checked = c ? !!c.aktif : true;
  renderPicks(c);
}

function readCuratorForm() {
  const picks = [...document.querySelectorAll('#cf-picks .pick-row')]
    .filter(r => r.querySelector('.pk-on').checked)
    .map(r => ({ id: r.dataset.id, blurb: r.querySelector('.pk-blurb').value.trim() }));
  return {
    id: document.getElementById('cf-id').value.trim(),
    nama: document.getElementById('cf-nama').value.trim(),
    tagline: document.getElementById('cf-tagline').value.trim(),
    emoji: document.getElementById('cf-emoji').value.trim() || '⭐',
    accent: document.getElementById('cf-accent').value,
    bio: document.getElementById('cf-bio').value.trim(),
    sortOrder: +document.getElementById('cf-sort').value || 0,
    aktif: document.getElementById('cf-aktif').checked,
    picks
  };
}

async function saveCurator() {
  const payload = readCuratorForm();
  if (!payload.nama) return toast('Nama wajib diisi.', true);
  if (!payload.id) return toast('ID (slug) wajib diisi.', true);
  const editing = !!curSelectedId;
  const res = await api(editing ? `/admin/curators/${curSelectedId}` : '/admin/curators', {
    method: editing ? 'PUT' : 'POST', body: JSON.stringify(payload)
  });
  if (res.ok) {
    const saved = await res.json();
    toast(editing ? 'Tersimpan.' : 'Kurator dibuat.');
    curSelectedId = saved.id;
    await loadData(); renderCuratorList(); fillCuratorForm(curators.find(c => c.id === curSelectedId));
  } else if (res.status === 401) { toast('Sesi habis, login lagi.', true); logout(); }
  else { const e = await res.json().catch(() => ({})); toast('Gagal: ' + (e.error || res.status), true); }
}

async function delCurator() {
  if (!curSelectedId || !confirm(`Hapus kurator "${curSelectedId}"?`)) return;
  const res = await api(`/admin/curators/${curSelectedId}`, { method: 'DELETE' });
  if (res.ok) { toast('Dihapus.'); curSelectedId = null; await loadData(); renderCuratorList(); fillCuratorForm(null); }
  else if (res.status === 401) { toast('Sesi habis, login lagi.', true); logout(); }
  else toast('Gagal hapus.', true);
}

// ── boot ────────────────────────────────────────────────────────────────────
async function boot() {
  if (!auth) return renderLogin();
  const ping = await api('/admin/ping').catch(() => null);
  if (!ping || !ping.ok) { return renderLogin(ping && ping.status === 503 ? 'Admin belum diaktifkan di server.' : 'Sesi tidak valid, login lagi.'); }
  renderShell();
  await loadData();
  renderList();
}
boot();
