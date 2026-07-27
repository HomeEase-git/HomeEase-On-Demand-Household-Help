"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.submitReview = exports.addAddon = exports.rescheduleBooking = exports.cancelBooking = exports.completeBooking = exports.disputeQuote = exports.approveQuote = exports.submitQuote = exports.startBooking = exports.declineBooking = exports.acceptBooking = exports.getBookingDetail = exports.listBookings = exports.createBooking = void 0;
const database_1 = __importDefault(require("@config/database"));
const errorResponse_1 = require("@utils/errorResponse");
const notify_1 = require("@utils/notify");
/**
 * Status transition map: defines valid state transitions
 *
 * Schema BookingStatus values:
 *   PENDING | ACCEPTED | REJECTED | IN_PROGRESS |
 *   QUOTE_SUBMITTED | QUOTE_APPROVED | DISPUTED | COMPLETED | CANCELLED
 *
 * NOTE: DECLINED and QUOTE_DISPUTED do not exist in the schema.
 *   - Use REJECTED in place of DECLINED.
 *   - Use DISPUTED in place of QUOTE_DISPUTED.
 */
const VALID_TRANSITIONS = {
    PENDING: ['ACCEPTED', 'REJECTED', 'CANCELLED'],
    ACCEPTED: ['IN_PROGRESS', 'CANCELLED', 'REJECTED'],
    IN_PROGRESS: ['QUOTE_SUBMITTED', 'CANCELLED'],
    QUOTE_SUBMITTED: ['QUOTE_APPROVED', 'DISPUTED', 'CANCELLED'],
    QUOTE_APPROVED: ['COMPLETED', 'CANCELLED'],
    DISPUTED: ['QUOTE_APPROVED', 'QUOTE_SUBMITTED', 'CANCELLED'],
    COMPLETED: [],
    REJECTED: [],
    CANCELLED: [],
};
const isValidTransition = (currentStatus, newStatus) => {
    return VALID_TRANSITIONS[currentStatus]?.includes(newStatus) ?? false;
};
/**
 * POST /api/bookings
 * Create a new booking (client only)
 */
