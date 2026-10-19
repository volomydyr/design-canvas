import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { framesOnScreen } from "../comments-client";
import { mayStartRefresh, type ViewingFile, withViewing } from "../comments-route";

/**
 * The open-canvas reports: which canvases are open, which frames are on screen, when a report opens a canvas (the moment its
 * out-of-date frames refresh), and that a hidden tab or an old report stops counting.
 */
const T = Date.parse("2026-10-19T12:00:00Z");
const A = "aaaaaaaa-1111";
const B = "bbbbbbbb-2222";

describe("withViewing", () => {
  it("a first report opens the canvas; a second from the same or another tab does not", () => {
    const one = withViewing(null, "desktop", { viewer: A, tab: "kinds", device: "desktop", visible: ["d-home"] }, T);
    expect(one?.opened).toBe(true);
    expect(one?.file.viewers[A]).toEqual({ canvas: "desktop", tab: "kinds", device: "desktop", visible: ["d-home"], at: new Date(T).toISOString() });
    const again = withViewing(one!.file, "desktop", { viewer: A, tab: "flows", visible: [] }, T + 5000);
    expect(again?.opened).toBe(false);
    const other = withViewing(again!.file, "desktop", { viewer: B, visible: [] }, T + 6000);
    expect(other?.opened).toBe(false);
    expect(Object.keys(other!.file.viewers).sort()).toEqual([A, B]);
  });

  it("two tabs on two canvases both count, and each canvas opens once", () => {
    const one = withViewing(null, "desktop", { viewer: A, visible: [] }, T);
    const two = withViewing(one!.file, "tablet", { viewer: B, visible: [] }, T + 1000);
    expect(two?.opened).toBe(true);
    expect(Object.values(two!.file.viewers).map((one) => one.canvas).sort()).toEqual(["desktop", "tablet"]);
  });

  it("a hidden tab reports gone and stops counting; coming back opens the canvas again", () => {
    const one = withViewing(null, "desktop", { viewer: A, visible: [] }, T);
    const gone = withViewing(one!.file, "desktop", { viewer: A, gone: true }, T + 1000);
    expect(gone?.file.viewers).toEqual({});
    expect(withViewing(gone!.file, "desktop", { viewer: A, visible: [] }, T + 2000)?.opened).toBe(true);
  });

  it("a late gone for the canvas just left never removes the one just opened", () => {
    const one = withViewing(null, "tablet", { viewer: A, visible: [] }, T);
    const late = withViewing(one!.file, "desktop", { viewer: A, gone: true }, T + 1000);
    expect(late?.file.viewers[A]?.canvas).toBe("tablet");
  });

  it("a report older than two minutes is dropped, so the canvas opens again", () => {
    const one = withViewing(null, "desktop", { viewer: A, visible: [] }, T);
    const later = withViewing(one!.file, "desktop", { viewer: B, visible: [] }, T + 2 * 60 * 1000 + 1);
    expect(later?.opened).toBe(true);
    expect(Object.keys(later!.file.viewers)).toEqual([B]);
  });

  it("refuses a report without a well-formed viewer, and keeps only frame ids of a safe shape", () => {
    expect(withViewing(null, "desktop", { visible: [] }, T)).toBeNull();
    expect(withViewing(null, "desktop", { viewer: "../x" }, T)).toBeNull();
    const file = withViewing(null, "desktop", { viewer: A, tab: "Kinds!", visible: ["d-home", "../../etc", 4 as unknown as string, "x-board-empty"] }, T)!.file as ViewingFile;
    expect(file.viewers[A].visible).toEqual(["d-home", "x-board-empty"]);
    expect(file.viewers[A].tab).toBeNull();
  });

  it("bounds what a report can store: 200 frame ids of at most 120 characters, 20 viewers, short plain names", () => {
    const many = Array.from({ length: 500 }, (_, at) => `f-${at}`);
    const one = withViewing(null, "desktop", { viewer: A, tab: "a".repeat(40), device: "desktop", visible: [...many, `x${"y".repeat(130)}`] }, T)!.file;
    expect(one.viewers[A].visible).toHaveLength(200);
    expect(one.viewers[A].tab).toBeNull();
    expect(withViewing(null, "desktop", { viewer: "a".repeat(65), visible: [] }, T)).toBeNull();
    let file: ViewingFile | null = null;
    for (let at = 0; at < 30; at += 1) file = withViewing(file, "desktop", { viewer: `viewer-${String(at).padStart(4, "0")}`, visible: [] }, T + at)!.file;
    const ids = Object.keys(file!.viewers);
    expect(ids).toHaveLength(20);
    expect(ids).toContain("viewer-0029");
    expect(ids).not.toContain("viewer-0000");
  });
});

