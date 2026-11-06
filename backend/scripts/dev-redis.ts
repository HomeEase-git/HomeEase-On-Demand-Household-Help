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
