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
        + '<span class="today">本周 +' + fmt(item.weeklyStars) + '</span>'
        + '<span>⑂ ' + fmt(item.forks) + '</span>'
        + '</div></div></a>';
    }).join('');
  }

  return { escapeHtml: escapeHtml, fmt: fmt, cardsHtml: cardsHtml };
});