const createBooking = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'CLIENT') {
            return res.status(403).json((0, errorResponse_1.errorResponse)(403, 'Only clients can create bookings'));
        }
        const { workerId, serviceTaskId, serviceType, description, location, city, scheduledDate, estimatedPrice, notes, estimatedDurationHours, inspectionFeeCharged, inspectionFeeAmount, } = req.body;
        // Verify worker exists and is available
        const worker = await database_1.default.workerProfile.findUnique({
            where: { userId: workerId },
        });
        if (!worker) {
            return res.status(404).json((0, errorResponse_1.errorResponse)(404, 'Worker not found'));
        }
        if (!worker.isAvailable) {
            return res.status(409).json((0, errorResponse_1.errorResponse)(409, 'Worker is not currently available'));
        }
        // Verify service task exists (optional field)
        if (serviceTaskId) {
            const serviceTask = await database_1.default.serviceTask.findUnique({
                where: { id: serviceTaskId },
            });
            if (!serviceTask) {
                return res.status(404).json((0, errorResponse_1.errorResponse)(404, 'Service task not found'));
            }
        }
        // Server-side validation for scheduledTime if provided
        const HHMM_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
        const scheduledTime = req.body.scheduledTime;
        if (scheduledTime && !HHMM_REGEX.test(scheduledTime)) {
            return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'scheduledTime must be in HH:mm 24h format'));
        }
        const estimatedDurationHoursVal = typeof estimatedDurationHours === 'number' && estimatedDurationHours >= 0
            ? estimatedDurationHours
            : undefined;
        const inspectionFeeAmountVal = typeof inspectionFeeAmount === 'number' && inspectionFeeAmount >= 0
            ? inspectionFeeAmount
            : undefined;
        const inspectionFeeChargedVal = inspectionFeeAmountVal != null && inspectionFeeAmountVal > 0
            ? true
            : Boolean(inspectionFeeCharged);
        if (!req.user?.userId) {
            return res.status(401).json((0, errorResponse_1.errorResponse)(401, 'Unauthorized'));
        }
        const userId = req.user?.userId;
        if (!userId) {
            return res.status(401).json((0, errorResponse_1.errorResponse)(401, 'Unauthorized'));
        }
        // Wrap availability check + insert in a transaction to avoid race conditions
        try {
            const booking = await database_1.default.$transaction(async (tx) => {
                // Re-fetch worker profile inside transaction
                const workerProfile = await tx.workerProfile.findUnique({ where: { userId: workerId } });
                if (!workerProfile)
                    throw new Error('Worker not found');
                if (!workerProfile.isAvailable)
                    throw new Error('Worker not available');
                // Check for slot conflicts (same worker, same date, same time)
                const existing = await tx.booking.findFirst({
                    where: {
                        workerId,
                        scheduledDate: new Date(scheduledDate),
                        scheduledTime: scheduledTime ?? null,
                        // consider only bookings that block the slot
                        status: { in: ['PENDING', 'ACCEPTED', 'IN_PROGRESS', 'QUOTE_SUBMITTED', 'QUOTE_APPROVED'] },
                    },
                });
                if (existing) {
                    throw new Error('Slot not available');
                }
                // Insert booking (include tip if provided)
                const tipVal = typeof req.body.tip === 'number' ? req.body.tip : 0;
                const created = await tx.booking.create({
                    data: {
                        clientId: userId,
                        workerId,
                        serviceTaskId: serviceTaskId ?? null,
                        serviceType: serviceType ?? 'GENERAL',
                        description: description ?? '',
                        location,
                        city: city ?? '',
                        scheduledDate: new Date(scheduledDate),
                        scheduledTime: scheduledTime ?? null,
                        estimatedDurationHours: estimatedDurationHoursVal ?? null,
                        estimatedPrice,
                        tip: tipVal,
                        notes,
                        inspectionFeeCharged: inspectionFeeChargedVal,
                        inspectionFeeAmount: inspectionFeeAmountVal ?? null,
                        status: 'PENDING',
                    },
                    include: {
                        client: { select: { id: true, fullName: true, email: true } },
                        worker: { select: { id: true, fullName: true, email: true } },
                        serviceTask: true,
                    },
                });
                // Persist add-ons if provided
                const addOns = Array.isArray(req.body.addOns) ? req.body.addOns : [];
                if (addOns.length > 0) {
                    const mapped = addOns.map((a) => ({ bookingId: created.id, name: a.name || a.id || 'Add-on', price: typeof a.price === 'number' ? a.price : 0 }));
                    await tx.bookingAddOn.createMany({ data: mapped });
                }
                return created;
            });
            // Create notification for worker
            await (0, notify_1.notifyUser)({
                userId: workerId,
                type: 'BOOKING_REQUEST',
                title: 'New Booking Request',
                message: `${booking.client.fullName} has requested your service`,
                relatedId: booking.id,
            });
            return res.status(201).json({
                success: true,
                message: 'Booking created successfully',
                data: {
                    id: booking.id,
                    clientName: booking.client.fullName,
                    workerName: booking.worker.fullName,
                    status: booking.status,
                    scheduledDate: booking.scheduledDate,
                    scheduledTime: booking.scheduledTime,
                    estimatedPrice: booking.estimatedPrice,
                    estimatedDurationHours: booking.estimatedDurationHours,
                    inspectionFeeCharged: booking.inspectionFeeCharged,
                    inspectionFeeAmount: booking.inspectionFeeAmount,
                },
            });
        }
        catch (txErr) {
            if (txErr.message === 'Slot not available') {
                return res.status(409).json((0, errorResponse_1.errorResponse)(409, 'Slot no longer available'));
            }
            if (txErr.message === 'Worker not found' || txErr.message === 'Worker not available') {
                return res.status(404).json((0, errorResponse_1.errorResponse)(404, txErr.message));
            }
            // Prisma unique constraint code
            if (txErr.code === 'P2002') {
                return res.status(409).json((0, errorResponse_1.errorResponse)(409, 'Slot no longer available'));
            }
            throw txErr;
        }
    }
    catch (error) {
        console.error('Error creating booking:', error);
        return res.status(500).json((0, errorResponse_1.errorResponse)(500, 'Failed to create booking'));
    }
};
exports.createBooking = createBooking;
/**
 * GET /api/bookings
 * List bookings (role-filtered: clients see their own, workers see assigned to them)
 */
