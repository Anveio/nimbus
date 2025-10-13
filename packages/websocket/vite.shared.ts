import path from 'node:path'
import type { UserConfigExport } from 'vite'
import dts from 'vite-plugin-dts'

type LibraryFormat = 'es' | 'cjs' | 'iife'

type TargetConfig = {
  readonly entry: string
  readonly fileBase: string
  readonly formats: readonly LibraryFormat[]
  readonly globalName?: string
  readonly inlineDependencies?: boolean
  readonly fileName?: (format: LibraryFormat) => string
}

const rootDir = __dirname
const outDir = path.resolve(rootDir, 'dist')
const entryRoot = path.resolve(rootDir, 'src')
const tsconfigPath = path.resolve(rootDir, 'tsconfig.json')

export const targets = {
  'client-web': {
    entry: 'src/client/web/index.ts',
    fileBase: 'client/web',
    formats: ['es', 'cjs'],
  },
  'client-web-iife': {
    entry: 'src/client/web/index.ts',
    fileBase: 'client/web',
    formats: ['iife'],
    globalName: 'NimbusSSHWebClient',
    inlineDependencies: true,
    fileName: () => 'client/web.global.js',
  },
  'client-node': {
    entry: 'src/client/node/index.ts',
    fileBase: 'client/node',
    formats: ['es', 'cjs'],
  },
  'server-node': {
    entry: 'src/server/node/index.ts',
    fileBase: 'server/node',
    formats: ['es', 'cjs'],
  },
  protocol: {
    entry: 'src/protocol/index.ts',
    fileBase: 'protocol/index',
    formats: ['es', 'cjs'],
  },
} as const satisfies Record<string, TargetConfig>

export type TargetKey = keyof typeof targets

export const createTargetConfig = (targetKey: TargetKey): UserConfigExport => {
  const target = targets[targetKey]

  const entry = path.resolve(rootDir, target.entry)
  const external = target.inlineDependencies ? [] : [/^@nimbus\//u, /^(node:)/u]

  return {
    plugins: [
      dts({
        entryRoot,
        tsconfigPath,
        outDir,
        include: ['src/**/*'],
        exclude: [
          'src/**/*.test.ts',
          'src/**/*.test-utils.ts',
          'src/**/__tests__/**',
          'src/index.ts',
        ],
        insertTypesEntry: false,
        skipDiagnostics: true,
        rollupTypes: false,
      }),
    ],
    build: {
      target: 'es2022',
      outDir,
      emptyOutDir: false,
      sourcemap: true,
      lib: {
        entry,
        formats: target.formats,
        name: target.globalName,
        fileName: (format) =>
          target.fileName?.(format) ??
          `${target.fileBase}.${format === 'es' ? 'js' : format === 'cjs' ? 'cjs' : 'global.js'}`,
      },
      rollupOptions: {
        external,
        output: {
          exports: 'named',
        },
      },
    },
  }
}
