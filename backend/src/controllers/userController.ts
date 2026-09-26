import { Request, Response } from 'express';
import { ContractType, KycDocumentType } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import prisma from '@config/database';
import { errorResponse } from '@utils/errorResponse';
import { toOwnedStoredUrl } from '@utils/storageUrls';
import { ageInYears, MIN_WORKER_AGE } from '@utils/age';
import { eraseAccount, findDeletionBlockers } from '@services/accountDeletionService';
import { JWT_EXPIRY } from '@utils/jwt';
import { mimeTypeFromUrl, storagePathFromUrl } from '@utils/kycFileMeta';
import { verificationQueue, VERIFICATION_JOB_OPTIONS } from '@queues/verificationQueue';
import { checkResubmissionCooldown } from '@utils/kycResubmissionCooldown';
import { TIER_1_REQUIRED_DOCUMENT_TYPES } from '@/constants/kycRequirements';
import { revokeAllRefreshTokens } from '@utils/otpService';
import type { JwtPayload } from '@/types/index';

interface AuthRequest extends Request {
  user?: JwtPayload;
}

/**
 * GET /api/users/me
 * Get current user profile
 */
export const getUserProfile = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }
    
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        role: true,
        avatar: true,
        isVerified: true,
        createdAt: true,
        updatedAt: true,
        workerProfile: {
          select: { kycStatus: true, declineCooldownUntil: true, commissionOwed: true, debtHoldAt: true },
        },
        verificationRequests: {
          orderBy: { submittedAt: 'desc' },
          take: 1,
          select: { rejectionReason: true },
        },
        contractAcceptances: {
          where: { contractType: 'CLIENT_USER_AGREEMENT' },
          select: { id: true },
          take: 1,
        },
      },
    });

    if (!user) {
      return res.status(404).json(errorResponse(404, 'User not found'));
    }

    const { workerProfile, verificationRequests, contractAcceptances, ...userFields } = user;
    const kycStatus = user.role === 'WORKER' ? (workerProfile?.kycStatus ?? 'PENDING') : undefined;

    return res.status(200).json({
      success: true,
      message: 'Profile retrieved successfully',
      data: {
        ...userFields,
        // Used by the mobile app to gate worker access behind admin approval.
        kycStatus,
        // The admin's actual reason, so a rejected worker isn't shown a
        // generic canned message regardless of why they were rejected.
        kycRejectionReason: kycStatus === 'REJECTED' ? (verificationRequests[0]?.rejectionReason ?? null) : undefined,
        // Gates the client-agreement screen — undefined for workers, who
        // have their own contract flow tied to KYC instead.
        hasAcceptedTerms: user.role === 'CLIENT' ? contractAcceptances.length > 0 : undefined,
        // Worker decline-limit cooldown — undefined/null unless currently
        // excluded from auto-match (see matchingService.findAutoMatchWorker).
        declineCooldownUntil:
          user.role === 'WORKER' ? (workerProfile?.declineCooldownUntil ?? null) : undefined,
        // Drives the mobile app's account-hold banner — undefined for
        // clients, null for a worker in good standing (see
        // debtLedgerService.ts for how/why this gets set).
        accountHold:
          user.role === 'WORKER' && workerProfile?.debtHoldAt
            ? { since: workerProfile.debtHoldAt, amountOwed: workerProfile.commissionOwed }
            : user.role === 'WORKER'
              ? null
              : undefined,
      },
    });
  } catch (error) {
    console.error('Error fetching user profile:', error);
    return res.status(500).json(errorResponse(500, 'Failed to fetch profile'));
  }
};

/**
 * PATCH /api/users/me
 * Update user profile
 */
export const updateUserProfile = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }
    
    const { fullName, phone, avatar } = req.body;

    const updateData: any = {};
    if (fullName !== undefined) updateData.fullName = fullName;
    if (phone !== undefined) updateData.phone = phone;
    if (avatar !== undefined) updateData.avatar = avatar;

    const updated = await prisma.user.update({
      where: { id: req.user.userId },
      data: updateData,
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        avatar: true,
      },
    });
    
    return res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: updated,
    });
  } catch (error) {
    console.error('Error updating user profile:', error);
    return res.status(500).json(errorResponse(500, 'Failed to update profile'));
  }
};

/**
 * POST /api/users/me/change-password
 * Change password
 */
