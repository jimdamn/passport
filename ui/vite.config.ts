import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// kk-shared-ui is consumed as source during local development via this alias.
// For production Pages builds it will be installed as a git-pinned dependency
// (github:jimdamn/kk-shared-ui), at which point this alias becomes a no-op.
const sharedUi = fileURLToPath(new URL('../../kk-shared-ui/src/index.ts', import.meta.url));
const sharedUiMap = fileURLToPath(new URL('../../kk-shared-ui/src/components/map/RegionMap.tsx', import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      'kk-shared-ui/map': sharedUiMap,
      'kk-shared-ui': sharedUi,
    },
    // The shared-ui source lives outside this app and has no node_modules of its
    // own, so force a single copy of these deps from this app's node_modules.
    dedupe: ['react', 'react-dom', 'react-router-dom', 'lucide-react', '@tanstack/react-query'],
  },
  server: {
    proxy: {
      // 127.0.0.1, not localhost: on Windows/Node 18+ "localhost" resolves to
      // IPv6 ::1 first, but `wrangler pages dev` listens on IPv4, so the proxy
      // throws ECONNREFUSED (internalConnectMultiple) on every /api call.
      '/api': 'http://127.0.0.1:8788',
    },
    fs: {
      // Allow Vite to serve the shared-ui source which lives outside this app root.
      allow: ['..', '../../kk-shared-ui'],
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
});