const listBookings = async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json((0, errorResponse_1.errorResponse)(401, 'Not authenticated'));
        }
        const { status, page = '1', limit = '10' } = req.query;
        const pageNum = Math.max(1, parseInt(page) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 10));
        const skip = (pageNum - 1) * limitNum;
        const whereClause = {};
        if (req.user.role === 'CLIENT') {
            whereClause.clientId = req.user.userId;
        }
        else if (req.user.role === 'WORKER') {
            whereClause.workerId = req.user.userId;
        }
        if (status && typeof status === 'string') {
            whereClause.status = status;
        }
        const [bookings, total] = await Promise.all([
            database_1.default.booking.findMany({
                where: whereClause,
                include: {
                    client: { select: { id: true, fullName: true, avatar: true, phone: true } },
                    worker: { select: { id: true, fullName: true, avatar: true, phone: true } },
                    serviceTask: { select: { id: true, name: true } },
                    review: { select: { rating: true } },
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take: limitNum,
            }),
            database_1.default.booking.count({ where: whereClause }),
        ]);
        const formattedBookings = bookings.map((b) => ({
            id: b.id,
            clientName: b.client.fullName,
            clientId: b.client.id,
            clientPhone: b.client.phone,
            workerName: b.worker?.fullName ?? null,
            workerId: b.worker?.id ?? null,
            workerPhone: b.worker?.phone ?? null,
            service: b.serviceTask?.name ?? b.serviceType,
            status: b.status,
            scheduledDate: b.scheduledDate,
            estimatedPrice: b.estimatedPrice,
            finalPrice: b.finalPrice,
            rating: b.review?.rating ?? null,
        }));
        return res.status(200).json({
            success: true,
            message: 'Bookings retrieved successfully',
            data: {
                bookings: formattedBookings,
                pagination: {
                    page: pageNum,
                    limit: limitNum,
                    total,
                    pages: Math.ceil(total / limitNum),
                },
            },
        });
    }
    catch (error) {
        console.error('Error listing bookings:', error);
        return res.status(500).json((0, errorResponse_1.errorResponse)(500, 'Failed to list bookings'));
    }
};
exports.listBookings = listBookings;
/**
 * GET /api/bookings/:id
 * Get booking detail with ownership check
 */
const getBookingDetail = async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json((0, errorResponse_1.errorResponse)(401, 'Not authenticated'));
        }
        const id = req.params.id;
        const booking = await database_1.default.booking.findUnique({
            where: { id },
            include: {
                client: { select: { id: true, fullName: true, email: true, phone: true } },
                worker: { select: { id: true, fullName: true, email: true, phone: true } },
                serviceTask: true,
                payment: { select: { methodType: true, accountIdentifier: true, status: true, totalAmount: true } },
                // Quote data lives inline on Booking (laborCost, materialsCost, etc.)
                addOns: true, // schema relation is addOns (capital O)
                review: true,
            },
        });
        if (!booking) {
            return res.status(404).json((0, errorResponse_1.errorResponse)(404, 'Booking not found'));
        }
        // Check ownership (client or assigned worker)
        if (booking.clientId !== req.user.userId && booking.workerId !== req.user.userId) {
            return res.status(403).json((0, errorResponse_1.errorResponse)(403, 'You do not have permission to view this booking'));
        }
        // addOns use `price` field (not `cost`) per schema
        const addonsCost = (booking.addOns || []).reduce((sum, addon) => sum + addon.price, 0);
        const hasQuote = booking.laborCost != null && booking.materialsCost != null;
        const finalPrice = hasQuote
            ? (booking.laborCost ?? 0) + (booking.materialsCost ?? 0) + addonsCost
            : booking.estimatedPrice;
        return res.status(200).json({
            success: true,
            message: 'Booking details retrieved successfully',
            data: {
                id: booking.id,
                client: booking.client,
                worker: booking.worker,
                service: booking.serviceTask?.name ?? booking.serviceType,
                status: booking.status,
                location: booking.location,
                scheduledDate: booking.scheduledDate,
                scheduledTime: booking.scheduledTime,
                estimatedPrice: booking.estimatedPrice,
                finalPrice,
                estimatedDurationHours: booking.estimatedDurationHours,
                inspectionFeeCharged: booking.inspectionFeeCharged,
                inspectionFeeAmount: booking.inspectionFeeAmount,
                payment: booking.payment
                    ? {
                        methodType: booking.payment.methodType,
                        accountIdentifier: booking.payment.accountIdentifier,
                        status: booking.payment.status,
                        totalAmount: booking.payment.totalAmount,
                    }
                    : null,
                quote: hasQuote
                    ? {
                        laborCost: booking.laborCost,
                        materialsCost: booking.materialsCost,
                        notes: booking.quoteNotes,
                        status: booking.quoteStatus,
                        quotedAt: booking.quotedAt,
                    }
                    : null,
                addOns: booking.addOns,
                review: booking.review,
                notes: booking.notes,
                createdAt: booking.createdAt,
                updatedAt: booking.updatedAt,
            },
        });
    }
    catch (error) {
        console.error('Error fetching booking detail:', error);
        return res.status(500).json((0, errorResponse_1.errorResponse)(500, 'Failed to fetch booking details'));
    }
};
exports.getBookingDetail = getBookingDetail;
/**
 * PATCH /api/bookings/:id/accept
 * Worker accepts booking (transaction-wrapped capacity check)
 */
