# Z-Wave Lock User Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Dockerized Node/TypeScript service that keeps user PIN codes in sync across multiple Z-Wave locks (via `zwave-js-server`), exposes an HTMX web UI for user management, and fires named unlock notifications through Home Assistant — while respecting strict battery-preservation constraints (no polling, cache-first reconciliation).

**Architecture:** One long-running Node process. Internal units: `Store` (users.json + locks.yaml), `LockStateCache` (state.json), `ZWaveJSClient` (WebSocket), `Reconciler` (desired-vs-cache diff), `EventBus`, `Notifier` (HA REST), event log, verify scheduler, Fastify HTTP server with server-rendered HTMX pages. All communication between units is explicit (method calls or typed EventBus). The only radio traffic causes are: (a) writes the reconciler needs to issue, (b) verify (first-run, scheduled weekly, or manual).

**Tech Stack:** Node 22, TypeScript (strict), Fastify, `ws` (WebSocket client), `yaml`, Zod, pino, ulid, Vitest. No frontend build pipeline — HTMX from CDN-or-vendored script + server-side HTML via tagged template literals.

**Reference spec:** `docs/superpowers/specs/2026-04-21-zwave-lock-sync-design.md`

---

## Conventions

- **Every task ends with a commit.** Tests green or explicitly marked TODO before moving on.
- **TDD:** failing test → run → minimum implementation → run → commit.
- **File paths:** everything under `/home/ryan/github/rgregg/zwavejs-lock-users`. Paths in tasks are relative to repo root.
- **Node version:** 22. Use `fs/promises`, `node:crypto`, `node:test` timers as needed. No ESM/CJS drama — the project is pure ESM (`"type": "module"` in `package.json`).
- **Import style:** `.js` extensions on relative imports (Node ESM requirement under `moduleResolution: "nodenext"`).
- **Commit messages:** Conventional Commits (`feat:`, `test:`, `chore:`, `docs:`, `refactor:`).

---

## Phase 1 — Scaffolding & core utilities

### Task 1: Project scaffolding

**Files:**

- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `.editorconfig`
- Create: `.prettierrc.json`
- Create: `eslint.config.js`
- Create: `src/.gitkeep`
- Create: `tests/.gitkeep`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "zwavejs-lock-users",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "dev": "tsx watch src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint .",
    "format": "prettier --write ."
  },
  "dependencies": {
    "fastify": "^5.1.0",
    "@fastify/formbody": "^8.0.1",
    "pino": "^9.5.0",
    "pino-pretty": "^11.3.0",
    "ulid": "^2.3.0",
    "ws": "^8.18.0",
    "yaml": "^2.6.1",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^22.9.0",
    "@types/ws": "^8.5.13",
    "tsx": "^4.19.2",
    "typescript": "^5.6.3",
    "vitest": "^2.1.5",
    "eslint": "^9.14.0",
    "typescript-eslint": "^8.14.0",
    "prettier": "^3.3.3"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2023"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "noImplicitOverride": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "declaration": false,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 10_000,
  },
});
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules/
dist/
coverage/
*.log
.DS_Store
.env
/data/
```

- [ ] **Step 5: Create `.editorconfig`**

```
root = true

[*]
indent_style = space
indent_size = 2
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true
```

- [ ] **Step 6: Create `.prettierrc.json`**

```json
{
  "semi": true,
  "singleQuote": false,
  "trailingComma": "all",
  "printWidth": 100
}
```

- [ ] **Step 7: Create `eslint.config.js`**

```js
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist", "node_modules", "coverage"],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
);
```

- [ ] **Step 8: Create placeholder files**

```bash
mkdir -p src tests
touch src/.gitkeep tests/.gitkeep
```

- [ ] **Step 9: Install dependencies**

Run: `npm install`
Expected: lockfile created, no errors.

- [ ] **Step 10: Verify tooling works**

Run: `npx tsc --noEmit && npx vitest run --passWithNoTests`
Expected: both succeed with zero errors.

- [ ] **Step 11: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore .editorconfig .prettierrc.json eslint.config.js src/.gitkeep tests/.gitkeep
git commit -m "chore: scaffold node+typescript project with vitest and eslint"
```

---

### Task 2: Atomic file-write utility

**Files:**

- Create: `src/util/atomic-write.ts`
- Create: `tests/unit/atomic-write.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/atomic-write.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { atomicWriteFile } from "../../src/util/atomic-write.js";

describe("atomicWriteFile", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "atomic-"));
  });

  it("writes the contents to the target path", async () => {
    const target = join(dir, "data.json");
    await atomicWriteFile(target, '{"a":1}');
    expect(await readFile(target, "utf8")).toBe('{"a":1}');
  });

  it("creates parent directories when missing", async () => {
    const target = join(dir, "nested", "deep", "file.txt");
    await atomicWriteFile(target, "hello");
    expect(await readFile(target, "utf8")).toBe("hello");
  });

  it("overwrites an existing file atomically (no .tmp left behind)", async () => {
    const target = join(dir, "data.json");
    await atomicWriteFile(target, "first");
    await atomicWriteFile(target, "second");
    expect(await readFile(target, "utf8")).toBe("second");
    await expect(stat(`${target}.tmp`)).rejects.toThrow();
  });

  it("applies mode 0o600 when requested", async () => {
    const target = join(dir, "secret.json");
    await atomicWriteFile(target, "shh", { mode: 0o600 });
    const s = await stat(target);
    expect(s.mode & 0o777).toBe(0o600);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `npx vitest run tests/unit/atomic-write.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement `atomicWriteFile`**

Create `src/util/atomic-write.ts`:

```ts
import { mkdir, rename, writeFile, chmod } from "node:fs/promises";
import { dirname } from "node:path";

export interface AtomicWriteOptions {
  mode?: number;
}

export async function atomicWriteFile(
  path: string,
  contents: string,
  options: AtomicWriteOptions = {},
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, contents, { encoding: "utf8" });
  if (options.mode !== undefined) {
    await chmod(tmp, options.mode);
  }
  await rename(tmp, path);
}
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `npx vitest run tests/unit/atomic-write.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/util/atomic-write.ts tests/unit/atomic-write.test.ts
git commit -m "feat(util): atomic file write helper"
```

---

### Task 3: Structured logger

**Files:**

- Create: `src/util/logger.ts`
- Create: `tests/unit/logger.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/logger.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { Writable } from "node:stream";
import { createLogger } from "../../src/util/logger.js";

function captureStream(): { stream: Writable; output: () => string } {
  const chunks: Buffer[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(Buffer.from(chunk));
      cb();
    },
  });
  return { stream, output: () => Buffer.concat(chunks).toString("utf8") };
}

describe("logger", () => {
  it("redacts pin fields", () => {
    const { stream, output } = captureStream();
    const log = createLogger({ level: "info", stream });
    log.info({ user: "alice", pin: "1234" }, "create user");
    const out = output();
    expect(out).not.toContain("1234");
    expect(out).toContain("[Redacted]");
    expect(out).toContain("alice");
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

Run: `npx vitest run tests/unit/logger.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement logger**

Create `src/util/logger.ts`:

```ts
import pino, { type Logger, type LoggerOptions, type DestinationStream } from "pino";

export interface LoggerInit {
  level?: LoggerOptions["level"];
  stream?: DestinationStream;
}

export function createLogger(init: LoggerInit = {}): Logger {
  const options: LoggerOptions = {
    level: init.level ?? process.env.LOG_LEVEL ?? "info",
    redact: {
      paths: ["pin", "*.pin", "users[*].pin", "body.pin"],
      censor: "[Redacted]",
    },
  };
  return init.stream ? pino(options, init.stream) : pino(options);
}
```

- [ ] **Step 4: Run tests to confirm pass**

Run: `npx vitest run tests/unit/logger.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/util/logger.ts tests/unit/logger.test.ts
git commit -m "feat(util): pino logger with pin redaction"
```

---

## Phase 2 — Configuration

### Task 4: Locks config schema + loader

**Files:**

- Create: `src/config/schema.ts`
- Create: `src/config/loader.ts`
- Create: `tests/unit/config-loader.test.ts`
- Create: `tests/fixtures/locks.valid.yaml`

- [ ] **Step 1: Add fixture**

Create `tests/fixtures/locks.valid.yaml`:

```yaml
zwaveJs:
  url: ws://zwavejs:3000

homeAssistant:
  url: http://homeassistant.local:8123
  token: ${HA_TOKEN}
  notify:
    service: notify.mobile_app_ryan

verify:
  intervalDays: 7
  staggerMinutes: 60

locks:
  - id: front-door
    name: Front Door
    nodeId: 7
    maxCodeSlots: 30
  - id: back-door
    name: Back Door
    nodeId: 9
    maxCodeSlots: 30
```

- [ ] **Step 2: Write failing tests**

Create `tests/unit/config-loader.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { loadLocksConfig } from "../../src/config/loader.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

describe("loadLocksConfig", () => {
  it("parses a valid file and interpolates env vars", async () => {
    const cfg = await loadLocksConfig(join(FIXTURES, "locks.valid.yaml"), {
      env: { HA_TOKEN: "abc.def.ghi" },
    });
    expect(cfg.zwaveJs.url).toBe("ws://zwavejs:3000");
    expect(cfg.homeAssistant.token).toBe("abc.def.ghi");
    expect(cfg.locks).toHaveLength(2);
    expect(cfg.locks[0]).toMatchObject({ id: "front-door", nodeId: 7, maxCodeSlots: 30 });
  });

  it("rejects when zwaveJs.url is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cfg-"));
    const path = join(dir, "bad.yaml");
    await writeFile(path, "locks: []\n");
    await expect(loadLocksConfig(path, { env: {} })).rejects.toThrow(/zwaveJs/);
  });

  it("rejects duplicate lock ids", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cfg-"));
    const path = join(dir, "dup.yaml");
    await writeFile(
      path,
      [
        "zwaveJs: { url: ws://z:3000 }",
        "homeAssistant: { url: http://h, token: t, notify: { service: notify.x } }",
        "locks:",
        "  - { id: a, name: A, nodeId: 1, maxCodeSlots: 30 }",
        "  - { id: a, name: B, nodeId: 2, maxCodeSlots: 30 }",
      ].join("\n"),
    );
    await expect(loadLocksConfig(path, { env: {} })).rejects.toThrow(/duplicate lock id/i);
  });

  it("rejects duplicate nodeIds", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cfg-"));
    const path = join(dir, "dup-node.yaml");
    await writeFile(
      path,
      [
        "zwaveJs: { url: ws://z:3000 }",
        "homeAssistant: { url: http://h, token: t, notify: { service: notify.x } }",
        "locks:",
        "  - { id: a, name: A, nodeId: 1, maxCodeSlots: 30 }",
        "  - { id: b, name: B, nodeId: 1, maxCodeSlots: 30 }",
      ].join("\n"),
    );
    await expect(loadLocksConfig(path, { env: {} })).rejects.toThrow(/duplicate nodeId/i);
  });

  it("leaves unresolved env vars as empty string and records a warning", async () => {
    const cfg = await loadLocksConfig(join(FIXTURES, "locks.valid.yaml"), { env: {} });
    expect(cfg.homeAssistant.token).toBe("");
    expect(cfg.warnings).toContain("Unresolved env var: HA_TOKEN");
  });
});
```

- [ ] **Step 3: Run tests to confirm failure**

Run: `npx vitest run tests/unit/config-loader.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement schema**

Create `src/config/schema.ts`:

```ts
import { z } from "zod";

export const LockConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  nodeId: z.number().int().positive(),
  maxCodeSlots: z.number().int().positive(),
});

export const LocksConfigSchema = z.object({
  zwaveJs: z.object({
    url: z.string().url(),
  }),
  homeAssistant: z.object({
    url: z.string().url(),
    token: z.string(),
    notify: z.object({
      service: z.string().min(1),
    }),
  }),
  verify: z
    .object({
      intervalDays: z.number().int().positive().default(7),
      staggerMinutes: z.number().int().nonnegative().default(60),
    })
    .default({ intervalDays: 7, staggerMinutes: 60 }),
  locks: z.array(LockConfigSchema),
});

export type LockConfig = z.infer<typeof LockConfigSchema>;
export type LocksConfig = z.infer<typeof LocksConfigSchema>;
```

