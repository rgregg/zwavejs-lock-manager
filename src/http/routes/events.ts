import type { FastifyInstance } from "fastify";
import type { EventLog } from "../../log/event-log.js";
import type { EventBus } from "../../events/bus.js";
import { renderEventsPage } from "../views/events.js";

interface EventsDeps {
  eventLog: EventLog;
  bus: EventBus;
  readOnly?: boolean;
}

export function registerEventsRoutes(app: FastifyInstance, deps: EventsDeps): void {
  app.get("/events", async (req, reply) => {
    const tail = await deps.eventLog.tail(200);
    reply.type("text/html");
    return renderEventsPage(tail, {
      ...(deps.readOnly !== undefined ? { readOnly: deps.readOnly } : {}),
      basePath: req.basePath,
    });
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
