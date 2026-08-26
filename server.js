'use strict';

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { parseTrending } = require('./lib/parser');

const PUBLIC_DIR = path.join(__dirname, 'public');

// --- config resolution (ISSUE-01/02/04) -------------------------------------
// parseInt+isFinite keeps legitimate zeros (PORT=0 -> random port, TTL=0 ->
// always-stale), junk strings fall back LOUDLY instead of silently, and
// out-of-range integers surface a typed error the startup block turns into
// a friendly message instead of a bare RangeError stack.
function resolvePort(raw, fallback = 3000) {
  const t = String(raw ?? '').trim();
  if (t === '') return { port: fallback };
  const n = Number.parseInt(t, 10);
  if (!Number.isFinite(n)) {
    return { port: fallback, warning: `PORT="${raw}" 不是合法数字，已回退 ${fallback}` };
  }
  if (n < 0 || n > 65535) {
    return { port: fallback, error: `PORT=${n} 越界：合法范围 0–65535（0 = 随机端口），本次拒绝启动` };
  }
  return { port: n };
}

function resolveTtlMs(raw, fallback = 60_000) {
  const n = Number.parseInt(raw, 10);
  // Negative TTL makes every board permanently stale AND pairs with the
  // revalidator into a per-request upstream loop -> clamp to the default.
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

const resolvedPort = resolvePort(process.env.PORT);
const PORT = resolvedPort.port;
const HOST = process.env.HOST || '127.0.0.1';   // ISSUE-03: no wildcard dual-stack bind
const CACHE_TTL_MS = resolveTtlMs(process.env.TRENDING_TTL_MS);
const FETCH_TIMEOUT_MS = 10_000;
const UPSTREAM_ATTEMPTS = 2;   // total tries per refresh (1 retry)
const RETRY_DELAY_MS = 700;
const PERIODS = ['daily', 'weekly', 'monthly'];

// Per-period cache: { daily: {at, data}|null, weekly: ..., monthly: ... }
const cache = {};
// Single-flight map: one in-flight GitHub request per period, shared by all callers.
const inflight = {};

// Exponential cool-down after consecutive upstream failures (ISSUE-05).
// While cooling, expired boards are served stale WITHOUT another round of
// upstream retries, so an outage cannot turn page pollers into a retry
// storm. Single-flight only merges simultaneous callers; this bounds the
// RATE of consecutive refresh attempts.
const COOLDOWN_BASE_MS = 30_000;
const COOLDOWN_MAX_MS = 5 * 60_000;
const failStreak = {};
const coolUntil = {};

function nextCooldownMs(period) {
  const streak = failStreak[period] || 0;
  return Math.min(COOLDOWN_BASE_MS * 2 ** Math.max(streak - 1, 0), COOLDOWN_MAX_MS);
}

function coolingDown(period) {
  return Date.now() < (coolUntil[period] || 0);
}

// Overridable for integration tests (real-pipeline coverage without GitHub).
const UPSTREAM_BASE = (process.env.GH_UPSTREAM_BASE || 'https://github.com').replace(/\/+$/, '');

function trendingUrl(since) {
  return UPSTREAM_BASE + '/trending?since=' + encodeURIComponent(since);
}

async function fetchTrending(since) {
  const res = await fetch(trendingUrl(since), {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
    },
  });
  if (!res.ok) throw new Error(`GitHub responded with ${res.status}`);
  const items = parseTrending(await res.text());
  if (!items.length) throw new Error('No repositories parsed from trending page');
  return items;
}

/** Retry `fn` up to `attempts` total tries with a fixed pause between them. */
function withRetry(fn, attempts, delayMs) {
  return Promise.resolve().then(fn).catch((err) => {
    if (attempts <= 1) throw err;
    return new Promise((resolve) => setTimeout(resolve, delayMs))
      .then(() => withRetry(fn, attempts - 1, delayMs));
  });
}

