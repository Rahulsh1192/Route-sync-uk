import { loadConfig } from './configuration';

/**
 * The minimum every environment needs before `APP_BASE_URL` is even reached. Spread into
 * each case so a test says only what it is actually about.
 *
 * `APP_BASE_URL: undefined` is set explicitly rather than omitted: `loadConfig` merges its
 * argument over `process.env`, so leaving the key out would let a value on the developer's
 * machine decide the result.
 */
const BASE = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  S3_ENDPOINT: 'https://example.r2.cloudflarestorage.com',
  S3_BUCKET: 'bucket',
  S3_ACCESS_KEY: 'key',
  S3_SECRET_KEY: 'secret',
  APP_BASE_URL: undefined as string | undefined,
};

describe('APP_BASE_URL', () => {
  describe('in production', () => {
    const PROD = { ...BASE, NODE_ENV: 'production' };

    it('refuses to start when it is not set', () => {
      // The failure this prevents: the localhost default is silently accepted, and every
      // verification and password-reset email goes out with a link nobody can open. Since
      // Phase 29 gates sign-in on that link, it also means nobody can complete a signup.
      expect(() => loadConfig(PROD)).toThrow(/APP_BASE_URL/);
    });

    it('refuses a localhost origin', () => {
      // Set-but-wrong has to fail too, or copying a dev .env into a dashboard reintroduces
      // exactly the bug that required no value at all.
      expect(() => loadConfig({ ...PROD, APP_BASE_URL: 'http://localhost:5174' })).toThrow(
        /APP_BASE_URL/,
      );
      expect(() => loadConfig({ ...PROD, APP_BASE_URL: 'http://127.0.0.1:5174' })).toThrow(
        /APP_BASE_URL/,
      );
    });

    it('accepts a real origin, trimming any trailing slash', () => {
      const config = loadConfig({ ...PROD, APP_BASE_URL: 'https://www.testroutify.com/' });
      expect(config.APP_BASE_URL).toBe('https://www.testroutify.com');
    });

    it('adds a scheme to a bare hostname, since a link without one is unopenable', () => {
      const config = loadConfig({ ...PROD, APP_BASE_URL: 'www.testroutify.com' });
      expect(config.APP_BASE_URL).toBe('https://www.testroutify.com');
    });
  });

  describe('outside production', () => {
    it('still defaults to the local web app so development needs no configuration', () => {
      const config = loadConfig({ ...BASE, NODE_ENV: 'development' });
      expect(config.APP_BASE_URL).toBe('http://localhost:5174');
    });

    it('allows localhost when it is set explicitly', () => {
      const config = loadConfig({ ...BASE, NODE_ENV: 'test', APP_BASE_URL: 'http://localhost:3001' });
      expect(config.APP_BASE_URL).toBe('http://localhost:3001');
    });
  });
});
