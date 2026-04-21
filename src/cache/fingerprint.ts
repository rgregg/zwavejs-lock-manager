import { createHmac } from "node:crypto";

export function fingerprintPin(secret: string, pin: string): string {
  const mac = createHmac("sha256", secret).update(pin, "utf8").digest("hex");
  return `sha256:${mac}`;
}
