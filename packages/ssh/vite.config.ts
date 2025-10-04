import path from 'node:path'
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

const rootDir = __dirname

const entryPoints = {
  'client/web': path.resolve(rootDir, 'src/client/web/index.ts'),
  'client/node': path.resolve(rootDir, 'src/client/node/index.ts'),
  'server/node': path.resolve(rootDir, 'src/server/node/index.ts'),
}

export default defineConfig({
  plugins: [
    dts({
      entryRoot: path.resolve(rootDir, 'src'),
      tsconfigPath: path.resolve(rootDir, 'tsconfig.json'),
      outDir: path.resolve(rootDir, 'dist'),
      include: ['src/**/*'],
      exclude: ['test/**/*', 'vitest.config.ts'],
      insertTypesEntry: false,
      rollupTypes: true,
    }),
  ],
  build: {
    target: 'es2022',
    outDir: path.resolve(rootDir, 'dist'),
    emptyOutDir: true,
    sourcemap: true,
    lib: {
      entry: entryPoints,
      formats: ['es', 'cjs'],
      fileName: (format, entryName) => {
        const normalized = (entryName ?? 'entry').replace(/\\/g, '/')
        return format === 'es' ? `${normalized}.js` : `${normalized}.cjs`
      },
    },
    rollupOptions: {
      external: [/^(node:)/],
      output: [
        {
          format: 'es',
          dir: path.resolve(rootDir, 'dist'),
          entryFileNames: (chunk) => `${chunk.name}.js`,
          chunkFileNames: (chunk) => `${chunk.name}.js`,
          exports: 'named',
        },
        {
          format: 'cjs',
          dir: path.resolve(rootDir, 'dist'),
          entryFileNames: (chunk) => `${chunk.name}.cjs`,
          chunkFileNames: (chunk) => `${chunk.name}.cjs`,
          exports: 'named',
        },
      ],
    },
  },
})
