/**
 * Startup check of the production configuration.
 *
 * Without the first group the app can't run at all, so it refuses to start
 * (Render then keeps the previous deploy serving). Everything else is
 * reported loudly — logged, and sent to Sentry as a warning — but doesn't stop
 * the app, since each one only breaks the feature that uses it.
 */

const REQUIRED = ['DATABASE_URL', 'JWT_SECRET'];

const RECOMMENDED: Array<[string, string]> = [
  ['DATA_ENCRYPTION_KEY', 'payout account numbers and TINs cannot be encrypted or read'],
  ['MFA_ENCRYPTION_KEY', 'admin two-step sign-in cannot work'],
  ['REDIS_URL', 'queued jobs (payouts, reminders, sweeps) cannot run'],
  ['XENDIT_SECRET_KEY', 'online payments, refunds and payouts are off'],
  ['XENDIT_WEBHOOK_TOKEN', 'Xendit payment and payout notifications are rejected'],
  ['CRON_SECRET', 'the hourly sweeps (GitHub Actions) are refused'],
  ['ALLOWED_ORIGINS', 'the admin website cannot call the API'],
  ['SUPABASE_URL', 'uploads (IDs, photos, certificates) are off'],
  ['SUPABASE_SERVICE_KEY', 'uploads (IDs, photos, certificates) are off'],
  ['GOOGLE_MAPS_API_KEY', 'address search and distance fees are off'],
  ['SENTRY_DSN', 'errors are not reported to Sentry'],
  ['PLATFORM_LEGAL_NAME', 'tax certificates show a placeholder business name'],
  ['PLATFORM_TIN', 'tax certificates show no withholding agent TIN'],
];

export interface EnvReport {
  missingRequired: string[];
  warnings: string[];
}

export function checkEnvironment(env: NodeJS.ProcessEnv = process.env): EnvReport {
  const missingRequired = REQUIRED.filter((name) => !env[name]?.trim());
  const warnings: string[] = [];

  for (const [name, effect] of RECOMMENDED) {
    if (!env[name]?.trim()) warnings.push(`${name} is not set — ${effect}.`);
  }
  if (env.JWT_SECRET && env.JWT_SECRET.length < 32) {
    warnings.push('JWT_SECRET is shorter than 32 characters — sign-in tokens are easier to forge.');
  }
  if (env.XENDIT_SECRET_KEY?.startsWith('xnd_development_')) {
    warnings.push('XENDIT_SECRET_KEY is a TEST key — payments are not real money.');
  }
  if ((env.EMAIL_PROVIDER ?? 'smtp') === 'brevo' && !env.BREVO_API_KEY?.trim()) {
    warnings.push('EMAIL_PROVIDER is brevo but BREVO_API_KEY is not set — emails (OTP, receipts) fail.');
  }
  return { missingRequired, warnings };
}
