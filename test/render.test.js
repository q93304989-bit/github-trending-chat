'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { escapeHtml, fmt, cardsHtml } = require('../public/render');

const ITEM = {
  name: 'a/b',
  url: 'https://github.com/a/b',
  description: 'hi',
  language: 'JS',
  stars: 10,
  weeklyStars: 2,
  forks: 3,
};

test('escapeHtml escapes special chars', () => {
  assert.strictEqual(escapeHtml(`<b>"x" & 'y'`), '&lt;b&gt;&quot;x&quot; &amp; &#39;y&#39;');
});

test('fmt formats numbers with commas', () => {
  assert.strictEqual(fmt(12345), '12,345');
  assert.strictEqual(fmt(0), '0');
});

test('cardsHtml renders a terminal repo entry with all fields', () => {
  const html = cardsHtml([ITEM]);
  assert.match(html, /class="repo"/);
  assert.match(html, /\[01\]/);
  assert.match(html, /href="https:\/\/github\.com\/a\/b"/);
  assert.match(html, /data-copy="https:\/\/github\.com\/a\/b"/);
  assert.match(html, /\u2605 10/);
  assert.match(html, /\u2191 \+2\/wk/);   // default growth label = weekly
  assert.match(html, /\u2442 3/);
  assert.match(html, /<span class="lang">JS<\/span>/);
});

test('cardsHtml adapts the growth-rate suffix to the board period', () => {
  assert.match(cardsHtml([ITEM], 'daily'), /\u2191 \+2\/day/);
  assert.match(cardsHtml([ITEM], 'monthly'), /\u2191 \+2\/mo/);
});

test('cardsHtml omits empty description and language', () => {
  const html = cardsHtml([{ ...ITEM, description: '', language: '' }]);
  assert.doesNotMatch(html, /class="desc"/);
  assert.doesNotMatch(html, /class="lang"/);
});
