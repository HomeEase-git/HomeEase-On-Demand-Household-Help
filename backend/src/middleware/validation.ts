import { Request, Response, NextFunction } from 'express';
import { errorResponse } from '../utils/errorResponse';
import { KYC_DOCUMENT_TYPES } from '../utils/kycDocumentTypes';
import { isValidTin } from '../utils/taxId';
import {
  VALID_TIME_SLOTS,
  VALID_CONDITIONS,
  VALID_URGENCY_LEVELS,
  VALID_ROOM_TYPES,
  VALID_PAYMENT_METHOD_TYPES,
} from '../constants/bookingEnums';

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
    addressLat,
    addressLng,
    resumeUrl,
    digitalIdTrade,
    digitalIdServiceArea,
    licenseNumber,
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

  // Geocoded client-side (see mobile utils/geo.ts geocodeAddress) when
  // address/city/state/zipCode change — sent together, but each is optional
  // independently in case a future caller wants to clear the address without
  // re-geocoding.
  if (addressLat !== undefined && addressLat !== null && typeof addressLat !== 'number') {
    return res.status(400).json(errorResponse(400, 'addressLat must be a number'));
  }

  if (addressLng !== undefined && addressLng !== null && typeof addressLng !== 'number') {
    return res.status(400).json(errorResponse(400, 'addressLng must be a number'));
  }

  if (resumeUrl !== undefined && typeof resumeUrl !== 'string') {
    return res.status(400).json(errorResponse(400, 'resumeUrl must be a string'));
  }

  if (digitalIdTrade !== undefined && typeof digitalIdTrade !== 'string') {
    return res.status(400).json(errorResponse(400, 'digitalIdTrade must be a string'));
  }

  if (digitalIdServiceArea !== undefined && typeof digitalIdServiceArea !== 'string') {
    return res.status(400).json(errorResponse(400, 'digitalIdServiceArea must be a string'));
  }

  if (licenseNumber !== undefined && typeof licenseNumber !== 'string') {
    return res.status(400).json(errorResponse(400, 'licenseNumber must be a string'));
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

export const validateCreatePackage = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { serviceTypeId, name, description, price } = req.body;

  if (!serviceTypeId || typeof serviceTypeId !== 'string') {
    return res.status(400).json(errorResponse(400, 'serviceTypeId is required and must be a string'));
  }

  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json(errorResponse(400, 'name is required and must be a non-empty string'));
  }

  if (description !== undefined && typeof description !== 'string') {
    return res.status(400).json(errorResponse(400, 'description must be a string'));
  }

  if (typeof price !== 'number' || price <= 0) {
    return res.status(400).json(errorResponse(400, 'price must be a positive number'));
  }

  return next();
};

export const validateUpdatePackage = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { serviceTypeId, name, description, price, isActive } = req.body;

  if (serviceTypeId !== undefined && typeof serviceTypeId !== 'string') {
    return res.status(400).json(errorResponse(400, 'serviceTypeId must be a string'));
  }

  if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
    return res.status(400).json(errorResponse(400, 'name must be a non-empty string'));
  }

  if (description !== undefined && typeof description !== 'string') {
    return res.status(400).json(errorResponse(400, 'description must be a string'));
  }

  if (price !== undefined && (typeof price !== 'number' || price <= 0)) {
    return res.status(400).json(errorResponse(400, 'price must be a positive number'));
  }

  if (isActive !== undefined && typeof isActive !== 'boolean') {
    return res.status(400).json(errorResponse(400, 'isActive must be a boolean'));
  }

  return next();
};

export const validateCreateSkill = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { name, category, rate } = req.body;

  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json(errorResponse(400, 'name is required and must be a non-empty string'));
  }

  if (!category || typeof category !== 'string' || !category.trim()) {
    return res.status(400).json(errorResponse(400, 'category is required and must be a non-empty string'));
  }

  if (typeof rate !== 'number' || rate <= 0) {
    return res.status(400).json(errorResponse(400, 'rate must be a positive number'));
  }

  return next();
};

export const validateUpdateSkill = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { name, category, rate } = req.body;

  if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
    return res.status(400).json(errorResponse(400, 'name must be a non-empty string'));
  }

  if (category !== undefined && (typeof category !== 'string' || !category.trim())) {
    return res.status(400).json(errorResponse(400, 'category must be a non-empty string'));
  }

  if (rate !== undefined && (typeof rate !== 'number' || rate <= 0)) {
    return res.status(400).json(errorResponse(400, 'rate must be a positive number'));
  }

  if (name === undefined && category === undefined && rate === undefined) {
    return res.status(400).json(errorResponse(400, 'At least one field must be provided'));
  }

  return next();
};