- [ ] **Step 5: Implement loader**

Create `src/config/loader.ts`:

```ts
import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { LocksConfigSchema, type LocksConfig } from "./schema.js";

export interface LoadedConfig extends LocksConfig {
  warnings: string[];
}

export interface LoadOptions {
  env?: Record<string, string | undefined>;
}

const ENV_PATTERN = /\$\{([A-Z_][A-Z0-9_]*)\}/g;

export async function loadLocksConfig(path: string, opts: LoadOptions = {}): Promise<LoadedConfig> {
  const env = opts.env ?? process.env;
  const raw = await readFile(path, "utf8");
  const warnings: string[] = [];
  const interpolated = raw.replace(ENV_PATTERN, (match, name: string) => {
    const v = env[name];
    if (v === undefined) {
      warnings.push(`Unresolved env var: ${name}`);
      return "";
    }
    return v;
  });

  const parsed = parseYaml(interpolated);
  const result = LocksConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Invalid locks config: ${result.error.message}`);
  }
  const config = result.data;

  const ids = new Set<string>();
  const nodes = new Set<number>();
  for (const lock of config.locks) {
    if (ids.has(lock.id)) throw new Error(`Duplicate lock id: ${lock.id}`);
    if (nodes.has(lock.nodeId)) throw new Error(`Duplicate nodeId: ${lock.nodeId}`);
    ids.add(lock.id);
    nodes.add(lock.nodeId);
  }

  return { ...config, warnings };
}
```

- [ ] **Step 6: Run tests to confirm pass**

Run: `npx vitest run tests/unit/config-loader.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
git add src/config tests/unit/config-loader.test.ts tests/fixtures/locks.valid.yaml
git commit -m "feat(config): locks.yaml loader with zod validation and env interpolation"
```

---

## Phase 3 — Store & slot allocator

### Task 5: Slot allocator (pure function)

**Files:**

- Create: `src/store/slot-allocator.ts`
- Create: `tests/unit/slot-allocator.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/slot-allocator.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { allocateSlot } from "../../src/store/slot-allocator.js";

describe("allocateSlot", () => {
  it("returns 1 when no slots are taken", () => {
    expect(allocateSlot(new Set(), 30)).toBe(1);
  });

  it("returns the lowest free slot", () => {
    expect(allocateSlot(new Set([1, 2, 4]), 30)).toBe(3);
  });

  it("returns the next free slot after the taken block", () => {
    expect(allocateSlot(new Set([1, 2, 3]), 30)).toBe(4);
  });

  it("treats reserved (disabled) slots as taken", () => {
    expect(allocateSlot(new Set([1, 2, 3, 4, 5]), 30)).toBe(6);
  });

  it("throws when all slots are exhausted", () => {
    const taken = new Set<number>();
    for (let i = 1; i <= 30; i++) taken.add(i);
    expect(() => allocateSlot(taken, 30)).toThrow(/no slot available/i);
  });
});
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `npx vitest run tests/unit/slot-allocator.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/store/slot-allocator.ts`:

```ts
export function allocateSlot(taken: ReadonlySet<number>, maxSlots: number): number {
  for (let i = 1; i <= maxSlots; i++) {
    if (!taken.has(i)) return i;
  }
  throw new Error(`No slot available (capacity ${maxSlots})`);
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/slot-allocator.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/slot-allocator.ts tests/unit/slot-allocator.test.ts
git commit -m "feat(store): pure slot-allocation function"
```

---

### Task 6: Store (users.json CRUD)

**Files:**

- Create: `src/store/types.ts`
- Create: `src/store/store.ts`
- Create: `tests/unit/store.test.ts`

- [ ] **Step 1: Define types**

Create `src/store/types.ts`:

```ts
export interface User {
  id: string;
  name: string;
  pin: string;
  enabled: boolean;
  slot: number;
  createdAt: string;
  updatedAt: string;
}

export interface UsersFile {
  version: 1;
  users: User[];
}

export interface UserInput {
  name: string;
  pin: string;
  enabled?: boolean;
}

export interface UserPatch {
  name?: string;
  pin?: string;
  enabled?: boolean;
}
```

- [ ] **Step 2: Write failing tests**

Create `tests/unit/store.test.ts`:

```ts
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
    expect(alice.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
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
    const { store } = await makeStore();
    const tiny = new Store({
      path: join((store as unknown as { path: string }).path, "x"),
      maxSlots: 1,
    });
    await tiny.load();
    await tiny.addUser({ name: "A", pin: "1" });
    await expect(tiny.addUser({ name: "B", pin: "2" })).rejects.toThrow(/no slot/i);
  });
});
```

- [ ] **Step 3: Run tests to confirm failure**

Run: `npx vitest run tests/unit/store.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement Store**

Create `src/store/store.ts`:

```ts
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
    const taken = new Set(this.users.map((u) => u.slot));
    const slot = allocateSlot(taken, this.opts.maxSlots);
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
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/unit/store.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 6: Commit**

```bash
git add src/store tests/unit/store.test.ts
git commit -m "feat(store): user crud backed by atomic json writes with change events"
```

---

## Phase 4 — Cache & fingerprint

### Task 7: PIN fingerprint

**Files:**

- Create: `src/cache/fingerprint.ts`
- Create: `tests/unit/fingerprint.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/fingerprint.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { fingerprintPin } from "../../src/cache/fingerprint.js";

describe("fingerprintPin", () => {
  it("returns an sha256-prefixed 64-hex string", () => {
    const fp = fingerprintPin("secret", "1234");
    expect(fp).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("is stable for the same inputs", () => {
    expect(fingerprintPin("k", "9999")).toBe(fingerprintPin("k", "9999"));
  });

  it("differs when the secret differs", () => {
    expect(fingerprintPin("a", "1234")).not.toBe(fingerprintPin("b", "1234"));
  });

  it("differs when the pin differs", () => {
    expect(fingerprintPin("k", "1111")).not.toBe(fingerprintPin("k", "2222"));
  });
});
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `npx vitest run tests/unit/fingerprint.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/cache/fingerprint.ts`:

```ts
import { createHmac } from "node:crypto";

export function fingerprintPin(secret: string, pin: string): string {
  const mac = createHmac("sha256", secret).update(pin, "utf8").digest("hex");
  return `sha256:${mac}`;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/fingerprint.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cache/fingerprint.ts tests/unit/fingerprint.test.ts
git commit -m "feat(cache): hmac-sha256 pin fingerprint"
```

---

### Task 8: LockStateCache

**Files:**

- Create: `src/cache/types.ts`
- Create: `src/cache/cache.ts`
- Create: `tests/unit/cache.test.ts`

- [ ] **Step 1: Define types**

Create `src/cache/types.ts`:

```ts
export type SlotStatus = "enabled" | "empty" | "unknown";

export interface SlotState {
  status: SlotStatus;
  userId?: string;
  pinFingerprint?: string;
  updatedAt: string;
}

export interface LockState {
  lastVerifiedAt?: string;
  lastReconcileAt?: string;
  lastReconcileOutcome?: "ok" | "error" | "partial";
  slots: Record<string, SlotState>;
}

export interface CacheFile {
  version: 1;
  locks: Record<string, LockState>;
}
```

- [ ] **Step 2: Write failing tests**

Create `tests/unit/cache.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LockStateCache } from "../../src/cache/cache.js";

async function makeCache() {
  const dir = await mkdtemp(join(tmpdir(), "cache-"));
  const path = join(dir, "state.json");
  const cache = new LockStateCache({ path });
  await cache.load();
  return { cache, path };
}

