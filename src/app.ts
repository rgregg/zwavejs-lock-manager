import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { loadLocksConfig } from "./config/loader.js";
import type { LocksConfig } from "./config/schema.js";
import { Store } from "./store/store.js";
import { LockStateCache } from "./cache/cache.js";
import { EventBus } from "./events/bus.js";
import { ZWaveJSClient } from "./zwave/client.js";
import { Reconciler } from "./reconciler/reconciler.js";
import type { DiffUser } from "./reconciler/diff.js";
import { HaNotifier } from "./notifier/ha-notifier.js";
import { EventLog } from "./log/event-log.js";
import { VerifyScheduler } from "./verify/scheduler.js";
import { buildServer } from "./http/server.js";
import { createLogger } from "./util/logger.js";

export interface BuildAppOptions {
  dataDir: string;
  localSecret: string;
  httpPort?: number;
}

export interface RunningApp {
  store: Store;
  cache: LockStateCache;
  server: FastifyInstance;
  config: LocksConfig;
  waitForIdle(): Promise<void>;
  stop(): Promise<void>;
  start(): Promise<void>;
}

export async function buildApp(opts: BuildAppOptions): Promise<RunningApp> {
  const log = createLogger();
  const config = await loadLocksConfig(join(opts.dataDir, "locks.yaml"));
  for (const w of config.warnings) log.warn({ warning: w }, "config warning");

  const maxSlots = Math.min(...config.locks.map((l) => l.maxCodeSlots));
  const store = new Store({ path: join(opts.dataDir, "users.json"), maxSlots });
  await store.load();

  const cache = new LockStateCache({ path: join(opts.dataDir, "state.json") });
  await cache.load();

  const bus = new EventBus();
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

  const reconciler = new Reconciler({
    cache,
    writer: zwave,
    locks: config.locks,
    secret: opts.localSecret,
    debounceMs: 100,
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

  bus.on("keypadCodeChanged", async (evt) => {
    const nodeId = Number(evt.lockId.replace(/^node-/, ""));
    const lock = nodeIdToLock.get(nodeId);
    if (!lock) return;
    await cache.markUnknown(lock.id, evt.slot);
    await eventLog.append({
      ts: evt.ts,
      type: "keypad_change",
      lockId: lock.id,
      slot: evt.slot,
    });
  });

  const doVerify = async (lockId: string): Promise<void> => {
    const lock = lockById.get(lockId);
    if (!lock) return;
    try {
      const slots = await zwave.getAllUserCodes(lock.nodeId, lock.maxCodeSlots);
      const mapped: Record<string, import("./cache/types.js").SlotState> = {};
      for (const s of slots) {
        mapped[String(s.slot)] = {
          status: s.status,
          updatedAt: new Date().toISOString(),
          ...(s.status === "enabled" && s.pin
            ? {
                pinFingerprint: (await import("./cache/fingerprint.js")).fingerprintPin(
                  opts.localSecret,
                  s.pin,
                ),
              }
            : {}),
        };
      }
      await cache.replaceLock(lock.id, mapped);
    } catch (err) {
      log.error({ err, lockId }, "verify failed");
    }
  };

  const verifyScheduler = new VerifyScheduler({
    intervalMs: config.verify.intervalDays * 24 * 60 * 60 * 1000,
    staggerMs: config.verify.staggerMinutes * 60 * 1000,
    onVerify: doVerify,
  });

  const server = buildServer({
    store,
    cache,
    locks: config.locks,
    eventLog,
    bus,
    onUsersChanged: () => reconciler.scheduleReconcile(desired),
    onResync: () => reconciler.scheduleReconcile(desired),
    onVerify: (id) => void doVerify(id),
  });

  let listening = false;

  const start = async (): Promise<void> => {
    await zwave.start();
    // First-run verify for any lock without a cache entry
    const firstRun = config.locks.filter((l) => !cache.getLock(l.id)).map((l) => l.id);
    for (const id of firstRun) await doVerify(id);
    reconciler.scheduleReconcile(desired);
    verifyScheduler.schedule(config.locks.map((l) => l.id));
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

  return { store, cache, server, config, start, stop, waitForIdle };
}
