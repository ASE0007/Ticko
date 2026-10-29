import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('8h'),
  BCRYPT_COST: z.coerce.number().int().min(4).max(15).default(12),

  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  MAX_ACTIVE_TICKETS: z.coerce.number().int().min(1).max(20).default(2),
  VERIFY_PASS_THRESHOLD: z.coerce.number().min(0).max(1).default(0.8),
  AUTO_CLOSE_HOURS: z.coerce.number().positive().default(48),

  PROBE_STAGE_MS: z.coerce.number().int().min(1).max(60000).default(2500),
  SCHEDULER_TICK_MS: z.coerce.number().int().min(50).max(60000).default(1000),
  DEMO_MODE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  RATE_LIMIT_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(3),
  DEMO_TIME_SCALE: z.coerce.number().positive().max(3600).default(1),
});

export type Env = z.infer<typeof schema>;

function load(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    // Fail fast with a readable message (configuration management)
    console.error('Invalid environment configuration:');
    for (const issue of parsed.error.issues) {
      console.error(`   - ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }
  return parsed.data;
}

export const env: Env = load();
export const isProd = env.NODE_ENV === 'production';
/** Simulation overrides (force PASS/FAIL verification, fast demo tools) are never on in plain production. */
export const simulationOverridesEnabled = !isProd || env.DEMO_MODE;