export const changePassword = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }
    
    const { currentPassword, newPassword } = req.body;
    
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { password: true },
    });
    
    if (!user) {
      return res.status(404).json(errorResponse(404, 'User not found'));
    }
    
    const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isPasswordValid) {
      return res.status(401).json(errorResponse(401, 'Current password is incorrect'));
    }
    
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    
    await prisma.user.update({
      where: { id: req.user.userId },
      data: { password: hashedPassword },
    });

    // Revoke all other sessions on self-service password change, same as
    // the OTP-based resetPassword flow (authController.ts) already does —
    // a password change should invalidate any refresh tokens issued before
    // it, in case the change was prompted by a compromised session.
    await revokeAllRefreshTokens(req.user.userId);

    return res.status(200).json({
      success: true,
      message: 'Password changed successfully',
    });
  } catch (error) {
    console.error('Error changing password:', error);
    return res.status(500).json(errorResponse(500, 'Failed to change password'));
  }
};

/**
 * POST /api/users/me/logout-all
 * Revoke all of the current user's refresh tokens (log out every other
 * device/session). The caller's own current access token keeps working
 * until it naturally expires (access tokens aren't tracked server-side),
 * but no refresh token issued before this call can mint a new one — so a
 * client that also calls the normal logout/redirect flow after this
 * effectively signs the user out everywhere.
 */
export const logoutAllSessions = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    await revokeAllRefreshTokens(req.user.userId);

    return res.status(200).json({
      success: true,
      message: 'Logged out of all devices',
    });
  } catch (error) {
    console.error('Error logging out all sessions:', error);
    return res.status(500).json(errorResponse(500, 'Failed to log out all sessions'));
  }
};

/**
 * GET /api/users/me/addresses
 */
export const getAddresses = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }
    
    const addresses = await prisma.userAddress.findMany({
      where: { userId: req.user.userId, isDeleted: false },
      orderBy: { isDefault: 'desc' },
    });
    
    return res.status(200).json({
      success: true,
      message: 'Addresses retrieved successfully',
      data: addresses,
    });
  } catch (error) {
    console.error('Error fetching addresses:', error);
    return res.status(500).json(errorResponse(500, 'Failed to fetch addresses'));
  }
};

/**
 * POST /api/users/me/addresses
 */
export const createAddress = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }
    
    const { label, street, city, state, zipCode, houseNumber, barangay, landmark, lat, lng, geocodeAccuracy } = req.body;

    const address = await prisma.userAddress.create({
      data: {
        userId: req.user.userId,
        label,
        street,
        city,
        state,
        zipCode,
        houseNumber,
        barangay,
        landmark,
        lat,
        lng,
        geocodeAccuracy,
        geocodedAt: lat != null && lng != null ? new Date() : null,
      },
    });
    
    return res.status(201).json({
      success: true,
      message: 'Address created successfully',
      data: address,
    });
  } catch (error) {
    console.error('Error creating address:', error);
    return res.status(500).json(errorResponse(500, 'Failed to create address'));
  }
};

/**
 * PATCH /api/users/me/addresses/:addressId
 */
export const updateAddress = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }
    
    const addressId = req.params.addressId as string;
    const { label, street, city, state, zipCode, houseNumber, barangay, landmark, lat, lng, geocodeAccuracy } = req.body;

    const address = await prisma.userAddress.findFirst({
      where: { id: addressId, isDeleted: false },
    });

    if (!address || address.userId !== req.user.userId) {
      return res.status(403).json(errorResponse(403, 'Cannot update this address'));
    }

    const updateData: any = {};
    if (label !== undefined) updateData.label = label;
    if (street !== undefined) updateData.street = street;
    if (city !== undefined) updateData.city = city;
    if (state !== undefined) updateData.state = state;
    if (zipCode !== undefined) updateData.zipCode = zipCode;
    if (houseNumber !== undefined) updateData.houseNumber = houseNumber;
    if (barangay !== undefined) updateData.barangay = barangay;
    if (landmark !== undefined) updateData.landmark = landmark;
    if (lat !== undefined) {
      updateData.lat = lat;
      updateData.geocodedAt = lat != null ? new Date() : null;
    }
    if (lng !== undefined) updateData.lng = lng;
    if (geocodeAccuracy !== undefined) updateData.geocodeAccuracy = geocodeAccuracy;

    const updated = await prisma.userAddress.update({
      where: { id: addressId },
      data: updateData,
    });
    
    return res.status(200).json({
      success: true,
      message: 'Address updated successfully',
      data: updated,
    });
  } catch (error) {
    console.error('Error updating address:', error);
    return res.status(500).json(errorResponse(500, 'Failed to update address'));
  }
};

