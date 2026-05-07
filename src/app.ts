import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { loadLocksConfig } from "./config/loader.js";
import { discoverZwaveJsUrl } from "./config/discovery.js";
import type { LocksConfig } from "./config/schema.js";
import { Store } from "./store/store.js";
import { LockStateCache } from "./cache/cache.js";
import type { SlotState } from "./cache/types.js";
import { fingerprintPin } from "./cache/fingerprint.js";
import { EventBus } from "./events/bus.js";
import { ZWaveJSClient } from "./zwave/client.js";
import { Reconciler } from "./reconciler/reconciler.js";
import type { DiffUser } from "./reconciler/diff.js";
import { HaNotifier } from "./notifier/ha-notifier.js";
import { EventLog } from "./log/event-log.js";
import { VerifyScheduler } from "./verify/scheduler.js";
import { buildServer, buildErrorServer } from "./http/server.js";
import { ConnectionStatusTracker } from "./http/status.js";
import { createLogger } from "./util/logger.js";
import { createReadOnlyWriter } from "./zwave/readonly-writer.js";
import type { Logger } from "pino";

export interface BuildAppOptions {
  dataDir: string;
  localSecret: string;
  httpPort?: number;
}

export interface RunningApp {
  server: FastifyInstance;
  store?: Store;
  cache?: LockStateCache;
  config?: LocksConfig;
  readOnly?: boolean;
  waitForIdle(): Promise<void>;
  stop(): Promise<void>;
  start(): Promise<void>;
}

export async function buildApp(opts: BuildAppOptions): Promise<RunningApp> {
  const log = createLogger();
  try {
    return await buildFullApp(opts, log);
  } catch (err) {
    const message = (err as Error).message;
    log.error({ err }, "configuration error; starting in error mode");
    return buildErrorModeApp({
      ...(opts.httpPort !== undefined ? { port: opts.httpPort } : {}),
      message,
    });
  }
}

