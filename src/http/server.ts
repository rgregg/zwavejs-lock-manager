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

// Matches the start of an absolute internal link in HTML attributes we emit:
// href, action, and the htmx request attributes. Protocol-relative URLs (//host)
// are excluded so external assets are left alone.
const INGRESS_LINK_RE = /\b(href|action|hx-get|hx-post|hx-put|hx-patch|hx-delete)="\/(?!\/)/g;

/**
 * Behind Home Assistant Ingress the app is served under a per-session prefix
 * (e.g. /api/hassio_ingress/<token>) advertised via the `X-Ingress-Path` header.
 * Absolute links we emit (/users, /status, form actions, hx-* targets) would
 * otherwise escape that prefix. This hook rewrites them — and any redirect
 * Location — to stay inside the ingress path. It is a no-op when the header is
 * absent, so standalone/docker-compose deployments are unaffected.
 */
export function registerIngressRewrite(app: FastifyInstance): void {
  app.addHook("onSend", (req, reply, payload, done) => {
    const ingressPath = req.headers["x-ingress-path"];
    if (typeof ingressPath !== "string" || ingressPath === "") {
      done(null, payload);
      return;
    }
    const location = reply.getHeader("location");
    if (typeof location === "string" && location.startsWith("/") && !location.startsWith("//")) {
      reply.header("location", ingressPath + location);
    }
    const contentType = reply.getHeader("content-type");
    if (
      typeof payload === "string" &&
      typeof contentType === "string" &&
      contentType.includes("text/html")
    ) {
      done(null, payload.replace(INGRESS_LINK_RE, `$1="${ingressPath}/`));
      return;
    }
    done(null, payload);
  });
}

export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  app.register(formbody);
  registerIngressRewrite(app);
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
      ...(deps.store ? { store: deps.store } : {}),
      ...(deps.readOnly !== undefined ? { readOnly: deps.readOnly } : {}),
      onResync: deps.onResync ?? (() => undefined),
      onVerify: deps.onVerify ?? (() => undefined),
      onDriftClear: deps.onDriftClear ?? (() => undefined),
      ...(deps.onUsersChanged ? { onChange: deps.onUsersChanged } : {}),
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
  registerIngressRewrite(app);
  registerHealthRoutes(app);
  const html = renderConfigErrorPage(message);
  app.setNotFoundHandler((_req, reply) => {
    void reply.code(200).type("text/html").send(html);
  });
  return app;
}
