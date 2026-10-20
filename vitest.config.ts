import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    // forks pool: the default threads pool loses the worker state on some
    // Windows + Node combinations; forked processes are the robust choice here
    pool: 'forks',
  },
})
