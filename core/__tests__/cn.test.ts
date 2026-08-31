/**
 * `cn` joins classes and does NOT merge Tailwind conflicts — that is a deliberate choice documented in
 * `core/cn.ts`, and it only holds while nothing overrides a core utility from the call site. When something
 * does, the winner is Tailwind's emission order rather than the later argument, which once produced broken
 * geometry that a comment was then asked to prevent.
 *
 * These tests pin both halves of the contract: the joining never changes, and the conflict is announced in
 * development so a caller finds out from the console instead of from a screenshot.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { cn } from "../cn";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("cn", () => {
  it("joins truthy parts and drops the rest, unchanged", () => {
    expect(cn("a", false, undefined, "b", null, "")).toBe("a b");
  });

  it("still returns BOTH conflicting classes — it is a joiner, not a merger", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(cn("px-3.5", "px-0")).toBe("px-3.5 px-0");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("names the family and both classes, so the call site is findable", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    cn("px-3.5", "px-0");
    const message = String(warn.mock.calls[0]?.[0] ?? "");
    expect(message).toContain("px");
    expect(message).toContain("px-3.5");
    expect(message).toContain("px-0");
  });

  it("says nothing when the same class repeats, which is harmless", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(cn("p-2", "p-2")).toBe("p-2 p-2");
    expect(warn).not.toHaveBeenCalled();
  });

  it("says nothing about different families sitting side by side", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    cn("px-3", "py-2", "rounded-lg", "z-10", "flex items-center");
    expect(warn).not.toHaveBeenCalled();
  });

  it("leaves classes it does not model alone", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    cn("group-hover:underline", "data-[open]:block", "hover:bg-white");
    expect(warn).not.toHaveBeenCalled();
  });
});
