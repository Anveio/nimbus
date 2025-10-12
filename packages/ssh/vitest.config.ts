import { defineConfig } from 'vitest/config'

const verbose = process.env.VITEST_VERBOSE === 'true'

export default defineConfig({
  root: __dirname,
  resolve: {
    conditions: ['source', 'module', 'import', 'default'],
  },
  test: {
    globals: false,
    include: ['test/**/*.test.ts'],
    reporters: verbose ? ['default'] : ['dot'],
    silent: !verbose,
    snapshotFormat: {
      printBasicPrototype: false,
    },
    coverage: {
      enabled: true,
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts'],
    },
  },
})
