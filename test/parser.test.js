'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseTrending, toInt } = require('../lib/parser');

const FIXTURE = `
<article class="Box-row">
  <h2 class="h3 lh-condensed"><a href="/owner-one/repo-a">owner-one / <span>repo-a</span></a></h2>
  <p class="col-9 color-fg-muted my-1 pr-4">An awesome repository with <b>rich</b> description.</p>
  <div class="f6 color-fg-muted mt-2">
    <a href="/owner-one/repo-a/stargazers">Star <span class="d-inline-block">12,345</span></a>
    <a href="/owner-one/repo-a/forks">Fork <span class="d-inline-block">678</span></a>
    <span itemprop="programmingLanguage">TypeScript</span>
    <span class="d-inline-block float-sm-right">Star 321 stars today</span>
  </div>
</article>
<article class="Box-row">
  <h2 class="h3 lh-condensed"><a href="/owner-two/repo-b">owner-two / <span>repo-b</span></a></h2>
  <div class="f6 color-fg-muted mt-2">
    <a href="/owner-two/repo-b/stargazers">Star <span class="d-inline-block">999</span></a>
    <a href="/owner-two/repo-b/forks">Fork <span class="d-inline-block">88</span></a>
    <span class="d-inline-block float-sm-right">Star 12 stars today</span>
  </div>
</article>
`;

test('parseTrending extracts all fields', () => {
  const items = parseTrending(FIXTURE);
  assert.strictEqual(items.length, 2);
  const [a, b] = items;
  assert.strictEqual(a.name, 'owner-one/repo-a');
  assert.strictEqual(a.url, 'https://github.com/owner-one/repo-a');
  assert.strictEqual(a.description, 'An awesome repository with rich description.');
  assert.strictEqual(a.language, 'TypeScript');
  assert.strictEqual(a.stars, 12345);
  assert.strictEqual(a.todayStars, 321);
  assert.strictEqual(a.forks, 678);
  assert.strictEqual(b.description, '');
  assert.strictEqual(b.language, '');
  assert.strictEqual(b.todayStars, 12);
});

test('toInt strips non-digits', () => {
  assert.strictEqual(toInt('1,234'), 1234);
  assert.strictEqual(toInt(''), 0);
  assert.strictEqual(toInt(undefined), 0);
});
