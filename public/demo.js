/* Promo/screenshot-only demo mode.
 * Activates when the page hash matches #/demo/cards[/tall] or #/demo/loading.
 * Inert in normal use; sets window.__GHT_DEMO__ so app.js skips its boot sequence. */
(function () {
  'use strict';
  var h = location.hash || '';
  var mode = h.indexOf('/demo/cards') !== -1 ? 'cards'
    : h.indexOf('/demo/loading') !== -1 ? 'loading' : null;
  if (!mode) return;

  window.__GHT_DEMO__ = mode;

  var DEMO_ITEMS = [
    { name: 'nexus-ai/orbit-cli', url: 'https://github.com/nexus-ai/orbit-cli', description: 'Ship long-running AI agents with durable state and verifiable handoffs', language: 'TypeScript', stars: 12840, weeklyStars: 3120, forks: 984 },
    { name: 'quantumlab/vector-store-rs', url: 'https://github.com/quantumlab/vector-store-rs', description: 'A memory-first vector store written in Rust for agents', language: 'Rust', stars: 9745, weeklyStars: 2860, forks: 641 },
    { name: 'openforge/spec-kit', url: 'https://github.com/openforge/spec-kit', description: 'Turn product specs into executable plans with review checkpoints', language: 'Python', stars: 8312, weeklyStars: 2540, forks: 512 },
    { name: 'cloudstar/edge-infer', url: 'https://github.com/cloudstar/edge-infer', description: 'On-device inference runtime with quantized LLM kernels', language: 'C++', stars: 7601, weeklyStars: 1980, forks: 733 },
    { name: 'datapipe/fresh-etl', url: 'https://github.com/datapipe/fresh-etl', description: 'Streaming ETL that backfills itself when schemas drift', language: 'Go', stars: 6420, weeklyStars: 1760, forks: 388 },
    { name: 'designlab/ui-motion', url: 'https://github.com/designlab/ui-motion', description: 'Cinematic UI motion primitives for React and Remotion', language: 'JavaScript', stars: 5983, weeklyStars: 1520, forks: 274 },
    { name: 'seedlang/llm-eval-harness', url: 'https://github.com/seedlang/llm-eval-harness', description: 'Deterministic evaluation harness for coding agents', language: 'Python', stars: 5210, weeklyStars: 1345, forks: 199 },
    { name: 'monochrome/sql-mcp', url: 'https://github.com/monochrome/sql-mcp', description: 'MCP server that turns natural language into safe SQL', language: 'TypeScript', stars: 4876, weeklyStars: 1210, forks: 156 },
    { name: 'kitescale/audio-mini', url: 'https://github.com/kitescale/audio-mini', description: 'Small speech models that run anywhere, no cloud needed', language: 'Python', stars: 4321, weeklyStars: 987, forks: 120 },
    { name: 'ferrum/gh-trending', url: 'https://github.com/ferrum/gh-trending', description: 'One-click GitHub trending digest for your morning standup', language: 'JavaScript', stars: 3560, weeklyStars: 876, forks: 98 },
  ];

  function addLine(html, cls) {
    var div = document.createElement('div');
    div.className = 'line' + (cls ? ' ' + cls : '');
    div.innerHTML = html;
    document.getElementById('messages').appendChild(div);
    return div;
  }

  addLine('gh-trending --since=weekly --demo', 'cmd-echo');
  addLine('terminal online \u00b7 demo dataset loaded', 'boot-ok');

  if (mode === 'cards') {
    var head = addLine('', 'sync-head');
    head.innerHTML = '> TOP 10 \u00b7 <span class="src-live">LIVE</span> \u00b7 SYNCED 09:41:07';
    addLine(window.TrendingRender.cardsHtml(DEMO_ITEMS));
    setStatus('SYNCED 09:41:07 \u00b7 DEMO \u00b7 10 REPOS');
  } else {
    addLine('<span class="spin">\u280b</span> FETCHING WEEKLY BOARD ...', 'loading-line');
    addLine('route: /api/trending?since=weekly', 'loading-sub');
    setStatus('SYNCING WEEKLY ...');
  }

  // Demo-only: expand scroll area so every card is visible in a full-page screenshot.
  if (h.indexOf('/tall') !== -1) {
    var term = document.querySelector('.term');
    term.style.height = 'auto';
    document.getElementById('messages').style.overflow = 'visible';
  }

  function setStatus(text) {
    var el = document.getElementById('status-right');
    if (el) el.textContent = text;
  }
})();
