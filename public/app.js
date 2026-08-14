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

// Demo mode (for screenshots/promo only): #/demo/cards[/tall] or #/demo/loading
const demoPath = location.hash;
const demo = demoPath.includes('/demo/cards') ? 'cards'
  : demoPath.includes('/demo/loading') ? 'loading' : null;
const tall = demoPath.includes('/tall');
const DEMO_ITEMS = [
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
if (demo === 'cards') {
  addBubble('<div class="summary">本周 GitHub 热门 Top 10，点击卡片直达仓库：</div>' + cardsHtml(DEMO_ITEMS));
} else if (demo === 'loading') {
  addBubble('<div class="loading">正在加载 GitHub 本周热门…</div>');
}
if (tall) {
  // Demo-only: expand the scrollable message area so every card is visible
  // in a full-page screenshot (promo asset capture).
  document.querySelector('.chat').style.height = 'auto';
  messagesEl.style.height = 'auto';
  messagesEl.style.overflow = 'visible';
}

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