async function buildFullApp(opts: BuildAppOptions, log: Logger): Promise<RunningApp> {
  if (!opts.localSecret) {
    throw new Error("LOCAL_SECRET env var is required");
  }

  const inAddonMode = !!process.env.SUPERVISOR_TOKEN;
  const configFile = inAddonMode ? "options.json" : "locks.yaml";
  const config = await loadLocksConfig(join(opts.dataDir, configFile));
  for (const w of config.warnings) log.warn({ warning: w }, "config warning");

  if (!config.zwaveJs.url && process.env.SUPERVISOR_TOKEN) {
    config.zwaveJs.url = await discoverZwaveJsUrl({
      supervisorToken: process.env.SUPERVISOR_TOKEN,
    });
    log.info({ url: config.zwaveJs.url }, "zwave-js discovered via supervisor");
  }

  const maxSlots = Math.min(...config.locks.map((l) => l.maxCodeSlots));
  const store = new Store({ path: join(opts.dataDir, "users.json"), maxSlots });
  await store.load();

  const cache = new LockStateCache({ path: join(opts.dataDir, "state.json") });
  await cache.load();

  const bus = new EventBus();
  const tracker = new ConnectionStatusTracker();
  bus.on("connection", (e) => tracker.set(e.source, e.status));
  const zwave = new ZWaveJSClient({ url: config.zwaveJs.url, bus });
  const notifier = new HaNotifier({
    url: config.homeAssistant.url,
    token: config.homeAssistant.token,
    service: config.homeAssistant.notify.service,
  });
  const eventLog = new EventLog({ path: join(opts.dataDir, "events.jsonl") });

  const desired = (): DiffUser[] =>
    store.listUsers().map((u) => ({
      id: u.id,
      name: u.name,
      pin: u.pin,
      slot: u.slot,
      enabled: u.enabled,
    }));

  const writer = config.readOnly ? createReadOnlyWriter(log) : zwave;
  if (config.readOnly) {
    log.warn({}, "READ ONLY mode — no writes will be issued to any lock");
  }

  const reconciler = new Reconciler({
    cache,
    writer,
    locks: config.locks,
    secret: opts.localSecret,
    debounceMs: 100,
    readOnly: config.readOnly,
    onWriteResult: async (evt) => {
      await eventLog.append({
        ts: new Date().toISOString(),
        type: "write",
        lockId: evt.lockId,
        slot: evt.slot,
        outcome: evt.outcome,
      });
    },
  });

  store.on("change", () => reconciler.scheduleReconcile(desired));

  const lockById = new Map(config.locks.map((l) => [l.id, l]));
  const nodeIdToLock = new Map(config.locks.map((l) => [l.nodeId, l]));

  bus.on("unlock", async (evt) => {
    const nodeId = Number(evt.lockId.replace(/^node-/, ""));
    const lock = nodeIdToLock.get(nodeId);
    if (!lock) return;
    const user = store.listUsers().find((u) => u.slot === evt.slot);
    const logged = {
      ts: evt.ts,
      type: "unlock" as const,
      lockId: lock.id,
      lockName: lock.name,
      slot: evt.slot,
      ...(user ? { userId: user.id, userName: user.name } : {}),
    };
    await eventLog.append(logged);
    const res = await notifier.notifyUnlock({
      lockName: lock.name,
      ...(user ? { userName: user.name } : { slot: evt.slot }),
    });
    tracker.set("homeAssistant", res.ok ? "connected" : "disconnected");
    if (!res.ok) {
      await eventLog.append({
        ts: new Date().toISOString(),
        type: "notification_failed",
        reason: res.error,
        lockId: lock.id,
        slot: evt.slot,
      });
    }
  });

  const verifyQueues = new Map<string, Promise<void>>();

  const queueVerify = async (lockId: string): Promise<void> => {
    const prior = verifyQueues.get(lockId) ?? Promise.resolve();
    const next = prior.then(() => doVerify(lockId));
    verifyQueues.set(lockId, next.catch(() => undefined));
    await next;
  };

  const doVerify = async (lockId: string): Promise<void> => {
    const lock = lockById.get(lockId);
    if (!lock) return;
    let slots;
    try {
      slots = await zwave.getAllUserCodes(lock.nodeId, lock.maxCodeSlots);
    } catch (err) {
      log.warn({ err, lockId }, "verify aborted (connection lost mid-read)");
      return;
    }
    try {
      const mapped: Record<string, SlotState> = {};
      for (const s of slots) {
        mapped[String(s.slot)] = {
          status: s.status,
          updatedAt: new Date().toISOString(),
          ...(s.status === "enabled" && s.pin
            ? { pinFingerprint: fingerprintPin(opts.localSecret, s.pin) }
            : {}),
        };
      }

      // Per-slot drift detection: compare what's on the lock against what's desired.
      // Slots that differ are flagged for human review — NOT auto-healed.
      const driftedSlots: number[] = [];
      const allUsers = store.listUsers();
      for (const s of slots) {
        const slotNum = s.slot;
        const desiredUser = allUsers.find((u) => u.slot === slotNum);
        let isDrifted = false;
        if (desiredUser) {
          if (desiredUser.enabled) {
            const desiredFp = fingerprintPin(opts.localSecret, desiredUser.pin);
            isDrifted =
              mapped[String(slotNum)]?.status !== "enabled" ||
              mapped[String(slotNum)]?.pinFingerprint !== desiredFp;
          } else {
            // User exists but disabled: lock should be empty for this slot
            isDrifted = mapped[String(slotNum)]?.status === "enabled";
          }
        } else {
          // No desired user for this slot: lock should be empty
          isDrifted = mapped[String(slotNum)]?.status === "enabled";
        }
        if (isDrifted) driftedSlots.push(slotNum);
      }

      // Retain the PIN for drifted enabled slots so the user can adopt them.
      const driftSet = new Set(driftedSlots);
      for (const s of slots) {
        const slotNum = s.slot;
        const slotState = mapped[String(slotNum)];
        if (slotState && s.status === "enabled" && s.pin && driftSet.has(slotNum)) {
          slotState.pin = s.pin;
        }
      }

      // Bind userId on slots where the lock's PIN matches a desired user.
      // This prevents the reconciler from issuing redundant writes later
      // because the diff uses userId as part of its "matches desired" check.
      for (const s of slots) {
        const slotNum = s.slot;
        const slotState = mapped[String(slotNum)];
        if (!slotState || slotState.status !== "enabled") continue;
        if (driftSet.has(slotNum)) continue; // drifted slots don't get bound
        const desiredUser = allUsers.find((u) => u.slot === slotNum && u.enabled);
        if (desiredUser) {
          slotState.userId = desiredUser.id;
        }
      }

      await cache.replaceLock(lock.id, mapped, driftedSlots);
      log.info({ lockId, drifted: driftedSlots.length }, "verify completed");
    } catch (err) {
      log.error({ err, lockId }, "verify failed");
    }
  };

  const verifyScheduler = new VerifyScheduler({
    intervalMs: config.verify.intervalDays * 24 * 60 * 60 * 1000,
    staggerMs: config.verify.staggerMinutes * 60 * 1000,
    onVerify: queueVerify,
  });

  const server = buildServer({
    store,
    cache,
    locks: config.locks,
    eventLog,
    bus,
    status: tracker,
    readOnly: config.readOnly,
    onUsersChanged: () => reconciler.scheduleReconcile(desired),
    onResync: (lockId) => {
      void reconciler.reconcileLockOnly(lockId, desired());
    },
    onVerify: (id) => void queueVerify(id),
    onDriftClear: (lockId) => {
      const lock = lockById.get(lockId);
      if (!lock) return;
      const state = cache.getLock(lockId);
      if (!state) return;
      for (const slotKey of Object.keys(state.slots)) {
        if (state.slots[slotKey]?.drifted) {
          void cache.clearSlotDrift(lockId, Number(slotKey));
        }
      }
      void reconciler.reconcileLockOnly(lockId, desired());
    },
  });

  let listening = false;

  const start = async (): Promise<void> => {
    await zwave.start();
    // First-run verify for any lock without a cache entry
    const firstRun = config.locks.filter((l) => !cache.getLock(l.id)).map((l) => l.id);
    for (const id of firstRun) await queueVerify(id);
    reconciler.scheduleReconcile(desired);
    verifyScheduler.schedule(config.locks.map((l) => l.id), { skipInitial: true });
    if (opts.httpPort !== undefined) {
      await server.listen({ port: opts.httpPort, host: "0.0.0.0" });
      listening = true;
    }
  };

  const stop = async (): Promise<void> => {
    verifyScheduler.stop();
    await zwave.stop();
    if (listening) await server.close();
  };

  const waitForIdle = async (): Promise<void> => {
    await reconciler.drain();
  };

  return { store, cache, server, config, readOnly: config.readOnly, start, stop, waitForIdle };
}

function buildErrorModeApp(opts: { port?: number; message: string }): RunningApp {
  const server = buildErrorServer(opts.message);
  let listening = false;

  const start = async (): Promise<void> => {
    if (opts.port !== undefined) {
      await server.listen({ port: opts.port, host: "0.0.0.0" });
      listening = true;
    }
  };

  const stop = async (): Promise<void> => {
    if (listening) await server.close();
  };

  const waitForIdle = async (): Promise<void> => {
    // no-op in error mode
  };

  return { server, readOnly: false, start, stop, waitForIdle };
}
