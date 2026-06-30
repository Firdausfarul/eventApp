/*
 * app.js — State, rendering, and event wiring for "Liburan di Jakarta".
 *
 * Architecture: a single source-of-truth `state` object + a `render()` that
 * rebuilds #app from scratch on every change (the dataset is tiny, so this is
 * simple and fast). Handlers are exposed on the global `App` and referenced via
 * inline onclick="App.x(...)" in the generated markup. Text inputs keep focus
 * across re-renders via _activeInput tracking.
 *
 * Layout strategy: ONE responsive DOM. Wide screens get the desktop split +
 * top header; ≤760px CSS reveals the bottom nav, the list/map toggle, and turns
 * drawers/modals into bottom sheets — faithfully covering both .dc.html mockups.
 */
import {
  RAW, AGEGROUPS, INTERESTS, CATPALETTE, MONTH_NAMES, HARI_NAMES, hydrateActivities
} from './data.js';
import { MAP, API_BASE } from './config.js';
import {
  filtered, planComputed, planExports, calendarModel,
  biayaLabelOf, usiaLabelOf, catLabelOf, fmtMin, fmtDur, fmtRp,
  SUB, EXTRA
} from './logic.js';

const STORAGE_KEY = 'ldj.v1';

const DEFAULT_STATE = {
  screen: 'landing', step: 1,
  ageGroup: 'all', interests: [], location: '',
  filterOpen: false, selectedId: null, detailId: null, query: '',
  plan: [], planOpen: false, when: 'all', calMonth: 5, calDay: null,
  viewMode: 'list', // mobile list/map toggle
  curatorId: null,  // active curator "persona" filter (transient)
  cardStyle: 'Detailed', heroStyle: 'Bold'
};

// Curator personas fetched from GET /curators (handpicked activity ids + blurbs).
let curators = [];

let state = loadState();
let _activeInput = null; // { id, pos } to restore caret after re-render

// ── persistence (PRD §3.3) ─────────────────────────────────────────────
function loadState() {
  const s = { ...DEFAULT_STATE };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    // Only persist durable preferences, never transient UI flags.
    ['ageGroup', 'interests', 'location', 'plan', 'when', 'cardStyle', 'heroStyle'].forEach(k => {
      if (saved[k] !== undefined) s[k] = saved[k];
    });
  } catch (e) { /* ignore corrupt storage */ }
  return s;
}
function persist() {
  try {
    const { ageGroup, interests, location, plan, when, cardStyle, heroStyle } = state;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ageGroup, interests, location, plan, when, cardStyle, heroStyle }));
  } catch (e) { /* storage may be unavailable */ }
}

// ── helpers ─────────────────────────────────────────────────────────────
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const toTop = () => { try { window.scrollTo({ top: 0, behavior: 'auto' }); } catch (e) {} };

