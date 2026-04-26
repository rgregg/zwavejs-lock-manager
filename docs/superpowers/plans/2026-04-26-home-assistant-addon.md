# Home Assistant Add-on Conversion — Implementation Plan

> **For agentic workers:** Steps use checkbox syntax for tracking. Each task ends with a commit. The existing standalone Docker deployment must continue to work — all changes are dual-mode.

**Goal:** Make `zwavejs-lock-users` installable as a Home Assistant add-on via a custom repository, while keeping the standalone `docker compose` path intact.

**Architecture:** Add an `addon/` subdirectory to this repo with the HA-specific manifest (`config.yaml`), an HA-base-image Dockerfile, and a `run.sh` entrypoint. The Node code gains a "supervisor mode" detected by the presence of `SUPERVISOR_TOKEN` in the environment — when set, it reads config from `/data/options.json` (HA-managed UI form) instead of `/data/locks.yaml`, uses `http://supervisor/core` + the supervisor token for HA notifications, and discovers the zwave-js-server URL via the Supervisor's discovery API. When unset, the existing standalone behavior is unchanged.

**Tech additions:** No new runtime deps. Build adds HA's base image. CI gains a multi-arch matrix.

**Reference earlier work:** original spec at `docs/superpowers/specs/2026-04-21-zwave-lock-sync-design.md`; original plan at `docs/superpowers/plans/2026-04-21-zwave-lock-user-sync.md`.

---

## Conventions for this plan

- Every task ends with a commit. Tests green before moving on.
- TDD where a behavior change exists; pure manifest tasks just verify with `tsc`/`docker build`.
- No Co-Authored-By trailer (project preference).
- All paths relative to repo root.

---

## Phase 1 — Dual-mode config loader

The current loader (`src/config/loader.ts`) reads YAML, interpolates `${ENV}`, validates with Zod. We add an alternate path: when `SUPERVISOR_TOKEN` is set, read `/data/options.json` and shape it into the same `LocksConfig` type before validation.

### Task 1: AddonOptions schema + JSON-mode loader

**Files:**
- Create: `src/config/options-schema.ts`
- Modify: `src/config/loader.ts`
- Create: `tests/unit/config-options.test.ts`
- Modify: `src/config/schema.ts` (no shape change; just re-export)

- [ ] **Step 1: Define the options.json shape**

The HA UI's options form maps to a JSON object. Mirror our existing `LocksConfig` shape but using add-on-friendly snake_case (HA convention for options).

Create `src/config/options-schema.ts`:

```ts
import { z } from "zod";

export const AddonOptionsSchema = z.object({
  read_only: z.boolean().default(false),
  notify_service: z.string().default("notify.notify"),
  verify_interval_days: z.number().int().positive().default(7),
  verify_stagger_minutes: z.number().int().nonnegative().default(60),
  locks: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      node_id: z.number().int().positive(),
      max_code_slots: z.number().int().positive().default(30),
    }),
  ),
});

export type AddonOptions = z.infer<typeof AddonOptionsSchema>;
```

- [ ] **Step 2: Write failing tests**

Create `tests/unit/config-options.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadLocksConfig } from "../../src/config/loader.js";

async function withOptionsFile(opts: unknown): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "addon-"));
  await writeFile(join(dir, "options.json"), JSON.stringify(opts));
  return dir;
}

describe("loadLocksConfig (addon mode)", () => {
  it("loads from /data/options.json when SUPERVISOR_TOKEN is set", async () => {
    const dir = await withOptionsFile({
      read_only: true,
      notify_service: "notify.family",
      verify_interval_days: 7,
      verify_stagger_minutes: 60,
      locks: [{ id: "front", name: "Front", node_id: 7, max_code_slots: 30 }],
    });
    const cfg = await loadLocksConfig(join(dir, "options.json"), {
      env: { SUPERVISOR_TOKEN: "tok" },
    });
    expect(cfg.readOnly).toBe(true);
    expect(cfg.homeAssistant.url).toBe("http://supervisor/core");
    expect(cfg.homeAssistant.token).toBe("tok");
    expect(cfg.homeAssistant.notify.service).toBe("notify.family");
    expect(cfg.zwaveJs.url).toBe(""); // filled in later by discovery
    expect(cfg.locks).toEqual([
      { id: "front", name: "Front", nodeId: 7, maxCodeSlots: 30 },
    ]);
  });

  it("rejects options.json without locks", async () => {
    const dir = await withOptionsFile({ read_only: false });
    await expect(
      loadLocksConfig(join(dir, "options.json"), { env: { SUPERVISOR_TOKEN: "t" } }),
    ).rejects.toThrow();
  });

  it("does not switch to addon mode without SUPERVISOR_TOKEN even if file is options.json", async () => {
    const dir = await withOptionsFile({ read_only: true, locks: [] });
    // path ends in options.json but env is missing SUPERVISOR_TOKEN — should fall through
    // to YAML mode and fail to parse
    await expect(
      loadLocksConfig(join(dir, "options.json"), { env: {} }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run tests — confirm failure**

Run: `npx vitest run tests/unit/config-options.test.ts`
Expected: FAIL — addon mode not implemented yet.

- [ ] **Step 4: Add addon-mode branch to `loadLocksConfig`**

Modify `src/config/loader.ts`:

```ts
import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { LocksConfigSchema, type LocksConfig } from "./schema.js";
import { AddonOptionsSchema } from "./options-schema.js";

