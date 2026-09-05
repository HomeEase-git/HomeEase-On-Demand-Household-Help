import 'dotenv/config';
import http from 'http';
import type { Server as SocketIOServer } from 'socket.io';
import type { Worker } from 'bullmq';
import app from './app';
import prisma from '@config/database';
import { initSocket } from './socket';
import { startVerificationWorker } from '@workers/verificationWorker';
import { startBookingWorker } from '@workers/bookingWorker';
import { startPayoutWorker } from '@workers/payoutWorker';
import { registerRepeatableBookingJobs, bookingQueue } from '@queues/bookingQueue';
import { payoutQueue } from '@queues/payoutQueue';
import { verificationQueue } from '@queues/verificationQueue';
import { ensureStorageBuckets } from '@utils/ensureStorageBuckets';

const PORT = process.env.PORT || 3000;
// How long to let in-flight requests / jobs finish on shutdown before the
// process is killed regardless. Keep it under the platform's own kill grace
// period (Kubernetes terminationGracePeriodSeconds, etc.).
const SHUTDOWN_TIMEOUT_MS = Number(process.env.SHUTDOWN_TIMEOUT_MS || 15_000);

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

let server: http.Server | undefined;
let io: SocketIOServer | undefined;
const workers: Worker[] = [];
let shuttingDown = false;

const startServer = async () => {
  try {
    // Test database connection
    await prisma.$connect();
    console.log('Database connected');

    server = http.createServer(app);
    io = initSocket(server);

    server.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });

    startVerificationWorker()
      .then((worker) => workers.push(worker))
      .catch((error) => console.error('Failed to start verification worker:', error));

    startBookingWorker()
      .then((worker) => workers.push(worker))
      .catch((error) => console.error('Failed to start booking worker:', error));

    startPayoutWorker()
      .then((worker) => workers.push(worker))
      .catch((error) => console.error('Failed to start payout worker:', error));

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

// Orchestrators (Docker, Kubernetes, Render, Railway, Fly…) send SIGTERM on
// deploy/scale-down and SIGINT on Ctrl+C. Both should drain rather than
// drop connections mid-request.
const shutdown = async (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received — draining (max ${SHUTDOWN_TIMEOUT_MS}ms)...`);

  const forceExit = setTimeout(() => {
    console.error('Drain timed out — forcing exit.');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  try {
    // 1. Stop taking new HTTP connections; close idle keep-alive sockets
    //    right away, let in-flight requests finish.
    if (server) {
      server.closeIdleConnections();
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
    // 2. Drop websockets.
    if (io) await io.close();
    // 3. Stop pulling new jobs and finish the ones running now.
    await Promise.allSettled(workers.map((w) => w.close()));
    // 4. Close the queue producer connections.
    await Promise.allSettled([bookingQueue.close(), payoutQueue.close(), verificationQueue.close()]);
    // 5. Release the DB pool.
    await prisma.$disconnect();
    clearTimeout(forceExit);
    console.log('Drain complete — exiting.');
    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

startServer();
