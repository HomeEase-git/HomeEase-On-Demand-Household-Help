import { Request, Response } from 'express';
import type { JwtPayload } from '@/types/index';
interface AuthRequest extends Request {
    user?: JwtPayload;
}
/**
 * GET /api/users/me
 * Get current user profile
 */
export declare const getUserProfile: (req: AuthRequest, res: Response) => Promise<Response<any, Record<string, any>>>;
/**
 * PATCH /api/users/me
 * Update user profile
 */
export declare const updateUserProfile: (req: AuthRequest, res: Response) => Promise<Response<any, Record<string, any>>>;
/**
 * POST /api/users/me/change-password
 * Change password
 */
export declare const changePassword: (req: AuthRequest, res: Response) => Promise<Response<any, Record<string, any>>>;
/**
 * GET /api/users/me/addresses
 */
export declare const getAddresses: (req: AuthRequest, res: Response) => Promise<Response<any, Record<string, any>>>;
/**
 * POST /api/users/me/addresses
 */
export declare const createAddress: (req: AuthRequest, res: Response) => Promise<Response<any, Record<string, any>>>;
/**
 * PATCH /api/users/me/addresses/:addressId
 */
export declare const updateAddress: (req: AuthRequest, res: Response) => Promise<Response<any, Record<string, any>>>;
/**
 * DELETE /api/users/me/addresses/:addressId
 */
export declare const deleteAddress: (req: AuthRequest, res: Response) => Promise<Response<any, Record<string, any>>>;
/**
 * PATCH /api/users/me/addresses/:addressId/set-default
 */
export declare const setDefaultAddress: (req: AuthRequest, res: Response) => Promise<Response<any, Record<string, any>>>;
/**
 * GET /api/users/me/payment-methods
 */
export declare const getPaymentMethods: (req: AuthRequest, res: Response) => Promise<Response<any, Record<string, any>>>;
/**
 * POST /api/users/me/payment-methods
 */
export declare const addPaymentMethod: (req: AuthRequest, res: Response) => Promise<Response<any, Record<string, any>>>;
/**
 * PATCH /api/users/me/payment-methods/:methodId
 */
export declare const updatePaymentMethod: (req: AuthRequest, res: Response) => Promise<Response<any, Record<string, any>>>;
/**
 * PATCH /api/users/me/payment-methods/:methodId/set-default
 */
export declare const setDefaultPaymentMethod: (req: AuthRequest, res: Response) => Promise<Response<any, Record<string, any>>>;
/**
 * DELETE /api/users/me/payment-methods/:methodId
 */
export declare const deletePaymentMethod: (req: AuthRequest, res: Response) => Promise<Response<any, Record<string, any>>>;
/**
 * PATCH /api/users/me/notification-preferences
 */
export declare const updateNotificationPreferences: (req: AuthRequest, res: Response) => Promise<Response<any, Record<string, any>>>;
/**
 * GET /api/users/me/kyc-documents
 */
export declare const getKYCDocuments: (req: AuthRequest, res: Response) => Promise<Response<any, Record<string, any>>>;
/**
 * POST /api/users/me/kyc-documents
 */
export declare const submitKYCDocument: (req: AuthRequest, res: Response) => Promise<Response<any, Record<string, any>>>;
/**
 * POST /api/users/me/contract-acceptance
 */
export declare const acceptContract: (req: AuthRequest, res: Response) => Promise<Response<any, Record<string, any>>>;
/**
 * DELETE /api/users/me
 */
export declare const deleteAccount: (req: AuthRequest, res: Response) => Promise<Response<any, Record<string, any>>>;
/**
 * GET /api/users/me/reviews
 * Get reviews the current client has written
 */
export declare const getMyReviews: (req: AuthRequest, res: Response) => Promise<Response<any, Record<string, any>>>;
export {};
//# sourceMappingURL=userController.d.ts.map