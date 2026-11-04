import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/blue/scan': { target: 'http://127.0.0.1:8000', changeOrigin: false },
      '/api/red/variants': { target: 'http://127.0.0.1:8000', changeOrigin: false },
      '/api/red/evidence': { target: 'http://127.0.0.1:8000', changeOrigin: false },
    },
  },
})
