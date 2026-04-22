import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../src/store/store.js";
import { buildServer } from "../../src/http/server.js";
import type { FastifyInstance } from "fastify";

describe("users routes", () => {
  let app: FastifyInstance;
  let store: Store;

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), "httpu-"));
    store = new Store({ path: join(dir, "users.json"), maxSlots: 30 });
    await store.load();
    app = buildServer({ store, onUsersChanged: () => undefined });
  });

  afterEach(async () => {
    await app.close();
  });

  it("GET / redirects to /users", async () => {
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/users");
  });

  it("GET /users renders an empty list initially", async () => {
    const res = await app.inject({ method: "GET", url: "/users" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("<h1>Users</h1>");
  });

  it("POST /users creates a user and the list reflects it", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/users",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "name=Alice&pin=1234",
    });
    expect(res.statusCode).toBe(302);
    expect(store.listUsers()).toHaveLength(1);
    const list = await app.inject({ method: "GET", url: "/users" });
    expect(list.body).toContain("Alice");
    expect(list.body).not.toContain("1234"); // PIN never rendered
  });

  it("POST /users/:id/toggle flips enabled", async () => {
    const u = await store.addUser({ name: "Alice", pin: "1111" });
    const res = await app.inject({ method: "POST", url: `/users/${u.id}/toggle` });
    expect(res.statusCode).toBe(302);
    expect(store.getUser(u.id)?.enabled).toBe(false);
  });

  it("POST /users/:id/delete removes the user", async () => {
    const u = await store.addUser({ name: "Alice", pin: "1111" });
    const res = await app.inject({ method: "POST", url: `/users/${u.id}/delete` });
    expect(res.statusCode).toBe(302);
    expect(store.getUser(u.id)).toBeUndefined();
  });

  it("calls onUsersChanged after a mutation", async () => {
    let called = 0;
    await app.close();
    app = buildServer({ store, onUsersChanged: () => (called += 1) });
    await app.inject({
      method: "POST",
      url: "/users",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "name=Bob&pin=9999",
    });
    expect(called).toBe(1);
  });

  it("POST /users/:id/edit updates name without requiring pin", async () => {
    const u = await store.addUser({ name: "Alice", pin: "1111" });
    const res = await app.inject({
      method: "POST",
      url: `/users/${u.id}/edit`,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "name=Allison&pin=",
    });
    expect(res.statusCode).toBe(302);
    expect(store.getUser(u.id)?.name).toBe("Allison");
    expect(store.getUser(u.id)?.pin).toBe("1111"); // unchanged
  });

  it("POST /users/:id/edit updates pin when provided", async () => {
    const u = await store.addUser({ name: "Alice", pin: "1111" });
    await app.inject({
      method: "POST",
      url: `/users/${u.id}/edit`,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "name=Alice&pin=5678",
    });
    expect(store.getUser(u.id)?.pin).toBe("5678");
  });

  it("POST /users/:id/edit triggers onChange", async () => {
    let called = 0;
    await app.close();
    app = buildServer({ store, onUsersChanged: () => (called += 1) });
    const u = await store.addUser({ name: "Alice", pin: "1111" });
    await app.inject({
      method: "POST",
      url: `/users/${u.id}/edit`,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "name=Bob&pin=",
    });
    expect(called).toBe(1);
  });
});
