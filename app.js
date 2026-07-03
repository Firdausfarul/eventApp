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
  biayaLabelOf, usiaLabelOf, catLabelOf, catColorOf, urgencyOf, fmtMin, fmtDur, fmtRp,
  biayaMin, distKm, parseJam, SUB, EXTRA
} from './logic.js';

const STORAGE_KEY = 'ldj.v1';

const DEFAULT_STATE = {
  screen: 'landing', step: 1,
  ageGroup: 'all', interests: [], location: '',
  filterOpen: false, selectedId: null, detailId: null, query: '',
  plan: [], planOpen: false, when: 'all', calMonth: 5, calDay: null, calEnd: null,
  viewMode: 'list', // mobile list/map toggle
  curatorId: null,  // active curator "persona" filter (transient)
  cardStyle: 'Detailed', heroStyle: 'Bold',
  favorites: [],
  favoritesOnly: false,
  freeOnly: false,
  signupFilter: 'all',
  areaFilter: 'all',
  transportOnly: false,
  userLat: null,
  userLng: null,
  locStatus: ''
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
    ['ageGroup', 'interests', 'location', 'plan', 'when', 'cardStyle', 'heroStyle', 'favorites', 'favoritesOnly', 'freeOnly', 'signupFilter', 'areaFilter', 'transportOnly'].forEach(k => {
      if (saved[k] !== undefined) s[k] = saved[k];
    });
  } catch (e) { /* ignore corrupt storage */ }
  return s;
}
function persist() {
  try {
    const { ageGroup, interests, location, plan, when, cardStyle, heroStyle, favorites, favoritesOnly, freeOnly, signupFilter, areaFilter, transportOnly } = state;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ageGroup, interests, location, plan, when, cardStyle, heroStyle, favorites, favoritesOnly, freeOnly, signupFilter, areaFilter, transportOnly }));
  } catch (e) { /* storage may be unavailable */ }
}

// ── helpers ─────────────────────────────────────────────────────────────
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const toTop = () => { try { window.scrollTo({ top: 0, behavior: 'auto' }); } catch (e) {} };
const isFree = (p) => biayaMin(p) === 0;
const hasTransport = (p) => (EXTRA[p.id]?.transport || []).length > 0;
const allAreas = () => ['all', ...Array.from(new Set(RAW.map(p => p.area).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'id'))];

function addDistance(p) {
  // No leading `+`: coercing null -> 0 would make Number.isFinite true and
  // treat "no location set" as real coordinates (0,0), showing a bogus "0 km".
  if (!Number.isFinite(state.userLat) || !Number.isFinite(state.userLng)) return p;
  return { ...p, userDistance: distKm({ lat: state.userLat, lng: state.userLng }, p) };
}

function applyExtraFilters(list) {
  return list.filter(p => {
    if (state.favoritesOnly && !state.favorites.includes(p.id)) return false;
    if (state.freeOnly && !isFree(p)) return false;
    if (state.signupFilter === 'required' && !EXTRA[p.id]?.daftar) return false;
    if (state.signupFilter === 'walkin' && EXTRA[p.id]?.daftar) return false;
    if (state.areaFilter !== 'all' && p.area !== state.areaFilter) return false;
    if (state.transportOnly && !hasTransport(p)) return false;
    return true;
  });
}

function visiblePrograms(curator = state.curatorId ? findCurator(state.curatorId) : null) {
  const base = curator ? curatorPrograms(curator) : filtered(state);
  let list = applyExtraFilters(base).map(addDistance);
  if (!curator && Number.isFinite(state.userLat) && Number.isFinite(state.userLng)) {
    list = [...list].sort((a, b) => (a.userDistance ?? Infinity) - (b.userDistance ?? Infinity));
  }
  return list;
}

function mediaHtml(p, cls = 'media') {
  if (p.mediaUrl) return `<div class="${cls}" style="background-image:url('${esc(p.mediaUrl)}')"></div>`;
  return `<div class="${cls} generated" style="--media:${catColorOf(p)}"><span>${p.emoji}</span></div>`;
}

function eventIcs(p) {
  const t = parseJam(p.jam), pad = (n) => String(n).padStart(2, '0');
  const dt = new Date(), day = '' + dt.getFullYear() + pad(dt.getMonth() + 1) + pad(dt.getDate());
  const ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//InternaciaJakarta//ID\r\nBEGIN:VEVENT\r\nUID:' + p.id + '-' + day + '@internaciajakarta\r\nDTSTART:' + day + 'T' + pad(Math.floor(t.start / 60)) + pad(t.start % 60) + '00\r\nDTEND:' + day + 'T' + pad(Math.floor(t.end / 60)) + pad(t.end % 60) + '00\r\nSUMMARY:' + p.nama + '\r\nLOCATION:' + (p.lokasiNama || p.area) + '\r\nEND:VEVENT\r\nEND:VCALENDAR';
  return 'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics);
}

// Set at boot when the backend answered; gates API-dependent share/social bits.
let apiOk = false;
// id → "added to N plans in the last 7 days" (social proof, from /analytics/popular).
let POPULAR = new Map();

