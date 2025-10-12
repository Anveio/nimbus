import path from 'node:path'
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

type TargetConfig = {
  readonly entry: string
  readonly fileBase: string
  readonly formats: ('es' | 'cjs' | 'iife')[]
  readonly globalName?: string
  readonly inlineDependencies?: boolean
  readonly fileName?: (format: 'es' | 'cjs' | 'iife') => string
}

const rootDir = __dirname

const targets = {
  index: {
    entry: 'src/index.ts',
    fileBase: 'index',
    formats: ['es', 'cjs'],
  },
  'root-entrypoint': {
    entry: 'src/root-entrypoint-block.ts',
    fileBase: 'root-entrypoint-block',
    formats: ['es', 'cjs'],
  },
  'client-browser': {
    entry: 'src/client/browser.ts',
    fileBase: 'client/browser',
    formats: ['es', 'cjs'],
  },
  'client-browser-iife': {
    entry: 'src/client/browser.ts',
    fileBase: 'client/browser',
    formats: ['iife'],
    globalName: 'NimbusSSHWebClient',
    inlineDependencies: true,
    fileName: () => 'client/browser.global.js',
  },
  'client-web': {
    entry: 'src/client/web.ts',
    fileBase: 'client/web',
    formats: ['es', 'cjs'],
  },
  'client-node': {
    entry: 'src/client/node.ts',
    fileBase: 'client/node',
    formats: ['es', 'cjs'],
  },
  'server-node': {
    entry: 'src/server/node.ts',
    fileBase: 'server/node',
    formats: ['es', 'cjs'],
  },
  protocol: {
    entry: 'src/protocol/index.ts',
    fileBase: 'protocol/index',
    formats: ['es', 'cjs'],
  },
} as const satisfies Record<string, TargetConfig>

type TargetKey = keyof typeof targets

type InlineConfig = Parameters<typeof defineConfig>[0]

type ModeFactory = Exclude<InlineConfig, any[]> extends (
  ...args: infer P
) => infer R
  ? (...args: P) => R
  : never

export default defineConfig((context) => {
  const mode = context.mode as TargetKey
  const target = targets[mode]

  if (!target) {
    const available = Object.keys(targets).sort().join(', ')
    throw new Error(
      `Unknown build target "${context.mode}". Expected one of: ${available}`,
    )
  }

  const entry = path.resolve(rootDir, target.entry)
  const outDir = path.resolve(rootDir, 'dist')
  const external = target.inlineDependencies ? [] : [/^@nimbus\//u, /^(node:)/u]

  return {
    plugins: [
      dts({
        entryRoot: path.resolve(rootDir, 'src'),
        tsconfigPath: path.resolve(rootDir, 'tsconfig.json'),
        outDir,
        include: ['src/**/*'],
        exclude: [
          'src/**/*.test.ts',
          'src/**/*.test-utils.ts',
          'src/**/__tests__/**',
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
}) satisfies ReturnType<ModeFactory>
