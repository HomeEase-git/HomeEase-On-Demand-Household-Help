// Local dev Redis with no Docker/WSL required.
//
// Spins up the same redis-memory-server binary the integration suite
// (tests/integration/queues.test.ts) already downloads and uses, bound to
// the port backend/.env expects (REDIS_PORT, default 6379) so `npm run dev`'s
// BullMQ queues/workers (bookingQueue, payoutQueue, verificationQueue) have
// a real Redis to talk to. Run this in its own terminal alongside `npm run dev`.
import "dotenv/config";
import { RedisMemoryServer } from "redis-memory-server";

const port = Number(process.env.REDIS_PORT || 6379);

async function main() {
  const server = new RedisMemoryServer({ instance: { port } });
  const host = await server.getHost();
  const boundPort = await server.getPort();
  console.log(`Dev Redis ready at ${host}:${boundPort} (Ctrl+C to stop)`);

  const shutdown = async () => {
    console.log("\nStopping dev Redis...");
    await server.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error("Failed to start dev Redis:", error);
  process.exit(1);
});
