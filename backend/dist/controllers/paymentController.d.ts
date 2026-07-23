import { Request, Response } from 'express';
import type { JwtPayload } from '@/types/index';
interface AuthRequest extends Request {
    user?: JwtPayload;
}
/**
 * POST /api/payments/:bookingId
 * Create Payment once booking is completed/approved
 *
 * Schema notes:
 *  - Payment has no clientId/workerId — ownership is accessed via booking relation
 *  - Payment.methodType is required (PaymentMethodType enum)
 *  - totalAmount is required on Payment
 *  - Booking quote data is inline (laborCost, materialsCost); addOns use `price` field
 */
export declare const createPayment: (req: AuthRequest, res: Response) => Promise<Response<any, Record<string, any>>>;
/**
 * GET /api/payments/:bookingId
 * Get payment detail/receipt data
 */
export declare const getPaymentDetail: (req: AuthRequest, res: Response) => Promise<Response<any, Record<string, any>>>;
/**
 * GET /api/payments/me
 * List payments (client: payments made, worker: payouts)
 *
 * Payment has no clientId/workerId — filter via booking relation.
 */
export declare const listMyPayments: (req: AuthRequest, res: Response) => Promise<Response<any, Record<string, any>>>;
/**
 * POST /api/payments/:id/release
 * Release escrow: HELD → RELEASED
 */
export declare const releaseEscrow: (req: AuthRequest, res: Response) => Promise<Response<any, Record<string, any>>>;
/**
 * POST /api/payments/:id/refund
 * Refund payment: escrow → REFUNDED
 *
 * Schema notes:
 *  - Payment has no refundReason or refundedAt fields
 *  - Store reason in a notification; use updatedAt as timestamp proxy
 */
export declare const refundPayment: (req: AuthRequest, res: Response) => Promise<Response<any, Record<string, any>>>;
/**
 * POST /api/payments/paymongo/intent
 * Create PayMongo payment intent
 * STUB for Sprint 3: will integrate with actual PayMongo API
 */
export declare const createPaymentIntent: (req: AuthRequest, res: Response) => Promise<Response<any, Record<string, any>>>;
/**
 * POST /api/payments/paymongo/webhook
 * Handle PayMongo webhook events
 * STUB for Sprint 3
 */
export declare const handlePayMongoWebhook: (req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
export {};
//# sourceMappingURL=paymentController.d.ts.map