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

/**
 * Boolean from an environment string, by value rather than truthiness.
 *
 * `z.coerce.boolean()` cannot be used for env vars: it applies JS truthiness, so the
 * string `'false'` — the obvious way to disable a flag — coerces to `true` and the flag
 * can never be turned off. Accepts the spellings people actually write.
 */
const booleanFromEnv = z.preprocess((v) => {
  if (typeof v !== 'string') return v;
  const s = v.trim().toLowerCase();
  if (['false', '0', 'no', 'off', ''].includes(s)) return false;
  if (['true', '1', 'yes', 'on'].includes(s)) return true;
  return v;
}, z.boolean());

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
  /**
   * Path-style addressing (`endpoint/bucket/key`) rather than virtual-hosted
   * (`bucket.endpoint/key`). MinIO requires it; R2 accepts either, and path style is the
   * form Cloudflare's own S3-API examples use — so `true` is correct for both and keeps
   * dev and production on the same code path.
   *
   * Parsed explicitly instead of with `z.coerce.boolean()`, which applies JS truthiness:
   * the string `'false'` is a non-empty string and would coerce to `true`, silently making
   * the flag impossible to turn off.
   */
  S3_FORCE_PATH_STYLE: booleanFromEnv.default(true),
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
  CHECKOUT_SUCCESS_URL: z.string().default('http://localhost:5174/billing/success'),
  CHECKOUT_CANCEL_URL: z.string().default('http://localhost:5174/billing/cancel'),
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
 * accepted as the preferred spelling and translated here, with `S3_*` still valid.
 *
 * **`R2_*` wins when both are set.** It has to: hosting blueprints ship placeholder
 * `S3_*` values so the service can boot before storage is configured, and if those
 * placeholders took precedence, adding real R2 credentials in a dashboard would appear to
 * work while changing nothing. Deferring to the more specific, deliberately-set name is
 * also what the Python worker does, so the two services can't end up disagreeing about
 * which bucket they're using.
 *
 * `R2_ACCOUNT_ID` is expanded into R2's endpoint, which is the one value that genuinely
 * can't be derived the other way round. `R2_JURISDICTION` selects the data-residency
 * variant of that hostname — see R2_JURISDICTION_INFIX.
 */

/**
 * R2 buckets created under a data-residency jurisdiction are reachable only on their own
 * hostname. From the standard one they are invisible rather than forbidden: ListBuckets
 * returns empty and each bucket 404s, while the credentials are still accepted — so the
 * symptom points at a wrong bucket name or the wrong account, not a wrong endpoint.
 *
 * Unset or `default` keeps the plain hostname, so existing deployments are untouched.
 */
const R2_JURISDICTION_INFIX: Record<string, string> = {
  '': '',
  default: '',
  eu: '.eu',
  fedramp: '.fedramp',
};

function applyR2Aliases(env: Record<string, unknown>): Record<string, unknown> {
  const out = { ...env };
  const take = (key: string) => {
    const v = out[key];
    return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
  };

  const accountId = take('R2_ACCOUNT_ID');
  const alias = (from: string, to: string) => {
    const value = take(from);
    if (value !== undefined) out[to] = value;
  };

  alias('R2_ACCESS_KEY', 'S3_ACCESS_KEY');
  alias('R2_SECRET_KEY', 'S3_SECRET_KEY');
  alias('R2_BUCKET', 'S3_BUCKET');

  if (accountId) {
    const jurisdiction = (take('R2_JURISDICTION') ?? '').toLowerCase();
    const infix = R2_JURISDICTION_INFIX[jurisdiction];
    if (infix === undefined) {
      throw new Error(
        `R2_JURISDICTION="${jurisdiction}" is not one of ${Object.keys(R2_JURISDICTION_INFIX)
          .filter(Boolean)
          .join(', ')}`,
      );
    }
    out.S3_ENDPOINT = `https://${accountId}${infix}.r2.cloudflarestorage.com`;
  }

  // Addressing style is deliberately NOT inferred from the endpoint. R2 accepts both
  // path-style and virtual-hosted requests, so there is nothing to correct for, and
  // quietly overriding an operator's explicit choice would only make a real
  // misconfiguration harder to see.
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
