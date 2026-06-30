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
  listCurators, getCurator, createCurator, updateCurator, deleteCurator
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

app.listen(PORT, () => console.log(`Internacia Jakarta API on :${PORT}`));

export default app;
