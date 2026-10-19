import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadComments, markViewed } from "../comments-client";
import { firstVisit } from "../comments-route";
import type { CanvasCommentFile } from "../types";

/**
 * THE REVIEWER'S FIRST VISIT records `viewedAt` and empties the waiting queue in one write, once. The capture queues nothing
 * before it (tool/tests/new-frames.test.mjs), so the marks a canvas collects while it is built never reach the reviewer.
 */
describe("firstVisit", () => {
  const file: CanvasCommentFile = { contract: "", updatedAt: "t", comments: [], waiting: { a: "new", b: "changed" } };

  it("records the visit and empties the queue", () => {
    expect(firstVisit(file, "2026-02-01T00:00:00.000Z")).toEqual({ ...file, viewedAt: "2026-02-01T00:00:00.000Z", waiting: {} });
  });

  it("is null once a visit is recorded, so a later visit changes nothing", () => {
    expect(firstVisit({ ...file, viewedAt: "2026-01-01T00:00:00.000Z" }, "2026-02-01T00:00:00.000Z")).toBeNull();
  });
});

describe("the comments route's first-visit write", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "canvas-first-visit-"));
    vi.spyOn(process, "cwd").mockReturnValue(dir);
    vi.resetModules();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  const review = (slug: string) => path.join(dir, "design-canvas", "comments", `${slug}.json`);
  const seed = (slug: string, body: unknown) => {
    mkdirSync(path.dirname(review(slug)), { recursive: true });
    writeFileSync(review(slug), JSON.stringify(body));
  };
  const visit = async (slug: string) => {
    const route = await import("../comments-route");
    const response = await route.PATCH(
      new Request(`http://localhost/api/design-canvas/comments?canvas=${slug}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ viewed: true }),
      }),
    );
    expect(response.status).toBe(200);
    return (await response.json()) as CanvasCommentFile;
  };
  const onDisk = (slug: string) => JSON.parse(readFileSync(review(slug), "utf8")) as CanvasCommentFile;

  it("sets viewedAt once and clears the queue, keeping the comments", async () => {
    seed("t", { comments: [{ id: "c1", screenId: "a", note: "x" }], waiting: { a: "new", b: "changed" } });
    const answered = await visit("t");
    expect(answered.waiting).toBeUndefined();
    expect(answered.viewedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    const first = onDisk("t");
    expect(first.viewedAt).toBe(answered.viewedAt);
    expect(first.waiting).toBeUndefined();
    expect(first.comments.map((one) => one.id)).toEqual(["c1"]);

    const again = await visit("t");
    expect(again.viewedAt).toBe(first.viewedAt);
    expect(readFileSync(review("t"), "utf8")).toBe(`${JSON.stringify(first, null, 2)}\n`);
  });

  it("keeps viewedAt through every later write, so the visit is never recorded twice", async () => {
    seed("t", { comments: [] });
    const { viewedAt } = await visit("t");
    const route = await import("../comments-route");
    await route.PATCH(
      new Request("http://localhost/api/design-canvas/comments?canvas=t", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reviewed: ["a"] }),
      }),
    );
    expect(onDisk("t").viewedAt).toBe(viewedAt);
  });

  it("on the oracle's probe key writes only the probe's file, never the reviewer's", async () => {
    seed("t", { comments: [], waiting: { a: "new" } });
    seed("oracle-probe-t", { comments: [] });
    const before = readFileSync(review("t"), "utf8");
    await visit("oracle-probe-t");
    expect(onDisk("oracle-probe-t").viewedAt).toBeTruthy();
    expect(readFileSync(review("t"), "utf8")).toBe(before);
    expect(onDisk("t").viewedAt).toBeUndefined();
  });

  it("creates the review file for a canvas opened before anything wrote one", async () => {
    await visit("fresh");
    expect(existsSync(review("fresh"))).toBe(true);
    expect(onDisk("fresh").viewedAt).toBeTruthy();
  });
});

describe("the client's first-visit calls", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const answer = (status: number, body: unknown = {}) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status }));

  it("reports a canvas never visited only when the file was read", async () => {
    vi.stubGlobal("fetch", answer(200, { comments: [] }));
    expect((await loadComments("t")).unvisited).toBe(true);
    vi.stubGlobal("fetch", answer(200, { comments: [], viewedAt: "2026-01-01T00:00:00.000Z" }));
    expect((await loadComments("t")).unvisited).toBe(false);
    vi.stubGlobal("fetch", answer(500));
    expect((await loadComments("t")).unvisited).toBe(false);
  });

  it("sends one PATCH naming the canvas, once per page load, and returns the queue the file now holds", async () => {
    const fetch = answer(200, { comments: [], viewedAt: "x" });
    vi.stubGlobal("fetch", fetch);
    expect(await markViewed("trips")).toEqual({});
    expect(await markViewed("trips")).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/design-canvas/comments?canvas=trips");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ viewed: true });
  });

  it("never counts an automated browser as the visit", async () => {
    const fetch = answer(200, { comments: [], viewedAt: "x" });
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("navigator", { webdriver: true });
    await expect(markViewed("automated")).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("fails quietly where writes are refused (a published canvas) or the request fails", async () => {
    const refused = answer(405);
    vi.stubGlobal("fetch", refused);
    await expect(markViewed("published")).resolves.toBeNull();
    expect(refused).toHaveBeenCalledTimes(1);
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
    await expect(markViewed("offline")).resolves.toBeNull();
  });
});
