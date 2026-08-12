# GitHub 本周热门聊天应用 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个零依赖的 Node.js 网页聊天应用：点击“拉取本周热门”即可获取 GitHub Trending 每周榜并以聊天卡片展示。

**Architecture:** 单进程 Node.js 服务（内置 `http` + `fetch`）。后端提供静态文件服务与 `GET /api/trending`，抓取 `https://github.com/trending?since=weekly` 并用正则解析为 JSON；前端为原生 HTML/CSS/JS 聊天界面。

**Tech Stack:** Node.js ≥ 18（本机 v23）、`node:test`、零第三方依赖。

## Global Constraints

- 零第三方依赖，只允许使用 Node 内置模块。
- 数据源固定为 `https://github.com/trending?since=weekly`。
- 抓取必须携带浏览器 User-Agent。
- `/api/trending` 成功响应结构固定为 `{ ok: true, updatedAt: <ISO>, items: [...] }`；失败返回 HTTP 502 与 `{ ok: false, error: "<中文提示>" }`。
- 仓库对象字段固定：`name`、`url`、`description`、`language`、`stars`、`todayStars`、`forks`。
- 后端 60 秒内存缓存。
- 界面文案使用中文；默认端口 3000，支持环境变量 `PORT` 覆盖。
- 所有测试用 `node --test` 运行。

---

### Task 1: 解析器 `lib/parser.js`

**Files:**
- Create: `lib/parser.js`
- Test: `test/parser.test.js`

**Interfaces:**
- Consumes: 无（第一个任务）。
- Produces:
  - `parseTrending(html: string): Array<{ name: string, url: string, description: string, language: string, stars: number, todayStars: number, forks: number }>`
  - `toInt(input: string|undefined): number`
  - `cleanHtml(input: string): string`

- [ ] **Step 1: 写失败测试**

创建 `test/parser.test.js`：

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseTrending, toInt } = require('../lib/parser');

const FIXTURE = `
<article class="Box-row">
  <h2 class="h3 lh-condensed"><a href="/owner-one/repo-a">owner-one / <span>repo-a</span></a></h2>
  <p class="col-9 color-fg-muted my-1 pr-4">An awesome repository with <b>rich</b> description.</p>
  <div class="f6 color-fg-muted mt-2">
    <a href="/owner-one/repo-a/stargazers">Star <span class="d-inline-block">12,345</span></a>
    <a href="/owner-one/repo-a/forks">Fork <span class="d-inline-block">678</span></a>
    <span itemprop="programmingLanguage">TypeScript</span>
    <span class="d-inline-block float-sm-right">Star 321 stars today</span>
  </div>
</article>
<article class="Box-row">
  <h2 class="h3 lh-condensed"><a href="/owner-two/repo-b">owner-two / <span>repo-b</span></a></h2>
  <div class="f6 color-fg-muted mt-2">
    <a href="/owner-two/repo-b/stargazers">Star <span class="d-inline-block">999</span></a>
    <a href="/owner-two/repo-b/forks">Fork <span class="d-inline-block">88</span></a>
    <span class="d-inline-block float-sm-right">Star 12 stars today</span>
  </div>
</article>
`;

test('parseTrending extracts all fields', () => {
  const items = parseTrending(FIXTURE);
  assert.strictEqual(items.length, 2);
  const [a, b] = items;
  assert.strictEqual(a.name, 'owner-one/repo-a');
  assert.strictEqual(a.url, 'https://github.com/owner-one/repo-a');
  assert.strictEqual(a.description, 'An awesome repository with rich description.');
  assert.strictEqual(a.language, 'TypeScript');
  assert.strictEqual(a.stars, 12345);
  assert.strictEqual(a.todayStars, 321);
  assert.strictEqual(a.forks, 678);
  assert.strictEqual(b.description, '');
  assert.strictEqual(b.language, '');
  assert.strictEqual(b.todayStars, 12);
});