/**
 * DELETE /api/users/me/addresses/:addressId
 */
export const deleteAddress = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }
    
    const addressId = req.params.addressId as string;
    const address = await prisma.userAddress.findFirst({
      where: { id: addressId, isDeleted: false },
    });
    
    if (!address || address.userId !== req.user.userId) {
      return res.status(403).json(errorResponse(403, 'Cannot delete this address'));
    }
    
    await prisma.userAddress.update({
      where: { id: addressId },
      data: { isDeleted: true, deletedAt: new Date() },
    });
    
    return res.status(200).json({
      success: true,
      message: 'Address deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting address:', error);
    return res.status(500).json(errorResponse(500, 'Failed to delete address'));
  }
};

/**
 * PATCH /api/users/me/addresses/:addressId/set-default
 */
export const setDefaultAddress = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }
    
    const addressId = req.params.addressId as string;
    const address = await prisma.userAddress.findFirst({
      where: { id: addressId, isDeleted: false },
    });
    
    if (!address || address.userId !== req.user.userId) {
      return res.status(403).json(errorResponse(403, 'Cannot modify this address'));
    }
    
    await prisma.userAddress.updateMany({
      where: { userId: req.user.userId, isDeleted: false, NOT: { id: addressId } },
      data: { isDefault: false },
    });
    
    const updated = await prisma.userAddress.update({
      where: { id: addressId },
      data: { isDefault: true },
    });
    
    return res.status(200).json({
      success: true,
      message: 'Default address set successfully',
      data: updated,
    });
  } catch (error) {
    console.error('Error setting default address:', error);
    return res.status(500).json(errorResponse(500, 'Failed to set default address'));
  }
};

/**
 * GET /api/users/me/payment-methods
 */
export const getPaymentMethods = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }
    
    const methods = await prisma.savedPaymentMethod.findMany({
      where: { clientProfile: { userId: req.user.userId } },
      select: {
        id: true,
        type: true,
        accountIdentifier: true,
        label: true,
        isDefault: true,
        createdAt: true,
      },
    });
    
    return res.status(200).json({
      success: true,
      message: 'Payment methods retrieved successfully',
      data: methods,
    });
  } catch (error) {
    console.error('Error fetching payment methods:', error);
    return res.status(500).json(errorResponse(500, 'Failed to fetch payment methods'));
  }
};

/**
 * POST /api/users/me/payment-methods
 */
export const addPaymentMethod = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    if (req.user.role !== 'CLIENT') {
      return res.status(403).json(errorResponse(403, 'Only clients can add payment methods'));
    }

    const { type, accountIdentifier, label } = req.body;

    const clientProfile = await prisma.clientProfile.findUnique({
      where: { userId: req.user.userId },
    });

    if (!clientProfile) {
      return res.status(404).json(errorResponse(404, 'Client profile not found'));
    }

    const method = await prisma.savedPaymentMethod.create({
      data: {
        clientProfileId: clientProfile.id,
        type,
        accountIdentifier,
        label: label || `${type} ending in ...${accountIdentifier?.slice(-4) || 'XXXX'}`,
      },
    });

    return res.status(201).json({
      success: true,
      message: 'Payment method added successfully',
      data: method,
    });
  } catch (error) {
    console.error('Error adding payment method:', error);
    return res.status(500).json(errorResponse(500, 'Failed to add payment method'));
  }
};

/**
 * PATCH /api/users/me/payment-methods/:methodId
 */
export const updatePaymentMethod = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const methodId = req.params.methodId as string;
    const { label } = req.body;

    const method = await prisma.savedPaymentMethod.findUnique({
      where: { id: methodId },
      include: { clientProfile: { select: { userId: true } } },
    });

    if (!method || method.clientProfile.userId !== req.user.userId) {
      return res.status(403).json(errorResponse(403, 'Cannot update this payment method'));
    }

    const updated = await prisma.savedPaymentMethod.update({
      where: { id: methodId },
      data: { label },
    });

    return res.status(200).json({
      success: true,
      message: 'Payment method updated successfully',
      data: updated,
    });
  } catch (error) {
    console.error('Error updating payment method:', error);
    return res.status(500).json(errorResponse(500, 'Failed to update payment method'));
  }
};

/**
 * PATCH /api/users/me/payment-methods/:methodId/set-default
 */
