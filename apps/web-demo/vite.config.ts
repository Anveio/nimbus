import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(new URL(import.meta.url))),
  '..',
  '..',
)

function resolveWorkspacePath(...segments: string[]): string {
  return path.resolve(workspaceRoot, ...segments)
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react({ include: /\.(js|jsx|ts|tsx)$/ })],
  resolve: {
    alias: {
      '@mana/ssh': resolveWorkspacePath('packages/ssh/src'),
      '@mana/websocket': resolveWorkspacePath('packages/websocket/src'),
    },
  },
})