export const validateCreateCertification = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { name, issuer, issueDate, expiryDate, documentUrl } = req.body;

  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json(errorResponse(400, 'name is required and must be a non-empty string'));
  }

  if (!issuer || typeof issuer !== 'string' || !issuer.trim()) {
    return res.status(400).json(errorResponse(400, 'issuer is required and must be a non-empty string'));
  }

  if (!issueDate || isNaN(new Date(issueDate).getTime())) {
    return res.status(400).json(errorResponse(400, 'issueDate is required and must be a valid date'));
  }

  if (expiryDate !== undefined && expiryDate !== null && isNaN(new Date(expiryDate).getTime())) {
    return res.status(400).json(errorResponse(400, 'expiryDate must be a valid date'));
  }

  if (!documentUrl || typeof documentUrl !== 'string') {
    return res.status(400).json(errorResponse(400, 'documentUrl is required and must be a string'));
  }

  return next();
};

export const validateUpdateCertification = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { name, issuer, issueDate, expiryDate, documentUrl } = req.body;

  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json(errorResponse(400, 'name is required and must be a non-empty string'));
  }

  if (!issuer || typeof issuer !== 'string' || !issuer.trim()) {
    return res.status(400).json(errorResponse(400, 'issuer is required and must be a non-empty string'));
  }

  if (!issueDate || isNaN(new Date(issueDate).getTime())) {
    return res.status(400).json(errorResponse(400, 'issueDate is required and must be a valid date'));
  }

  if (expiryDate !== undefined && expiryDate !== null && isNaN(new Date(expiryDate).getTime())) {
    return res.status(400).json(errorResponse(400, 'expiryDate must be a valid date'));
  }

  if (documentUrl !== undefined && typeof documentUrl !== 'string') {
    return res.status(400).json(errorResponse(400, 'documentUrl must be a string'));
  }

  return next();
};

export const validateUpdateAvailabilitySlots = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { slots, dates } = req.body;

  if (!Array.isArray(slots)) {
    return res.status(400).json(errorResponse(400, 'slots must be an array'));
  }

  // slots may be empty as long as `dates` names at least one day to clear —
  // that's how a worker closes a day down to zero open slots.
  if (slots.length === 0 && (!Array.isArray(dates) || dates.length === 0)) {
    return res.status(400).json(errorResponse(400, 'slots must be non-empty, or dates must list at least one day to clear'));
  }

  for (const slot of slots) {
    if (!slot || typeof slot !== 'object') {
      return res.status(400).json(errorResponse(400, 'Each slot must be an object with date and timeSlot'));
    }
    if (!slot.date || isNaN(new Date(slot.date).getTime())) {
      return res.status(400).json(errorResponse(400, 'Each slot.date must be a valid date'));
    }
    if (!VALID_TIME_SLOTS.includes(slot.timeSlot)) {
      return res.status(400).json(errorResponse(400, `Each slot.timeSlot must be one of ${VALID_TIME_SLOTS.join(', ')}`));
    }
  }

  if (dates !== undefined) {
    if (!Array.isArray(dates) || dates.some((d: unknown) => typeof d !== 'string' || isNaN(new Date(d).getTime()))) {
      return res.status(400).json(errorResponse(400, 'dates must be an array of valid date strings'));
    }
  }

  return next();
};

const MIN_HOURLY_RATE = 20;
const MAX_HOURLY_RATE = 100;

export const validateUpdateHourlyRate = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { hourlyRate } = req.body;

  if (typeof hourlyRate !== 'number' || Number.isNaN(hourlyRate)) {
    return res.status(400).json(errorResponse(400, 'hourlyRate must be a number'));
  }

  if (hourlyRate < MIN_HOURLY_RATE || hourlyRate > MAX_HOURLY_RATE) {
    return res.status(400).json(
      errorResponse(400, `hourlyRate must be between $${MIN_HOURLY_RATE} and $${MAX_HOURLY_RATE}`)
    );
  }

  return next();
};

export const validateRegisterPushToken = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { token } = req.body;

  if (!token || typeof token !== 'string' || !token.trim()) {
    return res.status(400).json(errorResponse(400, 'token is required and must be a non-empty string'));
  }

  return next();
};

export const validateUpdatePayoutMethod = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { payoutMethod, payoutAccountName, payoutAccountNumber } = req.body;

  const allowedMethods = ['GCASH', 'MAYA'];
  if (!payoutMethod || !allowedMethods.includes(payoutMethod)) {
    return res.status(400).json(errorResponse(400, `payoutMethod must be one of ${allowedMethods.join(', ')}`));
  }

  if (payoutAccountName !== undefined && typeof payoutAccountName !== 'string') {
    return res.status(400).json(errorResponse(400, 'payoutAccountName must be a string'));
  }

  if (payoutAccountNumber !== undefined && typeof payoutAccountNumber !== 'string') {
    return res.status(400).json(errorResponse(400, 'payoutAccountNumber must be a string'));
  }

  return next();
};

