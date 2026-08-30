import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Herdwise',
        short_name: 'Herdwise',
        description: 'Cattle safety — know before she reaches the road',
        theme_color: '#F2C200',
        background_color: '#FFFFFF',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        /*
         * The intro clip is an 11 MB 4K master and must never be precached.
         * Precaching means every install downloads it up front, before the
         * farmer has seen a single animal — on a village connection that is
         * the whole app budget spent on a title sequence. It streams on
         * demand instead, and the poster still (620 KB) carries the opening
         * if it has not arrived.
         */
        globIgnores: ['**/media/*.mp4'],

        /*
         * The default glob covers js/css/html/ico/png/svg, so the poster was
         * not being cached either — which meant an offline launch had no
         * opening image and a blank home backdrop. It is 620 KB, worth it for
         * the one picture the app is built around. The .mp4 stays excluded by
         * globIgnores above.
         */
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,jpg}'],

        // Map tiles are the expensive thing to refetch on one bar of signal.
        // Cache them so the farmer's own zones still draw with no network (§9.1).
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/server\.arcgisonline\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'esri-satellite-tiles',
              expiration: { maxEntries: 1200, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/[abc]\.tile\.openstreetmap\.org\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'osm-tiles',
              expiration: { maxEntries: 800, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Last-known positions must survive going offline, but must never
            // be served as if fresh — the UI always renders their age (§13.1).
            urlPattern: /\/rest\/v1\/(latest_positions|animals|risk_state).*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'herdwise-api',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 },
            },
          },
        ],
      },
    }),
  ],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  build: {
    rollupOptions: {
      output: {
        // Keep Leaflet in its own chunk so the public tag page never downloads
        // a mapping library it does not render (§9.7).
        manualChunks: {
          leaflet: ['leaflet', 'react-leaflet'],
          supabase: ['@supabase/supabase-js'],
          i18n: ['i18next', 'react-i18next'],
        },
      },
    },
  },
});
