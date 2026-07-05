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
  /** Local secret for fingerprint-matching user PINs against lock slots. */
  secret?: string;
  onResync: (lockId: string) => void;
  onVerify: (lockId: string) => void;
  onDriftClear: (lockId: string) => void;
  onChange?: () => void;
}

export function registerLocksRoutes(app: FastifyInstance, deps: LocksDeps): void {
  const byId = new Map(deps.locks.map((l) => [l.id, l]));

  app.get("/locks", async (_req, reply) => {
    reply.type("text/html");
    return renderLocksPage(
      deps.locks,
      (id) => deps.cache.getLock(id),
      deps.readOnly !== undefined ? { readOnly: deps.readOnly } : undefined,
    );
  });

  app.get<{ Params: { id: string } }>("/locks/:id/drift", async (req, reply) => {
    const lock = byId.get(req.params.id);
    if (!lock) return reply.code(404).send("not found");
    reply.type("text/html");
    const users = deps.store?.listUsers() ?? [];
    return renderDriftPage(lock, deps.cache.getLock(req.params.id), users, deps.secret ?? "", {
      readOnly: deps.readOnly ?? false,
    });
  });

  /** Read a drifted enabled slot's PIN, or undefined if it isn't adoptable. */
  const adoptablePin = (lockId: string, slotNum: number): string | undefined => {
    const slotState = deps.cache.getLock(lockId)?.slots[String(slotNum)];
    if (slotState?.status !== "enabled" || !slotState.pin) return undefined;
    return slotState.pin;
  };

  const parseSlot = (raw: string): number | undefined => {
    const n = Number(raw);
    return Number.isInteger(n) && n >= 1 ? n : undefined;
  };

  // Adopt the code in its own slot as a new user. Safety-netted against a slot
  // conflict (the new UI steers occupied slots to replace / adopt-free instead).
  app.post<{ Params: { id: string }; Body: { slot: string; name: string } }>(
    "/locks/:id/drift/adopt",
    async (req, reply) => {
      const lock = byId.get(req.params.id);
      if (!lock) return reply.code(404).send("not found");
      const slotNum = parseSlot(req.body.slot);
      if (slotNum === undefined) return reply.code(400).send("invalid slot");
      const pin = adoptablePin(req.params.id, slotNum);
      if (!pin || !deps.cache.getLock(req.params.id)?.slots[String(slotNum)]?.drifted) {
        return reply.code(400).send("slot is not a drifted enabled slot with a known pin");
      }
      if (!deps.store) return reply.code(503).send("store not available");
      const name = (req.body.name || "").trim() || `Slot ${slotNum} (adopted)`;
      try {
        const user = await deps.store.addUser({ name, pin, slot: slotNum });
        await deps.cache.adoptSlot(req.params.id, slotNum, user.id);
      } catch {
        // Slot already held by a managed user — send them back to resolve it.
        return reply.redirect(`/locks/${req.params.id}/drift?err=slot-taken&slot=${slotNum}`);
      }
      deps.onChange?.();
      return reply.redirect(`/locks/${req.params.id}/drift`);
    },
  );

  // Replace the PIN of the user assigned to this slot with the lock's code.
  app.post<{ Params: { id: string }; Body: { slot: string } }>(
    "/locks/:id/drift/replace",
    async (req, reply) => {
      if (!byId.has(req.params.id)) return reply.code(404).send("not found");
      if (!deps.store) return reply.code(503).send("store not available");
      const slotNum = parseSlot(req.body.slot);
      if (slotNum === undefined) return reply.code(400).send("invalid slot");
      const pin = adoptablePin(req.params.id, slotNum);
      if (!pin) return reply.code(400).send("slot has no adoptable code");
      const assigned = deps.store.listUsers().find((u) => u.slot === slotNum);
      if (!assigned) return reply.code(400).send("no user assigned to this slot");
      await deps.store.updateUser(assigned.id, { pin });
      await deps.cache.adoptSlot(req.params.id, slotNum, assigned.id);
      deps.onChange?.();
      return reply.redirect(`/locks/${req.params.id}/drift`);
    },
  );

  // Adopt the code as a NEW user in the next free slot (leaving the occupied slot
  // for its existing user). The reconciler relocates the physical code when live.
  app.post<{ Params: { id: string }; Body: { slot: string } }>(
    "/locks/:id/drift/adopt-free",
    async (req, reply) => {
      if (!byId.has(req.params.id)) return reply.code(404).send("not found");
      if (!deps.store) return reply.code(503).send("store not available");
      const slotNum = parseSlot(req.body.slot);
      if (slotNum === undefined) return reply.code(400).send("invalid slot");
      const pin = adoptablePin(req.params.id, slotNum);
      if (!pin) return reply.code(400).send("slot has no adoptable code");
      try {
        await deps.store.addUser({ name: `Slot ${slotNum} (adopted)`, pin });
      } catch (err) {
        return reply.code(409).send((err as Error).message);
      }
      await deps.cache.clearSlotDrift(req.params.id, slotNum);
      deps.onChange?.();
      return reply.redirect(`/locks/${req.params.id}/drift`);
    },
  );

  // Re-assign a user to the slot where their PIN actually is (no lock write).
  app.post<{ Params: { id: string }; Body: { userId: string; toSlot: string } }>(
    "/locks/:id/drift/move",
    async (req, reply) => {
      const lock = byId.get(req.params.id);
      if (!lock) return reply.code(404).send("not found");
      if (!deps.store) return reply.code(503).send("store not available");
      const user = deps.store.getUser(req.body.userId);
      if (!user) return reply.code(404).send("unknown user");
      const toSlot = parseSlot(req.body.toSlot);
      if (toSlot === undefined || toSlot > lock.maxCodeSlots) {
        return reply.code(400).send("invalid target slot");
      }
      const clash = deps.store.listUsers().find((u) => u.slot === toSlot && u.id !== user.id);
      if (clash) return reply.code(409).send(`slot ${toSlot} is already held by ${clash.name}`);
      await deps.store.updateUser(user.id, { slot: toSlot });
      if (deps.cache.getLock(req.params.id)?.slots[String(toSlot)]?.status === "enabled") {
        await deps.cache.adoptSlot(req.params.id, toSlot, user.id);
      }
      deps.onChange?.();
      return reply.redirect(`/locks/${req.params.id}/drift`);
    },
  );

  // Keep a user in their assigned slot and let the reconciler make the lock match:
  // clear drift on the assigned slot (needs the write) and the stray slot (gets
  // cleared), then queue a reconcile.
  app.post<{ Params: { id: string }; Body: { assignedSlot: string; straySlot?: string } }>(
    "/locks/:id/drift/rewrite",
    async (req, reply) => {
      if (!byId.has(req.params.id)) return reply.code(404).send("not found");
      const assigned = parseSlot(req.body.assignedSlot);
      if (assigned === undefined) return reply.code(400).send("invalid slot");
      await deps.cache.clearSlotDrift(req.params.id, assigned);
      const stray = req.body.straySlot ? parseSlot(req.body.straySlot) : undefined;
      if (stray !== undefined) await deps.cache.clearSlotDrift(req.params.id, stray);
      deps.onResync(req.params.id);
      return reply.redirect(`/locks/${req.params.id}/drift`);
    },
  );

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
