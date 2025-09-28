import { defineConfig } from 'vitest/config'

const verbose = process.env.VITEST_VERBOSE === 'true'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['test/**/*.test.ts'],
    reporters: verbose ? ['default'] : ['dot'],
    silent: !verbose,
    snapshotFormat: {
      printBasicPrototype: false,
    },
  },
})
