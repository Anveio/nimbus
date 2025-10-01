import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

const entry = path.resolve(__dirname, 'src/index.ts')

export default defineConfig({
  plugins: [
    react({ include: /\.(js|jsx|ts|tsx)$/ }),
    dts({
      entryRoot: 'src',
      tsconfigPath: path.resolve(__dirname, 'tsconfig.json'),
      outDir: 'dist/types',
      rollupTypes: true,
    }),
  ],
  build: {
    sourcemap: true,
    lib: {
      entry,
      name: 'ManaSshTuiReact',
      formats: ['es', 'cjs'],
      fileName: (format) => (format === 'es' ? 'index.mjs' : 'index.cjs'),
    },
    rollupOptions: {
      external: [
        'react',
        'react-dom',
        'react/jsx-runtime',
        '@mana/vt',
        '@mana/tui-web-canvas-renderer',
      ],
    },
  },
})
