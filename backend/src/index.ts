import 'dotenv/config';
import { flushSentry } from './instrument';
import * as Sentry from '@sentry/node';
import { checkEnvironment } from '@config/envCheck';
import { checkDatabasePrivileges } from '@config/dbPrivilegeCheck';
import dns from 'node:dns';
import http from 'http';
import type { Server as SocketIOServer } from 'socket.io';
import type { Worker } from 'bullmq';
import app from './app';
import prisma from '@config/database';
import { initSocket } from './socket';
import { waitForSecurityAlerts } from '@services/securityAlertService';
import { startVerificationWorker } from '@workers/verificationWorker';
import { startBookingWorker } from '@workers/bookingWorker';
import { startPayoutWorker } from '@workers/payoutWorker';
import { registerRepeatableBookingJobs, bookingQueue } from '@queues/bookingQueue';
import { payoutQueue } from '@queues/payoutQueue';
import { verificationQueue } from '@queues/verificationQueue';
import { ensureStorageBuckets } from '@utils/ensureStorageBuckets';
import { redisHost, redisPort } from '@config/redis';

dns.setDefaultResultOrder('ipv4first');

const PORT = process.env.PORT || 3000;
const SHUTDOWN_TIMEOUT_MS = Number(process.env.SHUTDOWN_TIMEOUT_MS || 15_000);

const REDIS_HOST = redisHost;
const REDIS_PORT = redisPort;
process.on('uncaughtException', (error: NodeJS.ErrnoException & { address?: string; port?: number }) => {
  const isConfiguredRedisConnectionError =
    error.syscall === 'connect' && error.address === REDIS_HOST && error.port === REDIS_PORT;
  if (isConfiguredRedisConnectionError) {
    console.error(`Unhandled Redis (${REDIS_HOST}:${REDIS_PORT}) connection error — server staying up:`, error.message);
    return;
  }
  console.error('Uncaught exception, exiting:', error);
  void flushSentry().finally(() => process.exit(1));
});

let server: http.Server | undefined;
let io: SocketIOServer | undefined;
const workers: Worker[] = [];
let shuttingDown = false;

const startServer = async () => {
  if (process.env.NODE_ENV === 'production') {
    const { missingRequired, warnings } = checkEnvironment();
    if (missingRequired.length > 0) {
      console.error(`Refusing to start — missing required settings: ${missingRequired.join(', ')}`);
      await flushSentry();
      process.exit(1);
    }
    for (const warning of warnings) console.warn(`Config warning: ${warning}`);
    if (warnings.length > 0) {
      Sentry.captureMessage(`Production config: ${warnings.length} warning(s) — ${warnings.join(' | ')}`, 'warning');
    }
  }

  try {
    // Test database connection
    await prisma.$connect();
    console.log('Database connected');

    if (process.env.NODE_ENV === 'production') {
      checkDatabasePrivileges()
        .then((warnings) => {
          for (const warning of warnings) console.warn(`Config warning: ${warning}`);
          if (warnings.length > 0) Sentry.captureMessage(`Production config: ${warnings.join(' | ')}`, 'warning');
        })
        .catch((error) => console.error('Could not check database privileges:', error));
    }

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
    if (server) {
      server.closeIdleConnections();
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
    // 2. Drop websockets.
    if (io) await io.close();
    await Promise.allSettled(workers.map((w) => w.close()));
    // 4. Close the queue producer connections.
    await Promise.allSettled([bookingQueue.close(), payoutQueue.close(), verificationQueue.close()]);
    await waitForSecurityAlerts();
    // 6. Release the DB pool.
    await prisma.$disconnect();
    clearTimeout(forceExit);
    console.log('Drain complete — exiting.');
    await flushSentry();
    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

startServer();
