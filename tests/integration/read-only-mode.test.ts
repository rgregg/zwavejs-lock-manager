import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockZwaveJsServer } from "../helpers/mock-zwavejs-server.js";
import { buildApp, type RunningApp } from "../../src/app.js";

describe("read-only mode", () => {
  let server: MockZwaveJsServer;
  let app: RunningApp | undefined;
  let dataDir: string;

  beforeEach(async () => {
    server = new MockZwaveJsServer();
    await server.start();
    server.onCommand("node.poll_value", () => ({ value: 0 }));
    dataDir = await mkdtemp(join(tmpdir(), "ro-"));
    await writeFile(
      join(dataDir, "locks.yaml"),
      [
        `zwaveJs: { url: ${server.url()} }`,
        "homeAssistant: { url: http://h, token: t, notify: { service: notify.x } }",
        "verify: { intervalDays: 7, staggerMinutes: 0 }",
        "readOnly: true",
        "locks:",
        "  - { id: front, name: Front, nodeId: 7, maxCodeSlots: 30 }",
      ].join("\n"),
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => "" }));
  });

  afterEach(async () => {
    await app?.stop();
    await server.stop();
    vi.unstubAllGlobals();
  });

  it("does not issue any node.set_value commands even after user changes", async () => {
    app = await buildApp({ dataDir, localSecret: "s" });
    await app.start();
    expect(app.readOnly).toBe(true);
    await app.store!.addUser({ name: "Alice", pin: "1234" });
    await app.waitForIdle();
    const setCommands = server.commands.filter((c) => c.command === "node.set_value");
    expect(setCommands).toHaveLength(0);
  });

  it("still completes the Z-Wave handshake", async () => {
    app = await buildApp({ dataDir, localSecret: "s" });
    await app.start();
    const handshake = server.commands.slice(0, 2).map((c) => c.command);
    expect(handshake).toEqual(["set_api_schema", "start_listening"]);
  });

  it("renders the read-only banner on the users page", async () => {
    app = await buildApp({ dataDir, localSecret: "s" });
    await app.start();
    const res = await app.server.inject({ method: "GET", url: "/users" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("READ ONLY");
  });
});
