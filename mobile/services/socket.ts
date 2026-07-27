import { io, Socket } from "socket.io-client";
import { config } from "../constants/config";

let socket: Socket | null = null;

export function connectSocket(token: string): Socket {
  if (socket) {
    if (socket.connected) return socket;
    socket.disconnect();
  }

  socket = io(config.API_URL, {
    auth: { token },
    transports: ["websocket"],
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
