import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import multer from 'multer';
import { errorResponse } from '@utils/errorResponse';
import { KYC_DOCUMENT_TYPES } from '@utils/kycDocumentTypes';
import { supabase, CHAT_IMAGE_BUCKET, AVATAR_BUCKET, KYC_DOCUMENT_BUCKET, RESUME_BUCKET } from '@config/supabase';
import type { JwtPayload } from '@/types/index';

interface AuthRequest extends Request {
  user?: JwtPayload;
  file?: Express.Multer.File;
}

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const ALLOWED_KYC_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_FILE_SIZE = Number(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024;

export const chatImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(new Error('Only image uploads are allowed'));
      return;
    }
    cb(null, true);
  },
}).single('image');

/**
 * POST /api/messages/upload-image
 * Uploads a chat image to Supabase Storage and returns its public URL
 */
export const uploadChatImage = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    if (!req.file) {
      return res.status(400).json(errorResponse(400, 'No image file provided'));
    }

    const extension = req.file.mimetype.split('/')[1] || 'jpg';
    const fileName = `${req.user.userId}/${randomUUID()}.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from(CHAT_IMAGE_BUCKET)
      .upload(fileName, req.file.buffer, {
        contentType: req.file.mimetype,
      });

    if (uploadError) {
      console.error('Error uploading chat image to Supabase:', uploadError);
      return res.status(500).json(errorResponse(500, 'Failed to upload image'));
    }

    const { data } = supabase.storage.from(CHAT_IMAGE_BUCKET).getPublicUrl(fileName);

    return res.status(201).json({
      success: true,
      message: 'Image uploaded successfully',
      data: { url: data.publicUrl },
    });
  } catch (error) {
    console.error('Error uploading chat image:', error);
    return res.status(500).json(errorResponse(500, 'Failed to upload image'));
  }
};

export const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(new Error('Only image uploads are allowed'));
      return;
    }
    cb(null, true);
  },
}).single('avatar');

/**
 * POST /api/users/me/avatar
 * Uploads a profile picture to Supabase Storage and returns its public URL.
 * Does not persist the URL — call PATCH /api/users/me with { avatar } after.
 */
export const uploadAvatar = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    if (!req.file) {
      return res.status(400).json(errorResponse(400, 'No image file provided'));
    }

    const extension = req.file.mimetype.split('/')[1] || 'jpg';
    const fileName = `${req.user.userId}/${randomUUID()}.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from(AVATAR_BUCKET)
      .upload(fileName, req.file.buffer, {
        contentType: req.file.mimetype,
      });

    if (uploadError) {
      console.error('Error uploading avatar to Supabase:', uploadError);
      return res.status(500).json(errorResponse(500, 'Failed to upload avatar'));
    }

    const { data } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(fileName);

    return res.status(201).json({
      success: true,
      message: 'Avatar uploaded successfully',
      data: { url: data.publicUrl },
    });
  } catch (error) {
    console.error('Error uploading avatar:', error);
    return res.status(500).json(errorResponse(500, 'Failed to upload avatar'));
  }
};

export const kycFileUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_KYC_MIME_TYPES.includes(file.mimetype)) {
      cb(new Error('Only JPG, PNG, WEBP, and PDF files are allowed'));
      return;
    }
    cb(null, true);
  },
}).single('file');

/**
 * POST /api/users/me/kyc-documents/upload
 * Uploads a KYC/resume document to Supabase Storage and returns its public URL.
 * Does not persist any DB row — call POST /api/users/me/kyc-documents with the
 * returned URL to attach it to the user's verification request.
 */
export const uploadKycFile = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    if (!req.file) {
      return res.status(400).json(errorResponse(400, 'No file provided'));
    }

    const { documentType } = req.body as { documentType?: string };
    if (!documentType || !(KYC_DOCUMENT_TYPES as readonly string[]).includes(documentType)) {
      return res.status(400).json(errorResponse(400, 'A valid documentType is required'));
    }

    const bucket = documentType === 'RESUME' ? RESUME_BUCKET : KYC_DOCUMENT_BUCKET;
    const extension = req.file.mimetype.split('/')[1] || 'bin';
    const fileName = `${req.user.userId}/${randomUUID()}.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(fileName, req.file.buffer, {
        contentType: req.file.mimetype,
      });

    if (uploadError) {
      console.error('Error uploading KYC document to Supabase:', uploadError);
      return res.status(500).json(errorResponse(500, 'Failed to upload file'));
    }

    const { data } = supabase.storage.from(bucket).getPublicUrl(fileName);

    return res.status(201).json({
      success: true,
      message: 'File uploaded successfully',
      data: { url: data.publicUrl },
    });
  } catch (error) {
    console.error('Error uploading KYC document:', error);
    return res.status(500).json(errorResponse(500, 'Failed to upload file'));
  }
};
