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

  var since = 'weekly';
  var busy = false;
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
    messagesEl.scrollTop += b.top - m.top - 2;
  }

  function typeText(node, text, cps, done) {
    if (REDUCED_MOTION) { node.textContent = text; if (done) done(); return; }
    var i = 0;
    var t = setInterval(function () {
      node.textContent = text.slice(0, ++i);
      if (i >= text.length) { clearInterval(t); if (done) done(); }
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
    if (changed && !REDUCED_MOTION) {        // D7 · flash once on change
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

  var SWAP_MS = 130;
  var swapSeq = 0;

  // A3 · staggered waterfall entrance for repo cards (--i drives delay)
  function animateCards(block) {
    if (REDUCED_MOTION) return;
    var cards = block.querySelectorAll('.repo');
    for (var i = 0; i < cards.length; i++) {
      cards[i].style.setProperty('--i', String(Math.min(i, 10)));
      cards[i].classList.add('card-in');
    }
  }

  function paintResult(block, html, meta) {
    block.classList.remove('swap-out');
    block.innerHTML = html;
    animateCards(block);
    alignToBoard(block);   // start reading at rank #01, not at the bottom
    setRight(since.toUpperCase() + ' \u00b7 ' + meta.count + ' REPOS \u00b7 SYNCED ' + clock(meta.updatedAt));
  }

  function renderResult(data, opts) {
    opts = opts || {};
    var block = ensureResultBlock();
    var items = data.items || [];
    var label = opts.label || sourceLabel(data);
    var html =
      '<div class="sync-head">&gt; TOP ' + items.length + ' \u00b7 ' + since.toUpperCase()
      + ' BOARD \u00b7 ' + label
      + ' \u00b7 SYNCED ' + clock(data.updatedAt) + humanAge(data.updatedAt) + '</div>'
      + R.cardsHtml(items, since);
    var meta = { count: items.length, updatedAt: data.updatedAt };

    // D6 · fade the previous board out first, then cascade the new one in
    if (!REDUCED_MOTION && block.innerHTML.trim() && !opts.instant) {
      var seq = ++swapSeq;
      block.classList.add('swap-out');
      setTimeout(function () {
        if (seq !== swapSeq || !block.isConnected) return;   // superseded/cleared
        paintResult(block, html, meta);
      }, SWAP_MS);
    } else {
      swapSeq++;
      paintResult(block, html, meta);
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
    if (busy) return;
    setBusy(true);

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
        renderResult(data);
        setStatus(data.stale ? 'STALE SERVED \u00b7 BACKGROUND REFRESH' : 'READY');
      })
      .catch(function (err) {
        removeLoading(loadingLine, skeletonEl);
        var cached = getCache(since);
        if (hadVisibleResult || cached) {
          // Keep whatever is on screen; surface the failure quietly in the statusbar.
          if (cached && !hadVisibleResult) {
            renderResult({ items: cached.items, updatedAt: cached.at, fromCache: true });
          }
          setStatus('REFRESH FAILED \u00b7 SHOWING CACHED DATA', 'status-offline');
        } else {
          var msg = err.name === 'AbortError' ? '请求超时（' + Math.round(FETCH_TIMEOUT_MS / 1000) + 's），网络或 GitHub 不可达' : err.message;
          showError(msg);
        }
      })
      .finally(function () { setBusy(false); });
  }

  function selectPeriod(p) {
    if (!PERIODS.includes(p) || p === since || busy) return;
    since = p;
    try { localStorage.setItem(SINCE_KEY, since); } catch (e) {}
    updateTabs();
    var cached = getCache(since);
    if (cached) {
      renderResult({ items: cached.items, updatedAt: cached.at, fromCache: true });
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
    addLine('数字键 <kbd>1</kbd>/<kbd>2</kbd>/<kbd>3</kbd> 切换日/周/月榜 \u00b7 <kbd>R</kbd> 同步 \u00b7 '
      + '点仓库名直达 \u00b7 [COPY] 复制链接', 'hint-line');
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
    if (k === 'r') runSync(false);
    else if (k === '1') selectPeriod('daily');
    else if (k === '2') selectPeriod('weekly');
    else if (k === '3') selectPeriod('monthly');
  });

  /* ---------- boot ---------- */
  function boot() {
    // ISSUE-12: titlebar follows the real address instead of hardcoding :3000.
    var tbTitle = document.querySelector('.tb-title');
    if (tbTitle) tbTitle.textContent = 'gh-trending@' + location.hostname
      + ':' + (location.port || '80') + ' — zsh';
    try {
      var saved = localStorage.getItem(SINCE_KEY);
      if (PERIODS.includes(saved)) since = saved;
    } catch (e) {}
    updateTabs();

    addLine('gh-trending --since=' + since, 'cmd-echo');
    var bootLine = addLine('<span class="btxt"></span><span class="cursor">\u258A</span>', '');
    // Static chrome goes in synchronously and above any later result block,
    // so its late insertion can never yank the viewport past the leaderboard.
    addHint();
    typeText(bootLine.querySelector('.btxt'), 'terminal online \u00b7 phosphor display ready', 90, function () {
      bootLine.classList.add('boot-ok');
      bootLine.innerHTML = 'terminal online \u00b7 phosphor display ready';
    });

    var cached = getCache(since);
    if (cached) {
      // Instant paint from local storage, then a quiet background refresh.
      renderResult({ items: cached.items, updatedAt: cached.at, fromCache: true });
      runSync(true);
    } else {
      runSync(false);
    }
  }

  boot();
})();
