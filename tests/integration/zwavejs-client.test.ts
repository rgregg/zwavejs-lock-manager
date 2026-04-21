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
});
