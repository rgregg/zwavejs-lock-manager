import { readFile } from "node:fs/promises";
import { atomicWriteFile } from "../util/atomic-write.js";
import type { CacheFile, LockState, SlotState } from "./types.js";

interface CacheOptions {
  path: string;
}

export class LockStateCache {
  private data: CacheFile = { version: 1, locks: {} };
  constructor(private readonly opts: CacheOptions) {}

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.opts.path, "utf8");
      this.data = JSON.parse(raw) as CacheFile;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw err;
    }
  }

  getLock(lockId: string): LockState | undefined {
    return this.data.locks[lockId];
  }

  getAllLockIds(): string[] {
    return Object.keys(this.data.locks);
  }

  async markWrite(
    lockId: string,
    slot: number,
    fields: { userId: string; pinFingerprint: string },
  ): Promise<void> {
    const lock = this.ensureLock(lockId);
    const now = new Date().toISOString();
    lock.slots[String(slot)] = {
      status: "enabled",
      userId: fields.userId,
      pinFingerprint: fields.pinFingerprint,
      updatedAt: now,
    };
    await this.persist();
  }

  async markCleared(lockId: string, slot: number): Promise<void> {
    const lock = this.ensureLock(lockId);
    lock.slots[String(slot)] = { status: "empty", updatedAt: new Date().toISOString() };
    await this.persist();
  }

  async markUnknown(lockId: string, slot: number): Promise<void> {
    const lock = this.ensureLock(lockId);
    lock.slots[String(slot)] = { status: "unknown", updatedAt: new Date().toISOString() };
    await this.persist();
  }

  async markReconcile(
    lockId: string,
    outcome: NonNullable<LockState["lastReconcileOutcome"]>,
  ): Promise<void> {
    const lock = this.ensureLock(lockId);
    lock.lastReconcileAt = new Date().toISOString();
    lock.lastReconcileOutcome = outcome;
    await this.persist();
  }

  async markVerified(lockId: string): Promise<void> {
    const lock = this.ensureLock(lockId);
    lock.lastVerifiedAt = new Date().toISOString();
    await this.persist();
  }

  async dropLock(lockId: string): Promise<void> {
    delete this.data.locks[lockId];
    await this.persist();
  }

  async replaceLock(lockId: string, slots: Record<string, SlotState>): Promise<void> {
    const lock = this.ensureLock(lockId);
    lock.slots = slots;
    lock.lastVerifiedAt = new Date().toISOString();
    await this.persist();
  }

  private ensureLock(lockId: string): LockState {
    let lock = this.data.locks[lockId];
    if (!lock) {
      lock = { slots: {} };
      this.data.locks[lockId] = lock;
    }
    return lock;
  }

  private async persist(): Promise<void> {
    await atomicWriteFile(this.opts.path, JSON.stringify(this.data, null, 2), { mode: 0o600 });
  }
}
