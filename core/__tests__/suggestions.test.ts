import { describe, expect, it } from "vitest";

import { layoutExplorations } from "../graph-layout";
import { remarkRoom, remarkTiles, STICKY_TOP, stickyHeight, TILE_LABEL } from "../remarks-layout";
import type { CanvasDeclaration, CanvasEvidence, CanvasScreen } from "../types";

/**
 * A SUGGESTION HANGS UNDER THE FRAME IT CHANGES: suggestions sit around the existing wireframes, not in separate
 * sections. So a screen with `suggests` is never an
 * option of its own: it is placed in the column of the frame it names, below it, and several stack downward.
 */
const shot = (id: string): CanvasScreen => ({ id, label: id, note: id, wireframe: `${id}.html`, redesigns: null });

function declaration(screens: CanvasScreen[]): CanvasDeclaration {
  return {
    title: "Test",
    note: "Test",
    viewport: { w: 1440, h: 900 },
    frameScale: 1,
    flows: [{ id: "today", title: "Today", screens: [{ id: "today-page", label: "Today", note: "Today", route: "/x" }], edges: [] }],
    explorations: [{ id: "panel", surface: "Panel", title: "Q", note: "N", original: "today-page", screens }],
  } as unknown as CanvasDeclaration;
}

describe("suggestions", () => {
  const layout = layoutExplorations(
    declaration([
      shot("page"),
      { ...shot("tab"), under: "page" },
      { ...shot("page-new"), suggests: "page" },
      { ...shot("page-new-2"), suggests: "page" },
      { ...shot("tab-new"), suggests: "tab" },
    ]),
  );
  const nodes = layout.groups[0].nodes;
  const at = (id: string) => nodes.find((node) => node.screen.id === id)!;

  it("reports nothing wrong", () => {
    expect(layout.problems).toEqual([]);
  });

  it("puts a suggestion in its frame's column, below it", () => {
    expect(at("page-new").x).toBe(at("page").x);
    expect(at("page-new").y).toBeGreaterThan(at("page").y + at("page").h);
    expect(at("tab-new").x).toBe(at("tab").x);
  });

  it("stacks several suggestions for one frame downward", () => {
    expect(at("page-new-2").x).toBe(at("page").x);
    expect(at("page-new-2").y).toBeGreaterThan(at("page-new").y + at("page-new").h);
  });

  it("never numbers a suggestion or makes it an option", () => {
    expect(at("page-new").option).toBeUndefined();
    expect(at("page-new").suggestion).toBe(true);
    expect(at("page-new").supporting).toBe(true);
  });

  it("runs a suggestion's steps to its right, as one row", () => {
    const rowed = layoutExplorations(
      declaration([
        shot("page"),
        { ...shot("lead"), suggests: "page" },
        { ...shot("lead-2"), suggests: "page", under: "lead" },
        { ...shot("other"), suggests: "page" },
      ]),
    );
    const node = (id: string) => rowed.groups[0].nodes.find((one) => one.screen.id === id)!;
    expect(rowed.problems).toEqual([]);
    expect(node("lead-2").y).toBe(node("lead").y);
    expect(node("lead-2").x).toBeGreaterThan(node("lead").x + node("lead").w);
    expect(node("other").y).toBeGreaterThan(node("lead").y + node("lead").h);
    expect(node("other").x).toBe(node("page").x);
  });

  it("refuses a suggestion step under anything but a suggestion for the same frame", () => {
    const broken = layoutExplorations(declaration([shot("page"), { ...shot("x"), suggests: "page", under: "page" }]));
    expect(broken.problems.join(" ")).toContain("which is not a suggestion for the same frame");
  });

  it("hangs a reference like a suggestion, in the same column", () => {
    const withRef = layoutExplorations(declaration([shot("page"), { ...shot("ref"), suggests: "page", reference: true }]));
    const ref = withRef.groups[0].nodes.find((one) => one.screen.id === "ref")!;
    const page = withRef.groups[0].nodes.find((one) => one.screen.id === "page")!;
    expect(ref.x).toBe(page.x);
    expect(ref.suggestion).toBe(true);
    expect(ref.option).toBeUndefined();
  });

  it("refuses a suggestion for a frame that is not in the panel", () => {
    const broken = layoutExplorations(declaration([shot("page"), { ...shot("x"), suggests: "elsewhere" }]));
    expect(broken.problems.join(" ")).toContain('suggests a change to "elsewhere"');
  });
});

/**
 * THE REMARKS BESIDE A FRAME: its sticky note on top, the real screenshots under it, all in room the layout keeps
 * free: the real screenshots beside each suggestion, named and highlighted on the part that matters, and everything
 * around the frame it belongs to.
 */
describe("remarks beside a frame", () => {
  const wide = (file: string): CanvasEvidence => ({ file, name: "Acme", w: 1600, h: 900 });
  const phone = (file: string): CanvasEvidence => ({ file, name: "Our Phone App", w: 600, h: 1304 });
  const W = 1152;
  const H = 720;

  it("takes no room when a frame has no remarks", () => {
    expect(remarkRoom({}, W, H)).toBe(0);
  });

  it("puts the screenshots to the right of the frame, under the note", () => {
    const sticky = "Every trip that starts is one draft";
    const tiles = remarkTiles({ sticky, evidence: [wide("a.jpg")] }, W, H);
    expect(tiles[0].x).toBeGreaterThan(W);
    expect(tiles[0].y - TILE_LABEL).toBeGreaterThanOrEqual(STICKY_TOP + stickyHeight(sticky));
  });

  it("never hangs a screenshot below the frame, starting a new column instead", () => {
    const tiles = remarkTiles({ sticky: "A note", evidence: [wide("a.jpg"), wide("b.jpg"), phone("c.jpg")] }, W, H);
    for (const tile of tiles) expect(tile.y + tile.h).toBeLessThanOrEqual(H);
    expect(new Set(tiles.map((tile) => tile.x)).size).toBeGreaterThan(1);
  });

  it("reserves room for every column it draws, so the next frame never covers one", () => {
    const one = { sticky: "A note", evidence: [wide("a.jpg"), wide("b.jpg"), wide("c.jpg")] };
    const right = Math.max(...remarkTiles(one, W, H).map((tile) => tile.x + tile.w));
    expect(W + remarkRoom(one, W, H)).toBeGreaterThan(right);
  });

  it("widens the column of a frame whose suggestion carries evidence", () => {
    const plain = layoutExplorations(declaration([shot("page"), { ...shot("next"), under: "page" }]));
    const proved = layoutExplorations(
      declaration([shot("page"), { ...shot("page-new"), suggests: "page", evidence: [wide("a.jpg")] }, { ...shot("next"), under: "page" }]),
    );
    const x = (layout: typeof plain, id: string) => layout.groups[0].nodes.find((node) => node.screen.id === id)!.x;
    expect(proved.problems).toEqual([]);
    expect(x(proved, "next") - x(proved, "page")).toBeGreaterThan(x(plain, "next") - x(plain, "page"));
  });
});