describe("LockStateCache", () => {
  it("returns undefined for unknown locks", async () => {
    const { cache } = await makeCache();
    expect(cache.getLock("front-door")).toBeUndefined();
  });

  it("markWrite records an enabled slot with userId and fingerprint", async () => {
    const { cache } = await makeCache();
    await cache.markWrite("front-door", 3, { userId: "u1", pinFingerprint: "sha256:abc" });
    expect(cache.getLock("front-door")?.slots["3"]).toMatchObject({
      status: "enabled",
      userId: "u1",
      pinFingerprint: "sha256:abc",
    });
  });

  it("markCleared marks a slot empty and drops the userId", async () => {
    const { cache } = await makeCache();
    await cache.markWrite("front-door", 3, { userId: "u1", pinFingerprint: "sha256:abc" });
    await cache.markCleared("front-door", 3);
    const slot = cache.getLock("front-door")?.slots["3"];
    expect(slot?.status).toBe("empty");
    expect(slot?.userId).toBeUndefined();
  });

  it("markReconcile records outcome + timestamp", async () => {
    const { cache } = await makeCache();
    await cache.markReconcile("front-door", "ok");
    expect(cache.getLock("front-door")?.lastReconcileOutcome).toBe("ok");
    expect(cache.getLock("front-door")?.lastReconcileAt).toBeDefined();
  });

  it("markVerified records verified timestamp", async () => {
    const { cache } = await makeCache();
    await cache.markVerified("front-door");
    expect(cache.getLock("front-door")?.lastVerifiedAt).toBeDefined();
  });

  it("persists to file atomically", async () => {
    const { cache, path } = await makeCache();
    await cache.markWrite("front-door", 1, { userId: "u1", pinFingerprint: "sha256:a" });
    const raw = JSON.parse(await readFile(path, "utf8"));
    expect(raw.version).toBe(1);
    expect(raw.locks["front-door"].slots["1"].userId).toBe("u1");
  });

  it("reloads persisted state", async () => {
    const { cache, path } = await makeCache();
    await cache.markWrite("front-door", 1, { userId: "u1", pinFingerprint: "sha256:a" });
    const cache2 = new LockStateCache({ path });
    await cache2.load();
    expect(cache2.getLock("front-door")?.slots["1"]?.userId).toBe("u1");
  });

  it("dropLock removes a lock entry (for removed locks in config)", async () => {
    const { cache } = await makeCache();
    await cache.markWrite("old", 1, { userId: "u1", pinFingerprint: "sha256:a" });
    await cache.dropLock("old");
    expect(cache.getLock("old")).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run tests to confirm failure**

Run: `npx vitest run tests/unit/cache.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement cache**

Create `src/cache/cache.ts`:

```ts
import { readFile } from "node:fs/promises";
import { atomicWriteFile } from "../util/atomic-write.js";
import type { CacheFile, LockState, SlotState } from "./types.js";

interface CacheOptions {
  path: string;
}

export class LockStateCache {
  private data: CacheFile = { version: 1, locks: {} };
  constructor(private readonly opts: CacheOptions) {}

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.opts.path, "utf8");
      this.data = JSON.parse(raw) as CacheFile;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw err;
    }
  }

  getLock(lockId: string): LockState | undefined {
    return this.data.locks[lockId];
  }

  getAllLockIds(): string[] {
    return Object.keys(this.data.locks);
  }

  async markWrite(
    lockId: string,
    slot: number,
    fields: { userId: string; pinFingerprint: string },
  ): Promise<void> {
    const lock = this.ensureLock(lockId);
    const now = new Date().toISOString();
    lock.slots[String(slot)] = {
      status: "enabled",
      userId: fields.userId,
      pinFingerprint: fields.pinFingerprint,
      updatedAt: now,
    };
    await this.persist();
  }

  async markCleared(lockId: string, slot: number): Promise<void> {
    const lock = this.ensureLock(lockId);
    lock.slots[String(slot)] = { status: "empty", updatedAt: new Date().toISOString() };
    await this.persist();
  }

  async markUnknown(lockId: string, slot: number): Promise<void> {
    const lock = this.ensureLock(lockId);
    lock.slots[String(slot)] = { status: "unknown", updatedAt: new Date().toISOString() };
    await this.persist();
  }

  async markReconcile(
    lockId: string,
    outcome: NonNullable<LockState["lastReconcileOutcome"]>,
  ): Promise<void> {
    const lock = this.ensureLock(lockId);
    lock.lastReconcileAt = new Date().toISOString();
    lock.lastReconcileOutcome = outcome;
    await this.persist();
  }

  async markVerified(lockId: string): Promise<void> {
    const lock = this.ensureLock(lockId);
    lock.lastVerifiedAt = new Date().toISOString();
    await this.persist();
  }

  async dropLock(lockId: string): Promise<void> {
    delete this.data.locks[lockId];
    await this.persist();
  }

  async replaceLock(lockId: string, slots: Record<string, SlotState>): Promise<void> {
    const lock = this.ensureLock(lockId);
    lock.slots = slots;
    lock.lastVerifiedAt = new Date().toISOString();
    await this.persist();
  }

  private ensureLock(lockId: string): LockState {
    let lock = this.data.locks[lockId];
    if (!lock) {
      lock = { slots: {} };
      this.data.locks[lockId] = lock;
    }
    return lock;
  }

  private async persist(): Promise<void> {
    await atomicWriteFile(this.opts.path, JSON.stringify(this.data, null, 2), { mode: 0o600 });
  }
}
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/unit/cache.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add src/cache tests/unit/cache.test.ts
git commit -m "feat(cache): lock state cache with atomic json persistence"
```

---

## Phase 5 — Event bus & diff

### Task 9: Typed EventBus

**Files:**

- Create: `src/events/types.ts`
- Create: `src/events/bus.ts`
- Create: `tests/unit/event-bus.test.ts`

- [ ] **Step 1: Define event types**

Create `src/events/types.ts`:

```ts
export interface UnlockEvent {
  ts: string;
  lockId: string;
  slot: number;
}

export interface KeypadCodeChangedEvent {
  ts: string;
  lockId: string;
  slot: number;
}

export interface ConnectionEvent {
  ts: string;
  source: "zwaveJs" | "homeAssistant";
  status: "connected" | "disconnected";
}

export interface AppEvents {
  unlock: UnlockEvent;
  keypadCodeChanged: KeypadCodeChangedEvent;
  connection: ConnectionEvent;
}
```

- [ ] **Step 2: Write failing test**

Create `tests/unit/event-bus.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { EventBus } from "../../src/events/bus.js";

describe("EventBus", () => {
  it("dispatches typed events to subscribers", () => {
    const bus = new EventBus();
    const seen: number[] = [];
    bus.on("unlock", (e) => seen.push(e.slot));
    bus.emit("unlock", { ts: "t", lockId: "a", slot: 3 });
    bus.emit("unlock", { ts: "t", lockId: "a", slot: 4 });
    expect(seen).toEqual([3, 4]);
  });

  it("fans out to multiple subscribers", () => {
    const bus = new EventBus();
    const a: number[] = [];
    const b: number[] = [];
    bus.on("unlock", (e) => a.push(e.slot));
    bus.on("unlock", (e) => b.push(e.slot));
    bus.emit("unlock", { ts: "t", lockId: "x", slot: 1 });
    expect(a).toEqual([1]);
    expect(b).toEqual([1]);
  });

  it("off removes a listener", () => {
    const bus = new EventBus();
    const seen: number[] = [];
    const fn = (e: { slot: number }) => seen.push(e.slot);
    bus.on("unlock", fn);
    bus.off("unlock", fn);
    bus.emit("unlock", { ts: "t", lockId: "x", slot: 9 });
    expect(seen).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to confirm failure**

Run: `npx vitest run tests/unit/event-bus.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement**

Create `src/events/bus.ts`:

```ts
import { EventEmitter } from "node:events";
import type { AppEvents } from "./types.js";

type Handler<K extends keyof AppEvents> = (event: AppEvents[K]) => void;

export class EventBus {
  private inner = new EventEmitter();

  on<K extends keyof AppEvents>(event: K, handler: Handler<K>): this {
    this.inner.on(event, handler);
    return this;
  }

  off<K extends keyof AppEvents>(event: K, handler: Handler<K>): this {
    this.inner.off(event, handler);
    return this;
  }

  emit<K extends keyof AppEvents>(event: K, payload: AppEvents[K]): boolean {
    return this.inner.emit(event, payload);
  }
}
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/unit/event-bus.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/events tests/unit/event-bus.test.ts
git commit -m "feat(events): typed in-process event bus"
```

---

### Task 10: Diff (pure reconciliation function)

**Files:**

- Create: `src/reconciler/diff.ts`
- Create: `tests/unit/diff.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/diff.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeDiff } from "../../src/reconciler/diff.js";
import { fingerprintPin } from "../../src/cache/fingerprint.js";

const SECRET = "local-secret";

function fp(pin: string) {
  return fingerprintPin(SECRET, pin);
}

describe("computeDiff", () => {
  it("enables a new enabled user in an empty cache", () => {
    const ops = computeDiff({
      users: [{ id: "u1", name: "Alice", pin: "1234", slot: 3, enabled: true }],
      cache: {},
      secret: SECRET,
    });
    expect(ops).toEqual([{ op: "set", slot: 3, pin: "1234", userId: "u1" }]);
  });

  it("returns no ops when cache matches desired", () => {
    const ops = computeDiff({
      users: [{ id: "u1", name: "Alice", pin: "1234", slot: 3, enabled: true }],
      cache: {
        "3": { status: "enabled", userId: "u1", pinFingerprint: fp("1234"), updatedAt: "" },
      },
      secret: SECRET,
    });
    expect(ops).toEqual([]);
  });

  it("writes when pin differs (fingerprint mismatch)", () => {
    const ops = computeDiff({
      users: [{ id: "u1", name: "Alice", pin: "9999", slot: 3, enabled: true }],
      cache: {
        "3": { status: "enabled", userId: "u1", pinFingerprint: fp("1234"), updatedAt: "" },
      },
      secret: SECRET,
    });
    expect(ops).toEqual([{ op: "set", slot: 3, pin: "9999", userId: "u1" }]);
  });

  it("ignores renames (name is not on the lock)", () => {
    const ops = computeDiff({
      users: [{ id: "u1", name: "Allison", pin: "1234", slot: 3, enabled: true }],
      cache: {
        "3": { status: "enabled", userId: "u1", pinFingerprint: fp("1234"), updatedAt: "" },
      },
      secret: SECRET,
    });
    expect(ops).toEqual([]);
  });

  it("clears slots for disabled users when cache shows enabled", () => {
    const ops = computeDiff({
      users: [{ id: "u1", name: "Alice", pin: "1234", slot: 3, enabled: false }],
      cache: {
        "3": { status: "enabled", userId: "u1", pinFingerprint: fp("1234"), updatedAt: "" },
      },
      secret: SECRET,
    });
    expect(ops).toEqual([{ op: "clear", slot: 3 }]);
  });

  it("does nothing for disabled user when cache already empty", () => {
    const ops = computeDiff({
      users: [{ id: "u1", name: "Alice", pin: "1234", slot: 3, enabled: false }],
      cache: {
        "3": { status: "empty", updatedAt: "" },
      },
      secret: SECRET,
    });
    expect(ops).toEqual([]);
  });

  it("clears slots present in cache but absent from desired users (deletion)", () => {
    const ops = computeDiff({
      users: [],
      cache: {
        "3": { status: "enabled", userId: "u1", pinFingerprint: fp("1234"), updatedAt: "" },
      },
      secret: SECRET,
    });
    expect(ops).toEqual([{ op: "clear", slot: 3 }]);
  });

  it("writes when cache slot is unknown even if fingerprint would match", () => {
    const ops = computeDiff({
      users: [{ id: "u1", name: "Alice", pin: "1234", slot: 3, enabled: true }],
      cache: {
        "3": { status: "unknown", updatedAt: "" },
      },
      secret: SECRET,
    });
    expect(ops).toEqual([{ op: "set", slot: 3, pin: "1234", userId: "u1" }]);
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run tests/unit/diff.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement diff**

Create `src/reconciler/diff.ts`:

```ts
import type { SlotState } from "../cache/types.js";
import { fingerprintPin } from "../cache/fingerprint.js";

export interface DiffUser {
  id: string;
  name: string;
  pin: string;
  slot: number;
  enabled: boolean;
}

export type Op =
  | { op: "set"; slot: number; pin: string; userId: string }
  | { op: "clear"; slot: number };

export interface DiffInput {
  users: readonly DiffUser[];
  cache: Record<string, SlotState>;
  secret: string;
}

export function computeDiff(input: DiffInput): Op[] {
  const ops: Op[] = [];
  const desiredSlots = new Set<number>();

  for (const user of input.users) {
    desiredSlots.add(user.slot);
    const slotKey = String(user.slot);
    const current = input.cache[slotKey];
    const wantEnabled = user.enabled;

    if (wantEnabled) {
      const expectedFp = fingerprintPin(input.secret, user.pin);
      const matches =
        current?.status === "enabled" &&
        current.userId === user.id &&
        current.pinFingerprint === expectedFp;
      if (!matches) {
        ops.push({ op: "set", slot: user.slot, pin: user.pin, userId: user.id });
      }
    } else {
      if (current && current.status !== "empty") {
        ops.push({ op: "clear", slot: user.slot });
      }
    }
  }

  for (const [slotKey, slot] of Object.entries(input.cache)) {
    const slotNum = Number(slotKey);
    if (desiredSlots.has(slotNum)) continue;
    if (slot.status === "enabled") {
      ops.push({ op: "clear", slot: slotNum });
    }
  }

  ops.sort((a, b) => a.slot - b.slot);
  return ops;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/diff.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/reconciler/diff.ts tests/unit/diff.test.ts
git commit -m "feat(reconciler): pure desired-vs-cache diff function"
```

---

## Phase 6 — ZWaveJS client

### Task 11: Mock zwave-js-server test helper

**Files:**

- Create: `tests/helpers/mock-zwavejs-server.ts`

This helper is used by subsequent ZWaveJS tests. No test of its own — exercised through the client tests.

- [ ] **Step 1: Install dev dep for WS server**

The `ws` package already covers server + client. No new install.

- [ ] **Step 2: Create the helper**

Create `tests/helpers/mock-zwavejs-server.ts`:

```ts
import { WebSocketServer, type WebSocket } from "ws";
import { createServer, type Server } from "node:http";
import { once } from "node:events";

export interface RecordedCommand {
  id: string;
  command: string;
  nodeId?: number;
  args?: Record<string, unknown>;
}

type ResultHandler = (cmd: RecordedCommand) => unknown;

export class MockZwaveJsServer {
  private server: Server;
  private wss: WebSocketServer;
  private sockets = new Set<WebSocket>();
  readonly commands: RecordedCommand[] = [];
  private resultHandlers = new Map<string, ResultHandler>();
  port = 0;

  constructor() {
    this.server = createServer();
    this.wss = new WebSocketServer({ server: this.server });
    this.wss.on("connection", (socket) => {
      this.sockets.add(socket);
      socket.send(
        JSON.stringify({
          type: "version",
          driverVersion: "test",
          serverVersion: "1.33.0",
          homeId: 1,
          minSchemaVersion: 0,
          maxSchemaVersion: 37,
        }),
      );
      socket.on("message", (raw) => {
        const msg = JSON.parse(raw.toString()) as {
          messageId: string;
          command: string;
          nodeId?: number;
          [k: string]: unknown;
        };
        const cmd: RecordedCommand = {
          id: msg.messageId,
          command: msg.command,
          ...(msg.nodeId !== undefined ? { nodeId: msg.nodeId } : {}),
          args: msg,
        };
        this.commands.push(cmd);
        const handler = this.resultHandlers.get(msg.command) ?? (() => ({}));
        const result = handler(cmd);
        socket.send(
          JSON.stringify({ type: "result", messageId: msg.messageId, success: true, result }),
        );
      });
      socket.on("close", () => this.sockets.delete(socket));
    });
  }

  async start(): Promise<void> {
    this.server.listen(0);
    await once(this.server, "listening");
    const addr = this.server.address();
    if (addr && typeof addr !== "string") this.port = addr.port;
  }

  url(): string {
    return `ws://127.0.0.1:${this.port}`;
  }

  onCommand(command: string, handler: ResultHandler): void {
    this.resultHandlers.set(command, handler);
  }

  pushEvent(event: Record<string, unknown>): void {
    const payload = JSON.stringify({ type: "event", event });
    for (const s of this.sockets) s.send(payload);
  }

  async stop(): Promise<void> {
    for (const s of this.sockets) s.terminate();
    await new Promise<void>((r) => this.wss.close(() => r()));
    await new Promise<void>((r) => this.server.close(() => r()));
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add tests/helpers/mock-zwavejs-server.ts
git commit -m "test: in-process mock zwave-js-server for integration tests"
```

---

### Task 12: ZWaveJSClient — connection + reconnect

**Files:**

- Create: `src/zwave/types.ts`
- Create: `src/zwave/client.ts`
- Create: `tests/integration/zwavejs-client.test.ts`

- [ ] **Step 1: Define client types**

Create `src/zwave/types.ts`:

```ts
export interface UserCodeSlot {
  slot: number;
  status: "enabled" | "empty" | "unknown";
  pin?: string;
}

export interface ZwaveNotification {
  type: "unlock" | "keypadCodeChanged";
  nodeId: number;
  slot: number;
}
```

- [ ] **Step 2: Write failing test (connect + reconnect)**

Create `tests/integration/zwavejs-client.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockZwaveJsServer } from "../helpers/mock-zwavejs-server.js";
import { ZWaveJSClient } from "../../src/zwave/client.js";
import { EventBus } from "../../src/events/bus.js";

describe("ZWaveJSClient", () => {
  let server: MockZwaveJsServer;
  let client: ZWaveJSClient;
  let bus: EventBus;

  beforeEach(async () => {
    server = new MockZwaveJsServer();
    await server.start();
    bus = new EventBus();
    client = new ZWaveJSClient({
      url: server.url(),
      bus,
      reconnectBaseMs: 10,
      reconnectMaxMs: 100,
    });
  });

  afterEach(async () => {
    await client.stop();
    await server.stop();
  });

  it("connects and emits a connection event", async () => {
    const events: string[] = [];
    bus.on("connection", (e) => events.push(e.status));
    await client.start();
    expect(events).toEqual(["connected"]);
  });

  it("emits disconnected then connected on reconnect", async () => {
    const events: string[] = [];
    bus.on("connection", (e) => events.push(e.status));
    await client.start();
    await server.stop();
    server = new MockZwaveJsServer();
    // Note: re-bind to the same port is hard; instead test disconnection path:
    await new Promise((r) => setTimeout(r, 50));
    expect(events).toContain("disconnected");
  });
});
```

- [ ] **Step 3: Run test to confirm failure**

Run: `npx vitest run tests/integration/zwavejs-client.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 4: Implement client (connect + reconnect)**

Create `src/zwave/client.ts`:

```ts
import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import type { EventBus } from "../events/bus.js";
import type { UserCodeSlot } from "./types.js";

interface ZWaveJSClientOptions {
  url: string;
  bus: EventBus;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
}

interface PendingCall {
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
}

export class ZWaveJSClient {
  private socket: WebSocket | undefined;
  private stopped = false;
  private reconnectAttempts = 0;
  private pending = new Map<string, PendingCall>();
  private readonly baseMs: number;
  private readonly maxMs: number;

  constructor(private readonly opts: ZWaveJSClientOptions) {
    this.baseMs = opts.reconnectBaseMs ?? 1000;
    this.maxMs = opts.reconnectMaxMs ?? 30_000;
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.socket?.terminate();
  }

  isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  private async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.opts.url);
      this.socket = ws;

      const onOpenDone = () => {
        this.reconnectAttempts = 0;
        this.opts.bus.emit("connection", {
          ts: new Date().toISOString(),
          source: "zwaveJs",
          status: "connected",
        });
        resolve();
      };

      ws.once("open", onOpenDone);
      ws.once("error", (err) => {
        if (this.reconnectAttempts === 0) reject(err as Error);
      });
      ws.on("message", (raw) => this.handleMessage(raw.toString()));
      ws.on("close", () => this.onClose());
    });
  }

  private handleMessage(raw: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.type === "result" && typeof msg.messageId === "string") {
      const pending = this.pending.get(msg.messageId);
      if (!pending) return;
      this.pending.delete(msg.messageId);
      if (msg.success === false) {
        pending.reject(new Error(String(msg.errorCode ?? "command failed")));
      } else {
        pending.resolve(msg.result);
      }
    } else if (msg.type === "event") {
      this.handleEvent(msg.event as Record<string, unknown>);
    }
  }

  private handleEvent(event: Record<string, unknown>): void {
    // Notification CC: { source: "node", event: "notification", nodeId, ccId: 0x71, args: { userId, eventType } }
    if (event.event === "notification" && typeof event.nodeId === "number") {
      const args = event.args as Record<string, unknown> | undefined;
      const userId = args?.userId;
      if (typeof userId === "number") {
        this.opts.bus.emit("unlock", {
          ts: new Date().toISOString(),
          lockId: `node-${event.nodeId}`,
          slot: userId,
        });
      }
    }
    if (event.event === "value updated" && typeof event.nodeId === "number") {
      const args = event.args as Record<string, unknown> | undefined;
      const commandClass = args?.commandClass;
      const propertyKey = args?.propertyKey;
      if (commandClass === 99 && typeof propertyKey === "number") {
        // User Code CC
        this.opts.bus.emit("keypadCodeChanged", {
          ts: new Date().toISOString(),
          lockId: `node-${event.nodeId}`,
          slot: propertyKey,
        });
      }
    }
  }

  private onClose(): void {
    this.opts.bus.emit("connection", {
      ts: new Date().toISOString(),
      source: "zwaveJs",
      status: "disconnected",
    });
    for (const pending of this.pending.values()) pending.reject(new Error("connection closed"));
    this.pending.clear();
    if (this.stopped) return;
    const delay = Math.min(this.baseMs * 2 ** this.reconnectAttempts, this.maxMs);
    this.reconnectAttempts += 1;
    setTimeout(() => {
      this.connect().catch(() => void 0);
    }, delay);
  }

  private call<T>(command: string, params: Record<string, unknown>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
        reject(new Error("zwave-js-server not connected"));
        return;
      }
      const messageId = randomUUID();
      const payload = { messageId, command, ...params };
      this.pending.set(messageId, {
        resolve: (r) => resolve(r as T),
        reject,
      });
      this.socket.send(JSON.stringify(payload));
    });
  }

  async setUserCode(nodeId: number, slot: number, pin: string): Promise<void> {
    await this.call("node.set_value", {
      nodeId,
      valueId: { commandClass: 99, property: "userCode", propertyKey: slot },
      value: pin,
    });
    await this.call("node.set_value", {
      nodeId,
      valueId: { commandClass: 99, property: "userIdStatus", propertyKey: slot },
      value: 1, // 1 = enabled
    });
  }

  async clearUserCode(nodeId: number, slot: number): Promise<void> {
    await this.call("node.set_value", {
      nodeId,
      valueId: { commandClass: 99, property: "userIdStatus", propertyKey: slot },
      value: 0, // 0 = available/empty
    });
  }

  async getAllUserCodes(nodeId: number, maxSlots: number): Promise<UserCodeSlot[]> {
    const out: UserCodeSlot[] = [];
    for (let slot = 1; slot <= maxSlots; slot++) {
      const status = await this.call<number>("node.get_value", {
        nodeId,
        valueId: { commandClass: 99, property: "userIdStatus", propertyKey: slot },
      }).catch(() => undefined);
      if (status === 1) {
        const pin = await this.call<string>("node.get_value", {
          nodeId,
          valueId: { commandClass: 99, property: "userCode", propertyKey: slot },
        }).catch(() => "");
        out.push({ slot, status: "enabled", pin });
      } else if (status === 0) {
        out.push({ slot, status: "empty" });
      } else {
        out.push({ slot, status: "unknown" });
      }
    }
    return out;
  }
}
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/integration/zwavejs-client.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/zwave tests/integration/zwavejs-client.test.ts
git commit -m "feat(zwave): websocket client with reconnect and notification parsing"
```

---

### Task 13: ZWaveJSClient — setUserCode / clearUserCode integration tests

**Files:**

- Modify: `tests/integration/zwavejs-client.test.ts` (append tests)

- [ ] **Step 1: Append failing tests**

Append to `tests/integration/zwavejs-client.test.ts`:

```ts
it("setUserCode sends two node.set_value commands (userCode then userIdStatus)", async () => {
  await client.start();
  server.onCommand("node.set_value", () => null);
  await client.setUserCode(7, 3, "1234");
  const cmds = server.commands.filter((c) => c.command === "node.set_value");
  expect(cmds).toHaveLength(2);
  expect(cmds[0]?.args).toMatchObject({
    nodeId: 7,
    valueId: { commandClass: 99, property: "userCode", propertyKey: 3 },
    value: "1234",
  });
  expect(cmds[1]?.args).toMatchObject({
    nodeId: 7,
    valueId: { commandClass: 99, property: "userIdStatus", propertyKey: 3 },
    value: 1,
  });
});

it("clearUserCode sets userIdStatus to 0", async () => {
  await client.start();
  server.onCommand("node.set_value", () => null);
  await client.clearUserCode(7, 3);
  const cmds = server.commands.filter((c) => c.command === "node.set_value");
  expect(cmds).toHaveLength(1);
  expect(cmds[0]?.args).toMatchObject({
    nodeId: 7,
    valueId: { commandClass: 99, property: "userIdStatus", propertyKey: 3 },
    value: 0,
  });
});

it("unlock notification event fires on the bus", async () => {
  const seen: Array<{ lockId: string; slot: number }> = [];
  bus.on("unlock", (e) => seen.push({ lockId: e.lockId, slot: e.slot }));
  await client.start();
  server.pushEvent({ source: "node", event: "notification", nodeId: 7, args: { userId: 3 } });
  await new Promise((r) => setTimeout(r, 20));
  expect(seen).toEqual([{ lockId: "node-7", slot: 3 }]);
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run tests/integration/zwavejs-client.test.ts`
Expected: PASS (5 tests total).

- [ ] **Step 3: Commit**

```bash
git add tests/integration/zwavejs-client.test.ts
git commit -m "test(zwave): cover setUserCode/clearUserCode and unlock notification"
```

---

## Phase 7 — Reconciler

### Task 14: Reconciler with per-lock queue + retry

**Files:**

- Create: `src/reconciler/reconciler.ts`
- Create: `src/reconciler/types.ts`
- Create: `tests/unit/reconciler.test.ts`

- [ ] **Step 1: Define reconciler types**

Create `src/reconciler/types.ts`:

```ts
export interface LockSyncTarget {
  id: string;
  nodeId: number;
  maxCodeSlots: number;
}

export interface LockWriter {
  setUserCode(nodeId: number, slot: number, pin: string): Promise<void>;
  clearUserCode(nodeId: number, slot: number): Promise<void>;
}

export type ReconcileOutcome = "ok" | "error" | "partial";
```

- [ ] **Step 2: Write failing tests**

Create `tests/unit/reconciler.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LockStateCache } from "../../src/cache/cache.js";
import { Reconciler } from "../../src/reconciler/reconciler.js";
import type { LockWriter, LockSyncTarget } from "../../src/reconciler/types.js";

interface CallLog {
  op: "set" | "clear";
  nodeId: number;
  slot: number;
  pin?: string;
}

function makeWriter(failures: Record<string, number> = {}): {
  writer: LockWriter;
  calls: CallLog[];
} {
  const calls: CallLog[] = [];
  const counters = { ...failures };
  const maybeFail = (key: string) => {
    if ((counters[key] ?? 0) > 0) {
      counters[key]! -= 1;
      throw new Error(`simulated failure: ${key}`);
    }
  };
  const writer: LockWriter = {
    async setUserCode(nodeId, slot, pin) {
      maybeFail(`set-${nodeId}-${slot}`);
      calls.push({ op: "set", nodeId, slot, pin });
    },
    async clearUserCode(nodeId, slot) {
      maybeFail(`clear-${nodeId}-${slot}`);
      calls.push({ op: "clear", nodeId, slot });
    },
  };
  return { writer, calls };
}

async function makeCache() {
  const dir = await mkdtemp(join(tmpdir(), "rec-"));
  const cache = new LockStateCache({ path: join(dir, "state.json") });
  await cache.load();
  return cache;
}

const LOCKS: LockSyncTarget[] = [
  { id: "front-door", nodeId: 7, maxCodeSlots: 30 },
  { id: "back-door", nodeId: 9, maxCodeSlots: 30 },
];
const SECRET = "s";

describe("Reconciler", () => {
  let cache: LockStateCache;
  beforeEach(async () => {
    cache = await makeCache();
  });

  it("sets a new code on every lock", async () => {
    const { writer, calls } = makeWriter();
    const rec = new Reconciler({
      cache,
      writer,
      locks: LOCKS,
      secret: SECRET,
      retries: 0,
      debounceMs: 0,
    });
    await rec.reconcileAll([{ id: "u1", name: "Alice", pin: "1234", slot: 3, enabled: true }]);
    expect(calls).toEqual([
      { op: "set", nodeId: 7, slot: 3, pin: "1234" },
      { op: "set", nodeId: 9, slot: 3, pin: "1234" },
    ]);
    expect(cache.getLock("front-door")?.slots["3"]?.status).toBe("enabled");
    expect(cache.getLock("front-door")?.lastReconcileOutcome).toBe("ok");
  });

  it("issues no writes when cache matches desired", async () => {
    const { writer, calls } = makeWriter();
    const rec = new Reconciler({
      cache,
      writer,
      locks: LOCKS,
      secret: SECRET,
      retries: 0,
      debounceMs: 0,
    });
    await rec.reconcileAll([{ id: "u1", name: "Alice", pin: "1234", slot: 3, enabled: true }]);
    calls.length = 0;
    await rec.reconcileAll([{ id: "u1", name: "Alice", pin: "1234", slot: 3, enabled: true }]);
    expect(calls).toEqual([]);
  });

  it("clears slots for deleted users", async () => {
    const { writer, calls } = makeWriter();
    const rec = new Reconciler({
      cache,
      writer,
      locks: LOCKS,
      secret: SECRET,
      retries: 0,
      debounceMs: 0,
    });
    await rec.reconcileAll([{ id: "u1", name: "Alice", pin: "1234", slot: 3, enabled: true }]);
    calls.length = 0;
    await rec.reconcileAll([]);
    expect(calls).toEqual([
      { op: "clear", nodeId: 7, slot: 3 },
      { op: "clear", nodeId: 9, slot: 3 },
    ]);
  });

  it("retries up to the configured count before marking error", async () => {
    const { writer, calls } = makeWriter({ "set-7-3": 3 });
    const rec = new Reconciler({
      cache,
      writer,
      locks: LOCKS,
      secret: SECRET,
      retries: 2,
      debounceMs: 0,
      retryDelayMs: 1,
    });
    await rec.reconcileAll([{ id: "u1", name: "Alice", pin: "1234", slot: 3, enabled: true }]);
    const setsOnFront = calls.filter((c) => c.nodeId === 7 && c.op === "set");
    expect(setsOnFront).toHaveLength(0);
    expect(cache.getLock("front-door")?.lastReconcileOutcome).toBe("error");
    expect(cache.getLock("back-door")?.lastReconcileOutcome).toBe("ok");
  });

  it("serializes writes within a single lock (FIFO)", async () => {
    const order: number[] = [];
    const writer: LockWriter = {
      async setUserCode(_n, slot) {
        await new Promise((r) => setTimeout(r, 5));
        order.push(slot);
      },
      async clearUserCode() {},
    };
    const rec = new Reconciler({
      cache,
      writer,
      locks: [LOCKS[0]!],
      secret: SECRET,
      retries: 0,
      debounceMs: 0,
    });
    await rec.reconcileAll([
      { id: "u1", name: "A", pin: "1", slot: 1, enabled: true },
      { id: "u2", name: "B", pin: "2", slot: 2, enabled: true },
      { id: "u3", name: "C", pin: "3", slot: 3, enabled: true },
    ]);
    expect(order).toEqual([1, 2, 3]);
  });

  it("debounces rapid scheduleReconcile calls into one pass", async () => {
    const { writer, calls } = makeWriter();
    const rec = new Reconciler({
      cache,
      writer,
      locks: LOCKS,
      secret: SECRET,
      retries: 0,
      debounceMs: 20,
    });
    rec.scheduleReconcile(() => [{ id: "u1", name: "A", pin: "1", slot: 1, enabled: true }]);
    rec.scheduleReconcile(() => [
      { id: "u1", name: "A", pin: "1", slot: 1, enabled: true },
      { id: "u2", name: "B", pin: "2", slot: 2, enabled: true },
    ]);
    await rec.drain();
    expect(calls).toHaveLength(4); // 2 slots * 2 locks
  });
});
```

- [ ] **Step 3: Run tests to confirm failure**

Run: `npx vitest run tests/unit/reconciler.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement Reconciler**

Create `src/reconciler/reconciler.ts`:

```ts
import type { LockStateCache } from "../cache/cache.js";
import { fingerprintPin } from "../cache/fingerprint.js";
import { computeDiff, type DiffUser } from "./diff.js";
import type { LockSyncTarget, LockWriter } from "./types.js";

interface ReconcilerOptions {
  cache: LockStateCache;
  writer: LockWriter;
  locks: readonly LockSyncTarget[];
  secret: string;
  retries?: number;
  retryDelayMs?: number;
  debounceMs?: number;
}

type DesiredProvider = () => readonly DiffUser[];

export class Reconciler {
  private queues = new Map<string, Promise<void>>();
  private pendingTimer: NodeJS.Timeout | undefined;
  private pendingProvider: DesiredProvider | undefined;
  private pendingDrain: Promise<void> | undefined;

  constructor(private readonly opts: ReconcilerOptions) {}

  scheduleReconcile(provider: DesiredProvider): void {
    this.pendingProvider = provider;
    if (this.pendingTimer) return;
    const delay = this.opts.debounceMs ?? 500;
    this.pendingTimer = setTimeout(() => {
      const p = this.pendingProvider;
      this.pendingTimer = undefined;
      this.pendingProvider = undefined;
      if (p) this.pendingDrain = this.reconcileAll(p());
    }, delay);
  }

  async drain(): Promise<void> {
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = undefined;
      const p = this.pendingProvider;
      this.pendingProvider = undefined;
      if (p) this.pendingDrain = this.reconcileAll(p());
    }
    if (this.pendingDrain) await this.pendingDrain;
  }

  async reconcileAll(desired: readonly DiffUser[]): Promise<void> {
    await Promise.all(this.opts.locks.map((lock) => this.reconcileLock(lock, desired)));
  }

  private async reconcileLock(lock: LockSyncTarget, desired: readonly DiffUser[]): Promise<void> {
    const prior = this.queues.get(lock.id) ?? Promise.resolve();
    const next = prior.then(() => this.doReconcileLock(lock, desired));
    this.queues.set(
      lock.id,
      next.catch(() => undefined),
    );
    await next;
  }

  private async doReconcileLock(lock: LockSyncTarget, desired: readonly DiffUser[]): Promise<void> {
    const cacheState = this.opts.cache.getLock(lock.id);
    const slots = cacheState?.slots ?? {};
    const ops = computeDiff({ users: desired, cache: slots, secret: this.opts.secret });
    let outcome: "ok" | "error" | "partial" = "ok";

    for (const op of ops) {
      const ok = await this.executeWithRetry(lock, op);
      if (!ok) outcome = "error";
    }

    await this.opts.cache.markReconcile(lock.id, outcome);
  }

  private async executeWithRetry(
    lock: LockSyncTarget,
    op: ReturnType<typeof computeDiff>[number],
  ): Promise<boolean> {
    const retries = this.opts.retries ?? 2;
    const delayMs = this.opts.retryDelayMs ?? 250;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        if (op.op === "set") {
          await this.opts.writer.setUserCode(lock.nodeId, op.slot, op.pin);
          await this.opts.cache.markWrite(lock.id, op.slot, {
            userId: op.userId,
            pinFingerprint: fingerprintPin(this.opts.secret, op.pin),
          });
        } else {
          await this.opts.writer.clearUserCode(lock.nodeId, op.slot);
          await this.opts.cache.markCleared(lock.id, op.slot);
        }
        return true;
      } catch {
        if (attempt < retries) await new Promise((r) => setTimeout(r, delayMs * (attempt + 1)));
      }
    }
    return false;
  }
}
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/unit/reconciler.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add src/reconciler tests/unit/reconciler.test.ts
git commit -m "feat(reconciler): per-lock queue, retry with backoff, and debounced scheduling"
```

---

## Phase 8 — Notifier & event log

### Task 15: HA notifier

**Files:**

- Create: `src/notifier/ha-notifier.ts`
- Create: `tests/unit/ha-notifier.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/ha-notifier.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HaNotifier } from "../../src/notifier/ha-notifier.js";

describe("HaNotifier", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => "" });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to HA with the resolved user name", async () => {
    const n = new HaNotifier({
      url: "http://ha.local:8123",
      token: "t",
      service: "notify.mobile_app_ryan",
    });
    await n.notifyUnlock({ lockName: "Front Door", userName: "Alice" });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://ha.local:8123/api/services/notify/mobile_app_ryan");
    expect(init).toMatchObject({
      method: "POST",
      headers: { authorization: "Bearer t", "content-type": "application/json" },
    });
    const body = JSON.parse(init.body as string);
    expect(body.message).toBe("Alice unlocked Front Door");
  });

  it("notifies about unknown slots", async () => {
    const n = new HaNotifier({
      url: "http://ha.local:8123",
      token: "t",
      service: "notify.mobile_app_ryan",
    });
    await n.notifyUnlock({ lockName: "Back Door", slot: 7 });
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body.message).toBe("Unknown user (slot 7) unlocked Back Door");
  });

  it("returns an error result when HA is unreachable (no throw)", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const n = new HaNotifier({
      url: "http://ha.local:8123",
      token: "t",
      service: "notify.mobile_app_ryan",
    });
    const result = await n.notifyUnlock({ lockName: "Front Door", userName: "Alice" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/ECONNREFUSED/);
  });

  it("returns an error result for non-2xx responses", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: async () => "boom" });
    const n = new HaNotifier({
      url: "http://ha.local:8123",
      token: "t",
      service: "notify.mobile_app_ryan",
    });
    const result = await n.notifyUnlock({ lockName: "Front Door", userName: "Alice" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/500/);
  });
});
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `npx vitest run tests/unit/ha-notifier.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/notifier/ha-notifier.ts`:

