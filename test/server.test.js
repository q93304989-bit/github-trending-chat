'use strict';
// Must be set before ../server is required: TTL is read at module load.
// TTL=0 forces every request past the fresh-cache window so the stale
// fallback path can be exercised deterministically.
process.env.TRENDING_TTL_MS = '0';

const test = require('node:test');
const assert = require('node:assert');
const { createServer, getTrending, resetTrendingCache } = require('../server');

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

test('GET /api/trending returns JSON list and defaults to weekly', async (t) => {
  const seen = [];
  const base = await startServer(t, async (since) => { seen.push(since); return FAKE_ITEMS; });
  const res = await fetch(base + '/api/trending');
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.ok, true);
  assert.strictEqual(data.since, 'weekly');
  assert.strictEqual(data.stale, false);
  assert.strictEqual(data.items.length, 1);
  assert.strictEqual(data.items[0].name, 'owner/repo');
  assert.deepStrictEqual(seen, ['weekly']);
});

test('GET /api/trending forwards supported since values and rejects bad ones', async (t) => {
  const seen = [];
  const base = await startServer(t, async (since) => { seen.push(since); return FAKE_ITEMS; });
  let res = await fetch(base + '/api/trending?since=monthly');
  assert.strictEqual((await res.json()).since, 'monthly');
  res = await fetch(base + '/api/trending?since=hourly');
  assert.strictEqual((await res.json()).since, 'weekly');
  assert.deepStrictEqual(seen, ['monthly', 'weekly']);
});

test('GET /api/trending returns 502 when fetcher fails without cache', async (t) => {
  const base = await startServer(t, async () => { throw new Error('boom'); });
  const res = await fetch(base + '/api/trending');
  assert.strictEqual(res.status, 502);
  const data = await res.json();
  assert.strictEqual(data.ok, false);
  assert.ok(data.error);
});

test('getTrending serves expired cache instantly and revalidates in background', async () => {
  resetTrendingCache();
  let calls = 0;
  const flaky = async () => {
    calls += 1;
    if (calls === 1) return FAKE_ITEMS;
    throw new Error('rate limited');
  };

  const first = await getTrending('daily', flaky);
  assert.strictEqual(first.stale, false);

  // TTL=0 (env): entry is already expired -> instant stale answer,
  // while a background refresh (with one retry) runs without blocking.
  const second = await getTrending('daily', flaky);
  assert.strictEqual(second.stale, true);
  assert.strictEqual(second.items.length, 1);

  // Background refresh: initial attempt + its retry both fail -> calls === 3.
  for (let i = 0; i < 60 && calls < 3; i++) {
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.strictEqual(calls, 3, 'background refresh must run exactly one retry');

  // Cache still holds the old board; further reads keep answering instantly.
  const third = await getTrending('daily', flaky);
  assert.strictEqual(third.stale, true);
  assert.strictEqual(third.items[0].name, 'owner/repo');
});

test('getTrending retries once on transient failure when no cache exists', async () => {
  resetTrendingCache();
  let calls = 0;
  const flaky = async () => {
    calls += 1;
    if (calls === 1) throw new Error('transient timeout');
    return FAKE_ITEMS;
  };

  const result = await getTrending('monthly', flaky);
  assert.strictEqual(result.stale, false);
  assert.strictEqual(result.items[0].name, 'owner/repo');
  assert.strictEqual(calls, 2, 'first failure must trigger exactly one retry');
});

test('API supports ETag revalidation with 304 responses', async (t) => {
  const base = await startServer(t);
  const first = await fetch(base + '/api/trending');
  assert.strictEqual(first.status, 200);
  const etag = first.headers.get('etag');
  assert.ok(etag, 'response must expose an ETag');

  const second = await fetch(base + '/api/trending', { headers: { 'if-none-match': etag } });
  assert.strictEqual(second.status, 304);
  assert.strictEqual((await second.text()), '');
});

test('static assets carry caching headers for slow links', async (t) => {
  const base = await startServer(t);
  const res = await fetch(base + '/style.css');
  assert.strictEqual(res.status, 200);
  assert.match(res.headers.get('cache-control') || '', /max-age/);
});

test('getTrending dedupes concurrent misses into one upstream request', async () => {
  resetTrendingCache();
  let calls = 0;
  const slowFetcher = async () => {
    calls += 1;
    await new Promise((r) => setTimeout(r, 30));
    return FAKE_ITEMS;
  };

  const [a, b] = await Promise.all([
    getTrending('monthly', slowFetcher),
    getTrending('monthly', slowFetcher),
  ]);
  assert.strictEqual(calls, 1, 'second caller must share the in-flight request');
  assert.deepStrictEqual(a.items, FAKE_ITEMS);
  assert.deepStrictEqual(b.items, FAKE_ITEMS);
});

test('GET / serves index.html', async (t) => {
  const base = await startServer(t);
  const res = await fetch(base + '/');
  assert.strictEqual(res.status, 200);
  const html = await res.text();
  assert.match(html, /GH-TRENDING/);
});
