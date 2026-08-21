import type { FastifyInstance, FastifyReply } from "fastify";
import type { EventLog } from "../../log/event-log.js";
import type { LoggedEvent } from "../../log/types.js";
import { renderEventRow, renderEventsPage } from "../views/events.js";

interface EventsDeps {
  eventLog: EventLog;
  readOnly?: boolean;
  /** Heartbeat comment interval, ms. Overridable for tests. */
  heartbeatMs?: number;
}

const DEFAULT_HEARTBEAT_MS = 25_000;

export function registerEventsRoutes(app: FastifyInstance, deps: EventsDeps): void {
  app.get("/events", async (_req, reply) => {
    const tail = await deps.eventLog.tail(200);
    reply.type("text/html");
    return renderEventsPage(tail, deps.readOnly !== undefined ? { readOnly: deps.readOnly } : undefined);
  });

  const heartbeatMs = deps.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  // Open streams, so a server shutdown doesn't wait on connections that by
  // design never end.
  const open = new Set<FastifyReply>();

  app.get("/events/stream", (req, reply) => {
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      // Ingress and other reverse proxies buffer responses by default, which
      // holds events until the (never-arriving) end of the stream.
      "x-accel-buffering": "no",
    });
    // Flush the head immediately. Until some body byte is written the client
    // sees an empty socket and proxies reap it as a dead connection.
    reply.raw.write(": connected\n\n");

    // Every logged event is relayed — writes, notification failures and unlocks
    // alike. Subscribing to the log rather than the bus is what keeps the live
    // view in step with the page you get on reload.
    const offAppend = deps.eventLog.onAppend((event: LoggedEvent) => {
      // The row is rendered server-side so the live feed and a page reload agree
      // on how an event reads.
      const payload = { event, html: renderEventRow(event) };
      reply.raw.write(`event: log\ndata: ${JSON.stringify(payload)}\n\n`);
    });
    const ping = setInterval(() => reply.raw.write(": ping\n\n"), heartbeatMs);
    // Node keeps the process alive for a pending timer; a heartbeat shouldn't.
    ping.unref?.();

    open.add(reply);
    const cleanup = (): void => {
      offAppend();
      clearInterval(ping);
      open.delete(reply);
    };
    req.raw.on("close", cleanup);
    req.raw.on("error", cleanup);
  });

  app.addHook("onClose", (_instance, done) => {
    for (const reply of open) reply.raw.destroy();
    open.clear();
    done();
  });
}
