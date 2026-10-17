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
        'src/driver/errorRows.ts',
        'src/driver/runtimeCache.ts',
        'src/driver/dialogs.ts',
        'src/driver/mutex.ts',
        'src/driver/scratch.ts',
        'src/driver/compileState.ts',
        'src/driver/compileMemory.ts',
        'src/driver/strategyPayload.ts',
        'src/driver/provider.ts',
        'src/driver/reportIdentity.ts',
        'src/driver/statusSettle.ts',
        'src/driver/session.ts',
        'src/driver/sessionGuard.ts',
        'src/driver/rowSettle.ts',
        'src/driver/ownedSettle.ts',
      ],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