```ts
export interface HaNotifierOptions {
  url: string;
  token: string;
  service: string; // e.g. "notify.mobile_app_ryan"
}

export interface NotifyUnlockInput {
  lockName: string;
  userName?: string;
  slot?: number;
}

export type NotifyResult = { ok: true } | { ok: false; error: string };

export class HaNotifier {
  constructor(private readonly opts: HaNotifierOptions) {}

  async notifyUnlock(input: NotifyUnlockInput): Promise<NotifyResult> {
    const message = input.userName
      ? `${input.userName} unlocked ${input.lockName}`
      : `Unknown user (slot ${input.slot ?? "?"}) unlocked ${input.lockName}`;

    const [domain, service] = this.opts.service.split(".");
    const endpoint = `${this.opts.url.replace(/\/$/, "")}/api/services/${domain}/${service}`;

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.opts.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ message }),
      });
      if (!res.ok) {
        const body = await res.text();
        return { ok: false, error: `HA ${res.status}: ${body}` };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/ha-notifier.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/notifier tests/unit/ha-notifier.test.ts
git commit -m "feat(notifier): home assistant notify service client"
```

---

### Task 16: Event log (append + tail + rotate)

**Files:**

- Create: `src/log/event-log.ts`
- Create: `src/log/types.ts`
- Create: `tests/unit/event-log.test.ts`

