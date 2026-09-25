import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import multer from 'multer';
import prisma from '@config/database';
import { supabase, PROMO_BANNER_BUCKET } from '@config/supabase';
import { errorResponse } from '@utils/errorResponse';
import { writeAuditLog } from '@utils/auditLog';
import type { JwtPayload } from '@/types/index';

interface AuthRequest extends Request {
  user?: JwtPayload;
  file?: Express.Multer.File;
}

const TITLE_MAX = 60;
const SUBTITLE_MAX = 120;
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE_BYTES = Number(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024;

export type PromoBannerInput = {
  title?: unknown;
  subtitle?: unknown;
  imageUrl?: unknown;
  linkServiceTypeId?: unknown;
  isActive?: unknown;
  startsAt?: unknown;
  endsAt?: unknown;
};

type CleanBanner = {
  title?: string;
  subtitle?: string | null;
  imageUrl?: string;
  linkServiceTypeId?: string | null;
  isActive?: boolean;
  startsAt?: Date | null;
  endsAt?: Date | null;
};

function parseOptionalDate(value: unknown, field: string): Date | null | string {
  if (value === null || value === '' || value === undefined) return null;
  if (typeof value !== 'string') return `${field} must be a date string.`;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? `${field} is not a valid date.` : date;
}

/**
 * Checks and normalises a banner body. `partial` (updates) only validates
 * the fields that were sent. Returns the cleaned data or an error message.
 */
export function validatePromoBannerInput(
  body: PromoBannerInput,
  { partial = false }: { partial?: boolean } = {},
): { data: CleanBanner } | { error: string } {
  const data: CleanBanner = {};

  if (!partial || body.title !== undefined) {
    if (typeof body.title !== 'string' || !body.title.trim()) return { error: 'Title is required.' };
    if (body.title.trim().length > TITLE_MAX) return { error: `Title must be ${TITLE_MAX} characters or less.` };
    data.title = body.title.trim();
  }
  if (body.subtitle !== undefined) {
    if (body.subtitle !== null && typeof body.subtitle !== 'string') return { error: 'Subtitle must be text.' };
    const subtitle = typeof body.subtitle === 'string' ? body.subtitle.trim() : '';
    if (subtitle.length > SUBTITLE_MAX) return { error: `Subtitle must be ${SUBTITLE_MAX} characters or less.` };
    data.subtitle = subtitle || null;
  }
  if (!partial || body.imageUrl !== undefined) {
    if (typeof body.imageUrl !== 'string' || !/^https:\/\//.test(body.imageUrl)) {
      return { error: 'An uploaded image is required.' };
    }
    data.imageUrl = body.imageUrl;
  }
  if (body.linkServiceTypeId !== undefined) {
    if (body.linkServiceTypeId !== null && typeof body.linkServiceTypeId !== 'string') {
      return { error: 'Linked category must be an id.' };
    }
    data.linkServiceTypeId = (body.linkServiceTypeId as string | null) || null;
  }
  if (body.isActive !== undefined) {
    if (typeof body.isActive !== 'boolean') return { error: 'isActive must be true or false.' };
    data.isActive = body.isActive;
  }
  for (const field of ['startsAt', 'endsAt'] as const) {
    if (body[field] !== undefined) {
      const parsed = parseOptionalDate(body[field], field);
      if (typeof parsed === 'string') return { error: parsed };
      data[field] = parsed;
    }
  }
  if (data.startsAt && data.endsAt && data.endsAt <= data.startsAt) {
    return { error: 'The end date must be after the start date.' };
  }
  return { data };
}

function actor(req: AuthRequest) {
  return { actorId: req.user?.userId, actorName: req.user?.email, actorRole: req.user?.role };
}

/** GET /api/promo-banners — what the client app's home screen shows right now. */
export const listActivePromoBanners = async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const banners = await prisma.promoBanner.findMany({
      where: {
        isActive: true,
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
        ],
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, title: true, subtitle: true, imageUrl: true, linkServiceTypeId: true },
    });
    return res.json({ success: true, data: banners });
  } catch (error) {
    console.error('List promo banners error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

/** GET /api/admin/promo-banners — every banner, including inactive and scheduled ones. */
export const adminListPromoBanners = async (_req: Request, res: Response) => {
  try {
    const banners = await prisma.promoBanner.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
    return res.json({ success: true, data: banners });
  } catch (error) {
    console.error('Admin list promo banners error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

/** POST /api/admin/promo-banners — new banners go to the end of the list. */
export const createPromoBanner = async (req: AuthRequest, res: Response) => {
  try {
    const result = validatePromoBannerInput(req.body ?? {});
    if ('error' in result) return res.status(400).json(errorResponse(400, result.error));

    const last = await prisma.promoBanner.findFirst({ orderBy: { sortOrder: 'desc' }, select: { sortOrder: true } });
    const banner = await prisma.promoBanner.create({
      data: {
        ...result.data,
        // Both are guaranteed by the full (non-partial) validation above.
        title: result.data.title!,
        imageUrl: result.data.imageUrl!,
        sortOrder: (last?.sortOrder ?? -1) + 1,
      },
    });

    await writeAuditLog({
      ...actor(req),
      action: 'PROMO_BANNER_CREATED',
      category: 'ADMIN_ACTION',
      message: `Promo banner created: ${banner.title}`,
      metadata: { bannerId: banner.id },
    });
    return res.status(201).json({ success: true, data: banner });
  } catch (error) {
    console.error('Create promo banner error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

/** PUT /api/admin/promo-banners/:id — partial update. */
export const updatePromoBanner = async (req: AuthRequest, res: Response) => {
  try {
    const existing = await prisma.promoBanner.findUnique({ where: { id: req.params.id as string } });
    if (!existing) return res.status(404).json(errorResponse(404, 'Banner not found'));

    const result = validatePromoBannerInput(req.body ?? {}, { partial: true });
    if ('error' in result) return res.status(400).json(errorResponse(400, result.error));

    // Check the date order against the stored value when only one side changes.
    const startsAt = result.data.startsAt !== undefined ? result.data.startsAt : existing.startsAt;
    const endsAt = result.data.endsAt !== undefined ? result.data.endsAt : existing.endsAt;
    if (startsAt && endsAt && endsAt <= startsAt) {
      return res.status(400).json(errorResponse(400, 'The end date must be after the start date.'));
    }

    const banner = await prisma.promoBanner.update({ where: { id: existing.id }, data: result.data });
    await writeAuditLog({
      ...actor(req),
      action: 'PROMO_BANNER_UPDATED',
      category: 'ADMIN_ACTION',
      message: `Promo banner updated: ${banner.title}`,
      metadata: { bannerId: banner.id, fields: Object.keys(result.data) },
    });
    return res.json({ success: true, data: banner });
  } catch (error) {
    console.error('Update promo banner error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

/** PUT /api/admin/promo-banners/order — body { ids: [...] } in display order. */
export const reorderPromoBanners = async (req: AuthRequest, res: Response) => {
  try {
    const ids = (req.body ?? {}).ids;
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string') || new Set(ids).size !== ids.length) {
      return res.status(400).json(errorResponse(400, 'ids must be a list of unique banner ids.'));
    }
    const count = await prisma.promoBanner.count({ where: { id: { in: ids } } });
    if (count !== ids.length) return res.status(400).json(errorResponse(400, 'Unknown banner id in the list.'));

    await prisma.$transaction(
      ids.map((id: string, index: number) => prisma.promoBanner.update({ where: { id }, data: { sortOrder: index } })),
    );
    await writeAuditLog({
      ...actor(req),
      action: 'PROMO_BANNERS_REORDERED',
      category: 'ADMIN_ACTION',
      message: 'Promo banners reordered',
      metadata: { ids },
    });
    return res.json({ success: true });
  } catch (error) {
    console.error('Reorder promo banners error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

/** DELETE /api/admin/promo-banners/:id — also removes its image from storage (best effort). */
export const deletePromoBanner = async (req: AuthRequest, res: Response) => {
  try {
    const existing = await prisma.promoBanner.findUnique({ where: { id: req.params.id as string } });
    if (!existing) return res.status(404).json(errorResponse(404, 'Banner not found'));

    await prisma.promoBanner.delete({ where: { id: existing.id } });

    const marker = `/${PROMO_BANNER_BUCKET}/`;
    const at = existing.imageUrl.indexOf(marker);
    if (at >= 0) {
      const path = decodeURIComponent(existing.imageUrl.slice(at + marker.length));
      const { error } = await supabase.storage.from(PROMO_BANNER_BUCKET).remove([path]);
      if (error) console.warn('Promo banner image cleanup failed:', error.message);
    }

    await writeAuditLog({
      ...actor(req),
      action: 'PROMO_BANNER_DELETED',
      category: 'ADMIN_ACTION',
      message: `Promo banner deleted: ${existing.title}`,
      metadata: { bannerId: existing.id },
    });
    return res.json({ success: true });
  } catch (error) {
    console.error('Delete promo banner error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

export const promoBannerImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
      cb(new Error('Only JPEG, PNG or WebP images are allowed'));
      return;
    }
    cb(null, true);
  },
}).single('image');

/** POST /api/admin/promo-banners/upload-image — returns the public URL to save on a banner. */
export const uploadPromoBannerImage = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) return res.status(400).json(errorResponse(400, 'No image file provided'));
    const extension = req.file.mimetype.split('/')[1] || 'jpg';
    const fileName = `${randomUUID()}.${extension}`;

    const { error } = await supabase.storage
      .from(PROMO_BANNER_BUCKET)
      .upload(fileName, req.file.buffer, { contentType: req.file.mimetype });
    if (error) {
      console.error('Promo banner image upload failed:', error);
      return res.status(500).json(errorResponse(500, 'Failed to upload image'));
    }
    const { data } = supabase.storage.from(PROMO_BANNER_BUCKET).getPublicUrl(fileName);
    return res.status(201).json({ success: true, data: { url: data.publicUrl } });
  } catch (error) {
    console.error('Upload promo banner image error:', error);
    return res.status(500).json(errorResponse(500, 'Failed to upload image'));
  }
};
