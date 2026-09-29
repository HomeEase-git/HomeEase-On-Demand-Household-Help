import type { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { verifyToken } from '@utils/jwt';
import { isUserSessionRevoked, isSessionRevoked, setRevocationListener } from '@utils/tokenRevocation';

// Room holding one signed-in device's sockets, so revoking that session
// (log out, "log out other devices", refresh-token theft) can drop them.
const sessionRoom = (sessionId: string) => `session:${sessionId}`;

let io: Server | null = null;

const getAllowedOrigins = () =>
  (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

// Same checks as middleware/auth.ts: a real session token (not an MFA /
// login-code challenge token) that hasn't been revoked.
export const authenticateSocket = async (socket: Socket, next: (err?: Error) => void): Promise<void> => {
  try {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) {
      return next(new Error('No token provided'));
    }
    const decoded = verifyToken(token);
    if (decoded.type === 'mfa_pending' || decoded.type === 'otp_pending') {
      return next(new Error('Invalid or expired token'));
    }
    if ((await isUserSessionRevoked(decoded.userId)) || (decoded.sid && (await isSessionRevoked(decoded.sid)))) {
      return next(new Error('Your session has been revoked'));
    }
    socket.data.userId = decoded.userId;
    socket.data.sessionId = decoded.sid;
    next();
  } catch (error) {
    next(new Error('Invalid or expired token'));
  }
};

export const initSocket = (httpServer: HttpServer): Server => {
  io = new Server(httpServer, {
    cors: {
      origin: getAllowedOrigins(),
      credentials: true,
    },
  });

  io.use(authenticateSocket);

  setRevocationListener({
    onUserRevoked: (userId) => {
      io?.in(userId).disconnectSockets(true);
    },
    onSessionsRevoked: (sessionIds) => {
      io?.in(sessionIds.map(sessionRoom)).disconnectSockets(true);
    },
  });

  io.on('connection', (socket: Socket) => {
    const userId = socket.data.userId as string;
    socket.join(userId);
    const sessionId = socket.data.sessionId as string | undefined;
    if (sessionId) socket.join(sessionRoom(sessionId));

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
