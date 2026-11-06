import { supabase, KYC_DOCUMENT_BUCKET, RESUME_BUCKET, CHAT_IMAGE_BUCKET, BOOKING_PHOTO_BUCKET } from '@config/supabase';

export const PRIVATE_BUCKETS: ReadonlySet<string> = new Set([KYC_DOCUMENT_BUCKET, RESUME_BUCKET, CHAT_IMAGE_BUCKET]);

export const SIGNED_URL_TTL_SECONDS = 60 * 60;

const OBJECT_PATH_RE = /^\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/;

export interface StorageObjectRef {
  bucket: string;
  path: string;
}

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

export function canonicalObjectUrl(bucket: string, path: string): string {
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

export function toStoredUrl(url: string): string {
  const ref = parseStorageUrl(url);
  return ref ? canonicalObjectUrl(ref.bucket, ref.path) : url;
}

export function isOwnedByUser(url: string, userId: string): boolean {
  const ref = parseStorageUrl(url);
  if (!ref || !PRIVATE_BUCKETS.has(ref.bucket)) return true;
  return ref.path.startsWith(`${userId}/`);
}

export function toOwnedStoredUrl(url: string, userId: string): string | null {
  return isOwnedByUser(url, userId) ? toStoredUrl(url) : null;
}

export function toOwnedBookingPhotoUrls(urls: unknown, userId: string): string[] | null {
  if (!Array.isArray(urls)) return null;
  const out: string[] = [];
  for (const url of urls) {
    const ref = parseStorageUrl(url);
    if (!ref || ref.bucket !== BOOKING_PHOTO_BUCKET || !ref.path.startsWith(`${userId}/`)) return null;
    out.push(canonicalObjectUrl(ref.bucket, ref.path));
  }
  return out;
}

export async function createSignedObjectUrl(bucket: string, path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) {
    throw new Error(`Failed to sign ${bucket}/${path}: ${error?.message ?? 'no URL returned'}`);
  }
  return data.signedUrl;
}

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

const URL_KEY_RE = /url/i;

function isUrlKey(key: string | undefined): boolean {
  return key !== undefined && URL_KEY_RE.test(key);
}

function collectPrivateUrls(value: unknown, out: Set<string>, depth: number, key?: string): void {
  if (depth > 20) return;
  if (typeof value === 'string') {
    if (isUrlKey(key) && isPrivateStorageUrl(value)) out.add(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectPrivateUrls(item, out, depth + 1, key);
  } else if (isPlainObject(value)) {
    for (const [childKey, item] of Object.entries(value)) collectPrivateUrls(item, out, depth + 1, childKey);
  }
}

function replaceUrls(value: unknown, signed: Map<string, string>, depth: number, key?: string): unknown {
  if (depth > 20) return value;
  if (typeof value === 'string') return isUrlKey(key) ? (signed.get(value) ?? value) : value;
  if (Array.isArray(value)) return value.map((item) => replaceUrls(item, signed, depth + 1, key));
  if (isPlainObject(value)) {
    const copy: Record<string, unknown> = {};
    for (const [childKey, item] of Object.entries(value)) copy[childKey] = replaceUrls(item, signed, depth + 1, childKey);
    return copy;
  }
  return value;
}

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
