import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const backend = process.env.VITE_BACKEND ?? 'http://localhost:8080';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Smart Transit Baku — avtobus gəlişləri və sıxlıq',
        short_name: 'SmartTransit',
        description: 'Avtobus nə vaxt gəlir və içində yer varmı? Sərnişinlərin real vaxt bildirişləri ilə.',
        lang: 'az',
        id: '/mobile',
        start_url: '/mobile',
        scope: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#ffffff',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        navigateFallbackDenylist: [/^\/api/, /^\/gtfs/, /^\/ws/],
        runtimeCaching: [
          // canlı məlumat: əvvəl şəbəkə, alınmasa son cavab
          { urlPattern: /\/api\/(network|stops|routes|plan|state)/, handler: 'NetworkFirst', options: { cacheName: 'api', networkTimeoutSeconds: 4, expiration: { maxEntries: 80, maxAgeSeconds: 3600 } } },
          // xəritə plitələri: cache-first
          { urlPattern: /tile\.openstreetmap\.org/, handler: 'CacheFirst', options: { cacheName: 'tiles', expiration: { maxEntries: 600, maxAgeSeconds: 7 * 86400 } } },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': backend,
      '/gtfs': backend,
      '/gtfs-rt': backend,
      '/ws': { target: backend.replace(/^http/, 'ws'), ws: true },
    },
  },
  preview: {
    port: 4173,
    proxy: {
      '/api': backend,
      '/gtfs': backend,
      '/gtfs-rt': backend,
      '/ws': { target: backend.replace(/^http/, 'ws'), ws: true },
    },
  },
});