const acceptBooking = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'WORKER') {
            return res.status(403).json((0, errorResponse_1.errorResponse)(403, 'Only workers can accept bookings'));
        }
        const id = req.params.id;
        const booking = await database_1.default.booking.findUnique({
            where: { id },
        });
        if (!booking) {
            return res.status(404).json((0, errorResponse_1.errorResponse)(404, 'Booking not found'));
        }
        if (booking.workerId !== req.user.userId) {
            return res.status(403).json((0, errorResponse_1.errorResponse)(403, 'This booking is not assigned to you'));
        }
        if (booking.status !== 'PENDING') {
            return res.status(409).json((0, errorResponse_1.errorResponse)(409, `Cannot accept booking with status ${booking.status}`));
        }
        const currentUserId = req.user.userId;
        // Wrap in transaction to prevent double-counting
        try {
            const result = await database_1.default.$transaction(async (tx) => {
                // Check current capacity
                const workerProfile = await tx.workerProfile.findUnique({
                    where: { userId: currentUserId },
                });
                if (!workerProfile) {
                    throw new Error('Worker profile not found');
                }
                if (workerProfile.activeJobCount >= workerProfile.maxConcurrentJobs) {
                    throw new Error('Worker is at maximum capacity');
                }
                // Update booking status
                const updated = await tx.booking.update({
                    where: { id },
                    data: { status: 'ACCEPTED' },
                });
                // Increment activeJobCount
                await tx.workerProfile.update({
                    where: { userId: currentUserId },
                    data: { activeJobCount: { increment: 1 } },
                });
                return updated;
            });
            // Create notification for client
            await (0, notify_1.notifyUser)({
                userId: result.clientId,
                type: 'BOOKING_ACCEPTED',
                title: 'Booking Accepted',
                message: 'Your booking has been accepted',
                relatedId: result.id,
            });
            return res.status(200).json({
                success: true,
                message: 'Booking accepted successfully',
                data: {
                    id: result.id,
                    status: result.status,
                },
            });
        }
        catch (txError) {
            if (txError.message === 'Worker is at maximum capacity') {
                return res.status(409).json((0, errorResponse_1.errorResponse)(409, txError.message));
            }
            throw txError;
        }
    }
    catch (error) {
        console.error('Error accepting booking:', error);
        return res.status(500).json((0, errorResponse_1.errorResponse)(500, 'Failed to accept booking'));
    }
};
exports.acceptBooking = acceptBooking;
/**
 * PATCH /api/bookings/:id/decline
 * Worker declines (rejects) booking — reverts to PENDING so client can re-assign
 *
 * NOTE: Schema has no DECLINED status; REJECTED is used here, but since we
 * immediately revert back to PENDING, the booking is returned to the client
 * in a re-assignable state.
 */
const declineBooking = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'WORKER') {
            return res.status(403).json((0, errorResponse_1.errorResponse)(403, 'Only workers can decline bookings'));
        }
        const id = req.params.id;
        const { reason } = req.body;
        const booking = await database_1.default.booking.findUnique({
            where: { id },
        });
        if (!booking) {
            return res.status(404).json((0, errorResponse_1.errorResponse)(404, 'Booking not found'));
        }
        if (booking.workerId !== req.user.userId) {
            return res.status(403).json((0, errorResponse_1.errorResponse)(403, 'This booking is not assigned to you'));
        }
        // Only PENDING bookings can be declined by a worker
        if (booking.status !== 'PENDING') {
            return res.status(409).json((0, errorResponse_1.errorResponse)(409, `Cannot decline booking with status ${booking.status}`));
        }
        // Set to REJECTED momentarily, then back to PENDING so client can re-assign
        await database_1.default.booking.update({
            where: { id },
            data: { status: 'REJECTED', notes: reason }, // schema has no cancelReason; storing in notes
        });
        // Revert to PENDING so client can re-assign
        const updated = await database_1.default.booking.update({
            where: { id },
            data: { status: 'PENDING' },
        });
        // Notify client
        await (0, notify_1.notifyUser)({
            userId: updated.clientId,
            type: 'BOOKING_REJECTED',
            title: 'Booking Declined',
            message: 'The worker has declined your booking request',
            relatedId: id,
        });
        return res.status(200).json({
            success: true,
            message: 'Booking declined successfully',
            data: {
                id: updated.id,
                status: 'PENDING',
            },
        });
    }
    catch (error) {
        console.error('Error declining booking:', error);
        return res.status(500).json((0, errorResponse_1.errorResponse)(500, 'Failed to decline booking'));
    }
};
exports.declineBooking = declineBooking;
/**
 * PATCH /api/bookings/:id/start
 * Worker marks booking as in progress
 */
