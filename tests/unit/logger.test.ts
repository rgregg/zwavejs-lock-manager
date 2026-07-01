import { afterEach, describe, it, expect, vi } from "vitest";
import { Writable } from "node:stream";
import { createLogger } from "../../src/util/logger.js";

afterEach(() => vi.unstubAllEnvs());

function captureStream(): { stream: Writable; output: () => string } {
  const chunks: Buffer[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(Buffer.from(chunk));
      cb();
    },
  });
  return { stream, output: () => Buffer.concat(chunks).toString("utf8") };
}

describe("logger", () => {
  it("falls back to info when LOG_LEVEL is empty/whitespace", () => {
    vi.stubEnv("LOG_LEVEL", "   ");
    // pino throws on a blank level; this must not.
    const log = createLogger();
    expect(log.level).toBe("info");
  });

  it("redacts pin fields", () => {
    const { stream, output } = captureStream();
    const log = createLogger({ level: "info", stream });
    log.info({ user: "alice", pin: "1234" }, "create user");
    const out = output();
    expect(out).not.toContain("1234");
    expect(out).toContain("[Redacted]");
    expect(out).toContain("alice");
  });
});
