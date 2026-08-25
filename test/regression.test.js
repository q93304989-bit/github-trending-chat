'use strict';
// Regression coverage for docs/AI-FIXLIST.md findings.
// Must run in its own process: TTL is read at module load (node --test gives
// each test file a fresh process).
process.env.TRENDING_TTL_MS = '0';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { createServer, getTrending, resetTrendingCache, resolvePort, resolveTtlMs } = require('../server');

const FAKE = [{
  name: 'owner/repo',
  url: 'https://github.com/owner/repo',
  description: 'desc',
  language: 'JS',
  stars: 100,
  weeklyStars: 5,
  forks: 2,
}];

async function startServer(t, fetcher) {
  const server = createServer(fetcher || (async () => FAKE));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return 'http://127.0.0.1:' + server.address().port;
}

// --- ISSUE-01 / ISSUE-02 · PORT resolution ---------------------------------

test('resolvePort keeps legitimate 0 and valid values', () => {
  assert.deepStrictEqual(resolvePort(undefined), { port: 3000 });
  assert.deepStrictEqual(resolvePort(''), { port: 3000 });
  assert.deepStrictEqual(resolvePort('8080'), { port: 8080 });
  assert.deepStrictEqual(resolvePort('0'), { port: 0 });   // random port is legal
});

test('resolvePort warns loudly on junk instead of silent fallback', () => {
  const r = resolvePort('abc');
  assert.strictEqual(r.port, 3000);
  assert.match(r.warning, /不是合法数字/);
});

test('resolvePort refuses out-of-range integers with a friendly error', () => {
  for (const bad of ['-1', '99999', '65536']) {
    const r = resolvePort(bad);
    assert.ok(r.error, 'must flag ' + bad);
    assert.match(r.error, /越界|范围/);
  }
});

// --- ISSUE-04 · TTL lower bound ---------------------------------------------

test('resolveTtlMs clamps negative values to the default', () => {
  assert.strictEqual(resolveTtlMs('-1000'), 60_000);
  assert.strictEqual(resolveTtlMs(undefined), 60_000);
  assert.strictEqual(resolveTtlMs('junk'), 60_000);
  assert.strictEqual(resolveTtlMs('0'), 0);          // legit always-stale mode
  assert.strictEqual(resolveTtlMs('500'), 500);
});

// --- ISSUE-05 · failure backoff ----------------------------------------------

test('expired board skips upstream retries while cooling down', async () => {
  resetTrendingCache();
  let calls = 0;
  let mode = 'ok';
  const flaky = async () => {
    calls += 1;
    if (mode === 'ok') return FAKE;
    throw new Error('down');
  };

  await getTrending('daily', flaky);                    // seed the cache
  mode = 'fail';
  const stale = await getTrending('daily', flaky);       // SWR answer + bg refresh
  assert.strictEqual(stale.stale, true);
  for (let i = 0; i < 120 && calls < 3; i++) {           // attempt + its retry
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.strictEqual(calls, 3);

  const before = calls;
  const again = await getTrending('daily', flaky);        // cooling -> serve stale only
  assert.strictEqual(calls, before, 'cool-down must suppress further upstream calls');
  assert.strictEqual(again.stale, true);
  resetTrendingCache();
});

test('cold miss during cool-down fails fast instead of hammering upstream', async () => {
  resetTrendingCache();
  let calls = 0;
  const failing = async () => {
    calls += 1;
    throw new Error('down');
  };
  await assert.rejects(() => getTrending('monthly', failing));   // records cooldown
  const after = calls;
  await assert.rejects(() => getTrending('monthly', failing));   // fail fast, zero calls
  assert.strictEqual(calls, after, 'cooldown window must not call upstream');
  resetTrendingCache();
});

// --- ISSUE-07 / ISSUE-08 · HTTP method semantics ------------------------------

test('HEAD /api/trending answers 200 with headers and no body', async (t) => {
  const base = await startServer(t);
  const res = await fetch(base + '/api/trending', { method: 'HEAD' });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(await res.text(), '');
  assert.ok(res.headers.get('etag'), 'HEAD should expose the same headers as GET');
});

test('static handler rejects write-ish methods with 405', async (t) => {
  const base = await startServer(t);
  for (const method of ['DELETE', 'PUT', 'POST']) {
    const res = await fetch(base + '/style.css', { method });
    assert.strictEqual(res.status, 405, method + ' must be rejected');
    assert.match(res.headers.get('allow') || '', /GET/);
  }
});

// --- ISSUE-09 / ISSUE-10 · security headers & caching policy ------------------

test('every response carries baseline security headers', async (t) => {
  const base = await startServer(t);
  for (const p of ['/', '/style.css']) {
    const res = await fetch(base + p);
    assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff', p);
    assert.strictEqual(res.headers.get('x-frame-options'), 'DENY', p);
    assert.strictEqual(res.headers.get('referrer-policy'), 'no-referrer', p);
  }
  const api = await fetch(base + '/api/trending');
  assert.strictEqual(api.headers.get('x-content-type-options'), 'nosniff');
});

test('index.html revalidates and fingerprints its assets', async (t) => {
  const base = await startServer(t);
  const res = await fetch(base + '/');
  assert.match(res.headers.get('cache-control') || '', /no-cache/);
  assert.ok(res.headers.get('content-security-policy'), 'HTML must carry CSP');
  const html = await res.text();
  assert.match(html, /style\.css\?v=/);
  assert.match(html, /app\.js\?v=/);
});

// --- ISSUE-06 · timeout budget guard ------------------------------------------

test('client timeout covers the backend worst case (~20.7s)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const m = src.match(/FETCH_TIMEOUT_MS = (\d+)/);
  assert.ok(m, 'FETCH_TIMEOUT_MS must stay declared in app.js');
  assert.ok(Number(m[1]) >= 21000, 'frontend budget must exceed backend worst case');
});

