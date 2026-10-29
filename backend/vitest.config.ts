import { defineConfig } from 'vitest/config';
import { TEST_DB_URL } from './tests/testEnv';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['tests/globalSetup.ts'],
    fileParallelism: false, // one shared test database
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Deterministic config for tests (no .env needed in CI)
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: TEST_DB_URL,
      JWT_SECRET: 'test-secret-test-secret-test-secret-123456',
      LOG_LEVEL: 'silent',
      BCRYPT_COST: '4',
      PROBE_STAGE_MS: '20',
      SCHEDULER_TICK_MS: '100',
      WORKER_CONCURRENCY: '2',
      DEMO_MODE: 'true',
      RATE_LIMIT_ENABLED: 'false',
      DEMO_TIME_SCALE: '600', // 1 real second = 10 simulated minutes
    },
  },
});
