/*
 * server.js — REST API for Liburan di Jakarta (PRD §4.3).
 *
 * Read endpoints are cache-friendly (data changes rarely). User location passed
 * to /activities is used only to sort and is never persisted (PRD §4.5).
 */
import express from 'express';
import cors from 'cors';
import {
  listActivities, getActivity, calendar, categories, ageBands, interestsMeta,
  createActivity, updateActivity, deleteActivity,
  listCurators, getCurator, createCurator, updateCurator, deleteCurator,
  recordAnalytics, analyticsSummary, popularActivities
} from './repo.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Read endpoints are cacheable for a short window.
const cacheable = (req, res, next) => { res.set('Cache-Control', 'public, max-age=300'); next(); };

app.get('/health', (_req, res) => res.json({ ok: true }));

// GET /activities?age=&interests=&q=&when=&lat=&lng=&page=&pageSize=
app.get('/activities', cacheable, (req, res) => {
  const { age, interests, q, when, lat, lng, page, pageSize } = req.query;
  const result = listActivities({ age, interests, q, when, lat, lng, page, pageSize });
  // Default (no pagination requested) returns the bare array so the frontend's
  // hydrate path stays a drop-in for the bundled data.js dataset.
  if (!pageSize) return res.json(result.items);
  res.json(result);
});

app.get('/activities/:id', cacheable, (req, res) => {
  const a = getActivity(req.params.id);
  if (!a) return res.status(404).json({ error: 'not_found' });
  res.json(a);
});

// GET /calendar?from=YYYY-MM-DD&to=YYYY-MM-DD → { "2026-06-29": [activity…], … }
app.get('/calendar', cacheable, (req, res) => {
  res.json(calendar(req.query.from, req.query.to));
});

app.get('/categories', cacheable, (_req, res) => res.json(categories()));
app.get('/age-bands', cacheable, (_req, res) => res.json(ageBands()));
app.get('/interests', cacheable, (_req, res) => res.json(interestsMeta()));

// GET /curators → active personas with their handpicked activity ids + blurbs.
app.get('/curators', cacheable, (_req, res) => res.json(listCurators()));
app.get('/curators/:id', cacheable, (req, res) => {
  const c = getCurator(req.params.id);
  if (!c) return res.status(404).json({ error: 'not_found' });
  res.json(c);
});