const startBooking = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'WORKER') {
            return res.status(403).json((0, errorResponse_1.errorResponse)(403, 'Only workers can start bookings'));
        }
        const id = req.params.id;
        const booking = await database_1.default.booking.findUnique({
            where: { id },
        });
        if (!booking) {
            return res.status(404).json((0, errorResponse_1.errorResponse)(404, 'Booking not found'));
        }
        if (booking.workerId !== req.user.userId) {
            return res.status(403).json((0, errorResponse_1.errorResponse)(403, 'This booking is not assigned to you'));
        }
        if (!isValidTransition(booking.status, 'IN_PROGRESS')) {
            return res.status(409).json((0, errorResponse_1.errorResponse)(409, `Cannot start booking with status ${booking.status}`));
        }
        // NOTE: schema has no `startedAt` field; we record the state change via updatedAt automatically
        const updated = await database_1.default.booking.update({
            where: { id },
            data: { status: 'IN_PROGRESS' },
        });
        // Notify client
        await (0, notify_1.notifyUser)({
            userId: updated.clientId,
            // No BOOKING_STARTED in schema; BOOKING_ACCEPTED is the closest available
            type: 'BOOKING_ACCEPTED',
            title: 'Service Started',
            message: 'The worker has started your service',
            relatedId: id,
        });
        return res.status(200).json({
            success: true,
            message: 'Booking started successfully',
            data: {
                id: updated.id,
                status: updated.status,
                startedAt: updated.updatedAt, // use updatedAt as proxy since startedAt doesn't exist
            },
        });
    }
    catch (error) {
        console.error('Error starting booking:', error);
        return res.status(500).json((0, errorResponse_1.errorResponse)(500, 'Failed to start booking'));
    }
};
exports.startBooking = startBooking;
/**
 * POST /api/bookings/:id/quote
 * Worker submits labor/materials quote
 * Quote data is stored inline on the Booking model (no separate Quote table in schema)
 */
const submitQuote = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'WORKER') {
            return res.status(403).json((0, errorResponse_1.errorResponse)(403, 'Only workers can submit quotes'));
        }
        const id = req.params.id;
        const { laborCost, materialsCost, notes } = req.body;
        const booking = await database_1.default.booking.findUnique({
            where: { id },
        });
        if (!booking) {
            return res.status(404).json((0, errorResponse_1.errorResponse)(404, 'Booking not found'));
        }
        if (booking.workerId !== req.user.userId) {
            return res.status(403).json((0, errorResponse_1.errorResponse)(403, 'This booking is not assigned to you'));
        }
        if (!isValidTransition(booking.status, 'QUOTE_SUBMITTED')) {
            return res.status(409).json((0, errorResponse_1.errorResponse)(409, `Cannot submit quote for booking with status ${booking.status}`));
        }
        // Quote fields live directly on Booking — no separate Quote model in schema
        const updated = await database_1.default.booking.update({
            where: { id },
            data: {
                laborCost,
                materialsCost,
                quoteNotes: notes,
                quoteStatus: 'SUBMITTED',
                quotedAt: new Date(),
                status: 'QUOTE_SUBMITTED',
            },
        });
        // Notify client
        await (0, notify_1.notifyUser)({
            userId: booking.clientId,
            type: 'QUOTE_SUBMITTED',
            title: 'Quote Submitted',
            message: 'Worker has submitted a quote for your booking',
            relatedId: id,
        });
        return res.status(201).json({
            success: true,
            message: 'Quote submitted successfully',
            data: {
                id: updated.id,
                laborCost: updated.laborCost,
                materialsCost: updated.materialsCost,
                totalCost: (updated.laborCost ?? 0) + (updated.materialsCost ?? 0),
                notes: updated.quoteNotes,
            },
        });
    }
    catch (error) {
        console.error('Error submitting quote:', error);
        return res.status(500).json((0, errorResponse_1.errorResponse)(500, 'Failed to submit quote'));
    }
};
exports.submitQuote = submitQuote;
/**
 * PATCH /api/bookings/:id/quote/approve
 * Client approves quote
 */
const approveQuote = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'CLIENT') {
            return res.status(403).json((0, errorResponse_1.errorResponse)(403, 'Only clients can approve quotes'));
        }
        const id = req.params.id;
        const booking = await database_1.default.booking.findUnique({
            where: { id },
        });
        if (!booking) {
            return res.status(404).json((0, errorResponse_1.errorResponse)(404, 'Booking not found'));
        }
        if (booking.clientId !== req.user.userId) {
            return res.status(403).json((0, errorResponse_1.errorResponse)(403, 'This booking is not yours'));
        }
        if (booking.laborCost == null || booking.materialsCost == null) {
            return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'No quote exists for this booking'));
        }
        if (!isValidTransition(booking.status, 'QUOTE_APPROVED')) {
            return res.status(409).json((0, errorResponse_1.errorResponse)(409, `Cannot approve quote for booking with status ${booking.status}`));
        }
        const updated = await database_1.default.booking.update({
            where: { id },
            data: {
                status: 'QUOTE_APPROVED',
                quoteStatus: 'APPROVED',
                approvedAt: new Date(),
                finalPrice: booking.laborCost + booking.materialsCost,
            },
        });
        // Notify worker (workerId is nullable on Booking — skip if unassigned)
        if (booking.workerId) {
            await (0, notify_1.notifyUser)({
                userId: booking.workerId,
                type: 'QUOTE_APPROVED',
                title: 'Quote Approved',
                message: 'Client has approved your quote',
                relatedId: id,
            });
        }
        return res.status(200).json({
            success: true,
            message: 'Quote approved successfully',
            data: {
                id: updated.id,
                status: updated.status,
                finalPrice: updated.finalPrice,
            },
        });
    }
    catch (error) {
        console.error('Error approving quote:', error);
        return res.status(500).json((0, errorResponse_1.errorResponse)(500, 'Failed to approve quote'));
    }
};
exports.approveQuote = approveQuote;
/**
 * PATCH /api/bookings/:id/quote/dispute
 * Client disputes quote and stores reason
 * Schema uses DISPUTED (not QUOTE_DISPUTED) as the BookingStatus value
 */
