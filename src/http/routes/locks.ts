import type { FastifyInstance } from "fastify";
import type { LockConfig } from "../../config/schema.js";
import type { LockStateCache } from "../../cache/cache.js";
import type { Store } from "../../store/store.js";
import { renderLocksPage } from "../views/locks.js";
import { renderDriftPage } from "../views/drift.js";

interface LocksDeps {
  locks: readonly LockConfig[];
  cache: LockStateCache;
  store?: Store;
  readOnly?: boolean;
  onResync: (lockId: string) => void;
  onVerify: (lockId: string) => void;
  onDriftClear: (lockId: string) => void;
  onChange?: () => void;
}

export function registerLocksRoutes(app: FastifyInstance, deps: LocksDeps): void {
  const byId = new Map(deps.locks.map((l) => [l.id, l]));

  app.get("/locks", async (req, reply) => {
    reply.type("text/html");
    return renderLocksPage(deps.locks, (id) => deps.cache.getLock(id), {
      ...(deps.readOnly !== undefined ? { readOnly: deps.readOnly } : {}),
      basePath: req.basePath,
    });
  });

  app.get<{ Params: { id: string } }>("/locks/:id/drift", async (req, reply) => {
    const lock = byId.get(req.params.id);
    if (!lock) return reply.code(404).send("not found");
    reply.type("text/html");
    const users = deps.store?.listUsers() ?? [];
    return renderDriftPage(lock, deps.cache.getLock(req.params.id), users, {
      readOnly: deps.readOnly ?? false,
      basePath: req.basePath,
    });
  });

  app.post<{ Params: { id: string }; Body: { slot: string; name: string } }>(
    "/locks/:id/drift/adopt",
    async (req, reply) => {
      const lock = byId.get(req.params.id);
      if (!lock) return reply.code(404).send("not found");
      const slotNum = Number(req.body.slot);
      if (!Number.isInteger(slotNum) || slotNum < 1) {
        return reply.code(400).send("invalid slot");
      }
      const state = deps.cache.getLock(req.params.id);
      const slotState = state?.slots[String(slotNum)];
      if (!slotState?.drifted || slotState.status !== "enabled" || !slotState.pin) {
        return reply.code(400).send("slot is not a drifted enabled slot with a known pin");
      }
      if (!deps.store) {
        return reply.code(503).send("store not available");
      }
      const name = (req.body.name || "").trim() || `Slot ${slotNum} (adopted)`;
      const user = await deps.store.addUser({ name, pin: slotState.pin, slot: slotNum });
      await deps.cache.adoptSlot(req.params.id, slotNum, user.id);
      deps.onChange?.();
      reply.redirect(`${req.basePath}/locks/${req.params.id}/drift`);
    },
  );

  app.post<{ Params: { id: string } }>("/locks/:id/resync", async (req, reply) => {
    if (!byId.has(req.params.id)) return reply.code(404).send("not found");
    deps.onResync(req.params.id);
    reply.redirect(`${req.basePath}/locks`);
  });

  app.post<{ Params: { id: string } }>("/locks/:id/verify", async (req, reply) => {
    if (!byId.has(req.params.id)) return reply.code(404).send("not found");
    deps.onVerify(req.params.id);
    reply.redirect(`${req.basePath}/locks`);
  });

  app.post<{ Params: { id: string } }>("/locks/:id/drift/clear", async (req, reply) => {
    if (!byId.has(req.params.id)) return reply.code(404).send("not found");
    deps.onDriftClear(req.params.id);
    reply.redirect(`${req.basePath}/locks`);
  });
}
