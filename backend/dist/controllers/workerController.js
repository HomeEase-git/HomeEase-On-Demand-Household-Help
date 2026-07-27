"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getWorkerCapacity = exports.addServiceTypes = exports.updateWorkerProfile = exports.updateAvailability = exports.getWorkerBlockedDates = exports.getWorkerAvailability = exports.getWorkerReviews = exports.getWorkerDetail = exports.searchWorkers = void 0;
const database_1 = __importDefault(require("@config/database"));
const errorResponse_1 = require("@utils/errorResponse");
/**
 * GET /api/workers
 * Search/list workers with filters
 * Query params: category, minRating, maxPrice, page, limit
 */
const searchWorkers = async (req, res) => {
    try {
        const { category, minRating, maxPrice, page = '1', limit = '10' } = req.query;
        const pageNum = Math.max(1, parseInt(page) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 10));
        const skip = (pageNum - 1) * limitNum;
        const whereClause = {
            isAvailable: true,
        };
        // Filter by service category if provided
        if (category && typeof category === 'string') {
            whereClause.serviceTypes = {
                some: {
                    name: {
                        contains: category,
                        mode: 'insensitive',
                    },
                },
            };
        }
        // Filter by minimum rating if provided
        if (minRating) {
            const rating = parseFloat(minRating);
            if (!isNaN(rating)) {
                whereClause.rating = { gte: rating };
            }
        }
        // Filter by max base price — price lives on ServiceType, not WorkerProfile
        if (maxPrice) {
            const price = parseFloat(maxPrice);
            if (!isNaN(price)) {
                whereClause.serviceTypes = {
                    some: {
                        ...(whereClause.serviceTypes?.some || {}),
                        basePrice: { lte: price },
                    },
                };
            }
        }
        const [workers, total] = await Promise.all([
            database_1.default.workerProfile.findMany({
                where: whereClause,
                include: {
                    user: {
                        select: {
                            id: true,
                            fullName: true,
                            email: true,
                            avatar: true, // was: profileImage (field is `avatar` in schema)
                        },
                    },
                    serviceTypes: true,
                    reviews: {
                        take: 3,
                        orderBy: { createdAt: 'desc' },
                    },
                },
                skip,
                take: limitNum,
                orderBy: { rating: 'desc' },
            }),
            database_1.default.workerProfile.count({ where: whereClause }),
        ]);
        const formattedWorkers = workers.map((worker) => ({
            id: worker.userId,
            name: worker.user.fullName,
            service: worker.serviceTypes[0]?.name || 'General Service',
            rating: worker.rating,
            reviews: worker.reviews.length,
            basePrice: worker.serviceTypes[0]?.basePrice ?? null, // was: worker.hourlyRate (doesn't exist)
            status: worker.isAvailable ? 'AVAILABLE' : 'BUSY',
            avatar: worker.user.avatar, // was: profileImage
        }));
        return res.status(200).json({
            success: true,
            message: 'Workers retrieved successfully',
            data: {
                workers: formattedWorkers,
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
        console.error('Error searching workers:', error);
        return res.status(500).json((0, errorResponse_1.errorResponse)(500, 'Failed to search workers'));
    }
};
exports.searchWorkers = searchWorkers;
/**
 * GET /api/workers/:workerId
 * Get detailed worker profile including ResumeParseResult fields
 */
const getWorkerDetail = async (req, res) => {
    try {
        const workerId = req.params.workerId;
        const worker = await database_1.default.workerProfile.findUnique({
            where: { userId: workerId },
            select: {
                id: true,
                userId: true,
                bio: true,
                rating: true,
                totalReviews: true,
                isAvailable: true,
                serviceAreaRadius: true,
                activeJobCount: true,
                availableDays: true,
                address: true,
                city: true,
                state: true,
                zipCode: true,
                kycStatus: true,
                kycSubmittedAt: true,
                kycApprovedAt: true,
                resumeUrl: true,
                maxConcurrentJobs: true,
                user: {
                    select: {
                        id: true,
                        fullName: true,
                        email: true,
                        phone: true,
                        avatar: true,
                    },
                },
                serviceTypes: true,
                reviews: {
                    orderBy: { createdAt: 'desc' },
                },
                certifications: true,
                resumeParseResult: true,
            },
        });
        if (!worker) {
            return res.status(404).json((0, errorResponse_1.errorResponse)(404, 'Worker not found'));
        }
        return res.status(200).json({
            success: true,
            message: 'Worker details retrieved successfully',
            data: {
                id: worker.userId,
                name: worker.user.fullName,
                email: worker.user.email,
                phone: worker.user.phone,
                avatar: worker.user.avatar,
                bio: worker.bio,
                rating: worker.rating,
                serviceAreaRadius: worker.serviceAreaRadius,
                address: worker.address,
                city: worker.city,
                state: worker.state,
                zipCode: worker.zipCode,
                isAvailable: worker.isAvailable,
                availableDays: worker.availableDays,
                kycStatus: worker.kycStatus,
                kycSubmittedAt: worker.kycSubmittedAt,
                kycApprovedAt: worker.kycApprovedAt,
                resumeUrl: worker.resumeUrl,
                // Nested relations matching Prisma schema
                resumeParseResult: worker.resumeParseResult,
                certifications: worker.certifications,
                services: worker.serviceTypes,
                verificationStatus: worker.kycStatus === 'APPROVED' ? 'VERIFIED' : 'PENDING',
                reviewCount: worker.reviews.length,
                activeJobCount: worker.activeJobCount,
                maxConcurrentJobs: worker.maxConcurrentJobs,
            },
        });
    }
    catch (error) {
        console.error('Error fetching worker detail:', error);
        return res.status(500).json((0, errorResponse_1.errorResponse)(500, 'Failed to fetch worker details'));
    }
};
exports.getWorkerDetail = getWorkerDetail;
/**
 * GET /api/workers/:workerId/reviews
 * Get paginated reviews for a worker
 */
const getWorkerReviews = async (req, res) => {
    try {
        const workerId = req.params.workerId;
        const { page = '1', limit = '10' } = req.query;
        const pageNum = Math.max(1, parseInt(page) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 10));
        const skip = (pageNum - 1) * limitNum;
        // Check if worker exists — workerId param is the User.id (userId on WorkerProfile)
        const workerProfile = await database_1.default.workerProfile.findUnique({
            where: { userId: workerId },
            select: { id: true },
        });
        if (!workerProfile) {
            return res.status(404).json((0, errorResponse_1.errorResponse)(404, 'Worker not found'));
        }
        // Review.workerId references WorkerProfile.id, not User.id
        const [reviews, total] = await Promise.all([
            database_1.default.review.findMany({
                where: { workerId: workerProfile.id },
                include: {
                    booking: {
                        select: {
                            id: true,
                            serviceTask: {
                                select: { name: true },
                            },
                        },
                    },
                    client: {
                        select: {
                            id: true,
                            fullName: true,
                            avatar: true, // was: profileImage
                        },
                    },
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take: limitNum,
            }),
            database_1.default.review.count({ where: { workerId: workerProfile.id } }),
        ]);
        const formattedReviews = reviews.map((review) => ({
            id: review.id,
            rating: review.rating,
            comment: review.comment,
            reviewer: {
                id: review.client.id,
                name: review.client.fullName,
                avatar: review.client.avatar,
            },
            serviceType: review.booking?.serviceTask?.name || 'Service',
            // Added so the frontend can link "view booking" from a review without
            // fabricating an id — booking was already fetched above, just wasn't
            // surfaced in the formatted output.
            bookingId: review.booking?.id ?? null,
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
    }
    catch (error) {
        console.error('Error fetching worker reviews:', error);
        return res.status(500).json((0, errorResponse_1.errorResponse)(500, 'Failed to fetch reviews'));
    }
};
exports.getWorkerReviews = getWorkerReviews;
/**
 * GET /api/workers/:workerId/availability?date=YYYY-MM-DD
 * Returns the booked time slots for a worker on a specific date, so the
 * client's booking calendar can disable them.
 */
const getWorkerAvailability = async (req, res) => {
    try {
        const workerId = req.params.workerId;
        const { date } = req.query;
        if (!date || typeof date !== 'string') {
            return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'date query parameter is required'));
        }
        const dayStart = new Date(`${date}T00:00:00.000Z`);
        const dayEnd = new Date(`${date}T23:59:59.999Z`);
        const bookings = await database_1.default.booking.findMany({
            where: {
                workerId,
                scheduledDate: { gte: dayStart, lte: dayEnd },
                status: { notIn: ['CANCELLED', 'REJECTED'] },
            },
            select: { scheduledTime: true },
        });
        const occupied = bookings
            .map((b) => b.scheduledTime)
            .filter((t) => !!t);
        return res.status(200).json({
            success: true,
            message: 'Worker availability retrieved successfully',
            data: { occupied },
        });
    }
    catch (error) {
        console.error('Error fetching worker availability:', error);
        return res.status(500).json((0, errorResponse_1.errorResponse)(500, 'Failed to fetch worker availability'));
    }
};
exports.getWorkerAvailability = getWorkerAvailability;
/**
 * GET /api/workers/:workerId/blocked-dates
 * Returns dates (within the next 90 days, matching the client calendar's
 * booking window) where the worker already has at least one active booking.
 */
const getWorkerBlockedDates = async (req, res) => {
    try {
        const workerId = req.params.workerId;
        const today = new Date();
        today.setUTCHours(0, 0, 0, 0);
        const horizon = new Date(today);
        horizon.setUTCDate(horizon.getUTCDate() + 90);
        const bookings = await database_1.default.booking.findMany({
            where: {
                workerId,
                scheduledDate: { gte: today, lte: horizon },
                status: { notIn: ['CANCELLED', 'REJECTED'] },
            },
            select: { scheduledDate: true },
        });
        const dates = Array.from(new Set(bookings.map((b) => b.scheduledDate.toISOString().slice(0, 10))));
        return res.status(200).json({
            success: true,
            message: 'Worker blocked dates retrieved successfully',
            data: { dates },
        });
    }
    catch (error) {
        console.error('Error fetching worker blocked dates:', error);
        return res.status(500).json((0, errorResponse_1.errorResponse)(500, 'Failed to fetch worker blocked dates'));
    }
};
exports.getWorkerBlockedDates = getWorkerBlockedDates;
/**
 * PATCH /api/workers/me/availability
 * Toggle isAvailable and set availableDays (worker only)
 */
const updateAvailability = async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json((0, errorResponse_1.errorResponse)(401, 'Not authenticated'));
        }
        const { isAvailable, availableDays } = req.body;
        const updated = await database_1.default.workerProfile.update({
            where: { userId: req.user.userId },
            data: {
                isAvailable,
                availableDays: availableDays || undefined,
            },
        });
        return res.status(200).json({
            success: true,
            message: 'Availability updated successfully',
            data: {
                isAvailable: updated.isAvailable,
                availableDays: updated.availableDays,
            },
        });
    }
    catch (error) {
        console.error('Error updating availability:', error);
        return res.status(500).json((0, errorResponse_1.errorResponse)(500, 'Failed to update availability'));
    }
};
exports.updateAvailability = updateAvailability;
/**
 * PATCH /api/workers/me/profile
 * Update worker profile fields (worker only)
 */
