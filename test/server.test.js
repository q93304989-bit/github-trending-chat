'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createServer } = require('../server');

const FAKE_ITEMS = [{
  name: 'owner/repo',
  url: 'https://github.com/owner/repo',
  description: 'desc',
  language: 'JS',
  stars: 100,
  weeklyStars: 5,
  forks: 2,
}];

async function startServer(t, fetcher) {
  const server = createServer(fetcher || (async () => FAKE_ITEMS));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test('GET /api/trending returns JSON list', async (t) => {
  const base = await startServer(t);
  const res = await fetch(base + '/api/trending');
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.ok, true);
  assert.strictEqual(data.items.length, 1);
  assert.strictEqual(data.items[0].name, 'owner/repo');
});

test('GET /api/trending returns 502 when fetcher fails', async (t) => {
  const base = await startServer(t, async () => { throw new Error('boom'); });
  const res = await fetch(base + '/api/trending');
  assert.strictEqual(res.status, 502);
  const data = await res.json();
  assert.strictEqual(data.ok, false);
  assert.ok(data.error);
});

test('GET / serves index.html', async (t) => {
  const base = await startServer(t);
  const res = await fetch(base + '/');
  assert.strictEqual(res.status, 200);
  const html = await res.text();
  assert.match(html, /GitHub 本周热门/);
});
