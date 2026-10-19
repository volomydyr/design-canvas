import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { reopenedAfterWork, reviewable, reviewQueueOn, waitingOn } from "../comments-client";
import type { CanvasComment } from "../types";

const base: CanvasComment = {
  id: "c1",
  flowId: "packing",
  screenId: "list",
  label: "List",
  route: "/list",
  state: null,
  region: { xPct: 10, yPct: 10, wPct: 20, hPct: 10 },
  image: "c1.png",
  note: "Tighten the spacing",
  createdAt: "2026-01-01T10:00:00.000Z",
};
const note = (over: Partial<CanvasComment>): CanvasComment => ({ ...base, ...over });

describe("reopenedAfterWork", () => {
  it("is false for a note nobody has worked yet", () => {
    expect(reopenedAfterWork(note({}))).toBe(false);
  });
  it("is false for a worked note waiting for review", () => {
    expect(reopenedAfterWork(note({ consumedAt: "2026-01-02T10:00:00.000Z", stale: true }))).toBe(false);
  });
  it("is false for a note edited before any agent worked it", () => {
    expect(reopenedAfterWork(note({ editedAt: "2026-01-01T11:00:00.000Z" }))).toBe(false);
    expect(
      reopenedAfterWork(note({ editedAt: "2026-01-01T11:00:00.000Z", consumedAt: "2026-01-02T10:00:00.000Z" })),
    ).toBe(false);
  });
  it("is true for a worked note dismissed with new feedback", () => {
    const reopened = note({
      consumedAt: null,
      history: [{ note: "Tighten the spacing", at: "2026-01-03T10:00:00.000Z" }],
      note: "Still too loose",
    });
    expect(reopenedAfterWork(reopened)).toBe(true);
  });
  it("is false for a worked note whose words were only edited after the work", () => {
    expect(
      reopenedAfterWork(note({ consumedAt: "2026-01-02T10:00:00.000Z", editedAt: "2026-01-03T10:00:00.000Z" })),
    ).toBe(false);
  });
  it("stays true when a reopened note is also edited before any agent works it", () => {
    const reopened = note({
      consumedAt: null,
      editedAt: "2026-01-03T11:00:00.000Z",
      history: [{ note: "Tighten the spacing", at: "2026-01-03T10:00:00.000Z" }],
    });
    expect(reopenedAfterWork(reopened)).toBe(true);
  });
  it("is false again once an agent works the reopened note", () => {
    const reworked = note({
      consumedAt: "2026-01-04T10:00:00.000Z",
      history: [{ note: "Tighten the spacing", at: "2026-01-03T10:00:00.000Z" }],
    });
    expect(reopenedAfterWork(reworked)).toBe(false);
  });
  it("reads the latest round of a long thread", () => {
    const second = note({
      consumedAt: null,
      history: [
        { note: "one", at: "2026-01-03T10:00:00.000Z" },
        { note: "two", at: "2026-01-05T10:00:00.000Z" },
      ],
    });
    expect(reopenedAfterWork(second)).toBe(true);
  });
});

describe("reviewQueueOn", () => {
  const kinds = [
    { screenId: "list", groupId: "Packing" },
    { screenId: "share", groupId: "Packing" },
  ];
  const flows = [{ screenId: "home", groupId: "browse" }];
  const comments = [
    note({ id: "c1", screenId: "list", consumedAt: "2026-01-02T10:00:00.000Z" }),
    note({ id: "c2", screenId: "share", consumedAt: null }),
    note({ id: "c3", screenId: "home", flowId: "browse", consumedAt: "2026-01-02T10:00:00.000Z" }),
    note({ id: "c4", screenId: "list", kind: "like", consumedAt: "2026-01-02T10:00:00.000Z" }),
  ];

  it("counts only worked notes drawn on the tab in view", () => {
    expect(reviewQueueOn(comments, kinds).map((one) => one.id)).toEqual(["c1"]);
    expect(reviewQueueOn(comments, flows).map((one) => one.id)).toEqual(["c3"]);
  });
  it("is empty on a tab that draws no frames, such as the design system", () => {
    expect(reviewQueueOn(comments, [])).toEqual([]);
  });
  it("is empty on a tab whose frames carry no worked notes", () => {
    expect(reviewQueueOn(comments, [{ screenId: "settings", groupId: "Account" }])).toEqual([]);
  });
  it("keeps the order of the comment list", () => {
    const more = [...comments, note({ id: "c5", screenId: "share", consumedAt: "2026-01-02T11:00:00.000Z" })];
    expect(reviewQueueOn(more, kinds).map((one) => one.id)).toEqual(["c1", "c5"]);
  });
});