const disputeQuote = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'CLIENT') {
            return res.status(403).json((0, errorResponse_1.errorResponse)(403, 'Only clients can dispute quotes'));
        }
        const id = req.params.id;
        const { reason } = req.body;
        const booking = await database_1.default.booking.findUnique({
            where: { id },
        });
        if (!booking) {
            return res.status(404).json((0, errorResponse_1.errorResponse)(404, 'Booking not found'));
        }
        if (booking.clientId !== req.user.userId) {
            return res.status(403).json((0, errorResponse_1.errorResponse)(403, 'This booking is not yours'));
        }
        if (booking.laborCost == null || booking.materialsCost == null) {
            return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'No quote exists for this booking'));
        }
        // Schema status is DISPUTED (not QUOTE_DISPUTED)
        if (!isValidTransition(booking.status, 'DISPUTED')) {
            return res.status(409).json((0, errorResponse_1.errorResponse)(409, `Cannot dispute quote for booking with status ${booking.status}`));
        }
        const updated = await database_1.default.booking.update({
            where: { id },
            data: {
                status: 'DISPUTED',
                quoteStatus: 'DISPUTED',
                disputeReason: reason,
            },
        });
        // Notify worker (workerId is nullable on Booking — skip if unassigned)
        if (booking.workerId) {
            await (0, notify_1.notifyUser)({
                userId: booking.workerId,
                type: 'QUOTE_DISPUTED',
                title: 'Quote Disputed',
                message: `Client has disputed your quote: ${reason}`,
                relatedId: id,
            });
        }
        return res.status(200).json({
            success: true,
            message: 'Quote disputed successfully',
            data: {
                id: updated.id,
                status: updated.status,
                disputeReason: updated.disputeReason,
            },
        });
    }
    catch (error) {
        console.error('Error disputing quote:', error);
        return res.status(500).json((0, errorResponse_1.errorResponse)(500, 'Failed to dispute quote'));
    }
};
exports.disputeQuote = disputeQuote;
/**
 * PATCH /api/bookings/:id/complete
 * Complete booking (decrement activeJobCount in transaction)
 */
const completeBooking = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'WORKER') {
            return res.status(403).json((0, errorResponse_1.errorResponse)(403, 'Only workers can complete bookings'));
        }
        const id = req.params.id;
        const booking = await database_1.default.booking.findUnique({
            where: { id },
            include: { addOns: true },
        });
        if (!booking) {
            return res.status(404).json((0, errorResponse_1.errorResponse)(404, 'Booking not found'));
        }
        if (booking.workerId !== req.user.userId) {
            return res.status(403).json((0, errorResponse_1.errorResponse)(403, 'This booking is not assigned to you'));
        }
        if (!isValidTransition(booking.status, 'COMPLETED')) {
            return res.status(409).json((0, errorResponse_1.errorResponse)(409, `Cannot complete booking with status ${booking.status}`));
        }
        try {
            const result = await database_1.default.$transaction(async (tx) => {
                // addOns use `price` field per schema
                const addonsCost = (booking.addOns || []).reduce((sum, addon) => sum + addon.price, 0);
                const hasQuote = booking.laborCost != null && booking.materialsCost != null;
                const finalPrice = hasQuote
                    ? (booking.laborCost ?? 0) + (booking.materialsCost ?? 0) + addonsCost
                    : booking.estimatedPrice;
                // Update booking — schema has completionDate (not completedAt)
                const updated = await tx.booking.update({
                    where: { id },
                    data: {
                        status: 'COMPLETED',
                        finalPrice,
                        completionDate: new Date(),
                    },
                });
                // Decrement activeJobCount
                await tx.workerProfile.update({
                    where: { userId: booking.workerId },
                    data: { activeJobCount: { decrement: 1 } },
                });
                return updated;
            });
            // Notify client
            await (0, notify_1.notifyUser)({
                userId: booking.clientId,
                type: 'BOOKING_COMPLETED',
                title: 'Service Completed',
                message: 'The service has been completed',
                relatedId: id,
            });
            return res.status(200).json({
                success: true,
                message: 'Booking completed successfully',
                data: {
                    id: result.id,
                    status: result.status,
                    finalPrice: result.finalPrice,
                    completedAt: result.completionDate,
                },
            });
        }
        catch (txError) {
            throw txError;
        }
    }
    catch (error) {
        console.error('Error completing booking:', error);
        return res.status(500).json((0, errorResponse_1.errorResponse)(500, 'Failed to complete booking'));
    }
};
exports.completeBooking = completeBooking;
/**
 * PATCH /api/bookings/:id/cancel
 * Cancel booking (status-gated)
 */