const updateWorkerProfile = async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json((0, errorResponse_1.errorResponse)(401, 'Not authenticated'));
        }
        const { bio, serviceAreaRadius, address, city, state, zipCode, kycStatus, kycSubmittedAt, kycApprovedAt, resumeUrl, } = req.body;
        const updateData = {};
        if (bio !== undefined)
            updateData.bio = bio;
        if (serviceAreaRadius !== undefined)
            updateData.serviceAreaRadius = serviceAreaRadius;
        if (address !== undefined)
            updateData.address = address;
        if (city !== undefined)
            updateData.city = city;
        if (state !== undefined)
            updateData.state = state;
        if (zipCode !== undefined)
            updateData.zipCode = zipCode;
        if (kycStatus !== undefined)
            updateData.kycStatus = kycStatus;
        if (kycSubmittedAt !== undefined)
            updateData.kycSubmittedAt = kycSubmittedAt;
        if (kycApprovedAt !== undefined)
            updateData.kycApprovedAt = kycApprovedAt;
        if (resumeUrl !== undefined)
            updateData.resumeUrl = resumeUrl;
        const updated = await database_1.default.workerProfile.update({
            where: { userId: req.user.userId },
            data: updateData,
        });
        return res.status(200).json({
            success: true,
            message: 'Profile updated successfully',
            data: {
                bio: updated.bio,
                serviceAreaRadius: updated.serviceAreaRadius,
                address: updated.address,
                city: updated.city,
                state: updated.state,
                zipCode: updated.zipCode,
                kycStatus: updated.kycStatus,
                kycSubmittedAt: updated.kycSubmittedAt,
                kycApprovedAt: updated.kycApprovedAt,
                resumeUrl: updated.resumeUrl,
            },
        });
    }
    catch (error) {
        console.error('Error updating worker profile:', error);
        return res.status(500).json((0, errorResponse_1.errorResponse)(500, 'Failed to update profile'));
    }
};
exports.updateWorkerProfile = updateWorkerProfile;
/**
 * POST /api/workers/me/service-types
 * Attach ServiceType(s) to worker (worker only)
 */
