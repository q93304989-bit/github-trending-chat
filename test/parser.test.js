'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseTrending, toInt } = require('../lib/parser');

const FIXTURE = `
<article class="Box-row">
  <div class="float-right d-flex">
    <a href="/login?return_to=%2Fowner-one%2Frepo-a">Star</a>
  </div>
  <h2 class="h3 lh-condensed"><a href="/owner-one/repo-a" class="Link">owner-one / <span>repo-a</span></a></h2>
  <p class="col-9 color-fg-muted my-1 tmp-pr-4">An awesome repository with <b>rich</b> description.</p>
  <div class="f6 color-fg-muted mt-2">
    <span itemprop="programmingLanguage">TypeScript</span>
    <a href="/owner-one/repo-a/stargazers"><svg><path d="M8 .25"/></svg>
        12,345</a>
    <a href="/owner-one/repo-a/forks"><svg><path d="M8 .25"/></svg>
        678</a>
    <span class="d-inline-block float-sm-right"><svg><path d="M8 .25"/></svg>
        321 stars this week</span>
  </div>
</article>
<article class="Box-row">
  <div class="float-right d-flex">
    <a href="/sponsors/owner-two">Sponsor</a>
  </div>
  <h2 class="h3 lh-condensed"><a href="/owner-two/repo-b" class="Link">owner-two / <span>repo-b</span></a></h2>
  <div class="f6 color-fg-muted mt-2">
    <span itemprop="programmingLanguage">Rust</span>
    <a href="/owner-two/repo-b/stargazers"><svg><path d="M8 .25"/></svg>
        999</a>
    <a href="/owner-two/repo-b/forks"><svg><path d="M8 .25"/></svg>
        88</a>
    <span class="d-inline-block float-sm-right"><svg><path d="M8 .25"/></svg>
        12 stars this week</span>
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
  assert.strictEqual(a.weeklyStars, 321);
  assert.strictEqual(a.forks, 678);
  assert.strictEqual(b.description, '');
  assert.strictEqual(b.language, 'Rust');
  assert.strictEqual(b.weeklyStars, 12);
});

test('toInt strips non-digits', () => {
  assert.strictEqual(toInt('1,234'), 1234);
  assert.strictEqual(toInt(''), 0);
  assert.strictEqual(toInt(undefined), 0);
});