// Inline line-icons (square caps echo the +Jakarta geometric system). Sized in
// `em` so they inherit the surrounding font-size; styled via the .ico class.
const ICONS = {
  pin:      '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="2.4"/>',
  user:     '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  calendar: '<rect x="3" y="4" width="18" height="18"/><path d="M3 9h18M8 2v4M16 2v4"/>',
  clock:    '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  ticket:   '<path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v1.5a2.5 2.5 0 0 0 0 5V16a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1.5a2.5 2.5 0 0 0 0-5Z"/>',
  transit:  '<rect x="5" y="3" width="14" height="13"/><path d="M5 11h14M9 20l-2 2M15 20l2 2"/>',
  repeat:   '<path d="M17 2l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3"/>',
  info:     '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  home:     '<path d="M3 10l9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/>',
  compass:  '<circle cx="12" cy="12" r="9"/><path d="M16 8l-2.5 5.5L8 16l2.5-5.5Z"/>',
  plan:     '<rect x="3" y="4" width="18" height="18"/><path d="M3 9h18M8 2v4M16 2v4M9 15l2 2 4-4"/>',
  chat:     '<path d="M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2Z"/>',
  list:     '<path d="M8 6h13M8 12h13M8 18h13M3 6h.5M3 12h.5M3 18h.5"/>',
  map:      '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2ZM9 4v14M15 6v14"/>',
  spark:    '<path d="M12 3l1.8 6.2L20 11l-6.2 1.8L12 19l-1.8-6.2L4 11l6.2-1.8Z"/>',
  search:   '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  filter:   '<path d="M3 5h18l-7 8v6l-4-2v-4Z"/>',
  tag:      '<path d="M3 3h8l10 10-8 8L3 11Z"/><circle cx="7.5" cy="7.5" r="1.4"/>'
};
const ic = (n) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ''}</svg>`;

function setState(patch) {
  Object.assign(state, patch);
  persist();
  render();
}

// ── state transitions (ported from DCLogic) ─────────────────────────────
const App = {
  go(screen) { setState({ screen, filterOpen: false, planOpen: false }); toTop(); },
  startWizard() { setState({ screen: 'wizard', step: 1, filterOpen: false }); toTop(); },
  backHome() { App.go('landing'); },
  goHasil() { App.go('hasil'); },
  goKalender() { setState({ screen: 'kalender', planOpen: false, filterOpen: false }); toTop(); },
  goRencana() { setState({ screen: 'hasil', planOpen: true, filterOpen: false }); toTop(); },
  // tap a category pill on the landing → jump to results pre-filtered to it
  exploreCat(label) { setState({ screen: 'hasil', query: label, curatorId: null, filterOpen: false, planOpen: false }); toTop(); },

  onLoc(v) { setState({ location: v }); },
  useMyLoc() { setState({ location: 'Menteng, Jakarta Pusat' }); },
  setAgeGroup(key) { setState({ ageGroup: key }); },
  toggleInterest(label) {
    const arr = state.interests.includes(label) ? state.interests.filter(x => x !== label) : [...state.interests, label];
    setState({ interests: arr });
  },

  onBack() { if (state.step > 1) { setState({ step: state.step - 1 }); toTop(); } },
  onNext() { if (state.step < 3) { setState({ step: state.step + 1 }); toTop(); } else App.go('hasil'); },

  openFilter() { setState({ filterOpen: true }); },
  closeFilter() { setState({ filterOpen: false }); },
  resetFilter() { setState({ ageGroup: 'all', interests: [], location: '' }); },

  togglePlan(id) {
    const plan = state.plan.includes(id) ? state.plan.filter(x => x !== id) : [...state.plan, id];
    setState({ plan });
  },
  removeFromPlan(id) { setState({ plan: state.plan.filter(x => x !== id) }); },
  setWhen(w) { setState({ when: w }); },
  openPlan() { setState({ planOpen: true }); },
  closePlan() { setState({ planOpen: false }); },

  setMonth(m) { setState({ calMonth: Math.min(6, Math.max(5, m)), calDay: null }); },
  selectDay(ds) { setState({ calDay: ds }); },

  selectProgram(id) { setState({ selectedId: id }); },
  clearSelected() { setState({ selectedId: null }); },
  openDetail(id) { setState({ detailId: id }); },
  closeDetail() { setState({ detailId: null }); },
  flyTo(id) { setState({ detailId: null, selectedId: id, viewMode: 'map' }); },
  onSearch(v) { setState({ query: v }); },
  clearQuery() { setState({ query: '' }); },
  setView(v) { setState({ viewMode: v }); },

  // curator personas: pick one → results show that curator's handpicked set.
  selectCurator(id) {
    const next = state.curatorId === id ? null : id; // tap again to clear
    setState({ screen: 'hasil', curatorId: next, selectedId: null, filterOpen: false, planOpen: false });
    toTop();
  },
  clearCurator() { setState({ curatorId: null, selectedId: null }); },

  // input handlers that preserve caret
  _input(el) { _activeInput = { id: el.id, pos: el.selectionStart }; },
};
window.App = App;

// ── small render utilities ──────────────────────────────────────────────
function chip(label, emoji, active, onclick) {
  return `<button class="chip${active ? ' active' : ''}" onclick="${onclick}"><span style="font-size:16px">${emoji}</span><span>${esc(label)}</span></button>`;
}

function programModel(p) {
  return {
    ...p,
    catLabel: catLabelOf(p),
    usiaLabel: usiaLabelOf(p),
    biayaLabel: biayaLabelOf(p),
    daftarLabel: (EXTRA[p.id] || {}).daftar ? 'Perlu daftar' : 'Walk-in',
    transportMain: (EXTRA[p.id] || {}).transport?.[0] || 'Cek lokasi di peta',
    inPlan: state.plan.includes(p.id),
    selected: state.selectedId === p.id,
    hasSub: !!SUB[p.id],
    subHint: SUB[p.id] ? (SUB[p.id].items.length + ' acara di dalamnya') : '',
    blurb: p.blurb || '' // curator's personal note (only set in curator view)
  };
}

// ── card renderers ──────────────────────────────────────────────────────
function detailedCard(p) {
  const m = programModel(p);
  return `
  <div class="card${m.selected ? ' sel' : ''}" style="--cat:${p.color};border-left:5px solid ${p.color}" onclick="App.openDetail('${p.id}')">
    ${m.blurb ? `<div class="curator-note">“${esc(m.blurb)}”</div>` : ''}
    <div class="card-top">
      <span class="badge" style="color:${p.color};background:${p.color}1A">${m.catLabel}</span>
      <span class="price">${m.biayaLabel}</span>
    </div>
    <h3>${esc(p.nama)}</h3>
    <div class="org">${esc(p.penyelenggara)}</div>
    <p class="desc">${esc(p.deskripsi)}</p>
    <div class="meta">
      <div class="row"><span class="ic">${ic('pin')}</span>${esc(p.lokasiNama)}</div>
      <div class="row"><span class="ic">${ic('user')}</span>${m.usiaLabel}</div>
      <div class="row"><span class="ic">${ic('calendar')}</span>${esc(p.tanggal)} · ${ic('clock')} ${esc(p.jam)}</div>
      <div class="row"><span class="ic">${ic('ticket')}</span>${m.daftarLabel}</div>
      ${m.hasSub ? `<div class="row sub"><span class="ic">🎬</span>${m.subHint}</div>` : ''}
    </div>
    <div class="transport"><span style="font-size:13px">${ic('transit')}</span><span>${esc(m.transportMain)}</span></div>
    <div class="card-actions">
      <button class="plan-btn${m.inPlan ? ' in' : ''}" onclick="event.stopPropagation();App.togglePlan('${p.id}')">${m.inPlan ? '✓ Di rencana' : '＋ Rencana'}</button>
      <button class="fly-btn" title="Lihat di Peta" onclick="event.stopPropagation();App.flyTo('${p.id}')">${ic('pin')}</button>
      <button class="detail-btn" onclick="event.stopPropagation();App.openDetail('${p.id}')">Detail</button>
    </div>
  </div>`;
}

function compactCard(p) {
  const m = programModel(p);
  return `
  <div class="compact${m.selected ? ' sel' : ''}" onclick="App.openDetail('${p.id}')">
    <div class="cicon" style="background:${p.color}18;border-right:1px solid ${p.color}22"><span>${p.emoji}</span></div>
    <div class="cbody">
      <div style="display:flex;align-items:center;gap:7px;margin-bottom:4px">
        <span class="badge" style="color:${p.color};background:${p.color}1A">${m.catLabel}</span>
        <span style="font-size:11.5px;font-weight:800;color:var(--green)">${m.biayaLabel}</span>
      </div>
      <h3>${esc(p.nama)}</h3>
      <div class="cmeta">${ic('pin')} ${esc(p.area)} · ${m.usiaLabel}</div>
      ${m.blurb ? `<div class="curator-note compact">“${esc(m.blurb)}”</div>` : ''}
    </div>
    <button class="plan-mini${m.inPlan ? ' in' : ''}" title="Tambah ke rencana" onclick="event.stopPropagation();App.togglePlan('${p.id}')">${m.inPlan ? '✓' : '＋'}</button>
  </div>`;
}

// ── curator personas ──────────────────────────────────────────────────────
const findCurator = (id) => curators.find(c => c.id === id) || null;

// Resolve a curator's picks into full program objects (in the curator's order),
// each carrying the curator's per-pick `blurb`. Unknown ids are skipped.
function curatorPrograms(cur) {
  return cur.picks
    .map(pk => { const a = RAW.find(x => x.id === pk.id); return a ? { ...a, blurb: pk.blurb } : null; })
    .filter(Boolean);
}

// Horizontal shelf of persona cards. `activeId` highlights the current selection.
function curatorShelf(activeId) {
  if (!curators.length) return '';
  const cards = curators.map(c => `
    <button class="cur-card${c.id === activeId ? ' active' : ''}" style="--accent:${c.accent || '#FC351C'}" onclick="App.selectCurator('${c.id}')">
      <span class="cur-emoji">${c.emoji || '⭐'}</span>
      <span class="cur-text">
        <span class="cur-name">${esc(c.nama)}</span>
        <span class="cur-tag">${esc(c.tagline || '')}</span>
      </span>
      <span class="cur-count">${c.pickCount}</span>
    </button>`).join('');
  return `
  <div class="cur-shelf">
    <div class="cur-shelf-head"><span>${ic('spark')} Kurasi pilihan</span><span class="cur-sub">Dipilihkan buat kamu</span></div>
    <div class="cur-row">${cards}</div>
  </div>`;
}

// ── Leaflet map (kept alive across full re-renders) ─────────────────────
// The map element is created once and detached/re-attached around each render so
// the Leaflet instance (and its zoom/pan) survives `innerHTML` rebuilds.
let mapEl = null, map = null, markerLayer = null, _lastSelected = undefined;
const mapStash = (() => { const d = document.createElement('div'); d.style.display = 'none'; document.body.appendChild(d); return d; })();

function ensureMapEl() {
  if (!mapEl) { mapEl = document.createElement('div'); mapEl.id = 'ldj-map'; }
  return mapEl;
}

function markerIcon(p, selected) {
  const cls = 'marker' + (selected ? ' sel' : '');
  const style = `background:${p.color}` + (selected ? ';animation:ldj-pulse 1.6s infinite' : '');
  return L.divIcon({
    className: '', // wrapper has no class so our box-model isn't overridden
    html: `<button class="${cls}" title="${esc(p.nama)}" style="${style}"><span>${p.emoji}</span></button>`,
    iconSize: [34, 34], iconAnchor: [17, 34]
  });
}

function refreshMarkers(programs) {
  markerLayer.clearLayers();
  programs.forEach(p => {
    if (p.lat == null) return;
    const m = L.marker([p.lat, p.lng], { icon: markerIcon(p, p.id === state.selectedId), zIndexOffset: p.id === state.selectedId ? 1000 : 0 });
    m.on('click', () => App.selectProgram(p.id));
    m.addTo(markerLayer);
  });
}

// Insert the persistent map element into #map-slot, lazily creating the Leaflet
// instance, then sync markers + selection.
function mountMap(programs, sel) {
  const slot = document.getElementById('map-slot');
  if (!slot) return;
  const el = ensureMapEl();
  slot.appendChild(el);

  if (!map) {
    map = L.map(el, { center: MAP.center, zoom: MAP.zoom, minZoom: MAP.minZoom, maxZoom: MAP.maxZoom, zoomControl: true });
    L.tileLayer(MAP.tileUrl, { attribution: MAP.attribution, subdomains: MAP.subdomains, maxZoom: MAP.maxZoom }).addTo(map);
    markerLayer = L.layerGroup().addTo(map);
  }
  refreshMarkers(programs);
  map.invalidateSize(false);
  // Re-measure after the (flex) layout settles — mobile map view sizes via flex,
  // so the first measure can be a frame early.
  requestAnimationFrame(() => { try { map.invalidateSize(false); } catch (e) {} });

  // Fly only when the selection actually changed (avoid re-animating each render).
  if (sel && sel.id !== _lastSelected) map.flyTo([sel.lat, sel.lng], MAP.flyToZoom, { duration: .9 });
  else if (!sel && _lastSelected) map.flyTo(MAP.center, MAP.zoom, { duration: .7 });
  _lastSelected = sel ? sel.id : null;
}

// ── screens ─────────────────────────────────────────────────────────────
function landing() {
  const pills = CATPALETTE.map(([label, emoji]) =>
    `<button class="cat-pill" onclick="App.exploreCat('${label}')"><span>${emoji}</span><span>${label}</span></button>`).join('');
  const feat = [...RAW].sort((a, b) => (a.biaya === 'gratis' ? 0 : 1) - (b.biaya === 'gratis' ? 0 : 1)).slice(0, 4);
  const featCards = feat.map(compactCard).join('');
  return `
  <div class="screen">
    <header class="app-header mobile-only">
      <button class="brand" onclick="App.backHome()"><span class="logo">+</span><span class="title">Internacia Jakarta</span></button>
      <button class="btn btn-ghost" style="padding:6px 4px;font-size:13px" onclick="App.goKalender()"><span style="font-size:16px">${ic('calendar')}</span></button>
    </header>
    <header class="app-header desktop-only">
      <button class="brand" onclick="App.backHome()">
        <span class="logo">+</span>
        <span><span class="title">Internacia Jakarta</span><br><span class="sub">Kegiatan seru, gratis &amp; murah</span></span>
      </button>
      <div class="header-actions">
        <button class="btn btn-ghost" onclick="App.goKalender()"><span style="font-size:16px">${ic('calendar')}</span> Kalender</button>
        <button class="btn btn-pill" style="padding:10px 20px" onclick="App.startWizard()">Mulai →</button>
      </div>
    </header>
    <section class="hero">
      <div class="hero-bg"></div>
      <div class="hero-inner">
        <div class="eyebrow"><span class="dot"></span>Libur sekolah · Juni–Juli 2026</div>
        <h1>Libur sekolah,<br><span class="grad">mau ke mana?</span></h1>
        <p>Festival, museum, lari pagi di GBK, sampai nonton bareng — kegiatan gratis &amp; murah dari Pemprov DKI &amp; komunitas. Tinggal pilih, susun jadwal harian, kirim ke WhatsApp.</p>
        <div class="hero-cta">
          <button class="btn btn-primary" onclick="App.startWizard()">Mulai Cari Kegiatan</button>
          <button class="btn btn-outline" onclick="App.goHasil()">Lihat Semua →</button>
        </div>
      </div>
      <div class="cat-pills">${pills}</div>
    </section>
    <div class="pola-band" aria-hidden="true"></div>
    <section class="landing-feat">
      <div class="lf-inner">
        <div class="lf-head">
          <h2>Lagi seru bulan ini</h2>
          <button class="btn btn-ghost" style="padding:6px 0;font-size:14px" onclick="App.goHasil()">Lihat semua →</button>
        </div>
        <div class="feat-list">${featCards}</div>
      </div>
    </section>
    ${curators.length ? `<section class="landing-curators">
      <div class="lc-inner">
        <h2>Bingung mulai dari mana?</h2>
        <p>Pilih tipe yang paling mirip kamu — kegiatannya udah dipilihin, tinggal ikut.</p>
        ${curatorShelf(null)}
      </div>
    </section>` : ''}
    <div class="pola-band" aria-hidden="true"></div>
    <footer class="app-footer">
      <span>Jadwal dapat berubah — cek langsung ke penyelenggara.</span>
      <span class="cc">Aksesibilitas: Jakarta Call Center <b>1500-177</b></span>
    </footer>
  </div>`;
}

function wizard() {
  const pct = Math.round(state.step / 3 * 100);
  let body = '';
  if (state.step === 1) {
    const cards = AGEGROUPS.map(([key, label, emoji, sub]) => `
      <button class="age-card${state.ageGroup === key ? ' active' : ''}" onclick="App.setAgeGroup('${key}')">
        <span class="emoji">${emoji}</span>
        <span style="display:flex;flex-direction:column;line-height:1.25"><span class="name">${label}</span><span class="sub">${sub}</span></span>
      </button>`).join('');
    body = `<div class="kicker">Langkah 1</div><h2>Kamu di kelompok usia mana?</h2>
      <p class="lead">Opsional — cuma biar sarannya pas. Pilih <strong>Semua umur</strong> kalau mau lihat semuanya.</p>
      <div class="age-grid">${cards}</div>`;
  } else if (state.step === 2) {
    const chips = INTERESTS.map(([label, emoji]) => chip(label, emoji, state.interests.includes(label), `App.toggleInterest('${label.replace(/'/g, "\\'")}')`)).join('');
    body = `<div class="kicker">Langkah 2</div><h2>Kamu suka kegiatan apa?</h2>
      <p class="lead">Pilih semua yang kamu suka — bebas berapa pun. Lewati kalau mau lihat semua.</p>
      <div class="chip-wrap">${chips}</div>`;
  } else {
    body = `<div class="kicker">Langkah 3</div><h2>Di mana kamu biasa nongkrong?</h2>
      <p class="lead">Ketik kecamatan, kelurahan, atau kode pos di Jakarta.</p>
      <div class="field"><span class="lead-icon">${ic('pin')}</span>
        <input id="wiz-loc" class="input" type="text" value="${esc(state.location)}" placeholder="cth. Menteng, Cikini, 10310..." oninput="App._input(this);App.onLoc(this.value)">
      </div>
      <button class="geo-btn" onclick="App.useMyLoc()"><span style="font-size:17px">${ic('compass')}</span>Gunakan Lokasi Saya</button>
      ${state.location ? `<div class="loc-ok"><span>✓</span>Lokasi: ${esc(state.location)}</div>` : ''}
      <div class="privacy">Tenang, lokasimu hanya dipakai untuk mengurutkan kegiatan terdekat — tidak disimpan.</div>`;
  }
  return `
  <div class="wiz-shell">
    <div class="wiz-inner">
      <div class="wiz-top">
        <button class="btn btn-ghost" style="padding:6px 0" onclick="App.backHome()">← Beranda</button>
        <div class="step">Pertanyaan ${state.step} dari 3 — ${pct}%</div>
      </div>
      <div class="progress"><div style="width:${pct}%"></div></div>
      <div class="wiz-card">${body}</div>
      <div class="wiz-nav">
        <button class="back" ${state.step === 1 ? 'disabled' : ''} onclick="App.onBack()">← Kembali</button>
        <button class="btn btn-primary next" onclick="App.onNext()">${state.step < 3 ? 'Lanjut' : 'Lihat Kegiatan ' + ic('spark')}</button>
      </div>
    </div>
  </div>`;
}