function sharePlanUrl() {
  const ids = state.plan.join(',');
  // With a live backend, share the server-rendered unfurl page (real OG tags
  // for the WhatsApp crawler); it bounces humans back to the SPA with ?plan=.
  if (apiOk) {
    const base = API_BASE.startsWith('http') ? API_BASE : location.origin + API_BASE;
    return `${base}/s/plan?ids=${encodeURIComponent(ids)}`;
  }
  const url = new URL(location.href);
  url.searchParams.set('plan', ids);
  return url.toString();
}

function track(type, activityId, planSize) {
  if (!API_BASE) return;
  const body = JSON.stringify({ type, activityId, planSize });
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon(`${API_BASE}/analytics`, new Blob([body], { type: 'application/json' }));
    } else {
      fetch(`${API_BASE}/analytics`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true });
    }
  } catch (e) {}
}

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
  tag:      '<path d="M3 3h8l10 10-8 8L3 11Z"/><circle cx="7.5" cy="7.5" r="1.4"/>',
  star:     '<path d="M12 3l2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z"/>',
  image:    '<rect x="3" y="5" width="18" height="14"/><circle cx="8" cy="10" r="1.5"/><path d="M21 16l-5-5-4 4-2-2-7 6"/>',
  link:     '<path d="M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1"/><path d="M14 11a5 5 0 0 0-7.1 0l-2 2A5 5 0 0 0 12 20.1l1.1-1.1"/>'
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

  onLoc(v) { setState({ location: v, userLat: v === 'Lokasi saya' ? state.userLat : null, userLng: v === 'Lokasi saya' ? state.userLng : null }); },
  useMyLoc() {
    if (!navigator.geolocation) return setState({ locStatus: 'Browser belum mendukung geolocation.' });
    setState({ locStatus: 'Mencari lokasi...' });
    navigator.geolocation.getCurrentPosition(
      (pos) => setState({
        userLat: pos.coords.latitude,
        userLng: pos.coords.longitude,
        location: 'Lokasi saya',
        locStatus: 'Lokasi aktif, daftar diurutkan dari yang terdekat.'
      }),
      () => setState({ locStatus: 'Lokasi tidak bisa diakses. Cek izin lokasi browser.' }),
      { enableHighAccuracy: false, timeout: 9000, maximumAge: 10 * 60 * 1000 }
    );
  },
  setAgeGroup(key) { setState({ ageGroup: key }); },
  toggleInterest(label) {
    const arr = state.interests.includes(label) ? state.interests.filter(x => x !== label) : [...state.interests, label];
    setState({ interests: arr });
  },

  onBack() { if (state.step > 1) { setState({ step: state.step - 1 }); toTop(); } },
  onNext() { if (state.step < 3) { setState({ step: state.step + 1 }); toTop(); } else App.go('hasil'); },

  openFilter() { setState({ filterOpen: true }); },
  closeFilter() { setState({ filterOpen: false }); },
  resetFilter() { setState({ ageGroup: 'all', interests: [], location: '', userLat: null, userLng: null, locStatus: '', favoritesOnly: false, freeOnly: false, signupFilter: 'all', areaFilter: 'all', transportOnly: false }); },

  togglePlan(id) {
    const plan = state.plan.includes(id) ? state.plan.filter(x => x !== id) : [...state.plan, id];
    if (!state.plan.includes(id)) track('plan_add', id, plan.length);
    setState({ plan });
  },
  removeFromPlan(id) { setState({ plan: state.plan.filter(x => x !== id) }); },
  setWhen(w) { setState({ when: w }); },
  openPlan() { setState({ planOpen: true }); },
  closePlan() { setState({ planOpen: false }); },

  setMonth(m) { setState({ calMonth: Math.min(6, Math.max(5, m)), calDay: null, calEnd: null }); },
  // Two-tap range: first tap starts, a later date completes the range, the same
  // date collapses back to a single day, an earlier date restarts the selection.
  selectDay(ds) {
    const { calDay, calEnd } = state;
    if (!calDay || calEnd || ds < calDay) setState({ calDay: ds, calEnd: null });
    else if (ds === calDay) setState({ calEnd: null });
    else setState({ calEnd: ds });
  },
  jumpDay(ds) { setState({ calDay: ds, calEnd: null }); }, // shortcuts always mean "go to", never "extend to"

  selectProgram(id) { setState({ selectedId: id }); },
  clearSelected() { setState({ selectedId: null }); },
  openDetail(id) { track('view', id); setState({ detailId: id }); },
  closeDetail() { setState({ detailId: null }); },
  flyTo(id) { setState({ detailId: null, selectedId: id, viewMode: 'map' }); },
  onSearch(v) { setState({ query: v }); },
  clearQuery() { setState({ query: '' }); },
  setView(v) { setState({ viewMode: v }); },
  toggleFavorite(id) {
    const favorites = state.favorites.includes(id) ? state.favorites.filter(x => x !== id) : [...state.favorites, id];
    if (!state.favorites.includes(id)) track('favorite', id);
    setState({ favorites });
  },
  toggleFavoritesOnly() { setState({ favoritesOnly: !state.favoritesOnly }); },
  toggleFreeOnly() { setState({ freeOnly: !state.freeOnly }); },
  setSignupFilter(v) { setState({ signupFilter: v }); },
  setAreaFilter(v) { setState({ areaFilter: v }); },
  toggleTransportOnly() { setState({ transportOnly: !state.transportOnly }); },
  copyPlanLink() {
    if (!state.plan.length) return;
    const url = sharePlanUrl();
    const done = () => { track('share', null, state.plan.length); alert('Link rencana disalin.'); };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url).then(done).catch(() => prompt('Salin link rencana:', url));
    else prompt('Salin link rencana:', url);
  },
  trackShare() { track('share', null, state.plan.length); },
  trackReminder(id) { track('reminder', id); },

  // curator personas: pick one → results show that curator's handpicked set.
  selectCurator(id) {
    const next = state.curatorId === id ? null : id; // tap again to clear
    setState({ screen: 'hasil', curatorId: next, selectedId: null, filterOpen: false, planOpen: false });
    toTop();
  },
  clearCurator() { setState({ curatorId: null, selectedId: null }); },
  async shareCurator() {
    const cur = findCurator(state.curatorId);
    if (!cur) return;
    const cv = await drawCuratorCard(cur);
    cv.toBlob(async (blob) => {
      if (!blob) return;
      const file = new File([blob], `tim-${cur.id}.png`, { type: 'image/png' });
      const text = `Aku tim ${cur.nama} di Internacia Jakarta — weekend-mu tipe yang mana? ${location.origin}`;
      try {
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: 'Internacia Jakarta', text });
        } else {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        }
        track('share', null, null);
      } catch (e) { /* user cancelled the share sheet */ }
    }, 'image/png');
  },
  // headless verification hook: accepts an id or a full curator-shaped object
  _drawCard: (c) => drawCuratorCard(typeof c === 'object' && c ? c : (findCurator(c) || curators[0])),

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
    favorite: state.favorites.includes(p.id),
    distanceLabel: Number.isFinite(p.userDistance) ? (p.userDistance < 1 ? `${Math.round(p.userDistance * 10) / 10} km` : `${Math.round(p.userDistance)} km`) : '',
    selected: state.selectedId === p.id,
    hasSub: !!SUB[p.id],
    subHint: SUB[p.id] ? (SUB[p.id].items.length + ' acara di dalamnya') : '',
    blurb: p.blurb || '' // curator's personal note (only set in curator view)
  };
}

