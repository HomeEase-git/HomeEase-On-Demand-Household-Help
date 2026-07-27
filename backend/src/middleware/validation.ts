import { Request, Response, NextFunction } from 'express';
import { errorResponse } from '../utils/errorResponse';
import { KYC_DOCUMENT_TYPES } from '../utils/kycDocumentTypes';

/**
 * Validates that required fields are present and returns 400 if missing.
 * Used across all routes to short-circuit Prisma calls before they happen.
 */

// Worker validators
export const validateUpdateAvailability = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { isAvailable, availableDays } = req.body;

  if (typeof isAvailable !== 'boolean') {
    return res.status(400).json(errorResponse(400, 'isAvailable must be a boolean'));
  }

  if (availableDays !== undefined) {
    if (!Array.isArray(availableDays)) {
      return res.status(400).json(errorResponse(400, 'availableDays must be an array'));
    }
    const validDays = [0, 1, 2, 3, 4, 5, 6];
    if (!availableDays.every((day: unknown) => typeof day === 'number' && validDays.includes(day))) {
      return res.status(400).json(errorResponse(400, 'availableDays must contain integers 0 (Sun) through 6 (Sat)'));
    }
  }

  return next();
};


export const validateUpdateWorkerProfile = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const {
    bio,
    serviceAreaRadius,
    address,
    city,
    state,
    zipCode,
    kycStatus,
    kycSubmittedAt,
    kycApprovedAt,
    resumeUrl,
  } = req.body;
  
  if (bio !== undefined && typeof bio !== 'string') {
    return res.status(400).json(errorResponse(400, 'bio must be a string'));
  }
  
  if (serviceAreaRadius !== undefined) {
    if (typeof serviceAreaRadius !== 'number' || serviceAreaRadius < 0) {
      return res.status(400).json(errorResponse(400, 'serviceAreaRadius must be a non-negative number'));
    }
  }
  
  if (address !== undefined && typeof address !== 'string') {
    return res.status(400).json(errorResponse(400, 'address must be a string'));
  }
  
  if (city !== undefined && typeof city !== 'string') {
    return res.status(400).json(errorResponse(400, 'city must be a string'));
  }

  if (state !== undefined && typeof state !== 'string') {
    return res.status(400).json(errorResponse(400, 'state must be a string'));
  }

  if (zipCode !== undefined && typeof zipCode !== 'string') {
    return res.status(400).json(errorResponse(400, 'zipCode must be a string'));
  }

  const allowedKycStatuses = ['PENDING', 'SUBMITTED', 'APPROVED', 'REJECTED'];
  if (kycStatus !== undefined && !allowedKycStatuses.includes(kycStatus)) {
    return res.status(400).json(errorResponse(400, 'kycStatus must be one of PENDING, SUBMITTED, APPROVED, or REJECTED'));
  }

  if (kycSubmittedAt !== undefined && isNaN(new Date(kycSubmittedAt).getTime())) {
    return res.status(400).json(errorResponse(400, 'kycSubmittedAt must be a valid date'));
  }

  if (kycApprovedAt !== undefined && isNaN(new Date(kycApprovedAt).getTime())) {
    return res.status(400).json(errorResponse(400, 'kycApprovedAt must be a valid date'));
  }

  if (resumeUrl !== undefined && typeof resumeUrl !== 'string') {
    return res.status(400).json(errorResponse(400, 'resumeUrl must be a string'));
  }
  
  return next();
};

export const validateAddServiceTypes = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { serviceTypeIds } = req.body;
  
  if (!Array.isArray(serviceTypeIds) || serviceTypeIds.length === 0) {
    return res.status(400).json(errorResponse(400, 'serviceTypeIds must be a non-empty array'));
  }
  
  if (!serviceTypeIds.every((id: unknown) => typeof id === 'string')) {
    return res.status(400).json(errorResponse(400, 'All serviceTypeIds must be strings'));
  }
  
  return next();
};

// Booking validators
export const validateCreateBooking = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const {
    workerId,
    serviceTaskId,
    location,
    scheduledDate,
    scheduledTime,
    estimatedPrice,
    estimatedDurationHours,
    inspectionFeeCharged,
    inspectionFeeAmount,
  } = req.body;
  
  if (!workerId || typeof workerId !== 'string') {
    return res.status(400).json(errorResponse(400, 'workerId is required and must be a string'));
  }
  
  if (!serviceTaskId || typeof serviceTaskId !== 'string') {
    return res.status(400).json(errorResponse(400, 'serviceTaskId is required and must be a string'));
  }
  
  if (!location || typeof location !== 'string') {
    return res.status(400).json(errorResponse(400, 'location is required and must be a string'));
  }
  
  if (!scheduledDate) {
    return res.status(400).json(errorResponse(400, 'scheduledDate is required'));
  }
  
  if (!scheduledTime || typeof scheduledTime !== 'string') {
    return res.status(400).json(errorResponse(400, 'scheduledTime is required and must be a string'));
  }
  
  if (typeof estimatedPrice !== 'number' || estimatedPrice <= 0) {
    return res.status(400).json(errorResponse(400, 'estimatedPrice must be a positive number'));
  }

  if (estimatedDurationHours !== undefined) {
    if (typeof estimatedDurationHours !== 'number' || estimatedDurationHours < 0) {
      return res.status(400).json(errorResponse(400, 'estimatedDurationHours must be a non-negative number'));
    }
  }

  if (inspectionFeeCharged !== undefined && typeof inspectionFeeCharged !== 'boolean') {
    return res.status(400).json(errorResponse(400, 'inspectionFeeCharged must be a boolean'));
  }

  if (inspectionFeeAmount !== undefined) {
    if (typeof inspectionFeeAmount !== 'number' || inspectionFeeAmount < 0) {
      return res.status(400).json(errorResponse(400, 'inspectionFeeAmount must be a non-negative number'));
    }
  }
  
  return next();
};

