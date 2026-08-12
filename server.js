'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { parseTrending } = require('./lib/parser');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const TRENDING_URL = 'https://github.com/trending?since=weekly';
const CACHE_TTL_MS = 60_000;

let cache = { at: 0, data: null };

async function fetchTrending() {
  const res = await fetch(TRENDING_URL, {
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

async function getTrending() {
  const now = Date.now();
  if (cache.data && now - cache.at < CACHE_TTL_MS) return cache.data;
  const items = await fetchTrending();
  cache = { at: now, data: items };
  return items;
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

function serveStatic(req, res) {
  const urlPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const filePath = path.normalize(path.join(PUBLIC_DIR, urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

function createServer(fetcher) {
  const fetchItems = fetcher || getTrending;
  return http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname === '/api/trending' && req.method === 'GET') {
      fetchItems()
        .then((items) => {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true, updatedAt: new Date().toISOString(), items }));
        })
        .catch((err) => {
          console.error('[trending]', err.message);
          res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: '暂时拿不到 GitHub 数据，请稍后再试' }));
        });
      return;
    }
    serveStatic(req, res);
  });
}

if (require.main === module) {
  createServer().listen(PORT, () => {
    console.log(`GitHub Trending Chat running at http://localhost:${PORT}`);
  });
}

module.exports = { createServer };
