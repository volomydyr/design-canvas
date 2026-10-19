import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { highestIdIn, nextCommentId } from "../comment-file.mjs";

/**
 * A COMMENT ID NAMES ONE COMMENT FOR EVER: the floor is `maxId` in the file, so approving the newest comment never hands its
 * number to the next one. The route is tested against a throwaway working directory, never the repository's own.
 */

describe("the id helpers", () => {
  it("takes the highest number in a list and ignores anything that is not an id the route issued", () => {
    expect(highestIdIn([{ id: "c3" }, { id: "c12" }, { id: "c7" }])).toBe(12);
    expect(highestIdIn([{ id: "x9" }, { id: "c" }, { id: "c1a" }, { id: "C4" }])).toBe(0);
    expect(highestIdIn([])).toBe(0);
  });

  it("issues the larger of the list and the floor, plus one", () => {
    expect(nextCommentId([{ id: "c1" }, { id: "c2" }])).toBe("c3");
    expect(nextCommentId([], 0)).toBe("c1");
    /* The approved comment that used to hand its number back: the list says 2, the floor remembers 9. */
    expect(nextCommentId([{ id: "c1" }, { id: "c2" }], 9)).toBe("c10");
    /* A floor that is behind the list (a hand-edited file) never lowers the number. */
    expect(nextCommentId([{ id: "c20" }], 3)).toBe("c21");
  });
});

/** One throwaway project folder per test, and the route imported fresh against it (its paths are fixed at import). */
describe("the route, against a throwaway folder", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "canvas-ids-test-"));
    vi.spyOn(process, "cwd").mockReturnValue(dir);
    vi.resetModules();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  const PNG = "data:image/png;base64,iVBORw0KGgo=";
  const post = (route: { POST: (request: Request) => Promise<Response> }, note: string) =>
    route.POST(
      new Request("http://localhost/api/design-canvas/comments?canvas=t", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          note,
          screenId: "s1",
          region: { xPct: 1, yPct: 1, wPct: 10, hPct: 10 },
          image: PNG,
        }),
      }),
    );
  const remove = (route: { DELETE: (request: Request) => Promise<Response> }, query: string) =>
    route.DELETE(new Request(`http://localhost/api/design-canvas/comments?canvas=t&${query}`, { method: "DELETE" }));
  const idsOf = async (response: Response) =>
    ((await response.json()) as { comments: Array<{ id: string }> }).comments.map((one) => one.id);

  it("never hands out an approved comment's number again", async () => {
    const route = await import("../comments-route");
    expect(await idsOf(await post(route, "one"))).toEqual(["c1"]);
    expect(await idsOf(await post(route, "two"))).toEqual(["c1", "c2"]);
    /* Approve the highest: this is the exact moment the old code forgot it had ever been issued. */
    expect(await idsOf(await remove(route, "id=c2"))).toEqual(["c1"]);
    expect(await idsOf(await post(route, "three"))).toEqual(["c1", "c3"]);
    /* Approve everything and start again: still a new number. */
    expect(await idsOf(await remove(route, "ids=c1,c3"))).toEqual([]);
    expect(await idsOf(await post(route, "four"))).toEqual(["c4"]);
  });

  it("keeps the mark through Clear All, because emptying a review is not a reason to reuse a number", async () => {
    const route = await import("../comments-route");
    await post(route, "one");
    await post(route, "two");
    await remove(route, "all=1");
    const file = JSON.parse(readFileSync(path.join(dir, "design-canvas", "comments", "t.json"), "utf8"));
    expect(file.comments).toEqual([]);
    expect(file.maxId).toBe(2);
    expect(await idsOf(await post(route, "three"))).toEqual(["c3"]);
  });

  it("numbers from the live file when it has no maxId", async () => {
    const comments = path.join(dir, "design-canvas", "comments");
    mkdirSync(comments, { recursive: true });
    writeFileSync(
      path.join(comments, "t.json"),
      JSON.stringify({ contract: "x", updatedAt: "2026-09-01T00:00:00.000Z", comments: [{ id: "c7", screenId: "s1", note: "x" }] }),
    );
    const route = await import("../comments-route");
    expect(await idsOf(await post(route, "next"))).toEqual(["c7", "c8"]);
  });
});