/** One refresh per period at a time; background failures resolve to null. */
function startRefresh(period, doFetch) {
  if (inflight[period]) return inflight[period];
  inflight[period] = withRetry(() => doFetch(period), UPSTREAM_ATTEMPTS, RETRY_DELAY_MS)
    .then((items) => {
      delete failStreak[period];       // success clears the failure streak
      delete coolUntil[period];
      const at = Date.now();
      cache[period] = { at, data: items };
      return { items, fromCache: false, stale: false, fetchedAt: at };
    })
    .catch((err) => {
      failStreak[period] = (failStreak[period] || 0) + 1;
      const wait = nextCooldownMs(period);
      coolUntil[period] = Date.now() + wait;
      console.warn(`[trending] ${period} refresh failed (${err.message}); keeping cached board, cooling down ${Math.round(wait / 1000)}s`);
      return null;                     // background failures must never reject callers
    })
    .finally(() => { delete inflight[period]; });
  return inflight[period];
}

/**
 * Weak-network cache strategy:
 * - Fresh (< TTL): served instantly.
 * - Expired but present: served INSTANTLY flagged `stale` while a background
 *   refresh revalidates (stale-while-revalidate). Callers never wait on GitHub.
 * - Cold cache: one blocking attempt shared by all concurrent callers
 *   (single-flight), with a transient retry before giving up.
 * Returns { items, fromCache, stale, fetchedAt }.
 * `fetchImpl` is injectable for tests; production uses the real fetcher.
 */
function resetTrendingCache() {
  for (const k of Object.keys(cache)) delete cache[k];
  for (const k of Object.keys(failStreak)) delete failStreak[k];
  for (const k of Object.keys(coolUntil)) delete coolUntil[k];
}

async function getTrending(since, fetchImpl) {
  const period = PERIODS.includes(since) ? since : 'weekly';
  const doFetch = fetchImpl || fetchTrending;
  const entry = cache[period];

  if (entry && Date.now() - entry.at < CACHE_TTL_MS) {
    return { items: entry.data, fromCache: true, stale: false, fetchedAt: entry.at };
  }

  if (entry) {
    if (!coolingDown(period)) startRefresh(period, doFetch);   // revalidate behind the scenes
    return { items: entry.data, fromCache: false, stale: true, fetchedAt: entry.at };
  }

  // Cold cache: blocking path, deduped across concurrent callers.
  // During a cool-down a cold miss fails fast instead of hammering upstream.
  if (!inflight[period]) {
    if (coolingDown(period)) throw new Error('upstream unavailable');
    startRefresh(period, doFetch);
  }
  const result = await inflight[period];
  if (!result) throw new Error('upstream unavailable');
  return result;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};


// ISSUE-09: baseline hardening on every response.
const SEC_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
};
// Applied to HTML only; every app asset is a same-origin external file.
const PAGE_CSP = "default-src 'self'; img-src 'self' data:; connect-src 'self'; " +
  "style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'none'";

// ISSUE-10: fingerprint local asset refs with their mtime so cached JS/CSS
// can live longer than the HTML, which is always revalidated.
function assetVersion(ref) {
  try {
    return Math.floor(fs.statSync(path.join(PUBLIC_DIR, ref)).mtimeMs).toString(36);
  } catch {
    return '0';
  }
}

function send(res, status, headers, body) {
  res.writeHead(status, Object.assign({}, SEC_HEADERS, headers));
  res.end(body);
}

function serveStatic(req, res) {
  // ISSUE-08: read-only static handler - reject write-ish methods explicitly.
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return send(res, 405, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Method Not Allowed');
  }
  // Strip query first, THEN map root — `/?since=daily` must serve index too
  // (the old ternary mapped only a bare `/`, so any query on / 404'd).
  const pathname = (req.url || '/').split('?')[0];
  const urlPath = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, urlPath));
  const root = PUBLIC_DIR.endsWith(path.sep) ? PUBLIC_DIR : PUBLIC_DIR + path.sep;
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(root)) {
    return send(res, 403, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      return send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Not found');
    }
    const ext = path.extname(filePath).toLowerCase();
    let body = data;
    let cacheControl = 'public, max-age=3600';
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': Buffer.byteLength(data),
    };
    if (ext === '.html') {
      cacheControl = 'no-cache';
      headers['Content-Security-Policy'] = PAGE_CSP;
      const fingerprinted = String(data).replace(
        new RegExp('\\b(src|href)="(?!https?:|data:|[#/])([^"]+?\\.(?:js|css))"', 'g'),
        (m, attr, ref) => attr + '="' + ref + '?v=' + assetVersion(ref) + '"',
      );
      body = Buffer.from(fingerprinted);
      headers['Content-Length'] = Buffer.byteLength(body);
    }
    headers['Cache-Control'] = cacheControl;
    send(res, 200, headers, body);   // Node suppresses the body for HEAD
  });
}

