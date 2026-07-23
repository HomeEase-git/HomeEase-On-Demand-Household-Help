import { Request, Response } from 'express';
import * as bcrypt from 'bcryptjs';
import prisma from '@config/database';
import { errorResponse } from '@utils/errorResponse';
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
        isVerified: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    
    if (!user) {
      return res.status(404).json(errorResponse(404, 'User not found'));
    }
    
    return res.status(200).json({
      success: true,
      message: 'Profile retrieved successfully',
      data: user,
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
    
    const { fullName, phone } = req.body;
    
    const updateData: any = {};
    if (fullName !== undefined) updateData.fullName = fullName;
    if (phone !== undefined) updateData.phone = phone;
    
    const updated = await prisma.user.update({
      where: { id: req.user.userId },
      data: updateData,
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
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
    
    const { label, street, city, state, zipCode } = req.body;
    
    const address = await prisma.userAddress.create({
      data: {
        userId: req.user.userId,
        label,
        street,
        city,
        state,
        zipCode,
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
    const { label, street, city, state, zipCode } = req.body;
    
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
    
    const { documentType, documentUrl } = req.body;

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
      verificationRequest = await prisma.verificationRequest.create({
        data: {
          userId: req.user.userId,
          type: 'WORKER_ONBOARDING',
          status: 'PENDING',
        },
      });
    }

    const document = await prisma.kycDocument.create({
      data: {
        verificationRequestId: verificationRequest.id,
        documentType,
        fileUrl: documentUrl,
        status: 'PENDING',
      },
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
    
    const { contractType, acceptedAt } = req.body;
    
    const acceptance = await prisma.contractAcceptance.create({
      data: {
        userId: req.user.userId,
        contractType,
        acceptedAt: acceptedAt ? new Date(acceptedAt) : new Date(),
      },
    });
    
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
    
    await prisma.user.update({
      where: { id: req.user.userId },
      data: {
        isDeleted: true,
        deletedAt: new Date(),
      },
    });
    
    return res.status(200).json({
      success: true,
      message: 'Account deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting account:', error);
    return res.status(500).json(errorResponse(500, 'Failed to delete account'));
  }
};