function hasil() {
  const curator = state.curatorId ? findCurator(state.curatorId) : null;
  const programs = curator ? curatorPrograms(curator) : filtered(state);
  const sel = programs.find(p => p.id === state.selectedId) || null;
  const plan = planComputed(state);
  const whenOpts = [['all', 'Kapan aja'], ['today', 'Hari ini'], ['tomorrow', 'Besok'], ['weekend', 'Akhir pekan']];
  const whenChips = whenOpts.map(([k, l]) =>
    `<button class="chip${state.when === k ? ' active' : ''}" onclick="App.setWhen('${k}')">${l}</button>`).join('');

  const cardsHtml = programs.length
    ? programs.map(p => state.cardStyle === 'Compact' ? compactCard(p) : detailedCard(p)).join('')
    : `<div class="empty"><div class="big">${ic('search')}</div><div class="t">Belum ada yang cocok</div>
        <div style="font-size:14px;margin-bottom:16px">Coba kata kunci lain, ganti kelompok usia, atau pilih minat lain di Filter.</div>
        <button class="btn btn-primary" style="padding:11px 24px;font-size:14px" onclick="App.openFilter()">Buka Filter</button></div>`;

  return `
  <div class="screen">
    <header class="app-header desktop-only">
      <button class="brand" onclick="App.backHome()"><span class="logo">+</span><span class="title">Internacia Jakarta</span></button>
      <div class="header-actions">
        <button class="btn btn-pill" style="padding:9px 16px;font-size:13px" onclick="App.goKalender()"><span style="font-size:15px">${ic('calendar')}</span> Kalender</button>
        <button class="btn btn-pill" style="padding:9px 16px;font-size:13px" onclick="App.startWizard()">Ubah pencarian</button>
        <button class="btn btn-pill" style="padding:9px 16px;font-size:13px" onclick="App.openPlan()"><span style="font-size:15px">${ic('plan')}</span> Rencana (${plan.events.length})</button>
        <button class="btn btn-primary" style="padding:9px 18px;font-size:13px;box-shadow:none" onclick="App.openFilter()"><span style="font-size:15px">${ic('filter')}</span> Filter</button>
      </div>
    </header>

    <div class="results" data-view="${state.viewMode}">
      <div class="result-map">
        <div id="map-slot"></div>
        <div class="map-legend"><span class="dot"></span>Peta Jakarta · ${programs.length} lokasi</div>
        ${sel ? `<button class="map-zoomout" onclick="App.clearSelected()">Perkecil peta</button>` : ''}
      </div>

      <div class="result-list">
        ${curator ? `
        <div class="cur-banner" style="--accent:${curator.accent || '#FC351C'}">
          <span class="cb-emoji">${curator.emoji || '⭐'}</span>
          <div class="cb-text">
            <div class="cb-name">Kurasi ${esc(curator.nama)}</div>
            ${curator.bio ? `<div class="cb-bio">${esc(curator.bio)}</div>` : ''}
          </div>
          <button class="cb-clear" onclick="App.clearCurator()">✕ Semua kegiatan</button>
        </div>
        ` : `
        <div>
          <h1>Kegiatan Untukmu</h1>
          <p class="count"><b>${programs.length}</b> kegiatan ditemukan${state.location ? ' di sekitar ' + esc(state.location.split(',')[0]) : ''}</p>
        </div>`}
        <div class="view-toggle mobile-only">
          <button class="${state.viewMode === 'list' ? 'active' : ''}" onclick="App.setView('list')">${ic('list')} Daftar</button>
          <button class="${state.viewMode === 'map' ? 'active' : ''}" onclick="App.setView('map')">${ic('map')} Peta</button>
        </div>
        ${curatorShelf(state.curatorId)}
        ${curator ? '' : `
        <div class="when-row">${whenChips}</div>
        <div class="search">
          <span class="lead-icon">${ic('search')}</span>
          <input id="hasil-search" type="text" value="${esc(state.query)}" placeholder="Cari kegiatan, penyelenggara, lokasi..." oninput="App._input(this);App.onSearch(this.value)">
          ${state.query ? `<button class="clear" onclick="App.clearQuery()">✕</button>` : ''}
        </div>`}
        <div class="cards">
          ${cardsHtml}
          <div class="disclaimer"><strong>Catatan:</strong> Jadwal dapat berubah — selalu konfirmasi ke penyelenggara sebelum datang. Bantuan aksesibilitas: <strong>1500-177</strong>.</div>
        </div>
      </div>
    </div>
  </div>`;
}