export const validateUpdateTaxInfo = (req: Request, res: Response, next: NextFunction) => {
  const { tin } = req.body;

  if (typeof tin !== 'string' || !isValidTin(tin)) {
    return res
      .status(400)
      .json(errorResponse(400, 'tin must be a valid Philippine TIN (e.g. 000-000-000 or 000-000-000-000)'));
  }

  return next();
};

// Booking validators
// Rough Philippines bounding box (the only market this platform serves) —
// rejects wildly wrong/spoofed coordinates before they ever reach a
// distanceFee calculation or a "which city" pricing-rule lookup. Generous on
// purpose (includes surrounding EEZ waters) rather than tightly hugging the
// coastline, since a false rejection is worse than a slightly loose bound.
const PH_BOUNDS = { minLat: 4, maxLat: 21.5, minLng: 116, maxLng: 127 };

/**
 * Booking creation no longer takes a client-supplied estimatedPrice or free-text
 * scheduledTime — price is computed server-side (see bookingController.createBooking
 * / pricingRuleService) and scheduling uses the TimeSlot enum. workerId is optional:
 * omitting it triggers auto-match.
 */
export const validateCreateBooking = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const {
    workerId,
    serviceType,
    serviceTaskId,
    rooms,
    condition,
    address,
    city,
    lat,
    lng,
    date,
    timeSlot,
    urgencyLevel,
    addOns,
    priorities,
    tip,
    paymentMethodType,
    paymentAccountIdentifier,
    scopeAnswers,
    idempotencyKey,
  } = req.body;

  if (!serviceType || typeof serviceType !== 'string') {
    return res.status(400).json(errorResponse(400, 'serviceType is required and must be a string'));
  }

  if (serviceTaskId !== undefined && serviceTaskId !== null && typeof serviceTaskId !== 'string') {
    return res.status(400).json(errorResponse(400, 'serviceTaskId must be a string'));
  }

  if (idempotencyKey !== undefined && (typeof idempotencyKey !== 'string' || idempotencyKey.length > 200)) {
    return res.status(400).json(errorResponse(400, 'idempotencyKey must be a string of at most 200 characters'));
  }

  if (workerId !== undefined && workerId !== null && typeof workerId !== 'string') {
    return res.status(400).json(errorResponse(400, 'workerId must be a string'));
  }

  if (!address || typeof address !== 'string') {
    return res.status(400).json(errorResponse(400, 'address is required and must be a string'));
  }

  // Required, not just recommended: an empty city silently no-ops any
  // city-keyed PricingRule lookup (see bookingController.createBooking's
  // validatePriceWithinPricingRule call) — better to reject up front than
  // let pricing enforcement quietly not apply. The client always has this
  // (see mobile step-2's address picker, which sets it from the geocoded
  // result), so this doesn't tighten anything a real booking needs.
  if (!city || typeof city !== 'string' || !city.trim()) {
    return res.status(400).json(errorResponse(400, 'city is required and must be a non-empty string'));
  }

  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return res.status(400).json(errorResponse(400, 'lat and lng are required and must be numbers'));
  }

  if (
    lat < PH_BOUNDS.minLat || lat > PH_BOUNDS.maxLat ||
    lng < PH_BOUNDS.minLng || lng > PH_BOUNDS.maxLng
  ) {
    return res.status(400).json(errorResponse(400, 'lat/lng must fall within the Philippines'));
  }

  if (!date || isNaN(new Date(date).getTime())) {
    return res.status(400).json(errorResponse(400, 'date is required and must be a valid date'));
  }

  if (!timeSlot || !VALID_TIME_SLOTS.includes(timeSlot)) {
    return res.status(400).json(errorResponse(400, `timeSlot is required and must be one of ${VALID_TIME_SLOTS.join(', ')}`));
  }

  if (rooms !== undefined) {
    if (!Array.isArray(rooms) || !rooms.every((r: unknown) => typeof r === 'string' && VALID_ROOM_TYPES.includes(r as (typeof VALID_ROOM_TYPES)[number]))) {
      return res.status(400).json(errorResponse(400, `rooms must be an array of: ${VALID_ROOM_TYPES.join(', ')}`));
    }
  }

  if (condition !== undefined && condition !== null && !VALID_CONDITIONS.includes(condition)) {
    return res.status(400).json(errorResponse(400, `condition must be one of ${VALID_CONDITIONS.join(', ')}`));
  }

  if (urgencyLevel !== undefined && !VALID_URGENCY_LEVELS.includes(urgencyLevel)) {
    return res.status(400).json(errorResponse(400, `urgencyLevel must be one of ${VALID_URGENCY_LEVELS.join(', ')}`));
  }

  if (priorities !== undefined) {
    if (!Array.isArray(priorities) || !priorities.every((p: unknown) => typeof p === 'string')) {
      return res.status(400).json(errorResponse(400, 'priorities must be an array of strings'));
    }
  }

  if (addOns !== undefined) {
    if (!Array.isArray(addOns) || !addOns.every((a: unknown) => a && typeof a === 'object' && typeof (a as any).price === 'number')) {
      return res.status(400).json(errorResponse(400, 'addOns must be an array of objects with a numeric price'));
    }
  }

  if (tip !== undefined && (typeof tip !== 'number' || tip < 0)) {
    return res.status(400).json(errorResponse(400, 'tip must be a non-negative number'));
  }

  if (paymentMethodType !== undefined) {
    if (typeof paymentMethodType !== 'string' || !VALID_PAYMENT_METHOD_TYPES.includes(paymentMethodType as (typeof VALID_PAYMENT_METHOD_TYPES)[number])) {
      return res.status(400).json(
        errorResponse(400, `paymentMethodType must be one of: ${VALID_PAYMENT_METHOD_TYPES.join(', ')}`)
      );
    }
  }

  if (paymentAccountIdentifier !== undefined && typeof paymentAccountIdentifier !== 'string') {
    return res.status(400).json(errorResponse(400, 'paymentAccountIdentifier must be a string'));
  }

  if (scopeAnswers !== undefined) {
    const isPlainObject = typeof scopeAnswers === 'object' && scopeAnswers !== null && !Array.isArray(scopeAnswers);
    const hasValidValues =
      isPlainObject &&
      Object.values(scopeAnswers).every(
        (v: unknown) => typeof v === 'string' || (Array.isArray(v) && v.every((x) => typeof x === 'string'))
      );
    if (!hasValidValues) {
      return res
        .status(400)
        .json(errorResponse(400, 'scopeAnswers must be an object mapping field labels to a string or string array'));
    }
  }

  const { issuePhotoUrls } = req.body;
  if (issuePhotoUrls !== undefined) {
    const isValid =
      Array.isArray(issuePhotoUrls) &&
      issuePhotoUrls.length <= 5 &&
      issuePhotoUrls.every((url: unknown) => typeof url === 'string' && url.length <= 2048);
    if (!isValid) {
      return res.status(400).json(errorResponse(400, 'issuePhotoUrls must be an array of at most 5 URL strings'));
    }
  }

  return next();
};

