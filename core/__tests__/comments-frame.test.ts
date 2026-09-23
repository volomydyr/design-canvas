import { describe, expect, it } from "vitest";

import { belongsOnFrame, homeFrameOf } from "../comments-client";

/**
 * The same screen is drawn once per group it sits in (today's design opens every exploration panel), so a
 * comment comes back on ONE frame: the one of the group it was drawn in, or the first carrying its screen when
 * that group is not on the tab. Owner, 2026-09-21: "it actually duplicates it as many as there are groups";
 * 2026-09-22, after the first fix drew a grouped-view comment nowhere on the exploration tab: "there's a
 * comment #5 (the last one) that simply doesn't lead anywhere".
 */
const explore = [
  { screenId: "stock-overview", groupId: "stock-overview-scan" },
  { screenId: "stock-overview", groupId: "stock-overview-attention" },
  { screenId: "stock-pieces", groupId: "stock-overview-scan" },
];
const kinds = [{ screenId: "stock-overview", groupId: "Stock Today" }];

describe("homeFrameOf", () => {
  it("is the frame of the group the comment was drawn in", () => {
    const drawn = { screenId: "stock-overview", flowId: "stock-overview-attention" };
    expect(homeFrameOf(drawn, explore)?.groupId).toBe("stock-overview-attention");
  });
  it("falls back to the first frame carrying the screen when that group is not on the tab", () => {
    const grouped = { screenId: "stock-overview", flowId: "stock-today" };
    expect(homeFrameOf(grouped, explore)?.groupId).toBe("stock-overview-scan");
    expect(homeFrameOf(grouped, kinds)?.groupId).toBe("Stock Today");
  });
  it("treats a comment saved before groups were recorded the same way", () => {
    expect(homeFrameOf({ screenId: "stock-overview" }, explore)?.groupId).toBe("stock-overview-scan");
  });
  it("is nothing when the screen is not on the tab", () => {
    expect(homeFrameOf({ screenId: "stock-memo", flowId: "x" }, explore)).toBeUndefined();
  });
});

describe("belongsOnFrame", () => {
  const drawn = { screenId: "stock-overview", flowId: "stock-overview-attention" };
  it("draws a comment on its home frame and nowhere else", () => {
    expect(belongsOnFrame(drawn, explore[1], explore)).toBe(true);
    expect(belongsOnFrame(drawn, explore[0], explore)).toBe(false);
    expect(belongsOnFrame(drawn, explore[2], explore)).toBe(false);
  });
});
