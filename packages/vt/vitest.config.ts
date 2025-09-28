import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: false,
    coverage: {
      enabled: true,
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts'],
    },
  },
})