export const validateSubmitQuote = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { laborCost, materialsCost, notes } = req.body;
  
  if (typeof laborCost !== 'number' || laborCost < 0) {
    return res.status(400).json(errorResponse(400, 'laborCost must be a non-negative number'));
  }
  
  if (typeof materialsCost !== 'number' || materialsCost < 0) {
    return res.status(400).json(errorResponse(400, 'materialsCost must be a non-negative number'));
  }
  
  if (notes !== undefined && typeof notes !== 'string') {
    return res.status(400).json(errorResponse(400, 'notes must be a string'));
  }
  
  return next();
};

export const validateBookingStatusUpdate = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { reason } = req.body;
  
  if (reason !== undefined && typeof reason !== 'string') {
    return res.status(400).json(errorResponse(400, 'reason must be a string'));
  }
  
  return next();
};

export const validateApproveQuote = (
  _req: Request,
  _res: Response,
  next: NextFunction
) => {
  // Quote approval needs no additional fields beyond ID in params
  return next();
};

export const validateDisputeQuote = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { reason } = req.body;
  
  if (!reason || typeof reason !== 'string') {
    return res.status(400).json(errorResponse(400, 'reason is required and must be a string'));
  }
  
  return next();
};

export const validateAddAddon = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { title, description, cost } = req.body;
  
  if (!title || typeof title !== 'string') {
    return res.status(400).json(errorResponse(400, 'title is required and must be a string'));
  }
  
  if (description && typeof description !== 'string') {
    return res.status(400).json(errorResponse(400, 'description must be a string'));
  }
  
  if (typeof cost !== 'number' || cost <= 0) {
    return res.status(400).json(errorResponse(400, 'cost is required and must be a positive number'));
  }
  
  return next();
};

export const validateAddReview = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { rating, comment } = req.body;
  
  if (typeof rating !== 'number' || rating < 1 || rating > 5) {
    return res.status(400).json(errorResponse(400, 'rating must be a number between 1 and 5'));
  }
  
  if (!comment || typeof comment !== 'string') {
    return res.status(400).json(errorResponse(400, 'comment is required and must be a string'));
  }
  
  return next();
};

export const validateRescheduleBooking = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { newDate, newTime } = req.body;
  
  if (!newDate) {
    return res.status(400).json(errorResponse(400, 'newDate is required'));
  }
  
  if (!newTime || typeof newTime !== 'string') {
    return res.status(400).json(errorResponse(400, 'newTime is required and must be a string'));
  }
  
  return next();
};

const validPaymentMethodTypes = ['GCASH', 'MAYA', 'CARD', 'BANK_TRANSFER', 'CASH'];

// Payment validators
export const validateAddPaymentMethod = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { type, accountIdentifier } = req.body;

  if (!type || typeof type !== 'string') {
    return res.status(400).json(errorResponse(400, 'type is required and must be a string'));
  }

  if (!validPaymentMethodTypes.includes(type.toUpperCase())) {
    return res.status(400).json(
      errorResponse(400, `Invalid type "${type}". Allowed values: GCASH, MAYA, CARD, BANK_TRANSFER, CASH`)
    );
  }

  if (!accountIdentifier || typeof accountIdentifier !== 'string') {
    return res.status(400).json(errorResponse(400, 'accountIdentifier is required and must be a string'));
  }

  return next();
};

export const validateUpdatePaymentMethod = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { label } = req.body;

  if (label === undefined || typeof label !== 'string' || !label.trim()) {
    return res.status(400).json(errorResponse(400, 'label is required and must be a non-empty string'));
  }

  return next();
};

export const validateReleaseEscrow = (
  _req: Request,
  _res: Response,
  next: NextFunction
) => {
  // Release escrow needs no additional fields
  return next();
};

export const validateRefundPayment = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { reason } = req.body;
  
  if (reason !== undefined && typeof reason !== 'string') {
    return res.status(400).json(errorResponse(400, 'reason must be a string'));
  }
  
  return next();
};

