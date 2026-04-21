import { describe, it, expect } from "vitest";
import { fingerprintPin } from "../../src/cache/fingerprint.js";

describe("fingerprintPin", () => {
  it("returns an sha256-prefixed 64-hex string", () => {
    const fp = fingerprintPin("secret", "1234");
    expect(fp).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("is stable for the same inputs", () => {
    expect(fingerprintPin("k", "9999")).toBe(fingerprintPin("k", "9999"));
  });

  it("differs when the secret differs", () => {
    expect(fingerprintPin("a", "1234")).not.toBe(fingerprintPin("b", "1234"));
  });

  it("differs when the pin differs", () => {
    expect(fingerprintPin("k", "1111")).not.toBe(fingerprintPin("k", "2222"));
  });
});
