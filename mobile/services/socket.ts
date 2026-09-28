import { io, Socket } from "socket.io-client";
import { config } from "../constants/config";
import { authStorage } from "../utils/storage";
import { refreshSession } from "./api";

let socket: Socket | null = null;

export function connectSocket(): Socket {
  if (socket) {
    if (socket.connected) return socket;
    socket.disconnect();
  }

  // Read the token on every (re)connect: access tokens are short-lived and
  // get replaced by refreshSession while the socket stays up.
  socket = io(config.API_URL, {
    auth: (cb) => {
      authStorage.getToken().then((token) => cb({ token }));
    },
    transports: ["websocket"],
  });

  // The server rejects an expired token at the handshake, and socket.io
  // doesn't retry after that on its own — refresh once, then reconnect.
  let refreshedForThisAttempt = false;
  const current = socket;
  current.on("connect", () => {
    refreshedForThisAttempt = false;
  });
  current.on("connect_error", (error) => {
    if (error.message !== "Invalid or expired token" || refreshedForThisAttempt) return;
    refreshedForThisAttempt = true;
    refreshSession()
      .then((token) => {
        if (token && socket === current) current.connect();
      })
      .catch(() => undefined);
  });

  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}

export function getSocket(): Socket | null {
  return socket;
}
