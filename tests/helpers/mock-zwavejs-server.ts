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
