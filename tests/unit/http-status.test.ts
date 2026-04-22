import { describe, it, expect } from "vitest";
import { buildServer } from "../../src/http/server.js";
import { ConnectionStatusTracker } from "../../src/http/status.js";

describe("GET /status", () => {
  it("returns an empty banner when both sources are connected", async () => {
    const tracker = new ConnectionStatusTracker();
    tracker.set("zwaveJs", "connected");
    tracker.set("homeAssistant", "connected");
    const app = buildServer({ status: tracker });
    const res = await app.inject({ method: "GET", url: "/status" });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain("Disconnected");
    await app.close();
  });

  it("shows a banner when a source is disconnected", async () => {
    const tracker = new ConnectionStatusTracker();
    tracker.set("zwaveJs", "disconnected");
    tracker.set("homeAssistant", "connected");
    const app = buildServer({ status: tracker });
    const res = await app.inject({ method: "GET", url: "/status" });
    expect(res.body).toContain("ZWave");
    await app.close();
  });
});
