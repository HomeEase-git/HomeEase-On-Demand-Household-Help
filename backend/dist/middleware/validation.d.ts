import { Request, Response, NextFunction } from 'express';
/**
 * Validates that required fields are present and returns 400 if missing.
 * Used across all routes to short-circuit Prisma calls before they happen.
 */
export declare const validateUpdateAvailability: (req: Request, res: Response, next: NextFunction) => void | Response<any, Record<string, any>>;
export declare const validateUpdateWorkerProfile: (req: Request, res: Response, next: NextFunction) => void | Response<any, Record<string, any>>;
export declare const validateAddServiceTypes: (req: Request, res: Response, next: NextFunction) => void | Response<any, Record<string, any>>;
export declare const validateCreateBooking: (req: Request, res: Response, next: NextFunction) => void | Response<any, Record<string, any>>;
export declare const validateSubmitQuote: (req: Request, res: Response, next: NextFunction) => void | Response<any, Record<string, any>>;
export declare const validateBookingStatusUpdate: (req: Request, res: Response, next: NextFunction) => void | Response<any, Record<string, any>>;
export declare const validateApproveQuote: (_req: Request, _res: Response, next: NextFunction) => void;
export declare const validateDisputeQuote: (req: Request, res: Response, next: NextFunction) => void | Response<any, Record<string, any>>;
export declare const validateAddAddon: (req: Request, res: Response, next: NextFunction) => void | Response<any, Record<string, any>>;
export declare const validateAddReview: (req: Request, res: Response, next: NextFunction) => void | Response<any, Record<string, any>>;
export declare const validateRescheduleBooking: (req: Request, res: Response, next: NextFunction) => void | Response<any, Record<string, any>>;
export declare const validateAddPaymentMethod: (req: Request, res: Response, next: NextFunction) => void | Response<any, Record<string, any>>;
export declare const validateUpdatePaymentMethod: (req: Request, res: Response, next: NextFunction) => void | Response<any, Record<string, any>>;
export declare const validateReleaseEscrow: (_req: Request, _res: Response, next: NextFunction) => void;
export declare const validateRefundPayment: (req: Request, res: Response, next: NextFunction) => void | Response<any, Record<string, any>>;
export declare const validateUpdateUserProfile: (req: Request, res: Response, next: NextFunction) => void | Response<any, Record<string, any>>;
export declare const validateChangePassword: (req: Request, res: Response, next: NextFunction) => void | Response<any, Record<string, any>>;
export declare const validateAddAddress: (req: Request, res: Response, next: NextFunction) => void | Response<any, Record<string, any>>;
export declare const validateUpdateAddress: (req: Request, res: Response, next: NextFunction) => void | Response<any, Record<string, any>>;
export declare const validateUpdateNotificationPreferences: (req: Request, res: Response, next: NextFunction) => void | Response<any, Record<string, any>>;
export declare const validateSubmitKYCDocument: (req: Request, res: Response, next: NextFunction) => void | Response<any, Record<string, any>>;
export declare const validateSubmitContractAcceptance: (req: Request, res: Response, next: NextFunction) => void | Response<any, Record<string, any>>;
export declare const validateSendMessage: (req: Request, res: Response, next: NextFunction) => void | Response<any, Record<string, any>>;
//# sourceMappingURL=validation.d.ts.map