// User validators
export const validateUpdateUserProfile = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { fullName, phone, avatar } = req.body;
  
  if (fullName !== undefined && typeof fullName !== 'string') {
    return res.status(400).json(errorResponse(400, 'fullName must be a string'));
  }
  
  if (phone !== undefined && typeof phone !== 'string') {
    return res.status(400).json(errorResponse(400, 'phone must be a string'));
  }
  
  if (avatar !== undefined && typeof avatar !== 'string') {
    return res.status(400).json(errorResponse(400, 'avatar must be a string'));
  }
  
  return next();
};

export const validateChangePassword = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { currentPassword, newPassword } = req.body;
  
  if (!currentPassword || typeof currentPassword !== 'string') {
    return res.status(400).json(errorResponse(400, 'currentPassword is required and must be a string'));
  }
  
  if (!newPassword || typeof newPassword !== 'string') {
    return res.status(400).json(errorResponse(400, 'newPassword is required and must be a string'));
  }
  
  if (newPassword.length < 8) {
    return res.status(400).json(errorResponse(400, 'newPassword must be at least 8 characters'));
  }
  
  return next();
};

export const validateAddAddress = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { label, street, city, state, zipCode } = req.body;
  
  if (!label || typeof label !== 'string') {
    return res.status(400).json(errorResponse(400, 'label is required and must be a string'));
  }
  
  if (!street || typeof street !== 'string') {
    return res.status(400).json(errorResponse(400, 'street is required and must be a string'));
  }
  
  if (!city || typeof city !== 'string') {
    return res.status(400).json(errorResponse(400, 'city is required and must be a string'));
  }
  
  if (!state || typeof state !== 'string') {
    return res.status(400).json(errorResponse(400, 'state is required and must be a string'));
  }
  
  if (!zipCode || typeof zipCode !== 'string') {
    return res.status(400).json(errorResponse(400, 'zipCode is required and must be a string'));
  }
  
  return next();
};

export const validateUpdateAddress = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { label, street, city, state, zipCode } = req.body;
  
  if (label !== undefined && typeof label !== 'string') {
    return res.status(400).json(errorResponse(400, 'label must be a string'));
  }
  
  if (street !== undefined && typeof street !== 'string') {
    return res.status(400).json(errorResponse(400, 'street must be a string'));
  }
  
  if (city !== undefined && typeof city !== 'string') {
    return res.status(400).json(errorResponse(400, 'city must be a string'));
  }
  
  if (state !== undefined && typeof state !== 'string') {
    return res.status(400).json(errorResponse(400, 'state must be a string'));
  }
  
  if (zipCode !== undefined && typeof zipCode !== 'string') {
    return res.status(400).json(errorResponse(400, 'zipCode must be a string'));
  }
  
  return next();
};

export const validateUpdateNotificationPreferences = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { bookingUpdates, messages, promotions, systemNotifications } = req.body;
  
  if (
    bookingUpdates !== undefined &&
    typeof bookingUpdates !== 'boolean'
  ) {
    return res.status(400).json(errorResponse(400, 'bookingUpdates must be a boolean'));
  }
  
  if (messages !== undefined && typeof messages !== 'boolean') {
    return res.status(400).json(errorResponse(400, 'messages must be a boolean'));
  }
  
  if (promotions !== undefined && typeof promotions !== 'boolean') {
    return res.status(400).json(errorResponse(400, 'promotions must be a boolean'));
  }
  
  if (systemNotifications !== undefined && typeof systemNotifications !== 'boolean') {
    return res.status(400).json(errorResponse(400, 'systemNotifications must be a boolean'));
  }
  
  return next();
};

export const validateSubmitKYCDocument = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { documentType, documentUrl } = req.body;

  if (!documentType || typeof documentType !== 'string') {
    return res.status(400).json(errorResponse(400, 'documentType is required and must be a string'));
  }

  if (!(KYC_DOCUMENT_TYPES as readonly string[]).includes(documentType)) {
    return res.status(400).json(errorResponse(400, 'documentType is not supported'));
  }
  
  if (!documentUrl || typeof documentUrl !== 'string') {
    return res.status(400).json(errorResponse(400, 'documentUrl is required and must be a string'));
  }
  
  return next();
};

export const validateSubmitContractAcceptance = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { contractType, acceptedAt } = req.body;
  
  if (!contractType || typeof contractType !== 'string') {
    return res.status(400).json(errorResponse(400, 'contractType is required and must be a string'));
  }
  
  if (acceptedAt !== undefined && isNaN(new Date(acceptedAt).getTime())) {
    return res.status(400).json(errorResponse(400, 'acceptedAt must be a valid date'));
  }
  
  return next();
};

// Message validators
export const validateSendMessage = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { receiverId, content, imageUrl } = req.body;

  if (!receiverId || typeof receiverId !== 'string') {
    return res.status(400).json(errorResponse(400, 'receiverId is required and must be a string'));
  }

  const hasContent = typeof content === 'string' && content.trim().length > 0;
  const hasImage = typeof imageUrl === 'string' && imageUrl.trim().length > 0;

  if (!hasContent && !hasImage) {
    return res.status(400).json(errorResponse(400, 'Either content or imageUrl is required'));
  }

  return next();
};