import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/ebayAuthRedirect': 'http://127.0.0.1:5001/buymywedding-21/us-central1',
      '/ebayAuthCallback': 'http://127.0.0.1:5001/buymywedding-21/us-central1',
      '/ebayNotification': 'http://127.0.0.1:5001/buymywedding-21/us-central1',
      '/ebayMyListings': 'http://127.0.0.1:5001/buymywedding-21/us-central1',
    },
  },
})
