import { defineConfig } from 'vitest/config'

const verbose = process.env.VITEST_VERBOSE === 'true'

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    reporters: verbose ? ['default'] : ['dot'],
    silent: !verbose,
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['e2e/**'],
    coverage: {
      enabled: true,
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.d.ts'],
    },
  },
})
