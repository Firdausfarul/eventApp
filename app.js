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
  fmtInputTime, biayaMin, distKm, parseJam, categoryTagsOf, timeModeLabelOf, SUB, EXTRA
} from './logic.js';

const STORAGE_KEY = 'ldj.v1';

const DEFAULT_STATE = {
  screen: 'landing', step: 1,
  ageGroup: 'all', interests: [], location: '',
  filterOpen: false, selectedId: null, detailId: null, query: '',
  plan: [], planOpen: false, when: 'all', calMonth: 5, calDay: null, calEnd: null,
  viewMode: 'list', // mobile list/map toggle
  sheet: 'peek',    // mobile map-first results: 'peek' (carousel) | 'full' (list)
  curatorId: null,  // active curator "persona" filter (transient)
  cardStyle: 'Detailed', heroStyle: 'Bold',
  favorites: [],
  favoritesOnly: false,
  freeOnly: false,
  signupFilter: 'all',
  areaFilter: 'all',
  transportOnly: false,
  travelOverrides: {},
  planTimeOverrides: {},
  maxPrice: 'all',
  userLat: null,
  userLng: null,
  locStatus: ''
};

// Phone layouts swap whole templates (not just CSS), so screens check this at
// render time; a breakpoint-cross listener re-renders (see bottom of file).
const isPhone = () => window.matchMedia('(max-width: 820px)').matches;

// Curator personas fetched from GET /curators (handpicked activity ids + blurbs).
let curators = [];

let state = loadState();
let _activeInput = null; // { id, pos } to restore caret after re-render

const ROUTES = {
  landing: '/',
  wizard: '/mulai',
  hasil: '/kegiatan',
  kalender: '/kalender',
  rencana: '/rencana'
};

function normalizePath(pathname = location.pathname) {
  let path = pathname.replace(/\/+$/, '') || '/';
  if (path.endsWith('/index.html')) path = path.slice(0, -'/index.html'.length) || '/';
  return path;
}

function screenFromPath(pathname = location.pathname) {
  const path = normalizePath(pathname);
  if (path === ROUTES.wizard) return { screen: 'wizard', step: 1 };
  if (path === ROUTES.hasil) return { screen: 'hasil', planOpen: false };
  if (path === ROUTES.kalender) return { screen: 'kalender', planOpen: false };
  if (path === ROUTES.rencana) return { screen: 'hasil', planOpen: true };
  const detail = path.match(/^\/kegiatan\/([^/]+)$/);
  if (detail) return { screen: 'hasil', planOpen: false, detailId: decodeURIComponent(detail[1]) };
  return { screen: 'landing', planOpen: false };
}

function pathForState(next = state) {
  if (next.detailId) return `${ROUTES.hasil}/${encodeURIComponent(next.detailId)}`;
  if (next.planOpen) return ROUTES.rencana;
  return ROUTES[next.screen] || ROUTES.landing;
}

function currentQuery() {
  return location.search || '';
}

function syncUrl(replace = false) {
  const path = pathForState();
  const url = path + currentQuery() + location.hash;
  if (url === location.pathname + location.search + location.hash) return;
  history[replace ? 'replaceState' : 'pushState']({ path }, '', url);
}

function applyRoute(pathname = location.pathname) {
  const route = screenFromPath(pathname);
  if (route.detailId && !RAW.some(p => p.id === route.detailId)) route.detailId = null;
  state = {
    ...state,
    screen: route.screen,
    step: route.step || state.step,
    planOpen: !!route.planOpen,
    detailId: route.detailId || null,
    filterOpen: false
  };
}

function updateDocumentMeta() {
  const detail = state.detailId ? RAW.find(p => p.id === state.detailId) : null;
  let title = 'Internacia Jakarta — Kegiatan seru, gratis & murah';
  let description = 'Portal kegiatan gratis & murah di Jakarta. Cari yang sesuai minatmu, susun rencana harian, dan ekspor ke WhatsApp atau kalender.';
  if (detail) {
    title = `${detail.nama} — Internacia Jakarta`;
    description = detail.deskripsi;
  } else if (state.planOpen) {
    title = 'Rencana Harian — Internacia Jakarta';
    description = 'Susun rencana harian dari kegiatan gratis dan murah di Jakarta.';
  } else if (state.screen === 'hasil') {
    title = 'Kegiatan di Jakarta — Internacia Jakarta';
    description = 'Jelajahi kegiatan seru, gratis, dan murah di Jakarta dengan peta, filter, dan rencana harian.';
  } else if (state.screen === 'kalender') {
    title = 'Kalender Kegiatan Jakarta — Internacia Jakarta';
    description = 'Lihat jadwal kegiatan gratis dan murah di Jakarta berdasarkan tanggal.';
  } else if (state.screen === 'wizard') {
    title = 'Cari Kegiatan — Internacia Jakarta';
    description = 'Pilih usia, minat, dan lokasi untuk menemukan kegiatan Jakarta yang cocok.';
  }
  document.title = title;
  const setMeta = (selector, attr, value) => {
    const el = document.querySelector(selector);
    if (el) el.setAttribute(attr, value);
  };
  setMeta('meta[name="description"]', 'content', description);
  setMeta('meta[property="og:title"]', 'content', title);
  setMeta('meta[property="og:description"]', 'content', description);
}

// ── persistence (PRD §3.3) ─────────────────────────────────────────────
const INTEREST_ALIASES = {
  'Olahraga': 'Olahraga & Sehat',
  'Seni & Kerajinan': 'Seni & Budaya',
  'Games/Gaming': 'Games & Digital',
  'Buku': 'Buku & Belajar',
  'Film': 'Film & Pertunjukan',
  'Museum': 'Seni & Budaya',
  'Pertunjukan Langsung': 'Film & Pertunjukan',
  'Memasak': 'Belanja & Kuliner',
  'Coding & Digital': 'Games & Digital'
};
const normalizeInterests = (arr) => Array.from(new Set((Array.isArray(arr) ? arr : [])
  .map(label => INTEREST_ALIASES[label] || label)
  .filter(label => INTERESTS.some(i => i[0] === label))));

function loadState() {
  const s = { ...DEFAULT_STATE };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    // Only persist durable preferences, never transient UI flags.
    ['ageGroup', 'interests', 'location', 'plan', 'when', 'cardStyle', 'heroStyle', 'favorites', 'favoritesOnly', 'freeOnly', 'signupFilter', 'areaFilter', 'transportOnly', 'travelOverrides', 'planTimeOverrides', 'maxPrice'].forEach(k => {
      if (saved[k] !== undefined) s[k] = saved[k];
    });
    s.interests = normalizeInterests(s.interests);
  } catch (e) { /* ignore corrupt storage */ }
  return s;
}
function persist() {
  try {
    const { ageGroup, interests, location, plan, when, cardStyle, heroStyle, favorites, favoritesOnly, freeOnly, signupFilter, areaFilter, transportOnly, travelOverrides, planTimeOverrides, maxPrice } = state;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ageGroup, interests, location, plan, when, cardStyle, heroStyle, favorites, favoritesOnly, freeOnly, signupFilter, areaFilter, transportOnly, travelOverrides, planTimeOverrides, maxPrice }));
  } catch (e) { /* storage may be unavailable */ }
}

// ── helpers ─────────────────────────────────────────────────────────────
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const toTop = () => { try { window.scrollTo({ top: 0, behavior: 'auto' }); } catch (e) {} };
const isFree = (p) => biayaMin(p) === 0;
const hasTransport = (p) => (EXTRA[p.id]?.transport || []).length > 0;
const allAreas = () => ['all', ...Array.from(new Set(RAW.map(p => p.area).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'id'))];
const PRICE_FILTERS = [['all', 'Semua'], [0, 'Gratis'], [25000, '≤25k'], [50000, '≤50k'], [100000, '≤100k']];
const categoryBadges = (p, limit = 3) => categoryTagsOf(p).slice(0, limit)
  .map(label => `<span class="cat-tag">${esc(label)}</span>`).join('');

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
    if (Number.isFinite(+state.maxPrice) && biayaMin(p) > +state.maxPrice) return false;
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

function fallbackPlanUrl() {
  const ids = state.plan.join(',');
  const url = new URL(location.href);
  url.searchParams.set('plan', ids);
  return url.toString();
}

