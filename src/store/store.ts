import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { ulid } from "ulid";
import { atomicWriteFile } from "../util/atomic-write.js";
import { allocateSlot } from "./slot-allocator.js";
import type { User, UserInput, UserPatch, UsersFile } from "./types.js";

export type StoreChangeEvent =
  | { type: "user.added"; user: User }
  | { type: "user.updated"; user: User; previous: User }
  | { type: "user.deleted"; user: User };

const PIN_PATTERN = /^[0-9]{4,10}$/;

function validatePin(pin: string): void {
  if (!PIN_PATTERN.test(pin)) {
    throw new Error(`Invalid PIN: must be 4-10 digits`);
  }
}

interface StoreOptions {
  path: string;
  maxSlots: number;
}

export class Store extends EventEmitter {
  private users: User[] = [];
  constructor(private readonly opts: StoreOptions) {
    super();
  }

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.opts.path, "utf8");
      const parsed = JSON.parse(raw) as UsersFile;
      this.users = parsed.users ?? [];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        this.users = [];
        return;
      }
      throw err;
    }
  }

  listUsers(): readonly User[] {
    return [...this.users];
  }

  getUser(id: string): User | undefined {
    return this.users.find((u) => u.id === id);
  }

  async addUser(input: UserInput): Promise<User> {
    validatePin(input.pin);
    const taken = new Set(this.users.map((u) => u.slot));
    let slot: number;
    if (input.slot !== undefined) {
      if (input.slot < 1 || input.slot > this.opts.maxSlots) {
        throw new Error(`Slot ${input.slot} is out of range [1, ${this.opts.maxSlots}]`);
      }
      if (taken.has(input.slot)) {
        throw new Error(`Slot ${input.slot} already taken`);
      }
      slot = input.slot;
    } else {
      slot = allocateSlot(taken, this.opts.maxSlots);
    }
    const now = new Date().toISOString();
    const user: User = {
      id: `u_${ulid()}`,
      name: input.name,
      pin: input.pin,
      enabled: input.enabled ?? true,
      slot,
      createdAt: now,
      updatedAt: now,
    };
    this.users.push(user);
    await this.persist();
    const evt: StoreChangeEvent = { type: "user.added", user };
    this.emit("change", evt);
    return user;
  }

  async updateUser(id: string, patch: UserPatch): Promise<User> {
    if (patch.pin !== undefined) validatePin(patch.pin);
    const idx = this.users.findIndex((u) => u.id === id);
    if (idx < 0) throw new Error(`Unknown user: ${id}`);
    const previous = this.users[idx]!;
    const updated: User = {
      ...previous,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    this.users[idx] = updated;
    await this.persist();
    const evt: StoreChangeEvent = { type: "user.updated", user: updated, previous };
    this.emit("change", evt);
    return updated;
  }

  async deleteUser(id: string): Promise<User> {
    const idx = this.users.findIndex((u) => u.id === id);
    if (idx < 0) throw new Error(`Unknown user: ${id}`);
    const [removed] = this.users.splice(idx, 1);
    await this.persist();
    const evt: StoreChangeEvent = { type: "user.deleted", user: removed! };
    this.emit("change", evt);
    return removed!;
  }

  private async persist(): Promise<void> {
    const file: UsersFile = { version: 1, users: this.users };
    await atomicWriteFile(this.opts.path, JSON.stringify(file, null, 2), { mode: 0o600 });
  }
}
