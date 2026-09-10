'use strict';

/* 每日 GitHub 日榜 → markdown 归档脚本（零依赖，仅 Node 内置模块）
 *
 * 用法：
 *   node scripts/daily-digest.js            # 只抓取并生成 markdown
 *   node scripts/daily-digest.js --push     # 生成后自动 git commit + push
 *
 * 输出路径：历史github日榜汇总/<YYYY>年/<M>月/<YYYY-MM-DD>.md
 * 时区固定 Asia/Shanghai（GMT+8），避免服务器时区差异导致归档到错误的年月日。
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { parseTrending } = require('../lib/parser');

const ROOT = path.join(__dirname, '..');
const OUT_ROOT = path.join(ROOT, '历史github日榜汇总');
const TZ = 'Asia/Shanghai';
const TIMEOUT_MS = 20000;
const UPSTREAM = 'https://github.com/trending?since=daily';

/* ---------- 日期（锁定 GMT+8） ---------- */
function localDate(now) {
  const d = now || new Date();
  const iso = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);                                   // en-CA -> YYYY-MM-DD
  const [y, m, day] = iso.split('-');
  const clock = new Intl.DateTimeFormat('zh-CN', {
    timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d);
  const weekday = new Intl.DateTimeFormat('zh-CN', {
    timeZone: TZ, weekday: 'short',
  }).format(d);                                   // 周一 … 周日
  return { y, m: String(Number(m)), d: day, iso, clock, weekday };
}

/* ---------- 抓取 ---------- */
async function fetchDaily() {
  const res = await fetch(UPSTREAM, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
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

/* github.com 会陷入持续数分钟的瞬时黑洞（连接稳定 ~10s 断开），
 * 短间隔重试无效，必须逐级退避把重试窗口拉到分钟级。 */
const BACKOFF_MS = [2000, 15000, 30000, 45000, 60000];

async function fetchWithRetry(attempts) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fetchDaily();
    } catch (err) {
      lastErr = err;
      if (i < attempts) {
        const wait = BACKOFF_MS[Math.min(i - 1, BACKOFF_MS.length - 1)];
        console.warn(`[digest] 第 ${i} 次抓取失败（${err.message}），${wait / 1000}s 后重试`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }
  throw lastErr;
}

/* ---------- markdown ---------- */
function fmt(n) { return Number(n || 0).toLocaleString('en-US'); }

// 表格单元格内：竖线要转义，换行压平，避免撑破表格
function cell(input) {
  return String(input == null ? '' : input)
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ')
    .trim();
}

function buildMarkdown(items, date) {
  const L = [];
  L.push(`# GitHub 日榜 · ${date.iso}`);
  L.push('');
  L.push(`- 数据来源：[GitHub Trending](https://github.com/trending?since=daily)（daily）`);
  L.push(`- 抓取时间：${date.iso} ${date.clock}（GMT+8 · ${date.weekday}）`);
  L.push(`- 上榜仓库：${items.length}`);
  L.push('');
  L.push('## 榜单');
  L.push('');
  L.push('| # | 仓库 | 简介 | 语言 | ⭐ 总星标 | ↑ 今日新增 | ⑂ Fork |');
  L.push('|:--:|------|:-----|:----:|--------:|----------:|-------:|');
  items.forEach(function (it, i) {
    L.push('| ' + String(i + 1).padStart(2, '0')
      + ' | [' + cell(it.name) + '](' + it.url + ')'
      + ' | ' + (it.description ? cell(it.description) : '—')
      + ' | ' + (it.language ? cell(it.language) : '—')
      + ' | ' + fmt(it.stars)
      + ' | +' + fmt(it.weeklyStars)
      + ' | ' + fmt(it.forks) + ' |');
  });
  L.push('');

  const counts = {};
  items.forEach(function (it) {
    if (it.language) counts[it.language] = (counts[it.language] || 0) + 1;
  });
  const langs = Object.keys(counts)
    .map(function (k) { return [k, counts[k]]; })
    .sort(function (a, b) { return b[1] - a[1] || a[0].localeCompare(b[0]); });
  if (langs.length) {
    L.push('## 语言分布');
    L.push('');
    L.push('| 语言 | 上榜数 |');
    L.push('|------|-------:|');
    langs.forEach(function (p) { L.push('| ' + cell(p[0]) + ' | ' + p[1] + ' |'); });
    L.push('');
  }

  L.push('---');
  L.push('');
  L.push('> 本文件由 `scripts/daily-digest.js` 自动生成，每日 09:00（GMT+8）更新。');
  L.push('');
  return L.join('\n');
}

/* ---------- git ---------- */
function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function pushWithRetry() {
  try {
    git(['push', 'origin', 'main']);
  } catch (err) {
    console.warn('[digest] 首次推送失败，2s 后重试一次');
    try {
      git(['config', '--local', 'alias.refsync']);   // 保活 alias 存在性探测，失败也无所谓
    } catch (e) { /* noop */ }
    new Promise(function (r) { setTimeout(r, 2000); });
    git(['push', 'origin', 'main']);
  }
}

/* ---------- main ---------- */
(async function main() {
  const doPush = process.argv.includes('--push');
  const date = localDate();

  const items = await fetchWithRetry(5);
  const md = buildMarkdown(items, date);

  const dir = path.join(OUT_ROOT, date.y + '年', date.m + '月');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, date.iso + '.md');
  fs.writeFileSync(file, md, 'utf8');
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  console.log('[digest] 已生成 ' + rel + '（' + items.length + ' 个仓库）');

  if (!doPush) return;

  git(['add', '--', rel]);
  const changed = git(['status', '--porcelain', '--', rel]).trim();
  if (!changed) {
    console.log('[digest] 文件内容无变化，跳过提交');
    return;
  }
  git(['commit', '-q', '-m', 'docs: 归档 GitHub 日榜 ' + date.iso]);
  console.log('[digest] 已提交，推送中 ...');
  pushWithRetry();
  // 本机 git 会清掉 remote-tracking refs，推送后重建，保证后续 git status 正常
  try { git(['refsync']); } catch (e) { /* alias 缺失时忽略 */ }
  console.log('[digest] 推送完成 ' + date.iso);
})().catch(function (err) {
  console.error('[digest] 失败：' + (err && err.message ? err.message : err));
  process.exit(1);
});