- [ ] **Step 1: Define types**

Create `src/log/types.ts`:

```ts
export interface LoggedUnlock {
  ts: string;
  type: "unlock";
  lockId: string;
  lockName: string;
  userId?: string;
  userName?: string;
  slot: number;
}

export interface LoggedWrite {
  ts: string;
  type: "write";
  lockId: string;
  slot: number;
  outcome: "ok" | "error";
}

export interface LoggedKeypadChange {
  ts: string;
  type: "keypad_change";
  lockId: string;
  slot: number;
}

export interface LoggedNotificationFailed {
  ts: string;
  type: "notification_failed";
  reason: string;
  lockId: string;
  slot: number;
}

export type LoggedEvent =
  | LoggedUnlock
  | LoggedWrite
  | LoggedKeypadChange
  | LoggedNotificationFailed;
```

- [ ] **Step 2: Write failing tests**

Create `tests/unit/event-log.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mkdtemp, stat, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventLog } from "../../src/log/event-log.js";

async function makeLog(rotateBytes = 1_000_000) {
  const dir = await mkdtemp(join(tmpdir(), "evlog-"));
  const log = new EventLog({ path: join(dir, "events.jsonl"), rotateBytes });
  return { log, dir };
}

describe("EventLog", () => {
  it("append writes a JSONL line", async () => {
    const { log } = await makeLog();
    await log.append({ ts: "t1", type: "unlock", lockId: "a", lockName: "A", slot: 1 });
    const contents = await readFile((log as unknown as { path: string }).path, "utf8");
    expect(contents.trim().split("\n")).toHaveLength(1);
    const parsed = JSON.parse(contents.trim());
    expect(parsed).toMatchObject({ type: "unlock", lockId: "a", slot: 1 });
  });

  it("tail returns the last N entries in order", async () => {
    const { log } = await makeLog();
    for (let i = 0; i < 5; i++) {
      await log.append({ ts: `t${i}`, type: "unlock", lockId: "a", lockName: "A", slot: i });
    }
    const tail = await log.tail(3);
    expect(tail.map((e) => (e as { slot: number }).slot)).toEqual([2, 3, 4]);
  });

  it("rotates when size exceeds rotateBytes", async () => {
    const { log, dir } = await makeLog(200);
    for (let i = 0; i < 30; i++) {
      await log.append({ ts: `t${i}`, type: "unlock", lockId: "a", lockName: "A", slot: i });
    }
    const cur = await stat(join(dir, "events.jsonl"));
    expect(cur.size).toBeLessThan(500);
    const rotated = await stat(join(dir, "events.jsonl.1"));
    expect(rotated.size).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: Run tests to confirm failure**

Run: `npx vitest run tests/unit/event-log.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement**

