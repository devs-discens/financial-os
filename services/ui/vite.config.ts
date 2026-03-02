import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import basicSsl from '@vitejs/plugin-basic-ssl'

export default defineConfig({
  plugins: [react(), tailwindcss(), basicSsl()],
  server: {
    host: '0.0.0.0',
    proxy: {
      '/auth': 'http://localhost:3020',
      '/admin/': 'http://localhost:3020',
      '/onboarding': 'http://localhost:3020',
      '/connections': 'http://localhost:3020',
      '/twin': 'http://localhost:3020',
      '/council/': 'http://localhost:3020',
      '/background': 'http://localhost:3020',
      '/progress/': 'http://localhost:3020',
      '/goals/': 'http://localhost:3020',
      '/dags': 'http://localhost:3020',
      '/templates': 'http://localhost:3020',
      '/health': 'http://localhost:3020',
      '/registry': 'http://localhost:3010',
    },
  },
})