function kalender() {
  const cal = calendarModel(state);
  const headDays = ['MIN', 'SEN', 'SEL', 'RAB', 'KAM', 'JUM', 'SAB']
    .map((d, i) => `<div class="${i === 0 || i === 6 ? 'we' : ''}">${d}</div>`).join('');
  const cells = cal.cells.map(c => {
    if (c.blank) return `<div class="cal-cell"></div>`;
    const dots = c.colors.map(col => `<span style="background:${col}"></span>`).join('');
    return `<div class="cal-cell"><button class="${c.hasEvents ? 'has' : ''}${c.selected ? ' sel' : ''}" onclick="App.selectDay('${c.ds}')">
      <span class="num">${c.day}</span>${c.hasEvents ? `<div class="dots">${dots}</div>` : ''}</button></div>`;
  }).join('');

  const selLabel = HARI_NAMES[cal.selDateObj.getDay()] + ', ' + cal.selDateObj.getDate() + ' ' + MONTH_NAMES[cal.calMonth] + ' ' + cal.calYear;
  const dayEvents = cal.selDayEvents.map(p => `
    <div class="day-row" style="border-left:4px solid ${p.color}" onclick="App.openDetail('${p.id}')">
      <div class="ic" style="background:${p.color}18">${p.emoji}</div>
      <div style="flex:1;min-width:0">
        <div class="jam">${ic('clock')} ${esc(p.jam)}</div>
        <h3>${esc(p.nama)}</h3>
        <div class="m">${ic('pin')} ${esc(p.area)} · ${biayaLabelOf(p)} · ${catLabelOf(p)}</div>
      </div>
    </div>`).join('');

  return `
  <div class="screen">
    <header class="app-header desktop-only">
      <button class="brand" onclick="App.backHome()"><span class="logo">+</span><span class="title">Internacia Jakarta</span></button>
      <button class="btn btn-primary" style="padding:9px 18px;font-size:13px;box-shadow:none" onclick="App.goHasil()"><span style="font-size:15px">${ic('map')}</span> Daftar &amp; Peta</button>
    </header>
    <div class="cal-wrap">
      <h1>Kalender Kegiatan</h1>
      <p class="lead">Lihat tanggal mana ada kegiatan apa — selama Libur Sekolah Juni–Juli 2026.</p>
      <div class="cal-nav">
        <button ${cal.calMonth <= 5 ? 'disabled' : ''} onclick="App.setMonth(${cal.calMonth - 1})">‹</button>
        <div class="title">${MONTH_NAMES[cal.calMonth]} ${cal.calYear}</div>
        <button ${cal.calMonth >= 6 ? 'disabled' : ''} onclick="App.setMonth(${cal.calMonth + 1})">›</button>
      </div>
      <div class="cal-head">${headDays}</div>
      <div class="cal-grid">${cells}</div>
      <div class="cal-day">
        <div class="head"><h2>${selLabel}</h2><span class="c">${cal.selDayEvents.length} kegiatan</span></div>
        ${cal.selDayEvents.length === 0
          ? `<div class="cal-empty"><div style="font-size:34px;margin-bottom:8px">😴</div><div style="font-weight:700;color:var(--ink-blue)">Belum ada kegiatan terjadwal di tanggal ini.</div></div>`
          : `<div class="day-list">${dayEvents}</div>`}
      </div>
    </div>
  </div>`;
}