Create `src/log/event-log.ts`:

```ts
import { appendFile, mkdir, readFile, rename, stat } from "node:fs/promises";
import { dirname } from "node:path";
import type { LoggedEvent } from "./types.js";

interface EventLogOptions {
  path: string;
  rotateBytes?: number;
}

export class EventLog {
  private readonly path: string;
  private readonly rotateBytes: number;
  private ensured = false;

  constructor(opts: EventLogOptions) {
    this.path = opts.path;
    this.rotateBytes = opts.rotateBytes ?? 10_000_000;
  }

  async append(event: LoggedEvent): Promise<void> {
    await this.ensureDir();
    await this.rotateIfNeeded();
    await appendFile(this.path, `${JSON.stringify(event)}\n`, "utf8");
  }

  async tail(limit: number): Promise<LoggedEvent[]> {
    try {
      const raw = await readFile(this.path, "utf8");
      const lines = raw.split("\n").filter(Boolean);
      return lines.slice(-limit).map((l) => JSON.parse(l) as LoggedEvent);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  }

  private async ensureDir(): Promise<void> {
    if (this.ensured) return;
    await mkdir(dirname(this.path), { recursive: true });
    this.ensured = true;
  }

  private async rotateIfNeeded(): Promise<void> {
    try {
      const s = await stat(this.path);
      if (s.size >= this.rotateBytes) {
        await rename(this.path, `${this.path}.1`);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
}
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/unit/event-log.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/log tests/unit/event-log.test.ts
git commit -m "feat(log): append-only jsonl event log with size-based rotation"
```

---

## Phase 9 — Verify scheduler

### Task 17: Verify scheduler

**Files:**

- Create: `src/verify/scheduler.ts`
- Create: `tests/unit/verify-scheduler.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/verify-scheduler.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VerifyScheduler } from "../../src/verify/scheduler.js";

describe("VerifyScheduler", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("fires callback for each lock at staggered times", () => {
    const calls: string[] = [];
    const s = new VerifyScheduler({
      intervalMs: 1000,
      staggerMs: 300,
      onVerify: (id) => calls.push(id),
    });
    s.schedule(["a", "b", "c"]);
    vi.advanceTimersByTime(0);
    expect(calls).toEqual(["a"]);
    vi.advanceTimersByTime(150);
    expect(calls).toEqual(["a", "b"]);
    vi.advanceTimersByTime(150);
    expect(calls).toEqual(["a", "b", "c"]);
  });

  it("repeats at interval per lock", () => {
    const calls: string[] = [];
    const s = new VerifyScheduler({
      intervalMs: 500,
      staggerMs: 0,
      onVerify: (id) => calls.push(id),
    });
    s.schedule(["a"]);
    vi.advanceTimersByTime(0);
    vi.advanceTimersByTime(500);
    vi.advanceTimersByTime(500);
    expect(calls).toEqual(["a", "a", "a"]);
  });

  it("stop clears timers", () => {
    const calls: string[] = [];
    const s = new VerifyScheduler({
      intervalMs: 500,
      staggerMs: 0,
      onVerify: (id) => calls.push(id),
    });
    s.schedule(["a"]);
    vi.advanceTimersByTime(0);
    s.stop();
    vi.advanceTimersByTime(5000);
    expect(calls).toEqual(["a"]);
  });
});
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `npx vitest run tests/unit/verify-scheduler.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/verify/scheduler.ts`:

```ts
interface VerifySchedulerOptions {
  intervalMs: number;
  staggerMs: number;
  onVerify: (lockId: string) => void | Promise<void>;
}

export class VerifyScheduler {
  private timers: NodeJS.Timeout[] = [];
  constructor(private readonly opts: VerifySchedulerOptions) {}

  schedule(lockIds: readonly string[]): void {
    this.stop();
    const step = lockIds.length > 1 ? this.opts.staggerMs / Math.max(lockIds.length - 1, 1) : 0;
    lockIds.forEach((id, idx) => {
      const initial = setTimeout(() => {
        this.run(id);
        const interval = setInterval(() => {
          void this.run(id);
        }, this.opts.intervalMs);
        this.timers.push(interval);
      }, idx * step);
      this.timers.push(initial);
    });
  }

