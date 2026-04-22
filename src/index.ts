import { buildApp } from "./app.js";
import { createLogger } from "./util/logger.js";

const log = createLogger();
const dataDir = process.env.DATA_DIR ?? "/data";
const port = Number(process.env.PORT ?? 8080);

const app = await buildApp({
  dataDir,
  localSecret: process.env.LOCAL_SECRET ?? "", // empty string triggers error mode
  httpPort: port,
});
await app.start();
log.info({ port }, "listening");

const shutdown = async (sig: string): Promise<void> => {
  log.info({ sig }, "shutting down");
  await app.stop();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
