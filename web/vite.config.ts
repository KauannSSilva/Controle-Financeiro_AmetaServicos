import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// O site chama a API pelo mesmo endereço (/api), e o Vite repassa para a API local.
// Assim os cookies da sessão (SameSite=Strict) funcionam sem liberar CORS.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: { '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false } },
  },
  preview: { host: '127.0.0.1', port: 5173 },
  build: { sourcemap: false },
});