function createServer(fetcher) {
  const getItems = fetcher || getTrending;
  return http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname === '/api/trending' && (req.method === 'GET' || req.method === 'HEAD')) {
      const sinceParam = url.searchParams.get('since') || 'weekly';
      const since = PERIODS.includes(sinceParam) ? sinceParam : 'weekly';
      Promise.resolve()
        .then(() => getItems(since))
        .then((result) => {
          // Back-compat: a plain array fetcher (tests/old callers) still works.
          const payload = Array.isArray(result)
            ? { ok: true, since, fromCache: false, stale: false, updatedAt: new Date().toISOString(), items: result }
            : {
                ok: true,
                since,
                fromCache: !!result.fromCache,
                stale: !!result.stale,
                updatedAt: new Date(result.fetchedAt || Date.now()).toISOString(),
                items: result.items,
              };
          const body = JSON.stringify(payload);
          res.setHeader('Content-Length', Buffer.byteLength(body));
          // ETag hashes the DATA only (not timestamps), so unchanged boards
          // revalidate as 304 even though updatedAt moves between calls.
          const etag = '"' + crypto.createHash('sha1')
            .update(payload.since + ':' + JSON.stringify(payload.items)).digest('hex') + '"';
          res.setHeader('ETag', etag);
          res.setHeader('Cache-Control', 'no-cache');
          for (const [hk, hv] of Object.entries(SEC_HEADERS)) res.setHeader(hk, hv);
          if ((req.headers['if-none-match'] || '').trim() === etag) {
            res.writeHead(304);
            return res.end();
          }
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(body);
        })
        .catch((err) => {
          console.error('[trending]', err.message);
          return send(res, 502, { 'Content-Type': 'application/json; charset=utf-8' },
            JSON.stringify({ ok: false, error: '暂时拿不到 GitHub 数据，请稍后再试' }));
        });
      return;
    }
    serveStatic(req, res);
  });
}

if (require.main === module) {
  // ISSUE-01/02: friendly config failures instead of bare Node stacks.
  if (resolvedPort.error) {
    console.error('[!] ' + resolvedPort.error);
    process.exit(1);
  }
  if (resolvedPort.warning) console.warn('[!] ' + resolvedPort.warning);

  const server = createServer().listen(PORT, HOST, () => {   // ISSUE-03: explicit host, no dual-stack fake start
    const addr = server.address();
    const shown = addr && typeof addr === 'object' ? addr.port : PORT;
    const shownHost = HOST === '0.0.0.0' || HOST === '::' ? 'localhost' : HOST;
    console.log('============================================');
    console.log('  GH-TRENDING TERMINAL');
    console.log('  -> http://' + shownHost + ':' + shown);
    console.log('  boards: daily / weekly / monthly · ttl ' + Math.round(CACHE_TTL_MS / 1000) + 's');
    console.log('============================================');
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error('[!] 端口 ' + PORT + ' 已被占用。服务可能已在运行：直接打开 http://localhost:' + PORT);
      console.error('    或换端口启动：PORT=3001 node server.js');
      process.exit(1);
    }
    if (err.code === 'EACCES' || err.code === 'EADDRNOTAVAIL') {
      console.error('[!] 端口 ' + PORT + ' 不允许绑定（' + err.code + '）。请换端口启动：PORT=3001 node server.js');
      process.exit(1);
    }
    throw err;
  });
}
module.exports = { createServer, getTrending, resetTrendingCache, resolvePort, resolveTtlMs };