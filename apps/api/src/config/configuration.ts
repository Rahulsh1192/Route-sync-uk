import { z } from 'zod';

/**
 * Asset classes that may ever be served from a public CDN origin.
 *
 * Thumbnails only. They are already visible to unauthenticated visitors on listing
 * pages, so a public URL leaks nothing, and they are requested far more often than the
 * video — exactly the workload an edge cache is for. Everything else (HLS playlists,
 * segments, merged masters) stays behind short-lived signed URLs.
 *
 * `StorageService` enforces the same list independently, so a mistake in one layer
 * cannot expose paid footage on its own.
 */
export const PUBLICLY_SERVABLE_ASSETS = ['thumbnail'];

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().default(3000),
  /**
   * Public origin of this API. The signed HLS gateway builds playback URLs from it.
   *
   * Normalised to include a scheme because the usual way to populate it in a hosting
   * platform (Render's `fromService: property: host`, and most equivalents) yields a bare
   * hostname — which would silently produce relative-looking playlist URLs that no player
   * can resolve. Deliberately not derived from the request's Host header: that is
   * attacker-controlled, and this value is embedded in a manifest clients then fetch.
   */
  API_BASE_URL: z
    .string()
    .default('http://localhost:3000')
    .transform((v) => {
      const trimmed = v.trim().replace(/\/+$/, '');
      return /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
    }),
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

  /**
   * Upload URLs are deliberately shorter-lived than playback URLs: a signed PUT is a
   * write capability, so 15 minutes is the required window. Playback keeps its own
   * (longer) TTL via SIGNED_URL_TTL so streaming sessions don't break mid-video.
   */
  UPLOAD_SIGNED_URL_TTL: z.coerce.number().default(900),

  /**
   * Public Cloudflare CDN origin for the bucket (e.g. https://media.testroutify.com).
   *
   * Optional. Route video is paid content behind a per-test-centre paywall, so video is
   * NEVER served from this origin no matter how it is configured (see
   * `CDN_PUBLIC_ASSETS` and `StorageService.PUBLIC_ASSET_CLASSES`). Setting this only
   * moves thumbnails onto the CDN edge, which is safe because they already appear on
   * unpaid listing pages.
   *   - unset → thumbnails are signed too (nothing is public anywhere)
   *   - set   → thumbnails come from the CDN; video stays signed and entitlement-gated
   */
  R2_PUBLIC_URL: z.string().optional(),

  /**
   * Which asset classes may be served from the public CDN origin.
   *
   * Only `thumbnail` is accepted. A public URL has no expiry and no identity, so putting
   * `hls` or `master` here would hand out permanent, shareable access to paid footage and
   * bypass every entitlement check in the app. Rather than trust an operator to know
   * that, the values are validated here and the process refuses to start — a security
   * boundary that can be crossed by editing an env var is not a boundary. Set to an
   * empty string to serve even thumbnails as signed URLs.
   */
  CDN_PUBLIC_ASSETS: z
    .string()
    .default('thumbnail')
    .transform((s) =>
      s
        .split(',')
        .map((v) => v.trim().toLowerCase())
        .filter(Boolean),
    )
    .superRefine((classes, ctx) => {
      const rejected = classes.filter((c) => !PUBLICLY_SERVABLE_ASSETS.includes(c));
      if (rejected.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            `refusing to serve ${rejected.join(', ')} from a public CDN origin: route ` +
            `video is paid content and a public URL cannot be expired or attributed. ` +
            `Allowed values: ${PUBLICLY_SERVABLE_ASSETS.join(', ')}.`,
        });
      }
    }),

  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_MONTHLY: z.string().optional(),
  STRIPE_PRICE_YEARLY: z.string().optional(),
  CHECKOUT_SUCCESS_URL: z.string().default('http://localhost:5173/billing/success'),
  CHECKOUT_CANCEL_URL: z.string().default('http://localhost:5173/billing/cancel'),
  REVENUECAT_WEBHOOK_SECRET: z.string().optional(),

  SENTRY_DSN: z.string().optional(),

  /** Phase 24 — shared secret the media worker uses for /internal/* endpoints. */
  WORKER_SHARED_SECRET: z.string().optional(),
});

export type AppConfig = z.infer<typeof schema>;

/**
 * Map the Cloudflare-flavoured `R2_*` env names onto the `S3_*` keys this app has
 * always used.
 *
 * R2 is S3-compatible, so the client is identical — only the names differ. Rather than
 * rename the existing variables (which would break every deployed environment,
 * `render.yaml`, `docker-compose.yml` and the Python worker at once), `R2_*` is
 * accepted as the preferred spelling and translated here. `S3_*` remains a valid
 * fallback, and an explicitly-set `S3_*` wins so a mixed environment stays predictable.
 *
 * `R2_ACCOUNT_ID` is expanded into R2's standard endpoint, which is the one value that
 * genuinely can't be derived the other way round.
 */
function applyR2Aliases(env: Record<string, unknown>): Record<string, unknown> {
  const out = { ...env };
  const take = (key: string) => {
    const v = out[key];
    return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
  };

  const accountId = take('R2_ACCOUNT_ID');
  const alias = (from: string, to: string) => {
    const value = take(from);
    if (value !== undefined && take(to) === undefined) out[to] = value;
  };

  alias('R2_ACCESS_KEY', 'S3_ACCESS_KEY');
  alias('R2_SECRET_KEY', 'S3_SECRET_KEY');
  alias('R2_BUCKET', 'S3_BUCKET');

  if (accountId && take('S3_ENDPOINT') === undefined) {
    out.S3_ENDPOINT = `https://${accountId}.r2.cloudflarestorage.com`;
  }

  // R2 is virtual-hosted style and rejects path-style addressing; MinIO (local dev)
  // requires path style. Infer from which backend is configured rather than making
  // every environment remember the flag.
  const endpoint = take('S3_ENDPOINT');
  if (endpoint?.includes('r2.cloudflarestorage.com') && take('S3_FORCE_PATH_STYLE') === undefined) {
    out.S3_FORCE_PATH_STYLE = 'false';
  }

  return out;
}

/**
 * Validate configuration. `@nestjs/config` passes the parsed .env as `raw` (it only
 * writes those into process.env *after* validation), so we validate `raw` merged
 * over process.env rather than reading process.env directly.
 */
export function loadConfig(raw: Record<string, unknown> = {}): AppConfig {
  const merged = applyR2Aliases({ ...process.env, ...raw });
  const parsed = schema.safeParse(merged);
  if (!parsed.success) {
    // Fail fast & loud on misconfiguration.
    throw new Error(
      'Invalid environment configuration:\n' +
        JSON.stringify(parsed.error.flatten().fieldErrors, null, 2),
    );
  }
  return parsed.data;
}
