import Fastify, { type FastifyInstance } from "fastify";
import formbody from "@fastify/formbody";
import type { Store } from "../store/store.js";
import type { LockStateCache } from "../cache/cache.js";
import type { LockConfig } from "../config/schema.js";
import type { EventLog } from "../log/event-log.js";
import type { EventBus } from "../events/bus.js";
import type { ConnectionStatusTracker } from "./status.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerUsersRoutes } from "./routes/users.js";
import { registerLocksRoutes } from "./routes/locks.js";
import { registerEventsRoutes } from "./routes/events.js";
import { renderConfigErrorPage } from "./views/config-error.js";
import { renderStatusPartial } from "./views/status.js";

export interface ServerDeps {
  store?: Store;
  cache?: LockStateCache;
  locks?: readonly LockConfig[];
  eventLog?: EventLog;
  bus?: EventBus;
  status?: ConnectionStatusTracker;
  readOnly?: boolean;
  onUsersChanged?: () => void;
  onResync?: (lockId: string) => void;
  onVerify?: (lockId: string) => void;
  onDriftClear?: (lockId: string) => void;
}

export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  app.register(formbody);
  registerHealthRoutes(app);
  if (deps.store) {
    registerUsersRoutes(app, {
      store: deps.store,
      ...(deps.readOnly !== undefined ? { readOnly: deps.readOnly } : {}),
      onChange: deps.onUsersChanged ?? (() => undefined),
    });
  }
  if (deps.locks && deps.cache) {
    registerLocksRoutes(app, {
      locks: deps.locks,
      cache: deps.cache,
      ...(deps.readOnly !== undefined ? { readOnly: deps.readOnly } : {}),
      onResync: deps.onResync ?? (() => undefined),
      onVerify: deps.onVerify ?? (() => undefined),
      onDriftClear: deps.onDriftClear ?? (() => undefined),
    });
  }
  if (deps.eventLog && deps.bus) {
    registerEventsRoutes(app, {
      eventLog: deps.eventLog,
      bus: deps.bus,
      ...(deps.readOnly !== undefined ? { readOnly: deps.readOnly } : {}),
    });
  }
  if (deps.status) {
    const statusTracker = deps.status;
    app.get("/status", (_req, reply) => {
      reply.type("text/html");
      return renderStatusPartial(statusTracker.get());
    });
  }
  app.get("/", (_req, reply) => reply.redirect("/users"));
  return app;
}

export function buildErrorServer(message: string): FastifyInstance {
  const app = Fastify({ logger: false });
  registerHealthRoutes(app);
  const html = renderConfigErrorPage(message);
  app.setNotFoundHandler((_req, reply) => {
    void reply.code(200).type("text/html").send(html);
  });
  return app;
}
