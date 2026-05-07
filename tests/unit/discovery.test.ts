import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { discoverZwaveJsUrl } from "../../src/config/discovery.js";

describe("discoverZwaveJsUrl", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("returns the WS URL from the supervisor's zwave_js discovery", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          discovery: [
            { service: "zwave_js", uuid: "x", config: { host: "core-zwave-js", port: 3000 } },
          ],
        },
      }),
    });
    const url = await discoverZwaveJsUrl({ supervisorToken: "tok" });
    expect(url).toBe("ws://core-zwave-js:3000");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://supervisor/discovery",
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer tok" }),
      }),
    );
  });

  it("throws when no zwave_js discovery is registered", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { discovery: [] } }),
    });
    await expect(discoverZwaveJsUrl({ supervisorToken: "t" })).rejects.toThrow(/not discovered/i);
  });
});
