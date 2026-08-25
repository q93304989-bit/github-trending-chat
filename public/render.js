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

  var SINCE_SUFFIX = { daily: '/day', weekly: '/wk', monthly: '/mo' };

  /* ISSUE-11: URL scheme whitelist. Text fields are escaped, but a poisoned
   * cache/feed could still smuggle javascript: into href/data-copy — so an
   * unsafe url drops the link AND the copy button entirely. */
  var SAFE_URL_RE = /^https:\/\/github\.com\//;
  function safeUrl(u) {
    var s = String(u == null ? '' : u);
    return SAFE_URL_RE.test(s) ? s : '';
  }

  /** Render the repo list as terminal entries. `since` only labels the growth rate. */
  function cardsHtml(items, since) {
    var suffix = SINCE_SUFFIX[since] || '/wk';
    return '<div class="repo-list">' + items.map(function (item, i) {
      var rank = '[' + String(i + 1).padStart(2, '0') + ']';
      var url = safeUrl(item.url);
      var head = '<span class="rank">' + escapeHtml(rank) + '</span>'
        + (url
          ? '<a class="name" href="' + escapeHtml(url) + '" target="_blank" rel="noopener">' + escapeHtml(item.name) + '</a>'
          : '<span class="name">' + escapeHtml(item.name) + '</span>')
        + (url ? '<button type="button" class="mini" data-copy="' + escapeHtml(url) + '">[COPY]</button>' : '');
      return '<article class="repo">'
        + '<div class="repo-head">' + head + '</div>'
        + (item.description ? '<div class="desc">' + escapeHtml(item.description) + '</div>' : '')
        + '<div class="meta">'
        + '<span>\u2605 ' + fmt(item.stars) + '</span>'
        + '\n        <span class="up">\u2191 +' + fmt(item.weeklyStars) + suffix + '</span>'
        + '<span>\u2442 ' + fmt(item.forks) + '</span>'
        + (item.language ? '<span class="lang">' + escapeHtml(item.language) + '</span>' : '')
        + '</div></article>';
    }).join('') + '</div>';
  }

  return { escapeHtml: escapeHtml, fmt: fmt, safeUrl: safeUrl, cardsHtml: cardsHtml };
});