// ── overlays ────────────────────────────────────────────────────────────
function filterDrawer() {
  const programs = filtered(state);
  const interestChips = INTERESTS.map(([label, emoji]) =>
    chip(label, emoji, state.interests.includes(label), `App.toggleInterest('${label.replace(/'/g, "\\'")}')`)).join('');
  const agePills = AGEGROUPS.map(([key, label, emoji]) =>
    `<button class="chip${state.ageGroup === key ? ' active' : ''}" onclick="App.setAgeGroup('${key}')"><span style="font-size:15px">${emoji}</span><span>${label}</span></button>`).join('');
  return `
  <div class="overlay from-bottom">
    <div class="scrim" onclick="App.closeFilter()"></div>
    <div class="drawer">
      <div class="drawer-head"><h2>Filter</h2><button class="icon-x" onclick="App.closeFilter()">✕</button></div>
      <div class="drawer-body">
        <div class="fgroup"><div class="ftitle">${ic('pin')} Lokasimu</div>
          <input id="filter-loc" class="input" style="padding:13px 14px" type="text" value="${esc(state.location)}" placeholder="Kecamatan / kelurahan / kode pos" oninput="App._input(this);App.onLoc(this.value)"></div>
        <div class="fgroup"><div class="ftitle">${ic('spark')} Minatmu</div><div class="chip-wrap">${interestChips}</div></div>
        <div class="fgroup"><div class="ftitle">${ic('user')} Kelompok usia</div><div class="chip-wrap">${agePills}</div></div>
      </div>
      <div class="drawer-foot">
        <button class="btn btn-soft" style="padding:14px 22px;font-size:15px" onclick="App.resetFilter()">Reset</button>
        <button class="btn btn-primary apply" onclick="App.closeFilter()">Terapkan Filter (${programs.length})</button>
      </div>
    </div>
  </div>`;
}

