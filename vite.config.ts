import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const base = '/one-word/';
const wordlistHash = createHash('sha256');
for (const file of readdirSync('public/wordlists').filter(file => file.endsWith('.json')).sort()) wordlistHash.update(readFileSync(`public/wordlists/${file}`));
const wordlistCache = `one-word-wordlists-${wordlistHash.digest('hex').slice(0, 12)}`;
const tokens = readFileSync('src/styles/tokens.css', 'utf8');
const backgrounds = [...tokens.matchAll(/--bg:\s*(#[\da-f]+)/gi)].map(match => match[1]!);
const manifest = {
  id: base, name: '一词', short_name: '一词', lang: 'zh-CN', start_url: base, scope: base,
  display: 'standalone' as const, theme_color: backgrounds[0], background_color: backgrounds[0],
  icons: [192, 512].map(size => ({ src: `${base}icons/icon-${size}.png`, sizes: `${size}x${size}`, type: 'image/png', purpose: 'any' })),
};

export default defineConfig({
  define: { __WORDLIST_CACHE__: JSON.stringify(wordlistCache) },
  plugins: [react(), VitePWA({
    registerType: 'prompt', injectRegister: false, manifest,
    includeAssets: ['icons/*.png'],
    workbox: {
      globPatterns: ['**/*.{js,css,html,woff2,png,webmanifest}', 'wordlists/index.json'],
      globIgnores: ['scripts/**', 'tests/**'],
      navigateFallback: `${base}index.html`,
      navigateFallbackDenylist: [/\/tests\//, /\/scripts\//],
      skipWaiting: false, clientsClaim: true,
      runtimeCaching: [{
        urlPattern: ({ url, sameOrigin }) => sameOrigin && /^\/one-word\/wordlists\/(zk|gk|cet4|cet6|ky|ielts|toefl|gre)\.json$/.test(url.pathname),
        handler: 'CacheFirst', options: { cacheName: wordlistCache, cacheableResponse: { statuses: [200] } },
      }],
    },
  }), {
    name: 'one-word-theme',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { name: 'theme-color', content: backgrounds[0]!, media: '(prefers-color-scheme: light)' }, injectTo: 'head' },
      { tag: 'meta', attrs: { name: 'theme-color', content: backgrounds[1]!, media: '(prefers-color-scheme: dark)' }, injectTo: 'head' },
    ],
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'manifest-dark.webmanifest', source: JSON.stringify({ ...manifest, theme_color: backgrounds[1], background_color: backgrounds[1] }) });
    },
  }],
  base,
  build: { assetsInlineLimit: 0 },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
