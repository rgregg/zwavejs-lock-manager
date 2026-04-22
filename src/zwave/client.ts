// Targets zwave-js-server schema version 37 (released with zwave-js-server 1.34+).
// Minimum acceptable is 25 — older servers won't support User Code CC value writes
// as we use them. If the server offers an older max, connection fails at startup.
import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import type { EventBus } from "../events/bus.js";
import type { UserCodeSlot } from "./types.js";

const TARGET_SCHEMA_VERSION = 37;
const MIN_ACCEPTABLE_SCHEMA_VERSION = 25;

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
      } catch {
        out.push({ slot, status: "unknown" });
      }
    }
    return out;
  }
}