const addServiceTypes = async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json((0, errorResponse_1.errorResponse)(401, 'Not authenticated'));
        }
        const { serviceTypeIds } = req.body;
        // Verify all service types exist
        const serviceTypes = await database_1.default.serviceType.findMany({
            where: { id: { in: serviceTypeIds } },
        });
        if (serviceTypes.length !== serviceTypeIds.length) {
            return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'One or more service types do not exist'));
        }
        // Connect service types to worker
        const updated = await database_1.default.workerProfile.update({
            where: { userId: req.user.userId },
            data: {
                serviceTypes: {
                    connect: serviceTypeIds.map((id) => ({ id })),
                },
            },
            include: { serviceTypes: true },
        });
        return res.status(200).json({
            success: true,
            message: 'Service types added successfully',
            data: { serviceTypes: updated.serviceTypes },
        });
    }
    catch (error) {
        console.error('Error adding service types:', error);
        return res.status(500).json((0, errorResponse_1.errorResponse)(500, 'Failed to add service types'));
    }
};
exports.addServiceTypes = addServiceTypes;
/**
 * GET /api/workers/me/capacity
 * Get worker capacity info (worker only)
 */
const getWorkerCapacity = async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json((0, errorResponse_1.errorResponse)(401, 'Not authenticated'));
        }
        const worker = await database_1.default.workerProfile.findUnique({
            where: { userId: req.user.userId },
            select: {
                activeJobCount: true,
                maxConcurrentJobs: true,
            },
        });
        if (!worker) {
            return res.status(404).json((0, errorResponse_1.errorResponse)(404, 'Worker profile not found'));
        }
        const availableSlots = worker.maxConcurrentJobs - worker.activeJobCount;
        return res.status(200).json({
            success: true,
            message: 'Capacity retrieved successfully',
            data: {
                activeJobCount: worker.activeJobCount,
                maxConcurrentJobs: worker.maxConcurrentJobs,
                availableSlots: Math.max(0, availableSlots),
                isAtCapacity: availableSlots <= 0,
            },
        });
    }
    catch (error) {
        console.error('Error fetching worker capacity:', error);
        return res.status(500).json((0, errorResponse_1.errorResponse)(500, 'Failed to fetch capacity'));
    }
};
exports.getWorkerCapacity = getWorkerCapacity;
//# sourceMappingURL=workerController.js.map