import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import multer from 'multer';
import { KycDocumentType } from '@prisma/client';
import prisma from '@config/database';
import { errorResponse } from '@utils/errorResponse';
import { formatVerification } from '@utils/formatters';
import { supabase, KYC_DOCUMENT_BUCKET } from '@config/supabase';
import { verificationQueue, VERIFICATION_JOB_OPTIONS } from '@queues/verificationQueue';
import type { JwtPayload } from '@/types/index';

interface AuthRequest extends Request {
  user?: JwtPayload;
}

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
const MAX_FILE_SIZE = Number(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024;
const MAX_FILES = 5;

export const verificationUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: MAX_FILES },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(new Error('Only JPG, PNG, WEBP, and PDF files are allowed'));
      return;
    }
    cb(null, true);
  },
});

export const uploadVerificationDocuments = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Unauthorized'));
    }

    const { documentType } = req.body as { documentType?: string };
    const files = req.files as Express.Multer.File[] | undefined;

    if (!documentType || !(documentType in KycDocumentType)) {
      return res.status(400).json(errorResponse(400, 'A valid documentType is required'));
    }

    if (!files?.length) {
      return res.status(400).json(errorResponse(400, 'At least one document file is required'));
    }

    const user = await prisma.user.findUnique({ where: { id: req.user.userId } });

    if (!user) {
      return res.status(404).json(errorResponse(404, 'User not found'));
    }

    if (user.role !== 'CLIENT' && user.role !== 'WORKER') {
      return res.status(403).json(errorResponse(403, 'Only clients and workers can submit verification'));
    }

    const uploadedDocs = await Promise.all(
      files.map(async (file) => {
        const extension = file.originalname.split('.').pop() || 'bin';
        const storagePath = `${user.id}/${randomUUID()}.${extension}`;

        const { error: uploadError } = await supabase.storage
          .from(KYC_DOCUMENT_BUCKET)
          .upload(storagePath, file.buffer, { contentType: file.mimetype });

        if (uploadError) {
          throw new Error(`Failed to upload ${file.originalname}: ${uploadError.message}`);
        }

        const { data } = supabase.storage.from(KYC_DOCUMENT_BUCKET).getPublicUrl(storagePath);

        return {
          documentType: documentType as KycDocumentType,
          fileName: storagePath,
          originalName: file.originalname,
          fileUrl: data.publicUrl,
          fileSize: file.size,
          mimeType: file.mimetype,
        };
      })
    );

    const requestType = user.role === 'WORKER' ? 'WORKER_ONBOARDING' : 'CLIENT_VERIFICATION';

    // Reuse an existing open request for this user instead of always
    // creating a new one — a single call can only tag its files with one
    // documentType, so a full submission (ID front, ID back, selfie, ...)
    // takes several calls; without this they'd fragment into a separate
    // admin-reviewable card per call instead of one per applicant. Mirrors
    // userController.submitKYCDocument's behavior on the worker-onboarding
    // upload path.
    const openRequest = await prisma.verificationRequest.findFirst({
      where: { userId: user.id, type: requestType, status: { in: ['PENDING', 'SUBMITTED'] } },
      orderBy: { submittedAt: 'desc' },
    });

    const verification = openRequest
      ? await prisma.$transaction(async (tx) => {
          await tx.kycDocument.createMany({
            data: uploadedDocs.map((doc) => ({ ...doc, verificationRequestId: openRequest.id })),
          });
          // New evidence just arrived — re-flag for AI review rather than
          // leaving a stale result from an earlier, incomplete submission.
          return tx.verificationRequest.update({
            where: { id: openRequest.id },
            data: { aiStatus: 'PENDING' },
            include: { user: true, documents: true },
          });
        })
      : await prisma.verificationRequest.create({
          data: {
            userId: user.id,
            type: requestType,
            status: 'PENDING',
            aiStatus: 'PENDING',
            documents: { create: uploadedDocs },
          },
          include: { user: true, documents: true },
        });

    // Best-effort — the VerificationRequest row and its documents (plus the
    // actual Supabase file uploads above) already exist at this point, so a
    // Redis hiccup here must not report this submission as failed: the user
    // would otherwise likely resubmit, creating a duplicate request and
    // re-uploading the same files. Worst case if this silently fails: the
    // request sits at aiStatus PENDING until an admin notices and reruns it
    // (see adminVerificationController.rerunVerification, which queues the
    // exact same job).
    //
    // Reviews the FULL current document set on the request (not just this
    // call's files) so a review triggered by, say, the third upload call
    // still sees the first two documents too.
    await verificationQueue
      .add(
        'analyze-verification',
        {
          verificationId: verification.id,
          requestType,
          documents: verification.documents.map((doc) => ({
            documentType: doc.documentType,
            fileUrl: doc.fileUrl,
            mimeType: doc.mimeType,
            originalName: doc.originalName,
          })),
        },
        VERIFICATION_JOB_OPTIONS
      )
      .catch((error) => {
        console.error(`Failed to queue AI review for verification ${verification.id}:`, error);
      });

    if (user.role === 'WORKER') {
      await prisma.workerProfile.updateMany({
        where: { userId: user.id },
        data: { kycStatus: 'SUBMITTED' },
      });
    }

    return res.status(201).json({
      success: true,
      message: 'Verification documents uploaded successfully',
      data: formatVerification(verification),
    });
  } catch (error) {
    console.error('Upload verification error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

export const getMyVerifications = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Unauthorized'));
    }

    const records = await prisma.verificationRequest.findMany({
      where: { userId: req.user.userId },
      include: { user: true, documents: true },
      orderBy: { submittedAt: 'desc' },
    });

    return res.json({
      success: true,
      data: records.map(formatVerification),
    });
  } catch (error) {
    console.error('Get my verifications error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};
