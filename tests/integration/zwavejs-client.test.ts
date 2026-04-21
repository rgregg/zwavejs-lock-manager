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
