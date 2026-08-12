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
