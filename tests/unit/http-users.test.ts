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
    expect(list.body).toContain("1234");
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

  it("GET /users/:id/row returns the display row with name and PIN", async () => {
    const u = await store.addUser({ name: "Alice", pin: "1234" });
    const res = await app.inject({ method: "GET", url: `/users/${u.id}/row` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.body).toContain("Alice");
    expect(res.body).toContain("1234");
    expect(res.body).toContain(`id="user-${u.id}"`);
  });

  it("GET /users/:id/edit-form returns an edit row with name and pin inputs pre-filled", async () => {
    const u = await store.addUser({ name: "Alice", pin: "1234" });
    const res = await app.inject({ method: "GET", url: `/users/${u.id}/edit-form` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.body).toContain('<input form="edit-');
    expect(res.body).toContain('name="name"');
    expect(res.body).toContain('name="pin"');
    expect(res.body).toContain('value="Alice"');
    expect(res.body).toContain('value="1234"');
  });

  it("POST /users/:id/edit with HX-Request returns display row HTML", async () => {
    const u = await store.addUser({ name: "Alice", pin: "1111" });
    const res = await app.inject({
      method: "POST",
      url: `/users/${u.id}/edit`,
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "hx-request": "true",
      },
      payload: "name=Allison&pin=2222",
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.body).toContain("Allison");
    expect(res.body).toContain("2222");
    expect(res.body).toContain(`id="user-${u.id}"`);
  });

  it("prefixes links with X-Ingress-Path when the header is present", async () => {
    await store.addUser({ name: "Alice", pin: "1234" });
    const res = await app.inject({
      method: "GET",
      url: "/users",
      headers: { "x-ingress-path": "/api/hassio_ingress/abc" },
    });
    expect(res.body).toContain('href="/api/hassio_ingress/abc/users"');
    expect(res.body).toContain('hx-get="/api/hassio_ingress/abc/status"');
  });

  it("uses bare paths when X-Ingress-Path is absent", async () => {
    await store.addUser({ name: "Alice", pin: "1234" });
    const res = await app.inject({ method: "GET", url: "/users" });
    expect(res.body).toContain('href="/users"');
    expect(res.body).toContain('hx-get="/status"');
  });

  it("redirects honor X-Ingress-Path on POST /users", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/users",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-ingress-path": "/api/hassio_ingress/xyz",
      },
      payload: "name=Bob&pin=4321",
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/api/hassio_ingress/xyz/users");
  });

  it("POST /users/:id/edit with an invalid PIN returns 400", async () => {
    const u = await store.addUser({ name: "Alice", pin: "1111" });
    const res = await app.inject({
      method: "POST",
      url: `/users/${u.id}/edit`,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "name=Alice&pin=abc",
    });
    expect(res.statusCode).toBe(400);
  });
});
