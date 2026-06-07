import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  root: 'client',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'client/src')
    }
  },
  build: {
    outDir: '../dist',   // builds into project root dist/
    emptyOutDir: true,
    rollupOptions: {
      output: {
        assetFileNames: '[name][extname]',
      },
    },
  },
  server: {
    port: 5173,
    // Required for Silero VAD WASM — SharedArrayBuffer needs a secure cross-origin context
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
    proxy: {
      // In local dev: forward /api/* to the Worker running on :8787
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      }
    }
  }
})