// POST /plan/share — generate a shareable .ics for a set of activity ids.
// Stateless: builds the calendar payload on the fly (no plan is stored).
app.post('/plan/share', (req, res) => {
  const ids = Array.isArray(req.body?.items) ? req.body.items : [];
  const acts = ids.map(getActivity).filter(Boolean);
  if (!acts.length) return res.status(400).json({ error: 'empty_plan' });

  const parseJam = (j) => { const m = String(j).match(/(\d{1,2})\.(\d{2})\D+(\d{1,2})\.(\d{2})/); return m ? { s: +m[1] * 60 + +m[2], e: +m[3] * 60 + +m[4] } : { s: 0, e: 0 }; };
  const pad = (n) => String(n).padStart(2, '0');
  const now = new Date();
  const dt = '' + now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate());
  let ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//LiburanJKT//ID\r\n';
  acts.map(a => ({ a, t: parseJam(a.jam) })).sort((x, y) => x.t.s - y.t.s).forEach(({ a, t }) => {
    ics += 'BEGIN:VEVENT\r\nUID:' + a.id + '-' + dt + '@liburanjkt\r\n' +
      'DTSTART:' + dt + 'T' + pad(Math.floor(t.s / 60)) + pad(t.s % 60) + '00\r\n' +
      'DTEND:' + dt + 'T' + pad(Math.floor(t.e / 60)) + pad(t.e % 60) + '00\r\n' +
      'SUMMARY:' + a.nama + '\r\nLOCATION:' + (a.lokasiNama || a.area) + '\r\nEND:VEVENT\r\n';
  });
  ics += 'END:VCALENDAR';
  res.json({ ics: 'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics), count: acts.length });
});

app.post('/analytics', (req, res) => {
  try { res.status(202).json(recordAnalytics(req.body || {})); } catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});

// GET /analytics/popular — public social-proof counts (plan adds, last 7 days).
app.get('/analytics/popular', (req, res) => {
  res.set('Cache-Control', 'public, max-age=120');
  res.json(popularActivities({ days: req.query.days }));
});

// ── shareable HTML pages (crawler-friendly OG unfurls) ──────────────────
const escH = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Public origin as the visitor sees it (through the nginx proxy when present).
const pageOrigin = (req) => {
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  return `${proto}://${host}`;
};
// `redirect`: URL humans get bounced to (crawlers only read the OG tags).
// Omit it (digest) and the page itself is the destination.
const sharePage = ({ origin, title, desc, appUrl, bodyHtml, redirect = null }) => `<!doctype html>
<html lang="id"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escH(title)}</title>
<meta property="og:type" content="website">
<meta property="og:site_name" content="Internacia Jakarta">
<meta property="og:title" content="${escH(title)}">
<meta property="og:description" content="${escH(desc)}">
<meta property="og:image" content="${origin}/og-image.png">
<meta property="og:url" content="${escH(appUrl)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="description" content="${escH(desc)}">
<style>
  body { font-family: 'Plus Jakarta Sans', system-ui, sans-serif; background: #FFF8F1; color: #1A1320; margin: 0; padding: 28px 20px 48px; }
  main { max-width: 560px; margin: 0 auto; }
  h1 { font-size: 26px; margin: 18px 0 6px; } .sub { color: #7A6558; font-weight: 600; margin: 0 0 22px; }
  .brand { display: inline-block; font-weight: 800; background: #FC351C; color: #fff; padding: 6px 12px; border-radius: 6px; }
  ul { list-style: none; padding: 0; margin: 0 0 26px; } li { background: #fff; border: 1px solid #F1E4D8; border-radius: 10px; padding: 13px 15px; margin-bottom: 9px; font-weight: 600; }
  li small { display: block; color: #7A6558; margin-top: 3px; font-weight: 600; }
  .cta { display: inline-block; background: #FC351C; color: #fff; text-decoration: none; font-weight: 800; padding: 14px 26px; border-radius: 8px; }
</style></head>
<body><main>
  <span class="brand">+ Internacia Jakarta</span>
  ${bodyHtml}
  <a class="cta" href="${escH(appUrl)}">Buka di Internacia Jakarta →</a>
</main>
${redirect ? `<script>/* humans go straight to the app; crawlers read the OG tags above */
if (!/bot|crawler|spider|whatsapp|telegram|facebook|preview/i.test(navigator.userAgent)) location.replace(${JSON.stringify(redirect)});
</script>` : ''}</body></html>`;

// GET /s/plan?ids=a,b,c — server-rendered unfurl page for a shared day plan.
// WhatsApp's crawler gets real og:title/description; humans get redirected to
// the SPA with ?plan= so the plan opens as before.
app.get('/s/plan', (req, res) => {
  const ids = String(req.query.ids || '').split(',').map((s) => s.trim()).filter(Boolean);
  const acts = ids.map(getActivity).filter(Boolean);
  const origin = pageOrigin(req);
  if (!acts.length) return res.redirect(origin + '/');
  const appUrl = `${origin}/?plan=${encodeURIComponent(acts.map((a) => a.id).join(','))}`;
  const gratis = acts.filter((a) => a.biaya === 'gratis').length;
  const title = `Rencana seru: ${acts.length} kegiatan di Jakarta${gratis ? ` · ${gratis} gratis` : ''}`;
  const desc = acts.map((a) => `${a.emoji} ${a.nama} (${a.jam})`).join(' • ');
  const bodyHtml = `
  <h1>${escH(title)}</h1>
  <p class="sub">Rencana harian dari temanmu — cek jadwalnya:</p>
  <ul>${acts.map((a) => `<li>${escH(a.emoji)} ${escH(a.nama)}<small>${escH(a.jam)} · ${escH(a.lokasiNama || a.area)} · ${a.biaya === 'gratis' ? 'Gratis' : escH('Rp ' + a.biaya)}</small></li>`).join('')}</ul>`;
  res.set('Cache-Control', 'public, max-age=300');
  res.send(sharePage({ origin, title, desc, appUrl, bodyHtml, redirect: appUrl }));
});

// GET /digest — "Weekend ini di Jakarta": stable, forwardable weekly listicle.
// The shareable unit that's useful to the RECIPIENT (grup WA), not a personal plan.
app.get('/digest', (req, res) => {
  const items = listActivities({ when: 'weekend' }).items;
  const gratis = items.filter((a) => a.biaya === 'gratis').length;
  const origin = pageOrigin(req);
  const appUrl = `${origin}/`;
  const title = `Weekend ini di Jakarta: ${items.length} kegiatan seru, ${gratis} gratis`;
  const desc = items.slice(0, 6).map((a) => `${a.emoji} ${a.nama}`).join(' • ') + (items.length > 6 ? ` • +${items.length - 6} lagi` : '');
  const bodyHtml = `
  <h1>Weekend ini di Jakarta 🎉</h1>
  <p class="sub">${items.length} kegiatan buka akhir pekan ini — ${gratis} di antaranya gratis. Forward ke grup, gaskeun bareng.</p>
  <ul>${items.map((a) => `<li>${escH(a.emoji)} ${escH(a.nama)}<small>${escH(a.jam)} · ${escH(a.area)} · ${a.biaya === 'gratis' ? 'Gratis' : escH('Rp ' + a.biaya)}</small></li>`).join('')}</ul>`;
  res.set('Cache-Control', 'public, max-age=3600');
  res.send(sharePage({ origin, title, desc, appUrl, bodyHtml }));
});

// ── admin (HTTP Basic) ──────────────────────────────────────────────────
// Credentials from env. If unset, admin is disabled (503) so it can't be left
// open by accident. Set ADMIN_USER / ADMIN_PASS to enable.
function basicAuth(req, res, next) {
  const U = process.env.ADMIN_USER, P = process.env.ADMIN_PASS;
  if (!U || !P) return res.status(503).json({ error: 'admin_disabled', hint: 'set ADMIN_USER & ADMIN_PASS' });
  const [scheme, val] = (req.headers.authorization || '').split(' ');
  if (scheme === 'Basic' && val) {
    const [user, pass] = Buffer.from(val, 'base64').toString('utf8').split(':');
    if (user === U && pass === P) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Internacia Jakarta admin"').status(401).json({ error: 'unauthorized' });
}

const adminError = (res, e) => res.status(e.status || 400).json({ error: e.message });

app.get('/admin/ping', basicAuth, (_req, res) => res.json({ ok: true }));

app.post('/admin/activities', basicAuth, (req, res) => {
  try { res.status(201).json(createActivity(req.body)); } catch (e) { adminError(res, e); }
});
app.put('/admin/activities/:id', basicAuth, (req, res) => {
  try { res.json(updateActivity(req.params.id, req.body)); } catch (e) { adminError(res, e); }
});
app.delete('/admin/activities/:id', basicAuth, (req, res) => {
  try { res.json(deleteActivity(req.params.id)); } catch (e) { adminError(res, e); }
});

// admin curators — list includes inactive so they can be re-enabled.
app.get('/admin/curators', basicAuth, (_req, res) => res.json(listCurators({ includeInactive: true })));
app.post('/admin/curators', basicAuth, (req, res) => {
  try { res.status(201).json(createCurator(req.body)); } catch (e) { adminError(res, e); }
});
app.put('/admin/curators/:id', basicAuth, (req, res) => {
  try { res.json(updateCurator(req.params.id, req.body)); } catch (e) { adminError(res, e); }
});
app.delete('/admin/curators/:id', basicAuth, (req, res) => {
  try { res.json(deleteCurator(req.params.id)); } catch (e) { adminError(res, e); }
});

app.get('/admin/analytics', basicAuth, (_req, res) => res.json(analyticsSummary()));

app.listen(PORT, () => console.log(`Internacia Jakarta API on :${PORT}`));

export default app;