export interface LoadedConfig extends LocksConfig {
  warnings: string[];
}

export interface LoadOptions {
  env?: Record<string, string | undefined>;
}

const ENV_PATTERN = /\$\{([A-Z_][A-Z0-9_]*)\}/g;

export async function loadLocksConfig(path: string, opts: LoadOptions = {}): Promise<LoadedConfig> {
  const env = opts.env ?? process.env;
  const inAddonMode = !!env.SUPERVISOR_TOKEN;
  const raw = await readFile(path, "utf8");
  const warnings: string[] = [];

  if (inAddonMode) {
    const parsedJson = JSON.parse(raw);
    const result = AddonOptionsSchema.safeParse(parsedJson);
    if (!result.success) {
      throw new Error(`Invalid addon options: ${result.error.message}`);
    }
    const o = result.data;
    const config: LocksConfig = {
      zwaveJs: { url: "" }, // discovered at runtime — see Phase 3
      homeAssistant: {
        url: "http://supervisor/core",
        token: env.SUPERVISOR_TOKEN ?? "",
        notify: { service: o.notify_service },
      },
      verify: {
        intervalDays: o.verify_interval_days,
        staggerMinutes: o.verify_stagger_minutes,
      },
      readOnly: o.read_only,
      locks: o.locks.map((l) => ({
        id: l.id,
        name: l.name,
        nodeId: l.node_id,
        maxCodeSlots: l.max_code_slots,
      })),
    };
    // Validate the shaped object against the same Zod schema we use for YAML mode,
    // so any drift between the two paths fails loudly.
    const re = LocksConfigSchema.safeParse(config);
    if (!re.success) throw new Error(`addon config shape mismatch: ${re.error.message}`);
    return { ...config, warnings };
  }

  // ... existing YAML interpolation + validation (unchanged) ...
}
```

(Preserve the existing YAML branch verbatim — just nest it under `else` of the addon check.)

- [ ] **Step 5: Run tests — confirm pass**

Run: `npx vitest run tests/unit/config-options.test.ts && npx vitest run`
Expected: 3 new tests pass; previous 138 pass.

- [ ] **Step 6: Commit**

```
feat(config): addon-mode loader reads /data/options.json when SUPERVISOR_TOKEN is set
```

---

## Phase 2 — Add-on manifest, Dockerfile, run.sh

### Task 2: Scaffold `addon/` directory

**Files:**
- Create: `addon/repository.yaml`
- Create: `addon/zwavejs-lock-users/config.yaml`
- Create: `addon/zwavejs-lock-users/Dockerfile`
- Create: `addon/zwavejs-lock-users/run.sh`
- Create: `addon/zwavejs-lock-users/README.md`
- Create: `addon/zwavejs-lock-users/CHANGELOG.md`
- Create: `addon/zwavejs-lock-users/icon.png` (placeholder; replace later)

- [ ] **Step 1: `addon/repository.yaml`**

```yaml
name: rgregg's lock add-ons
url: https://github.com/rgregg/zwavejs-lock-users
maintainer: Ryan Gregg
```

- [ ] **Step 2: `addon/zwavejs-lock-users/config.yaml`**

```yaml
name: ZWaveJS Lock Users
version: "0.1.0"
slug: zwavejs_lock_users
description: Synchronize PIN codes across Z-Wave door locks and notify via Home Assistant.
url: https://github.com/rgregg/zwavejs-lock-users
arch:
  - amd64
  - aarch64
