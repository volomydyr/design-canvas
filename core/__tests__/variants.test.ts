import { describe, expect, it } from "vitest";

import { shotsRoute } from "../shots-route";
import type { CanvasDeclaration, CanvasScreen } from "../types";
import { CANVAS_VARIANT_PARAM, expandVariants, MAX_VARIANTS, variantNames, variantRoute } from "../variants";

/**
 * VARIANTS OF ONE COMPONENT ARE DECLARED ONCE AND EXPAND INTO ONE REAL SCREEN EACH.
 *
 * An agent comparing variants of one component hand-built the `?variant=` URL switch and every frame of it three times in a
 * single session (4, 5 and 6 variants). These hold the expansion's promises: the frames are ordinary screens (id, route, label,
 * claims), they sit where the declaration sat, everything else is inherited, and what cannot expand says so in one sentence.
 * The route test holds the other half: the capture and the oracle read the SERVED screens, so the served list is the expanded
 * one, with each frame's parent and name served too (the projection trap this route's own comments count).
 */

const screen = (extra: Partial<CanvasScreen> = {}): CanvasScreen => ({
  id: "filter",
  label: "Filter Bar",
  note: "One shape of the filter bar",
  route: "/lab/filter",
  kind: "Filters",
  source: ["app/lab/filter/page.tsx"],
  ...extra,
});

const declared = (screens: CanvasScreen[], where: "flow" | "exploration" = "flow"): CanvasDeclaration => ({
  title: "Demo Canvas",
  note: "Variants.",
  viewport: { w: 1440, h: 900 },
  frameScale: 0.8,
  flows: [
    {
      id: "tour",
      title: "Tour",
      note: "A tour.",
      screens: where === "flow" ? screens : [{ id: "today", label: "Today", note: "Today", route: "/lab/today", kind: "Filters" }],
      edges: [],
    },
  ],
  ...(where === "exploration"
    ? { explorations: [{ id: "round", surface: "Filter", title: "Which Shape", note: "Shapes.", original: "today", screens }] }
    : {}),
});

describe("variantNames", () => {
  it("takes a list as written, and a count as 1 to N", () => {
    expect(variantNames(["chips", "tabs", "two-row"], "filter")).toEqual(["chips", "tabs", "two-row"]);
    expect(variantNames(4, "filter")).toEqual(["1", "2", "3", "4"]);
  });

  it("refuses what cannot be a frame, in one sentence that names the screen", () => {
    expect(() => variantNames(1, "filter")).toThrow(/screen "filter".*from 2 to 12/);
    expect(() => variantNames(MAX_VARIANTS + 1, "filter")).toThrow(/from 2 to 12/);
    expect(() => variantNames(2.5, "filter")).toThrow(/whole number/);
    expect(() => variantNames(["only"], "filter")).toThrow(/from 2 to 12 names/);
    expect(() => variantNames(["a", "a"], "filter")).toThrow(/"a" is listed twice/);
    expect(() => variantNames(["a", "B c"], "filter")).toThrow(/lowercase word/);
    expect(() => variantNames(["a", "b/c"], "filter")).toThrow(/lowercase word/);
    expect(() => variantNames("a,b", "filter")).toThrow(/list of names or a count/);
  });
});

describe("variantRoute", () => {
  it("adds the parameter after whatever query the route has", () => {
    expect(variantRoute("/lab/filter", "chips")).toBe(`/lab/filter?${CANVAS_VARIANT_PARAM}=chips`);
    expect(variantRoute("/lab/filter?theme=dark", "chips")).toBe("/lab/filter?theme=dark&variant=chips");
  });
});

