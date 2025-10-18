import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const rootDir = path.resolve(__dirname, 'dev')
const outDir = path.resolve(__dirname, 'dist', 'e2e')

export default defineConfig({
  root: rootDir,
  plugins: [react({ include: /\.(js|jsx|ts|tsx)$/ })],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir,
    emptyOutDir: true,
  },
  server: {
    host: '127.0.0.1',
    port: Number(process.env.PORT ?? 5173),
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: Number(process.env.PORT ?? 5173),
    strictPort: true,
    open: false,
  },
})