// --- ISSUE-11 · URL whitelist ---------------------------------------------------

test('cardsHtml drops href and copy button for unsafe urls', () => {
  const { cardsHtml } = require('../public/render');
  const html = cardsHtml([{ name: 'x/y', url: 'javascript:alert(1)//', stars: 1, weeklyStars: 1, forks: 1 }]);
  assert.doesNotMatch(html, /href=/);
  assert.doesNotMatch(html, /data-copy/);
  assert.match(html, /class="name">x\/y</);
  const good = cardsHtml([{ name: 'a/b', url: 'https://github.com/a/b', stars: 1, weeklyStars: 1, forks: 1 }]);
  assert.match(good, /href="https:\/\/github\.com\/a\/b"/);
});

// --- ISSUE-14 · real-pipeline integration (no injected fetcher) ----------------

const UPSTREAM_FIXTURE = [
  '<article class="Box-row">',
  '  <h2 class="h3 lh-condensed"><a href="/owner-one/repo-a" class="Link">owner-one / <span>repo-a</span></a></h2>',
  '  <p class="col-9 color-fg-muted my-1 tmp-pr-4">Real pipeline fixture.</p>',
  '  <div class="f6 color-fg-muted mt-2">',
  '    <span itemprop="programmingLanguage">TypeScript</span>',
  '    <a href="/owner-one/repo-a/stargazers">12,345</a>',
  '    <a href="/owner-one/repo-a/forks">678</a>',
  '    <span class="d-inline-block float-sm-right">321 stars this week</span>',
  '  </div>',
  '</article>',
].join('\n');

test('real pipeline over HTTP: concurrent misses hit upstream exactly once', async (t) => {
  let upstreamHits = 0;
  const mock = http.createServer((req, res) => {
    upstreamHits += 1;
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(UPSTREAM_FIXTURE);
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => mock.close(r)));

  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: Object.assign({}, process.env, {
      PORT: '0',
      HOST: '127.0.0.1',
      GH_UPSTREAM_BASE: 'http://127.0.0.1:' + mock.address().port,
      TRENDING_TTL_MS: '60000',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => { try { child.kill(); } catch (e) { /* already gone */ } });

  const port = await new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error('banner timeout, got: ' + buf.slice(0, 200))), 10_000);
    child.stdout.on('data', (d) => {
      buf += d.toString();
      const m = buf.match(/-> http:\/\/[^:]+:(\d+)/);
      if (m) { clearTimeout(timer); resolve(Number(m[1])); }
    });
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error('child exited ' + code + ': ' + buf.slice(0, 300))); });
  });

  const base = 'http://127.0.0.1:' + port;
  const results = await Promise.all([
    fetch(base + '/api/trending'),
    fetch(base + '/api/trending'),
    fetch(base + '/api/trending'),
  ]);
  for (const r of results) assert.strictEqual(r.status, 200);
  const payloads = [];
  for (const r of results) payloads.push(await r.json());
  assert.ok(payloads[0].items.length >= 1, 'parser must extract the fixture row');
  assert.strictEqual(
    new Set(payloads.map((p) => p.updatedAt)).size, 1,
    'single-flight: all concurrent callers share one snapshot',
  );
  assert.strictEqual(upstreamHits, 1, 'HTTP layer must dedupe through the real pipeline');
});
