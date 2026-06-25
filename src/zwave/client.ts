// Targets zwave-js-server schema version 37 (released with zwave-js-server 1.34+).
// Minimum acceptable is 25 — older servers won't support User Code CC value writes
// as we use them. If the server offers an older max, connection fails at startup.
import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import type { EventBus } from "../events/bus.js";
import type { UserCodeSlot } from "./types.js";

const TARGET_SCHEMA_VERSION = 37;
const MIN_ACCEPTABLE_SCHEMA_VERSION = 25;

interface ZWaveJSClientOptions {
  url: string;
  bus: EventBus;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
  /** How long to wait after a Door Lock state-change before emitting a fallback
   *  unlock, giving a keypad notification time to arrive and attribute the user. */
  doorLockDebounceMs?: number;
  /** Window after a keypad unlock during which a Door Lock state-change is treated
   *  as the same physical unlock and suppressed (avoids a duplicate notification). */
  unlockDedupMs?: number;
  /** Interval between websocket heartbeat pings. A missed pong terminates the
   *  socket to force a reconnect, so a silently-dropped connection self-heals. */
  heartbeatIntervalMs?: number;
  log?: Logger;
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
  private readonly doorLockDebounceMs: number;
  private readonly unlockDedupMs: number;
  private readonly heartbeatIntervalMs: number;
  // Per-node timestamp of the last keypad-attributed unlock, used to suppress the
  // Door Lock fallback for the same physical unlock.
  private lastKeypadUnlockAt = new Map<number, number>();
  // Per-node pending Door Lock fallback timers, cancelled if a keypad notification
  // arrives for the same node before they fire.
  private pendingDoorLock = new Map<number, ReturnType<typeof setTimeout>>();

  constructor(private readonly opts: ZWaveJSClientOptions) {
    this.baseMs = opts.reconnectBaseMs ?? 1000;
    this.maxMs = opts.reconnectMaxMs ?? 30_000;
    this.doorLockDebounceMs = opts.doorLockDebounceMs ?? 2000;
    this.unlockDedupMs = opts.unlockDedupMs ?? 8000;
    this.heartbeatIntervalMs = opts.heartbeatIntervalMs ?? 30_000;
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.stopHeartbeat();
    for (const timer of this.pendingDoorLock.values()) clearTimeout(timer);
    this.pendingDoorLock.clear();
    this.socket?.terminate();
  }

  isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  private async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.opts.url);
      this.socket = ws;

      let handshakeDone = false;

      const fail = (err: Error) => {
        if (!handshakeDone) {
          handshakeDone = true;
          ws.terminate();
          reject(err);
        }
      };

      ws.once("error", (err) => {
        if (!handshakeDone) fail(err as Error);
      });

      ws.once("close", () => {
        if (!handshakeDone) {
          fail(new Error("connection closed during handshake"));
        } else {
          this.onClose();
        }
      });

      ws.once("open", () => {
        // Wait for version message, then perform handshake
        ws.once("message", (raw) => {
          let versionMsg: Record<string, unknown>;
          try {
            versionMsg = JSON.parse(raw.toString());
          } catch {
            fail(new Error("malformed version message from server"));
            return;
          }

          if (versionMsg.type !== "version") {
            fail(new Error(`expected version message, got: ${String(versionMsg.type)}`));
            return;
          }

          const maxSchemaVersion = versionMsg.maxSchemaVersion;
          if (typeof maxSchemaVersion !== "number") {
            fail(new Error("version message missing maxSchemaVersion"));
            return;
          }

          if (maxSchemaVersion < MIN_ACCEPTABLE_SCHEMA_VERSION) {
            fail(
              new Error(
                `server maxSchemaVersion ${maxSchemaVersion} is below minimum acceptable ${MIN_ACCEPTABLE_SCHEMA_VERSION}`,
              ),
            );
            return;
          }

          const schemaVersion = Math.min(TARGET_SCHEMA_VERSION, maxSchemaVersion);

          // Switch to normal message handler for result routing during handshake
          ws.on("message", (data) => this.handleMessage(data.toString()));

          // Perform set_api_schema then start_listening
          this.sendHandshake(ws, schemaVersion)
            .then(() => {
              handshakeDone = true;
              this.reconnectAttempts = 0;

              // Now that close during handshake won't fire, wire up onClose for future closes
              ws.removeAllListeners("close");
              ws.on("close", () => this.onClose());

              this.startHeartbeat(ws);

              this.opts.log?.info({ url: this.opts.url }, "connected to zwave-js-server");
              this.opts.bus.emit("connection", {
                ts: new Date().toISOString(),
                source: "zwaveJs",
                status: "connected",
              });
              resolve();
            })
            .catch((err) => {
              fail(err as Error);
            });
        });
      });
    });
  }

  private async sendHandshake(ws: WebSocket, schemaVersion: number): Promise<void> {
    // set_api_schema
    await this.sendAndWait(ws, "set_api_schema", { schemaVersion });
    // start_listening — ignore result.state payload
    await this.sendAndWait(ws, "start_listening", {});
  }

  private sendAndWait(ws: WebSocket, command: string, params: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const messageId = randomUUID();
      const payload = { messageId, command, ...params };
      this.pending.set(messageId, { resolve, reject });
      ws.send(JSON.stringify(payload));
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
    // Notification CC v8 (Access Control) carries the user-code slot in different
    // shapes depending on the lock model and zwave-js version:
    //   args.userId               (legacy / some custom shapes)
    //   args.parameters           (a bare number)
    //   args.parameters.userId    (object form, common for Yale Assure / Schlage)
    if (event.event === "notification" && typeof event.nodeId === "number") {
      const args = event.args as Record<string, unknown> | undefined;
      const slot = extractKeypadSlot(args);
      // Log every raw notification we see, regardless of parse outcome, so a
      // future shape we don't recognize can still be diagnosed from the logs.
      this.opts.log?.info(
        { nodeId: event.nodeId, args, parsedSlot: slot },
        slot !== undefined
          ? "zwave notification: extracted keypad slot"
          : "zwave notification: could not extract keypad slot",
      );
      if (slot !== undefined) {
        const nodeId = event.nodeId;
        // A keypad unlock attributes the user directly. Record it so the Door Lock
        // fallback for the same physical unlock is suppressed, and cancel any
        // fallback already scheduled (handles either event arrival order).
        this.lastKeypadUnlockAt.set(nodeId, Date.now());
        const pending = this.pendingDoorLock.get(nodeId);
        if (pending) {
          clearTimeout(pending);
          this.pendingDoorLock.delete(nodeId);
        }
        this.opts.bus.emit("unlock", {
          ts: new Date().toISOString(),
          lockId: `node-${nodeId}`,
          slot,
          source: "keypad",
        });
      }
      return;
    }

    // Fallback: a Door Lock (CC 0x62) state change to unsecured is the signal Home
    // Assistant itself uses, so it catches unlocks that emit no keypad notification
    // (fingerprint, thumbturn, key, app). Debounce briefly so a keypad notification
    // can arrive first and attribute the user; suppress if one just did.
    if (event.event === "value updated" && typeof event.nodeId === "number") {
      const args = event.args as Record<string, unknown> | undefined;
      if (
        args?.commandClass === 98 &&
        args?.property === "currentMode" &&
        isDoorLockUnsecured(args.newValue)
      ) {
        const nodeId = event.nodeId;
        const lastKeypad = this.lastKeypadUnlockAt.get(nodeId);
        if (lastKeypad !== undefined && Date.now() - lastKeypad < this.unlockDedupMs) {
          this.opts.log?.debug(
            { nodeId },
            "door lock unsecured; suppressed (recent keypad notification already handled it)",
          );
          return;
        }
        if (this.pendingDoorLock.has(nodeId)) return;
        this.opts.log?.info(
          { nodeId, newValue: args.newValue },
          "door lock unsecured; scheduling fallback unlock notification",
        );
        const timer = setTimeout(() => {
          this.pendingDoorLock.delete(nodeId);
          this.opts.bus.emit("unlock", {
            ts: new Date().toISOString(),
            lockId: `node-${nodeId}`,
            source: "doorLock",
          });
        }, this.doorLockDebounceMs);
        if (typeof timer.unref === "function") timer.unref();
        this.pendingDoorLock.set(nodeId, timer);
      }
    }
  }

  private onClose(): void {
    this.stopHeartbeat();
    this.opts.log?.warn({ url: this.opts.url }, "zwave-js-server connection closed");
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
    this.opts.log?.info({ delayMs: delay, attempt: this.reconnectAttempts }, "scheduling zwave-js reconnect");
    setTimeout(() => {
      this.connect().catch(() => void 0);
    }, delay);
  }

  // Websocket-level heartbeat. Without it, a silently-dropped connection (peer
  // reboot, NAT/conntrack idle timeout) leaves the socket in a half-open state that
  // never fires "close", so events stop arriving and no reconnect is triggered. We
  // ping on an interval and terminate the socket if a pong didn't come back since
  // the previous tick — terminate fires "close", which drives the reconnect path.
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private awaitingPong = false;

  private startHeartbeat(ws: WebSocket): void {
    this.stopHeartbeat();
    this.awaitingPong = false;
    ws.on("pong", () => {
      this.awaitingPong = false;
    });
    this.heartbeatTimer = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (this.awaitingPong) {
        this.opts.log?.warn({ url: this.opts.url }, "zwave-js heartbeat missed; terminating socket to force reconnect");
        ws.terminate();
        return;
      }
      this.awaitingPong = true;
      ws.ping();
    }, this.heartbeatIntervalMs);
    if (typeof this.heartbeatTimer.unref === "function") this.heartbeatTimer.unref();
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
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
      try {
        const statusResult = await this.call<{ value?: number } | null>("node.poll_value", {
          nodeId,
          valueId: { commandClass: 99, property: "userIdStatus", propertyKey: slot },
        });
        const status = statusResult?.value;
        if (status === 1) {
          const codeResult = await this.call<{ value?: string } | null>("node.poll_value", {
            nodeId,
            valueId: { commandClass: 99, property: "userCode", propertyKey: slot },
          });
          out.push({ slot, status: "enabled", pin: codeResult?.value ?? "" });
        } else if (status === 0) {
          out.push({ slot, status: "empty" });
        } else {
          out.push({ slot, status: "unknown" });
        }
      } catch (err) {
        if ((err as Error).message === "connection closed") throw err;
        out.push({ slot, status: "unknown" });
      }
    }
    return out;
  }
}

export function extractKeypadSlot(
  args: Record<string, unknown> | undefined,
): number | undefined {
  if (!args) return undefined;
  if (typeof args.userId === "number") return args.userId;
  const params = args.parameters;
  if (typeof params === "number") return params;
  if (params && typeof params === "object") {
    const inner = (params as Record<string, unknown>).userId;
    if (typeof inner === "number") return inner;
  }
  return undefined;
}

// Door Lock CC (0x62) currentMode values that mean the bolt is not secured. 0xFF is
// Secured (locked) and 0xFE is Unknown; everything else here is some unsecured state.
const DOOR_LOCK_UNSECURED_MODES = new Set([0, 1, 16, 17, 32, 33]);

export function isDoorLockUnsecured(mode: unknown): boolean {
  return typeof mode === "number" && DOOR_LOCK_UNSECURED_MODES.has(mode);
}