init: false
startup: services
boot: auto
panel_icon: mdi:lock-outline
ingress: true
ingress_port: 8080
homeassistant_api: true
hassio_api: true
auth_api: false
discovery:
  - zwave_js
services:
  - zwave_js:want
options:
  read_only: true
  notify_service: notify.notify
  verify_interval_days: 7
  verify_stagger_minutes: 60
  locks: []
schema:
  read_only: bool
  notify_service: str
  verify_interval_days: int(1,365)
  verify_stagger_minutes: int(0,1440)
  locks:
    - id: str
      name: str
      node_id: int(1,232)
      max_code_slots: int(1,250)?
```

Notes:
- `ingress: true` means HA proxies `/api/hassio_ingress/<token>/` to our `:8080`. No port mapping needed. HA handles auth.
- `homeassistant_api: true` + `discovery: [zwave_js]` lets the supervisor inject the Z-Wave JS connection details.
- `services: ["zwave_js:want"]` declares a soft dependency: install order hint, not a hard requirement.
- `schema.max_code_slots: int(1,250)?` — `?` means optional; defaults to 30 in code if omitted.

- [ ] **Step 3: `addon/zwavejs-lock-users/Dockerfile`**

```dockerfile
ARG BUILD_FROM
FROM $BUILD_FROM AS base

# Install Node 22
RUN apk add --no-cache nodejs npm

# Build stage
FROM base AS build
WORKDIR /build
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --include=dev
COPY src ./src
RUN npx tsc -p tsconfig.json

# Runtime stage
FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /build/dist ./dist
COPY addon/zwavejs-lock-users/run.sh /run.sh
RUN chmod +x /run.sh
EXPOSE 8080
CMD ["/run.sh"]
```

Note the COPY paths assume the build context is the repo root. The HA build CLI sets context to the add-on directory by default — we override with a `build.yaml`:

- [ ] **Step 4: `addon/zwavejs-lock-users/build.yaml`**

```yaml
build_from:
  amd64: ghcr.io/home-assistant/amd64-base:3.19
  aarch64: ghcr.io/home-assistant/aarch64-base:3.19
args:
  BUILDKIT_INLINE_CACHE: 1
codenotary:
  signer: notary@home-assistant.io
  base_image: notary@home-assistant.io
```

For local dev test builds, we'll invoke `docker build` from the repo root with `-f addon/zwavejs-lock-users/Dockerfile` so the context includes `package.json`, `src/`, etc.

- [ ] **Step 5: `addon/zwavejs-lock-users/run.sh`**

```bash
#!/usr/bin/with-contenv bashio
set -euo pipefail

# Provide the supervisor token to the Node app for HA REST calls.
export HA_TOKEN="${SUPERVISOR_TOKEN:-}"

# /data/options.json is HA-managed. Loader auto-detects addon mode via SUPERVISOR_TOKEN.
export DATA_DIR=/data
export PORT=8080
export LOG_LEVEL="$(bashio::config 'log_level' 'info')"

# Generate a stable LOCAL_SECRET if missing (HA add-on persists /data across upgrades).
if [ ! -f /data/local_secret ]; then
  head -c 32 /dev/urandom | xxd -p > /data/local_secret
fi
export LOCAL_SECRET="$(cat /data/local_secret)"

bashio::log.info "Starting zwavejs-lock-users (addon mode)"
exec node /app/dist/index.js
```

`bashio` is HA's add-on shell helper, present in HA base images. We use it to log nicely; everything else is plain bash.

- [ ] **Step 6: README + CHANGELOG**

Create `addon/zwavejs-lock-users/README.md`:

```markdown
# ZWaveJS Lock Users — Home Assistant Add-on

Sync PIN codes across multiple Z-Wave door locks and notify via Home Assistant.

## Install

1. Settings → Add-ons → Add-on Store → ⋮ → Repositories
2. Add `https://github.com/rgregg/zwavejs-lock-users`
3. Install "ZWaveJS Lock Users"
4. Configure your locks in the Configuration tab
5. Start the add-on; open from the sidebar

See the project README for the design notes.
```

Create `addon/zwavejs-lock-users/CHANGELOG.md`:

```markdown
## 0.1.0 — initial add-on release

