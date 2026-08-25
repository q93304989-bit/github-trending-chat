'use strict';

function cleanHtml(input) {
  return String(input)
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toInt(input) {
  if (!input) return 0;
  const n = parseInt(String(input).replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

function parseTrending(html) {
  const blocks = String(html).split(/<article\b/i).slice(1);
  const items = [];
  for (const block of blocks) {
    const link = block.match(/<h2[\s\S]*?<a[^>]+href="\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)"/);
    if (!link) continue;
    const name = link[1];
    const descMatch = block.match(/<p[^>]*class="[^"]*col-9[^"]*"[^>]*>([\s\S]*?)<\/p>/);
    const langMatch = block.match(/itemprop="programmingLanguage">([^<]+)</);
    const starsMatch = block.match(/href="\/[^"]+\/stargazers"[\s\S]*?<\/svg>[\s\S]*?([\d,]+)<\/a>/);
    const forksMatch = block.match(/href="\/[^"]+\/forks"[\s\S]*?<\/svg>[\s\S]*?([\d,]+)<\/a>/);
    // Trending labels this counter per period: stars today / this week / this month.
    const periodStarsMatch = block.match(/<span[^>]*float-sm-right[^>]*>[\s\S]*?<\/svg>[\s\S]*?([\d,]+)\s+stars?\s+(?:today|this week|this month)/i);
    items.push({
      name,
      url: `https://github.com/${name}`,
      description: descMatch ? cleanHtml(descMatch[1]) : '',
      language: langMatch ? langMatch[1].trim() : '',
      stars: toInt(starsMatch ? starsMatch[1] : ''),
      weeklyStars: periodStarsMatch ? toInt(periodStarsMatch[1]) : 0,
      forks: toInt(forksMatch ? forksMatch[1] : ''),
    });
  }
  return items;
}

module.exports = { parseTrending, toInt, cleanHtml };
