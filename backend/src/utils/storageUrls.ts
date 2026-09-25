import { supabase, KYC_DOCUMENT_BUCKET, RESUME_BUCKET, CHAT_IMAGE_BUCKET } from '@config/supabase';

// Buckets holding government IDs, NBI clearances, selfies, resumes and chat
// photos. These are private: their objects are only reachable through
// short-lived signed URLs, never a permanent public link (Data Privacy Act
// §20 — a leaked public URL would expose an ID forever).
//
// Rows in the DB keep storing the bucket's canonical object URL
// (`.../storage/v1/object/public/<bucket>/<path>`) purely as an identifier —
// that's what every existing row already holds, so nothing needs migrating.
// signStorageUrlsInResponse (middleware) swaps those identifiers for signed
// URLs on the way out.
export const PRIVATE_BUCKETS: ReadonlySet<string> = new Set([KYC_DOCUMENT_BUCKET, RESUME_BUCKET, CHAT_IMAGE_BUCKET]);

export const SIGNED_URL_TTL_SECONDS = 60 * 60;

const OBJECT_PATH_RE = /^\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/;

export interface StorageObjectRef {
  bucket: string;
  path: string;
}

/**
 * Parses a URL pointing at an object in THIS project's Supabase Storage —
 * public, signed or authenticated form. Returns null for anything else,
 * including other Supabase projects, so a URL can never be used to reach
 * into a storage account we don't own.
 */
export function parseStorageUrl(url: unknown): StorageObjectRef | null {
  if (typeof url !== 'string' || !url.includes('/storage/v1/object/')) return null;
  const base = process.env.SUPABASE_URL;
  if (!base) return null;

  let parsed: URL;
  let baseParsed: URL;
  try {
    parsed = new URL(url);
    baseParsed = new URL(base);
  } catch {
    return null;
  }
  if (parsed.origin !== baseParsed.origin) return null;

  const match = parsed.pathname.match(OBJECT_PATH_RE);
  if (!match) return null;
  return { bucket: decodeURIComponent(match[1]!), path: decodeURIComponent(match[2]!) };
}

export function isPrivateStorageUrl(url: unknown): boolean {
  const ref = parseStorageUrl(url);
  return ref !== null && PRIVATE_BUCKETS.has(ref.bucket);
}

/** The canonical (token-free) identifier URL for a bucket object. */
export function canonicalObjectUrl(bucket: string, path: string): string {
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

/**
 * Normalizes a client-supplied storage URL before it's persisted: a signed
 * URL (what upload endpoints hand back) is stripped to the canonical form so
 * no expiring token is stored. Non-storage URLs pass through unchanged.
 */
export function toStoredUrl(url: string): string {
  const ref = parseStorageUrl(url);
  return ref ? canonicalObjectUrl(ref.bucket, ref.path) : url;
}

/**
 * True unless `url` points at a private-bucket object that doesn't live
 * under `<userId>/` — uploads are always named `<userId>/<uuid>.<ext>`, so
 * this stops a user attaching someone else's ID or chat photo to their own
 * record (and then receiving a signed URL for it).
 */
export function isOwnedByUser(url: string, userId: string): boolean {
  const ref = parseStorageUrl(url);
  if (!ref || !PRIVATE_BUCKETS.has(ref.bucket)) return true;
  return ref.path.startsWith(`${userId}/`);
}

/**
 * Combines isOwnedByUser + toStoredUrl for write paths: returns the URL to
 * persist, or null when it points at another user's private object (callers
 * reply 400).
 */
export function toOwnedStoredUrl(url: string, userId: string): string | null {
  return isOwnedByUser(url, userId) ? toStoredUrl(url) : null;
}

/** Signed URL for a freshly uploaded private object, for the upload response. */
export async function createSignedObjectUrl(bucket: string, path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) {
    throw new Error(`Failed to sign ${bucket}/${path}: ${error?.message ?? 'no URL returned'}`);
  }
  return data.signedUrl;
}

/**
 * Downloads an object's bytes with the service key — for server-side
 * consumers (AI document review, resume parsing) that used to fetch() the
 * public URL, which stops working once the bucket is private.
 */
export async function downloadStorageObject(url: string): Promise<Buffer> {
  const ref = parseStorageUrl(url);
  if (ref) {
    const { data, error } = await supabase.storage.from(ref.bucket).download(ref.path);
    if (error || !data) {
      throw new Error(`Failed to download ${ref.bucket}/${ref.path}: ${error?.message ?? 'no data'}`);
    }
    return Buffer.from(await data.arrayBuffer());
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function collectPrivateUrls(value: unknown, out: Set<string>, depth: number): void {
  if (depth > 20) return;
  if (typeof value === 'string') {
    if (isPrivateStorageUrl(value)) out.add(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectPrivateUrls(item, out, depth + 1);
  } else if (isPlainObject(value)) {
    for (const item of Object.values(value)) collectPrivateUrls(item, out, depth + 1);
  }
}

function replaceUrls(value: unknown, signed: Map<string, string>, depth: number): unknown {
  if (depth > 20) return value;
  if (typeof value === 'string') return signed.get(value) ?? value;
  if (Array.isArray(value)) return value.map((item) => replaceUrls(item, signed, depth + 1));
  if (isPlainObject(value)) {
    const copy: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) copy[key] = replaceUrls(item, signed, depth + 1);
    return copy;
  }
  // Dates, Prisma Decimals, Buffers etc. — serialize as they always have.
  return value;
}

/**
 * Returns a copy of `value` with every private-bucket object URL replaced by
 * a signed URL (one createSignedUrls call per bucket). Values containing no
 * such URLs are returned as-is without touching Supabase.
 */
export async function signStorageUrlsDeep<T>(value: T): Promise<T> {
  const urls = new Set<string>();
  collectPrivateUrls(value, urls, 0);
  if (urls.size === 0) return value;

  const byBucket = new Map<string, Array<{ url: string; path: string }>>();
  for (const url of urls) {
    const ref = parseStorageUrl(url)!;
    const list = byBucket.get(ref.bucket) ?? [];
    list.push({ url, path: ref.path });
    byBucket.set(ref.bucket, list);
  }

  const signed = new Map<string, string>();
  await Promise.all(
    [...byBucket.entries()].map(async ([bucket, entries]) => {
      const paths = [...new Set(entries.map((e) => e.path))];
      const { data, error } = await supabase.storage.from(bucket).createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
      if (error || !data) {
        console.error(`Failed to sign ${paths.length} object(s) in "${bucket}":`, error);
        return;
      }
      const byPath = new Map<string, string>();
      for (const item of data) {
        if (item.path && item.signedUrl) byPath.set(item.path, item.signedUrl);
      }
      for (const { url, path } of entries) {
        const signedUrl = byPath.get(path);
        if (signedUrl) signed.set(url, signedUrl);
      }
    })
  );

  return replaceUrls(value, signed, 0) as T;
}
