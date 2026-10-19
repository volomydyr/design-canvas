import { describe, expect, it } from "vitest";

import { matchQuality, scoreEntry, searchEntries, searchScreens } from "../search";
import type { CanvasDeclaration, CanvasRegistry, CanvasScreen } from "../types";

/**
 * ONE SEARCH OVER EVERY CANVAS. These hold what a reviewer relies on: every tab and every device is searched, the
 * match ignores case and accents, a frame named by the query comes before one that only mentions it, one frame is one
 * result, and a tie keeps the reviewer where they are.
 */

const screen = (id: string, label: string, extra: Partial<CanvasScreen> = {}): CanvasScreen => ({
  id,
  label,
  note: `${label} screen`,
  route: `/${id}`,
  ...extra,
});

const canvas = (title: string, extra: Partial<CanvasDeclaration>): CanvasDeclaration => ({
  title,
  note: "",
  viewport: { w: 1440, h: 900 },
  frameScale: 0.8,
  flows: [],
  ...extra,
});

const registry: CanvasRegistry = {
  planner: canvas("Planner", {
    flows: [
      {
        id: "packing",
        title: "Packing",
        note: "",
        edges: [],
        screens: [
          screen("draft", "Draft", { kind: "Lists", state: "draft-full" }),
          screen("draft-empty", "Empty Draft", { kind: "Empty states", state: "draft-empty" }),
          screen("share", "Sharing", { kind: "Forms", note: "Where the link is copied" }),
          screen("share-why", "Why share", { explain: "A panel of text" }),
          screen("summary-phone", "Summary", { kind: "Lists", device: "phone" }),
        ],
      },
      {
        id: "edge",
        title: "Edge cases",
        note: "",
        edges: [],
        groupedOnly: true,
        screens: [screen("cafe", "Café Menu", { kind: "Lists" })],
      },
    ],
    explorations: [
      {
        id: "header",
        surface: "Trip header",
        title: "Where does search live?",
        note: "",
        screens: [screen("header-a", "Search in the bar"), screen("header-b", "Search as a page")],
      },
    ],
  }),
  admin: canvas("Admin", {
    flows: [
      {
        id: "tasks",
        title: "Tasks",
        note: "",
        edges: [],
        screens: [
          screen("tasks-list", "Tasks", { kind: "Lists" }),
          screen("tasks-empty", "No tasks", { kind: "Empty states", flowOnly: true }),
          screen("draft-admin", "Abandoned drafts", { kind: "Lists" }),
        ],
      },
    ],
  }),
};

const entries = searchEntries(registry);
const ids = (query: string, here = {}) => searchScreens(entries, query, here).map((one) => `${one.canvas}/${one.screenId}`);

describe("searchEntries", () => {
  it("lists every drawing of every frame on every canvas, tab and device, and no explanation panel", () => {
    const where = entries.map((one) => `${one.canvas}/${one.screenId}@${one.view}`);
    expect(where).toContain("planner/draft@kinds");
    expect(where).toContain("planner/draft@flows");
    expect(where).toContain("planner/summary-phone@flows");
    expect(where).toContain("planner/header-a@explore");
    expect(where).toContain("admin/tasks-list@kinds");
    expect(where.some((one) => one.includes("share-why"))).toBe(false);
  });

  it("files each drawing under the heading its tab draws", () => {
    const of = (id: string, view: string) => entries.find((one) => one.screenId === id && one.view === view);
    expect(of("draft", "kinds")?.section).toBe("Lists");
    expect(of("draft", "flows")?.section).toBe("Packing");
    expect(of("header-a", "explore")?.section).toBe("Trip header");
    expect(of("summary-phone", "kinds")?.device).toBe("phone");
    expect(of("draft", "kinds")?.device).toBe("desktop");
  });

  it("respects groupedOnly and flowOnly", () => {
    expect(entries.filter((one) => one.screenId === "cafe").map((one) => one.view)).toEqual(["kinds"]);
    expect(entries.filter((one) => one.screenId === "tasks-empty").map((one) => one.view)).toEqual(["flows"]);
  });

  it("expands variants into one entry per frame", () => {
    const withVariants = searchEntries({
      one: canvas("One", {
        flows: [
          {
            id: "f",
            title: "Filters",
            note: "",
            edges: [],
            groupedOnly: true,
            screens: [screen("bar", "Filter Bar", { kind: "Bars", variants: ["chips", "two-row"] })],
          },
        ],
      }),
    });
    expect(withVariants.map((one) => one.screenId)).toEqual(["bar-chips", "bar-two-row"]);
  });
});

describe("matching", () => {
  it("ignores case and accents", () => {
    expect(ids("CAFE")).toEqual(["planner/cafe"]);
    expect(ids("café")).toEqual(["planner/cafe"]);
  });

  it("grades a word: whole field, start, start of a word, anywhere", () => {
    expect(matchQuality("Draft", "draft")).toBe(4);
    expect(matchQuality("Draft items", "draft")).toBe(3);
    expect(matchQuality("Empty draft", "draft")).toBe(2);
    expect(matchQuality("draft-empty", "empty")).toBe(2);
    expect(matchQuality("Abandoned drafts", "ndon")).toBe(1);
    expect(matchQuality("Tasks", "draft")).toBe(0);
  });

  it("matches labels, state names, section titles and captions", () => {
    expect(ids("draft-full")).toEqual(["planner/draft"]);
    expect(ids("trip header")).toEqual(["planner/header-a", "planner/header-b"]);
    expect(ids("link is copied")).toEqual(["planner/share"]);
  });

  it("needs every word of the query, in any field", () => {
    expect(ids("empty draft")).toEqual(["planner/draft-empty"]);
    expect(ids("lists phone")).toEqual([]);
  });

  it("finds nothing for an empty query", () => {
    expect(searchScreens(entries, "   ")).toEqual([]);
    expect(scoreEntry(entries[0], "")).toBe(0);
  });
});

describe("ranking", () => {
  it("puts a frame named by the query before one whose section or caption mentions it", () => {
    const found = ids("tasks");
    expect(found[0]).toBe("admin/tasks-list");
    expect(found).toContain("admin/tasks-empty");
    expect(found).toContain("admin/draft-admin");
  });

  it("ranks a name match by quality: exact, start, word start, anywhere", () => {
    expect(ids("draft").slice(0, 3)).toEqual(["planner/draft", "planner/draft-empty", "admin/draft-admin"]);
  });

  it("returns one result per frame, keeping the drawing whose heading matched", () => {
    const hits = searchScreens(entries, "packing");
    expect(new Set(hits.map((one) => one.screenId)).size).toBe(hits.length);
    expect(hits.every((one) => one.view === "flows")).toBe(true);
  });

  it("on a tie keeps the tab the reviewer is on, and otherwise the grouped one", () => {
    expect(searchScreens(entries, "sharing")[0].view).toBe("kinds");
    expect(searchScreens(entries, "sharing", { canvas: "planner", view: "flows" })[0].view).toBe("flows");
  });

  it("puts the open canvas first among equals", () => {
    expect(ids("lists", { canvas: "admin" })[0]).toBe("admin/tasks-list");
    expect(ids("lists", { canvas: "planner" })[0]).toBe("planner/draft");
  });

  it("caps the list", () => {
    expect(searchScreens(entries, "e", {}, 3)).toHaveLength(3);
  });
});