export const setDefaultPaymentMethod = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const methodId = req.params.methodId as string;

    const method = await prisma.savedPaymentMethod.findUnique({
      where: { id: methodId },
      include: { clientProfile: { select: { id: true, userId: true } } },
    });

    if (!method || method.clientProfile.userId !== req.user.userId) {
      return res.status(403).json(errorResponse(403, 'Cannot update this payment method'));
    }

    await prisma.$transaction([
      prisma.savedPaymentMethod.updateMany({
        where: { clientProfileId: method.clientProfile.id },
        data: { isDefault: false },
      }),
      prisma.savedPaymentMethod.update({
        where: { id: methodId },
        data: { isDefault: true },
      }),
    ]);

    return res.status(200).json({
      success: true,
      message: 'Default payment method updated',
    });
  } catch (error) {
    console.error('Error setting default payment method:', error);
    return res.status(500).json(errorResponse(500, 'Failed to set default payment method'));
  }
};

/**
 * DELETE /api/users/me/payment-methods/:methodId
 */
export const deletePaymentMethod = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }
    
    const methodId = req.params.methodId as string;
    const method = await prisma.savedPaymentMethod.findUnique({
      where: { id: methodId },
      include: { clientProfile: { select: { userId: true } } },
    });
    
    if (!method || method.clientProfile.userId !== req.user.userId) {
      return res.status(403).json(errorResponse(403, 'Cannot delete this payment method'));
    }
    
    await prisma.savedPaymentMethod.delete({
      where: { id: methodId },
    });
    
    return res.status(200).json({
      success: true,
      message: 'Payment method deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting payment method:', error);
    return res.status(500).json(errorResponse(500, 'Failed to delete payment method'));
  }
};

/**
 * PATCH /api/users/me/notification-preferences
 */
export const updateNotificationPreferences = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const { bookingUpdates, messages, promotions, systemNotifications } = req.body;

    const current = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { notificationPreferences: true },
    });

    if (!current) {
      return res.status(404).json(errorResponse(404, 'User not found'));
    }

    const existing = (current.notificationPreferences as Record<string, boolean>) ?? {};

    const updated = await prisma.user.update({
      where: { id: req.user.userId },
      data: {
        notificationPreferences: {
          bookingUpdates: bookingUpdates ?? existing.bookingUpdates ?? true,
          messages: messages ?? existing.messages ?? true,
          promotions: promotions ?? existing.promotions ?? false,
          systemNotifications: systemNotifications ?? existing.systemNotifications ?? true,
        },
      },
      select: { notificationPreferences: true },
    });

    return res.status(200).json({
      success: true,
      message: 'Notification preferences updated successfully',
      data: updated.notificationPreferences,
    });
  } catch (error) {
    console.error('Error updating notification preferences:', error);
    return res.status(500).json(errorResponse(500, 'Failed to update notification preferences'));
  }
};


/**
 * GET /api/users/me/kyc-documents
 */
export const getKYCDocuments = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }
    
    // KycDocument has no userId field — it hangs off VerificationRequest
    const documents = await prisma.kycDocument.findMany({
      where: { verificationRequest: { userId: req.user.userId } },
      orderBy: { createdAt: 'desc' },
    });
    
    return res.status(200).json({
      success: true,
      message: 'KYC documents retrieved successfully',
      data: documents,
    });
  } catch (error) {
    console.error('Error fetching KYC documents:', error);
    return res.status(500).json(errorResponse(500, 'Failed to fetch KYC documents'));
  }
};

/**
 * POST /api/users/me/kyc-documents
 */
