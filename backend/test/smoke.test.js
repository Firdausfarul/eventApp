/*
 * Backend smoke tests — exercise the repo layer against an in-memory DB.
 * Run: npm test   (from backend/)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
const repo = await import('../src/repo.js');
const { default: app } = await import('../src/server.js');

function withServer(fn) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      const base = `http://127.0.0.1:${server.address().port}`;
      try { resolve(await fn(base)); }
      catch (e) { reject(e); }
      finally { server.close(); }
    });
  });
}

test('listActivities returns the full seeded set', () => {
  const { items, total } = repo.listActivities({});
  assert.equal(total, 14);
  assert.equal(items.length, 14);
  const prj = items.find(a => a.id === 'prj');
  assert.ok(prj, 'prj present');
  assert.deepEqual(prj.tiket, [['Senin–Jumat', '40.000'], ['Sabtu–Minggu & libur', '50.000']]);
  assert.deepEqual(prj.window, { mulai: '2026-06-12', selesai: '2026-07-14' });
  assert.equal(prj.lat, -6.149);
});

test('age + interest filter (anak ∩ seni) includes multi-theme creative events', () => {
  const { items } = repo.listActivities({ age: 'anak', interests: 'seni' });
  assert.deepEqual(items.map(a => a.id).sort(), ['batik', 'perpus', 'tim']);
});

test('text search q=coding includes direct and digital/gaming category matches', () => {
  const { items } = repo.listActivities({ q: 'coding' });
  assert.deepEqual(items.map(a => a.id), ['coding', 'esports']);
});

test('geo-sort puts the nearest venue first', () => {
  // From Kota Tua: the museum activity sits there → distance ~0.
  const { items } = repo.listActivities({ lat: -6.1352, lng: 106.8133, pageSize: 3, page: 1 });
  assert.equal(items[0].id, 'museum');
  assert.ok(items[0].jarak_km <= 0.5);
});

test('calendar expansion lists weekend + recurring events', () => {
  const days = repo.calendar('2026-06-29', '2026-06-30');
  assert.ok(days['2026-06-29'].some(a => a.id === 'prj'));
  // lansia recurs Tue/Thu → appears on Tue 2026-06-30, not Mon 06-29.
  assert.ok(!days['2026-06-29'].some(a => a.id === 'lansia'));
  assert.ok(days['2026-06-30'].some(a => a.id === 'lansia'));
});

test('detail lookup + metadata endpoints', () => {
  assert.equal(repo.getActivity('film').subAcara.items.length, 3);
  assert.equal(repo.getActivity('nope'), null);
  assert.equal(repo.categories().length, 17);
  assert.deepEqual(repo.ageBands().find(b => b.key === 'anak'), { key: 'anak', label: 'Anak', emoji: '🧒', sub: '6–12 thn', min: 6, max: 12 });
});

test('analytics recording returns admin summary', () => {
  repo.recordAnalytics({ type: 'view', activityId: 'prj' });
  repo.recordAnalytics({ type: 'favorite', activityId: 'prj' });
  repo.recordAnalytics({ type: 'share', planSize: 2 });
  const s = repo.analyticsSummary();
  assert.equal(s.totals.total, 3);
  assert.ok(s.events.some(e => e.type === 'view' && e.count === 1));
  assert.ok(s.topActivities.some(a => a.id === 'prj' && a.nama === 'Jakarta Fair Kemayoran (PRJ)'));
});

test('popularActivities counts recent plan_add per activity', () => {
  repo.recordAnalytics({ type: 'plan_add', activityId: 'gor' });
  repo.recordAnalytics({ type: 'plan_add', activityId: 'gor' });
  repo.recordAnalytics({ type: 'plan_add', activityId: 'perpus' });
  repo.recordAnalytics({ type: 'view', activityId: 'gor' }); // views don't count
  const pop = repo.popularActivities({ days: 7 });
  assert.equal(pop[0].id, 'gor');
  assert.equal(pop[0].plans, 2);
  assert.ok(pop.some(r => r.id === 'perpus' && r.plans === 1));
});

test('shared plans persist a short id and resolve activities', () => {
  const shared = repo.createSharedPlan(['kuliner', 'prj', 'missing', 'kuliner']);
  assert.match(shared.id, /^[A-Za-z0-9_-]{8}$/);
  assert.deepEqual(shared.ids, ['kuliner', 'prj']);
  assert.equal(shared.plan.count, 2);
  assert.ok(shared.ics.startsWith('data:text/calendar'));

  const loaded = repo.getSharedPlan(shared.id);
  assert.deepEqual(loaded.ids, ['kuliner', 'prj']);
  assert.equal(loaded.plan.title, 'Rencana seru: 2 kegiatan di Jakarta · 1 gratis');
  assert.equal(repo.getSharedPlan('nope'), null);
  assert.throws(() => repo.createSharedPlan([]), /empty_plan/);
});

test('HTTP share routes expose DB link, crawler HTML, and PNG OG image', async () => {
  await withServer(async (base) => {
    const created = await fetch(`${base}/plan/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-Prefix': '/api' },
      body: JSON.stringify({ items: ['prj', 'kuliner'] })
    });
    assert.equal(created.status, 201);
    const body = await created.json();
    assert.match(body.id, /^[A-Za-z0-9_-]{8}$/);
    assert.equal(body.count, 2);
    assert.equal(body.url, `${base}/s/p/${body.id}`);
    assert.equal(body.ogImage, `${base}/og/plan/${body.id}.png`);

    const htmlRes = await fetch(`${base}/s/p/${body.id}`, {
      headers: { 'User-Agent': 'WhatsApp', 'X-Forwarded-Prefix': '/api' }
    });
    assert.equal(htmlRes.status, 200);
    const html = await htmlRes.text();
    assert.match(html, /og:title/);
    assert.match(html, new RegExp(`/og/plan/${body.id}\\.png`));

    const imgRes = await fetch(`${base}/og/plan/${body.id}.png`);
    assert.equal(imgRes.status, 200);
    assert.equal(imgRes.headers.get('content-type'), 'image/png');
    const png = Buffer.from(await imgRes.arrayBuffer());
    assert.deepEqual([...png.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  });
});