describe("mayStartRefresh", () => {
  const alive = (pid: number) => pid === 7;
  it("starts when nothing ran, and not while a capture holds the canvas's lock", () => {
    expect(mayStartRefresh({ last: null, captureHolder: null, now: T, alive })).toBe(true);
    expect(mayStartRefresh({ last: null, captureHolder: 7, now: T, alive })).toBe(false);
    expect(mayStartRefresh({ last: null, captureHolder: 8, now: T, alive }), "a lock its process left behind").toBe(true);
  });
  it("one at a time, and at most one start per 30 seconds", () => {
    expect(mayStartRefresh({ last: { pid: 7, at: new Date(T - 60_000).toISOString() }, captureHolder: null, now: T, alive })).toBe(false);
    expect(mayStartRefresh({ last: { pid: 8, at: new Date(T - 10_000).toISOString() }, captureHolder: null, now: T, alive })).toBe(false);
    expect(mayStartRefresh({ last: { pid: 8, at: new Date(T - 31_000).toISOString() }, captureHolder: null, now: T, alive })).toBe(true);
  });
});

/** The route against a throwaway project folder, with a stand-in recapture that writes down each start and stays alive a moment. */
describe("viewing reports through the route", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "canvas-viewing-test-"));
    vi.spyOn(process, "cwd").mockReturnValue(dir);
    vi.resetModules();
    mkdirSync(path.join(dir, "design-canvas", "shots", "t"), { recursive: true });
    writeFileSync(path.join(dir, "design-canvas", "shots", "t", "manifest.json"), '{ "shots": [] }');
    writeFileSync(
      path.join(dir, "design-canvas", "recapture.mjs"),
      `import { appendFileSync } from "node:fs";\nappendFileSync(${JSON.stringify(path.join(dir, "starts.txt"))}, JSON.stringify(process.argv.slice(2)) + "\\n");\nsetTimeout(() => {}, 1500);\n`,
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });
  const patch = (route: { PATCH: (request: Request) => Promise<Response> }, canvas: string, viewing: object) =>
    route.PATCH(
      new Request(`http://localhost/api/design-canvas/comments?canvas=${canvas}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ viewing }),
      }),
    );
  const starts = () => (existsSync(path.join(dir, "starts.txt")) ? readFileSync(path.join(dir, "starts.txt"), "utf8").trim().split("\n") : []);

  it("a stream of openings with fresh viewer ids starts one refresh, with fixed arguments", async () => {
    const route = await import("../comments-route");
    for (let at = 0; at < 25; at += 1) {
      const viewer = `viewer-${String(at).padStart(4, "0")}`;
      expect((await patch(route, "t", { viewer, visible: [] })).status).toBe(200);
      await patch(route, "t", { viewer, gone: true });
    }
    await vi.waitFor(() => expect(starts().length).toBeGreaterThan(0), { timeout: 5000 });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(starts()).toEqual(['["--opened","t"]']);
  });

  it("refuses a canvas with no pictures on disk, and writes nothing", async () => {
    const route = await import("../comments-route");
    const response = await patch(route, "elsewhere", { viewer: A, visible: [] });
    expect(response.status).toBe(404);
    expect(existsSync(path.join(dir, "design-canvas", "rounds", "viewing.json"))).toBe(false);
  });

  it("a published view-only build refuses the report like any other write and starts nothing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_CANVAS_VIEW_ONLY", "1");
    const route = await import("../comments-route");
    expect((await patch(route, "t", { viewer: A, visible: [] })).status).toBe(405);
    expect(existsSync(path.join(dir, "design-canvas", "rounds"))).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(starts()).toEqual([]);
  });
});

describe("framesOnScreen", () => {
  const node = (id: string, x: number, y: number) => ({ screen: { id }, x, y, w: 100, h: 100 });
  const nodes = [node("below", 0, 1000), node("right", 300, 0), node("left", 0, 0), node("far", 5000, 0)];

  it("lists the frames inside the window in reading order", () => {
    expect(framesOnScreen(nodes, { x: 0, y: 0, z: 1 }, 800, 600)).toEqual(["left", "right"]);
  });

  it("follows the pan and the zoom", () => {
    expect(framesOnScreen(nodes, { x: 0, y: -950, z: 1 }, 800, 600)).toEqual(["below"]);
    expect(framesOnScreen(nodes, { x: 0, y: 0, z: 0.1 }, 800, 600)).toEqual(["left", "right", "far", "below"]);
  });

  it("a frame partly on screen counts; an empty or degenerate view lists nothing", () => {
    expect(framesOnScreen(nodes, { x: -50, y: 0, z: 1 }, 100, 100)).toEqual(["left"]);
    expect(framesOnScreen(nodes, { x: 0, y: 0, z: 0 }, 800, 600)).toEqual([]);
  });
});
