/* GH-TRENDING // TERMINAL — client logic
 * Auto-syncs on open, falls back to localStorage when offline,
 * switches daily/weekly/monthly boards, supports 1/2/3 + R hotkeys. */
(function () {
  'use strict';

  // Promo demo mode owns the whole screen; real app stays inert.
  if (window.__GHT_DEMO__) return;

  var R = window.TrendingRender;
  var messagesEl = document.getElementById('messages');
  var statusLeft = document.getElementById('status-left');
  var statusRight = document.getElementById('status-right');
  var syncBtn = document.getElementById('sync-btn');
  var clearBtn = document.getElementById('clear-btn');
  var periodBtns = Array.prototype.slice.call(document.querySelectorAll('.pbtn'));

  var PERIODS = ['daily', 'weekly', 'monthly'];
  var CACHE_KEY = 'ght.cache.v2';
  var SINCE_KEY = 'ght.since';
  // ISSUE-06: must exceed the backend worst case (~10s x2 tries + 700ms
  // pause = ~20.7s), or the client aborts requests the server is about to win.
  var FETCH_TIMEOUT_MS = 22000;
  var SPIN_FRAMES = ['\u280B', '\u2819', '\u2839', '\u2838', '\u283C', '\u2834', '\u2826', '\u2827', '\u2807', '\u280F'];
  var REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var BOOT_SEEN_KEY = 'ght.boot.seen';        // 非首访缩短开机序列（S2）
  var BOOT_FAST_AFTER_MS = 3 * 86400000;      // 3 天内算"回归用户"

  var since = 'weekly';
  var busy = false;         // 用户主动/首屏同步进行中
  var bgBusy = false;       // 后台静默刷新进行中（不禁用按钮，可继续切榜）
  var lastStatusAt = 0;     // 状态栏 flash 节流（I4）
  var resultEl = null;      // the single replaceable result block
  var spinTimer = null;

  /* ---------- storage ---------- */
  function loadCache() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); }
    catch (e) { return {}; }
  }
  function saveCache(period, items) {
    try {
      var all = loadCache();
      all[period] = { at: Date.now(), items: items };
      localStorage.setItem(CACHE_KEY, JSON.stringify(all));
    } catch (e) { /* private mode etc. — non-fatal */ }
  }
  function getCache(period) {
    var c = loadCache()[period];
    if (!(c && Array.isArray(c.items) && c.items.length)) return null;
    // ISSUE-11: poisoned entries (bad shape / unsafe url) never reach the DOM.
    var items = c.items.filter(function (it) {
      return it && typeof it.name === 'string' && R.safeUrl(it.url);
    });
    return items.length ? { at: c.at, items: items } : null;
  }

  /* ---------- dom helpers ---------- */
  function addLine(html, cls) {
    var div = document.createElement('div');
    div.className = 'line' + (cls ? ' ' + cls : '');
    div.innerHTML = html;
    messagesEl.appendChild(div);
    scrollBottom();
    return div;
  }
  function scrollBottom() { messagesEl.scrollTop = messagesEl.scrollHeight; }

  // B2 · three shimmering ghost cards standing in for the incoming board
  function addSkeleton() {
    var wrap = document.createElement('div');
    wrap.className = 'repo-list skeleton';
    var widths = ['w60', 'w90', 'w40'];
    for (var i = 0; i < 3; i++) {
      var card = document.createElement('div');
      card.className = 'repo ghost card-in';
      card.style.setProperty('--i', String(i));
      for (var j = 0; j < widths.length; j++) {
        var row = document.createElement('div');
        row.className = 'g-row ' + widths[j];
        card.appendChild(row);
      }
      wrap.appendChild(card);
    }
    messagesEl.appendChild(wrap);
    scrollBottom();
    return wrap;
  }
  // Leaderboards read top-down: after a sync, bring the board header (#01 side)
  // into view instead of chat-style scrolling to the very last row.
  function alignToBoard(block) {
    var m = messagesEl.getBoundingClientRect();
    var b = block.getBoundingClientRect();
    var target = messagesEl.scrollTop + (b.top - m.top - 2);
    // S5 · 切榜平滑滚动（同榜刷新不触发本函数）
    messagesEl.scrollTo({ top: target, behavior: REDUCED_MOTION ? 'auto' : 'smooth' });
  }

  function typeText(node, text, cps, done) {
    if (REDUCED_MOTION) { node.textContent = text; if (done) done(); return; }
    var host = node.parentElement;          // the .line hosting the caret
    if (host) host.classList.add('typing'); // phosphor shimmer while typing
    var i = 0;
    var t = setInterval(function () {
      node.textContent = text.slice(0, ++i);
      if (i >= text.length) {
        clearInterval(t);
        if (host) host.classList.remove('typing');
        if (done) done();
      }
    }, Math.round(1000 / cps));
  }

  function startSpin(el) {
    var i = 0;
    el.textContent = SPIN_FRAMES[0];
    spinTimer = setInterval(function () {
      el.textContent = SPIN_FRAMES[++i % SPIN_FRAMES.length];
    }, 80);
  }
  function stopSpin() { clearInterval(spinTimer); spinTimer = null; }

  function clock(isoOrMs) {
    try {
      return new Date(isoOrMs).toLocaleTimeString('zh-CN', { hour12: false });
    } catch (e) { return '--:--:--'; }
  }

  // Rough age for cached/stale boards; fresh data is younger than a minute
  // and renders no suffix at all.
  function humanAge(isoOrMs) {
    var min = Math.round((Date.now() - new Date(isoOrMs).getTime()) / 60000);
    if (!(min > 0)) return '';
    if (min < 60) return ' \u00b7 \u7ea6 ' + min + ' \u5206\u949f\u524d';
    return ' \u00b7 \u7ea6 ' + Math.round(min / 60) + ' \u5c0f\u65f6\u524d';
  }

  function setStatus(text, cls) {
    var next = '$ ' + text;
    var changed = statusLeft.textContent !== next;
    statusLeft.textContent = next;
    statusLeft.className = cls || '';
    // I4 · 同文本不闪 + 300ms 节流：连续变化也只闪一次
    if (changed && !REDUCED_MOTION && Date.now() - lastStatusAt >= 300) {
      lastStatusAt = Date.now();
      statusLeft.classList.remove('flash');
      void statusLeft.offsetWidth;           // restart the animation
      statusLeft.classList.add('flash');
    }
  }
  function setRight(text) { statusRight.textContent = text; }

  function setBusy(on) {
    busy = on;
    syncBtn.disabled = on;
    periodBtns.forEach(function (b) { b.disabled = on; });
    document.body.classList.toggle('is-syncing', on);   // B1/C2/B3 driver
  }

  function updateTabs() {
    periodBtns.forEach(function (b) {
      var selected = b.dataset.since === since;
      b.setAttribute('aria-selected', String(selected));
      b.tabIndex = selected ? 0 : -1;   // ISSUE-13: roving tabindex for tabs pattern
    });
  }

  /* ---------- data ---------- */
  function fetchTrending(period) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, FETCH_TIMEOUT_MS);
    return fetch('/api/trending?since=' + period, { signal: ctrl.signal })
      .then(function (res) {
        return res.json().catch(function () { throw new Error('HTTP ' + res.status); })
          .then(function (data) {
            if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
            return data;
          });
      })
      .finally(function () { clearTimeout(timer); });
  }

  /* ---------- S6 · 空闲时预取相邻榜单，切榜秒出 ---------- */
  function prefetchOthers(currentPeriod) {
    var others = PERIODS.filter(function (p) { return p !== currentPeriod; });
    var idle = window.requestIdleCallback || function (fn) { setTimeout(fn, 250); };
    idle(function () {
      others.forEach(function (p) {
        if (getCache(p)) return;
        fetchTrending(p).then(function (data) { saveCache(p, data.items); }).catch(function () {});
      });
    });
  }

  /* ---------- rendering ---------- */
  function ensureResultBlock() {
    if (!resultEl || !resultEl.isConnected) {
      resultEl = document.createElement('div');
      resultEl.className = 'line result-block';
      messagesEl.appendChild(resultEl);
    }
    return resultEl;
  }

  function sourceLabel(data) {
    if (data.stale) return '<span class="src-stale">STALE</span>';
    if (data.fromCache) return '<span class="src-cache">CACHE</span>';
    return '<span class="src-live">LIVE</span>';
  }

  // 动效双档位（S3）：用户触发快档 / 后台刷新从容档
  var SWAP_MS = { user: 70, bg: 130 };
  var swapSeq = 0;
  var lastPaint = null;      // { since, fp } 同榜指纹（S4）

  function fingerprintOf(items) {
    return (items || []).map(function (i) { return i.url; }).join(',');
  }
  function headHtmlFor(items, data, label) {
    return '&gt; TOP ' + items.length + ' \u00b7 ' + since.toUpperCase()
      + ' BOARD \u00b7 ' + label
      + ' \u00b7 SYNCED ' + clock(data.updatedAt) + humanAge(data.updatedAt);
  }

  // A3 · staggered waterfall entrance for repo cards (--i drives delay)
  // I1 · animationend 一次性移除 card-in，释放合成层、保证 hover 生效
  function animateCards(block, pace) {
    if (REDUCED_MOTION) return;
    var cards = block.querySelectorAll('.repo');
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      card.style.setProperty('--i', String(Math.min(i, 10)));
      card.classList.add('card-in');
      (function (el) {
        el.addEventListener('animationend', function h(e) {
          if (e.animationName !== 'card-in') return;
          el.classList.remove('card-in');
          el.removeEventListener('animationend', h);
        });
      })(card);
    }
  }

  function paintResult(block, html, meta, opts) {
    opts = opts || {};
    block.classList.remove('swap-out');
    block.innerHTML = html;
    if (!REDUCED_MOTION && opts.animate !== false) {
      animateCards(block, opts.pace);   // 同榜刷新 animate:false -> 只做旧榜淡出
    }
    alignToBoard(block);   // start reading at rank #01, not at the bottom
    setRight(since.toUpperCase() + ' \u00b7 ' + meta.count + ' REPOS \u00b7 SYNCED ' + clock(meta.updatedAt));
  }

  function renderResult(data, opts) {
    opts = opts || {};
    var pace = opts.pace || 'bg';
    var block = ensureResultBlock();
    var items = data.items || [];
    var label = opts.label || sourceLabel(data);
    var fp = fingerprintOf(items);
    var meta = { count: items.length, updatedAt: data.updatedAt };

    // S4 · 同榜同数据：不重播瀑布，只刷新 board 头部时间
    if (!opts.instant && lastPaint && lastPaint.since === since &&
        lastPaint.fp === fp && block.innerHTML.trim()) {
      var head = block.querySelector('.sync-head');
      if (head) head.innerHTML = headHtmlFor(items, data, label);
      setRight(since.toUpperCase() + ' \u00b7 ' + meta.count + ' REPOS \u00b7 SYNCED ' + clock(meta.updatedAt));
      return;
    }

    var sameSince = !!(lastPaint && lastPaint.since === since);
    lastPaint = { since: since, fp: fp };
    var html = '<div class="sync-head">' + headHtmlFor(items, data, label) + '</div>'
      + R.cardsHtml(items, since);

    // D6 · 旧榜先淡出；换榜 -> 新榜瀑布，同榜数据变化 -> 仅交叉淡入（S3/S4）
    if (!REDUCED_MOTION && block.innerHTML.trim() && !opts.instant) {
      var seq = ++swapSeq;
      block.classList.add('swap-out');
      setTimeout(function () {
        if (seq !== swapSeq || !block.isConnected) return;   // superseded/cleared
        paintResult(block, html, meta, { pace: pace, animate: !sameSince });
      }, SWAP_MS[pace]);
    } else {
      swapSeq++;
      paintResult(block, html, meta, { pace: pace, animate: !sameSince });
    }
  }

  function showError(msg) {
    var wrap = document.createElement('div');
    wrap.className = 'line error-wrap';   // D4 · shake on arrival
    wrap.innerHTML = '<div class="error-line">SYNC FAILED: ' + R.escapeHtml(msg) + '</div>'
      + '<button type="button" class="tbtn accent retry-btn">[ RETRY ]</button>';
    wrap.querySelector('.retry-btn').addEventListener('click', function () { runSync(false); });
    messagesEl.appendChild(wrap);
    scrollBottom();
    setStatus('SYNC FAILED', 'status-error');
  }

  /* ---------- sync flow ---------- */
  function runSync(background) {
    // I3 · 后台静默刷新不占用 busy（按钮仍可点），只防重复；用户同步才全局禁用
    if (busy || bgBusy) return;
    if (background) bgBusy = true;
    else { busy = true; setBusy(true); }

    var loadingLine = null;
    var spinEl = null;
    var skeletonEl = null;
    var hadVisibleResult = !!(resultEl && resultEl.isConnected);

    if (!(background && hadVisibleResult)) {
      loadingLine = addLine(
        '<span class="spin">\u280b</span> FETCHING ' + since.toUpperCase() + ' BOARD ...',
        'loading-line');
      addLine('route: /api/trending?since=' + since, 'loading-sub');
      spinEl = loadingLine.querySelector('.spin');
      startSpin(spinEl);
      skeletonEl = addSkeleton();          // B2 · ghost cards while waiting
    }
    var pace = background ? 'bg' : 'user';   // S3 · 双档位
    setStatus((background ? 'BG-SYNCING ' : 'SYNCING ') + since.toUpperCase() + ' ...');

  function removeLoading(line, skeleton) {
    stopSpin();
    var sub = line ? line.nextElementSibling : null;   // grab BEFORE detaching
    var loadingSub = sub && sub.classList.contains('loading-sub') ? sub : null;
    var skel = skeleton || (loadingSub ? loadingSub.nextElementSibling : sub);
    var skelEl = skel && skel.classList.contains('skeleton') ? skel : null;
    if (line) line.remove();
    if (loadingSub) loadingSub.remove();
    if (skelEl) skelEl.remove();
  }

  fetchTrending(since)
      .then(function (data) {
        removeLoading(loadingLine, skeletonEl);   // shift layout first, then align
        saveCache(since, data.items);
        renderResult(data, { pace: pace });
        setStatus(data.stale ? 'STALE SERVED \u00b7 BACKGROUND REFRESH' : 'READY');
        if (!data.stale) prefetchOthers(since);   // S6 · 只有拿到新鲜数据才预取
      })
      .catch(function (err) {
        removeLoading(loadingLine, skeletonEl);
        var cached = getCache(since);
        if (hadVisibleResult || cached) {
          // Keep whatever is on screen; surface the failure quietly in the statusbar.
          if (cached && !hadVisibleResult) {
            renderResult({ items: cached.items, updatedAt: cached.at, fromCache: true }, { pace: pace });
          }
          setStatus('REFRESH FAILED \u00b7 SHOWING CACHED DATA', 'status-offline');
        } else {
          var msg = err.name === 'AbortError' ? '请求超时（' + Math.round(FETCH_TIMEOUT_MS / 1000) + 's），网络或 GitHub 不可达' : err.message;
          showError(msg);
        }
      })
      .finally(function () {
        if (background) bgBusy = false;
        else { busy = false; setBusy(false); }
      });
  }

  /* ---------- R-01 · vim-style cursor navigation ---------- */
  var cursorIndex = -1;
  function cardList() {
    return Array.prototype.slice.call(document.querySelectorAll('.result-block .repo'));
  }
  function setCursor(i) {
    var cards = cardList();
    if (!cards.length) return;
    cursorIndex = Math.max(0, Math.min(i, cards.length - 1));
    cards.forEach(function (c, idx) { c.classList.toggle('cursor-line', idx === cursorIndex); });
    cards[cursorIndex].scrollIntoView({ block: 'nearest', behavior: REDUCED_MOTION ? 'auto' : 'smooth' });
  }
  function clearCursor() {
    cursorIndex = -1;
    cardList().forEach(function (c) { c.classList.remove('cursor-line'); });
  }
  function currentCardLink() {
    var card = cardList()[cursorIndex];
    return card ? card.querySelector('.name') : null;
  }

  function selectPeriod(p) {
    if (!PERIODS.includes(p) || p === since || busy) return;
    since = p;
    clearCursor();
    try { localStorage.setItem(SINCE_KEY, since); } catch (e) {}
    try { history.replaceState(null, '', '?since=' + since); } catch (e) {}
    updateTabs();
    var cached = getCache(since);
    if (cached) {
      renderResult({ items: cached.items, updatedAt: cached.at, fromCache: true }, { pace: 'user' });
      runSync(true);
    } else {
      runSync(false);
    }
  }

  function clearScreen() {
    var doClear = function () {
      messagesEl.classList.remove('wipe');
      messagesEl.innerHTML = '';
      resultEl = null;
      swapSeq++;                     // invalidate any pending board swap
      addLine('screen cleared \u00b7 buffer empty', 'boot-ok');
      addHint();
      setStatus('READY');
    };
    if (!REDUCED_MOTION && messagesEl.querySelector('.repo, .error-wrap')) {
      messagesEl.classList.add('wipe');        // D5 · old lines fade first
      setTimeout(doClear, 150);
    } else {
      doClear();
    }
  }

  function addHint() {
    addLine('<kbd>1</kbd>/<kbd>2</kbd>/<kbd>3</kbd> 榜单 \u00b7 <kbd>R</kbd> 同步 \u00b7 <kbd>J</kbd>/<kbd>K</kbd> 导航 \u00b7 '
      + '<kbd>ENTER</kbd> 打开 \u00b7 <kbd>C</kbd> 复制 \u00b7 点仓库名直达', 'hint-line');
  }

  /* ---------- events ---------- */
  syncBtn.addEventListener('click', function () { runSync(false); });
  clearBtn.addEventListener('click', clearScreen);
  periodBtns.forEach(function (b) {
    b.addEventListener('click', function () { selectPeriod(b.dataset.since); });
  });

  messagesEl.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-copy]');
    if (!btn) return;
    var url = btn.getAttribute('data-copy');
    var done = function () {
      btn.classList.add('copied');           // D3 · pop + green flash
      btn.textContent = '[ COPIED ]';
      setTimeout(function () {
        btn.textContent = '[COPY]';
        btn.classList.remove('copied');
      }, 1200);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, function () { fallbackCopy(url); done(); });
    } else {
      fallbackCopy(url); done();
    }
  });

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    ta.remove();
  }

  // ISSUE-13: WAI-ARIA tabs — Left/Right/Home/End move focus and activate.
  document.querySelector('.periods').addEventListener('keydown', function (e) {
    var dir = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
    if (!dir && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    var idx = -1, i, j;
    for (i = 0; i < periodBtns.length; i++) {
      if (periodBtns[i] === document.activeElement) { idx = i; break; }
    }
    if (idx < 0) {
      for (j = 0; j < periodBtns.length; j++) {
        if (periodBtns[j].dataset.since === since) { idx = j; break; }
      }
    }
    var next = e.key === 'Home' ? 0
      : e.key === 'End' ? periodBtns.length - 1
      : (idx + dir + periodBtns.length) % periodBtns.length;
    periodBtns[next].focus();
    selectPeriod(periodBtns[next].dataset.since);   // automatic activation
  });

  document.addEventListener('keydown', function (e) {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    var tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    var k = e.key.toLowerCase();
    var isBtn = tag === 'button' || tag === 'a';
    if (k === 'r') runSync(false);
    else if (k === '1') selectPeriod('daily');
    else if (k === '2') selectPeriod('weekly');
    else if (k === '3') selectPeriod('monthly');
    else if (k === 'j' || k === 'arrowdown') {
      if (isBtn && k === 'arrowdown') return;   // focused tab: let native/tabs handle arrows
      e.preventDefault();
      setCursor(cursorIndex < 0 ? 0 : cursorIndex + 1);
    } else if (k === 'k' || k === 'arrowup') {
      if (isBtn && k === 'arrowup') return;
      e.preventDefault();
      setCursor(cursorIndex < 0 ? 0 : cursorIndex - 1);
    } else if (k === 'enter') {
      if (isBtn) return;                        // native button activation
      var link = currentCardLink();
      if (link) window.open(link.href, '_blank', 'noopener');
    } else if (k === 'c' && !isBtn) {
      var clink = currentCardLink();
      var card = cardList()[cursorIndex];
      var cbtn = card && card.querySelector('.mini[data-copy]');
      if (cbtn) cbtn.click();   // reuse the delegated copy path + COPIED animation
    } else if (k === 'escape') {
      clearCursor();
    }
  });

  /* ---------- boot sequence overlay (A0) ---------- */
  // POST-style self-test lines + a block progress bar. Pure ceremony: it
  // covers the first moments of the real boot underneath. Skipped entirely
  // under reduced-motion (resolves immediately, overlay never created).
  function playBootSequence() {
    if (REDUCED_MOTION) return Promise.resolve();
    // S2 · 3 天内回归用户 -> 快速版（约 0.6s），首访保持完整仪式
    var fast = false;
    try {
      var seen = Number(localStorage.getItem(BOOT_SEEN_KEY) || 0);
      fast = !!seen && (Date.now() - seen) < BOOT_FAST_AFTER_MS;
    } catch (e) {}
    return new Promise(function (resolve) {
      var seq = document.createElement('div');
      seq.className = 'boot-seq';
      seq.setAttribute('aria-hidden', 'true');
      var pre = document.createElement('div');
      seq.appendChild(pre);
      document.body.appendChild(seq);

      var LINES = [
        'GH-TRENDING TERMINAL v2.1',
        '(c) phosphor systems',
        '',
        'POST .............. <b>OK</b>',
        'MEMORY ............ <b>OK</b>',
        'UPLINK ............ <b>OK</b>',
        '',
        'LOADING BOARD',
      ];
      var LINE_MS = fast ? 35 : 85;
      var TICK_MS = fast ? 14 : 22;
      var STEP = fast ? 8 : 3;
      var FINISH_MS = fast ? 80 : 190;
      var li = 0;
      function nextLine() {
        if (li >= LINES.length) { startBar(); return; }
        var row = document.createElement('div');
        row.className = 'bl';
        row.innerHTML = LINES[li++];
        pre.appendChild(row);
        setTimeout(nextLine, LINE_MS);
      }
      function startBar() {
        var gauge = document.createElement('div');
        gauge.className = 'bl';
        pre.appendChild(gauge);
        var W = 20, p = 0;
        var tick = setInterval(function () {
          p += STEP;
          var filled = Math.min(Math.round(W * p / 100), W);
          gauge.innerHTML = '<span class=\"bar\">' + repeatChar('\u2588', filled) + '</span>'
            + '<span class=\"track\">' + repeatChar('\u2591', W - filled) + '</span> '
            + '<span class=\"pct\">' + Math.min(p, 100) + '%</span>';
          if (p >= 100) {
            clearInterval(tick);
            setTimeout(finish, FINISH_MS);   // let 100% register before the reveal
          }
        }, TICK_MS);
      }
      function repeatChar(ch, n) {
        var out = '';
        for (var i = 0; i < n; i++) out += ch;
        return out;
      }
      function finish() {
        try { localStorage.setItem(BOOT_SEEN_KEY, String(Date.now())); } catch (e) {}
        seq.classList.add('done');
        setTimeout(function () { seq.remove(); resolve(); }, FINISH_MS);
      }
      nextLine();
    });
  }

  /* ---------- boot ---------- */
  function boot() {
    // ISSUE-12: titlebar follows the real address instead of hardcoding :3000.
    var tbTitle = document.querySelector('.tb-title');
    if (tbTitle) tbTitle.textContent = 'gh-trending@' + location.hostname
      + ':' + (location.port || '80') + ' — zsh';
    try {
      var fromUrl = new URLSearchParams(location.search).get('since');
      if (PERIODS.includes(fromUrl)) since = fromUrl;
      else {
        var saved = localStorage.getItem(SINCE_KEY);
        if (PERIODS.includes(saved)) since = saved;
      }
    } catch (e) {}
    updateTabs();

    var cached = getCache(since);

    // S1 · 开机覆盖层与数据请求并行：静态行先铺（被覆盖层遮住），同步立即启动；
    // 覆盖层结束时若数据已到，画面零等待。
    var bootPromise = playBootSequence();
    addLine('gh-trending --since=' + since, 'cmd-echo');
    var bootLine = addLine('<span class="btxt"></span><span class="cursor">\u258A</span>', '');
    addHint();
    if (cached) {
      // Instant paint from local storage, then a quiet background refresh.
      renderResult({ items: cached.items, updatedAt: cached.at, fromCache: true }, { pace: 'user' });
      runSync(true);
    } else {
      runSync(false);
    }
    bootPromise.then(function () {
      document.body.classList.add('booted');
      typeText(bootLine.querySelector('.btxt'), 'terminal online \u00b7 phosphor display ready', 90, function () {
        bootLine.classList.add('boot-ok');
        bootLine.innerHTML = 'terminal online \u00b7 phosphor display ready';
      });
    });
  }

  boot();
})();