/** The state is derived from what the route writes, so it is checked against the real write path too. */
describe("reopenedAfterWork, on records the route wrote", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "canvas-review-test-"));
    vi.spyOn(process, "cwd").mockReturnValue(dir);
    vi.resetModules();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  const URL = "http://localhost/api/design-canvas/comments?canvas=t";
  const PNG = "data:image/png;base64,iVBORw0KGgo=";
  const call = async (handler: (request: Request) => Promise<Response>, method: string, body: unknown) => {
    const response = await handler(
      new Request(URL, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    );
    expect(response.status).toBe(200);
    return ((await response.json()) as { comments: CanvasComment[] }).comments[0];
  };
  const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

  it("follows a note through work, dismissal, rework and an edit", async () => {
    const route = await import("../comments-route");
    const made = await call(route.POST, "POST", {
      note: "one",
      screenId: "s1",
      region: { xPct: 1, yPct: 1, wPct: 10, hPct: 10 },
      image: PNG,
    });
    expect(reopenedAfterWork(made)).toBe(false);
    await tick();
    const worked = await call(route.PATCH, "PATCH", { id: made.id, consumed: true });
    expect(reopenedAfterWork(worked)).toBe(false);
    await tick();
    const dismissed = await call(route.PATCH, "PATCH", { id: made.id, note: "still wrong", image: PNG, reopen: true });
    expect(reopenedAfterWork(dismissed)).toBe(true);
    await tick();
    const reworked = await call(route.PATCH, "PATCH", { id: made.id, consumed: true });
    expect(reopenedAfterWork(reworked)).toBe(false);
    await tick();
    const rewritten = await call(route.PATCH, "PATCH", { id: made.id, note: "still wrong, and the color too" });
    expect(reopenedAfterWork(rewritten)).toBe(false);
  });

  it("records the hash of the shot a note was reopened on, so a later capture compares against that picture", async () => {
    const route = await import("../comments-route");
    const made = await call(route.POST, "POST", {
      note: "one",
      screenId: "s1",
      region: { xPct: 1, yPct: 1, wPct: 10, hPct: 10 },
      image: PNG,
      shotHash: "first",
    });
    expect(made.shotHash).toBe("first");
    await call(route.PATCH, "PATCH", { id: made.id, consumed: true });
    const dismissed = await call(route.PATCH, "PATCH", { id: made.id, note: "still wrong", image: PNG, shotHash: "reworked", reopen: true });
    expect(dismissed.shotHash).toBe("reworked");
    expect(dismissed.stale).toBe(false);
    const edited = await call(route.PATCH, "PATCH", { id: made.id, note: "still wrong, and the color", shotHash: "ignored" });
    expect(edited.shotHash).toBe("reworked");
  });

  it("carries the waiting screens through comment writes, and approving a frame takes it out", async () => {
    const { writeFileSync, mkdirSync } = await import("node:fs");
    mkdirSync(path.join(dir, "design-canvas", "comments"), { recursive: true });
    writeFileSync(
      path.join(dir, "design-canvas", "comments", "t.json"),
      JSON.stringify({ comments: [], waiting: { s1: "new", s2: "changed", s3: "changed" } }),
    );
    const route = await import("../comments-route");
    await call(route.POST, "POST", { note: "one", screenId: "s1", region: { xPct: 1, yPct: 1, wPct: 10, hPct: 10 }, image: PNG });
    const read = async () =>
      ((await (await route.GET(new Request(URL))).json()) as { waiting?: Record<string, string> }).waiting;
    expect(await read()).toEqual({ s1: "new", s2: "changed", s3: "changed" });
    const response = await route.PATCH(
      new Request(URL, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ reviewed: ["s1", "s2"] }) }),
    );
    expect(response.status).toBe(200);
    expect(await read()).toEqual({ s3: "changed" });
  });
});

describe("waitingOn, the counts one canvas shows in the switcher", () => {
  const frames = [
    { screenId: "a", groupId: "g" },
    { screenId: "b", groupId: "g" },
    { screenId: "c", groupId: "g" },
    { screenId: "d", groupId: "g" },
    { screenId: "a", groupId: "flow" },
  ];
  const shots = { a: {}, b: {}, c: {} };
  const comments = [
    note({ id: "c1", screenId: "a", flowId: "g", consumedAt: "2026-01-02T10:00:00.000Z" }),
    note({ id: "c2", screenId: "b", flowId: "g", consumedAt: null }),
    note({ id: "c3", screenId: "gone", consumedAt: "2026-01-02T10:00:00.000Z" }),
  ];

  it("splits what waits into new, changed and comments", () => {
    const counts = waitingOn({ frames, shots, waiting: { c: "new", b: "changed" }, comments });
    expect(counts).toEqual({ fresh: ["c"], changed: ["b"], comments: 1 });
  });
  it("needs a picture: a declared frame never captured is neither new nor changed", () => {
    const counts = waitingOn({ frames, shots, waiting: { d: "new", e: "changed" }, comments: [] });
    expect(counts.fresh).toEqual([]);
    expect(counts.changed).toEqual([]);
  });
  it("ignores a waiting frame the canvas no longer declares", () => {
    expect(waitingOn({ frames, shots: { ...shots, gone: {} }, waiting: { gone: "new" }, comments: [] }).fresh).toEqual([]);
  });
  it("counts each frame once although it is drawn in two groups, in the declaration's order", () => {
    expect(waitingOn({ frames, shots, waiting: { c: "new", a: "new", b: "new" }, comments: [] }).fresh).toEqual(["a", "b", "c"]);
  });
});

describe("reviewable", () => {
  it("the comments queue holds exactly the notes whose pin offers Approve: a worked note, recaptured or not, answered or not", () => {
    const frames = [{ screenId: "home", groupId: "Main" }];
    const at = "2026-01-02T10:00:00.000Z";
    const base = { flowId: "Main", screenId: "home", label: "home", route: "/", state: null, region: { xPct: 0, yPct: 0, wPct: 1, hPct: 1 }, image: "x.png", note: "n", createdAt: at };
    const comments = [
      { ...base, id: "c1", consumedAt: at, stale: true },
      { ...base, id: "c2", consumedAt: at, stale: false },
      { ...base, id: "c3", consumedAt: at, answer: { text: "yes", at } },
      { ...base, id: "c4", consumedAt: null },
      { ...base, id: "c5", consumedAt: at, kind: "like" as const },
    ];
    expect(reviewQueueOn(comments, frames).map((one) => one.id)).toEqual(comments.filter(reviewable).map((one) => one.id));
    expect(comments.filter(reviewable).map((one) => one.id)).toEqual(["c1", "c2", "c3"]);
  });
});
