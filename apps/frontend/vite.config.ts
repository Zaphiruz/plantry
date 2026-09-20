import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // main.tsx registers the worker itself (and reloads once when a new one takes control),
      // so there must be no second, implicit registration script injected into index.html.
      // It also keeps dist/index.html free of inline <script>, which the CSP forbids.
      injectRegister: false,
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Plantry', short_name: 'Plantry', description: 'Shared household inventory',
        theme_color: '#14532d', background_color: '#f8fafc', display: 'standalone', start_url: '/', scope: '/',
        icons: [{ src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      injectManifest: { globPatterns: ['**/*.{js,css,html,svg}'] },
      devOptions: { enabled: false, type: 'module' },
    }),
  ],
  server: { port: 5173, strictPort: true, proxy: { '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false } } },
});
