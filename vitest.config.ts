import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: [
        'src/parsers/**',
        'src/result.ts',
        'src/config.ts',
        'src/driver/waits.ts',
        'src/driver/layout.ts',
        'src/driver/ownership.ts',
        'src/driver/selftest.ts',
        'src/driver/chartUrl.ts',
        'src/driver/clipboard.ts',
      ],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
