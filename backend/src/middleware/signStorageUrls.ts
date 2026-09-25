import type { NextFunction, Request, Response } from 'express';
import { signStorageUrlsDeep } from '@utils/storageUrls';

/**
 * Wraps res.json so any private-bucket object URL (KYC documents, resumes,
 * chat images) in a JSON response is swapped for a short-lived signed URL
 * just before it's sent. Doing this at the response boundary rather than in
 * each controller means every existing and future endpoint that returns one
 * of these URLs is covered, and whoever could see the URL before (per that
 * endpoint's own authorization) is exactly who gets a signed one now.
 *
 * Responses with no such URL are sent synchronously, untouched.
 */
export function signStorageUrlsInResponse(_req: Request, res: Response, next: NextFunction): void {
  const originalJson = res.json.bind(res);

  res.json = ((body?: unknown) => {
    signStorageUrlsDeep(body)
      .then((signedBody) => originalJson(signedBody))
      .catch((error) => {
        console.error('Failed to sign storage URLs in response:', error);
        if (!res.headersSent) originalJson(body);
      });
    return res;
  }) as Response['json'];

  next();
}
