import 'dotenv/config';
import http from 'http';
import app from './app';
import prisma from '@config/database';
import { initSocket } from './socket';
import { startVerificationWorker } from '@workers/verificationWorker';
import { ensureStorageBuckets } from '@utils/ensureStorageBuckets';

const PORT = process.env.PORT || 3000;

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