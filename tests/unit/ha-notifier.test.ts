import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HaNotifier } from "../../src/notifier/ha-notifier.js";

describe("HaNotifier", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => "" });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to HA with the resolved user name", async () => {
    const n = new HaNotifier({
      url: "http://ha.local:8123",
      token: "t",
      service: "notify.mobile_app_ryan",
    });
    await n.notifyUnlock({ lockName: "Front Door", userName: "Alice" });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://ha.local:8123/api/services/notify/mobile_app_ryan");
    expect(init).toMatchObject({
      method: "POST",
      headers: { authorization: "Bearer t", "content-type": "application/json" },
    });
    const body = JSON.parse(init.body as string);
    expect(body.message).toBe("Alice unlocked Front Door");
  });

  it("notifies about unknown slots", async () => {
    const n = new HaNotifier({
      url: "http://ha.local:8123",
      token: "t",
      service: "notify.mobile_app_ryan",
    });
    await n.notifyUnlock({ lockName: "Back Door", slot: 7 });
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body.message).toBe("Unknown user (slot 7) unlocked Back Door");
  });

  it("notifies generically when neither user nor slot is known (e.g. fingerprint/thumbturn)", async () => {
    const n = new HaNotifier({
      url: "http://ha.local:8123",
      token: "t",
      service: "notify.mobile_app_ryan",
    });
    await n.notifyUnlock({ lockName: "Side Door" });
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body.message).toBe("Side Door was unlocked");
  });

  it("includes the category in the body when configured (ticker.notify)", async () => {
    const n = new HaNotifier({
      url: "http://ha.local:8123",
      token: "t",
      service: "ticker.notify",
      category: "Cabin",
    });
    await n.notifyUnlock({ lockName: "Side Door" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://ha.local:8123/api/services/ticker/notify");
    const body = JSON.parse(init.body as string);
    expect(body.category).toBe("Cabin");
    expect(body.message).toBe("Side Door was unlocked");
  });

  it("omits category from the body when not configured", async () => {
    const n = new HaNotifier({ url: "http://ha.local:8123", token: "t", service: "notify.mobile_app_ryan" });
    await n.notifyUnlock({ lockName: "Side Door", userName: "Alice" });
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body).not.toHaveProperty("category");
  });

  it("returns an error result when HA is unreachable (no throw)", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const n = new HaNotifier({
      url: "http://ha.local:8123",
      token: "t",
      service: "notify.mobile_app_ryan",
    });
    const result = await n.notifyUnlock({ lockName: "Front Door", userName: "Alice" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/ECONNREFUSED/);
  });

  it("returns an error result for non-2xx responses", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: async () => "boom" });
    const n = new HaNotifier({
      url: "http://ha.local:8123",
      token: "t",
      service: "notify.mobile_app_ryan",
    });
    const result = await n.notifyUnlock({ lockName: "Front Door", userName: "Alice" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/500/);
  });
});
