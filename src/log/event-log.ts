import { appendFile, mkdir, readFile, rename, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { atomicWriteFile } from "../util/atomic-write.js";
import type { LoggedEvent } from "./types.js";

interface EventLogOptions {
  path: string;
  rotateBytes?: number;
  retentionDays?: number;
}

export class EventLog {
  private readonly path: string;
  private readonly rotateBytes: number;
  private readonly retentionMs: number;
  private ensured = false;
  private lastPruneAt = 0;

  constructor(opts: EventLogOptions) {
    this.path = opts.path;
    this.rotateBytes = opts.rotateBytes ?? 10_000_000;
    const retentionDays = opts.retentionDays ?? 90;
    this.retentionMs = retentionDays * 24 * 60 * 60 * 1000;
  }

  async append(event: LoggedEvent): Promise<void> {
    await this.ensureDir();
    await this.rotateIfNeeded();
    await appendFile(this.path, `${JSON.stringify(event)}\n`, "utf8");
    if (Date.now() - this.lastPruneAt > 24 * 60 * 60 * 1000) {
      this.lastPruneAt = Date.now();
      void this.pruneExpired().catch(() => undefined);
    }
  }

  async pruneExpired(now?: Date): Promise<number> {
    const cutoff = (now ?? new Date()).getTime() - this.retentionMs;
    let raw: string;
    try {
      raw = await readFile(this.path, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return 0;
      throw err;
    }
    const lines = raw.split("\n").filter(Boolean);
    const kept = lines.filter((line) => {
      try {
        const parsed = JSON.parse(line) as { ts?: string };
        if (!parsed.ts) return true;
        const t = new Date(parsed.ts).getTime();
        if (Number.isNaN(t)) return true;
        return t >= cutoff;
      } catch {
        return true;
      }
    });
    const pruned = lines.length - kept.length;
    if (pruned > 0) {
      await atomicWriteFile(this.path, kept.map((l) => `${l}\n`).join(""));
    }
    return pruned;
  }

  async tail(limit: number): Promise<LoggedEvent[]> {
    try {
      const raw = await readFile(this.path, "utf8");
      const lines = raw.split("\n").filter(Boolean);
      return lines.slice(-limit).map((l) => JSON.parse(l) as LoggedEvent);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  }

  private async ensureDir(): Promise<void> {
    if (this.ensured) return;
    await mkdir(dirname(this.path), { recursive: true });
    this.ensured = true;
  }

  private async rotateIfNeeded(): Promise<void> {
    try {
      const s = await stat(this.path);
      if (s.size >= this.rotateBytes) {
        await rename(this.path, `${this.path}.1`);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
}