function planModal() {
  const plan = planComputed(state);
  const ex = planExports(plan);
  let body;
  if (!plan.events.length) {
    body = `<div class="plan-empty"><div class="big">${ic('plan')}</div>
      <div class="t">Rencana harianmu masih kosong</div>
      <div class="d">Tambahkan kegiatan lewat tombol <strong>＋ Rencana</strong> di tiap kartu. Kami susun urutannya lalu hitung jarak, waktu tempuh, dan rute transum antar kegiatan.</div>
      <button class="btn btn-primary" style="padding:13px 28px;font-size:15px" onclick="App.closePlan()">Cari kegiatan</button></div>`;
  } else {
    const items = plan.items.map(it => `
      <div class="tl">
        <div class="tl-rail">
          <div class="tl-dot" style="background:${it.color}">${it.emoji}</div>
          ${it.seg ? `<div class="tl-line"></div>` : ''}
        </div>
        <div class="tl-body">
          <div class="tl-card" style="border-left:4px solid ${it.color}">
            <div class="tc-top"><div class="jam">${esc(it.jamLabel)}</div>
              <button class="rm" onclick="App.removeFromPlan('${it.id}')">Hapus</button></div>
            <h3>${esc(it.nama)}</h3>
            <div class="m">${ic('pin')} ${esc(it.area)} · ${it.biayaLabel}</div>
          </div>
          ${it.seg ? `<div class="seg ${it.seg.warn ? 'warn' : 'ok'}"><div class="h">${esc(it.seg.head)}</div><div class="r">${esc(it.seg.route)}</div></div>` : ''}
        </div>
      </div>`).join('');
    body = `
      <div class="plan-sum">
        <div class="sum-chip"><span>${ic('pin')}</span>${plan.events.length} kegiatan</div>
        <div class="sum-chip"><span>${ic('clock')}</span>${plan.dayStart}–${plan.dayEnd}</div>
        <div class="sum-chip"><span>🚌</span>±${fmtDur(plan.totalTravel)} di jalan</div>
        <div class="sum-chip"><span>${ic('tag')}</span>${fmtRp(plan.totalBiaya)}</div>
      </div>
      <div class="plan-body">
        ${plan.conflictCount > 0 ? `<div class="conflict">⚠️ ${plan.conflictCount} jadwal perlu perhatian — cek segmen merah di bawah.</div>` : ''}
        ${items}
        <button class="add-more" onclick="App.closePlan()">＋ Tambah kegiatan lain</button>
      </div>
      <div class="plan-foot">
        <a class="wa" href="${ex.share}" target="_blank" rel="noopener">${ic('chat')} Bagikan</a>
        <a class="ics" href="${ex.ics}" download="rencana-harian.ics">${ic('calendar')} Tambah ke Kalender</a>
      </div>`;
  }
  return `
  <div class="modal-scroll">
    <div class="scrim" onclick="App.closePlan()"></div>
    <div class="modal">
      <div class="modal-head"><div><h2>${ic('plan')} Rencana Harian</h2><div class="hsub">Disusun otomatis berdasarkan jam mulai</div></div>
        <button class="icon-x" onclick="App.closePlan()">✕</button></div>
      ${body}
    </div>
  </div>`;
}

