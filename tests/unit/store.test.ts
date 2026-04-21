import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../src/store/store.js";

async function makeStore() {
  const dir = await mkdtemp(join(tmpdir(), "store-"));
  const path = join(dir, "users.json");
  const store = new Store({ path, maxSlots: 30 });
  await store.load();
  return { store, path };
}

describe("Store", () => {
  it("starts empty when the file does not exist", async () => {
    const { store } = await makeStore();
    expect(store.listUsers()).toEqual([]);
  });

  it("addUser assigns slot 1 to the first user", async () => {
    const { store } = await makeStore();
    const alice = await store.addUser({ name: "Alice", pin: "1234" });
    expect(alice.slot).toBe(1);
    expect(alice.enabled).toBe(true);
    expect(alice.id).toMatch(/^u_[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("addUser assigns next free slot", async () => {
    const { store } = await makeStore();
    await store.addUser({ name: "Alice", pin: "1111" });
    const bob = await store.addUser({ name: "Bob", pin: "2222" });
    expect(bob.slot).toBe(2);
  });

  it("persists users to disk atomically", async () => {
    const { store, path } = await makeStore();
    await store.addUser({ name: "Alice", pin: "1234" });
    const contents = JSON.parse(await readFile(path, "utf8"));
    expect(contents.version).toBe(1);
    expect(contents.users).toHaveLength(1);
    expect(contents.users[0].name).toBe("Alice");
  });

  it("updateUser changes fields and bumps updatedAt", async () => {
    const { store } = await makeStore();
    const alice = await store.addUser({ name: "Alice", pin: "1234" });
    await new Promise((r) => setTimeout(r, 5));
    const updated = await store.updateUser(alice.id, { name: "Allison" });
    expect(updated.name).toBe("Allison");
    expect(updated.updatedAt > alice.updatedAt).toBe(true);
  });

  it("disabled user keeps slot reserved", async () => {
    const { store } = await makeStore();
    const alice = await store.addUser({ name: "Alice", pin: "1111" });
    await store.updateUser(alice.id, { enabled: false });
    const bob = await store.addUser({ name: "Bob", pin: "2222" });
    expect(bob.slot).toBe(2);
  });

  it("deleteUser frees the slot", async () => {
    const { store } = await makeStore();
    const alice = await store.addUser({ name: "Alice", pin: "1111" });
    await store.addUser({ name: "Bob", pin: "2222" });
    await store.deleteUser(alice.id);
    const cara = await store.addUser({ name: "Cara", pin: "3333" });
    expect(cara.slot).toBe(1);
  });

  it("emits change events", async () => {
    const { store } = await makeStore();
    const seen: string[] = [];
    store.on("change", (evt) => seen.push(evt.type));
    await store.addUser({ name: "Alice", pin: "1234" });
    expect(seen).toEqual(["user.added"]);
  });

  it("load re-reads persisted users", async () => {
    const { store, path } = await makeStore();
    await store.addUser({ name: "Alice", pin: "1234" });
    const store2 = new Store({ path, maxSlots: 30 });
    await store2.load();
    expect(store2.listUsers()).toHaveLength(1);
    expect(store2.listUsers()[0]?.name).toBe("Alice");
  });

  it("throws when capacity exhausted", async () => {
    const dir = await mkdtemp(join(tmpdir(), "store-tiny-"));
    const tiny = new Store({ path: join(dir, "users.json"), maxSlots: 1 });
    await tiny.load();
    await tiny.addUser({ name: "A", pin: "1" });
    await expect(tiny.addUser({ name: "B", pin: "2" })).rejects.toThrow(/no slot/i);
  });
});
