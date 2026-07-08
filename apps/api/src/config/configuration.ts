import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().default(3000),
  API_BASE_URL: z.string().default('http://localhost:3000'),
  DATABASE_URL: z.string(),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  JWT_ACCESS_SECRET: z.string(),
  JWT_REFRESH_SECRET: z.string(),
  JWT_ACCESS_TTL: z.coerce.number().default(900),
  JWT_REFRESH_TTL: z.coerce.number().default(2592000),

  GOOGLE_CLIENT_ID: z.string().optional(),
  APPLE_CLIENT_ID: z.string().optional(),

  S3_ENDPOINT: z.string(),
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string(),
  S3_ACCESS_KEY: z.string(),
  S3_SECRET_KEY: z.string(),
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true),
  SIGNED_URL_TTL: z.coerce.number().default(3600),

  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_MONTHLY: z.string().optional(),
  STRIPE_PRICE_YEARLY: z.string().optional(),
  CHECKOUT_SUCCESS_URL: z.string().default('http://localhost:5173/billing/success'),
  CHECKOUT_CANCEL_URL: z.string().default('http://localhost:5173/billing/cancel'),
  REVENUECAT_WEBHOOK_SECRET: z.string().optional(),

  SENTRY_DSN: z.string().optional(),
});

export type AppConfig = z.infer<typeof schema>;

/**
 * Validate configuration. `@nestjs/config` passes the parsed .env as `raw` (it only
 * writes those into process.env *after* validation), so we validate `raw` merged
 * over process.env rather than reading process.env directly.
 */
export function loadConfig(raw: Record<string, unknown> = {}): AppConfig {
  const parsed = schema.safeParse({ ...process.env, ...raw });
  if (!parsed.success) {
    // Fail fast & loud on misconfiguration.
    throw new Error(
      'Invalid environment configuration:\n' +
        JSON.stringify(parsed.error.flatten().fieldErrors, null, 2),
    );
  }
  return parsed.data;
}
