import { cp, copyFile, mkdir } from 'node:fs/promises';

await mkdir('dist', { recursive: true });
await cp('assets', 'dist/assets', { recursive: true });
await cp('.well-known', 'dist/.well-known', { recursive: true });

for (const file of ['robots.txt', 'sitemap.xml', 'site.webmanifest', '_redirects']) {
  await copyFile(file, `dist/${file}`);
}
