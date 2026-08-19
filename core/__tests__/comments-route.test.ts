import { describe, expect, it } from "vitest";

import { DELETE, PATCH, withVerdict } from "../comments-route";

/**
 * THE PATH TRAVERSAL THIS ROUTE HAD, held shut by a test.
 *
 * A background security review of c3f6aae7 found that DELETE took `?id=` from the query string into
 * `path.join(IMAGES, `${id}.png`)` and then into `fs.rm(..., { force: true })`, so a request could delete a
 * file anywhere on the developer's machine whose name ended in `.png`. Dev-only and 404 in production, which
 * lowers the severity and does not excuse it. The fix is a whitelist: an id must match the `c<digits>` shape
 * `nextId` mints.
 *
 * ONLY THE REJECTIONS ARE TESTED, AND THAT IS DELIBERATE. Every case below is one the route refuses before it
 * touches the filesystem, so this file has no side effects. The happy path is deliberately NOT exercised: a
 * valid DELETE rewrites `design-canvas/comments.json` in the working tree and `?all=1` erases every comment and
 * picture the designer has made. I learned that the hard way while writing this — a throwaway probe called
 * `?all=1` against the real repo and emptied the file. A test suite must never be able to do that.
 *
 * The rejections are not a weak assertion. Before the fix every one of these returned 200 and removed a file;
 * a 400 can only come from the guard, and the guard runs as the first statement after the id is read, before
 * any read, write or unlink.
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
 * THE SECOND PIECE OF REQUEST DATA THAT REACHES A PATH, added when one project could hold several canvases:
 * `?canvas=` names the folder a review is stored in. Same treatment as the id above — a whitelist matching
 * exactly what a slug may be — and held shut the same way, because a traversal here would reach further than
 * the id one ever could: the slug is a directory, not a filename with `.png` pinned on the end.
 *
 * Every case is refused before the filesystem is touched, so this file still has no side effects.
 */
describe("the canvas comments route's ?canvas= guard", () => {
  it.each([
    ["../../..", "a climb out of the canvas folder"],
    ["..%2F..%2Fetc", "the same climb, percent-encoded"],
    ["/etc", "an absolute path"],
    ["checkout/../storefront", "a climb that lands on another canvas"],
    ["Checkout", "the right shape in the wrong case"],
    ["-checkout", "a leading dash, which is not a name"],
    ["online store", "a space"],
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
 * APPROVE ALL USED TO RESURRECT WHAT IT APPROVED, and this is the regression that proves it cannot again.
 *
 * The mechanism: every handler in this route reads the whole records file, changes one record and writes the
 * whole file back, and Approve All fired one DELETE per comment at the same moment. They all read the same
 * list, so the last write won and every other approval was undone. Reported: "it keeps my old
 * comments even after I approve all of them", with the next comment numbered 12 rather than 1, because
 * eleven survivors were still on the canvas and a pin is numbered by its position in the list.
 *
 * NO FILESYSTEM HERE EITHER, for the reason the block above gives: a valid DELETE rewrites the reviewer's
 * real records file. What is asserted is the CONTRACT that removed the race — that one request carries the
 * whole batch — by checking the route accepts `?ids=` and still refuses a batch containing a bad id. A
 * fan-out cannot come back without breaking one of these.
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
 * THE 200 THAT MEANT NOTHING, held shut by a test.
 *
 * PATCH answered 200 for an id the file does not hold. An agent draining a review reads that as "the note is
 * consumed", and the one time it matters is the time the request went to the wrong canvas — `?canvas=` is a
 * QUERY parameter, so passing the slug in the JSON body instead silently selects the default canvas, where none
 * of the ids exist. Nine 200s, nothing patched, a `main.json` created to hold the nothing, and a reviewer's real
 * notes still waiting. `consumed` is only worth having if a 200 proves it.
 *
 * SIDE-EFFECT FREE, like every other case in this file: the refusal is thrown inside the mutation, before the
 * write, and the canvas named here has no file of its own to read.
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
 * A VERDICT IS A COMMENT, and the rules that makes true.
 *
 * Like and dislike used to live in their own `verdicts` array beside the comments. They are now comments with a
 * `kind`, because the hand-off prompt's one sentence — "when a comment is done, PATCH … { id, consumed: true }"
 * — is the entire draining mechanism, and a second list would have needed its own parallel copy of it.
 *
 * Tested through `withVerdict` rather than through PATCH on purpose: the route's happy path rewrites the
 * reviewer's real file, and the header of this file records what happened the one time a test did that.
 */
describe("applying a verdict to a comment list", () => {
  const note = {
    id: "c1",
    flowId: "run-placement",
    screenId: "run-in-card",
    label: "Inside the sync card",
    route: "/settings/integrations/checkout",
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
    route: "/settings/integrations/checkout",
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
