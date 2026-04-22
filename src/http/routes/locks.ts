import type { FastifyInstance } from "fastify";
import type { LockConfig } from "../../config/schema.js";
import type { LockStateCache } from "../../cache/cache.js";
import { renderLocksPage } from "../views/locks.js";

interface LocksDeps {
  locks: readonly LockConfig[];
  cache: LockStateCache;
  onResync: (lockId: string) => void;
  onVerify: (lockId: string) => void;
  onDriftClear: (lockId: string) => void;
}

export function registerLocksRoutes(app: FastifyInstance, deps: LocksDeps): void {
  const byId = new Map(deps.locks.map((l) => [l.id, l]));

  app.get("/locks", async (_req, reply) => {
    reply.type("text/html");
    return renderLocksPage(deps.locks, (id) => deps.cache.getLock(id));
  });

  app.post<{ Params: { id: string } }>("/locks/:id/resync", async (req, reply) => {
    if (!byId.has(req.params.id)) return reply.code(404).send("not found");
    deps.onResync(req.params.id);
    reply.redirect("/locks");
  });

  app.post<{ Params: { id: string } }>("/locks/:id/verify", async (req, reply) => {
    if (!byId.has(req.params.id)) return reply.code(404).send("not found");
    deps.onVerify(req.params.id);
    reply.redirect("/locks");
  });

  app.post<{ Params: { id: string } }>("/locks/:id/drift/clear", async (req, reply) => {
    if (!byId.has(req.params.id)) return reply.code(404).send("not found");
    deps.onDriftClear(req.params.id);
    reply.redirect("/locks");
  });
}