function detailModal() {
  // Look up from the full dataset: detail can be opened from the calendar where
  // the current results filter would otherwise hide the activity.
  const p = RAW.find(x => x.id === state.detailId) || null;
  if (!p) return '';
  const ex = EXTRA[p.id] || {};
  const inPlan = state.plan.includes(p.id);
  const sub = SUB[p.id];
  const waLink = ex.kontak ? ('https://wa.me/62' + ex.kontak.replace(/[^0-9]/g, '').replace(/^0/, '')) : '';

  const subHtml = sub ? `<div class="sub-list"><div class="sh">${sub.heading}</div>${
    sub.items.map((it, i) => `<div class="sub-item"><div class="no">${i + 1}</div><div style="flex:1;min-width:0"><div class="si-nama">${esc(it.nama)}</div><div class="si-meta">${esc(it.meta || '')}</div></div></div>`).join('')
  }</div>` : '';

  const tiersHtml = ex.tiket ? `<div class="tiers"><div class="th">${ic('ticket')} Pilihan tiket</div>${
    ex.tiket.map(([l, h]) => `<div class="tier"><span class="l">${esc(l)}</span><span class="h">Rp ${esc(h)}</span></div>`).join('')
  }</div>` : '';

  const transportHtml = (ex.transport || []).map(t => `<div class="item">${esc(t)}</div>`).join('');

  return `
  <div class="modal-scroll detail-wrap">
    <div class="scrim" onclick="App.closeDetail()"></div>
    <div class="detail-modal">
      <div class="detail-head" style="background:linear-gradient(135deg,${p.color},${p.color}cc)">
        <button class="close" onclick="App.closeDetail()">✕</button>
        <div class="demoji">${p.emoji}</div>
        <span class="hbadge" style="color:${p.color}">${catLabelOf(p)}</span>
      </div>
      <div class="detail-body">
        <h2>${esc(p.nama)}</h2>
        <div class="org">${esc(p.penyelenggara)}</div>
        <p class="desc">${esc(p.deskripsi)}</p>
        ${subHtml}
        <div class="fact">
          <div class="row"><span class="ic">${ic('pin')}</span>${esc(p.lokasiNama)}</div>
          <div class="row"><span class="ic">${ic('user')}</span>${usiaLabelOf(p)}</div>
          <div class="row"><span class="ic">${ic('calendar')}</span>${esc(p.tanggal)}</div>
          <div class="row"><span class="ic">${ic('clock')}</span>${esc(p.jam)}</div>
          <div class="row price"><span class="ic">${ic('tag')}</span>${biayaLabelOf(p)}</div>
          <div class="row"><span class="ic">${ic('ticket')}</span>${ex.daftar ? 'Perlu daftar dulu' : 'Langsung datang (walk-in)'}</div>
          <div class="row"><span class="ic">${ic('repeat')}</span>${ex.rutin ? 'Kegiatan rutin' : 'Event khusus / musiman'}</div>
        </div>
        ${tiersHtml}
        <div class="tp-box"><div class="h"><span style="font-size:18px">${ic('transit')}</span>Transportasi terdekat</div><div class="list">${transportHtml}</div></div>
        <div class="a11y"><span>${ic('info')}</span><span>Butuh bantuan aksesibilitas? Hubungi Jakarta Call Center <strong>1500-177</strong>. Jadwal dapat berubah — konfirmasi ke penyelenggara.</span></div>
        <button class="detail-plan${inPlan ? ' in' : ''}" onclick="App.togglePlan('${p.id}')">${inPlan ? '✓ Di rencana harian' : '＋ Tambah ke rencana'}</button>
        <div class="detail-cta">
          <a class="learn" href="${esc(p.link)}" target="_blank" rel="noopener">Pelajari Lebih Lanjut ↗</a>
          ${ex.kontak ? `<a class="wa" href="${waLink}" target="_blank" rel="noopener">${ic('chat')} WhatsApp</a>` : ''}
          <button class="map" onclick="App.flyTo('${p.id}')">${ic('pin')} Lihat di Peta</button>
        </div>
      </div>
    </div>
  </div>`;
}

