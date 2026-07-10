/*
 * server.js — REST API for Liburan di Jakarta (PRD §4.3).
 *
 * Read endpoints are cache-friendly (data changes rarely). User location passed
 * to /activities is used only to sort and is never persisted (PRD §4.5).
 */
import express from 'express';
import cors from 'cors';
import sharp from 'sharp';
import {
  listActivities, getActivity, calendar, categories, ageBands, interestsMeta,
  createActivity, updateActivity, deleteActivity,
  listCurators, getCurator, createCurator, updateCurator, deleteCurator,
  recordAnalytics, analyticsSummary, popularActivities,
  createSharedPlan, getSharedPlan, planModelFromActivities
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

// POST /plan/share — persist a short share link + generate calendar export.
app.post('/plan/share', (req, res) => {
  try {
    const shared = createSharedPlan(Array.isArray(req.body?.items) ? req.body.items : []);
    const origin = pageOrigin(req);
    const appUrl = `${origin}/?plan=${encodeURIComponent(shared.ids.join(','))}`;
    res.status(201).json({
      id: shared.id,
      url: `${origin}/s/p/${shared.id}`,
      appUrl,
      ogImage: `${origin}/og/plan/${shared.id}.png`,
      count: shared.plan.count,
      ics: shared.ics
    });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
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
const sharePage = ({ origin, title, desc, appUrl, bodyHtml, redirect = null, image = null, ogUrl = appUrl }) => `<!doctype html>
<html lang="id"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escH(title)}</title>
<meta property="og:type" content="website">
<meta property="og:site_name" content="Internacia Jakarta">
<meta property="og:title" content="${escH(title)}">
<meta property="og:description" content="${escH(desc)}">
<meta property="og:image" content="${escH(image || `${origin}/og-image.png`)}">
<meta property="og:url" content="${escH(ogUrl)}">
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

const planBodyHtml = (title, subtitle, plan) => `
  <h1>${escH(title)}</h1>
  <p class="sub">${escH(subtitle)}</p>
  <ul>${plan.events.map((a) => `<li>${escH(a.emoji)} ${escH(a.nama)}<small>${escH(a.jam)} · ${escH(a.lokasiNama || a.area)} · ${escH(plan.feeLabel(a))}</small></li>`).join('')}</ul>`;

function wrapSvgText(text, maxChars, maxLines = 2) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const next = line ? line + ' ' + w : w;
    if (next.length > maxChars && line) { lines.push(line); line = w; }
    else line = next;
    if (lines.length === maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (words.join(' ').length > lines.join(' ').length && lines.length) lines[lines.length - 1] = lines[lines.length - 1].replace(/…?$/, '') + '…';
  return lines;
}

function planOgSvg(shared) {
  const plan = shared.plan;
  const items = plan.events.slice(0, 3);
  const font = "'Plus Jakarta Sans', 'Inter', 'Noto Sans', Arial, sans-serif";
  const rows = items.map((a, i) => {
    const y = 238 + i * 82;
    const name = wrapSvgText(a.nama, 24, 1)[0] || a.nama;
    const accent = a.color || '#FC351C';
    return `
      <g>
        <rect x="690" y="${y - 42}" width="380" height="66" rx="0" fill="#fff" stroke="#1A1320" stroke-width="2"/>
        <rect x="690" y="${y - 42}" width="10" height="66" fill="${escH(accent)}"/>
        <rect x="720" y="${y - 22}" width="28" height="28" rx="3" fill="#FC351C"/>
        <text x="734" y="${y - 1}" text-anchor="middle" font-family="${font}" font-size="16" font-weight="900" fill="#fff">${i + 1}</text>
        <text x="766" y="${y - 12}" font-family="${font}" font-size="21" font-weight="850" fill="#1A1320">${escH(name)}</text>
        <text x="766" y="${y + 13}" font-family="${font}" font-size="15" font-weight="750" fill="#7A6558">${escH(a.jam)} · ${escH(a.area)}</text>
      </g>`;
  }).join('');
  const more = plan.events.length > 3 ? `<text x="690" y="504" font-family="${font}" font-size="20" font-weight="850" fill="#FC351C">+${plan.events.length - 3} kegiatan lagi</text>` : '';
  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
    <defs>
      <pattern id="pola" width="240" height="60" patternUnits="userSpaceOnUse">
        <rect x="0" y="0" width="60" height="60" fill="#FC351C"/>
        <polygon points="60,0 120,0 90,60" fill="#FEB52B"/>
        <polygon points="120,60 180,60 150,0" fill="#1FAE5D"/>
        <rect x="196" y="14" width="32" height="32" fill="#00AAFF"/>
      </pattern>
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="12" dy="12" stdDeviation="0" flood-color="#FEB52B"/>
      </filter>
    </defs>
    <rect width="1200" height="630" fill="#FFF8F1"/>
    <path d="M734 0h466v630H492z" fill="#FFE9E4"/>
    <circle cx="1055" cy="122" r="186" fill="#FEB52B" opacity=".55"/>
    <rect x="0" y="586" width="1200" height="44" fill="url(#pola)"/>

    <g transform="translate(72 58)">
      <rect x="0" y="0" width="64" height="64" rx="10" fill="#FC351C"/>
      <circle cx="25" cy="25" r="13" fill="none" stroke="#fff" stroke-width="5.5"/>
      <line x1="34.5" y1="34.5" x2="45" y2="45" stroke="#fff" stroke-width="7" stroke-linecap="round"/>
      <circle cx="25" cy="21" r="5" fill="#fff"/>
      <path d="M21 24 L29 24 L25 33 Z" fill="#fff"/>
      <circle cx="25" cy="21" r="1.9" fill="#FC351C"/>
      <text x="82" y="38" font-family="${font}" font-weight="900" font-size="30" fill="#1A1320">Internacia Jakarta</text>
      <text x="82" y="60" font-family="${font}" font-weight="700" font-size="14" letter-spacing=".3" fill="#7A6558">Kegiatan seru, gratis &amp; murah</text>
    </g>

    <text x="78" y="210" font-family="${font}" font-size="78" font-weight="950" fill="#1A1320">Rencana</text>
    <text x="78" y="284" font-family="${font}" font-size="78" font-weight="950" fill="#FC351C">Harian</text>
    <text x="82" y="334" font-family="${font}" font-size="26" font-weight="750" fill="#4A3F3A">Agenda pilihanmu, siap dibagikan.</text>

    <g font-family="${font}">
      <rect x="82" y="374" width="214" height="72" rx="0" fill="#FFE9E4" stroke="#1A1320" stroke-width="2"/>
      <text x="106" y="402" font-size="12" font-weight="900" letter-spacing="1.4" fill="#FC351C">JAM</text>
      <text x="106" y="429" font-size="21" font-weight="900" fill="#1A1320">${escH(plan.dayStart)}-${escH(plan.dayEnd)}</text>
      <rect x="314" y="374" width="146" height="72" rx="0" fill="#FEB52B" stroke="#1A1320" stroke-width="2"/>
      <text x="336" y="402" font-size="12" font-weight="900" letter-spacing="1.4" fill="#7A3F00">AGENDA</text>
      <text x="336" y="429" font-size="21" font-weight="900" fill="#1A1320">${plan.count} kegiatan</text>
      <rect x="478" y="374" width="158" height="72" rx="0" fill="#E9F7EF" stroke="#1A1320" stroke-width="2"/>
      <text x="500" y="402" font-size="12" font-weight="900" letter-spacing="1.4" fill="#178A4C">BIAYA</text>
      <text x="500" y="429" font-size="21" font-weight="900" fill="#1A1320">${escH(plan.totalBiayaLabel)}</text>
    </g>

    <g filter="url(#shadow)">
      <rect x="650" y="162" width="470" height="360" rx="0" fill="#fff" stroke="#1A1320" stroke-width="3"/>
      <rect x="650" y="462" width="470" height="60" fill="url(#pola)" stroke="#1A1320" stroke-width="3"/>
    </g>
    ${rows}
    ${more}
  </svg>`;
}

async function planOgPng(shared) {
  return sharp(Buffer.from(planOgSvg(shared))).png().toBuffer();
}

// GET /s/p/:id — DB-backed share link with plan-specific OG image.
app.get('/s/p/:id', (req, res) => {
  const shared = getSharedPlan(req.params.id, { countView: true });
  if (!shared || !shared.plan.count) return res.status(404).send('Plan not found');
  const origin = pageOrigin(req);
  const appUrl = `${origin}/?plan=${encodeURIComponent(shared.ids.join(','))}`;
  const bodyHtml = planBodyHtml(shared.plan.title, 'Rencana harian dari temanmu — cek jadwalnya:', shared.plan);
  res.set('Cache-Control', 'public, max-age=300');
  res.send(sharePage({
    origin,
    title: shared.plan.title,
    desc: shared.plan.desc,
    appUrl,
    bodyHtml,
    redirect: appUrl,
    image: `${origin}/og/plan/${shared.id}.png`,
    ogUrl: `${origin}/s/p/${shared.id}`
  }));
});

// GET /og/plan/:id.png — plan-specific PNG for WhatsApp/Discord unfurls.
app.get('/og/plan/:id.png', async (req, res) => {
  const shared = getSharedPlan(req.params.id);
  if (!shared || !shared.plan.count) return res.status(404).json({ error: 'not_found' });
  try {
    const png = await planOgPng(shared);
    res.set('Cache-Control', 'public, max-age=86400, immutable');
    res.type('png').send(png);
  } catch (e) {
    res.status(500).json({ error: 'og_image_failed' });
  }
});

// GET /s/plan?ids=a,b,c — server-rendered unfurl page for a shared day plan.
// WhatsApp's crawler gets real og:title/description; humans get redirected to
// the SPA with ?plan= so the plan opens as before.
app.get('/s/plan', (req, res) => {
  const ids = String(req.query.ids || '').split(',').map((s) => s.trim()).filter(Boolean);
  const acts = ids.map(getActivity).filter(Boolean);
  const origin = pageOrigin(req);
  if (!acts.length) return res.redirect(origin + '/');
  const appUrl = `${origin}/?plan=${encodeURIComponent(acts.map((a) => a.id).join(','))}`;
  const plan = planModelFromActivities(acts);
  const bodyHtml = planBodyHtml(plan.title, 'Rencana harian dari temanmu — cek jadwalnya:', plan);
  res.set('Cache-Control', 'public, max-age=300');
  res.send(sharePage({ origin, title: plan.title, desc: plan.desc, appUrl, bodyHtml, redirect: appUrl }));
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

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  app.listen(PORT, () => console.log(`Internacia Jakarta API on :${PORT}`));
}

export default app;