test('toInt strips non-digits', () => {
  assert.strictEqual(toInt('1,234'), 1234);
  assert.strictEqual(toInt(''), 0);
  assert.strictEqual(toInt(undefined), 0);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/parser.test.js`
Expected: FAIL，报错 `Cannot find module '../lib/parser'`。

- [ ] **Step 3: 实现最小解析器**

创建 `lib/parser.js`：

```js
'use strict';

function cleanHtml(input) {
  return String(input)
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toInt(input) {
  if (!input) return 0;
  const n = parseInt(String(input).replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

function parseTrending(html) {
  const blocks = String(html).split(/<article\b/i).slice(1);
  const items = [];
  for (const block of blocks) {
    const link = block.match(/<a[^>]+href="\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)"/);
    if (!link) continue;
    const name = link[1];
    const descMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    const langMatch = block.match(/itemprop="programmingLanguage">([^<]+)</);
    const starsMatch = block.match(/href="\/[^"]+\/stargazers"[\s\S]*?<span[^>]*>([^<]+)<\/span>/);
    const forksMatch = block.match(/href="\/[^"]+\/forks"[\s\S]*?<span[^>]*>([^<]+)<\/span>/);
    const todayMatch = block.match(/([\d,]+)\s*stars?\s*today/i);
    items.push({
      name,
      url: `https://github.com/${name}`,
      description: descMatch ? cleanHtml(descMatch[1]) : '',
      language: langMatch ? langMatch[1].trim() : '',
      stars: toInt(starsMatch ? starsMatch[1] : ''),
      todayStars: todayMatch ? toInt(todayMatch[1]) : 0,
      forks: toInt(forksMatch ? forksMatch[1] : ''),
    });
  }
  return items;
}

module.exports = { parseTrending, toInt, cleanHtml };
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/parser.test.js`
Expected: PASS（2 个测试）。

- [ ] **Step 5: 提交**

```bash
git add lib/parser.js test/parser.test.js
git commit -m "feat: add trending HTML parser"
```

---

### Task 2: HTTP 服务 `server.js`

**Files:**
- Create: `server.js`
- Test: `test/server.test.js`

**Interfaces:**
- Consumes: `parseTrending(html)`（Task 1）。
- Produces:
  - `createServer(fetcher: () => Promise<Array<item>>): http.Server`
  - 默认 fetcher：请求 GitHub Trending 每周榜并解析；带 60 秒内存缓存。
  - `GET /api/trending` → 成功 `{ ok: true, updatedAt, items }`；失败 HTTP 502 + `{ ok: false, error }`。
  - `GET /` 及静态文件 → `public/` 下文件，MIME 正确。

- [ ] **Step 1: 写失败测试**

创建 `test/server.test.js`：

```js
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
  todayStars: 5,
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
```

> 注：`GET /` 的断言依赖 Task 3 的 `public/index.html`。若按顺序执行，此测试在 Task 2 中会失败于“index.html 不存在”，因此 Task 2 只运行前两个 API 测试；`GET /` 测试在 Task 3 创建前端文件后运行。

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/server.test.js`
Expected: FAIL，报错 `Cannot find module '../server'`。

- [ ] **Step 3: 实现服务**

创建 `server.js`：

```js
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
```

- [ ] **Step 4: 运行前两个 API 测试确认通过**

Run: `node --test test/server.test.js`
Expected: 2 个 API 测试 PASS；`GET /` 测试因 `public/index.html` 尚不存在而 FAIL（属预期，Task 3 补齐）。

- [ ] **Step 5: 提交**

```bash
git add server.js test/server.test.js
git commit -m "feat: add http server with trending api"
```

---

### Task 3: 前端聊天界面 `public/`

**Files:**
- Create: `public/index.html`
- Create: `public/style.css`
- Create: `public/render.js`
- Create: `public/app.js`
- Test: `test/render.test.js`

**Interfaces:**
- Consumes: `GET /api/trending`（Task 2）。
- Produces:
  - `TrendingRender.escapeHtml(input: any): string`
  - `TrendingRender.fmt(input: number): string`
  - `TrendingRender.cardsHtml(items: Array<item>): string`
  - 页面元素 id：`messages`、`trending-btn`。

- [ ] **Step 1: 写失败测试**

创建 `test/render.test.js`：

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { escapeHtml, fmt, cardsHtml } = require('../public/render');

test('escapeHtml escapes special chars', () => {
  assert.strictEqual(escapeHtml(`<b>"x" & 'y'`), '&lt;b&gt;&quot;x&quot; &amp; &#39;y&#39;');
});

test('fmt formats numbers with commas', () => {
  assert.strictEqual(fmt(12345), '12,345');
  assert.strictEqual(fmt(0), '0');
});

test('cardsHtml renders one card with all fields', () => {
  const html = cardsHtml([{
    name: 'a/b',
    url: 'https://github.com/a/b',
    description: 'hi',
    language: 'JS',
    stars: 10,
    todayStars: 2,
    forks: 3,
  }]);
  assert.match(html, /class="card"/);
  assert.match(html, /a\/b/);
  assert.match(html, /今日 \+2/);
  assert.match(html, /12,345/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/render.test.js`
Expected: FAIL，报错 `Cannot find module '../public/render'`。

- [ ] **Step 3: 实现 render.js（纯函数，浏览器与 Node 双端可用）**

创建 `public/render.js`：

```js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TrendingRender = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function escapeHtml(input) {
    return String(input).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmt(input) {
    return Number(input || 0).toLocaleString('en-US');
  }

  function cardsHtml(items) {
    return items.map(function (item, i) {
      return '<a class="card" href="' + escapeHtml(item.url) + '" target="_blank" rel="noopener">'
        + '<div class="card-rank">#' + (i + 1) + '</div>'
        + '<div class="card-body">'
        + '<div class="card-name">' + escapeHtml(item.name) + '</div>'
        + (item.description ? '<div class="card-desc">' + escapeHtml(item.description) + '</div>' : '')
        + '<div class="card-meta">'
        + (item.language ? '<span class="chip">' + escapeHtml(item.language) + '</span>' : '')
        + '<span>★ ' + fmt(item.stars) + '</span>'
        + '<span class="today">今日 +' + fmt(item.todayStars) + '</span>'
        + '<span>⑂ ' + fmt(item.forks) + '</span>'
        + '</div></div></a>';
    }).join('');
  }

  return { escapeHtml: escapeHtml, fmt: fmt, cardsHtml: cardsHtml };
});
```

- [ ] **Step 4: 实现 index.html**

创建 `public/index.html`：

```html
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>GitHub 本周热门</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <main class="chat">
    <header class="chat-header">
      <h1>GitHub 本周热门</h1>
      <p>抓取 github.com/trending 每周榜</p>
    </header>
    <div id="messages" class="messages" aria-live="polite"></div>
    <footer class="chat-input">
      <button id="trending-btn" type="button" class="btn">拉取本周热门</button>
      <p class="hint">点击按钮获取 GitHub Trending 每周榜</p>
    </footer>
  </main>
  <script src="render.js"></script>
  <script src="app.js"></script>
</body>
</html>
```

- [ ] **Step 5: 实现 style.css**

创建 `public/style.css`：

```css
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  background: #0d1117; color: #e6edf3; min-height: 100vh;
  display: flex; justify-content: center;
}
.chat { width: 100%; max-width: 720px; height: 100vh; display: flex; flex-direction: column; }
.chat-header { padding: 18px 20px; border-bottom: 1px solid #21262d; background: #161b22; }
.chat-header h1 { font-size: 18px; }
.chat-header p { font-size: 12px; color: #8b949e; margin-top: 4px; }
.messages { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 14px; }
.bubble { max-width: 94%; padding: 12px 14px; border-radius: 14px; font-size: 14px; line-height: 1.55; }
.bubble.bot { align-self: flex-start; background: #161b22; border: 1px solid #21262d; }
.welcome { color: #8b949e; }
.loading { color: #8b949e; }
.error { color: #ff7b72; }
.summary { margin-bottom: 10px; }
.card {
  display: flex; gap: 12px; padding: 12px; margin-bottom: 10px;
  background: #0d1117; border: 1px solid #30363d; border-radius: 10px;
  text-decoration: none; color: inherit; transition: border-color .15s;
}
.card:hover { border-color: #58a6ff; }
.card-rank { font-size: 20px; font-weight: 700; color: #58a6ff; min-width: 30px; }
.card-name { font-weight: 600; color: #58a6ff; word-break: break-all; }
.card-desc { margin-top: 4px; color: #8b949e; font-size: 13px; }
.card-meta { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 10px; font-size: 12px; color: #8b949e; }
.chip { background: #1f6feb33; color: #58a6ff; padding: 1px 8px; border-radius: 999px; }
.today { color: #3fb950; }
.chat-input { padding: 14px 20px; border-top: 1px solid #21262d; background: #161b22; }
.btn {
  width: 100%; padding: 12px; font-size: 15px; font-weight: 600; color: #fff;
  background: #238636; border: none; border-radius: 10px; cursor: pointer;
}
.btn:hover { background: #2ea043; }
.btn:disabled { opacity: .55; cursor: default; }
.hint { text-align: center; color: #8b949e; font-size: 12px; margin-top: 8px; }
```

- [ ] **Step 6: 实现 app.js**

创建 `public/app.js`：

```js
'use strict';

const { cardsHtml, escapeHtml } = TrendingRender;
const messagesEl = document.getElementById('messages');
const btn = document.getElementById('trending-btn');

function addBubble(html) {
  const div = document.createElement('div');
  div.className = 'bubble bot';
  div.innerHTML = html;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return div;
}

addBubble('<div class="welcome">你好！点击下方按钮，获取 GitHub 本周热门项目。</div>');

btn.addEventListener('click', async () => {
  btn.disabled = true;
  const loading = addBubble('<div class="loading">正在加载 GitHub 本周热门…</div>');
  try {
    const res = await fetch('/api/trending');
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || '加载失败');
    loading.remove();
    addBubble(
      '<div class="summary">本周 GitHub 热门 Top ' + data.items.length + '，点击卡片直达仓库：</div>'
      + cardsHtml(data.items)
    );
  } catch (err) {
    loading.remove();
    addBubble('<div class="error">出错了：' + escapeHtml(err.message) + '</div>');
  } finally {
    btn.disabled = false;
  }
});
```

- [ ] **Step 7: 运行全部测试确认通过**

Run: `node --test`
Expected: 全部 PASS，包括此前 FAIL 的 `GET /` 静态文件测试。

- [ ] **Step 8: 提交**

```bash
git add public/ test/render.test.js
git commit -m "feat: add chat frontend"
```

---

### Task 4: README、真实网络端到端验证、交付打包

**Files:**
- Create: `README.md`
- Modify: `outputs/`（复制交付物）

**Interfaces:**
- Consumes: 全部已有任务。
- Produces: 交付说明、可运行应用副本。

- [ ] **Step 1: 写 README.md**

创建 `README.md`：

```markdown
# GitHub 本周热门聊天

一个极简网页聊天应用：点击按钮即可获取 GitHub 官方 Trending 每周榜，并以聊天卡片展示。

## 运行

需要 Node.js 18+（本机 v23 已测试）。

```bash
node server.js
```

打开 http://localhost:3000，点击“拉取本周热门”。

可用环境变量：`PORT`（默认 3000）。

## 测试

```bash
node --test
```

## 说明

- 数据来自 https://github.com/trending?since=weekly
- 后端带 60 秒内存缓存，避免重复点击反复请求 GitHub
- 零第三方依赖
```

- [ ] **Step 2: 真实网络验证**

启动服务后请求接口：

```bash
node server.js
```

另开终端执行：

```bash
Invoke-RestMethod http://localhost:3000/api/trending
```

Expected: 返回 `ok: true` 且 `items` 非空（真实 GitHub 每周榜数据）。

- [ ] **Step 3: 复制交付物到 outputs**

将 `README.md`、`server.js`、`lib/`、`public/` 复制到 `outputs/github-trending-chat/`，并打包 `outputs/github-trending-chat.zip`。

- [ ] **Step 4: 最终提交**

```bash
git add README.md
git commit -m "docs: add readme"
```

---

## Self-Review 记录

对照规格逐项核查：

- 零依赖 ✅（Task 1-3 仅用内置模块与 `node:test`）。
- `/api/trending` 结构与错误码 ✅（Task 2 测试覆盖）。
- 60 秒缓存 ✅（Task 2 `getTrending`）。
- User-Agent ✅（Task 2 `fetchTrending`）。
- 聊天界面 + 按钮 + 卡片 + 错误提示 ✅（Task 3）。
- 端到端真实数据验证 ✅（Task 4 Step 2）。
- 类型/签名一致性 ✅（`parseTrending`、`createServer`、`cardsHtml` 在任务间引用一致）。
