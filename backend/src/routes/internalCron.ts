import { Router, type Request, type Response } from 'express';
import crypto from 'node:crypto';
import { authLimiter } from '@middleware/rateLimit';
import {
  remindAndAutoSettleCompletions,
  remindAndAutoApproveQuotes,
  resetExpiredAvailabilitySlots,
} from '@workers/bookingWorker';
import { expireOverduePendingBookings } from '@services/pendingExpirySweep';

const router = Router();

const TASKS = {
  'settle-completions': remindAndAutoSettleCompletions,
  'approve-quotes': remindAndAutoApproveQuotes,
  'reset-availability': resetExpiredAvailabilitySlots,
  'expire-pending': expireOverduePendingBookings,
} satisfies Record<string, () => Promise<unknown>>;

type TaskName = keyof typeof TASKS;

/**
 * Constant-time comparison against CRON_SECRET (same pattern as
 * paymentController's Xendit webhook token check) — a shared-secret header,
 * not a signed/timestamped scheme, so timingSafeEqual is what stands between
 * this and a timing side-channel on the secret value.
 */
function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // misconfigured — fail closed, never open

  const header = req.headers['x-cron-secret'];
  if (typeof header !== 'string' || !header) return false;

  const headerBuffer = Buffer.from(header, 'utf8');
  const secretBuffer = Buffer.from(secret, 'utf8');
  if (headerBuffer.length !== secretBuffer.length) return false;

  return crypto.timingSafeEqual(headerBuffer, secretBuffer);
}

/**
 * Runs the booking-lifecycle sweeps that normally fire from BullMQ's
 * repeatable jobs (registerRepeatableBookingJobs, index.ts) plus the
 * per-booking delayed expiry job (pendingExpirySweep.ts). Exists because a
 * host that sleeps on idle (Render's free tier — see DEPLOY.md's free-tier
 * section) takes the in-process BullMQ worker down with it, so those jobs
 * silently stop firing. Meant to be hit hourly by a GitHub Actions
 * workflow; timing tolerance here is "within the hour", so drift/retries on
 * the caller's side don't matter — unlike a keep-alive ping, which needs a
 * tight interval and belongs in an external uptime monitor instead.
 *
 * Deliberately outside /api (see app.ts) so it isn't subject to the broad
 * API rate limiter or CORS allow-list — it's server-to-server, authenticated
 * by CRON_SECRET rather than a user session.
 */
router.post('/:task', authLimiter, async (req: Request, res: Response) => {
  if (!isAuthorized(req)) {
    res.status(401).json({ ok: false, message: 'Unauthorized' });
    return;
  }

  const { task } = req.params;
  const start = Date.now();

  if (task === 'all') {
    const results: Record<TaskName, { ok: boolean; error?: string }> = {} as never;
    for (const [name, run] of Object.entries(TASKS) as [TaskName, () => Promise<unknown>][]) {
      try {
        await run();
        results[name] = { ok: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        results[name] = { ok: false, error: message };
        console.error(`[internal/cron] task "${name}" failed:`, error);
      }
    }
    res.json({ ok: true, task: 'all', ms: Date.now() - start, results });
    return;
  }

  const run = TASKS[task as TaskName];
  if (!run) {
    res.status(404).json({ ok: false, message: `Unknown task: ${task}` });
    return;
  }

  try {
    const result = await run();
    res.json({ ok: true, task, ms: Date.now() - start, ...(result ? { result } : {}) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[internal/cron] task "${task}" failed:`, error);
    res.status(500).json({ ok: false, task, message });
  }
});

export default router;
