import { defineConfig } from 'vitest/config'

const verbose = process.env.VITEST_VERBOSE === 'true'

export default defineConfig({
  test: {
    globals: false,
    reporters: verbose ? ['default'] : ['dot'],
    silent: !verbose,
    coverage: {
      enabled: true,
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts'],
    },
  },
})
