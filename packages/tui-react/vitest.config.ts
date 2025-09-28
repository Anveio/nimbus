import { defineConfig } from 'vitest/config'

const verbose = process.env.VITEST_VERBOSE === 'true'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    reporters: verbose ? ['default'] : ['dot'],
    silent: !verbose,
    setupFiles: ['./vitest.setup.ts'],
  },
})