async function sharePlanUrl() {
  const ids = state.plan.join(',');
  if (!ids) return '';
  // Prefer DB-backed share links so crawlers get stable OG metadata and a
  // plan-specific image. Fall back to the old query-string link when offline.
  if (apiOk) {
    try {
      const res = await fetch(`${API_BASE}/plan/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: state.plan })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.url) return data.url;
      }
    } catch (e) { /* backend unavailable: use client-only fallback below */ }
    return `${location.origin}/s/plan?ids=${encodeURIComponent(ids)}`;
  }
  return fallbackPlanUrl();
}

function downloadPlanIcs() {
  const plan = planComputed(state);
  const ex = planExports(plan);
  if (!ex.ics) return;
  const encoded = ex.ics.split(',')[1] || '';
  const ics = decodeURIComponent(encoded);
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'rencana-harian.ics';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function coordOf(p) {
  return Number.isFinite(+p.lat) && Number.isFinite(+p.lng) ? `${p.lat},${p.lng}` : '';
}

function googleTransitUrl({ from = '', to }) {
  const url = new URL('https://www.google.com/maps/dir/');
  url.searchParams.set('api', '1');
  url.searchParams.set('travelmode', 'transit');
  if (from) url.searchParams.set('origin', from);
  url.searchParams.set('destination', to);
  return url.toString();
}

function googlePlaceUrl(p) {
  const url = new URL('https://www.google.com/maps/search/');
  url.searchParams.set('api', '1');
  url.searchParams.set('query', coordOf(p) || `${p.lokasiNama || p.area || p.nama} Jakarta`);
  return url.toString();
}

function routeToUrl(p) {
  const from = Number.isFinite(state.userLat) && Number.isFinite(state.userLng)
    ? `${state.userLat},${state.userLng}`
    : '';
  return googleTransitUrl({ from, to: coordOf(p) || p.lokasiNama || p.nama });
}

function routeBetweenUrl(a, b) {
  return googleTransitUrl({
    from: coordOf(a) || a.lokasiNama || a.nama,
    to: coordOf(b) || b.lokasiNama || b.nama
  });
}

function calendarDateRange(p) {
  const pad = (n) => String(n).padStart(2, '0');
  const t = p.t || parseJam(p.jam);
  const dt = new Date();
  const day = '' + dt.getFullYear() + pad(dt.getMonth() + 1) + pad(dt.getDate());
  const time = (mins) => pad(Math.floor(mins / 60)) + pad(mins % 60) + '00';
  return `${day}T${time(t.start)}/${day}T${time(t.end)}`;
}

function googleCalendarUrl(p) {
  const url = new URL('https://calendar.google.com/calendar/render');
  url.searchParams.set('action', 'TEMPLATE');
  url.searchParams.set('text', p.nama);
  url.searchParams.set('dates', calendarDateRange(p));
  url.searchParams.set('location', p.lokasiNama || p.area || 'Jakarta');
  url.searchParams.set('details', `${p.tanggal} · ${p.jam}\n${p.link || ''}`.trim());
  return url.toString();
}

function openPlanInGoogleCalendar() {
  const plan = planComputed(state);
  if (!plan.events.length) return;
  plan.events.forEach((event, index) => {
    setTimeout(() => window.open(googleCalendarUrl(event), '_blank', 'noopener'), index * 450);
  });
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

function setState(patch, opts = {}) {
  Object.assign(state, patch);
  persist();
  if (opts.syncUrl !== false) syncUrl(!!opts.replaceUrl);
  render();
}

// ── state transitions (ported from DCLogic) ─────────────────────────────
const App = {
  go(screen) { setState({ screen, filterOpen: false, planOpen: false, detailId: null }); toTop(); },
  startWizard() { setState({ screen: 'wizard', step: 1, filterOpen: false, detailId: null }); toTop(); },
  backHome() { App.go('landing'); },
  goHasil() { App.go('hasil'); },
  goKalender() { setState({ screen: 'kalender', planOpen: false, filterOpen: false, detailId: null }); toTop(); },
  goRencana() { setState({ screen: 'hasil', planOpen: true, filterOpen: false, detailId: null }); toTop(); },
  // tap a category pill on the landing → jump to results pre-filtered to it
  exploreCat(label) { setState({ screen: 'hasil', query: label, curatorId: null, filterOpen: false, planOpen: false, detailId: null }); toTop(); },

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
  resetFilter() { setState({ ageGroup: 'all', interests: [], location: '', userLat: null, userLng: null, locStatus: '', favoritesOnly: false, freeOnly: false, signupFilter: 'all', areaFilter: 'all', transportOnly: false, maxPrice: 'all' }); },

  togglePlan(id) {
    const plan = state.plan.includes(id) ? state.plan.filter(x => x !== id) : [...state.plan, id];
    if (!state.plan.includes(id)) track('plan_add', id, plan.length);
    setState({ plan });
  },
  removeFromPlan(id) {
    const plan = state.plan.filter(x => x !== id);
    const travelOverrides = Object.fromEntries(Object.entries(state.travelOverrides || {}).filter(([k]) => !k.startsWith(id + '>') && !k.endsWith('>' + id)));
    const planTimeOverrides = { ...(state.planTimeOverrides || {}) };
    delete planTimeOverrides[id];
    setState({ plan, travelOverrides, planTimeOverrides });
  },
  setPlanTime(id, field, value) {
    const planTimeOverrides = { ...(state.planTimeOverrides || {}) };
    const next = { ...(planTimeOverrides[id] || {}) };
    if (value) next[field] = value;
    else delete next[field];
    if (next.start || next.end) planTimeOverrides[id] = next;
    else delete planTimeOverrides[id];
    setState({ planTimeOverrides });
  },
  clearPlanTime(id) {
    const planTimeOverrides = { ...(state.planTimeOverrides || {}) };
    delete planTimeOverrides[id];
    setState({ planTimeOverrides });
  },
  setTravelOverride(key, value) {
    const minutes = parseInt(value, 10);
    const travelOverrides = { ...(state.travelOverrides || {}) };
    if (!Number.isFinite(minutes) || minutes <= 0) delete travelOverrides[key];
    else travelOverrides[key] = Math.min(240, Math.max(1, minutes));
    setState({ travelOverrides });
  },
  clearTravelOverride(key) {
    const travelOverrides = { ...(state.travelOverrides || {}) };
    delete travelOverrides[key];
    setState({ travelOverrides });
  },
  setWhen(w) { setState({ when: w }); },
  openPlan() { setState({ planOpen: true, detailId: null }); },
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
  toggleSheet() { setState({ sheet: state.sheet === 'full' ? 'peek' : 'full' }); },
  setSheet(v) { if (state.sheet !== v) setState({ sheet: v }); },
  toggleFavorite(id) {
    const favorites = state.favorites.includes(id) ? state.favorites.filter(x => x !== id) : [...state.favorites, id];
    if (!state.favorites.includes(id)) track('favorite', id);
    setState({ favorites });
  },
  toggleFavoritesOnly() { setState({ favoritesOnly: !state.favoritesOnly }); },
  toggleFreeOnly() { setState({ freeOnly: !state.freeOnly }); },
  setSignupFilter(v) { setState({ signupFilter: v }); },
  setAreaFilter(v) { setState({ areaFilter: v }); },
  setMaxPrice(v) { setState({ maxPrice: v === 'all' ? 'all' : Math.max(0, parseInt(v, 10) || 0) }); },
  toggleTransportOnly() { setState({ transportOnly: !state.transportOnly }); },
  async copyPlanLink() {
    if (!state.plan.length) return;
    const url = await sharePlanUrl();
    const done = () => { track('share', null, state.plan.length); alert('Link rencana disalin.'); };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url).then(done).catch(() => prompt('Salin link rencana:', url));
    else prompt('Salin link rencana:', url);
  },
  async sharePlanWhatsApp() {
    if (!state.plan.length) return;
    const popup = window.open('', '_blank', 'noopener');
    const url = await sharePlanUrl();
    const plan = planComputed(state);
    const text = `Rencana Harian — Internacia Jakarta\n${plan.dayStart}–${plan.dayEnd} · ${plan.events.length} kegiatan\n\n${url}`;
    track('share', null, state.plan.length);
    const shareUrl = 'https://wa.me/?text=' + encodeURIComponent(text);
    if (popup) popup.location = shareUrl;
    else location.href = shareUrl;
  },
  trackShare() { track('share', null, state.plan.length); },
  downloadPlanIcs() {
    downloadPlanIcs();
    track('reminder', null, state.plan.length);
  },
  openPlanGoogleCalendar() {
    openPlanInGoogleCalendar();
    track('reminder', null, state.plan.length);
  },
  trackReminder(id) { track('reminder', id); },

  // curator personas: pick one → results show that curator's handpicked set.
  selectCurator(id) {
    const next = state.curatorId === id ? null : id; // tap again to clear
    setState({ screen: 'hasil', curatorId: next, selectedId: null, filterOpen: false, planOpen: false, detailId: null });
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
    categoryBadges: categoryBadges(p),
    timeModeLabel: timeModeLabelOf(p),
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
    <div class="cat-tags">${m.categoryBadges}</div>
    <h3>${esc(p.nama)}</h3>
    <div class="org">${esc(p.penyelenggara)}</div>
    <p class="desc">${esc(p.deskripsi)}</p>
    <div class="meta">
      <div class="row"><span class="ic">${ic('pin')}</span>${esc(p.lokasiNama)}</div>
      <div class="row"><span class="ic">${ic('user')}</span>${m.usiaLabel}</div>
      <div class="row"><span class="ic">${ic('calendar')}</span>${esc(p.tanggal)} · ${ic('clock')} ${m.timeModeLabel}: ${esc(p.jam)}</div>
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
      <div class="cat-tags mini">${m.categoryBadges}</div>
      <div class="cmeta">${ic('pin')} ${esc(p.area)}${m.distanceLabel ? ' · ' + m.distanceLabel : ''} · ${ic('calendar')} ${esc(p.tanggal)}</div>
      ${hot >= 2 ? `<div class="hotline">🔥 Ditambahin ke ${hot} rencana minggu ini</div>` : ''}
      ${m.blurb ? `<div class="curator-note compact">“${esc(m.blurb)}”</div>` : ''}
    </div>
    <button class="plan-mini fav${m.favorite ? ' in' : ''}" title="Favorit" onclick="event.stopPropagation();App.toggleFavorite('${p.id}')">${ic('star')}</button>
    <button class="plan-mini${m.inPlan ? ' in' : ''}" title="Tambah ke rencana" onclick="event.stopPropagation();App.togglePlan('${p.id}')">${m.inPlan ? '✓' : '＋'}</button>
  </div>`;
}

// Karcis card for the phone map carousel: emoji stub + perforation echo the
// hero "ticket", corner triangle carries the category color (same as .card).
function gCard(p) {
  const m = programModel(p), c = catColorOf(p);
  const urg = urgencyOf(p);
  return `
  <article class="gcard${m.selected ? ' sel' : ''}" data-id="${p.id}" style="--cat:${c}" onclick="App.openDetail('${p.id}')">
    <div class="gc-stub" style="background:${p.mediaUrl ? `url('${esc(p.mediaUrl)}') center/cover` : c + '14'}">${p.mediaUrl ? '' : `<span>${p.emoji}</span>`}</div>
    <div class="gc-body">
      <div class="gc-top">
        <span class="badge" style="color:${c};background:${c}1A">${m.catLabel}</span>
        <span class="gc-price">${m.biayaLabel}</span>
      </div>
      <h3>${esc(p.nama)}</h3>
      <div class="gc-meta">${ic('pin')} ${esc(p.area)}${m.distanceLabel ? ' · ' + m.distanceLabel : ''}</div>
      <div class="gc-meta">${ic('calendar')} ${esc(p.tanggal)}${urg ? ` <span class="urg">⏳ ${urg}</span>` : ''}</div>
    </div>
    <button class="gc-plan${m.inPlan ? ' in' : ''}" title="Tambah ke rencana" onclick="event.stopPropagation();App.togglePlan('${p.id}')">${m.inPlan ? '✓' : '＋'}</button>
  </article>`;
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
let mapEl = null, map = null, transitLayer = null, stationLayer = null, markerLayer = null, markerPrograms = [], _lastSelected = undefined;
const mapStash = (() => { const d = document.createElement('div'); d.style.display = 'none'; document.body.appendChild(d); return d; })();

// OSM route-relation rail geometries, fetched 2026-07-08 and simplified for map anchors.
const TRANSIT_LINES = [
  {
    name: 'MRT North-South',
    shortName: 'MRT',
    color: '#CE0037',
    weight: 8,
    labelAt: [-6.22239, 106.808623],
    points: [
      [-6.28943, 106.769276],
      [-6.289315, 106.770565],
      [-6.289305, 106.771634],
      [-6.289266, 106.773271],
      [-6.289296, 106.774932],
      [-6.289311, 106.776065],
      [-6.289166, 106.777227],
      [-6.28932, 106.778245],
      [-6.289904, 106.779249],
      [-6.290708, 106.780628],
      [-6.291072, 106.781668],
      [-6.291538, 106.78323],
      [-6.292061, 106.78492],
      [-6.292363, 106.786085],
      [-6.292434, 106.787418],
      [-6.292463, 106.790543],
      [-6.292471, 106.792463],
      [-6.292485, 106.793627],
      [-6.292055, 106.794685],
      [-6.291091, 106.795216],
      [-6.289757, 106.795359],
      [-6.288367, 106.795371],
      [-6.286618, 106.79567],
      [-6.28546, 106.795848],
      [-6.284135, 106.79598],
      [-6.282379, 106.796084],
      [-6.281062, 106.796382],
      [-6.279615, 106.796965],
      [-6.278372, 106.797342],
      [-6.277274, 106.79765],
      [-6.274887, 106.797734],
      [-6.273201, 106.797671],
      [-6.271819, 106.797593],
      [-6.270185, 106.797482],
      [-6.268251, 106.797332],
      [-6.266696, 106.797344],
      [-6.265499, 106.7974],
      [-6.264302, 106.797334],
      [-6.263178, 106.797005],
      [-6.262043, 106.796672],
      [-6.260174, 106.796745],
      [-6.257812, 106.796958],
      [-6.256782, 106.797061],
      [-6.255787, 106.797172],
      [-6.25448, 106.797295],
      [-6.253421, 106.797368],
      [-6.251103, 106.797495],
      [-6.249774, 106.797556],
      [-6.247781, 106.797804],
      [-6.246587, 106.797975],
      [-6.245424, 106.798203],
      [-6.244423, 106.798239],
      [-6.243223, 106.798238],
      [-6.242046, 106.798447],
      [-6.239907, 106.798472],
      [-6.238771, 106.79847],
      [-6.236618, 106.798473],
      [-6.235263, 106.798481],
      [-6.233667, 106.798484],
      [-6.232204, 106.798489],
      [-6.230863, 106.798704],
      [-6.229753, 106.799172],
      [-6.228747, 106.799963],
      [-6.226784, 106.802524],
      [-6.225192, 106.804648],
      [-6.224121, 106.806058],
      [-6.222442, 106.808665],
      [-6.221629, 106.809718],
      [-6.22002, 106.811756],
      [-6.218619, 106.813519],
      [-6.217795, 106.814563],
      [-6.216628, 106.816058],
      [-6.215857, 106.817037],
      [-6.215063, 106.817995],
      [-6.214244, 106.818847],
      [-6.213245, 106.819643],
      [-6.211617, 106.820552],
      [-6.210248, 106.821247],
      [-6.209095, 106.821762],
      [-6.20773, 106.822092],
      [-6.205852, 106.822298],
      [-6.204657, 106.822381],
      [-6.203603, 106.822417],
      [-6.202106, 106.822597],
      [-6.200802, 106.822828],
      [-6.19895, 106.823146],
      [-6.19724, 106.823177],
      [-6.195995, 106.823155],
      [-6.19409, 106.823119],
      [-6.192406, 106.823078],
      [-6.191026, 106.823039]
    ]
  },
  {
    name: 'KRL Bogor Line',
    shortName: 'KRL',
    color: '#ec2329',
    weight: 7,
    labelAt: [-6.198505, 106.84128],
    points: [
      [-6.137855, 106.814854],
      [-6.137223, 106.816646],
      [-6.136565, 106.818884],
      [-6.136592, 106.820901],
      [-6.139625, 106.822369],
      [-6.141681, 106.823275],
      [-6.143279, 106.824235],
      [-6.145719, 106.82573],
      [-6.147564, 106.826528],
      [-6.150523, 106.827099],
      [-6.152782, 106.82733],
      [-6.158479, 106.827433],
      [-6.16044, 106.827578],
      [-6.162305, 106.828335],
      [-6.163921, 106.829477],
      [-6.16574, 106.830307],
      [-6.167562, 106.830468],
      [-6.17097, 106.829866],
      [-6.172868, 106.829756],
      [-6.17554, 106.830291],
      [-6.17855, 106.831231],
      [-6.18056, 106.831829],
      [-6.182812, 106.832157],
      [-6.185551, 106.832504],
      [-6.187406, 106.833085],
      [-6.189393, 106.83436],
      [-6.191444, 106.83591],
      [-6.193547, 106.837478],
      [-6.196298, 106.839572],
      [-6.199375, 106.841857],
      [-6.201145, 106.843183],
      [-6.205293, 106.846155],
      [-6.206896, 106.847143],
      [-6.208694, 106.848467],
      [-6.211205, 106.850308],
      [-6.212966, 106.851672],
      [-6.214976, 106.853395],
      [-6.216709, 106.85474],
      [-6.218312, 106.855959],
      [-6.220106, 106.857246],
      [-6.222078, 106.858056],
      [-6.224174, 106.858372],
      [-6.227532, 106.858428],
      [-6.230954, 106.858487],
      [-6.234064, 106.85854],
      [-6.236733, 106.858578],
      [-6.240973, 106.858636],
      [-6.24287, 106.85868],
      [-6.244965, 106.85872],
      [-6.246805, 106.858606],
      [-6.2486, 106.858094],
      [-6.25066, 106.857209],
      [-6.252431, 106.856386],
      [-6.254581, 106.85542],
      [-6.256705, 106.85446],
      [-6.258674, 106.853604],
      [-6.260471, 106.852815],
      [-6.262391, 106.851955],
      [-6.264298, 106.851099],
      [-6.268656, 106.849159],
      [-6.271562, 106.84784],
      [-6.273354, 106.847049],
      [-6.275786, 106.846238],
      [-6.277633, 106.845863],
      [-6.279406, 106.845541],
      [-6.281502, 106.845151],
      [-6.283767, 106.844757],
      [-6.285639, 106.844404],
      [-6.287591, 106.843826],
      [-6.290025, 106.842846],
      [-6.291811, 106.842108],
      [-6.293587, 106.841381],
      [-6.295637, 106.840727],
      [-6.29762, 106.840343],
      [-6.299671, 106.840204],
      [-6.301953, 106.839957],
      [-6.305164, 106.839422],
      [-6.307703, 106.838988],
      [-6.309692, 106.838647],
      [-6.315197, 106.837682],
      [-6.319749, 106.836885],
      [-6.321914, 106.83608],
      [-6.323521, 106.835027],
      [-6.325579, 106.833896],
      [-6.327566, 106.833678],
      [-6.329326, 106.834191],
      [-6.330986, 106.834976],
      [-6.332975, 106.835442],
      [-6.334881, 106.835334],
      [-6.33908, 106.834292],
      [-6.341768, 106.833665],
      [-6.343984, 106.833346],
      [-6.349376, 106.832617],
      [-6.354533, 106.831913],
      [-6.356963, 106.831633],
      [-6.359405, 106.831636]
    ]
  },
  {
    name: 'KRL Cikarang Line',
    shortName: 'KRL',
    color: '#1E88E5',
    weight: 7,
    labelAt: [-6.19362, 106.856512],
    points: [
      [-6.256681, 107.048947],
      [-6.256208, 107.047114],
      [-6.25568, 107.045043],
      [-6.255165, 107.043168],
      [-6.25469, 107.04135],
      [-6.253941, 107.03856],
      [-6.253467, 107.036744],
      [-6.252917, 107.034719],
      [-6.252397, 107.032828],
      [-6.251566, 107.030675],
      [-6.250792, 107.028625],
      [-6.249608, 107.025555],
      [-6.247731, 107.020674],
      [-6.246781, 107.018185],
      [-6.246027, 107.016211],
      [-6.245023, 107.013557],
      [-6.244365, 107.011843],
      [-6.243691, 107.010123],
      [-6.24256, 107.007903],
      [-6.241421, 107.006074],
      [-6.239998, 107.004444],
      [-6.23869, 107.002672],
      [-6.237392, 107.000578],
      [-6.23524, 106.997126],
      [-6.234134, 106.995353],
      [-6.232789, 106.993168],
      [-6.23143, 106.990993],
      [-6.230339, 106.989286],
      [-6.228546, 106.986473],
      [-6.227484, 106.984726],
      [-6.225864, 106.982076],
      [-6.224452, 106.979879],
      [-6.223274, 106.978008],
      [-6.222324, 106.976327],
      [-6.221722, 106.974535],
      [-6.22137, 106.97194],
      [-6.221132, 106.969772],
      [-6.220752, 106.966658],
      [-6.220509, 106.964506],
      [-6.220293, 106.962683],
      [-6.220039, 106.960614],
      [-6.219695, 106.957743],
      [-6.219512, 106.955808],
      [-6.219089, 106.952061],
      [-6.218883, 106.95026],
      [-6.218618, 106.948342],
      [-6.21824, 106.945526],
      [-6.217935, 106.942948],
      [-6.217489, 106.939262],
      [-6.217242, 106.936969],
      [-6.21696, 106.934673],
      [-6.216551, 106.931219],
      [-6.216044, 106.927036],
      [-6.215785, 106.924867],
      [-6.215326, 106.921403],
      [-6.21512, 106.919427],
      [-6.21425, 106.912471],
      [-6.213981, 106.910207],
      [-6.213591, 106.907102],
      [-6.213381, 106.904691],
      [-6.213296, 106.901022],
      [-6.21324, 106.898647],
      [-6.213199, 106.895851],
      [-6.213129, 106.892527],
      [-6.213305, 106.890284],
      [-6.21383, 106.88855],
      [-6.214269, 106.884892],
      [-6.214548, 106.880119],
      [-6.214707, 106.877353],
      [-6.214838, 106.875556],
      [-6.21495, 106.873323],
      [-6.215023, 106.870337],
      [-6.21503, 106.868424],
      [-6.214409, 106.86652],
      [-6.21311, 106.865103],
      [-6.211863, 106.863512],
      [-6.211738, 106.861701],
      [-6.212879, 106.858917],
      [-6.214017, 106.856245],
      [-6.214532, 106.8543],
      [-6.213678, 106.852588],
      [-6.212009, 106.85134],
      [-6.210103, 106.849924],
      [-6.208425, 106.848651],
      [-6.206994, 106.847482],
      [-6.20583, 106.846071],
      [-6.205809, 106.844163],
      [-6.206524, 106.842466],
      [-6.205573, 106.838743],
      [-6.204597, 106.834036],
      [-6.204156, 106.830957],
      [-6.202937, 106.82574],
      [-6.20245, 106.823688],
      [-6.201353, 106.818681],
      [-6.200764, 106.815974],
      [-6.200315, 106.813952],
      [-6.199325, 106.81243],
      [-6.196461, 106.811134],
      [-6.194769, 106.810482],
      [-6.192635, 106.81024],
      [-6.189726, 106.810935],
      [-6.187631, 106.811147],
      [-6.185549, 106.810993],
      [-6.18292, 106.810741],
      [-6.180828, 106.81039],
      [-6.179095, 106.809827],
      [-6.174325, 106.806539],
      [-6.172463, 106.805253],
      [-6.169631, 106.803286],
      [-6.167897, 106.802263],
      [-6.161584, 106.801706],
      [-6.159499, 106.801608],
      [-6.157548, 106.80149],
      [-6.155594, 106.801446],
      [-6.15378, 106.801303],
      [-6.151787, 106.801168],
      [-6.148479, 106.80098],
      [-6.146142, 106.800831],
      [-6.143541, 106.80069],
      [-6.139182, 106.800451],
      [-6.136703, 106.800294],
      [-6.134791, 106.800481],
      [-6.133357, 106.801601],
      [-6.132113, 106.805656],
      [-6.131105, 106.809561],
      [-6.13058, 106.811544],
      [-6.130093, 106.813383],
      [-6.130292, 106.815268],
      [-6.132005, 106.818592],
      [-6.132831, 106.820559],
      [-6.132751, 106.822609],
      [-6.132418, 106.824464],
      [-6.132033, 106.826684],
      [-6.132701, 106.828931],
      [-6.134188, 106.830509],
      [-6.138531, 106.830692],
      [-6.140417, 106.831243],
      [-6.141511, 106.832812],
      [-6.14219, 106.834508],
      [-6.143436, 106.835956],
      [-6.145998, 106.837097],
      [-6.148094, 106.837703],
      [-6.152153, 106.838921],
      [-6.157999, 106.840331],
      [-6.160891, 106.841221],
      [-6.16268, 106.841783],
      [-6.165422, 106.842547],
      [-6.16723, 106.843026],
      [-6.169839, 106.84309],
      [-6.171804, 106.843546],
      [-6.173701, 106.844183],
      [-6.175426, 106.844859],
      [-6.17711, 106.8456],
      [-6.179622, 106.846266],
      [-6.185177, 106.850117],
      [-6.187188, 106.851618],
      [-6.190988, 106.85448],
      [-6.194051, 106.856794],
      [-6.19562, 106.857969],
      [-6.19764, 106.859038],
      [-6.200736, 106.860032],
      [-6.205027, 106.861213],
      [-6.208536, 106.86217],
      [-6.210503, 106.862772],
      [-6.212438, 106.864657],
      [-6.213934, 106.866312],
      [-6.214805, 106.868022],
      [-6.214764, 106.869829],
      [-6.214767, 106.871676],
      [-6.214866, 106.873568],
      [-6.214879, 106.875458],
      [-6.214583, 106.880212],
      [-6.214347, 106.88434],
      [-6.214207, 106.886506],
      [-6.213915, 106.888365],
      [-6.213341, 106.890298],
      [-6.21316, 106.892297],
      [-6.2132, 106.894154],
      [-6.213262, 106.89638],
      [-6.21336, 106.898653],
      [-6.213407, 106.900642],
      [-6.213397, 106.902517],
      [-6.213421, 106.904686],
      [-6.213626, 106.907091],
      [-6.213986, 106.909989],
      [-6.214276, 106.912396],
      [-6.214593, 106.914915],
      [-6.214923, 106.917529],
      [-6.215173, 106.91951],
      [-6.215428, 106.921391],
      [-6.215728, 106.923636],
      [-6.216064, 106.926876],
      [-6.216319, 106.929002],
      [-6.21657, 106.9311],
      [-6.216785, 106.932924],
      [-6.217075, 106.935417],
      [-6.217402, 106.937851],
      [-6.217647, 106.939811],
      [-6.217884, 106.941761],
      [-6.21821, 106.944916],
      [-6.218405, 106.946728],
      [-6.218713, 106.948689],
      [-6.218968, 106.950774],
      [-6.219378, 106.954269],
      [-6.219652, 106.956975],
      [-6.219868, 106.959065],
      [-6.220326, 106.962685],
      [-6.22065, 106.965419],
      [-6.221244, 106.970441],
      [-6.221614, 106.9736],
      [-6.222175, 106.975902],
      [-6.223308, 106.977988],
      [-6.224479, 106.979685],
      [-6.226357, 106.98278],
      [-6.227515, 106.984708],
      [-6.228578, 106.986465],
      [-6.229898, 106.988528],
      [-6.231222, 106.990587],
      [-6.232383, 106.992452],
      [-6.233446, 106.994151],
      [-6.234386, 106.995691],
      [-6.236949, 106.999783],
      [-6.238297, 107.001981],
      [-6.239302, 107.003546],
      [-6.240679, 107.005207],
      [-6.241892, 107.006651],
      [-6.242831, 107.008346],
      [-6.243706, 107.010088],
      [-6.244839, 107.012991],
      [-6.245662, 107.015165],
      [-6.246381, 107.016949],
      [-6.247086, 107.018723],
      [-6.247781, 107.020666],
      [-6.249286, 107.024571],
      [-6.250246, 107.027094],
      [-6.251285, 107.029814],
      [-6.252489, 107.032901],
      [-6.253653, 107.037319],
      [-6.254773, 107.041542],
      [-6.255471, 107.044097],
      [-6.256714, 107.048938]
    ]
  },
  {
    name: 'KRL Rangkasbitung Line',
    shortName: 'KRL',
    color: '#00843D',
    weight: 7,
    labelAt: [-6.23723, 106.782534],
    points: [
      [-6.322982, 106.651654],
      [-6.322821, 106.654864],
      [-6.322196, 106.656973],
      [-6.320757, 106.659231],
      [-6.320202, 106.661],
      [-6.320193, 106.663549],
      [-6.320179, 106.665474],
      [-6.320184, 106.667681],
      [-6.319937, 106.669494],
      [-6.318603, 106.671064],
      [-6.317178, 106.672255],
      [-6.316239, 106.673794],
      [-6.314935, 106.676108],
      [-6.313892, 106.677887],
      [-6.312601, 106.67952],
      [-6.311495, 106.681272],
      [-6.310772, 106.683186],
      [-6.309777, 106.68628],
      [-6.308531, 106.69022],
      [-6.307469, 106.692679],
      [-6.306713, 106.694329],
      [-6.30527, 106.697483],
      [-6.304188, 106.699919],
      [-6.302617, 106.702556],
      [-6.299865, 106.707339],
      [-6.298617, 106.709559],
      [-6.29756, 106.71142],
      [-6.296251, 106.713736],
      [-6.295333, 106.71533],
      [-6.294604, 106.717816],
      [-6.293886, 106.719617],
      [-6.292522, 106.721206],
      [-6.29137, 106.722722],
      [-6.290835, 106.725091],
      [-6.290167, 106.726962],
      [-6.288528, 106.729262],
      [-6.287233, 106.731107],
      [-6.285176, 106.734016],
      [-6.28412, 106.735496],
      [-6.282612, 106.737374],
      [-6.279043, 106.741814],
      [-6.276332, 106.745208],
      [-6.274619, 106.747366],
      [-6.273289, 106.748943],
      [-6.271973, 106.750256],
      [-6.26952, 106.752658],
      [-6.267963, 106.754161],
      [-6.266332, 106.755746],
      [-6.265013, 106.757151],
      [-6.263583, 106.759218],
      [-6.262105, 106.760716],
      [-6.259697, 106.761548],
      [-6.257735, 106.762107],
      [-6.255645, 106.764644],
      [-6.254816, 106.766335],
      [-6.254086, 106.768208],
      [-6.252242, 106.770713],
      [-6.250878, 106.772326],
      [-6.249426, 106.773735],
      [-6.244724, 106.777678],
      [-6.242982, 106.779156],
      [-6.241445, 106.780451],
      [-6.239851, 106.781561],
      [-6.237825, 106.782323],
      [-6.235995, 106.782959],
      [-6.234031, 106.78395],
      [-6.231004, 106.785759],
      [-6.228376, 106.7873],
      [-6.225931, 106.788772],
      [-6.224323, 106.789704],
      [-6.222083, 106.790691],
      [-6.220155, 106.791507],
      [-6.218039, 106.792376],
      [-6.216297, 106.793475],
      [-6.214551, 106.79523],
      [-6.212763, 106.796191],
      [-6.210905, 106.796163],
      [-6.208856, 106.796855],
      [-6.206222, 106.798055],
      [-6.20482, 106.799237],
      [-6.203817, 106.801369],
      [-6.202386, 106.804443],
      [-6.201324, 106.806755],
      [-6.199977, 106.808354],
      [-6.198499, 106.809629],
      [-6.196865, 106.81047],
      [-6.1942, 106.810079],
      [-6.192309, 106.810136],
      [-6.189618, 106.810868],
      [-6.186825, 106.810999],
      [-6.184773, 106.810773],
      [-6.183904, 106.810677]
    ]
  },
  {
    name: 'KRL Tangerang Line',
    shortName: 'KRL',
    color: '#8B5A2B',
    weight: 7,
    labelAt: [-6.161252, 106.771908],
    points: [
      [-6.154353, 106.801145],
      [-6.156524, 106.80124],
      [-6.158434, 106.801364],
      [-6.160203, 106.800586],
      [-6.161262, 106.798448],
      [-6.162032, 106.796441],
      [-6.162257, 106.794365],
      [-6.162109, 106.790581],
      [-6.161998, 106.787268],
      [-6.16189, 106.784639],
      [-6.161776, 106.781564],
      [-6.161596, 106.776613],
      [-6.161493, 106.773797],
      [-6.161189, 106.771586],
      [-6.1609, 106.769704],
      [-6.160661, 106.767883],
      [-6.159966, 106.763142],
      [-6.159585, 106.761258],
      [-6.159152, 106.759217],
      [-6.158715, 106.75712],
      [-6.158184, 106.754563],
      [-6.1579, 106.752533],
      [-6.158116, 106.748665],
      [-6.158431, 106.745663],
      [-6.158649, 106.743168],
      [-6.158821, 106.740789],
      [-6.159222, 106.738498],
      [-6.159932, 106.736771],
      [-6.160537, 106.73503],
      [-6.16114, 106.731832],
      [-6.161939, 106.727471],
      [-6.16232, 106.725237],
      [-6.162756, 106.72278],
      [-6.163074, 106.720875],
      [-6.164178, 106.714328],
      [-6.164736, 106.710965],
      [-6.16579, 106.704702],
      [-6.166151, 106.702511],
      [-6.1667, 106.699174],
      [-6.167244, 106.695869],
      [-6.16772, 106.692917],
      [-6.168913, 106.685683],
      [-6.16979, 106.680274],
      [-6.17033, 106.676873],
      [-6.171242, 106.671212],
      [-6.171553, 106.669258],
      [-6.171924, 106.667098],
      [-6.172407, 106.663944],
      [-6.17308, 106.659803],
      [-6.173361, 106.657963],
      [-6.174044, 106.653679],
      [-6.174363, 106.651656]
    ]
  },
  {
    name: 'KRL Tanjung Priok Line',
    shortName: 'KRL',
    color: '#EC407A',
    weight: 7,
    labelAt: [-6.128115, 106.845137],
    points: [
      [-6.137669, 106.814797],
      [-6.137254, 106.816194],
      [-6.136668, 106.818018],
      [-6.136224, 106.819791],
      [-6.135395, 106.821482],
      [-6.134548, 106.823095],
      [-6.133453, 106.826967],
      [-6.132704, 106.829213],
      [-6.131857, 106.83135],
      [-6.130398, 106.834263],
      [-6.129754, 106.836059],
      [-6.129256, 106.838941],
      [-6.128556, 106.842805],
      [-6.128143, 106.844855],
      [-6.127534, 106.848204],
      [-6.12721, 106.849993],
      [-6.126808, 106.851841],
      [-6.126048, 106.853815],
      [-6.12526, 106.85553],
      [-6.124005, 106.858264],
      [-6.122672, 106.861776],
      [-6.122197, 106.863719],
      [-6.121754, 106.866127],
      [-6.12086, 106.868164],
      [-6.119238, 106.870317],
      [-6.117924, 106.872016],
      [-6.116691, 106.873613],
      [-6.115448, 106.875222],
      [-6.114196, 106.876899],
      [-6.112884, 106.878476],
      [-6.110601, 106.88145]
    ]
  },
  {
    name: 'LRT Jakarta',
    shortName: 'LRT',
    color: '#f16227',
    weight: 7,
    labelAt: [-6.17731, 106.893393],
    points: [
      [-6.192666, 106.891198],
      [-6.191009, 106.891216],
      [-6.188946, 106.891165],
      [-6.187706, 106.891142],
      [-6.184994, 106.891213],
      [-6.183826, 106.891336],
      [-6.180798, 106.891869],
      [-6.178489, 106.892658],
      [-6.177319, 106.893416],
      [-6.176374, 106.894113],
      [-6.175693, 106.8953],
      [-6.174856, 106.896253],
      [-6.173408, 106.897252],
      [-6.170312, 106.899173],
      [-6.169008, 106.900039],
      [-6.167313, 106.901134],
      [-6.160882, 106.905135],
      [-6.159661, 106.905876],
      [-6.15654, 106.907838],
      [-6.155286, 106.908664],
      [-6.154611, 106.909657],
      [-6.154754, 106.91085],
      [-6.154841, 106.912183],
      [-6.154904, 106.913553],
      [-6.155911, 106.91415],
      [-6.157205, 106.914138]
    ]
  },
  {
    name: 'LRT Jabodebek Cibubur Line',
    shortName: 'LRT',
    color: '#20409A',
    weight: 7,
    labelAt: [-6.309549, 106.88438],
    points: [
      [-6.204851, 106.825525],
      [-6.205126, 106.82684],
      [-6.205341, 106.828045],
      [-6.206305, 106.828845],
      [-6.207332, 106.829522],
      [-6.208571, 106.830026],
      [-6.2097, 106.830286],
      [-6.211021, 106.830409],
      [-6.212618, 106.830418],
      [-6.216178, 106.830667],
      [-6.218046, 106.831019],
      [-6.219496, 106.831474],
      [-6.220652, 106.831956],
      [-6.222886, 106.832531],
      [-6.224051, 106.832811],
      [-6.225217, 106.832912],
      [-6.228787, 106.833182],
      [-6.230042, 106.833192],
      [-6.231129, 106.832884],
      [-6.232187, 106.832377],
      [-6.233099, 106.831647],
      [-6.233945, 106.830592],
      [-6.234585, 106.829253],
      [-6.235363, 106.828199],
      [-6.236324, 106.827518],
      [-6.237511, 106.82762],
      [-6.238145, 106.828556],
      [-6.238729, 106.829723],
      [-6.239328, 106.830702],
      [-6.240054, 106.83178],
      [-6.240666, 106.832927],
      [-6.241263, 106.835027],
      [-6.241553, 106.836192],
      [-6.241978, 106.837818],
      [-6.242318, 106.839082],
      [-6.242624, 106.840192],
      [-6.242966, 106.841436],
      [-6.243477, 106.842634],
      [-6.243805, 106.846024],
      [-6.24367, 106.84801],
      [-6.243604, 106.849651],
      [-6.243458, 106.851911],
      [-6.243463, 106.855601],
      [-6.243504, 106.857072],
      [-6.243529, 106.858287],
      [-6.243529, 106.85974],
      [-6.243491, 106.861104],
      [-6.243441, 106.862242],
      [-6.243435, 106.863398],
      [-6.243546, 106.864522],
      [-6.243858, 106.865802],
      [-6.244301, 106.867057],
      [-6.245367, 106.869559],
      [-6.245796, 106.870751],
      [-6.246223, 106.872376],
      [-6.24654, 106.87358],
      [-6.247244, 106.874539],
      [-6.248176, 106.875608],
      [-6.24947, 106.875418],
      [-6.250556, 106.874302],
      [-6.25139, 106.873427],
      [-6.252539, 106.872626],
      [-6.254885, 106.871715],
      [-6.255995, 106.871864],
      [-6.25672, 106.87277],
      [-6.25874, 106.873386],
      [-6.259937, 106.873462],
      [-6.263748, 106.873228],
      [-6.265579, 106.873357],
      [-6.266723, 106.873414],
      [-6.268904, 106.873054],
      [-6.270165, 106.872964],
      [-6.271269, 106.87298],
      [-6.272914, 106.873068],
      [-6.274416, 106.873304],
      [-6.276022, 106.873671],
      [-6.277347, 106.874102],
      [-6.278435, 106.874557],
      [-6.279818, 106.875106],
      [-6.283742, 106.876761],
      [-6.285273, 106.877493],
      [-6.286253, 106.878027],
      [-6.287618, 106.878636],
      [-6.288808, 106.879101],
      [-6.290098, 106.879531],
      [-6.29141, 106.879979],
      [-6.292911, 106.880543],
      [-6.29556, 106.881602],
      [-6.296608, 106.882012],
      [-6.298515, 106.882783],
      [-6.299716, 106.883266],
      [-6.302155, 106.883757],
      [-6.303274, 106.884025],
      [-6.304233, 106.884644],
      [-6.305872, 106.884109],
      [-6.306962, 106.883889],
      [-6.308901, 106.884247],
      [-6.310429, 106.884525],
      [-6.311507, 106.885052],
      [-6.312575, 106.885389],
      [-6.313951, 106.88569],
      [-6.315131, 106.885948],
      [-6.31663, 106.88621],
      [-6.317789, 106.886392],
      [-6.319277, 106.88657],
      [-6.321212, 106.886616],
      [-6.32313, 106.886608],
      [-6.324364, 106.886629],
      [-6.326432, 106.886673],
      [-6.328283, 106.886763],
      [-6.329919, 106.886834],
      [-6.331625, 106.887022],
      [-6.337145, 106.887926],
      [-6.338622, 106.888306],
      [-6.340166, 106.888623],
      [-6.342173, 106.889004],
      [-6.343378, 106.889229],
      [-6.346241, 106.889766],
      [-6.349544, 106.890664],
      [-6.351463, 106.891187],
      [-6.353223, 106.891691],
      [-6.355043, 106.892225],
      [-6.356531, 106.892593],
      [-6.359858, 106.893177]
    ]
  },
  {
    name: 'LRT Jabodebek Bekasi',
    shortName: 'LRT',
    color: '#0E6938',
    weight: 7,
    labelAt: [-6.2566, 106.951873],
    points: [
      [-6.204851, 106.825525],
      [-6.205126, 106.82684],
      [-6.205341, 106.828045],
      [-6.206305, 106.828845],
      [-6.207332, 106.829522],
      [-6.208571, 106.830026],
      [-6.2097, 106.830286],
      [-6.211021, 106.830409],
      [-6.212618, 106.830418],
      [-6.216178, 106.830667],
      [-6.218046, 106.831019],
      [-6.219496, 106.831474],
      [-6.220652, 106.831956],
      [-6.222886, 106.832531],
      [-6.224051, 106.832811],
      [-6.225217, 106.832912],
      [-6.228787, 106.833182],
      [-6.230042, 106.833192],
      [-6.231129, 106.832884],
      [-6.232187, 106.832377],
      [-6.233099, 106.831647],
      [-6.233945, 106.830592],
      [-6.234585, 106.829253],
      [-6.235363, 106.828199],
      [-6.236324, 106.827518],
      [-6.237511, 106.82762],
      [-6.238145, 106.828556],
      [-6.238729, 106.829723],
      [-6.239328, 106.830702],
      [-6.240054, 106.83178],
      [-6.240666, 106.832927],
      [-6.241263, 106.835027],
      [-6.241553, 106.836192],
      [-6.241978, 106.837818],
      [-6.242318, 106.839082],
      [-6.242624, 106.840192],
      [-6.242966, 106.841436],
      [-6.243477, 106.842634],
      [-6.243805, 106.846024],
      [-6.24367, 106.84801],
      [-6.243604, 106.849651],
      [-6.243458, 106.851911],
      [-6.243463, 106.855601],
      [-6.243504, 106.857072],
      [-6.243529, 106.858287],
      [-6.243529, 106.85974],
      [-6.243491, 106.861104],
      [-6.243441, 106.862242],
      [-6.243435, 106.863398],
      [-6.243546, 106.864522],
      [-6.243858, 106.865802],
      [-6.244301, 106.867057],
      [-6.245367, 106.869559],
      [-6.245796, 106.870751],
      [-6.246223, 106.872376],
      [-6.24654, 106.87358],
      [-6.247244, 106.874539],
      [-6.248157, 106.875652],
      [-6.248796, 106.876598],
      [-6.247868, 106.87851],
      [-6.24729, 106.879462],
      [-6.247173, 106.881375],
      [-6.247281, 106.883396],
      [-6.247192, 106.884557],
      [-6.246776, 106.885865],
      [-6.246023, 106.887093],
      [-6.245308, 106.888085],
      [-6.244538, 106.889219],
      [-6.243999, 106.890272],
      [-6.243725, 106.891457],
      [-6.243624, 106.892922],
      [-6.243937, 106.894523],
      [-6.244483, 106.895855],
      [-6.245524, 106.897422],
      [-6.246553, 106.898418],
      [-6.248043, 106.899493],
      [-6.25032, 106.900797],
      [-6.251513, 106.901543],
      [-6.252492, 106.902354],
      [-6.253399, 106.903341],
      [-6.254177, 106.904481],
      [-6.255006, 106.906331],
      [-6.255396, 106.907654],
      [-6.257448, 106.912594],
      [-6.257812, 106.913837],
      [-6.258066, 106.915036],
      [-6.258163, 106.916365],
      [-6.258226, 106.918143],
      [-6.258184, 106.919712],
      [-6.25812, 106.921446],
      [-6.257907, 106.924849],
      [-6.2578, 106.926871],
      [-6.257291, 106.936902],
      [-6.257219, 106.938442],
      [-6.257127, 106.940355],
      [-6.256709, 106.943021],
      [-6.256852, 106.945749],
      [-6.256793, 106.948161],
      [-6.25672, 106.94972],
      [-6.256617, 106.951854],
      [-6.256339, 106.954165],
      [-6.256262, 106.955394],
      [-6.255803, 106.95794],
      [-6.255509, 106.959197],
      [-6.255394, 106.960791],
      [-6.255174, 106.961898],
      [-6.25468, 106.96318],
      [-6.253957, 106.965022],
      [-6.252327, 106.96793],
      [-6.250942, 106.970014],
      [-6.250159, 106.971349],
      [-6.249634, 106.972461],
      [-6.249038, 106.974121],
      [-6.248709, 106.975517],
      [-6.248518, 106.9771],
      [-6.248509, 106.978854],
      [-6.248591, 106.980119],
      [-6.248826, 106.981295],
      [-6.249427, 106.98308],
      [-6.250479, 106.985424],
      [-6.251261, 106.986878],
      [-6.252981, 106.990413],
      [-6.254472, 106.9944],
      [-6.259047, 107.007205],
      [-6.259489, 107.008372],
      [-6.260068, 107.010093],
      [-6.262965, 107.018308],
      [-6.26346, 107.019768],
      [-6.264126, 107.021665]
    ]
  }
];

// Station dots use OSM station coordinates from the same 2026-07-08 research pass.
const TRANSIT_STATIONS = [
  ['MRT', '#CE0037', 'Lebak Bulus BSI', -6.289274, 106.774935],
  ['MRT', '#CE0037', 'Fatmawati', -6.292451, 106.792464],
  ['MRT', '#CE0037', 'Cipete Raya', -6.278360, 106.797316],
  ['MRT', '#CE0037', 'Haji Nawi', -6.266695, 106.797326],
  ['MRT', '#CE0037', 'Blok A', -6.255779, 106.797140],
  ['MRT', '#CE0037', 'Blok M', -6.244464, 106.798133],
  ['MRT', '#CE0037', 'ASEAN', -6.238774, 106.798446],
  ['MRT', '#CE0037', 'Senayan', -6.226734, 106.802493],
  ['MRT', '#CE0037', 'Istora', -6.222390, 106.808623],
  ['MRT', '#CE0037', 'Bendungan Hilir', -6.215026, 106.817948],
  ['MRT', '#CE0037', 'Setiabudi Astra', -6.209065, 106.821695],
  ['MRT', '#CE0037', 'Dukuh Atas BNI', -6.200796, 106.822788],
  ['MRT', '#CE0037', 'Bundaran HI', -6.191864, 106.823008],
  ['KRL', '#ec2329', 'Jakarta Kota', -6.137583, 106.814620],
  ['KRL', '#ec2329', 'Jayakarta', -6.141300, 106.823132],
  ['KRL', '#ec2329', 'Mangga Besar', -6.149804, 106.826983],
  ['KRL', '#ec2329', 'Sawah Besar', -6.160667, 106.827655],
  ['KRL', '#ec2329', 'Juanda', -6.166675, 106.830461],
  ['KRL', '#ec2329', 'Gondangdia', -6.185911, 106.832566],
  ['KRL', '#ec2329', 'Cikini', -6.198505, 106.841280],
  ['KRL', '#ec2329', 'Manggarai', -6.210170, 106.849935],
  ['KRL', '#ec2329', 'Tebet', -6.226398, 106.858439],
  ['KRL', '#ec2329', 'Cawang', -6.242552, 106.858690],
  ['KRL', '#ec2329', 'Duren Kalibata', -6.255201, 106.855167],
  ['KRL', '#ec2329', 'Pasar Minggu Baru', -6.262798, 106.851796],
  ['KRL', '#ec2329', 'Pasar Minggu', -6.283332, 106.844856],
  ['KRL', '#ec2329', 'Tanjung Barat', -6.308041, 106.838949],
  ['KRL', '#ec2329', 'Lenteng Agung', -6.330308, 106.834679],
  ['KRL', '#1E88E5', 'Kampung Bandan', -6.132702, 106.828487],
  ['KRL', '#1E88E5', 'Rajawali', -6.145100, 106.836832],
  ['KRL', '#1E88E5', 'Kemayoran', -6.161703, 106.841401],
  ['KRL', '#1E88E5', 'Pasar Senen', -6.174423, 106.844574],
  ['KRL', '#1E88E5', 'Gang Sentiong', -6.186153, 106.850871],
  ['KRL', '#1E88E5', 'Kramat', -6.193620, 106.856512],
  ['KRL', '#1E88E5', 'Pondok Jati', -6.209124, 106.862342],
  ['KRL', '#1E88E5', 'Jatinegara', -6.214925, 106.870339],
  ['KRL', '#1E88E5', 'Klender', -6.213319, 106.899413],
  ['KRL', '#1E88E5', 'Buaran', -6.215606, 106.923160],
  ['KRL', '#1E88E5', 'Klender Baru', -6.217659, 106.940183],
  ['KRL', '#1E88E5', 'Cakung', -6.219081, 106.952479],
  ['KRL', '#1E88E5', 'Kranji', -6.224513, 106.979827],
  ['KRL', '#1E88E5', 'Bekasi', -6.236214, 106.998744],
  ['KRL', '#00843D', 'Tanah Abang', -6.185713, 106.810894],
  ['KRL', '#00843D', 'Palmerah', -6.207920, 106.797232],
  ['KRL', '#00843D', 'Kebayoran', -6.237230, 106.782534],
  ['KRL', '#00843D', 'Pondok Ranji', -6.276683, 106.744693],
  ['KRL', '#00843D', 'Jurangmangu', -6.288582, 106.729146],
  ['KRL', '#00843D', 'Sudimara', -6.296844, 106.712647],
  ['KRL', '#00843D', 'Rawa Buntu', -6.314884, 106.676152],
  ['KRL', '#8B5A2B', 'Duri', -6.155276, 106.801297],
  ['KRL', '#8B5A2B', 'Grogol', -6.162035, 106.789610],
  ['KRL', '#8B5A2B', 'Pesing', -6.161252, 106.771908],
  ['KRL', '#8B5A2B', 'Taman Kota', -6.158627, 106.756573],
  ['KRL', '#8B5A2B', 'Bojong Indah', -6.160214, 106.736134],
  ['KRL', '#8B5A2B', 'Rawa Buaya', -6.162744, 106.722754],
  ['KRL', '#8B5A2B', 'Kalideres', -6.165966, 106.703728],
  ['KRL', '#8B5A2B', 'Poris', -6.169735, 106.680752],
  ['KRL', '#8B5A2B', 'Batu Ceper', -6.172027, 106.665287],
  ['KRL', '#EC407A', 'Ancol', -6.128115, 106.845137],
  ['KRL', '#EC407A', 'Tanjung Priuk', -6.110691, 106.881498],
  ['LRT', '#f16227', 'Pegangsaan Dua', -6.157214, 106.914209],
  ['LRT', '#f16227', 'Boulevard Utara', -6.159437, 106.905981],
  ['LRT', '#f16227', 'Boulevard Selatan', -6.168993, 106.900014],
  ['LRT', '#f16227', 'Pulomas', -6.177310, 106.893393],
  ['LRT', '#f16227', 'Equestrian', -6.184057, 106.891279],
  ['LRT', '#f16227', 'Velodrome', -6.192132, 106.891177],
  ['LRT', '#20409A', 'Dukuh Atas BSI', -6.204828, 106.825530],
  ['LRT', '#20409A', 'Setiabudi', -6.209322, 106.830234],
  ['LRT', '#20409A', 'Rasuna Said', -6.221609, 106.832237],
  ['LRT', '#20409A', 'Kuningan', -6.228773, 106.833203],
  ['LRT', '#20409A', 'Pancoran', -6.242141, 106.838515],
  ['LRT', '#20409A', 'Cikoko', -6.243485, 106.857072],
  ['LRT', '#20409A', 'Ciliwung', -6.243446, 106.863970],
  ['LRT', '#20409A', 'Cawang', -6.245907, 106.871230],
  ['LRT', '#20409A', 'Taman Mini', -6.292909, 106.880558],
  ['LRT', '#20409A', 'Kampung Rambutan', -6.309549, 106.884380],
  ['LRT', '#20409A', 'Ciracas', -6.323769, 106.886643],
  ['LRT', '#0E6938', 'Halim', -6.245866, 106.887287],
  ['LRT', '#0E6938', 'Jatibening Baru', -6.257748, 106.927920],
  ['LRT', '#0E6938', 'Cikunir 1', -6.256600, 106.951873],
  ['LRT', '#0E6938', 'Cikunir 2', -6.254650, 106.963211],
  ['LRT', '#0E6938', 'Bekasi Barat', -6.252949, 106.990424],
  ['LRT', '#0E6938', 'Jatimulya', -6.264108, 107.021670]
];

function ensureMapEl() {
  if (!mapEl) { mapEl = document.createElement('div'); mapEl.id = 'ldj-map'; }
  return mapEl;
}

function markerIcon(p, selected, count = 1) {
  const cls = 'marker' + (count > 1 ? ' group' : '') + (selected ? ' sel' : '');
  const style = `background:${catColorOf(p)}` + (selected ? ';animation:ldj-pulse 1.6s infinite' : '');
  return L.divIcon({
    className: '', // wrapper has no class so our box-model isn't overridden
    html: `<button class="${cls}" title="${esc(p.nama)}" style="${style}"><span>${count > 1 ? count : p.emoji}</span></button>`,
    iconSize: [34, 34], iconAnchor: [17, 34]
  });
}

function refreshMarkers(programs) {
  markerPrograms = programs || markerPrograms;
  markerLayer.clearLayers();
  const venueGroups = new Map();
  (programs || []).forEach(p => {
    if (p.lat == null || p.lng == null) return;
    const key = p.venueId || `${(+p.lat).toFixed(4)},${(+p.lng).toFixed(4)}`;
    if (!venueGroups.has(key)) venueGroups.set(key, []);
    venueGroups.get(key).push(p);
  });
  const groups = clusterMarkerGroups([...venueGroups.values()]);
  groups.forEach(group => {
    const primary = group.find(p => p.id === state.selectedId) || group[0];
    const selected = group.some(p => p.id === state.selectedId);
    const lat = group.reduce((sum, p) => sum + +p.lat, 0) / group.length;
    const lng = group.reduce((sum, p) => sum + +p.lng, 0) / group.length;
    const m = L.marker([lat, lng], { icon: markerIcon(primary, selected, group.length), zIndexOffset: selected ? 1000 : 0 });
    const rows = group.map(p => `
      <button class="pin-event" onclick="App.openDetail('${p.id}')">
        <b>${p.emoji} ${esc(p.nama)}</b>
        <span>${esc(p.jam)} · ${biayaLabelOf(p)}</span>
      </button>`).join('');
    m.bindPopup(`
      <div class="pin-pop ${group.length > 1 ? 'multi' : ''}">
        <strong>${group.length > 1 ? `${group.length} event di lokasi ini` : `${primary.emoji} ${esc(primary.nama)}`}</strong>
        ${group.length > 1 ? rows : `<span>${esc(primary.jam)} · ${biayaLabelOf(primary)}</span><div class="cat-tags mini">${categoryBadges(primary)}</div><button onclick="App.openDetail('${primary.id}')">Lihat detail →</button>`}
      </div>`, { offset: [0, -4] });
    m.on('click', () => App.selectProgram(primary.id));
    m.addTo(markerLayer);
    // Markers are rebuilt every render, which destroys any open popup — so the
    // selected pin reopens its own. This also makes "Lihat di Peta" land with
    // the popup already showing instead of just a highlighted diamond.
    // Not on the phone map-first screen: there the centered karcis card IS the
    // popup (a bubble on every carousel swipe would just curtain the map).
    if (selected && !document.querySelector('.gjk')) setTimeout(() => { try { m.openPopup(); } catch (e) {} }, 0);
  });
}

function clusterMarkerGroups(groups) {
  if (!map || map.getZoom() >= 13) return groups;
  const zoom = map.getZoom();
  const threshold = zoom <= 10 ? 72 : zoom <= 11 ? 58 : 42;
  const clusters = [];
  groups.forEach(items => {
    const lat = items.reduce((sum, p) => sum + +p.lat, 0) / items.length;
    const lng = items.reduce((sum, p) => sum + +p.lng, 0) / items.length;
    const pt = map.latLngToLayerPoint([lat, lng]);
    const hit = clusters.find(c => c.pt.distanceTo(pt) <= threshold);
    if (hit) {
      hit.items.push(...items);
      hit.lat = hit.items.reduce((sum, p) => sum + +p.lat, 0) / hit.items.length;
      hit.lng = hit.items.reduce((sum, p) => sum + +p.lng, 0) / hit.items.length;
      hit.pt = map.latLngToLayerPoint([hit.lat, hit.lng]);
    } else {
      clusters.push({ items: [...items], lat, lng, pt });
    }
  });
  return clusters.map(c => c.items);
}

function drawTransitLines() {
  transitLayer.clearLayers();
  TRANSIT_LINES.forEach((line) => {
    L.polyline(line.points, {
      color: '#fff',
      weight: line.weight + 5,
      opacity: 1,
      interactive: false,
      pane: 'transitPane',
      lineCap: 'round',
      lineJoin: 'round',
      smoothFactor: .25
    }).addTo(transitLayer);
    L.polyline(line.points, {
      color: line.color,
      weight: line.weight,
      opacity: 1,
      interactive: false,
      pane: 'transitPane',
      lineCap: 'round',
      lineJoin: 'round',
      smoothFactor: .25
    }).addTo(transitLayer);
    L.marker(line.labelAt, {
      interactive: false,
      icon: L.divIcon({
        className: '',
        html: `<span class="transit-label" style="--line:${line.color}">${line.shortName || line.name}</span>`,
        iconSize: [42, 20],
        iconAnchor: [21, 10]
      })
    }).addTo(transitLayer);
  });
}

function drawStationDots() {
  stationLayer.clearLayers();
  const seen = new Set();
  TRANSIT_STATIONS.forEach(([network, color, name, lat, lng]) => {
    const key = `${name}:${lat.toFixed(5)}:${lng.toFixed(5)}`;
    if (seen.has(key)) return;
    seen.add(key);
    L.circleMarker([lat, lng], {
      pane: 'stationPane',
      radius: network === 'MRT' ? 4.2 : 3.6,
      color: '#fff',
      weight: 2,
      opacity: 1,
      fillColor: color,
      fillOpacity: 1,
      interactive: false
    }).addTo(stationLayer);
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
    map.createPane('transitPane');
    map.getPane('transitPane').classList.add('leaflet-transit-pane');
    map.createPane('stationPane');
    map.getPane('stationPane').classList.add('leaflet-station-pane');
    transitLayer = L.layerGroup().addTo(map);
    stationLayer = L.layerGroup().addTo(map);
    markerLayer = L.layerGroup().addTo(map);
    map.on('zoomend', () => refreshMarkers(markerPrograms));
    drawTransitLines();
    drawStationDots();
  }
  // Map-first phone screen (.gjk) doesn't page-scroll, so one-finger pan can't
  // trap anything — re-enable dragging there. (The map instance is persistent,
  // so this must be re-decided on every mount, not just at creation.)
  const inGjk = !!el.closest('.gjk');
  map.dragging[(inGjk || !isPhone()) ? 'enable' : 'disable']();
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

// ── phone map-first gestures (carousel ↔ map sync, swipe-up, grip drag) ──
let _carTimer = null;
let _carSyncing = false; // programmatic centering must not echo back as a selection

function centerGCard(car, el, instant) {
  _carSyncing = true;
  const left = el.offsetLeft - (car.clientWidth - el.offsetWidth) / 2;
  if (instant) car.scrollLeft = left; else car.scrollTo({ left, behavior: 'smooth' });
  setTimeout(() => { _carSyncing = false; }, instant ? 80 : 420);
}

function wireGjk() {
  const car = document.getElementById('gjk-carousel');
  if (!car) return;

  // Land with the selected karcis centered (pin tap re-renders into this).
  const sel = car.querySelector('.gcard.sel');
  if (sel) centerGCard(car, sel, true);

  // Swipe browse: the centered card becomes the selection. Mutates state
  // directly instead of setState — a full re-render would rebuild the carousel
  // mid-fling and kill the scroll momentum. Markers + flyTo update by hand.
  car.addEventListener('scroll', () => {
    if (_carSyncing) return;
    clearTimeout(_carTimer);
    _carTimer = setTimeout(() => {
      const mid = car.scrollLeft + car.clientWidth / 2;
      let best = null, bd = Infinity;
      car.querySelectorAll('.gcard[data-id]').forEach(el => {
        const d = Math.abs(el.offsetLeft + el.offsetWidth / 2 - mid);
        if (d < bd) { bd = d; best = el; }
      });
      if (!best || best.dataset.id === state.selectedId) return;
      state.selectedId = best.dataset.id;
      car.querySelectorAll('.gcard.sel').forEach(e => e.classList.remove('sel'));
      best.classList.add('sel');
      const p = markerPrograms.find(x => x.id === state.selectedId);
      if (p && map && p.lat != null) {
        _lastSelected = p.id; // so the next full render doesn't re-fly
        refreshMarkers();
        map.flyTo([p.lat, p.lng], Math.max(map.getZoom(), 13), { duration: .55 });
      }
    }, 140);
  }, { passive: true });

  // Swipe a karcis UP → its detail sheet ("geser ke atas kalo mau lihat detail").
  let t0 = null;
  car.addEventListener('touchstart', (e) => {
    const cardEl = e.target.closest('.gcard[data-id]');
    t0 = cardEl ? { x: e.touches[0].clientX, y: e.touches[0].clientY, id: cardEl.dataset.id } : null;
  }, { passive: true });
  car.addEventListener('touchend', (e) => {
    if (!t0) return;
    const dx = e.changedTouches[0].clientX - t0.x, dy = e.changedTouches[0].clientY - t0.y;
    if (dy < -48 && Math.abs(dy) > Math.abs(dx) * 1.4) App.openDetail(t0.id);
    t0 = null;
  }, { passive: true });

  // Grip: tap toggles (onclick); a committed vertical drag also works.
  const grip = document.getElementById('gjk-grip');
  if (grip) {
    let g0 = null;
    grip.addEventListener('touchstart', (e) => { g0 = e.touches[0].clientY; }, { passive: true });
    grip.addEventListener('touchend', (e) => {
      if (g0 == null) return;
      const dy = e.changedTouches[0].clientY - g0;
      if (dy < -40) App.setSheet('full');
      else if (dy > 40) App.setSheet('peek');
      g0 = null;
    }, { passive: true });
  }
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
      <button class="brand" onclick="App.backHome()"><img class="logo" src="/favicon.svg" alt=""><span class="title">Internacia Jakarta</span></button>
      <button class="btn btn-ghost" style="padding:6px 4px;font-size:13px" onclick="App.goKalender()"><span style="font-size:16px">${ic('calendar')}</span></button>
    </header>
    <header class="app-header desktop-only">
      <button class="brand" onclick="App.backHome()">
        <img class="logo" src="/favicon.svg" alt="">
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

// Phone results: Gojek-style map-first screen. The map IS the screen; search +
// chips float on top as MENOR "paper" (ink border, hard yellow shadow), and a
// bottom sheet holds a snap-x karcis carousel (peek) or the full list (full).
// Gestures are wired post-render in wireGjk().
function hasilMobile() {
  const curator = state.curatorId ? findCurator(state.curatorId) : null;
  const programs = visiblePrograms(curator);
  const whenOpts = [['all', 'Kapan aja'], ['today', 'Hari ini'], ['tomorrow', 'Besok'], ['weekend', 'Akhir pekan']];
  const whenChips = whenOpts.map(([k, l]) =>
    `<button class="chip${state.when === k ? ' active' : ''}" onclick="App.setWhen('${k}')">${l}</button>`).join('');

  const carousel = programs.length
    ? programs.map(gCard).join('')
    : `<article class="gcard gcard-empty">
        <div class="gc-body">
          <h3>Belum ada yang cocok</h3>
          <div class="gc-meta">Coba kata kunci lain atau longgarkan filter.</div>
          <button class="btn btn-primary" style="margin-top:10px;padding:9px 16px;font-size:13px" onclick="event.stopPropagation();App.openFilter()">Buka Filter</button>
        </div>
      </article>`;

  const fullList = `
    ${curator ? `
    <div class="cur-banner" style="--accent:${curator.accent || '#FC351C'}">
      <span class="cb-emoji">${curator.emoji || '⭐'}</span>
      <div class="cb-text">
        <div class="cb-name">Kurasi ${esc(curator.nama)}</div>
        ${curator.bio ? `<div class="cb-bio">${esc(curator.bio)}</div>` : ''}
      </div>
      <button class="cb-share" onclick="App.shareCurator()">📤 Bagikan kartu</button>
      <button class="cb-clear" onclick="App.clearCurator()">✕ Semua kegiatan</button>
    </div>` : ''}
    <div class="cards">
      ${programs.map(p => compactCard(p)).join('')}
      <div class="disclaimer"><strong>Catatan:</strong> Jadwal dapat berubah — selalu konfirmasi ke penyelenggara sebelum datang. Bantuan aksesibilitas: <strong>1500-177</strong>.</div>
    </div>`;

  return `
  <div class="screen gjk-screen">
    <div class="gjk">
      <div class="result-map gjk-map"><div id="map-slot"></div></div>

      <div class="gjk-top">
        <div class="gjk-bar">
          <button class="gjk-sq" title="Beranda" onclick="App.backHome()"><img src="/favicon.svg" alt=""></button>
          <div class="search gjk-search">
            <span class="lead-icon">${ic('search')}</span>
            <input id="hasil-search" type="text" value="${esc(state.query)}" placeholder="Cari kegiatan atau lokasi..." oninput="App._input(this);App.onSearch(this.value)">
            ${state.query ? `<button class="clear" onclick="App.clearQuery()">✕</button>` : ''}
          </div>
          <button class="gjk-sq" title="Filter" onclick="App.openFilter()">${ic('filter')}</button>
        </div>
        ${curator
          ? `<div class="gjk-chips"><button class="chip gjk-curchip" style="--accent:${curator.accent || '#FC351C'}" onclick="App.clearCurator()">${curator.emoji || '⭐'} Kurasi ${esc(curator.nama)} ✕</button></div>`
          : `<div class="gjk-chips">
              ${whenChips}
              <button class="chip${state.freeOnly ? ' active' : ''}" onclick="App.toggleFreeOnly()">Gratis</button>
              <button class="chip${state.transportOnly ? ' active' : ''}" onclick="App.toggleTransportOnly()">${ic('transit')} Dekat transit</button>
              <button class="chip gold${state.favoritesOnly ? ' active' : ''}" onclick="App.toggleFavoritesOnly()">${ic('star')} Favorit (${state.favorites.length})</button>
            </div>`}
      </div>

      <div class="gjk-sheet" data-mode="${state.sheet}">
        <button class="gjk-grip" id="gjk-grip" onclick="App.toggleSheet()">
          <span class="gg-pill"></span>
          <span class="gg-label"><b>${programs.length}</b> kegiatan${state.query ? ` · “${esc(state.query)}”` : ''}</span>
          <span class="gg-cue">${state.sheet === 'full' ? 'Peta ⌄' : 'Semua ⌃'}</span>
        </button>
        <div class="gjk-carousel" id="gjk-carousel">${carousel}</div>
        <div class="gjk-list">${fullList}</div>
      </div>
    </div>
  </div>`;
}

function hasil() {
  if (isPhone()) return hasilMobile();
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
      <button class="brand" onclick="App.backHome()"><img class="logo" src="/favicon.svg" alt=""><span class="title">Internacia Jakarta</span></button>
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
        <div class="map-legend">
          <span class="dot"></span>${programs.length} lokasi
          <span class="rail krl-red"></span>KRL
          <span class="rail krl-green"></span>
          <span class="rail krl-blue"></span>
          <span class="rail krl-brown"></span>
          <span class="rail krl-pink"></span>
          <span class="rail mrt"></span>MRT
          <span class="rail lrt-orange"></span>
          <span class="rail lrt-blue"></span>
          <span class="rail lrt-green"></span>LRT
        </div>
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
      <button class="brand" onclick="App.backHome()"><img class="logo" src="/favicon.svg" alt=""><span class="title">Internacia Jakarta</span></button>
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
  const priceChips = PRICE_FILTERS.map(([value, label]) =>
    `<button class="chip${String(state.maxPrice) === String(value) ? ' active' : ''}" onclick="App.setMaxPrice('${value}')">${label}</button>`).join('');
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
        <div class="fgroup"><div class="ftitle">${ic('tag')} Harga maksimum</div><div class="chip-wrap">${priceChips}</div></div>
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
  let body;
  if (!plan.events.length) {
    body = `<div class="plan-empty"><div class="big">${ic('plan')}</div>
      <div class="t">Rencana harianmu masih kosong</div>
      <div class="d">Tambahkan kegiatan lewat tombol <strong>＋ Rencana</strong> di tiap kartu. Kami susun urutannya lalu hitung jarak, waktu tempuh, dan rute transum antar kegiatan.</div>
      <button class="btn btn-primary" style="padding:13px 28px;font-size:15px" onclick="App.closePlan()">Cari kegiatan</button></div>`;
  } else {
    const items = plan.items.map((it, i) => {
      const timeEditor = `
        <div class="plan-time-edit">
          <div class="kind">${it.modeLabel}: ${esc(it.sourceJamLabel)}${it.timeMode !== 'scheduled' ? ` · saran kunjungan ±${fmtDur(it.durasi)}` : ''}</div>
          <label>Datang <input type="time" value="${fmtInputTime(it.t.start)}" onchange="App.setPlanTime('${it.id}', 'start', this.value)"></label>
          <label>Keluar <input type="time" value="${fmtInputTime(it.t.end)}" onchange="App.setPlanTime('${it.id}', 'end', this.value)"></label>
          ${it.timeEdited ? `<button onclick="App.clearPlanTime('${it.id}')">Reset jam</button>` : ''}
        </div>`;
      const etaEditor = it.seg ? `
        <div class="rough-edit">
          <label>Perkiraan kasar pindah
            <input type="number" min="1" max="240" step="1" value="${it.seg.menit}" onchange="App.setTravelOverride('${esc(it.seg.overrideKey)}', this.value)">
            <span>mnt</span>
          </label>
          ${it.seg.isOverride ? `<button onclick="App.clearTravelOverride('${esc(it.seg.overrideKey)}')">Reset ${it.seg.roughMenit} mnt</button>` : ''}
        </div>` : '';
      return `
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
            <div class="cat-tags mini">${categoryBadges(it)}</div>
            <div class="m">${ic('pin')} ${esc(it.area)} · ${it.biayaLabel}</div>
            <div class="time-est">${ic('clock')} Durasi acara ±${fmtDur(it.durasi)}</div>
            ${timeEditor}
            <div class="tl-links">
              <a href="${googlePlaceUrl(it)}" target="_blank" rel="noopener">${ic('pin')} Maps</a>
              <a href="${googleCalendarUrl(it)}" target="_blank" rel="noopener">${ic('calendar')} Google Calendar</a>
            </div>
          </div>
          ${it.seg ? `<div class="seg ${it.seg.warn ? 'warn' : 'ok'}"><div class="h">${esc(it.seg.head)}</div><div class="eta">Perkiraan tiba ${esc(it.seg.arriveAt)} kalau berangkat ${esc(it.seg.departAt)}</div>${etaEditor}${it.seg.poi ? `<div class="poi-suggest"><span>${it.seg.poi.emoji}</span><div><b>Isi jeda: ${esc(it.seg.poi.nama)}</b><small>${esc(it.seg.poi.note)} · ±${fmtDur(it.seg.poi.visitMinutes)}</small></div></div>` : (it.seg.gapMinutes >= 30 ? `<div class="poi-suggest muted"><span>${ic('clock')}</span><div><b>Jeda kosong ±${fmtDur(it.seg.gapMinutes)}</b><small>Belum ada spot dekat yang cocok.</small></div></div>` : '')}</div>` : ''}
        </div>
      </div>`;
    }).join('');
    body = `
      <div class="plan-sum">
        <div class="sum-chip"><span>${ic('pin')}</span>${plan.events.length} kegiatan</div>
        <div class="sum-chip"><span>${ic('clock')}</span>${plan.dayStart}–${plan.dayEnd}</div>
        <div class="sum-chip"><span>${ic('calendar')}</span>±${fmtDur(plan.activeMinutes)} acara akum.</div>
        <div class="sum-chip"><span>🚌</span>±${fmtDur(plan.totalTravel)} pindah</div>
        <div class="sum-chip"><span>${ic('clock')}</span>±${fmtDur(plan.daySpan)} rentang</div>
        <div class="sum-chip"><span>${ic('tag')}</span>${fmtRp(plan.totalBiaya)}</div>
      </div>
      <div class="plan-body">
        ${plan.conflictCount > 0 ? `<div class="conflict">⚠️ ${plan.conflictCount} jadwal perlu perhatian — cek segmen merah di bawah.</div>` : ''}
        ${items}
        <button class="add-more" onclick="App.closePlan()">＋ Tambah kegiatan lain</button>
      </div>
      <div class="plan-foot">
        <button class="link-btn" onclick="App.copyPlanLink()">${ic('link')} Salin Link</button>
        <button class="wa" onclick="App.sharePlanWhatsApp()">${ic('chat')} WhatsApp</button>
        <button class="gcal" onclick="App.openPlanGoogleCalendar()">${ic('calendar')} Google Calendar</button>
        <button class="ics" onclick="App.downloadPlanIcs()">${ic('calendar')} Tambah ke Kalender</button>
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

  const transportHtml = (ex.transport || []).length
    ? ex.transport.map(t => `<div class="item">${esc(t)}</div>`).join('')
    : '<div class="item">Cek rute transit di Google Maps.</div>';
  const posterHtml = p.mediaUrl
    ? `<div class="poster-slot has-poster" style="background-image:url('${esc(p.mediaUrl)}')" role="img" aria-label="Poster ${esc(p.nama)}"></div>`
    : `<div class="poster-slot empty" style="--poster:${catColorOf(p)}"><div class="pe">${p.emoji}</div><div><b>Poster belum tersedia</b><span>Slot poster event / pameran</span></div></div>`;

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
        ${posterHtml}
        <div class="detail-route-row">
          <a class="route" href="${routeToUrl(p)}" target="_blank" rel="noopener">${ic('map')} Rute Google Maps</a>
          <button onclick="App.flyTo('${p.id}')">${ic('pin')} Lihat di Peta</button>
        </div>
        ${urgencyOf(p) || (POPULAR.get(p.id) || 0) >= 2 ? `<div class="urg-line">${urgencyOf(p) ? `<span class="urg">⏳ ${urgencyOf(p)}</span>` : ''}${(POPULAR.get(p.id) || 0) >= 2 ? `<span class="hotline">🔥 Ditambahin ke ${POPULAR.get(p.id)} rencana minggu ini</span>` : ''}</div>` : ''}
        <div class="cat-tags detail">${categoryBadges(p, 5)}</div>
        <p class="desc">${esc(p.deskripsi)}</p>
        ${subHtml}
        <div class="fact">
          <div class="row"><span class="ic">${ic('pin')}</span>${esc(p.lokasiNama)}</div>
          <div class="row"><span class="ic">${ic('user')}</span>${usiaLabelOf(p)}</div>
          <div class="row"><span class="ic">${ic('calendar')}</span>${esc(p.tanggal)}</div>
          <div class="row"><span class="ic">${ic('clock')}</span>${timeModeLabelOf(p)}: ${esc(p.jam)}</div>
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
          <a class="gcal" href="${googleCalendarUrl(p)}" target="_blank" rel="noopener" onclick="App.trackReminder('${p.id}')">${ic('calendar')} Google Calendar</a>
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
  updateDocumentMeta();
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
    wireGjk(); // no-op on desktop (carousel only exists in the phone template)
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

window.addEventListener('popstate', () => {
  applyRoute(location.pathname);
  render();
});

// The results screen renders a different template per breakpoint (map-first on
// phone), so crossing 820px needs a re-render, not just new CSS.
window.matchMedia('(max-width: 820px)').addEventListener('change', () => render());

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
  applyRoute(location.pathname);
  loadPlanFromUrl();
  syncUrl(true);
  render();
}
boot();
