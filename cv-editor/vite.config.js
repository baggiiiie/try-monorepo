import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  assetsInclude: ['**/*.yaml'],
  server: {
    allowedHosts: ['sgwl-olm-053154.tail904199.ts.net'],
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
})
