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
    weeklyStars: 2,
    forks: 3,
  }]);
  assert.match(html, /class="card"/);
  assert.match(html, /a\/b/);
  assert.match(html, /本周 \+2/);
});