// ── card renderers ──────────────────────────────────────────────────────
function detailedCard(p) {
  const m = programModel(p), c = catColorOf(p);
  return `
  <div class="card${m.selected ? ' sel' : ''}" style="--cat:${c}" onclick="App.openDetail('${p.id}')">
    ${mediaHtml(p, 'card-media')}
    ${m.blurb ? `<div class="curator-note">“${esc(m.blurb)}”</div>` : ''}
    <div class="card-top">
      <span class="badge" style="color:${c};background:${c}1A">${m.catLabel}</span>
      <span class="price">${m.distanceLabel || m.biayaLabel}</span>
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
      <button class="fav-btn${m.favorite ? ' in' : ''}" title="Favorit" onclick="event.stopPropagation();App.toggleFavorite('${p.id}')">${ic('star')}</button>
      <button class="fly-btn" title="Lihat di Peta" onclick="event.stopPropagation();App.flyTo('${p.id}')">${ic('pin')}</button>
      <button class="detail-btn" onclick="event.stopPropagation();App.openDetail('${p.id}')">Detail</button>
    </div>
  </div>`;
}

function compactCard(p) {
  const m = programModel(p), c = catColorOf(p);
  const urg = urgencyOf(p), hot = POPULAR.get(p.id) || 0;
  return `
  <div class="compact${m.selected ? ' sel' : ''}" onclick="App.openDetail('${p.id}')">
    <div class="cicon" style="background:${p.mediaUrl ? `url('${esc(p.mediaUrl)}') center/cover` : c + '18'};border-right:1px solid ${c}22"><span>${p.mediaUrl ? '' : p.emoji}</span></div>
    <div class="cbody">
      <div style="display:flex;align-items:center;gap:7px;margin-bottom:4px;flex-wrap:wrap">
        <span class="badge" style="color:${c};background:${c}1A">${m.catLabel}</span>
        <span style="font-size:11.5px;font-weight:800;color:var(--green)">${m.biayaLabel}</span>
        ${urg ? `<span class="urg">⏳ ${urg}</span>` : ''}
      </div>
      <h3>${esc(p.nama)}</h3>
      <div class="cmeta">${ic('pin')} ${esc(p.area)}${m.distanceLabel ? ' · ' + m.distanceLabel : ''} · ${ic('calendar')} ${esc(p.tanggal)}</div>
      ${hot >= 2 ? `<div class="hotline">🔥 Ditambahin ke ${hot} rencana minggu ini</div>` : ''}
      ${m.blurb ? `<div class="curator-note compact">“${esc(m.blurb)}”</div>` : ''}
    </div>
    <button class="plan-mini fav${m.favorite ? ' in' : ''}" title="Favorit" onclick="event.stopPropagation();App.toggleFavorite('${p.id}')">${ic('star')}</button>
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

// ── shareable persona card (canvas → PNG, IG-story portrait) ─────────────
// Social currency: the artifact people post is their *identity* ("aku tim Anak
// Seni") with the brand riding along. Pure draw step — App._drawCard exposes it
// for headless verification; shareCurator() handles Web Share / download.
function cvWrap(x, text, maxW) {
  const words = String(text).split(/\s+/), lines = [];
  let line = '';
  words.forEach(w => {
    const t = line ? line + ' ' + w : w;
    if (x.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
  });
  if (line) lines.push(line);
  return lines;
}
function cvRound(x, X, Y, W, H, r) {
  x.beginPath(); x.roundRect(X, Y, W, H, r);
}
function cvPolaBand(x, y0, W, h) {
  x.fillStyle = '#FC351C'; x.fillRect(0, y0, W, h);
  const cell = h * 1.6;
  for (let i = 0, cx = 0; cx < W; cx += cell, i++) {
    const mid = cx + cell / 2, pad = h * .2;
    x.beginPath();
    if (i % 4 === 0) { x.fillStyle = '#FEB52B'; x.moveTo(cx + pad, y0 + pad); x.lineTo(cx + cell - pad, y0 + pad); x.lineTo(mid, y0 + h - pad); }
    else if (i % 4 === 1) { x.fillStyle = '#1FAE5D'; x.moveTo(cx + pad, y0 + h - pad); x.lineTo(cx + cell - pad, y0 + h - pad); x.lineTo(mid, y0 + pad); }
    else if (i % 4 === 2) { x.fillStyle = '#00AAFF'; x.rect(mid - h * .22, y0 + h * .28, h * .44, h * .44); }
    else { x.fillStyle = '#FFF8F1'; x.moveTo(cx + pad, y0 + h - pad); x.lineTo(cx + cell - pad, y0 + h - pad); x.lineTo(mid, y0 + pad); }
    x.fill();
  }
}
async function drawCuratorCard(cur) {
  try { await document.fonts.ready; } catch (e) {}
  const W = 1080, H = 1920;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const x = cv.getContext('2d');
  const F = (w, s) => `${w} ${s}px "Plus Jakarta Sans", system-ui, sans-serif`;
  // ground: cream + warm diagonal + sun spot (same light as the hero)
  x.fillStyle = '#FFF8F1'; x.fillRect(0, 0, W, H);
  x.fillStyle = '#FFE9E4';
  x.beginPath(); x.moveTo(W * .58, 0); x.lineTo(W, 0); x.lineTo(W, H); x.lineTo(W * .3, H); x.closePath(); x.fill();
  const g = x.createRadialGradient(W * .84, 260, 0, W * .84, 260, 380);
  g.addColorStop(0, 'rgba(254,181,43,.5)'); g.addColorStop(1, 'rgba(254,181,43,0)');
  x.fillStyle = g; x.fillRect(0, 0, W, 700);
  cvPolaBand(x, 0, W, 60); cvPolaBand(x, H - 60, W, 60);
  // brand lockup
  x.fillStyle = '#FC351C'; cvRound(x, 84, 150, 84, 84, 20); x.fill();
  x.fillStyle = '#fff'; x.font = F(800, 64); x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText('+', 84 + 42, 150 + 46);
  x.fillStyle = '#1A1320'; x.textAlign = 'left'; x.font = F(800, 52);
  x.fillText('Internacia Jakarta', 196, 150 + 44);
  // persona
  x.font = F(800, 36); x.fillStyle = '#7A6558';
  x.fillText('T I P E   W E E K E N D - K U', 84, 400);
  x.font = '260px serif'; x.textAlign = 'center';
  x.fillText(cur.emoji || '⭐', W / 2, 660);
  x.fillStyle = '#FC351C'; x.font = F(800, 116);
  const nameLines = cvWrap(x, 'Tim ' + cur.nama, W - 160);
  nameLines.forEach((l, i) => x.fillText(l, W / 2, 880 + i * 128));
  let y = 880 + nameLines.length * 128 - 40;
  x.fillStyle = '#4A3F3A'; x.font = F(600, 46);
  cvWrap(x, cur.tagline || '', W - 260).forEach(l => { y += 62; x.fillText(l, W / 2, y); });
  // picks card (max 4 — five would collide with the footer CTA)
  const picks = curatorPrograms(cur).slice(0, 4);
  const boxY = y + 70, rowH = 108, boxH = 132 + picks.length * rowH;
  x.fillStyle = '#fff'; cvRound(x, 84, boxY, W - 168, boxH, 28); x.fill();
  x.strokeStyle = '#1A1320'; x.lineWidth = 4; cvRound(x, 84, boxY, W - 168, boxH, 28); x.stroke();
  x.textAlign = 'left'; x.font = F(800, 34); x.fillStyle = '#7A6558';
  x.fillText('WEEKEND GUE:', 140, boxY + 72);
  picks.forEach((p, i) => {
    const py = boxY + 110 + i * rowH;
    x.font = '56px serif'; x.fillText(p.emoji, 140, py + 52);
    x.font = F(700, 42); x.fillStyle = '#1A1320';
    let nm = p.nama;
    while (x.measureText(nm).width > W - 470 && nm.length > 4) nm = nm.slice(0, -2);
    x.fillText(nm === p.nama ? nm : nm + '…', 236, py + 40);
    x.font = F(600, 32); x.fillStyle = '#7A6558';
    x.fillText((p.biaya === 'gratis' ? 'Gratis' : 'Mulai Rp ' + p.biaya) + ' · ' + p.area, 236, py + 88);
  });
  // footer CTA
  x.textAlign = 'center'; x.font = F(800, 44); x.fillStyle = '#1A1320';
  x.fillText('Weekend-mu tipe yang mana?', W / 2, H - 210);
  x.font = F(700, 40); x.fillStyle = '#FC351C';
  x.fillText(location.host || 'internacia.xyz', W / 2, H - 140);
  return cv;
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
  const style = `background:${catColorOf(p)}` + (selected ? ';animation:ldj-pulse 1.6s infinite' : '');
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
    const selected = p.id === state.selectedId;
    const m = L.marker([p.lat, p.lng], { icon: markerIcon(p, selected), zIndexOffset: selected ? 1000 : 0 });
    m.bindPopup(`
      <div class="pin-pop">
        <strong>${p.emoji} ${esc(p.nama)}</strong>
        <span>${esc(p.jam)} · ${biayaLabelOf(p)}</span>
        <button onclick="App.openDetail('${p.id}')">Lihat detail →</button>
      </div>`, { offset: [0, -4] });
    m.on('click', () => App.selectProgram(p.id));
    m.addTo(markerLayer);
    // Markers are rebuilt every render, which destroys any open popup — so the
    // selected pin reopens its own. This also makes "Lihat di Peta" land with
    // the popup already showing instead of just a highlighted diamond.
    if (selected) setTimeout(() => { try { m.openPopup(); } catch (e) {} }, 0);
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
    // On phones the map is a peek strip in the page-scroll path; one-finger drag
    // would trap the scroll (page stops, map pans). Zoom buttons + marker taps +
    // flyTo still work — panning is a desktop affordance.
    const phone = window.matchMedia('(max-width: 820px)').matches;
    map = L.map(el, { center: MAP.center, zoom: MAP.zoom, minZoom: MAP.minZoom, maxZoom: MAP.maxZoom, zoomControl: true, dragging: !phone });
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
      <button class="brand" onclick="App.backHome()"><img class="logo" src="./favicon.svg" alt=""><span class="title">Internacia Jakarta</span></button>
      <button class="btn btn-ghost" style="padding:6px 4px;font-size:13px" onclick="App.goKalender()"><span style="font-size:16px">${ic('calendar')}</span></button>
    </header>
    <header class="app-header desktop-only">
      <button class="brand" onclick="App.backHome()">
        <img class="logo" src="./favicon.svg" alt="">
        <span><span class="title">Internacia Jakarta</span><br><span class="sub">Kegiatan seru, gratis &amp; murah</span></span>
      </button>
      <div class="header-actions">
        <button class="btn btn-ghost" onclick="App.goKalender()"><span style="font-size:16px">${ic('calendar')}</span> Kalender</button>
        <button class="btn btn-pill" style="padding:10px 20px" onclick="App.startWizard()">Mulai →</button>
      </div>
    </header>
    <section class="hero">
      <div class="hero-bg"></div>
      <div class="hero-layout">
        <div class="hero-inner">
          <h1>Weekend gabut?<br><span class="grad">Nih, ada solusinya</span></h1>
          <p>Kegiatan seru, gratis &amp; murah di Jakarta — sendirian, sama temen, atau bareng keluarga. Pilih minat, cari yang deket, lalu susun rencana harian dalam hitungan menit.</p>
          <div class="hero-cta">
            <button class="btn btn-primary" onclick="App.startWizard()">Cari Kegiatan</button>
            <button class="btn btn-outline" onclick="App.goHasil()">Lihat Semua →</button>
          </div>
        </div>
        <div class="hero-board" aria-label="Cuplikan kegiatan seru di Jakarta">
          <div class="sunburst" aria-hidden="true"></div>
          <div class="hero-card hero-card-main">
            <span class="hero-card-emoji">🎨</span>
            <span>
              <strong>Workshop seni</strong>
              <small>Gratis · cocok 7–18 tahun</small>
            </span>
          </div>
          <div class="hero-card hero-card-alt">
            <span class="hero-card-emoji">⚽</span>
            <span>
              <strong>Olahraga pagi</strong>
              <small>GOR &amp; ruang publik</small>
            </span>
          </div>
          <div class="hero-ticket">
            <span>Update tiap minggu</span>
            <strong>Kegiatan baru</strong>
          </div>
          <div class="hero-map-mini">
            <span class="pin p1"></span>
            <span class="pin p2"></span>
            <span class="pin p3"></span>
          </div>
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
      ${state.locStatus ? `<div class="filter-note">${esc(state.locStatus)}</div>` : ''}
      <div class="privacy">Tenang, lokasimu hanya dipakai untuk mengurutkan kegiatan terdekat — tidak disimpan.</div>`;
  }
  return `
  <div class="wiz-shell">
    <div class="wiz-inner">
      <div class="wiz-top">
        <button class="btn btn-ghost" style="padding:6px 0" onclick="App.backHome()">← Beranda</button>
        <div class="step">Langkah ${state.step} dari 3</div>
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
  const programs = visiblePrograms(curator);
  const sel = programs.find(p => p.id === state.selectedId) || null;
  const plan = planComputed(state);
  const whenOpts = [['all', 'Kapan aja'], ['today', 'Hari ini'], ['tomorrow', 'Besok'], ['weekend', 'Akhir pekan']];
  const whenChips = whenOpts.map(([k, l]) =>
    `<button class="chip${state.when === k ? ' active' : ''}" onclick="App.setWhen('${k}')">${l}</button>`).join('');

  // List selalu compact: media besar & deskripsi panjang hidup di detail modal,
  // bukan diulang 14× di list (rainbow wall + scroll 7000px+).
  const cardsHtml = programs.length
    ? programs.map(p => compactCard(p)).join('')
    : `<div class="empty"><div class="big">${ic('search')}</div><div class="t">Belum ada yang cocok</div>
        <div style="font-size:14px;margin-bottom:16px">Coba kata kunci lain, ganti kelompok usia, atau pilih minat lain di Filter.</div>
        <button class="btn btn-primary" style="padding:11px 24px;font-size:14px" onclick="App.openFilter()">Buka Filter</button></div>`;

  return `
  <div class="screen">
    <header class="app-header desktop-only">
      <button class="brand" onclick="App.backHome()"><img class="logo" src="./favicon.svg" alt=""><span class="title">Internacia Jakarta</span></button>
      <div class="header-actions">
        <button class="btn btn-pill" style="padding:9px 16px;font-size:13px" onclick="App.goKalender()"><span style="font-size:15px">${ic('calendar')}</span> Kalender</button>
        <button class="btn btn-pill" style="padding:9px 16px;font-size:13px" onclick="App.startWizard()">Ubah pencarian</button>
        <button class="btn ${plan.events.length ? 'btn-primary' : 'btn-pill'}" style="padding:9px 16px;font-size:13px;box-shadow:none" onclick="App.openPlan()"><span style="font-size:15px">${ic('plan')}</span> Rencana${plan.events.length ? ` (${plan.events.length})` : ''}</button>
        <button class="btn btn-pill" style="padding:9px 16px;font-size:13px" onclick="App.openFilter()"><span style="font-size:15px">${ic('filter')}</span> Filter</button>
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
          <button class="cb-share" onclick="App.shareCurator()">📤 Bagikan kartu</button>
          <button class="cb-clear" onclick="App.clearCurator()">✕ Semua kegiatan</button>
        </div>
        ` : `
        <div>
          <h1>Kegiatan Untukmu</h1>
          <p class="count"><b>${programs.length}</b> kegiatan ditemukan${state.location ? ' di sekitar ' + esc(state.location.split(',')[0]) : ''}</p>
          ${state.locStatus ? `<p class="loc-status">${esc(state.locStatus)}</p>` : ''}
        </div>`}
        <div class="view-toggle mobile-only">
          <button class="${state.viewMode === 'list' ? 'active' : ''}" onclick="App.setView('list')">${ic('list')} Daftar</button>
          <button class="${state.viewMode === 'map' ? 'active' : ''}" onclick="App.setView('map')">${ic('map')} Peta</button>
        </div>
        ${curatorShelf(state.curatorId)}
        ${curator ? '' : `
        <div class="when-row">${whenChips}</div>
        <div class="quick-filters">
          <button class="chip gold${state.favoritesOnly ? ' active' : ''}" onclick="App.toggleFavoritesOnly()">${ic('star')} Favorit (${state.favorites.length})</button>
          <button class="chip${state.freeOnly ? ' active' : ''}" onclick="App.toggleFreeOnly()">Gratis</button>
          <button class="chip${state.transportOnly ? ' active' : ''}" onclick="App.toggleTransportOnly()">${ic('transit')} Dekat transit</button>
        </div>
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
    const more = c.count > 2 ? `<b>+${c.count - 2}</b>` : '';
    const cls = `${c.hasEvents ? 'has' : ''}${c.selected ? ' sel' : ''}${c.inrange ? ' inrange' : ''}${c.we ? ' we' : ''}${c.today ? ' today' : ''}`;
    return `<div class="cal-cell"><button class="${cls}" onclick="App.selectDay('${c.ds}')">
      <span class="num">${c.day}</span>${c.hasEvents ? `<div class="cev">${c.emojis.map(e => `<span>${e}</span>`).join('')}${more}</div>` : ''}</button></div>`;
  }).join('');

  const isRange = !!cal.endDs;
  const selLabel = isRange
    ? cal.selDateObj.getDate() + '–' + (+cal.endDs.slice(8)) + ' ' + MONTH_NAMES[cal.calMonth] + ' ' + cal.calYear
    : HARI_NAMES[cal.selDateObj.getDay()] + ', ' + cal.selDateObj.getDate() + ' ' + MONTH_NAMES[cal.calMonth] + ' ' + cal.calYear;
  const countLabel = isRange
    ? `${cal.rangeTotal} kegiatan · ${cal.selDays.length} hari`
    : `${cal.selDayEvents.length} kegiatan`;
  // Fills the tail of the sticky day panel: the month's other busiest dates,
  // clickable, so the right column is a navigator instead of dead space.
  const hotDates = cal.cells
    .filter(c => !c.blank && c.hasEvents && !c.selected && !c.inrange)
    .sort((a, b) => b.count - a.count || a.day - b.day)
    .slice(0, 4);
  const dayRow = (p) => `
    <div class="day-row" style="border-left:4px solid ${catColorOf(p)}" onclick="App.openDetail('${p.id}')">
      <div class="ic" style="background:${catColorOf(p)}18">${p.emoji}</div>
      <div style="flex:1;min-width:0">
        <div class="jam">${ic('clock')} ${esc(p.jam)}</div>
        <h3>${esc(p.nama)}</h3>
        <div class="m">${ic('pin')} ${esc(p.area)} · ${biayaLabelOf(p)} · ${catLabelOf(p)}</div>
      </div>
    </div>`;
  const daysWithEvents = cal.selDays.filter(x => x.events.length);
  const dayEvents = daysWithEvents.map(x => `
    ${isRange ? `<div class="day-group">${HARI_NAMES[x.dateObj.getDay()].slice(0, 3)} ${x.dateObj.getDate()} ${MONTH_NAMES[cal.calMonth].slice(0, 3)} <span>· ${x.events.length} kegiatan</span></div>` : ''}
    ${x.events.map(dayRow).join('')}`).join('');

  return `
  <div class="screen cal-screen">
    <header class="app-header desktop-only">
      <button class="brand" onclick="App.backHome()"><img class="logo" src="./favicon.svg" alt=""><span class="title">Internacia Jakarta</span></button>
      <button class="btn btn-primary" style="padding:9px 18px;font-size:13px;box-shadow:none" onclick="App.goHasil()"><span style="font-size:15px">${ic('map')}</span> Daftar &amp; Peta</button>
    </header>
    <div class="cal-wrap">
      <div class="cal-left">
        <h1>Kalender Kegiatan</h1>
        <p class="lead">Lihat tanggal mana ada kegiatan apa — cek jadwal bulan ini.</p>
        <div class="cal-stats">
          <span class="cal-stat">${ic('spark')} <b>${cal.monthTotal}</b> kegiatan bulan ini</span>
          <span class="cal-stat">${ic('tag')} <b>${cal.monthFree}</b> gratis</span>
          ${cal.busiest ? `<span class="cal-stat">${ic('star')} Paling rame: <b>${cal.busiest.day} ${MONTH_NAMES[cal.calMonth]}</b> (${cal.busiest.count} kegiatan)</span>` : ''}
        </div>
        <div class="cal-nav">
          <button ${cal.calMonth <= 5 ? 'disabled' : ''} onclick="App.setMonth(${cal.calMonth - 1})">‹</button>
          <div class="title">${MONTH_NAMES[cal.calMonth]} ${cal.calYear}</div>
          <button ${cal.calMonth >= 6 ? 'disabled' : ''} onclick="App.setMonth(${cal.calMonth + 1})">›</button>
        </div>
        <div class="cal-head">${headDays}</div>
        <div class="cal-grid">${cells}</div>
      </div>
      <aside class="cal-day">
        <div class="head"><h2>${selLabel}</h2><span class="c">${countLabel}</span></div>
        ${isRange
          ? `<button class="range-clear" onclick="App.jumpDay('${cal.selDs}')">✕ Hapus rentang</button>`
          : `<p class="range-hint">Tip: klik tanggal kedua di kalender buat lihat rentang (mis. nginep 12–14).</p>`}
        ${daysWithEvents.length === 0
          ? `<div class="cal-empty"><div style="font-size:34px;margin-bottom:8px">😴</div><div style="font-weight:700;color:var(--ink-blue)">Belum ada kegiatan terjadwal di ${isRange ? 'rentang' : 'tanggal'} ini.</div></div>`
          : `<div class="day-list">${dayEvents}</div>`}
        ${hotDates.length ? `
        <div class="cal-hot">
          <h3>Tanggal rame lainnya</h3>
          ${hotDates.map(c => `
          <button class="hot-row" onclick="App.jumpDay('${c.ds}')">
            <span class="d"><b>${c.day}</b> ${HARI_NAMES[new Date(c.ds + 'T00:00:00').getDay()].slice(0, 3)}</span>
            <span class="e">${c.emojis.map(e => `<span>${e}</span>`).join('')}</span>
            <span class="n">${c.count} kegiatan</span>
          </button>`).join('')}
        </div>` : ''}
        <button class="btn btn-outline cal-to-map" onclick="App.goHasil()">${ic('map')} Lihat semua di peta</button>
      </aside>
    </div>
  </div>`;
}

