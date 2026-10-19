import { describe, expect, it } from "vitest";

import { DELETE, PATCH, withVerdict } from "../comments-route";

/**
 * DELETE TAKES `?id=` INTO A FILESYSTEM PATH, so an id must match the `c<digits>` shape the route mints, or the request is
 * refused before anything is read, written or removed.
 *
 * Only the rejections are tested: each is refused before the filesystem is touched, so this file has no side effects. The
 * happy path is not exercised here, because a valid DELETE would rewrite the working tree's own review file; the route's
 * happy paths are tested against a throwaway folder in comment-ids.test.ts and review-queue.test.ts.
 */
describe("the canvas comments route's DELETE", () => {
  it.each([
    ["../../app/favicon", "climbs out of the comments folder"],
    ["..%2F..%2Fapp%2Ffavicon", "the same climb, percent-encoded"],
    [
      "....//....//app/favicon",
      "a doubled-dot climb, in case a blacklist stripped `../`",
    ],
    ["/etc/hosts", "an absolute path"],
    ["c1/../../c1", "a climb that ends on a legitimate-looking name"],
    ["c1.png", "an id carrying its own extension"],
    ["c1%00.png", "a null byte, in case the path layer truncated on it"],
    ["C1", "the right shape in the wrong case"],
    ["c", "the prefix with no number"],
    /* Percent-encoded, not a literal space: `?id=c1 ` is normalised by the URL parser before the route ever
       sees it, so the literal form arrives as a perfectly valid `c1` and would delete that comment for real.
       `%20` survives decoding and reaches the guard as the malformed id this is meant to test. */
    ["c1%20", "trailing whitespace"],
  ])("refuses %j — %s", async (id) => {
    const response = await DELETE(
      new Request(`http://localhost/api/design-canvas/comments?id=${id}`),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "malformed id" });
  });

  it("still refuses an empty id, which is the check that was already there", async () => {
    const response = await DELETE(
      new Request("http://localhost/api/design-canvas/comments?id="),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "id required" });
  });
});

/**
 * `?canvas=` names the folder a review is stored in, so it gets the same whitelist as the id: a slug is lowercase letters,
 * digits and dashes. Every case is refused before the filesystem is touched.
 */
describe("the canvas comments route's ?canvas= guard", () => {
  it.each([
    ["../../..", "a climb out of the canvas folder"],
    ["..%2F..%2Fetc", "the same climb, percent-encoded"],
    ["/etc", "an absolute path"],
    ["trips/../settings", "a climb that lands on another canvas"],
    ["Trips", "the right shape in the wrong case"],
    ["-trips", "a leading dash, which is not a name"],
    ["trips page", "a space"],
  ])("refuses %j — %s", async (canvas) => {
    const response = await DELETE(
      new Request(
        `http://localhost/api/design-canvas/comments?canvas=${canvas}&id=c1`,
      ),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "canvas must be lowercase letters, digits and dashes",
    });
  });
});

/**
 * ONE REQUEST CARRIES A WHOLE BATCH (`?ids=`), so Approve All is one read-modify-write and cannot race itself. Checked
 * without touching the filesystem: the route accepts `?ids=` and refuses a batch that holds a bad id.
 */
describe("the canvas comments route's batch DELETE", () => {
  it("refuses a batch with no ids at all", async () => {
    const response = await DELETE(
      new Request("http://localhost/api/design-canvas/comments?canvas=main&ids="),
    );
    expect(response.status).toBe(400);
  });

  it("refuses the whole batch when one id is malformed, rather than deleting the good half", async () => {
    const response = await DELETE(
      new Request(
        "http://localhost/api/design-canvas/comments?canvas=main&ids=c1,..%2F..%2Fapp%2Ffavicon,c2",
      ),
    );
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("malformed id");
  });
});

/**
 * AN ID THE FILE DOES NOT HOLD IS A 404 NAMING IT, never a 200: a drain sent to the wrong canvas must not report success.
 * Side-effect free: the refusal is thrown inside the mutation, before the write, and this canvas has no file.
 */
