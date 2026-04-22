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

type ConnectionState = "waitingForSchema" | "waitingForListening" | "ready";

export class MockZwaveJsServer {
  private server: Server;
  private wss: WebSocketServer;
  private sockets = new Map<WebSocket, ConnectionState>();
  readonly commands: RecordedCommand[] = [];
  private resultHandlers = new Map<string, ResultHandler>();
  port = 0;
  readonly strict: boolean;

  constructor({ strict = true }: { strict?: boolean } = {}) {
    this.strict = strict;
    this.server = createServer();
    this.wss = new WebSocketServer({ server: this.server });
    this.wss.on("connection", (socket) => {
      this.sockets.set(socket, "waitingForSchema");
      socket.send(
        JSON.stringify({
          type: "version",
          driverVersion: "test",
          serverVersion: "1.34.0",
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

        const state = this.sockets.get(socket) ?? "ready";

        // Always record every incoming command
        this.commands.push({
          id: msg.messageId,
          command: msg.command,
          ...(msg.nodeId !== undefined ? { nodeId: msg.nodeId } : {}),
          args: msg,
        });

        if (this.strict) {
          if (state === "waitingForSchema") {
            if (msg.command !== "set_api_schema") {
              socket.send(
                JSON.stringify({
                  type: "result",
                  messageId: msg.messageId,
                  success: false,
                  errorCode: "schema_not_set",
                }),
              );
              return;
            }
            // Validate schemaVersion
            const sv = msg.schemaVersion;
            if (typeof sv !== "number" || sv < 0 || sv > 37) {
              socket.send(
                JSON.stringify({
                  type: "result",
                  messageId: msg.messageId,
                  success: false,
                  errorCode: "schema_incompatible",
                }),
              );
              return;
            }
            this.sockets.set(socket, "waitingForListening");
            socket.send(
              JSON.stringify({
                type: "result",
                messageId: msg.messageId,
                success: true,
                result: {},
              }),
            );
            return;
          }

          if (state === "waitingForListening") {
            if (msg.command !== "start_listening") {
              socket.send(
                JSON.stringify({
                  type: "result",
                  messageId: msg.messageId,
                  success: false,
                  errorCode: "not_listening",
                }),
              );
              return;
            }
            this.sockets.set(socket, "ready");
            socket.send(
              JSON.stringify({
                type: "result",
                messageId: msg.messageId,
                success: true,
                result: { state: {} },
              }),
            );
            return;
          }

          // In ready state: validate node.poll_value shape
          if (msg.command === "node.poll_value") {
            const valueId = msg.valueId as
              | { commandClass?: unknown; property?: unknown; propertyKey?: unknown }
              | undefined;
            const validProperty =
              valueId?.property === "userCode" || valueId?.property === "userIdStatus";
            if (
              !valueId ||
              valueId.commandClass !== 99 ||
              !validProperty ||
              typeof valueId.propertyKey !== "number"
            ) {
              socket.send(
                JSON.stringify({
                  type: "result",
                  messageId: msg.messageId,
                  success: false,
                  errorCode: "value_not_found",
                }),
              );
              return;
            }
          }

          // In ready state: validate node.set_value shape
          if (msg.command === "node.set_value") {
            const valueId = msg.valueId as
              | { commandClass?: unknown; property?: unknown; propertyKey?: unknown }
              | undefined;
            const validProperty =
              valueId?.property === "userCode" || valueId?.property === "userIdStatus";
            if (
              !valueId ||
              valueId.commandClass !== 99 ||
              !validProperty ||
              typeof valueId.propertyKey !== "number"
            ) {
              socket.send(
                JSON.stringify({
                  type: "result",
                  messageId: msg.messageId,
                  success: false,
                  errorCode: "value_not_found",
                }),
              );
              return;
            }
          }
        }

        // Ready state (or non-strict): dispatch to handlers
        const cmd = this.commands[this.commands.length - 1]!;
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
    for (const [s, state] of this.sockets) {
      if (!this.strict || state === "ready") {
        s.send(payload);
      }
    }
  }

  async stop(): Promise<void> {
    for (const s of this.sockets.keys()) s.terminate();
    await new Promise<void>((r) => this.wss.close(() => r()));
    await new Promise<void>((r) => this.server.close(() => r()));
  }
}
