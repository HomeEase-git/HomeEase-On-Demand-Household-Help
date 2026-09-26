import type { NextFunction, Request, Response } from 'express';
import { signStorageUrlsDeep } from '@utils/storageUrls';
import { maskEncryptedFieldsDeep } from '@utils/fieldEncryption';

/**
 * Wraps res.json so that, just before any API response is sent:
 *  - private-bucket object URLs (KYC documents, resumes, chat images) are
 *    swapped for short-lived signed URLs, and
 *  - encrypted field values (payout account numbers, TINs) are replaced by
 *    a masked "••••1234" form, so neither ciphertext nor the full number
 *    leaves the API unless a controller deliberately decrypted it.
 *
 * Doing this at the response boundary rather than in each controller means
 * every existing and future endpoint is covered, and whoever could see the
 * value before (per that endpoint's own authorization) is exactly who gets
 * the protected form now. Responses with nothing to protect are sent
 * synchronously, untouched.
 */
export function protectResponseData(_req: Request, res: Response, next: NextFunction): void {
  const originalJson = res.json.bind(res);

  res.json = ((body?: unknown) => {
    let masked: unknown;
    try {
      masked = maskEncryptedFieldsDeep(body);
    } catch (error) {
      console.error('Failed to mask encrypted fields in response:', error);
      return originalJson({ success: false, message: 'Internal server error' });
    }

    signStorageUrlsDeep(masked)
      .then((signedBody) => originalJson(signedBody))
      .catch((error) => {
        console.error('Failed to sign storage URLs in response:', error);
        if (!res.headersSent) originalJson(masked);
      });
    return res;
  }) as Response['json'];

  next();
}
