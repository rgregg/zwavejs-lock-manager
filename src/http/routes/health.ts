import type { FastifyInstance } from "fastify";

export function registerHealthRoutes(app: FastifyInstance): void {
  app.get("/healthz", async (_req, reply) => {
    reply.type("text/plain");
    return "ok";
  });
}
