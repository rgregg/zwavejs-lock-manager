import { describe, it, expect } from "vitest";
import { Writable } from "node:stream";
import { createLogger } from "../../src/util/logger.js";

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
