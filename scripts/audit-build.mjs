import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const pages = [
  ['index.html', 'https://harringtonit.com/'],
  ['services.html', 'https://harringtonit.com/services'],
  ['managed-it-services.html', 'https://harringtonit.com/managed-it-services'],
  ['cybersecurity.html', 'https://harringtonit.com/cybersecurity'],
  ['microsoft-365.html', 'https://harringtonit.com/microsoft-365'],
  ['networking.html', 'https://harringtonit.com/networking'],
  ['backup-disaster-recovery.html', 'https://harringtonit.com/backup-disaster-recovery'],
  ['it-consulting.html', 'https://harringtonit.com/it-consulting'],
  ['website-support.html', 'https://harringtonit.com/website-support'],
  ['support.html', 'https://harringtonit.com/support'],
  ['privacy.html', 'https://harringtonit.com/privacy'],
  ['terms.html', 'https://harringtonit.com/terms'],
];

const errors = [];
const canonicalSet = new Set();

for (const [file, expectedCanonical] of pages) {
  const html = await readFile(join('dist', file), 'utf8');
  const label = `dist/${file}`;

  const titles = [...html.matchAll(/<title>([\s\S]*?)<\/title>/gi)];
  if (titles.length !== 1 || !titles[0][1].trim()) errors.push(`${label}: expected exactly one non-empty <title>.`);

  const descriptions = [...html.matchAll(/<meta\s+[^>]*name=["']description["'][^>]*>/gi)];
  if (descriptions.length !== 1) errors.push(`${label}: expected exactly one meta description.`);

  if (!/<meta\s+[^>]*name=["']viewport["'][^>]*>/i.test(html)) errors.push(`${label}: missing viewport meta tag.`);
  if (!/<html\s+[^>]*lang=["']en["']/i.test(html)) errors.push(`${label}: missing html lang="en".`);

  const h1s = [...html.matchAll(/<h1\b/gi)];
  if (h1s.length !== 1) errors.push(`${label}: expected exactly one H1, found ${h1s.length}.`);

  const canonicalMatch = html.match(/<link\s+[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["'][^>]*>/i)
    ?? html.match(/<link\s+[^>]*href=["']([^"']+)["'][^>]*rel=["']canonical["'][^>]*>/i);
  const canonical = canonicalMatch?.[1];
  if (canonical !== expectedCanonical) errors.push(`${label}: canonical is ${canonical ?? 'missing'}, expected ${expectedCanonical}.`);
  if (canonical) {
    if (canonicalSet.has(canonical)) errors.push(`${label}: duplicate canonical ${canonical}.`);
    canonicalSet.add(canonical);
  }

  const internalHtmlLinks = [...html.matchAll(/href=["'](\/?[a-z0-9-]+\.html(?:[?#][^"']*)?)["']/gi)].map(match => match[1]);
  if (internalHtmlLinks.length) errors.push(`${label}: legacy .html internal links remain: ${internalHtmlLinks.join(', ')}`);

  for (const image of html.matchAll(/<img\b([^>]*)>/gi)) {
    if (!/\balt=["'][^"']*["']/i.test(image[1])) errors.push(`${label}: image missing alt attribute: <img${image[1]}>`);
  }
}

const sitemap = await readFile(join('dist', 'sitemap.xml'), 'utf8');
for (const [, canonical] of pages) {
  if (!sitemap.includes(`<loc>${canonical}</loc>`)) errors.push(`dist/sitemap.xml: missing canonical URL ${canonical}.`);
}
if (/\.html<\/loc>/i.test(sitemap)) errors.push('dist/sitemap.xml: legacy .html URLs remain.');

const robots = await readFile(join('dist', 'robots.txt'), 'utf8');
if (!/Sitemap:\s*https:\/\/harringtonit\.com\/sitemap\.xml/i.test(robots)) errors.push('dist/robots.txt: sitemap declaration is missing or incorrect.');

if (errors.length) {
  console.error(`Build audit failed with ${errors.length} issue(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Build audit passed for ${pages.length} indexable pages.`);
