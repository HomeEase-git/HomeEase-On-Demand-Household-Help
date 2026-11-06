import type { NextFunction, Request, Response } from 'express';
import { signStorageUrlsDeep } from '@utils/storageUrls';
import { maskEncryptedFieldsDeep } from '@utils/fieldEncryption';

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
