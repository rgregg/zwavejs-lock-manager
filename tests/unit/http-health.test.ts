import { describe, it, expect } from "vitest";
import { buildServer } from "../../src/http/server.js";

describe("GET /healthz", () => {
  it("returns 200 OK", async () => {
    const app = buildServer({});
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("ok");
    await app.close();
  });
});
