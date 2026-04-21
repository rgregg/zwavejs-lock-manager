import { appendFile, mkdir, readFile, rename, stat } from "node:fs/promises";
import { dirname } from "node:path";
import type { LoggedEvent } from "./types.js";

interface EventLogOptions {
  path: string;
  rotateBytes?: number;
}

export class EventLog {
  private readonly path: string;
  private readonly rotateBytes: number;
  private ensured = false;

  constructor(opts: EventLogOptions) {
    this.path = opts.path;
    this.rotateBytes = opts.rotateBytes ?? 10_000_000;
  }

  async append(event: LoggedEvent): Promise<void> {
    await this.ensureDir();
    await this.rotateIfNeeded();
    await appendFile(this.path, `${JSON.stringify(event)}\n`, "utf8");
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
