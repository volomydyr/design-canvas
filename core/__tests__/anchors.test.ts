import { describe, expect, it } from "vitest";

import { anchorFromHash, anchorOf, canvasSectionAnchors, sectionAnchors } from "../anchors";
import type { CanvasDeclaration } from "../types";

/**
 * A SECTION LINK ENDS IN AN ANCHOR MADE FROM THE SECTION'S ID. These hold its promises: only lowercase ASCII letters,
 * digits and single dashes, so the link survives a sandboxed frame; unique within one canvas; and stable, so a link
 * copied today still opens the same section after another section is added.
 */

describe("anchorOf", () => {
  it("turns spaces and capitals into a lowercase dashed anchor", () => {
    expect(anchorOf("kind-Empty state")).toBe("kind-empty-state");
    expect(anchorOf("  Search   results  ")).toBe("search-results");
  });

  it("keeps an id that is already clean exactly as it is", () => {
    expect(anchorOf("signup-flow")).toBe("signup-flow");
    expect(anchorOf("explore-step-2")).toBe("explore-step-2");
  });

  it("drops odd characters and folds accents to their base letter", () => {
    expect(anchorOf("Café / 50% off!")).toBe("cafe-50-off");
    expect(anchorOf("a_b.c~d")).toBe("a-b-c-d");
    expect(anchorOf("--Lead & trail--")).toBe("lead-trail");
  });

  it("gives an id with nothing usable left a plain fallback", () => {
    expect(anchorOf("Αναζήτηση")).toBe("section");
    expect(anchorOf("")).toBe("section");
    expect(anchorOf("!!!")).toBe("section");
  });
});

describe("sectionAnchors", () => {
  it("gives every id its own anchor, in the same order", () => {
    expect(sectionAnchors(["intro", "kind-Empty state", "explore-header"])).toEqual([
      "intro",
      "kind-empty-state",
      "explore-header",
    ]);
  });

  it("numbers ids that clean up to the same anchor", () => {
    expect(sectionAnchors(["kind-Empty State", "kind-empty  state", "kind-EMPTY-state"])).toEqual([
      "kind-empty-state",
      "kind-empty-state-2",
      "kind-empty-state-3",
    ]);
  });

  it("lets an id that is already clean keep its anchor even when a messier one comes first", () => {
    expect(sectionAnchors(["kind-Empty state", "kind-empty-state"])).toEqual(["kind-empty-state-2", "kind-empty-state"]);
  });

  it("never hands out a numbered anchor that a real id already holds", () => {
    const anchors = sectionAnchors(["a b", "A B", "a-b-2"]);
    expect(anchors).toEqual(["a-b", "a-b-3", "a-b-2"]);
    expect(new Set(anchors).size).toBe(anchors.length);
  });

  it("treats a repeated id as two sections", () => {
    expect(sectionAnchors(["home", "home"])).toEqual(["home", "home-2"]);
  });

  it("numbers the fallback too", () => {
    expect(sectionAnchors(["Αναζήτηση", "Καλάθι"])).toEqual(["section", "section-2"]);
  });

  it("keeps earlier anchors when a section is added at the end", () => {
    const before = sectionAnchors(["intro", "kind-Empty state", "kind-empty state"]);
    const after = sectionAnchors(["intro", "kind-Empty state", "kind-empty state", "kind-Empty  state"]);
    expect(after.slice(0, before.length)).toEqual(before);
  });
});

describe("anchorFromHash", () => {
  it("reads a hash as the anchor it names", () => {
    expect(anchorFromHash("#kind-empty-state")).toBe("kind-empty-state");
    expect(anchorFromHash("#kind-Empty%20state")).toBe("kind-empty-state");
    expect(anchorFromHash("kind-empty-state-2")).toBe("kind-empty-state-2");
  });

  it("reads an empty or malformed hash safely", () => {
    expect(anchorFromHash("")).toBeNull();
    expect(anchorFromHash("#")).toBeNull();
    expect(anchorFromHash("#bad%E0%A4%A")).toBe("bad-e0-a4-a");
  });
});

describe("canvasSectionAnchors", () => {
  const declaration = {
    title: "Test",
    note: "Test",
    viewport: { w: 1440, h: 900 },
    frameScale: 1,
    flows: [
      {
        id: "Sign up",
        title: "Sign up",
        note: "",
        edges: [],
        screens: [{ id: "home", label: "Home", note: "", route: "/", kind: "Start Pages" }],
      },
    ],
    explorations: [
      {
        id: "Header Layout",
        surface: "Header",
        title: "Q",
        note: "",
        original: "home",
        screens: [{ id: "header-a", label: "A", note: "", wireframe: "a.html", redesigns: "home" }],
      },
    ],
  } as unknown as CanvasDeclaration;

  it("gives every view's sections one anchor each, explorations last", () => {
    expect(canvasSectionAnchors(declaration)).toEqual([
      { view: "flows", group: "Sign up", anchor: "sign-up" },
      { view: "kinds", group: "kind-Start Pages", anchor: "kind-start-pages" },
      { view: "explore", group: "explore-Header Layout", anchor: "explore-header-layout" },
    ]);
  });
});