- Auto-discovers zwave-js-server URL from the Z-Wave JS add-on
- Notifications via Home Assistant Supervisor (no long-lived token required)
- Ingress UI behind HA auth
- Read-only mode default for safe first launch
```

- [ ] **Step 7: Add a placeholder icon**

Generate a 128x128 lock icon (any PNG; can replace later). For now copy from somewhere or use a black-on-white text rendering. If you have ImageMagick:

```bash
convert -size 128x128 xc:#2563eb -font DejaVu-Sans-Bold -pointsize 80 -fill white -gravity center -draw "text 0,0 '🔒'" addon/zwavejs-lock-users/icon.png
```

Otherwise commit a minimal placeholder; users can fork and replace.

- [ ] **Step 8: Verify the Dockerfile builds locally**

```bash
docker build -f addon/zwavejs-lock-users/Dockerfile \
  --build-arg BUILD_FROM=ghcr.io/home-assistant/amd64-base:3.19 \
  -t zwavejs-lock-users-addon:test .
```

Expected: build succeeds.

- [ ] **Step 9: Commit**

```
feat(addon): add HA add-on manifest, dockerfile, and run.sh
```

---

## Phase 3 — Z-Wave URL discovery via Supervisor

In addon mode the `zwaveJs.url` is empty after Phase 1's loader runs. We resolve it at app startup by querying the Supervisor's discovery endpoint.

### Task 3: Discovery client

**Files:**
- Create: `src/config/discovery.ts`
- Modify: `src/app.ts` (call discovery in addon mode before constructing `ZWaveJSClient`)
- Create: `tests/unit/discovery.test.ts`

- [ ] **Step 1: Failing test**

Create `tests/unit/discovery.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { discoverZwaveJsUrl } from "../../src/config/discovery.js";

describe("discoverZwaveJsUrl", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("returns the WS URL from the supervisor's zwave_js discovery", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          discovery: [
            { service: "zwave_js", uuid: "x", config: { host: "core-zwave-js", port: 3000 } },
          ],
        },
      }),
    });
    const url = await discoverZwaveJsUrl({ supervisorToken: "tok" });
    expect(url).toBe("ws://core-zwave-js:3000");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://supervisor/discovery",
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer tok" }),
      }),
    );
  });

  it("throws when no zwave_js discovery is registered", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { discovery: [] } }),
    });
    await expect(discoverZwaveJsUrl({ supervisorToken: "t" })).rejects.toThrow(/not discovered/i);
  });
});
```

- [ ] **Step 2: Implement**

Create `src/config/discovery.ts`:

```ts
interface DiscoverOpts {
  supervisorToken: string;
  supervisorUrl?: string; // override for tests
}

interface DiscoveryEntry {
  service: string;
  config: { host?: string; port?: number };
}

export async function discoverZwaveJsUrl(opts: DiscoverOpts): Promise<string> {
  const base = opts.supervisorUrl ?? "http://supervisor";
  const res = await fetch(`${base}/discovery`, {
    headers: { authorization: `Bearer ${opts.supervisorToken}` },
  });
  if (!res.ok) throw new Error(`Supervisor discovery failed: ${res.status}`);
  const body = (await res.json()) as { data?: { discovery?: DiscoveryEntry[] } };
  const zwave = body.data?.discovery?.find((d) => d.service === "zwave_js");
  if (!zwave) throw new Error("zwave_js service not discovered by supervisor");
  const host = zwave.config.host;
  const port = zwave.config.port ?? 3000;
  if (!host) throw new Error("zwave_js discovery missing host");
  return `ws://${host}:${port}`;
}
```

- [ ] **Step 3: Wire into `buildFullApp`**

In `src/app.ts`, after `loadLocksConfig` returns, if `config.zwaveJs.url === ""` (the addon-mode sentinel), call `discoverZwaveJsUrl` using `process.env.SUPERVISOR_TOKEN`. If discovery fails, fall back to error mode with a clear message.

```ts
if (!config.zwaveJs.url && process.env.SUPERVISOR_TOKEN) {
  config.zwaveJs.url = await discoverZwaveJsUrl({
    supervisorToken: process.env.SUPERVISOR_TOKEN,
  });
}
```

- [ ] **Step 4: Run tests**

`npm test` → all pass (138 + 2 = 140).

- [ ] **Step 5: Commit**

```
feat(addon): discover zwave-js-server URL via supervisor in addon mode
```

---

## Phase 4 — Ingress path handling

Behind HA Ingress, the public URL is `https://ha.local/api/hassio_ingress/<token>/users`. HA strips the prefix and forwards to our service as `/users`. Most things work because our HTML uses relative URLs — but two specific places might break:

1. The `<a href="/users">` brand link in the header. Behind ingress this resolves to `https://ha.local/users`, escaping the ingress path. **Fix:** make the brand href relative or honor `X-Ingress-Path`.
2. HTMX `hx-get="/status"` — same issue: absolute path bypasses the ingress prefix. **Fix:** use relative paths (`hx-get="status"`) — but then path resolution depends on the current URL, which is inconsistent across pages.

The cleanest fix: read `X-Ingress-Path` once at request time and prefix all internal links. Pass it through `LayoutOpts`.

### Task 4: Ingress path threading

**Files:**
- Modify: `src/http/server.ts` (preHandler hook to read header)
- Modify: `src/http/views/layout.ts` (accept `basePath` in opts; prefix links)
- Modify: each `renderXxxPage` to thread `basePath` through
- Modify: each route to compute `basePath` from the request
- Add: tests asserting links are correctly prefixed when the header is present

- [ ] **Step 1: Add a Fastify preHandler that captures `X-Ingress-Path`**

In `src/http/server.ts`:

```ts
app.decorateRequest("basePath", "");
app.addHook("preHandler", (req, _reply, done) => {
  const ip = req.headers["x-ingress-path"];
  if (typeof ip === "string") (req as { basePath: string }).basePath = ip;
  done();
});
```

- [ ] **Step 2: Layout accepts and uses `basePath`**

```ts
export interface LayoutOpts {
  readOnly?: boolean;
  activeNav?: ActiveNav;
  basePath?: string; // prepended to internal hrefs (empty for non-ingress)
}
```

Inside `layout()`, build link helpers:

```ts
const link = (path: string) => `${opts?.basePath ?? ""}${path}`;
// brand: <a href="${link("/users")}">
// nav tabs: href="${link("/users")}" etc.
// hx-get for status: hx-get="${link("/status")}"
```

- [ ] **Step 3: Routes thread `basePath` into views**

```ts
app.get("/users", async (req, reply) => {
  const basePath = (req as { basePath: string }).basePath;
  reply.type("text/html");
  return renderUsersPage(deps.store.listUsers(), {
    readOnly: deps.readOnly ?? false,
    basePath,
  });
});
```

Repeat for `/locks`, `/locks/:id/drift`, `/events`, `/users/:id/edit-form`, `/users/:id/row`. The fragments returned by HTMX endpoints don't need the prefix — HTMX uses relative URLs from the originating page. But form `action` attributes do: those are submitted as absolute paths. Add `basePath` to form actions in `renderUserRow`, `renderUserRowEdit`, `renderLocksPage`, `renderDriftPage`, `renderEventsPage`.

- [ ] **Step 4: Tests**

Add to `tests/unit/http-users.test.ts`:

```ts
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
```

- [ ] **Step 5: Run tests**

`npm test` → all pass.

- [ ] **Step 6: Commit**

```
feat(http): honor X-Ingress-Path header so links work behind HA Ingress
```

---

## Phase 5 — Multi-arch CI build

Custom add-on repos commonly publish images to GHCR (GitHub Container Registry) so HA installs are fast. Without this, `arch: amd64, aarch64` requires HA users to build locally on first install (slow on a Pi).

### Task 5: GitHub Actions workflow for add-on image builds

**Files:**
- Create: `.github/workflows/addon-build.yml`

- [ ] **Step 1: Workflow**

```yaml
name: Build add-on images

on:
  push:
    branches: [main]
    paths:
      - "src/**"
      - "addon/**"
      - "package*.json"
      - "tsconfig.json"
  workflow_dispatch:

jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    strategy:
      matrix:
        arch: [amd64, aarch64]
    steps:
      - uses: actions/checkout@v4

      - uses: docker/setup-qemu-action@v3
        if: matrix.arch != 'amd64'

      - uses: docker/setup-buildx-action@v3

      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Resolve version
        id: meta
        run: |
          VERSION=$(awk -F'"' '/^version:/ {print $2}' addon/zwavejs-lock-users/config.yaml)
          echo "version=$VERSION" >> "$GITHUB_OUTPUT"

      - name: Build and push
        uses: docker/build-push-action@v5
        with:
          context: .
          file: addon/zwavejs-lock-users/Dockerfile
          platforms: linux/${{ matrix.arch == 'aarch64' && 'arm64' || 'amd64' }}
          push: true
          build-args: |
            BUILD_FROM=ghcr.io/home-assistant/${{ matrix.arch }}-base:3.19
          tags: |
            ghcr.io/rgregg/zwavejs-lock-users-${{ matrix.arch }}:${{ steps.meta.outputs.version }}
            ghcr.io/rgregg/zwavejs-lock-users-${{ matrix.arch }}:latest
```

