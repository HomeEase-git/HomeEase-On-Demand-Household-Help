import 'dotenv/config';
import app from './app';
import prisma from '@config/database';

const PORT = process.env.PORT || 3000;

const startServer = async () => {
  try {
    // Test database connection
    await prisma.$connect();
    console.log('Database connected');

    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
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