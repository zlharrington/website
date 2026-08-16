# Harrington IT Website

Harrington IT is a static Astro site deployed on Cloudflare Workers with a small Worker API for contact and support-ticket handling.

## Architecture

- **Astro** builds the public site to `dist/` as static HTML.
- **Shared Astro components** provide the site-wide header and footer.
- Existing page content and SEO metadata are preserved from the legacy root HTML files during this migration, so production `.html` URLs do not change.
- **Cloudflare Workers** serves the generated static assets and routes `/api/*` through `direct-ticket-worker.js`.
- **GitHub Actions** validates the Astro project and verifies every production route before changes merge.
- **Dependabot** monitors npm dependencies.

## Local development

Requires Node.js 22.12 or newer.

```bash
npm install
npm run dev
```

## Validation and build

```bash
npm run check
npm run build
```

The production output is written to `dist/`. Static assets, `robots.txt`, `sitemap.xml`, the web manifest, and `.well-known` files are copied into that directory after Astro builds the pages.

## Deployment

Wrangler is configured with a custom build command, so `wrangler deploy` runs `npm run build` before deploying. Static traffic is served from `dist/`; API routes continue to run through the existing Worker entry point.

```bash
npm run deploy
```

## Contact information

- Phone: (509) 393-7287
- Support email: support@harringtonit.com