- [ ] **Step 2: Update `config.yaml` to point at pre-built images**

Add to `addon/zwavejs-lock-users/config.yaml`:

```yaml
image: ghcr.io/rgregg/zwavejs-lock-users-{arch}
```

HA replaces `{arch}` with the host arch. With this, HA pulls the pre-built image instead of building locally.

- [ ] **Step 3: Push, watch the workflow run, fix any build issues**

- [ ] **Step 4: Commit**

```
ci(addon): multi-arch build to GHCR; config points at prebuilt images
```

---

## Phase 6 — Local validation against a real HA

This phase is manual; capture a checklist for the implementer.

### Task 6: Smoke test the add-on against a real HA instance

- [ ] Add the GitHub repo URL to HA: Settings → Add-ons → Store → ⋮ → Repositories → paste `https://github.com/rgregg/zwavejs-lock-users`.
- [ ] Refresh the store, verify "ZWaveJS Lock Users" appears.
- [ ] Install. Should download the pre-built image (no local build).
- [ ] Configure: add the kitchen-door entry in the Configuration tab, set `read_only: true`. Save.
- [ ] Start the add-on. Tail logs. Expect:
  - `bashio: Starting zwavejs-lock-users (addon mode)`
  - `READ ONLY mode — no writes will be issued`
  - `verify completed lockId=kitchen-door drifted=N`
  - `listening port=8080`
  - No `schema_incompatible`, no `not_listening`, no `Supervisor discovery failed`.
- [ ] Open the sidebar entry → ingress UI loads, sticky theme, READ ONLY badge.
- [ ] Click around: `/locks`, `/users`, `/events`, drift page. All links work behind ingress.
- [ ] Manually adopt a slot. Verify users.json updated and drift cleared on next verify.
- [ ] Walk to a real lock, unlock with a keypad code. HA notification fires through `notify.family`.
- [ ] Stop add-on, edit options to `read_only: false`, restart. Watch the reconciler push any pending writes.
- [ ] Walk through the full smoke checklist (`docs/smoke-test-checklist.md`).

If any of these steps fail: capture the log + the request that broke and file an issue. Fix before tagging the version.

---

## Phase 7 — Publish

### Task 7: Tag the release

- [ ] Bump `addon/zwavejs-lock-users/config.yaml` `version` to `0.1.0`.
- [ ] Update `CHANGELOG.md` with the actual changes.
- [ ] `git tag addon-0.1.0` and push.
- [ ] HA add-on store will pick up the new version next refresh; users see "Update available".

---

## Open questions (decide before starting)

1. **Repo layout**: this plan keeps the add-on in `addon/` of the same repo. Alternative: separate repo (`rgregg/zwavejs-lock-users-addon`) that pulls a built image from this repo's GHCR. The single-repo approach keeps source + add-on in lockstep but requires careful path handling in CI. **Recommended: single repo**, this plan assumes that.

2. **Snake_case vs camelCase in options.json**: HA convention is snake_case. Our internal types are camelCase. The loader translates. Cost: every options-schema change must be reflected in the loader's mapping. **Acceptable.**

3. **`read_only` default in addon mode**: defaulting to `true` (this plan) means HA users can't accidentally write to their locks on first install. They have to consciously flip the flag. Worth the friction.

4. **Discovery vs. service-call**: this plan uses Supervisor's `/discovery` endpoint. Alternative: read `/services/zwave_js` (different endpoint with a slightly different shape). Both work; discovery is more idiomatic.

5. **Ingress + standalone path collision**: the `basePath` threading should be a no-op when the header is absent (covered by Phase 4 tests). Standalone deployments via docker-compose continue to work without changes.

6. **Icon**: use a real designed icon before publishing publicly. Until then a placeholder is fine for personal use.

---

## Out of scope (do not do as part of this conversion)

- Submission to the official HA add-ons repository. Custom-repo distribution is sufficient.
- Add-on auto-updating via Watchtower or similar. HA's own update mechanism handles this.
- Multi-tenant config (multiple lock fleets per HA instance). One add-on per HA instance is the assumption.
- Replacing standalone docker-compose mode. Both must continue to work — this plan is purely additive.
