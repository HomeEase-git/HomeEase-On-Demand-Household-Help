import { Router, type Request, type Response } from 'express';
import crypto from 'node:crypto';
import { authLimiter } from '@middleware/rateLimit';
import { sendTestEmail, getEmailProviderName, getEmailDiagInfo } from '@utils/emailService';

// Server-to-server diagnostics, deliberately outside /api (see app.ts) — same
// CRON_SECRET shared-secret auth as internalCron.ts. OFF unless
// ENABLE_EMAIL_DIAG=true, since /email-test can send mail to an arbitrary
// address: enable it only while validating an email provider, then unset it.
const router = Router();

function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // misconfigured — fail closed

  const header = req.headers['x-cron-secret'];
  if (typeof header !== 'string' || !header) return false;

  const headerBuffer = Buffer.from(header, 'utf8');
  const secretBuffer = Buffer.from(secret, 'utf8');
  if (headerBuffer.length !== secretBuffer.length) return false;

  return crypto.timingSafeEqual(headerBuffer, secretBuffer);
}

/**
 * POST /internal/diag/email-test   body: { "to": "someone@example.com" }
 * Sends one test message through the currently-configured email transport and
 * reports which provider was used, the elapsed time, and the provider message
 * id (or the failure reason). Lets us confirm EMAIL_PROVIDER / SMTP_PORT /
 * gmail-api / brevo config on the real host without creating a signup.
 */
router.post('/email-test', authLimiter, async (req: Request, res: Response) => {
  if (process.env.ENABLE_EMAIL_DIAG !== 'true') {
    res.status(404).json({ ok: false, message: 'Not found' });
    return;
  }
  if (!isAuthorized(req)) {
    res.status(401).json({ ok: false, message: 'Unauthorized' });
    return;
  }

  const to = typeof req.body?.to === 'string' ? req.body.to.trim() : '';
  if (!to) {
    res.status(400).json({ ok: false, message: 'Body { to } is required' });
    return;
  }

  const config = await getEmailDiagInfo().catch(() => ({ provider: getEmailProviderName() }));
  const start = Date.now();
  try {
    const result = await sendTestEmail(to);
    res.json({ ok: true, ms: Date.now() - start, config, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(502).json({ ok: false, ms: Date.now() - start, provider: getEmailProviderName(), config, message });
  }
});

export default router;
