import { describe, expect, it } from "vitest";

import { belongsOnFrame, homeFrameOf } from "../comments-client";

/**
 * The same screen is drawn once per group it sits in (today's design opens every exploration panel), so a
 * comment comes back on ONE frame: the one of the group it was drawn in, or the first carrying its screen when
 * that group is not on the tab. Drawn on every copy it is duplicated once per group; drawn on none, a
 * grouped-view comment leads nowhere on the exploration tab.
 */
const explore = [
  { screenId: "trips-overview", groupId: "trips-overview-scan" },
  { screenId: "trips-overview", groupId: "trips-overview-attention" },
  { screenId: "trips-items", groupId: "trips-overview-scan" },
];
const kinds = [{ screenId: "trips-overview", groupId: "Trips Today" }];

describe("homeFrameOf", () => {
  it("is the frame of the group the comment was drawn in", () => {
    const drawn = { screenId: "trips-overview", flowId: "trips-overview-attention" };
    expect(homeFrameOf(drawn, explore)?.groupId).toBe("trips-overview-attention");
  });
  it("falls back to the first frame carrying the screen when that group is not on the tab", () => {
    const grouped = { screenId: "trips-overview", flowId: "trips-today" };
    expect(homeFrameOf(grouped, explore)?.groupId).toBe("trips-overview-scan");
    expect(homeFrameOf(grouped, kinds)?.groupId).toBe("Trips Today");
  });
  it("treats a comment saved before groups were recorded the same way", () => {
    expect(homeFrameOf({ screenId: "trips-overview" }, explore)?.groupId).toBe("trips-overview-scan");
  });
  it("is nothing when the screen is not on the tab", () => {
    expect(homeFrameOf({ screenId: "trips-archive", flowId: "x" }, explore)).toBeUndefined();
  });
});

describe("belongsOnFrame", () => {
  const drawn = { screenId: "trips-overview", flowId: "trips-overview-attention" };
  it("draws a comment on its home frame and nowhere else", () => {
    expect(belongsOnFrame(drawn, explore[1], explore)).toBe(true);
    expect(belongsOnFrame(drawn, explore[0], explore)).toBe(false);
    expect(belongsOnFrame(drawn, explore[2], explore)).toBe(false);
  });
});
