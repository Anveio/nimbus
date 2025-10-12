import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    conditions: ['source', 'module', 'import', 'default'],
  },
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      enabled: true,
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts'],
    },
  },
})
