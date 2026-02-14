import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: [
        'src/analytics/latency.ts',
        'src/analytics/uptime.ts',
        'src/monitor/state-machine.ts',
        'src/monitor/targets.ts',
        'src/notify/template.ts',
      ],
      thresholds: {
        lines: 90,
        functions: 90,
        statements: 90,
        // Branch threshold is slightly lower because several defensive/nullish branches are runtime-hard to trigger.
        branches: 85,
      },
    },
  },
});
