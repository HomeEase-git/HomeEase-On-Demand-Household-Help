// Shared BullMQ connection options — used by both queues (bookingQueue,
// verificationQueue) and both workers (bookingWorker, verificationWorker) so
// Redis connection settings live in exactly one place.
export const redisConnection = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: Number(process.env.REDIS_PORT || 6379),
  password: process.env.REDIS_PASSWORD || undefined,
};
