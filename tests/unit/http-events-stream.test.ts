import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventLog } from "../../src/log/event-log.js";
import { EventBus } from "../../src/events/bus.js";
import { buildServer } from "../../src/http/server.js";
import type { FastifyInstance } from "fastify";

/**
 * The SSE stream never ends, so `app.inject()` (which buffers to completion)
 * can't see it — these tests talk to a real listening server and read chunks
 * off the wire as they arrive.
 */
async function openStream(url: string) {
  const ctrl = new AbortController();
  const res = await fetch(url, { signal: ctrl.signal });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  return {
    res,
    /** Read chunks until `match` appears or `ms` elapses. Returns all text read. */
    async readUntil(match: string, ms = 2000): Promise<string> {
      const deadline = Date.now() + ms;
      while (!buffered.includes(match) && Date.now() < deadline) {
        const chunk = await Promise.race([
          reader.read(),
          new Promise<{ value: undefined }>((r) => setTimeout(() => r({ value: undefined }), 100)),
        ]);
        if (chunk.value) buffered += decoder.decode(chunk.value, { stream: true });
      }
      return buffered;
    },
    close() {
      ctrl.abort();
    },
  };
}

describe("events stream (SSE)", () => {
  let app: FastifyInstance;
  let eventLog: EventLog;
  let base: string;

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), "httpsse-"));
    eventLog = new EventLog({ path: join(dir, "events.jsonl") });
    app = buildServer({ eventLog, bus: new EventBus(), heartbeatMs: 50 });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const addr = app.server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  });

  afterEach(async () => await app.close());

  it("flushes headers and an opening comment immediately, before any event", async () => {
    const stream = await openStream(`${base}/events/stream`);
    expect(stream.res.status).toBe(200);
    expect(stream.res.headers.get("content-type")).toContain("text/event-stream");
    // Without an initial flush the client sits on an empty socket and proxies
    // reap the connection as dead.
    expect(await stream.readUntil(":", 1000)).toMatch(/^:/);
    stream.close();
  });

  it("relays a write event — not just unlocks", async () => {
    const stream = await openStream(`${base}/events/stream`);
    await stream.readUntil(":", 1000);
    await eventLog.append({ ts: "2026-08-21T14:21:00Z", type: "write", lockId: "front-door", slot: 7, outcome: "ok" });
    const text = await stream.readUntil("event: log");
    expect(text).toContain("event: log");
    const dataLine = text.split("\n").find((l) => l.startsWith("data:"))!;
    const payload = JSON.parse(dataLine.slice(5));
    expect(payload.event).toMatchObject({ type: "write", lockId: "front-door", slot: 7 });
    expect(payload.html).toContain("Write slot 7 on front-door: ok");
    stream.close();
  });

  it("relays an unlock event", async () => {
    const stream = await openStream(`${base}/events/stream`);
    await stream.readUntil(":", 1000);
    await eventLog.append({
      ts: "2026-08-21T14:30:00Z",
      type: "unlock",
      lockId: "front-door",
      lockName: "Front Door",
      userName: "Ryan",
      slot: 3,
    });
    const text = await stream.readUntil("event: log");
    expect(text).toContain('"userName":"Ryan"');
    expect(text).toContain("Ryan unlocked Front Door");
    stream.close();
  });

  it("sends periodic heartbeats to keep the connection alive", async () => {
    const stream = await openStream(`${base}/events/stream`);
    const text = await stream.readUntil(": ping");
    expect(text).toContain(": ping");
    stream.close();
  });

  it("unsubscribes when the client disconnects", async () => {
    const stream = await openStream(`${base}/events/stream`);
    await stream.readUntil(":", 1000);
    stream.close();
    await new Promise((r) => setTimeout(r, 100));
    // A closed stream must not leave a listener behind writing to a dead socket.
    await expect(
      eventLog.append({ ts: "2026-08-21T14:40:00Z", type: "write", lockId: "a", slot: 1, outcome: "ok" }),
    ).resolves.toBeUndefined();
    expect(listenerCount(eventLog)).toBe(0);
  });
});

function listenerCount(log: EventLog): number {
  return (log as unknown as { subscribers: Set<unknown> }).subscribers.size;
}
