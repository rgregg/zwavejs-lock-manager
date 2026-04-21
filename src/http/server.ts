import Fastify, { type FastifyInstance } from "fastify";
import formbody from "@fastify/formbody";
import type { Store } from "../store/store.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerUsersRoutes } from "./routes/users.js";

export interface ServerDeps {
  store?: Store;
  onUsersChanged?: () => void;
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
  app.get("/", (_req, reply) => reply.redirect("/users"));
  return app;
}
