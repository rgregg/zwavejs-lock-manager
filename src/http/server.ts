import Fastify, { type FastifyInstance } from "fastify";
import formbody from "@fastify/formbody";
import type { Store } from "../store/store.js";
import type { LockStateCache } from "../cache/cache.js";
import type { LockConfig } from "../config/schema.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerUsersRoutes } from "./routes/users.js";
import { registerLocksRoutes } from "./routes/locks.js";

export interface ServerDeps {
  store?: Store;
  cache?: LockStateCache;
  locks?: readonly LockConfig[];
  onUsersChanged?: () => void;
  onResync?: (lockId: string) => void;
  onVerify?: (lockId: string) => void;
}

export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  app.register(formbody);
  registerHealthRoutes(app);
  if (deps.store) {
    registerUsersRoutes(app, {
      store: deps.store,
      onChange: deps.onUsersChanged ?? (() => undefined),
    });
  }
  if (deps.locks && deps.cache) {
    registerLocksRoutes(app, {
      locks: deps.locks,
      cache: deps.cache,
      onResync: deps.onResync ?? (() => undefined),
      onVerify: deps.onVerify ?? (() => undefined),
    });
  }
  app.get("/", (_req, reply) => reply.redirect("/users"));
  return app;
}
