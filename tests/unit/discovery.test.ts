import { describe, expect, it, vi } from "vitest";
import { discoverZwaveJsUrl, DEFAULT_ZWAVE_CANDIDATES } from "../../src/config/discovery.js";

describe("discoverZwaveJsUrl", () => {
  it("returns the first candidate the prober can reach", async () => {
    const probe = vi.fn(async () => true);
    const url = await discoverZwaveJsUrl({
      candidates: ["ws://core-zwave-js:3000", "ws://a0d7b954-zwavejs2mqtt:3000"],
      probe,
    });
    expect(url).toBe("ws://core-zwave-js:3000");
    expect(probe).toHaveBeenCalledTimes(1);
    expect(probe).toHaveBeenCalledWith("ws://core-zwave-js:3000");
  });

  it("skips unreachable candidates and returns the first reachable one", async () => {
    const probe = vi.fn(async (url: string) => url === "ws://a0d7b954-zwavejs2mqtt:3000");
    const url = await discoverZwaveJsUrl({
      candidates: ["ws://core-zwave-js:3000", "ws://a0d7b954-zwavejs2mqtt:3000"],
      probe,
    });
    expect(url).toBe("ws://a0d7b954-zwavejs2mqtt:3000");
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("throws a clear, actionable error when no candidate is reachable", async () => {
    const probe = vi.fn(async () => false);
    await expect(
      discoverZwaveJsUrl({ candidates: ["ws://core-zwave-js:3000"], probe }),
    ).rejects.toThrow(/zwave_url/i);
  });

  it("probes the known Z-Wave JS add-on hostnames by default", async () => {
    const probe = vi.fn(async () => false);
    await expect(discoverZwaveJsUrl({ probe })).rejects.toThrow();
    expect(probe.mock.calls.map((c) => c[0])).toEqual(DEFAULT_ZWAVE_CANDIDATES);
    expect(DEFAULT_ZWAVE_CANDIDATES).toContain("ws://core-zwave-js:3000");
    expect(DEFAULT_ZWAVE_CANDIDATES).toContain("ws://a0d7b954-zwavejs2mqtt:3000");
  });
});
