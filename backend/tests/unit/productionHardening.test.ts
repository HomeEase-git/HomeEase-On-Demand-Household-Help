import request from 'supertest';
import app from '@/app';
import { checkEnvironment } from '@config/envCheck';
import { scrubEvent, scrubBreadcrumb } from '../../src/instrument';

describe('Production config check', () => {
  const complete = {
    DATABASE_URL: 'postgres://x',
    JWT_SECRET: 'a'.repeat(40),
    DATA_ENCRYPTION_KEY: 'd'.repeat(64),
    MFA_ENCRYPTION_KEY: 'm'.repeat(64),
    REDIS_URL: 'redis://x',
    XENDIT_SECRET_KEY: 'xnd_production_abc',
    XENDIT_WEBHOOK_TOKEN: 't'.repeat(40),
    CRON_SECRET: 'c'.repeat(40),
    TRUST_PROXY: '1',
    ALLOWED_ORIGINS: 'https://admin',
    SUPABASE_URL: 'https://s',
    SUPABASE_SERVICE_KEY: 's',
    GOOGLE_MAPS_API_KEY: 'g',
    SENTRY_DSN: 'https://k@sentry/1',
    PLATFORM_LEGAL_NAME: 'HomeEase',
    PLATFORM_TIN: '000',
  };

  it('passes a complete production setup', () => {
    expect(checkEnvironment(complete)).toEqual({ missingRequired: [], warnings: [] });
  });

  it('refuses to start without the database, the sign-in secret or the encryption keys', () => {
    const { missingRequired } = checkEnvironment({
      ...complete,
      DATABASE_URL: '',
      JWT_SECRET: ' ',
      DATA_ENCRYPTION_KEY: undefined,
      MFA_ENCRYPTION_KEY: '',
    });
    expect(missingRequired).toEqual(['DATABASE_URL', 'JWT_SECRET', 'DATA_ENCRYPTION_KEY', 'MFA_ENCRYPTION_KEY']);
  });

  it('refuses to start with a placeholder secret', () => {
    const { missingRequired } = checkEnvironment({
      ...complete,
      JWT_SECRET: 'homeease_development_secret_change_me',
      DATA_ENCRYPTION_KEY: 'REPLACE_ME',
      CRON_SECRET: 'ci-test-cron-secret',
    });
    expect(missingRequired).toEqual([
      'JWT_SECRET (still a placeholder value)',
      'DATA_ENCRYPTION_KEY (still a placeholder value)',
      'CRON_SECRET (still a placeholder value)',
    ]);
  });

  it('warns about short or shared keys, a missing TRUST_PROXY and a rotation in progress', () => {
    const shared = 'x'.repeat(64);
    const { missingRequired, warnings } = checkEnvironment({
      ...complete,
      DATA_ENCRYPTION_KEY: shared,
      MFA_ENCRYPTION_KEY: shared,
      MFA_ENCRYPTION_KEY_PREVIOUS: 'o'.repeat(64),
      CRON_SECRET: 'short',
      TRUST_PROXY: undefined,
    });
    expect(missingRequired).toEqual([]);
    const text = warnings.join('\n');
    expect(text).toMatch(/CRON_SECRET is shorter than 32/);
    expect(text).toMatch(/are the same value/);
    expect(text).toMatch(/MFA_ENCRYPTION_KEY rotation in progress/);
    expect(text).toMatch(/TRUST_PROXY is not set/);
  });

  it('catches a rotation set up backwards', () => {
    const { warnings } = checkEnvironment({ ...complete, DATA_ENCRYPTION_KEY_PREVIOUS: complete.DATA_ENCRYPTION_KEY });
    expect(warnings.join('\n')).toMatch(/DATA_ENCRYPTION_KEY_PREVIOUS equals DATA_ENCRYPTION_KEY/);
  });

  it('warns, without refusing, about anything that only breaks one feature', () => {
    const { missingRequired, warnings } = checkEnvironment({ ...complete, CRON_SECRET: undefined, JWT_SECRET: 'short' });
    expect(missingRequired).toEqual([]);
    expect(warnings.join('\n')).toMatch(/CRON_SECRET is not set/);
    expect(warnings.join('\n')).toMatch(/shorter than 32/);
  });

  it('calls out payments running on a Xendit test key', () => {
    const { warnings } = checkEnvironment({ ...complete, XENDIT_SECRET_KEY: 'xnd_development_abc' });
    expect(warnings).toEqual(['XENDIT_SECRET_KEY is a TEST key — payments are not real money.']);
  });

  it('catches Brevo email switched on without its key', () => {
    const { warnings } = checkEnvironment({ ...complete, EMAIL_PROVIDER: 'brevo' });
    expect(warnings.join('\n')).toMatch(/BREVO_API_KEY is not set/);
  });
});

describe('Error monitoring privacy', () => {
  it('strips bodies, cookies, query strings, secret headers, identities and logged objects', () => {
    const event = scrubEvent({
      type: undefined,
      message: 'Settlement failed',
      request: {
        url: 'https://api/x?token=abc',
        data: '{"tin":"123-456-789-000"}',
        cookies: { s: '1' },
        query_string: 'token=abc',
        headers: { Authorization: 'Bearer x', 'x-callback-token': 'y', 'x-cron-secret': 'z', 'user-agent': 'ok' },
      },
      extra: { arguments: [{ email: 'a@b.c' }], other: 1 },
      user: { email: 'a@b.c' },
    });
    expect(event?.request).toEqual({ url: 'https://api/x', headers: { 'user-agent': 'ok' } });
    expect(event?.extra).toEqual({ other: 1 });
    expect(event?.user).toBeUndefined();
  });

  it('drops expected Redis noise', () => {
    expect(scrubEvent({ type: undefined, message: 'bookingWorker Redis connection error: connect ECONNREFUSED' })).toBeNull();
  });

  it('drops console breadcrumbs and strips query strings from URL breadcrumbs', () => {
    expect(scrubBreadcrumb({ category: 'console', message: 'user a@b.c' })).toBeNull();
    expect(scrubBreadcrumb({ category: 'http', data: { url: 'https://x/y?signature=s' } })?.data?.url).toBe('https://x/y');
  });
});

describe('Malformed request bodies', () => {
  it('answers 400, not 500', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email": broken');
    expect(res.status).toBe(400);
  });
});