describe("expandVariants", () => {
  it("returns the very same declaration when nothing declares variants", () => {
    const plain = declared([screen()]);
    expect(expandVariants(plain)).toBe(plain);
  });

  it("turns one declaration into one ordinary screen per variant, in place and in order", () => {
    const out = expandVariants(
      declared([
        screen({ id: "before", label: "Before", route: "/lab/before" }),
        screen({ variants: ["chips", "tabs", "menu"], state: "open", steps: [{ click: "Filters" }] }),
        screen({ id: "after", label: "After", route: "/lab/after" }),
      ]),
    );
    expect(out.flows[0].screens.map((one) => one.id)).toEqual(["before", "filter-chips", "filter-tabs", "filter-menu", "after"]);
    const tabs = out.flows[0].screens[2];
    expect(tabs).toMatchObject({
      id: "filter-tabs",
      label: "Filter Bar Tabs",
      route: "/lab/filter?variant=tabs",
      note: "One shape of the filter bar",
      kind: "Filters",
      state: "open",
      source: ["app/lab/filter/page.tsx"],
      steps: [{ click: "Filters" }],
      variantOf: "filter",
      variant: "tabs",
    });
    expect("variants" in tabs).toBe(false);
  });

  it("names a count's frames 1 to N, and Title Cases a hyphenated name in the label", () => {
    const out = expandVariants(declared([screen({ variants: 3 }), screen({ id: "row", label: "Row", route: "/lab/row", variants: ["two-row", "one-row"] })]));
    expect(out.flows[0].screens.map((one) => `${one.id} | ${one.label}`)).toEqual([
      "filter-1 | Filter Bar 1",
      "filter-2 | Filter Bar 2",
      "filter-3 | Filter Bar 3",
      "row-two-row | Row Two Row",
      "row-one-row | Row One Row",
    ]);
  });

  it("expands inside an exploration's panel, where the variants are the options", () => {
    const out = expandVariants(declared([screen({ variants: ["a", "b"], redesigns: "today" })], "exploration"));
    expect(out.explorations?.[0].screens.map((one) => one.id)).toEqual(["filter-a", "filter-b"]);
    expect(out.explorations?.[0].screens.every((one) => one.redesigns === "today")).toBe(true);
  });

  it("gives every frame its own variant in a claim that says {variant}", () => {
    const out = expandVariants(
      declared([screen({ variants: ["chips", "tabs"], expect: ["Filter bar", "Shape {variant}"], expectMissing: "Not {variant}", expectSelector: '[data-variant="{variant}"]' })]),
    );
    expect(out.flows[0].screens.map((one) => one.expect)).toEqual([
      ["Filter bar", "Shape chips"],
      ["Filter bar", "Shape tabs"],
    ]);
    expect(out.flows[0].screens[1].expectMissing).toBe("Not tabs");
    expect(out.flows[0].screens[1].expectSelector).toBe('[data-variant="tabs"]');
  });

  it("names every screen it cannot expand, in one sentence", () => {
    expect(() =>
      expandVariants(
        declared([
          screen({ id: "one", variants: ["solo"] }),
          screen({ id: "wire", route: undefined, wireframe: "/w.html", variants: 2 }),
          screen({ id: "busy", route: "/lab/filter?variant=x", variants: 2 }),
          screen({ id: "paired", twin: "phone-filter", variants: 2 }),
        ]),
      ),
    ).toThrow(/4 screen\(s\) declare variants that cannot expand: .*"one".*"wire".*"busy".*"paired"/);
  });
});

describe("the served declaration", () => {
  const serve = async (declaration: CanvasDeclaration) => {
    const response = await shotsRoute(declaration).GET(new Request("http://localhost/api/design-canvas/shots?screens=1"));
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };

  it("serves the expanded frames, their addresses, and which variants screen each came from", async () => {
    const { body } = await serve(declared([screen({ variants: ["chips", "tabs"], expect: "Shape {variant}" })], "exploration"));
    const screens = body.screens as Array<{ id: string; url: string; view: string; variantOf: string | null; variant: string | null; expect: string[] }>;
    expect(screens.map((one) => [one.id, one.view, one.url, one.variantOf, one.variant])).toEqual([
      ["today", "flow", "/lab/today", null, null],
      ["filter-chips", "exploration", "/lab/filter?variant=chips", "filter", "chips"],
      ["filter-tabs", "exploration", "/lab/filter?variant=tabs", "filter", "tabs"],
    ]);
    expect(screens[2].expect).toEqual(["Shape tabs"]);
    const explorations = body.explorations as Array<{ directions: number }>;
    expect(explorations[0].directions).toBe(2);
  });

  it("answers a declaration whose variants cannot expand with the reason, and not with a crash", async () => {
    const { status, body } = await serve(declared([screen({ variants: ["only"] })]));
    expect(status).toBe(400);
    expect(String(body.error)).toMatch(/cannot expand/);
  });
});