describe("the canvas comments route's PATCH", () => {
  const patch = (body: unknown) =>
    PATCH(
      new Request(
        "http://localhost/api/design-canvas/comments?canvas=nosuchcanvas",
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      ),
    );

  it("refuses an id the canvas does not hold, instead of reporting success", async () => {
    const response = await patch({ id: "c9999", consumed: true });
    expect(response.status).toBe(404);
    expect((await response.json()).error).toContain("c9999");
  });

  /**
   * AN ANSWER IS ONE COMMENT'S, AND IT HAS WORDS. Both refusals happen before the file is touched: an empty
   * answer would consume a question with nothing drawn under it, and one text on several ids would pin the same
   * sentence to different questions.
   */
  it("refuses an empty answer", async () => {
    const response = await patch({ id: "c1", answer: "   " });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("answer");
  });

  it("refuses one answer on several ids", async () => {
    const response = await patch({ ids: ["c1", "c2"], answer: "the count is an aggregate" });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("one id at a time");
  });

  it("names the canvas it looked in, because the wrong slug is the likeliest cause", async () => {
    const response = await patch({ id: "c9999", consumed: true });
    expect((await response.json()).error).toContain("nosuchcanvas");
  });

  it("refuses the whole batch and names every missing id, never patching the half it found", async () => {
    const response = await patch({ ids: ["c9998", "c9999"], consumed: true });
    expect(response.status).toBe(404);
    const { error } = await response.json();
    expect(error).toContain("c9998");
    expect(error).toContain("c9999");
  });

  it("still refuses a request with no id at all, which is the check that was already there", async () => {
    const response = await patch({ consumed: true });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "id or ids required",
    });
  });
});

/**
 * A VERDICT IS A COMMENT with a `kind`, so draining and the hand-off cover it with no second list. Tested through the pure
 * `withVerdict`, so the reviewer's real file is never written.
 */
describe("applying a verdict to a comment list", () => {
  const note = {
    id: "c1",
    flowId: "run-placement",
    screenId: "run-in-card",
    label: "Inside the sync card",
    route: "/settings/integrations/calendar",
    state: "run-in-card",
    region: { xPct: 10, yPct: 20, wPct: 30, hPct: 40 },
    image: "design-canvas/comments/main/c1.png",
    note: "The step label is the faintest thing in the panel",
    createdAt: "T00:00:00.000Z",
  };
  const press = (value: "like" | "dislike" | null, id = "c2") => ({
    screenId: "run-in-card",
    value,
    id,
    flowId: "run-placement",
    label: "Inside the sync card",
    route: "/settings/integrations/calendar",
    state: "run-in-card",
    image: "design-canvas/shots/main/run-in-card.webp",
    at: "T12:00:00.000Z",
  });

  it("writes the verdict as a comment carrying the kind, the whole frame and predefined words", () => {
    const [written] = withVerdict([], press("like"));
    expect(written.kind).toBe("like");
    expect(written.region).toEqual({ xPct: 0, yPct: 0, wPct: 100, hPct: 100 });
    expect(written.note).toContain("three variations");
    /* Denormalised, so the file reads without the declaration beside it. */
    expect(written.label).toBe("Inside the sync card");
    expect(written.image).toContain("run-in-card");
  });

  it("REPLACES the screen's verdict rather than appending, so the two can never contradict", () => {
    const liked = withVerdict([], press("like"));
    const then = withVerdict(liked, press("dislike", "c3"));
    expect(then).toHaveLength(1);
    expect(then[0].kind).toBe("dislike");
    expect(then[0].note).toContain("Drop this option");
  });

  it("removes the verdict on null, which is what a second press of the same button does", () => {
    const liked = withVerdict([], press("like"));
    expect(withVerdict(liked, press(null, "c3"))).toEqual([]);
  });

  it("never disturbs a note on the same screen: an option can be liked AND carry complaints", () => {
    const liked = withVerdict([note], press("like"));
    expect(liked).toHaveLength(2);
    const cleared = withVerdict(liked, press(null, "c3"));
    expect(cleared).toEqual([note]);
  });

  it("leaves another screen's verdict alone", () => {
    const other = withVerdict([], {
      ...press("like"),
      screenId: "run-panel-above",
      id: "c9",
    });
    const both = withVerdict(other, press("dislike", "c10"));
    expect(both).toHaveLength(2);
    expect(both.map((one) => one.screenId).sort()).toEqual([
      "run-in-card",
      "run-panel-above",
    ]);
  });

  it("arrives unread, so the agent's own consumed flag is what drains it", () => {
    const [written] = withVerdict([], press("dislike"));
    expect(written.consumedAt ?? null).toBeNull();
  });
});