// ── overlays ────────────────────────────────────────────────────────────
function filterDrawer() {
  const programs = visiblePrograms(null);
  const interestChips = INTERESTS.map(([label, emoji]) =>
    chip(label, emoji, state.interests.includes(label), `App.toggleInterest('${label.replace(/'/g, "\\'")}')`)).join('');
  const agePills = AGEGROUPS.map(([key, label, emoji]) =>
    `<button class="chip${state.ageGroup === key ? ' active' : ''}" onclick="App.setAgeGroup('${key}')"><span style="font-size:15px">${emoji}</span><span>${label}</span></button>`).join('');
  const areaOptions = allAreas().map(a => `<option value="${esc(a)}"${state.areaFilter === a ? ' selected' : ''}>${a === 'all' ? 'Semua area' : esc(a)}</option>`).join('');
  return `
  <div class="overlay from-bottom">
    <div class="scrim" onclick="App.closeFilter()"></div>
    <div class="drawer">
      <div class="drawer-head"><h2>Filter</h2><button class="icon-x" onclick="App.closeFilter()">✕</button></div>
      <div class="drawer-body">
        <div class="fgroup"><div class="ftitle">${ic('pin')} Lokasimu</div>
          <input id="filter-loc" class="input" style="padding:13px 14px" type="text" value="${esc(state.location)}" placeholder="Kecamatan / kelurahan / kode pos" oninput="App._input(this);App.onLoc(this.value)">
          <button class="geo-btn compact" onclick="App.useMyLoc()">${ic('compass')} Gunakan lokasi saya</button>
          ${state.locStatus ? `<div class="filter-note">${esc(state.locStatus)}</div>` : ''}
        </div>
        <div class="fgroup"><div class="ftitle">${ic('filter')} Opsi cepat</div>
          <div class="chip-wrap">
            <button class="chip gold${state.favoritesOnly ? ' active' : ''}" onclick="App.toggleFavoritesOnly()">${ic('star')} Favorit</button>
            <button class="chip${state.freeOnly ? ' active' : ''}" onclick="App.toggleFreeOnly()">Gratis saja</button>
            <button class="chip${state.transportOnly ? ' active' : ''}" onclick="App.toggleTransportOnly()">${ic('transit')} Ada info transit</button>
          </div>
        </div>
        <div class="fgroup"><div class="ftitle">${ic('ticket')} Pendaftaran</div>
          <div class="chip-wrap">
            <button class="chip${state.signupFilter === 'all' ? ' active' : ''}" onclick="App.setSignupFilter('all')">Semua</button>
            <button class="chip${state.signupFilter === 'walkin' ? ' active' : ''}" onclick="App.setSignupFilter('walkin')">Walk-in</button>
            <button class="chip${state.signupFilter === 'required' ? ' active' : ''}" onclick="App.setSignupFilter('required')">Perlu daftar</button>
          </div>
        </div>
        <div class="fgroup"><div class="ftitle">${ic('map')} Area</div>
          <select class="select" onchange="App.setAreaFilter(this.value)">${areaOptions}</select>
        </div>
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
          <div class="tl-dot" style="background:${catColorOf(it)}">${it.emoji}</div>
          ${it.seg ? `<div class="tl-line"></div>` : ''}
        </div>
        <div class="tl-body">
          <div class="tl-card" style="border-left:4px solid ${catColorOf(it)}">
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
        <button class="link-btn" onclick="App.copyPlanLink()">${ic('link')} Salin Link</button>
        <a class="wa" href="${ex.share}" target="_blank" rel="noopener" onclick="App.trackShare()">${ic('chat')} WhatsApp</a>
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
  const favorite = state.favorites.includes(p.id);
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
      <div class="detail-head${p.mediaUrl ? '' : ' gen'}" style="background:${p.mediaUrl ? `linear-gradient(180deg,rgba(0,0,0,.12),rgba(0,0,0,.42)),url('${esc(p.mediaUrl)}') center/cover` : `linear-gradient(135deg,${catColorOf(p)},${catColorOf(p)}cc)`}">
        <button class="close" onclick="App.closeDetail()">✕</button>
        <div class="demoji">${p.emoji}</div>
        <span class="hbadge" style="color:${catColorOf(p)}">${catLabelOf(p)}</span>
      </div>
      <div class="detail-body">
        <h2>${esc(p.nama)}</h2>
        <div class="org">${esc(p.penyelenggara)}</div>
        ${urgencyOf(p) || (POPULAR.get(p.id) || 0) >= 2 ? `<div class="urg-line">${urgencyOf(p) ? `<span class="urg">⏳ ${urgencyOf(p)}</span>` : ''}${(POPULAR.get(p.id) || 0) >= 2 ? `<span class="hotline">🔥 Ditambahin ke ${POPULAR.get(p.id)} rencana minggu ini</span>` : ''}</div>` : ''}
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
        <div class="detail-actions-main">
          <button class="detail-plan${inPlan ? ' in' : ''}" onclick="App.togglePlan('${p.id}')">${inPlan ? '✓ Di rencana harian' : '＋ Tambah ke rencana'}</button>
          <button class="detail-fav${favorite ? ' in' : ''}" onclick="App.toggleFavorite('${p.id}')" title="Favorit">${ic('star')}</button>
        </div>
        <div class="detail-cta">
          <a class="learn" href="${esc(p.link)}" target="_blank" rel="noopener">Pelajari Lebih Lanjut ↗</a>
          <a class="ics" href="${eventIcs(p)}" download="${esc(p.id)}-reminder.ics" onclick="App.trackReminder('${p.id}')">${ic('calendar')} Ingatkan</a>
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
    const programs = visiblePrograms();
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

function loadPlanFromUrl() {
  try {
    const ids = new URL(location.href).searchParams.get('plan');
    if (!ids) return;
    const valid = ids.split(',').map(s => s.trim()).filter(id => RAW.some(p => p.id === id));
    if (valid.length) state = { ...state, screen: 'hasil', plan: valid, planOpen: true };
  } catch (e) {}
}

// Boot: try the backend (GET /activities); on any failure, fall back to the
// bundled data.js seed. Either way we render exactly once.
async function boot() {
  if (API_BASE) {
    try {
      const [actRes, curRes, popRes] = await Promise.all([
        fetch(`${API_BASE}/activities`, { headers: { accept: 'application/json' } }),
        fetch(`${API_BASE}/curators`, { headers: { accept: 'application/json' } }).catch(() => null),
        fetch(`${API_BASE}/analytics/popular`, { headers: { accept: 'application/json' } }).catch(() => null)
      ]);
      if (actRes.ok) { hydrateActivities(await actRes.json()); apiOk = true; }
      if (curRes && curRes.ok) curators = await curRes.json();
      if (popRes && popRes.ok) POPULAR = new Map((await popRes.json()).map(r => [r.id, r.plans]));
    } catch (e) { /* offline / no backend → bundled data, no curators */ }
  }
  loadPlanFromUrl();
  render();
}
boot();
