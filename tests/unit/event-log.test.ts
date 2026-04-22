import { describe, it, expect } from "vitest";
import { mkdtemp, stat, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventLog } from "../../src/log/event-log.js";
import type { LoggedEvent } from "../../src/log/types.js";

async function makeLog(rotateBytes = 1_000_000) {
  const dir = await mkdtemp(join(tmpdir(), "evlog-"));
  const log = new EventLog({ path: join(dir, "events.jsonl"), rotateBytes });
  return { log, dir };
}

describe("EventLog", () => {
  it("append writes a JSONL line", async () => {
    const { log } = await makeLog();
    await log.append({ ts: "t1", type: "unlock", lockId: "a", lockName: "A", slot: 1 });
    const contents = await readFile((log as unknown as { path: string }).path, "utf8");
    expect(contents.trim().split("\n")).toHaveLength(1);
    const parsed = JSON.parse(contents.trim());
    expect(parsed).toMatchObject({ type: "unlock", lockId: "a", slot: 1 });
  });

  it("tail returns the last N entries in order", async () => {
    const { log } = await makeLog();
    for (let i = 0; i < 5; i++) {
      await log.append({ ts: `t${i}`, type: "unlock", lockId: "a", lockName: "A", slot: i });
    }
    const tail = await log.tail(3);
    expect(tail.map((e) => (e as { slot: number }).slot)).toEqual([2, 3, 4]);
  });

  it("rotates when size exceeds rotateBytes", async () => {
    const { log, dir } = await makeLog(200);
    for (let i = 0; i < 30; i++) {
      await log.append({ ts: `t${i}`, type: "unlock", lockId: "a", lockName: "A", slot: i });
    }
    const cur = await stat(join(dir, "events.jsonl"));
    expect(cur.size).toBeLessThan(500);
    const rotated = await stat(join(dir, "events.jsonl.1"));
    expect(rotated.size).toBeGreaterThan(0);
  });

  it("pruneExpired removes entries older than the retention window", async () => {
    const { log } = await makeLog();
    const oldTs = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString(); // 100 days ago
    const newTs = new Date().toISOString();
    await log.append({ ts: oldTs, type: "unlock", lockId: "a", lockName: "A", slot: 1 } as LoggedEvent);
    await log.append({ ts: newTs, type: "unlock", lockId: "a", lockName: "A", slot: 2 } as LoggedEvent);
    const pruned = await log.pruneExpired();
    expect(pruned).toBe(1);
    const tail = await log.tail(10);
    expect(tail).toHaveLength(1);
    expect(tail[0]).toMatchObject({ slot: 2 });
  });

  it("pruneExpired respects retentionDays override", async () => {
    const dir = await mkdtemp(join(tmpdir(), "evlog-"));
    const log = new EventLog({ path: join(dir, "events.jsonl"), retentionDays: 1 });
    const oldTs = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const newTs = new Date().toISOString();
    await log.append({ ts: oldTs, type: "unlock", lockId: "a", lockName: "A", slot: 1 } as LoggedEvent);
    await log.append({ ts: newTs, type: "unlock", lockId: "a", lockName: "A", slot: 2 } as LoggedEvent);
    expect(await log.pruneExpired()).toBe(1);
  });
});
