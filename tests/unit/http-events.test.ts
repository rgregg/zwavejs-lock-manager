import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventLog } from "../../src/log/event-log.js";
import { EventBus } from "../../src/events/bus.js";
import { buildServer } from "../../src/http/server.js";
import type { FastifyInstance } from "fastify";

describe("events routes", () => {
  let app: FastifyInstance;
  let eventLog: EventLog;
  let bus: EventBus;

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), "httpe-"));
    eventLog = new EventLog({ path: join(dir, "events.jsonl") });
    bus = new EventBus();
    app = buildServer({ eventLog, bus });
  });

  afterEach(async () => await app.close());

  it("GET /events renders recent entries", async () => {
    await eventLog.append({
      ts: "2026-04-21T00:00:00Z",
      type: "unlock",
      lockId: "front-door",
      lockName: "Front Door",
      userName: "Alice",
      slot: 3,
    });
    const res = await app.inject({ method: "GET", url: "/events" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Alice");
    expect(res.body).toContain("Front Door");
  });
});
