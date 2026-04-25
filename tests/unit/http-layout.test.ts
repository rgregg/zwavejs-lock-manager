import { describe, it, expect } from "vitest";
import { layout } from "../../src/http/views/layout.js";

describe("layout()", () => {
  it("renders a <header> element", () => {
    const html = layout("Test", "<p>body</p>");
    expect(html).toContain("<header");
  });

  it("marks the active nav tab with aria-current=\"page\"", () => {
    const html = layout("Test", "<p>body</p>", { activeNav: "locks" });
    expect(html).toContain('aria-current="page"');
    expect(html).toMatch(/aria-current="page"[^>]*>Locks/s);
  });

  it("includes dark-mode CSS variables block", () => {
    const html = layout("Test", "<p>body</p>");
    expect(html).toContain("prefers-color-scheme: dark");
  });

  it("shows READ ONLY badge when readOnly is true", () => {
    const html = layout("Test", "<p>body</p>", { readOnly: true });
    expect(html).toContain("READ ONLY");
  });

  it("does not show READ ONLY badge when readOnly is false", () => {
    const html = layout("Test", "<p>body</p>", { readOnly: false });
    expect(html).not.toContain("READ ONLY");
  });

  it("does not mark any tab active when activeNav is omitted", () => {
    const html = layout("Test", "<p>body</p>");
    expect(html).not.toContain('aria-current="page"');
  });
});
