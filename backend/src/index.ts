import 'dotenv/config';
import http from 'http';
import app from './app';
import prisma from '@config/database';
import { initSocket } from './socket';
import { startVerificationWorker } from '@workers/verificationWorker';
import { startBookingWorker } from '@workers/bookingWorker';
import { startPayoutWorker } from '@workers/payoutWorker';
import { registerRepeatableBookingJobs } from '@queues/bookingQueue';
import { ensureStorageBuckets } from '@utils/ensureStorageBuckets';

const PORT = process.env.PORT || 3000;

// Defense-in-depth on top of the .on('error', ...) listeners already
// attached to every Queue/Worker we construct ourselves (bookingQueue.ts,
// payoutQueue.ts, verificationQueue.ts, and each start*Worker()) — BullMQ
// still has at least one more internal connection (confirmed via a live
// repro on 2026-09-03: killing local Redis crashed the process with an
// unhandled 'error' event even with all six of those listeners in place,
// recurring on a fixed interval independent of any request/shutdown
// signal — never fully traced to its exact source in BullMQ's internals).
// Only swallows errors that are specifically this app's configured Redis
// connection failing — anything else still crashes the process as normal,
// since resuming after a truly unknown uncaught exception risks running
// with corrupted state. A Redis outage should degrade background job
// scheduling, not take down the HTTP server serving unrelated
// Postgres-backed requests.
const REDIS_HOST = process.env.REDIS_HOST || '127.0.0.1';
const REDIS_PORT = Number(process.env.REDIS_PORT || 6379);
process.on('uncaughtException', (error: NodeJS.ErrnoException & { address?: string; port?: number }) => {
  const isConfiguredRedisConnectionError =
    error.syscall === 'connect' && error.address === REDIS_HOST && error.port === REDIS_PORT;
  if (isConfiguredRedisConnectionError) {
    console.error(`Unhandled Redis (${REDIS_HOST}:${REDIS_PORT}) connection error — server staying up:`, error.message);
    return;
  }
  console.error('Uncaught exception, exiting:', error);
  process.exit(1);
});

const startServer = async () => {
  try {
    // Test database connection
    await prisma.$connect();
    console.log('Database connected');

    const server = http.createServer(app);
    initSocket(server);

    server.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });

    startVerificationWorker().catch((error) => {
      console.error('Failed to start verification worker:', error);
    });

    startBookingWorker().catch((error) => {
      console.error('Failed to start booking worker:', error);
    });

    startPayoutWorker().catch((error) => {
      console.error('Failed to start payout worker:', error);
    });

    registerRepeatableBookingJobs().catch((error) => {
      console.error('Failed to register repeatable booking jobs:', error);
    });

    ensureStorageBuckets().catch((error) => {
      console.error('Failed to ensure storage buckets:', error);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

// Graceful shutdown
process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});