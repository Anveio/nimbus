import path from 'node:path'
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

const rootDir = __dirname

const targets = {
  'client-web': { entry: 'src/client/web/index.ts', fileBase: 'client/web' },
  'client-node': { entry: 'src/client/node/index.ts', fileBase: 'client/node' },
  'server-node': { entry: 'src/server/node/index.ts', fileBase: 'server/node' },
} as const

type TargetKey = keyof typeof targets

export default defineConfig(({ mode }) => {
  const targetKey = mode as TargetKey
  const target = targets[targetKey]
  if (!target) {
    const available = Object.keys(targets).join(', ')
    throw new Error(
      `Unknown build target '${mode}'. Expected one of: ${available}`,
    )
  }

  return {
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
      emptyOutDir: false,
      sourcemap: true,
      lib: {
        entry: path.resolve(rootDir, target.entry),
        formats: ['es', 'cjs'],
        fileName: (format) =>
          `${target.fileBase}.${format === 'es' ? 'js' : 'cjs'}`,
      },
      rollupOptions: {
        external: [/^(node:)/],
      },
    },
  }
})
