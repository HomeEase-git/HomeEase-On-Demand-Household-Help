const EXTENSION_TO_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
};

function extensionOf(urlOrPath: string): string {
  const withoutQuery = urlOrPath.split(/[?#]/)[0] ?? '';
  const lastSegment = withoutQuery.split('/').pop() ?? '';
  const dot = lastSegment.lastIndexOf('.');
  return dot === -1 ? '' : lastSegment.slice(dot + 1).toLowerCase();
}

export function mimeTypeFromUrl(urlOrPath: string | null | undefined): string | null {
  if (!urlOrPath) return null;
  return EXTENSION_TO_MIME[extensionOf(urlOrPath)] ?? null;
}

export function storagePathFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = url.match(/\/object\/(?:public|sign)\/[^/]+\/(.+?)(?:[?#]|$)/);
  if (match?.[1]) return decodeURIComponent(match[1]);
  const tail = url.split(/[?#]/)[0]?.split('/').pop();
  return tail || null;
}
