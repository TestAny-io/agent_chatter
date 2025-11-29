import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.{ts,tsx}', 'tests/integration/**/*.test.{ts,tsx}'],
    // Use forks pool with increased memory for workers
    pool: 'forks',
    poolOptions: {
      forks: {
        // Increase worker memory limit to 4GB
        execArgv: ['--max-old-space-size=4096'],
        // Don't isolate tests within the same file
        isolate: false,
        // Use single fork to avoid parallel overhead
        singleFork: true
      }
    },
    coverage: {
      reporter: ['text', 'html'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['out/**']
    }
  }
});
