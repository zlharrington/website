import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://harringtonit.com',
  output: 'static',
  trailingSlash: 'never',
  build: {
    format: 'file',
  },
});
