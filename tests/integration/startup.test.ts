import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockZwaveJsServer } from "../helpers/mock-zwavejs-server.js";
import { buildApp, type RunningApp } from "../../src/app.js";

describe("app startup", () => {
  let server: MockZwaveJsServer;
  let app: RunningApp | undefined;
  let dataDir: string;
  let haFetch: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    server = new MockZwaveJsServer();
    await server.start();
    server.onCommand("node.set_value", () => null);
    server.onCommand("node.get_value", () => 0);

    dataDir = await mkdtemp(join(tmpdir(), "app-"));
    await writeFile(
      join(dataDir, "locks.yaml"),
      [
        "zwaveJs: { url: " + server.url() + " }",
        "homeAssistant: { url: http://ha.local, token: t, notify: { service: notify.x } }",
        "verify: { intervalDays: 7, staggerMinutes: 0 }",
        "locks:",
        "  - { id: front, name: Front, nodeId: 7, maxCodeSlots: 30 }",
      ].join("\n"),
    );

    haFetch = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => "" });
    vi.stubGlobal("fetch", haFetch);
  });

  afterEach(async () => {
    await app?.stop();
    await server.stop();
    vi.unstubAllGlobals();
  });

  it("starts, reconciles new users, and fires notifications on unlock", async () => {
    app = await buildApp({ dataDir, localSecret: "s" });
    await app.start();
    const user = await app.store.addUser({ name: "Alice", pin: "1234" });
    await app.waitForIdle();

    const setCalls = server.commands.filter(
      (c) =>
        c.command === "node.set_value" &&
        (c.args?.valueId as { property?: string } | undefined)?.property === "userCode",
    );
    expect(setCalls).toHaveLength(1);
    expect(setCalls[0]?.args).toMatchObject({ nodeId: 7, value: "1234" });

    server.pushEvent({
      source: "node",
      event: "notification",
      nodeId: 7,
      args: { userId: user.slot },
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(haFetch).toHaveBeenCalled();
    const body = JSON.parse(haFetch.mock.calls.at(-1)![1].body as string);
    expect(body.message).toBe("Alice unlocked Front");
  });
});
