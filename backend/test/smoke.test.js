/*
 * Backend smoke tests — exercise the repo layer against an in-memory DB.
 * Run: npm test   (from backend/)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
const repo = await import('../src/repo.js');

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

test('age + interest filter (anak ∩ seni) → [tim, batik]', () => {
  const { items } = repo.listActivities({ age: 'anak', interests: 'seni' });
  assert.deepEqual(items.map(a => a.id).sort(), ['batik', 'tim']);
});

test('text search q=coding → [coding]', () => {
  const { items } = repo.listActivities({ q: 'coding' });
  assert.deepEqual(items.map(a => a.id), ['coding']);
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
  assert.equal(repo.categories().length, 15);
  assert.deepEqual(repo.ageBands().find(b => b.key === 'anak'), { key: 'anak', label: 'Anak', emoji: '🧒', sub: '6–12 thn', min: 6, max: 12 });
});