export const submitKYCDocument = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }
    
    // validateSubmitKYCDocument has already checked documentType is one of
    // KYC_DOCUMENT_TYPES and documentUrl is a non-empty string.
    const { documentType, originalName, fileSize } = req.body as {
      documentType: KycDocumentType;
      documentUrl: string;
      originalName?: string;
      fileSize?: number;
    };
    const documentUrl = toOwnedStoredUrl(req.body.documentUrl as string, req.user.userId);
    if (!documentUrl) {
      return res.status(400).json(errorResponse(400, 'That file does not belong to your account. Please upload it again.'));
    }

    // KycDocument has no userId field — it must belong to a VerificationRequest.
    // Reuse the user's open request if one exists, otherwise start a new one.
    let verificationRequest = await prisma.verificationRequest.findFirst({
      where: {
        userId: req.user.userId,
        status: { in: ['PENDING', 'SUBMITTED'] },
      },
      orderBy: { submittedAt: 'desc' },
    });

    if (!verificationRequest) {
      const cooldown = await checkResubmissionCooldown(req.user.userId, 'WORKER_ONBOARDING');
      if (!cooldown.allowed) {
        return res.status(429).json(
          errorResponse(
            429,
            `Your last submission was rejected — you can resubmit after ${cooldown.retryAfter.toISOString()}. Use the time to address the rejection reason.`
          )
        );
      }

      verificationRequest = await prisma.verificationRequest.create({
        data: {
          userId: req.user.userId,
          type: 'WORKER_ONBOARDING',
          status: 'PENDING',
        },
      });
    }

    // The upload step (POST .../kyc-documents/upload) discards the mime type;
    // re-derive it from the Supabase URL's extension so the AI review
    // (verificationAiService) can actually see this document and the admin UI
    // can render a preview. Client-supplied values are not trusted here.
    const document = await prisma.kycDocument.create({
      data: {
        verificationRequestId: verificationRequest.id,
        documentType,
        fileUrl: documentUrl,
        fileName: storagePathFromUrl(documentUrl),
        mimeType: mimeTypeFromUrl(documentUrl),
        originalName: typeof originalName === 'string' ? originalName : null,
        fileSize: Number.isFinite(fileSize) ? Number(fileSize) : null,
        status: 'PENDING',
      },
    });

    // Kick off (or re-run) the automated review over the request's FULL current
    // document set — mirrors verificationController.uploadVerificationDocuments.
    // Best-effort: the row already exists, so a Redis hiccup must not fail the
    // submission; an admin can re-run from adminVerificationController.
    const withDocuments = await prisma.verificationRequest.update({
      where: { id: verificationRequest.id },
      data: { aiStatus: 'PENDING' },
      include: { documents: true },
    });

    await verificationQueue
      .add(
        'analyze-verification',
        {
          verificationId: withDocuments.id,
          requestType: withDocuments.type,
          documents: withDocuments.documents.map((doc) => ({
            documentType: doc.documentType,
            fileUrl: doc.fileUrl,
            mimeType: doc.mimeType,
            originalName: doc.originalName,
          })),
        },
        VERIFICATION_JOB_OPTIONS
      )
      .catch((error) => {
        console.error(`Failed to queue AI review for verification ${withDocuments.id}:`, error);
      });

    return res.status(201).json({
      success: true,
      message: 'KYC document submitted successfully',
      data: document,
    });
  } catch (error) {
    console.error('Error submitting KYC document:', error);
    return res.status(500).json(errorResponse(500, 'Failed to submit KYC document'));
  }
};

/**
 * POST /api/users/me/contract-acceptance
 */
export const acceptContract = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }
    
    const { contractType, contractVersion } = req.body as { contractType: ContractType; contractVersion?: string };

    // Workers accept the Service Agreement and the KYC consent; clients the
    // User Agreement. Either may acknowledge the Privacy Notice.
    const allowedForRole: Record<string, ContractType[]> = {
      CLIENT: ['CLIENT_USER_AGREEMENT', 'PRIVACY_NOTICE'],
      WORKER: ['WORKER_SERVICE_AGREEMENT', 'KYC_CONSENT', 'PRIVACY_NOTICE'],
    };
    if (!allowedForRole[req.user.role]?.includes(contractType)) {
      return res.status(400).json(errorResponse(400, `${contractType} does not apply to this account`));
    }

    // Evidence of acceptance (E-Commerce Act, RA 8792): the server's own
    // timestamp, the exact document version shown, and where it came from.
    // Requires TRUST_PROXY behind Render so req.ip is the client, not the proxy.
    const acceptance = await prisma.contractAcceptance.create({
      data: {
        userId: req.user.userId,
        contractType,
        contractVersion: contractVersion ?? '1.0',
        acceptedAt: new Date(),
        ipAddress: req.ip ?? null,
        userAgent: req.get('user-agent')?.slice(0, 512) ?? null,
      },
    });

    // Contract acceptance is the last step of worker onboarding — flip the
    // open verification request (and the denormalized WorkerProfile status)
    // to SUBMITTED so it surfaces for admin review and the app can gate the
    // worker into the waiting screen instead of the tabs.
    if (req.user.role === 'WORKER' && contractType === 'WORKER_SERVICE_AGREEMENT') {
      const verificationRequest = await prisma.verificationRequest.findFirst({
        where: { userId: req.user.userId, status: 'PENDING' },
        orderBy: { submittedAt: 'desc' },
        include: { documents: { select: { documentType: true } } },
      });

      if (verificationRequest) {
        // Previously ANY document set — even zero documents — could reach
        // the admin review queue as long as the worker got through the
        // contract-acceptance step, since approveVerification's document
        // check only ever gated APPROVAL, not entry into the queue itself.
        // That left every incomplete application sitting in front of an
        // admin who'd just reject it, instead of telling the worker what's
        // actually missing right when they could still fix it.
        const submittedTypes = new Set(verificationRequest.documents.map((d) => d.documentType));
        const missingTypes = TIER_1_REQUIRED_DOCUMENT_TYPES.filter((t) => !submittedTypes.has(t));

        if (missingTypes.length > 0) {
          return res.status(400).json(
            errorResponse(
              400,
              `Please upload the following before submitting for review: ${missingTypes.join(', ')}.`
            )
          );
        }

        const profile = await prisma.workerProfile.findUnique({
          where: { userId: req.user.userId },
          select: { birthDate: true },
        });
        if (!profile?.birthDate) {
          return res.status(400).json(errorResponse(400, 'Please enter your date of birth on the ID step before submitting.'));
        }
        if (ageInYears(profile.birthDate) < MIN_WORKER_AGE) {
          return res.status(400).json(errorResponse(400, `You must be at least ${MIN_WORKER_AGE} years old to work on HomeEase.`));
        }

        await prisma.$transaction([
          prisma.verificationRequest.update({
            where: { id: verificationRequest.id },
            data: { status: 'SUBMITTED' },
          }),
          prisma.workerProfile.updateMany({
            where: { userId: req.user.userId },
            data: { kycStatus: 'SUBMITTED', kycSubmittedAt: new Date() },
          }),
        ]);
      }
    }

    return res.status(201).json({
      success: true,
      message: 'Contract acceptance recorded successfully',
      data: acceptance,
    });
  } catch (error) {
    console.error('Error recording contract acceptance:', error);
    return res.status(500).json(errorResponse(500, 'Failed to record contract acceptance'));
  }
};