const cancelBooking = async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json((0, errorResponse_1.errorResponse)(401, 'Not authenticated'));
        }
        const id = req.params.id;
        const { reason } = req.body;
        const booking = await database_1.default.booking.findUnique({
            where: { id },
        });
        if (!booking) {
            return res.status(404).json((0, errorResponse_1.errorResponse)(404, 'Booking not found'));
        }
        // Check ownership
        if (booking.clientId !== req.user.userId && booking.workerId !== req.user.userId) {
            return res.status(403).json((0, errorResponse_1.errorResponse)(403, 'You do not have permission to cancel this booking'));
        }
        if (!isValidTransition(booking.status, 'CANCELLED')) {
            return res.status(409).json((0, errorResponse_1.errorResponse)(409, `Cannot cancel booking with status ${booking.status}`));
        }
        // If worker is cancelling AFTER accepting, decrement activeJobCount
        if (booking.status === 'ACCEPTED' && booking.workerId === req.user.userId) {
            await database_1.default.workerProfile.update({
                where: { userId: booking.workerId },
                data: { activeJobCount: { decrement: 1 } },
            });
        }
        const updated = await database_1.default.booking.update({
            where: { id },
            data: {
                status: 'CANCELLED',
                notes: reason, // schema has no cancelReason; storing in notes
            },
        });
        // Notify the other party (workerId may be null if booking is unassigned)
        const notificationUserId = booking.clientId === req.user.userId ? booking.workerId : booking.clientId;
        if (notificationUserId) {
            await (0, notify_1.notifyUser)({
                userId: notificationUserId,
                // No BOOKING_CANCELLED in schema; BOOKING_REJECTED is the closest
                type: 'BOOKING_CANCELLED',
                title: 'Booking Cancelled',
                message: `Booking has been cancelled: ${reason}`,
                relatedId: id,
            });
        }
        return res.status(200).json({
            success: true,
            message: 'Booking cancelled successfully',
            data: {
                id: updated.id,
                status: updated.status,
            },
        });
    }
    catch (error) {
        console.error('Error cancelling booking:', error);
        return res.status(500).json((0, errorResponse_1.errorResponse)(500, 'Failed to cancel booking'));
    }
};
exports.cancelBooking = cancelBooking;
/**
 * PATCH /api/bookings/:id/reschedule
 * Reschedule booking to new date/time
 * NOTE: schema only has scheduledDate (no scheduledTime field)
 */
const rescheduleBooking = async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json((0, errorResponse_1.errorResponse)(401, 'Not authenticated'));
        }
        const id = req.params.id;
        const { newDate } = req.body;
        const booking = await database_1.default.booking.findUnique({
            where: { id },
        });
        if (!booking) {
            return res.status(404).json((0, errorResponse_1.errorResponse)(404, 'Booking not found'));
        }
        // Check ownership
        if (booking.clientId !== req.user.userId && booking.workerId !== req.user.userId) {
            return res.status(403).json((0, errorResponse_1.errorResponse)(403, 'You do not have permission to reschedule this booking'));
        }
        const updated = await database_1.default.booking.update({
            where: { id },
            data: {
                scheduledDate: new Date(newDate),
            },
        });
        // Notify the other party (workerId may be null if booking is unassigned)
        const notificationUserId = booking.clientId === req.user.userId ? booking.workerId : booking.clientId;
        if (notificationUserId) {
            await (0, notify_1.notifyUser)({
                userId: notificationUserId,
                // No BOOKING_RESCHEDULED in schema; BOOKING_ACCEPTED is closest
                type: 'BOOKING_RESCHEDULED',
                title: 'Booking Rescheduled',
                message: `Booking has been rescheduled to ${newDate}`,
                relatedId: id,
            });
        }
        return res.status(200).json({
            success: true,
            message: 'Booking rescheduled successfully',
            data: {
                id: updated.id,
                scheduledDate: updated.scheduledDate,
            },
        });
    }
    catch (error) {
        console.error('Error rescheduling booking:', error);
        return res.status(500).json((0, errorResponse_1.errorResponse)(500, 'Failed to reschedule booking'));
    }
};
exports.rescheduleBooking = rescheduleBooking;
/**
 * POST /api/bookings/:id/addons
 * Add scope-creep addon items mid-job
 * Schema model: BookingAddOn with fields: name, price (not title/description/cost)
 */
