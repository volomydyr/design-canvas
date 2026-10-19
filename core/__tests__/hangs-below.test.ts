import { describe, expect, it } from "vitest";

import { hangsBelow } from "../picture-size";

/**
 * One rule places the tooltip and the comment box on a frame: below what they hang from when they fit above the bottom
 * limit (the window's edge, or the top of the review row for a comment box), else above.
 */
describe("hangsBelow", () => {
  it("hangs below when the panel clears the bottom limit", () => {
    expect(hangsBelow({ anchorBottom: 400, height: 300, gap: 12, bottom: 800 })).toBe(true);
  });
  it("hangs above when the panel would cross the bottom limit, as a comment box near the review row would", () => {
    /* The review row's top at 990 in a 1080 px window: a 260 px box under a region ending at 760 would reach 1032. */
    expect(hangsBelow({ anchorBottom: 760, height: 260, gap: 12, bottom: 990 - 12 })).toBe(false);
  });
  it("counts the gap, so a panel that only fits without it goes above", () => {
    expect(hangsBelow({ anchorBottom: 500, height: 300, gap: 12, bottom: 805 })).toBe(false);
    expect(hangsBelow({ anchorBottom: 500, height: 300, gap: 12, bottom: 812 })).toBe(true);
  });
});
