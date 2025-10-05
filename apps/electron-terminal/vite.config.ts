import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, type InlineConfig } from 'vite'

const rootDir = __dirname

const resolveFromRoot = (...segments: string[]): string =>
  path.resolve(rootDir, ...segments)

const targetConfigs: Record<string, InlineConfig> = {
  main: {
    build: {
      target: 'node24',
      emptyOutDir: false,
      sourcemap: true,
      outDir: resolveFromRoot('out'),
      lib: {
        entry: resolveFromRoot('src/main/main.ts'),
        formats: ['cjs'],
        fileName: () => 'main.js',
      },
      rollupOptions: {
        external: ['electron', /^node:/u],
        output: {
          entryFileNames: 'main.js',
          format: 'cjs',
        },
      },
    },
    esbuild: {
      platform: 'node',
    },
  },
  preload: {
    build: {
      target: 'node24',
      emptyOutDir: false,
      sourcemap: true,
      outDir: resolveFromRoot('out'),
      lib: {
        entry: resolveFromRoot('src/main/preload.ts'),
        formats: ['cjs'],
        fileName: () => 'preload.js',
      },
      rollupOptions: {
        external: ['electron', /^node:/u],
        output: {
          entryFileNames: 'preload.js',
          format: 'cjs',
        },
      },
    },
    esbuild: {
      platform: 'node',
    },
  },
  renderer: {
    root: resolveFromRoot('src'),
    base: './',
    publicDir: false,
    plugins: [react()],
    build: {
      target: 'chrome120',
      emptyOutDir: false,
      outDir: resolveFromRoot('out/renderer'),
      sourcemap: true,
      rollupOptions: {
        input: {
          index: resolveFromRoot('src/index.html'),
        },
      },
    },
  },
}

export default defineConfig(({ mode }) => {
  const target = targetConfigs[mode]
  if (!target) {
    const supported = Object.keys(targetConfigs).sort().join(', ')
    throw new Error(`Unknown build mode "${mode}". Expected one of: ${supported}`)
  }

  return target
})
