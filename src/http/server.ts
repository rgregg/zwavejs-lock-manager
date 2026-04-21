import Fastify, { type FastifyInstance } from "fastify";
import formbody from "@fastify/formbody";
import { registerHealthRoutes } from "./routes/health.js";

export interface ServerDeps {
  // Populated by later tasks; intentionally minimal here.
}

export function buildServer(_deps: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  app.register(formbody);
  registerHealthRoutes(app);
  app.get("/", (_req, reply) => reply.redirect("/users"));
  return app;
}
