import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp, type RunningApp } from "../../src/app.js";

describe("error mode", () => {
  let app: RunningApp | undefined;

  afterEach(async () => {
    await app?.stop();
    app = undefined;
  });

  it("starts in error mode when locks.yaml is missing", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "err-"));
    app = await buildApp({ dataDir, localSecret: "s" });
    await app.start();
    expect(app.config).toBeUndefined();
    const res = await app.server.inject({ method: "GET", url: "/users" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Configuration error");
  });

  it("health endpoint works in error mode", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "err-"));
    app = await buildApp({ dataDir, localSecret: "s" });
    await app.start();
    const res = await app.server.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("ok");
  });

  it("starts in error mode when LOCAL_SECRET is empty", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "err-"));
    await writeFile(
      join(dataDir, "locks.yaml"),
      [
        "zwaveJs: { url: ws://z:3000 }",
        "homeAssistant: { url: http://h, token: t, notify: { service: notify.x } }",
        "locks: []",
      ].join("\n"),
    );
    app = await buildApp({ dataDir, localSecret: "" });
    await app.start();
    const res = await app.server.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Configuration error");
    expect(res.body).toContain("LOCAL_SECRET");
  });

  it("invalid locks.yaml puts the app in error mode with the zod error text", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "err-"));
    await writeFile(join(dataDir, "locks.yaml"), "zwaveJs: missing\n");
    app = await buildApp({ dataDir, localSecret: "s" });
    await app.start();
    const res = await app.server.inject({ method: "GET", url: "/users" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Configuration error");
  });
});
