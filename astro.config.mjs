// @ts-check
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://kazutoue45-glitch.github.io',
  base: '/juku-base-lp/',
  server: {
    host: true,
  },
  vite: {
    server: {
      allowedHosts: ['.trycloudflare.com'],
    },
  },
});