const addAddon = async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json((0, errorResponse_1.errorResponse)(401, 'Not authenticated'));
        }
        const id = req.params.id;
        const { name, price } = req.body;
        const booking = await database_1.default.booking.findUnique({
            where: { id },
        });
        if (!booking) {
            return res.status(404).json((0, errorResponse_1.errorResponse)(404, 'Booking not found'));
        }
        // Only worker can add addons
        if (booking.workerId !== req.user.userId) {
            return res.status(403).json((0, errorResponse_1.errorResponse)(403, 'Only assigned worker can add addons'));
        }
        // prisma client accessor is bookingAddOn (capital O)
        const addon = await database_1.default.bookingAddOn.create({
            data: {
                bookingId: id,
                name,
                price,
            },
        });
        // Notify client — no ADDON_ADDED type; use MESSAGE_RECEIVED as proxy
        await (0, notify_1.notifyUser)({
            userId: booking.clientId,
            type: 'ADDON_ADDED',
            title: 'Additional Service Added',
            message: `${name} has been added (₱${price})`,
            relatedId: id,
        });
        return res.status(201).json({
            success: true,
            message: 'Addon added successfully',
            data: addon,
        });
    }
    catch (error) {
        console.error('Error adding addon:', error);
        return res.status(500).json((0, errorResponse_1.errorResponse)(500, 'Failed to add addon'));
    }
};
exports.addAddon = addAddon;
/**
 * POST /api/bookings/:id/review
 * Submit rating and review after completion
 */
const submitReview = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'CLIENT') {
            return res.status(403).json((0, errorResponse_1.errorResponse)(403, 'Only clients can submit reviews'));
        }
        const id = req.params.id;
        const { rating, comment } = req.body;
        // `worker` on Booking is a User relation — include it directly (no nested `.user`)
        const booking = await database_1.default.booking.findUnique({
            where: { id },
            include: {
                worker: {
                    select: { id: true, fullName: true },
                },
            },
        });
        if (!booking) {
            return res.status(404).json((0, errorResponse_1.errorResponse)(404, 'Booking not found'));
        }
        if (booking.clientId !== req.user.userId) {
            return res.status(403).json((0, errorResponse_1.errorResponse)(403, 'This booking is not yours'));
        }
        if (booking.status !== 'COMPLETED') {
            return res.status(409).json((0, errorResponse_1.errorResponse)(409, 'Can only review completed bookings'));
        }
        // A completed booking must have an assigned worker, but workerId is
        // nullable on Booking — narrow it before using it as a lookup key.
        if (!booking.workerId) {
            return res.status(409).json((0, errorResponse_1.errorResponse)(409, 'Booking has no assigned worker'));
        }
        // Review model uses clientId (not reviewerId), and workerId references WorkerProfile.id
        // First resolve the WorkerProfile id from the worker's userId
        const workerProfile = await database_1.default.workerProfile.findUnique({
            where: { userId: booking.workerId },
            select: { id: true },
        });
        if (!workerProfile) {
            return res.status(404).json((0, errorResponse_1.errorResponse)(404, 'Worker profile not found'));
        }
        const review = await database_1.default.review.create({
            data: {
                bookingId: id,
                workerId: workerProfile.id, // WorkerProfile.id, not User.id
                clientId: req.user.userId,
                rating,
                comment,
            },
        });
        // Update worker's average rating
        const allReviews = await database_1.default.review.findMany({
            where: { workerId: workerProfile.id },
        });
        const avgRating = allReviews.reduce((sum, r) => sum + r.rating, 0) / allReviews.length;
        await database_1.default.workerProfile.update({
            where: { id: workerProfile.id },
            data: {
                rating: Math.round(avgRating * 10) / 10,
                totalReviews: allReviews.length,
            },
        });
        // Notify worker — use REVIEW_RECEIVED (not NEW_REVIEW)
        await (0, notify_1.notifyUser)({
            userId: booking.workerId,
            type: 'REVIEW_RECEIVED',
            title: 'New Review',
            message: `You received a ${rating}-star review`, // booking.client not included — avoid referencing it here
            relatedId: id,
        });
        return res.status(201).json({
            success: true,
            message: 'Review submitted successfully',
            data: {
                id: review.id,
                rating: review.rating,
                comment: review.comment,
                workerNewRating: avgRating,
            },
        });
    }
    catch (error) {
        console.error('Error submitting review:', error);
        return res.status(500).json((0, errorResponse_1.errorResponse)(500, 'Failed to submit review'));
    }
};
exports.submitReview = submitReview;
//# sourceMappingURL=bookingController.js.map