// KYC uploads arrive in two calls: POST /users/me/kyc-documents/upload stores
// the bytes in Supabase and returns only a URL, then POST /users/me/kyc-documents
// records the row. The mime type is lost between those calls, which left every
// row's `mimeType` null — so the AI review (verificationAiService) filtered the
// document out and fell back to the heuristic, and the admin UI showed no
// preview. The upload step names every file `<userId>/<uuid>.<ext>` where
// `ext = mimetype.split('/')[1]` (uploadController.uploadKycFile), so the URL
// extension is an authoritative, client-independent source of truth we can
// re-derive from here.

const EXTENSION_TO_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
};

/** Lowercased file extension (no dot) from a URL or path, or '' if none. */
function extensionOf(urlOrPath: string): string {
  const withoutQuery = urlOrPath.split(/[?#]/)[0] ?? '';
  const lastSegment = withoutQuery.split('/').pop() ?? '';
  const dot = lastSegment.lastIndexOf('.');
  return dot === -1 ? '' : lastSegment.slice(dot + 1).toLowerCase();
}

/**
 * Best-effort mime type for a KYC document URL, derived from its extension.
 * Returns null for anything we don't recognise (caller stores null rather than
 * guessing wrong).
 */
export function mimeTypeFromUrl(urlOrPath: string | null | undefined): string | null {
  if (!urlOrPath) return null;
  return EXTENSION_TO_MIME[extensionOf(urlOrPath)] ?? null;
}

/**
 * Supabase storage path (`<userId>/<uuid>.<ext>`) parsed from a public URL, for
 * persisting as `KycDocument.fileName`. Falls back to null when the URL doesn't
 * look like a Supabase public object URL.
 */
export function storagePathFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = url.match(/\/object\/(?:public|sign)\/[^/]+\/(.+?)(?:[?#]|$)/);
  if (match?.[1]) return decodeURIComponent(match[1]);
  // Not a recognised Supabase URL shape — keep just the final segment so the
  // admin UI has something more useful than nothing.
  const tail = url.split(/[?#]/)[0]?.split('/').pop();
  return tail || null;
}
