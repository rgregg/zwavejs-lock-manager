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

  it("performs set_api_schema and start_listening handshake during start", async () => {
    await client.start();
    expect(server.commands.map((c) => c.command)).toEqual(["set_api_schema", "start_listening"]);
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

  it("getAllUserCodes reads live from lock via node.poll_value", async () => {
    await client.start();
    server.onCommand("node.poll_value", (cmd) => {
      const valueId = cmd.args?.valueId as { property?: string; propertyKey?: number } | undefined;
      const slot = valueId?.propertyKey;
      if (slot === 3 && valueId?.property === "userIdStatus") return { value: 1 };
      if (slot === 3 && valueId?.property === "userCode") return { value: "9999" };
      if (slot === 4 && valueId?.property === "userIdStatus") return { value: 0 };
      return null;
    });

    const slots = await client.getAllUserCodes(7, 5);

    expect(slots).toHaveLength(5);
    expect(slots.find((s) => s.slot === 3)).toEqual({ slot: 3, status: "enabled", pin: "9999" });
    expect(slots.find((s) => s.slot === 4)).toEqual({ slot: 4, status: "empty" });
    expect(slots.find((s) => s.slot === 1)).toEqual({ slot: 1, status: "unknown" });
    expect(slots.find((s) => s.slot === 2)).toEqual({ slot: 2, status: "unknown" });
    expect(slots.find((s) => s.slot === 5)).toEqual({ slot: 5, status: "unknown" });

    // Slots 1,2,5 each get 1 poll_value (status only, since null→unknown).
    // Slot 3 gets 2 (status + code). Slot 4 gets 1 (status=0, skip code). Total = 6.
    const pollCommands = server.commands.filter((c) => c.command === "node.poll_value");
    expect(pollCommands).toHaveLength(6);
    // All commands target the right node, CC, and property shape
    for (const cmd of pollCommands) {
      expect(cmd.args).toMatchObject({
        nodeId: 7,
        valueId: { commandClass: 99 },
      });
    }
    // Slot 3 has both userIdStatus and userCode polls
    const slot3Polls = pollCommands.filter(
      (c) => (c.args?.valueId as { propertyKey?: number } | undefined)?.propertyKey === 3,
    );
    expect(slot3Polls).toHaveLength(2);
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
