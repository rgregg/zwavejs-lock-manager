import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../src/store/store.js";
import { LockStateCache } from "../../src/cache/cache.js";
import { buildServer } from "../../src/http/server.js";
import type { FastifyInstance } from "fastify";

const INGRESS = "/api/hassio_ingress/abc";

describe("ingress path rewriting", () => {
  let app: FastifyInstance;
  let store: Store;

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), "httpi-"));
    store = new Store({ path: join(dir, "users.json"), maxSlots: 30 });
    await store.load();
    const cache = new LockStateCache({ path: join(dir, "state.json") });
    await cache.load();
    app = buildServer({
      store,
      cache,
      locks: [{ id: "front", name: "Front", nodeId: 7, maxCodeSlots: 30 }],
      onUsersChanged: () => undefined,
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it("prefixes page links with X-Ingress-Path when the header is present", async () => {
    await store.addUser({ name: "Alice", pin: "1234" });
    const res = await app.inject({
      method: "GET",
      url: "/users",
      headers: { "x-ingress-path": INGRESS },
    });
    expect(res.body).toContain(`href="${INGRESS}/users"`);
    expect(res.body).toContain(`hx-get="${INGRESS}/status"`);
    // Per-user action forms are also prefixed.
    expect(res.body).toContain(`action="${INGRESS}/users/`);
    expect(res.body).toContain(`hx-get="${INGRESS}/users/`);
    // External assets are left untouched.
    expect(res.body).toContain('src="https://unpkg.com/htmx.org@2.0.3"');
  });

  it("prefixes HTMX fragment links too", async () => {
    const user = await store.addUser({ name: "Bob", pin: "5678" });
    const res = await app.inject({
      method: "GET",
      url: `/users/${user.id}/edit-form`,
      headers: { "x-ingress-path": INGRESS },
    });
    expect(res.body).toContain(`hx-post="${INGRESS}/users/${user.id}/edit"`);
  });

  it("prefixes the redirect Location header", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/",
      headers: { "x-ingress-path": INGRESS },
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`${INGRESS}/users`);
  });

  it("sets Vary: X-Ingress-Path on rewritten responses", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/users",
      headers: { "x-ingress-path": INGRESS },
    });
    expect(String(res.headers.vary ?? "")).toMatch(/X-Ingress-Path/i);
  });

  it("ignores a forged X-Ingress-Path that could inject markup", async () => {
    const evil = '/"><script>alert(1)</script>';
    const res = await app.inject({
      method: "GET",
      url: "/users",
      headers: { "x-ingress-path": evil },
    });
    expect(res.body).not.toContain("<script>alert(1)</script>");
    // Falls back to bare absolute paths, unmodified.
    expect(res.body).toContain('href="/users"');
  });

  it("ignores a forged X-Ingress-Path that could cause an open redirect", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/",
      headers: { "x-ingress-path": "//evil.example.com" },
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/users"); // not //evil.example.com/users
  });

  it("uses bare paths when X-Ingress-Path is absent", async () => {
    await store.addUser({ name: "Alice", pin: "1234" });
    const res = await app.inject({ method: "GET", url: "/users" });
    expect(res.body).toContain('href="/users"');
    expect(res.body).toContain('hx-get="/status"');
    expect(res.body).not.toContain("hassio_ingress");

    const redir = await app.inject({ method: "GET", url: "/" });
    expect(redir.headers.location).toBe("/users");
  });
});
