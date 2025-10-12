import path from 'node:path'
import react from '@vitejs/plugin-react'
import dts from 'vite-plugin-dts'
import { defineConfig } from 'vite'

const entry = path.resolve(__dirname, 'src/index.ts')
const srcDir = path.resolve(__dirname, 'src')
const distDir = path.resolve(__dirname, 'dist')

export default defineConfig({
  plugins: [
    react({ include: /\.(js|jsx|ts|tsx)$/ }),
    dts({
      entryRoot: srcDir,
      tsconfigPath: path.resolve(__dirname, 'tsconfig.json'),
      outDir: path.resolve(distDir, 'types'),
      copyDtsFiles: true,
      include: ['src/**/*'],
      exclude: ['dev/**/*', 'test/**/*', 'dist/**/*'],
    }),
  ],
  build: {
    outDir: distDir,
    emptyOutDir: true,
    sourcemap: true,
    lib: {
      entry,
      fileName: () => 'index.mjs',
      formats: ['es'],
    },
    rollupOptions: {
      external: [
        'react',
        'react-dom',
        'react/jsx-runtime',
        '@nimbus/webgl-renderer',
      ],
      output: {
        inlineDynamicImports: true,
        exports: 'named',
      },
    },
  },
})
