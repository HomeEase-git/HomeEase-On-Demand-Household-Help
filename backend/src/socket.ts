import type { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { verifyToken } from '@utils/jwt';

let io: Server | null = null;

const getAllowedOrigins = () =>
  (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

export const initSocket = (httpServer: HttpServer): Server => {
  io = new Server(httpServer, {
    cors: {
      origin: getAllowedOrigins(),
      credentials: true,
    },
  });

  io.use((socket: Socket, next) => {
    try {
      const token = socket.handshake.auth?.token as string | undefined;
      if (!token) {
        return next(new Error('No token provided'));
      }
      const decoded = verifyToken(token);
      socket.data.userId = decoded.userId;
      next();
    } catch (error) {
      next(new Error('Invalid or expired token'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const userId = socket.data.userId as string;
    socket.join(userId);

    socket.on('disconnect', () => {
      socket.leave(userId);
    });
  });

  return io;
};

export const getIO = (): Server => {
  if (!io) {
    throw new Error('Socket.IO has not been initialized');
  }
  return io;
};
