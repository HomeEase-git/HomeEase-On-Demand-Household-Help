const createSignedUrls = jest.fn();
const download = jest.fn();

jest.mock('@config/supabase', () => ({
  KYC_DOCUMENT_BUCKET: 'kyc-documents',
  RESUME_BUCKET: 'resumes',
  CHAT_IMAGE_BUCKET: 'chat-images',
  supabase: {
    storage: {
      from: (bucket: string) => ({
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `https://proj.supabase.co/storage/v1/object/public/${bucket}/${path}` },
        }),
        createSignedUrls: (paths: string[], ttl: number) => createSignedUrls(bucket, paths, ttl),
        download: (path: string) => download(bucket, path),
      }),
    },
  },
}));

import express from 'express';
import request from 'supertest';
import {
  parseStorageUrl,
  isPrivateStorageUrl,
  toStoredUrl,
  toOwnedStoredUrl,
  signStorageUrlsDeep,
  downloadStorageObject,
  SIGNED_URL_TTL_SECONDS,
} from '@utils/storageUrls';
import { signStorageUrlsInResponse } from '@middleware/signStorageUrls';

const BASE = 'https://proj.supabase.co/storage/v1/object';
const KYC = `${BASE}/public/kyc-documents/user-1/id.jpg`;
const CHAT = `${BASE}/public/chat-images/user-2/photo.png`;
const AVATAR = `${BASE}/public/avatars/user-1/me.jpg`;

const originalSupabaseUrl = process.env.SUPABASE_URL;

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://proj.supabase.co';
  createSignedUrls.mockReset();
  createSignedUrls.mockImplementation(async (bucket: string, paths: string[]) => ({
    data: paths.map((path) => ({ path, signedUrl: `${BASE}/sign/${bucket}/${path}?token=t` })),
    error: null,
  }));
  download.mockReset();
});

afterAll(() => {
  process.env.SUPABASE_URL = originalSupabaseUrl;
});

describe('parseStorageUrl', () => {
  it('parses public and signed object URLs from this project', () => {
    expect(parseStorageUrl(KYC)).toEqual({ bucket: 'kyc-documents', path: 'user-1/id.jpg' });
    expect(parseStorageUrl(`${BASE}/sign/kyc-documents/user-1/id.jpg?token=abc`)).toEqual({
      bucket: 'kyc-documents',
      path: 'user-1/id.jpg',
    });
  });

  it('rejects other Supabase projects and non-storage URLs', () => {
    expect(parseStorageUrl('https://evil.supabase.co/storage/v1/object/public/kyc-documents/user-1/id.jpg')).toBeNull();
    expect(parseStorageUrl('https://example.com/image.jpg')).toBeNull();
    expect(parseStorageUrl(42)).toBeNull();
  });

  it('only treats KYC, resume and chat buckets as private', () => {
    expect(isPrivateStorageUrl(KYC)).toBe(true);
    expect(isPrivateStorageUrl(CHAT)).toBe(true);
    expect(isPrivateStorageUrl(AVATAR)).toBe(false);
  });
});

describe('toStoredUrl / toOwnedStoredUrl', () => {
  it('strips the token from a signed URL before storage', () => {
    expect(toStoredUrl(`${BASE}/sign/kyc-documents/user-1/id.jpg?token=abc`)).toBe(KYC);
  });

  it("refuses another user's private object", () => {
    expect(toOwnedStoredUrl(KYC, 'user-1')).toBe(KYC);
    expect(toOwnedStoredUrl(KYC, 'user-9')).toBeNull();
  });

  it('allows public-bucket and external URLs regardless of owner', () => {
    expect(toOwnedStoredUrl(AVATAR, 'user-9')).toBe(AVATAR);
    expect(toOwnedStoredUrl('https://example.com/a.jpg', 'user-9')).toBe('https://example.com/a.jpg');
  });
});

describe('signStorageUrlsDeep', () => {
  it('signs nested private URLs with one call per bucket and leaves the rest alone', async () => {
    const createdAt = new Date('2026-09-25T00:00:00Z');
    const body = {
      data: {
        documents: [{ fileUrl: KYC }, { fileUrl: KYC }],
        messages: [{ imageUrl: CHAT, createdAt }],
        avatar: AVATAR,
      },
    };

    const result = await signStorageUrlsDeep(body);

    expect(createSignedUrls).toHaveBeenCalledTimes(2);
    expect(createSignedUrls).toHaveBeenCalledWith('kyc-documents', ['user-1/id.jpg'], SIGNED_URL_TTL_SECONDS);
    expect(result.data.documents[0]!.fileUrl).toBe(`${BASE}/sign/kyc-documents/user-1/id.jpg?token=t`);
    expect(result.data.messages[0]!.imageUrl).toBe(`${BASE}/sign/chat-images/user-2/photo.png?token=t`);
    expect(result.data.messages[0]!.createdAt).toBe(createdAt);
    expect(result.data.avatar).toBe(AVATAR);
    // Original object is not mutated.
    expect(body.data.documents[0]!.fileUrl).toBe(KYC);
  });

  it('does not call Supabase when there is nothing to sign', async () => {
    const body = { data: { avatar: AVATAR } };
    await expect(signStorageUrlsDeep(body)).resolves.toBe(body);
    expect(createSignedUrls).not.toHaveBeenCalled();
  });

  it('falls back to the stored URL if signing fails', async () => {
    createSignedUrls.mockResolvedValue({ data: null, error: new Error('boom') });
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const result = await signStorageUrlsDeep({ url: KYC });
    expect(result.url).toBe(KYC);
    errorSpy.mockRestore();
  });
});

describe('downloadStorageObject', () => {
  it('downloads private objects with the service key instead of fetching the URL', async () => {
    download.mockResolvedValue({ data: new Blob([Buffer.from('bytes')]), error: null });
    const buffer = await downloadStorageObject(KYC);
    expect(download).toHaveBeenCalledWith('kyc-documents', 'user-1/id.jpg');
    expect(buffer.toString()).toBe('bytes');
  });
});

describe('signStorageUrlsInResponse middleware', () => {
  it('signs URLs in JSON responses', async () => {
    const app = express();
    app.use(signStorageUrlsInResponse);
    app.get('/doc', (_req, res) => res.status(201).json({ success: true, data: { fileUrl: KYC } }));

    const res = await request(app).get('/doc');

    expect(res.status).toBe(201);
    expect(res.body.data.fileUrl).toBe(`${BASE}/sign/kyc-documents/user-1/id.jpg?token=t`);
  });
});
