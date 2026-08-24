import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

/**
 * Tests run against the source tree directly, outside Electron. Anything that
 * needs `electron` or an initialised data root is mocked per-test rather than
 * booted, which keeps the suite fast and free of side effects on the user's
 * real launcher directory.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@main': resolve(__dirname, 'src/main'),
      '@renderer': resolve(__dirname, 'src/renderer/src')
    }
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
      include: ['src/main/**/*.ts', 'src/shared/**/*.ts'],
      exclude: ['src/main/companion/botEntry.ts']
    }
  }
})