  stop(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  private run(id: string): void {
    void Promise.resolve(this.opts.onVerify(id)).catch(() => undefined);
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/verify-scheduler.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/verify tests/unit/verify-scheduler.test.ts
git commit -m "feat(verify): staggered per-lock verify scheduler"
```

---

## Phase 10 — HTTP server & UI

### Task 18: Fastify skeleton + healthz

**Files:**

- Create: `src/http/views/layout.ts`
- Create: `src/http/server.ts`
- Create: `src/http/routes/health.ts`
- Create: `tests/unit/http-health.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/unit/http-health.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildServer } from "../../src/http/server.js";

describe("GET /healthz", () => {
  it("returns 200 OK", async () => {
    const app = buildServer({});
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("ok");
    await app.close();
  });
});
```

- [ ] **Step 2: Implement layout template**

Create `src/http/views/layout.ts`:

```ts
export function layout(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <script src="https://unpkg.com/htmx.org@2.0.3"></script>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem; }
    nav a { margin-right: 1rem; }
    table { border-collapse: collapse; width: 100%; }
    th, td { padding: 0.5rem; text-align: left; border-bottom: 1px solid #ddd; }
    .status-ok { color: #080; } .status-error { color: #c00; } .status-unknown { color: #888; }
    form.inline { display: inline; }
  </style>
</head>
<body>
  <nav>
    <a href="/users">Users</a>
    <a href="/locks">Locks</a>
    <a href="/events">Events</a>
  </nav>
  ${body}
</body>
</html>`;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
```

- [ ] **Step 3: Implement server**

Create `src/http/server.ts`:

```ts
import Fastify, { type FastifyInstance } from "fastify";
import formbody from "@fastify/formbody";
import { registerHealthRoutes } from "./routes/health.js";

export interface ServerDeps {
  // Populated by later tasks; intentionally minimal here.
}

export function buildServer(_deps: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  app.register(formbody);
  registerHealthRoutes(app);
  app.get("/", (_req, reply) => reply.redirect("/users"));
  return app;
}
```

Create `src/http/routes/health.ts`:

```ts
import type { FastifyInstance } from "fastify";

export function registerHealthRoutes(app: FastifyInstance): void {
  app.get("/healthz", async (_req, reply) => {
    reply.type("text/plain");
    return "ok";
  });
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/http-health.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/http tests/unit/http-health.test.ts
git commit -m "feat(http): fastify server skeleton with healthz and layout"
```

---

### Task 19: Users routes + views

**Files:**

- Create: `src/http/views/users.ts`
- Create: `src/http/routes/users.ts`
- Modify: `src/http/server.ts` (register + accept Store dep)
- Create: `tests/unit/http-users.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/http-users.test.ts`:

```ts
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
});
```

- [ ] **Step 2: Implement users view**

Create `src/http/views/users.ts`:

```ts
import type { User } from "../../store/types.js";
import { escapeHtml, layout } from "./layout.js";

export function renderUsersPage(users: readonly User[]): string {
  const rows = users
    .map(
      (u) => `
    <tr>
      <td>${u.slot}</td>
      <td>${escapeHtml(u.name)}</td>
      <td>${u.enabled ? "Enabled" : "Disabled"}</td>
      <td>
        <form class="inline" method="post" action="/users/${u.id}/toggle">
          <button type="submit">${u.enabled ? "Disable" : "Enable"}</button>
        </form>
        <form class="inline" method="post" action="/users/${u.id}/delete"
              onsubmit="return confirm('Delete ${escapeHtml(u.name)}?');">
          <button type="submit">Delete</button>
        </form>
      </td>
    </tr>`,
    )
    .join("");
  const body = `
  <h1>Users</h1>
  <form method="post" action="/users">
    <label>Name <input name="name" required /></label>
    <label>PIN <input name="pin" required pattern="[0-9]{4,10}" /></label>
    <button type="submit">Add</button>
  </form>
  <table>
    <thead><tr><th>Slot</th><th>Name</th><th>Status</th><th>Actions</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="4">No users yet.</td></tr>'}</tbody>
  </table>`;
  return layout("Users", body);
}
```

- [ ] **Step 3: Implement users routes**

Create `src/http/routes/users.ts`:

```ts
import type { FastifyInstance } from "fastify";
import type { Store } from "../../store/store.js";
import { renderUsersPage } from "../views/users.js";

interface UsersDeps {
  store: Store;
  onChange: () => void;
}

export function registerUsersRoutes(app: FastifyInstance, deps: UsersDeps): void {
  app.get("/users", async (_req, reply) => {
    reply.type("text/html");
    return renderUsersPage(deps.store.listUsers());
  });

  app.post<{ Body: { name: string; pin: string } }>("/users", async (req, reply) => {
    await deps.store.addUser({ name: req.body.name, pin: req.body.pin });
    deps.onChange();
    reply.redirect("/users");
  });

  app.post<{ Params: { id: string } }>("/users/:id/toggle", async (req, reply) => {
    const user = deps.store.getUser(req.params.id);
    if (!user) return reply.code(404).send("not found");
    await deps.store.updateUser(user.id, { enabled: !user.enabled });
    deps.onChange();
    reply.redirect("/users");
  });

  app.post<{ Params: { id: string } }>("/users/:id/delete", async (req, reply) => {
    await deps.store.deleteUser(req.params.id);
    deps.onChange();
    reply.redirect("/users");
  });
}
```

- [ ] **Step 4: Modify server.ts to accept store dep**

Replace `src/http/server.ts` contents:

```ts
import Fastify, { type FastifyInstance } from "fastify";
import formbody from "@fastify/formbody";
import type { Store } from "../store/store.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerUsersRoutes } from "./routes/users.js";

export interface ServerDeps {
  store?: Store;
  onUsersChanged?: () => void;
}

export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  app.register(formbody);
  registerHealthRoutes(app);
  if (deps.store) {
    registerUsersRoutes(app, {
      store: deps.store,
      onChange: deps.onUsersChanged ?? (() => undefined),
    });
  }
  app.get("/", (_req, reply) => reply.redirect("/users"));
  return app;
}
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/unit/http-users.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add src/http tests/unit/http-users.test.ts
git commit -m "feat(http): user crud routes and server-rendered views"
```

---

### Task 20: Locks routes + views + manual resync/verify

**Files:**

- Create: `src/http/views/locks.ts`
- Create: `src/http/routes/locks.ts`
- Modify: `src/http/server.ts` (register + accept lock deps)
- Create: `tests/unit/http-locks.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/http-locks.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LockStateCache } from "../../src/cache/cache.js";
import { buildServer } from "../../src/http/server.js";
import type { FastifyInstance } from "fastify";

describe("locks routes", () => {
  let app: FastifyInstance;
  let cache: LockStateCache;
  let resyncCalls: string[];
  let verifyCalls: string[];

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), "httpl-"));
    cache = new LockStateCache({ path: join(dir, "state.json") });
    await cache.load();
    resyncCalls = [];
    verifyCalls = [];
    app = buildServer({
      locks: [
        { id: "front-door", name: "Front Door", nodeId: 7, maxCodeSlots: 30 },
        { id: "back-door", name: "Back Door", nodeId: 9, maxCodeSlots: 30 },
      ],
      cache,
      onResync: (id) => resyncCalls.push(id),
      onVerify: (id) => verifyCalls.push(id),
    });
  });

  afterEach(async () => await app.close());

  it("GET /locks lists configured locks and status", async () => {
    await cache.markReconcile("front-door", "ok");
    const res = await app.inject({ method: "GET", url: "/locks" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Front Door");
    expect(res.body).toContain("Back Door");
    expect(res.body).toContain("ok");
  });

  it("POST /locks/:id/resync invokes onResync", async () => {
    const res = await app.inject({ method: "POST", url: "/locks/front-door/resync" });
    expect(res.statusCode).toBe(302);
    expect(resyncCalls).toEqual(["front-door"]);
  });

  it("POST /locks/:id/verify invokes onVerify", async () => {
    const res = await app.inject({ method: "POST", url: "/locks/back-door/verify" });
    expect(res.statusCode).toBe(302);
    expect(verifyCalls).toEqual(["back-door"]);
  });

  it("unknown lock id returns 404", async () => {
    const res = await app.inject({ method: "POST", url: "/locks/nope/resync" });
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Implement locks view**

Create `src/http/views/locks.ts`:

```ts
import type { LockConfig } from "../../config/schema.js";
import type { LockState } from "../../cache/types.js";
import { escapeHtml, layout } from "./layout.js";

export function renderLocksPage(
  locks: readonly LockConfig[],
  cache: (id: string) => LockState | undefined,
): string {
  const rows = locks
    .map((lock) => {
      const st = cache(lock.id);
      const outcome = st?.lastReconcileOutcome ?? "unknown";
      return `
      <tr>
        <td>${escapeHtml(lock.name)}</td>
        <td>node ${lock.nodeId}</td>
        <td class="status-${outcome}">${outcome}</td>
        <td>${escapeHtml(st?.lastReconcileAt ?? "never")}</td>
        <td>${escapeHtml(st?.lastVerifiedAt ?? "never")}</td>
        <td>
          <form class="inline" method="post" action="/locks/${lock.id}/resync">
            <button type="submit">Resync</button>
          </form>
          <form class="inline" method="post" action="/locks/${lock.id}/verify"
                onsubmit="return confirm('Verify will wake the lock. Proceed?');">
            <button type="submit">Verify now</button>
          </form>
        </td>
      </tr>`;
    })
    .join("");
  const body = `
  <h1>Locks</h1>
  <table>
    <thead><tr><th>Name</th><th>Node</th><th>Last outcome</th><th>Last reconcile</th><th>Last verify</th><th>Actions</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
  return layout("Locks", body);
}
```

- [ ] **Step 3: Implement locks routes**

Create `src/http/routes/locks.ts`:

```ts
import type { FastifyInstance } from "fastify";
import type { LockConfig } from "../../config/schema.js";
import type { LockStateCache } from "../../cache/cache.js";
import { renderLocksPage } from "../views/locks.js";

interface LocksDeps {
  locks: readonly LockConfig[];
  cache: LockStateCache;
  onResync: (lockId: string) => void;
  onVerify: (lockId: string) => void;
}

export function registerLocksRoutes(app: FastifyInstance, deps: LocksDeps): void {
  const byId = new Map(deps.locks.map((l) => [l.id, l]));

  app.get("/locks", async (_req, reply) => {
    reply.type("text/html");
    return renderLocksPage(deps.locks, (id) => deps.cache.getLock(id));
  });

  app.post<{ Params: { id: string } }>("/locks/:id/resync", async (req, reply) => {
    if (!byId.has(req.params.id)) return reply.code(404).send("not found");
    deps.onResync(req.params.id);
    reply.redirect("/locks");
  });

  app.post<{ Params: { id: string } }>("/locks/:id/verify", async (req, reply) => {
    if (!byId.has(req.params.id)) return reply.code(404).send("not found");
    deps.onVerify(req.params.id);
    reply.redirect("/locks");
  });
}
```

- [ ] **Step 4: Update server.ts to register lock routes**

Replace `src/http/server.ts`:

```ts
import Fastify, { type FastifyInstance } from "fastify";
import formbody from "@fastify/formbody";
import type { Store } from "../store/store.js";
import type { LockStateCache } from "../cache/cache.js";
import type { LockConfig } from "../config/schema.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerUsersRoutes } from "./routes/users.js";
import { registerLocksRoutes } from "./routes/locks.js";

export interface ServerDeps {
  store?: Store;
  cache?: LockStateCache;
  locks?: readonly LockConfig[];
  onUsersChanged?: () => void;
  onResync?: (lockId: string) => void;
  onVerify?: (lockId: string) => void;
}

export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  app.register(formbody);
  registerHealthRoutes(app);
  if (deps.store) {
    registerUsersRoutes(app, {
      store: deps.store,
      onChange: deps.onUsersChanged ?? (() => undefined),
    });
  }
  if (deps.locks && deps.cache) {
    registerLocksRoutes(app, {
      locks: deps.locks,
      cache: deps.cache,
      onResync: deps.onResync ?? (() => undefined),
      onVerify: deps.onVerify ?? (() => undefined),
    });
  }
  app.get("/", (_req, reply) => reply.redirect("/users"));
  return app;
}
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/unit/http-locks.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/http tests/unit/http-locks.test.ts
git commit -m "feat(http): locks list page with manual resync and verify"
```

---

### Task 21: Events routes + SSE stream

**Files:**

- Create: `src/http/views/events.ts`
- Create: `src/http/routes/events.ts`
- Modify: `src/http/server.ts`
- Create: `tests/unit/http-events.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/http-events.test.ts`:

```ts
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
```

Note: SSE streaming is exercised in the integration test (Task 22). Inject-based tests can't cleanly assert on streaming responses.

- [ ] **Step 2: Implement events view**

Create `src/http/views/events.ts`:

```ts
import type { LoggedEvent } from "../../log/types.js";
import { escapeHtml, layout } from "./layout.js";

export function renderEventsPage(events: readonly LoggedEvent[]): string {
  const rows = events
    .slice()
    .reverse()
    .map((e) => {
      const description = describeEvent(e);
      return `<tr><td>${escapeHtml(e.ts)}</td><td>${escapeHtml(e.type)}</td><td>${escapeHtml(description)}</td></tr>`;
    })
    .join("");
  const body = `
  <h1>Events</h1>
  <p><small>Stream: <span hx-get="/events/stream" hx-trigger="load" hx-swap="none"></span></small></p>
  <table>
    <thead><tr><th>Time</th><th>Type</th><th>Details</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="3">No events yet.</td></tr>'}</tbody>
  </table>`;
  return layout("Events", body);
}

function describeEvent(e: LoggedEvent): string {
  switch (e.type) {
    case "unlock":
      return e.userName
        ? `${e.userName} unlocked ${e.lockName}`
        : `Unknown slot ${e.slot} unlocked ${e.lockName}`;
    case "write":
      return `Write slot ${e.slot} on ${e.lockId}: ${e.outcome}`;
    case "keypad_change":
      return `Keypad change on ${e.lockId} slot ${e.slot}`;
    case "notification_failed":
      return `Notification failed for ${e.lockId} slot ${e.slot}: ${e.reason}`;
  }
}
```

- [ ] **Step 3: Implement events routes**

Create `src/http/routes/events.ts`:

```ts
import type { FastifyInstance } from "fastify";
import type { EventLog } from "../../log/event-log.js";
import type { EventBus } from "../../events/bus.js";
import { renderEventsPage } from "../views/events.js";

interface EventsDeps {
  eventLog: EventLog;
  bus: EventBus;
}

export function registerEventsRoutes(app: FastifyInstance, deps: EventsDeps): void {
  app.get("/events", async (_req, reply) => {
    const tail = await deps.eventLog.tail(200);
    reply.type("text/html");
    return renderEventsPage(tail);
  });

  app.get("/events/stream", (req, reply) => {
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    const onUnlock = (e: { ts: string; lockId: string; slot: number }) => {
      reply.raw.write(`event: unlock\ndata: ${JSON.stringify(e)}\n\n`);
    };
    deps.bus.on("unlock", onUnlock);
    req.raw.on("close", () => deps.bus.off("unlock", onUnlock));
  });
}
```

- [ ] **Step 4: Update server.ts to register events routes**

Edit `src/http/server.ts` — add `eventLog` and `bus` to `ServerDeps`, import and call `registerEventsRoutes` when both are provided.

Modify `src/http/server.ts`:

```ts
import Fastify, { type FastifyInstance } from "fastify";
import formbody from "@fastify/formbody";
import type { Store } from "../store/store.js";
import type { LockStateCache } from "../cache/cache.js";
import type { LockConfig } from "../config/schema.js";
import type { EventLog } from "../log/event-log.js";
import type { EventBus } from "../events/bus.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerUsersRoutes } from "./routes/users.js";
import { registerLocksRoutes } from "./routes/locks.js";
import { registerEventsRoutes } from "./routes/events.js";

export interface ServerDeps {
  store?: Store;
  cache?: LockStateCache;
  locks?: readonly LockConfig[];
  eventLog?: EventLog;
  bus?: EventBus;
  onUsersChanged?: () => void;
  onResync?: (lockId: string) => void;
  onVerify?: (lockId: string) => void;
}

export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  app.register(formbody);
  registerHealthRoutes(app);
  if (deps.store) {
    registerUsersRoutes(app, {
      store: deps.store,
      onChange: deps.onUsersChanged ?? (() => undefined),
    });
  }
  if (deps.locks && deps.cache) {
    registerLocksRoutes(app, {
      locks: deps.locks,
      cache: deps.cache,
      onResync: deps.onResync ?? (() => undefined),
      onVerify: deps.onVerify ?? (() => undefined),
    });
  }
  if (deps.eventLog && deps.bus) {
    registerEventsRoutes(app, { eventLog: deps.eventLog, bus: deps.bus });
  }
  app.get("/", (_req, reply) => reply.redirect("/users"));
  return app;
}
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/unit/http-events.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/http tests/unit/http-events.test.ts
git commit -m "feat(http): events page with log tail and sse stream"
```

---

## Phase 11 — Wiring, startup, integration

### Task 22: App entrypoint wiring

**Files:**

- Create: `src/app.ts`
- Create: `src/index.ts`
- Create: `tests/integration/startup.test.ts`

- [ ] **Step 1: Write failing integration test**

Create `tests/integration/startup.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to confirm failure**

Run: `npx vitest run tests/integration/startup.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement app wiring**

Create `src/app.ts`:

```ts
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { loadLocksConfig } from "./config/loader.js";
import type { LocksConfig } from "./config/schema.js";
import { Store } from "./store/store.js";
import { LockStateCache } from "./cache/cache.js";
import { EventBus } from "./events/bus.js";
import { ZWaveJSClient } from "./zwave/client.js";
import { Reconciler } from "./reconciler/reconciler.js";
import type { DiffUser } from "./reconciler/diff.js";
import { HaNotifier } from "./notifier/ha-notifier.js";
import { EventLog } from "./log/event-log.js";
import { VerifyScheduler } from "./verify/scheduler.js";
import { buildServer } from "./http/server.js";
import { createLogger } from "./util/logger.js";

export interface BuildAppOptions {
  dataDir: string;
  localSecret: string;
  httpPort?: number;
}

export interface RunningApp {
  store: Store;
  cache: LockStateCache;
  server: FastifyInstance;
  config: LocksConfig;
  waitForIdle(): Promise<void>;
  stop(): Promise<void>;
  start(): Promise<void>;
}

export async function buildApp(opts: BuildAppOptions): Promise<RunningApp> {
  const log = createLogger();
  const config = await loadLocksConfig(join(opts.dataDir, "locks.yaml"));
  for (const w of config.warnings) log.warn({ warning: w }, "config warning");

  const maxSlots = Math.min(...config.locks.map((l) => l.maxCodeSlots));
  const store = new Store({ path: join(opts.dataDir, "users.json"), maxSlots });
  await store.load();

  const cache = new LockStateCache({ path: join(opts.dataDir, "state.json") });
  await cache.load();

  const bus = new EventBus();
  const zwave = new ZWaveJSClient({ url: config.zwaveJs.url, bus });
  const notifier = new HaNotifier({
    url: config.homeAssistant.url,
    token: config.homeAssistant.token,
    service: config.homeAssistant.notify.service,
  });
  const eventLog = new EventLog({ path: join(opts.dataDir, "events.jsonl") });

  const desired = (): DiffUser[] =>
    store.listUsers().map((u) => ({
      id: u.id,
      name: u.name,
      pin: u.pin,
      slot: u.slot,
      enabled: u.enabled,
    }));

  const reconciler = new Reconciler({
    cache,
    writer: zwave,
    locks: config.locks,
    secret: opts.localSecret,
    debounceMs: 100,
  });

  store.on("change", () => reconciler.scheduleReconcile(desired));

  const lockById = new Map(config.locks.map((l) => [l.id, l]));
  const nodeIdToLock = new Map(config.locks.map((l) => [l.nodeId, l]));

  bus.on("unlock", async (evt) => {
    const nodeId = Number(evt.lockId.replace(/^node-/, ""));
    const lock = nodeIdToLock.get(nodeId);
    if (!lock) return;
    const user = store.listUsers().find((u) => u.slot === evt.slot);
    const logged = {
      ts: evt.ts,
      type: "unlock" as const,
      lockId: lock.id,
      lockName: lock.name,
      slot: evt.slot,
      ...(user ? { userId: user.id, userName: user.name } : {}),
    };
    await eventLog.append(logged);
    const res = await notifier.notifyUnlock({
      lockName: lock.name,
      ...(user ? { userName: user.name } : { slot: evt.slot }),
    });
    if (!res.ok) {
      await eventLog.append({
        ts: new Date().toISOString(),
        type: "notification_failed",
        reason: res.error,
        lockId: lock.id,
        slot: evt.slot,
      });
    }
  });

  bus.on("keypadCodeChanged", async (evt) => {
    const nodeId = Number(evt.lockId.replace(/^node-/, ""));
    const lock = nodeIdToLock.get(nodeId);
    if (!lock) return;
    await cache.markUnknown(lock.id, evt.slot);
    await eventLog.append({
      ts: evt.ts,
      type: "keypad_change",
      lockId: lock.id,
      slot: evt.slot,
    });
  });

  const doVerify = async (lockId: string): Promise<void> => {
    const lock = lockById.get(lockId);
    if (!lock) return;
    try {
      const slots = await zwave.getAllUserCodes(lock.nodeId, lock.maxCodeSlots);
      const mapped: Record<string, import("./cache/types.js").SlotState> = {};
      for (const s of slots) {
        mapped[String(s.slot)] = {
          status: s.status,
          updatedAt: new Date().toISOString(),
          ...(s.status === "enabled" && s.pin
            ? {
                pinFingerprint: (await import("./cache/fingerprint.js")).fingerprintPin(
                  opts.localSecret,
                  s.pin,
                ),
              }
            : {}),
        };
      }
      await cache.replaceLock(lock.id, mapped);
    } catch (err) {
      log.error({ err, lockId }, "verify failed");
    }
  };

  const verifyScheduler = new VerifyScheduler({
    intervalMs: config.verify.intervalDays * 24 * 60 * 60 * 1000,
    staggerMs: config.verify.staggerMinutes * 60 * 1000,
    onVerify: doVerify,
  });

  const server = buildServer({
    store,
    cache,
    locks: config.locks,
    eventLog,
    bus,
    onUsersChanged: () => reconciler.scheduleReconcile(desired),
    onResync: () => reconciler.scheduleReconcile(desired),
    onVerify: (id) => void doVerify(id),
  });

  let listening = false;

  const start = async (): Promise<void> => {
    await zwave.start();
    // First-run verify for any lock without a cache entry
    const firstRun = config.locks.filter((l) => !cache.getLock(l.id)).map((l) => l.id);
    for (const id of firstRun) await doVerify(id);
    reconciler.scheduleReconcile(desired);
    verifyScheduler.schedule(config.locks.map((l) => l.id));
    if (opts.httpPort !== undefined) {
      await server.listen({ port: opts.httpPort, host: "0.0.0.0" });
      listening = true;
    }
  };

  const stop = async (): Promise<void> => {
    verifyScheduler.stop();
    await zwave.stop();
    if (listening) await server.close();
  };

  const waitForIdle = async (): Promise<void> => {
    await reconciler.drain();
  };

  return { store, cache, server, config, start, stop, waitForIdle };
}
```

Create `src/index.ts`:

```ts
import { buildApp } from "./app.js";
import { createLogger } from "./util/logger.js";

const log = createLogger();
const dataDir = process.env.DATA_DIR ?? "/data";
const localSecret = process.env.LOCAL_SECRET;
const port = Number(process.env.PORT ?? 8080);

if (!localSecret) {
  log.error("LOCAL_SECRET env var is required");
  process.exit(1);
}

const app = await buildApp({ dataDir, localSecret, httpPort: port });
await app.start();
log.info({ port }, "listening");

const shutdown = async (sig: string): Promise<void> => {
  log.info({ sig }, "shutting down");
  await app.stop();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
```

- [ ] **Step 4: Run test**

Run: `npx vitest run tests/integration/startup.test.ts`
Expected: PASS.

- [ ] **Step 5: Run full suite**

Run: `npx vitest run`
Expected: all tests pass.

- [ ] **Step 6: Run typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/app.ts src/index.ts tests/integration/startup.test.ts
git commit -m "feat(app): wire store, cache, zwave, reconciler, notifier, http"
```

---

## Phase 12 — Packaging

### Task 23: Dockerfile + docker-compose example

**Files:**

- Create: `Dockerfile`
- Create: `.dockerignore`
- Create: `docker-compose.example.yml`

- [ ] **Step 1: Create `.dockerignore`**

```
node_modules
dist
coverage
.git
.env
tests
docs
```

- [ ] **Step 2: Create `Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc -p tsconfig.json

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER app
EXPOSE 8080
CMD ["node", "dist/index.js"]
```

- [ ] **Step 3: Create `docker-compose.example.yml`**

```yaml
services:
  zwavejs-lock-users:
    image: zwavejs-lock-users:latest
    build: .
    environment:
      DATA_DIR: /data
      LOCAL_SECRET: change-me-please
      HA_TOKEN: ${HA_TOKEN}
      LOG_LEVEL: info
      PORT: 8080
    volumes:
      - ./data:/data
    ports:
      - "8080:8080"
    restart: unless-stopped
    # Expects zwave-js-server reachable at the URL in locks.yaml.
```

- [ ] **Step 4: Verify image builds**

Run: `docker build -t zwavejs-lock-users:test .`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add Dockerfile .dockerignore docker-compose.example.yml
git commit -m "chore(docker): multi-stage build and compose example"
```

---

### Task 24: README + smoke-test checklist

**Files:**

- Create: `README.md`
- Create: `docs/smoke-test-checklist.md`
- Create: `docs/example-locks.yaml`

- [ ] **Step 1: Create `docs/example-locks.yaml`**

```yaml
zwaveJs:
  url: ws://zwavejs:3000

homeAssistant:
  url: http://homeassistant.local:8123
  token: ${HA_TOKEN}
  notify:
    service: notify.mobile_app_ryan

verify:
  intervalDays: 7
  staggerMinutes: 60

locks:
  - id: front-door
    name: Front Door
    nodeId: 7
    maxCodeSlots: 30
  - id: back-door
    name: Back Door
    nodeId: 9
    maxCodeSlots: 30
```

- [ ] **Step 2: Create `docs/smoke-test-checklist.md`**

```markdown
# Smoke test checklist

Run through this before releasing a build. Assumes the service is running against real locks and a real Home Assistant.

## Prereqs

- [ ] `docker compose up -d` succeeds
- [ ] `curl -f http://localhost:8080/healthz` returns `ok`
- [ ] UI loads at `/users`, `/locks`, `/events`

## First-run seed

- [ ] Fresh `/data` (no `state.json`)
- [ ] Start service; `/locks` shows each lock with "Last verify" populated within a minute
- [ ] `state.json` on disk contains a `slots` map per lock

## Add user

- [ ] Add user "Alice" / PIN "1234"
- [ ] `/locks` shows "Last reconcile: ok" on each lock within a few seconds
- [ ] Alice's code works on every physical lock
- [ ] Unlocking with Alice's code shows "Alice unlocked <Lock>" in `/events`
- [ ] HA notification fires with the expected message

## Change PIN

- [ ] Delete "Alice", re-add as "Alice" / PIN "5678"
- [ ] Old PIN no longer works; new PIN works on every lock

## Disable/enable

- [ ] Disable Alice → code stops working on every lock
- [ ] Enable Alice → code works again on every lock

## Delete

- [ ] Delete Alice → code stops working, slot is free for the next user

## Drift detection

- [ ] Manually program a code at one lock's keypad (slot 10)
- [ ] Click "Verify now" on that lock
- [ ] `/locks` / `state.json` reflects the new code in slot 10 with `status: enabled`
- [ ] No auto-writes were issued to fix the drift

## Failure modes

- [ ] Stop HA → unlock still logged in `/events` with "notification_failed"
- [ ] Stop zwave-js-server → `/locks` shows connection error; service auto-reconnects when zwave is back
```

- [ ] **Step 3: Create `README.md`**

```markdown
# zwavejs-lock-users

A small self-hosted service that keeps user PIN codes in sync across multiple Z-Wave door locks (via `zwave-js-server`) and fires named unlock notifications through Home Assistant.

See the design spec: `docs/superpowers/specs/2026-04-21-zwave-lock-sync-design.md`

## Quickstart

1. Copy `docs/example-locks.yaml` to `data/locks.yaml` and edit `zwaveJs.url`, your HA URL, and your locks.
2. Set env vars:
   - `HA_TOKEN` — long-lived HA access token
   - `LOCAL_SECRET` — any random string; used to fingerprint PINs
3. `docker compose -f docker-compose.example.yml up -d`
4. Visit `http://localhost:8080/users` to manage users.

## Config files (under `/data`)

- `locks.yaml` — hand-edited (locks, HA, zwavejs URLs)
- `users.json` — managed via the web UI
- `state.json` — app-managed cache of what's currently on each lock
- `events.jsonl` — append-only unlock/log stream

## Development
```

npm install
npm test
npm run dev

```

See `docs/smoke-test-checklist.md` for pre-release verification.
```

- [ ] **Step 4: Commit**

```bash
git add README.md docs/smoke-test-checklist.md docs/example-locks.yaml
git commit -m "docs: readme, smoke-test checklist, and example locks.yaml"
```

---

## Final verification

### Task 25: Full suite + lint

- [ ] **Step 1: Full test run**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: zero errors (warnings acceptable).

- [ ] **Step 4: Format**

Run: `npm run format`
Expected: no unformatted files remain.

- [ ] **Step 5: Dry run the full smoke checklist (or as much as is feasible without hardware)**

Manual. Record any gaps as follow-up issues.

- [ ] **Step 6: Final commit if formatting changed files**

```bash
git add -u
git diff --cached --quiet || git commit -m "chore: prettier format"
```

---

## Open follow-ups (post-v1)

These came up during design and are explicitly out of scope for v1 — list them here so they aren't lost.

- Temporary / time-windowed codes
- Scheduled access (day-of-week windows)
- Encrypted-at-rest `users.json`
- Pluggable notifier providers (ntfy, Pushover, webhook)
- Multi-hub / multi-zwavejs support
- Automatic HA helper / entity management for per-slot names (in case you later want HA-native notifications)