function bottomNav() {
  const plan = planComputed(state);
  const tab = (active, onclick, emoji, label, badge) =>
    `<button class="${active ? 'active' : ''}" onclick="${onclick}"><span style="position:relative;font-size:19px;line-height:1">${emoji}${badge ? `<span class="nav-badge">${badge}</span>` : ''}</span><span class="lbl">${label}</span></button>`;
  return `<nav class="bottom-nav">
    ${tab(state.screen === 'landing', 'App.backHome()', ic('home'), 'Beranda')}
    ${tab(state.screen === 'hasil' && !state.planOpen, 'App.goHasil()', ic('compass'), 'Jelajah')}
    ${tab(state.screen === 'kalender', 'App.goKalender()', ic('calendar'), 'Kalender')}
    ${tab(state.planOpen, 'App.goRencana()', ic('plan'), 'Rencana', plan.events.length || '')}
  </nav>`;
}

// ── top-level render ────────────────────────────────────────────────────
function render() {
  const root = document.getElementById('app');
  let screen = '';
  if (state.screen === 'landing') screen = landing();
  else if (state.screen === 'wizard') screen = wizard();
  else if (state.screen === 'hasil') screen = hasil();
  else if (state.screen === 'kalender') screen = kalender();

  const overlays =
    (state.filterOpen ? filterDrawer() : '') +
    (state.planOpen ? planModal() : '') +
    (state.detailId ? detailModal() : '');

  // bottom nav hidden during the wizard (full-screen flow), matching the phone design
  const nav = state.screen === 'wizard' ? '' : bottomNav();

  // Detach the keep-alive map element before wiping #app so Leaflet survives.
  if (mapEl && mapEl.parentNode) mapStash.appendChild(mapEl);
  root.innerHTML = screen + overlays + nav;

  // Re-mount the map on the results screen (after the new DOM exists).
  if (state.screen === 'hasil') {
    const programs = filtered(state);
    const sel = programs.find(p => p.id === state.selectedId) || null;
    mountMap(programs, sel);
  }

  // restore caret to the active text input across re-renders
  if (_activeInput) {
    const el = document.getElementById(_activeInput.id);
    if (el) {
      el.focus();
      try { el.setSelectionRange(_activeInput.pos, _activeInput.pos); } catch (e) {}
    }
    _activeInput = null;
  }
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (state.detailId) App.closeDetail();
    else if (state.planOpen) App.closePlan();
    else if (state.filterOpen) App.closeFilter();
  }
});

// Boot: try the backend (GET /activities); on any failure, fall back to the
// bundled data.js seed. Either way we render exactly once.
async function boot() {
  if (API_BASE) {
    try {
      const [actRes, curRes] = await Promise.all([
        fetch(`${API_BASE}/activities`, { headers: { accept: 'application/json' } }),
        fetch(`${API_BASE}/curators`, { headers: { accept: 'application/json' } }).catch(() => null)
      ]);
      if (actRes.ok) hydrateActivities(await actRes.json());
      if (curRes && curRes.ok) curators = await curRes.json();
    } catch (e) { /* offline / no backend → bundled data, no curators */ }
  }
  render();
}
boot();