/**
 * DELETE /api/users/me
 */
export const deleteAccount = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }
    
    const { password } = req.body;
    
    if (!password) {
      return res.status(400).json(errorResponse(400, 'Password required to delete account'));
    }
    
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { password: true },
    });
    
    if (!user) {
      return res.status(404).json(errorResponse(404, 'User not found'));
    }
    
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json(errorResponse(401, 'Password is incorrect'));
    }
    
    const blockers = await findDeletionBlockers(req.user.userId);
    if (blockers.length > 0) {
      return res.status(409).json({ ...errorResponse(409, blockers.join(' ')), blockers });
    }

    // Anonymizes the account and removes personal data and files; keeps
    // bookings, payments and tax records (see accountDeletionService).
    await eraseAccount(req.user.userId, JWT_EXPIRY);

    return res.status(200).json({
      success: true,
      message: 'Your account and personal data have been deleted. Booking, payment and tax records are kept as required by law.',
    });
  } catch (error) {
    console.error('Error deleting account:', error);
    return res.status(500).json(errorResponse(500, 'Failed to delete account'));
  }
};

/**
 * GET /api/users/me/reviews
 * Get reviews the current client has written
 */
export const getMyReviews = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const { page = '1', limit = '10' } = req.query;
    const pageNum = Math.max(1, parseInt(page as string) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string) || 10));
    const skip = (pageNum - 1) * limitNum;

    const [reviews, total] = await Promise.all([
      prisma.review.findMany({
        where: { clientId: req.user.userId },
        include: {
          booking: {
            select: {
              id: true,
              workerId: true,
              serviceTask: { select: { name: true } },
              worker: { select: { fullName: true, avatar: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
      }),
      prisma.review.count({ where: { clientId: req.user.userId } }),
    ]);

    const formattedReviews = reviews.map((review) => ({
      id: review.id,
      bookingId: review.booking.id,
      workerId: review.booking.workerId,
      workerName: review.booking.worker?.fullName ?? 'Worker',
      workerAvatar: review.booking.worker?.avatar ?? null,
      serviceType: review.booking.serviceTask?.name ?? 'Service',
      rating: review.rating,
      comment: review.comment,
      photoUrls: review.photoUrls,
      createdAt: review.createdAt,
    }));

    return res.status(200).json({
      success: true,
      message: 'Reviews retrieved successfully',
      data: {
        reviews: formattedReviews,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum),
        },
      },
    });
  } catch (error) {
    console.error('Error fetching my reviews:', error);
    return res.status(500).json(errorResponse(500, 'Failed to fetch reviews'));
  }
};