export const validateArriveBooking = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { lat, lng } = req.body;

  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return res.status(400).json(errorResponse(400, 'lat and lng are required and must be numbers'));
  }

  return next();
};

export const validateSubmitQuote = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { materialsCost, notes } = req.body;

  // laborCost is not accepted here — it's pinned to the booking's settled
  // estimatedPrice server-side. Only additional (materials) costs are quoted.
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
  // Field names match the BookingAddOn schema (name/price) and what
  // bookingController.addAddon actually reads — this previously validated
  // title/description/cost, which the controller never read, so every
  // request that passed validation crashed on the Prisma insert (name/price
  // are required, non-nullable columns).
  const { name, price } = req.body;

  if (!name || typeof name !== 'string') {
    return res.status(400).json(errorResponse(400, 'name is required and must be a string'));
  }

  if (typeof price !== 'number' || price <= 0) {
    return res.status(400).json(errorResponse(400, 'price is required and must be a positive number'));
  }

  return next();
};

export const validateAddReview = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { rating, comment, photoUrls } = req.body;

  if (typeof rating !== 'number' || rating < 1 || rating > 5) {
    return res.status(400).json(errorResponse(400, 'rating must be a number between 1 and 5'));
  }

  if (!comment || typeof comment !== 'string') {
    return res.status(400).json(errorResponse(400, 'comment is required and must be a string'));
  }

  if (
    photoUrls !== undefined &&
    (!Array.isArray(photoUrls) ||
      photoUrls.length > 5 ||
      !photoUrls.every((url) => typeof url === 'string'))
  ) {
    return res.status(400).json(errorResponse(400, 'photoUrls must be an array of up to 5 URL strings'));
  }

  return next();
};

const validPaymentMethodTypes = ['GCASH', 'MAYA', 'CASH'];

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
      errorResponse(400, `Invalid type "${type}". Allowed values: GCASH, MAYA, CASH`)
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