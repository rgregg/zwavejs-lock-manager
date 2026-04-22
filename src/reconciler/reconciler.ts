import type { LockStateCache } from "../cache/cache.js";
import { fingerprintPin } from "../cache/fingerprint.js";
import { computeDiff, type DiffUser } from "./diff.js";
import type { LockSyncTarget, LockWriter } from "./types.js";

interface ReconcilerOptions {
  cache: LockStateCache;
  writer: LockWriter;
  locks: readonly LockSyncTarget[];
  secret: string;
  retries?: number;
  retryDelayMs?: number;
  debounceMs?: number;
  onWriteResult?: (event: { lockId: string; slot: number; outcome: "ok" | "error" }) => void | Promise<void>;
}

type DesiredProvider = () => readonly DiffUser[];

export class Reconciler {
  private queues = new Map<string, Promise<void>>();
  private pendingTimer: NodeJS.Timeout | undefined;
  private pendingProvider: DesiredProvider | undefined;
  private pendingDrain: Promise<void> | undefined;

  constructor(private readonly opts: ReconcilerOptions) {}

  scheduleReconcile(provider: DesiredProvider): void {
    this.pendingProvider = provider;
    if (this.pendingTimer) return;
    const delay = this.opts.debounceMs ?? 500;
    this.pendingTimer = setTimeout(() => {
      const p = this.pendingProvider;
      this.pendingTimer = undefined;
      this.pendingProvider = undefined;
      if (p) this.pendingDrain = this.reconcileAll(p());
    }, delay);
  }

  async drain(): Promise<void> {
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = undefined;
      const p = this.pendingProvider;
      this.pendingProvider = undefined;
      if (p) this.pendingDrain = this.reconcileAll(p());
    }
    if (this.pendingDrain) await this.pendingDrain;
  }

  async reconcileAll(desired: readonly DiffUser[]): Promise<void> {
    await Promise.all(this.opts.locks.map((lock) => this.reconcileLock(lock, desired)));
  }

  async reconcileLockOnly(lockId: string, desired: readonly DiffUser[]): Promise<void> {
    const lock = this.opts.locks.find((l) => l.id === lockId);
    if (!lock) throw new Error(`unknown lock: ${lockId}`);
    await this.reconcileLock(lock, desired);
  }

  private async reconcileLock(lock: LockSyncTarget, desired: readonly DiffUser[]): Promise<void> {
    const prior = this.queues.get(lock.id) ?? Promise.resolve();
    const next = prior.then(() => this.doReconcileLock(lock, desired));
    this.queues.set(
      lock.id,
      next.catch(() => undefined),
    );
    await next;
  }

  private async doReconcileLock(lock: LockSyncTarget, desired: readonly DiffUser[]): Promise<void> {
    const cacheState = this.opts.cache.getLock(lock.id);
    const slots = cacheState?.slots ?? {};
    const ops = computeDiff({ users: desired, cache: slots, secret: this.opts.secret });
    let outcome: "ok" | "error" | "partial" = "ok";

    for (const op of ops) {
      const ok = await this.executeWithRetry(lock, op);
      if (!ok) outcome = "error";
    }

    await this.opts.cache.markReconcile(lock.id, outcome);
  }

  private async executeWithRetry(
    lock: LockSyncTarget,
    op: ReturnType<typeof computeDiff>[number],
  ): Promise<boolean> {
    const retries = this.opts.retries ?? 2;
    const delayMs = this.opts.retryDelayMs ?? 250;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        if (op.op === "set") {
          await this.opts.writer.setUserCode(lock.nodeId, op.slot, op.pin);
          await this.opts.cache.markWrite(lock.id, op.slot, {
            userId: op.userId,
            pinFingerprint: fingerprintPin(this.opts.secret, op.pin),
          });
        } else {
          await this.opts.writer.clearUserCode(lock.nodeId, op.slot);
          await this.opts.cache.markCleared(lock.id, op.slot);
        }
        void Promise.resolve(this.opts.onWriteResult?.({ lockId: lock.id, slot: op.slot, outcome: "ok" })).catch(() => {});
        return true;
      } catch {
        if (attempt < retries) await new Promise((r) => setTimeout(r, delayMs * (attempt + 1)));
      }
    }
    void Promise.resolve(this.opts.onWriteResult?.({ lockId: lock.id, slot: op.slot, outcome: "error" })).catch(() => {});
    return false;
  }
}
