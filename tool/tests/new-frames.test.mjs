/**
 * Tests for `new-frames.mjs`: a frame is new only when the canvas never held a picture of it, a changed frame is never new, and
 * a rename carries a frame's place in the waiting queue instead of putting an old frame back in it.
 *
 *   node --test tool/tests/new-frames.test.mjs
 *
 * NOT INSTALLED into a project: the installer copies only the files it lists.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { classifyFrames, declaredRenames, nextWaiting, sayFrames } from "../new-frames.mjs";
import { judge } from "../visual-delta.mjs";

const shot = (screenId, hash) => ({ screenId, hash });

test("an id with no picture before is new, and the only new one", () => {
  const frames = classifyFrames({ before: [shot("a", "1")], after: [shot("a", "1"), shot("b", "2")] });
  assert.deepEqual(frames.new, ["b"]);
  assert.deepEqual(frames.unchanged, ["a"]);
  assert.deepEqual(frames.changed, []);
});

test("a frame whose picture changed is changed, never new", () => {
  const frames = classifyFrames({ before: [shot("a", "1"), shot("b", "2")], after: [shot("a", "9"), shot("b", "2")] });
  assert.deepEqual(frames.changed, ["a"]);
  assert.deepEqual(frames.unchanged, ["b"]);
  assert.deepEqual(frames.new, []);
});

test("an identical picture is unchanged", () => {
  const frames = classifyFrames({ before: [shot("a", "1")], after: [shot("a", "1")] });
  assert.deepEqual(frames, { new: [], changed: [], unchanged: ["a"], renamed: [], deleted: [] });
});

test("an id that left is deleted", () => {
  const frames = classifyFrames({ before: [shot("a", "1"), shot("b", "2")], after: [shot("a", "1")] });
  assert.deepEqual(frames.deleted, ["b"]);
  assert.deepEqual(frames.new, []);
});

test("a rename named in successors is a rename even when the picture changed with it", () => {
  const frames = classifyFrames({
    before: [shot("old", "1")],
    after: [shot("fresh", "7")],
    successors: { old: "fresh" },
  });
  assert.deepEqual(frames.renamed, [{ from: "old", to: "fresh", by: "successors" }]);
  assert.deepEqual(frames.new, []);
  assert.deepEqual(frames.deleted, []);
});

test("a rename with no successors entry is told by an identical picture", () => {
  const frames = classifyFrames({ before: [shot("old", "1"), shot("keep", "2")], after: [shot("renamed", "1"), shot("keep", "2")] });
  assert.deepEqual(frames.renamed, [{ from: "old", to: "renamed", by: "picture" }]);
  assert.deepEqual(frames.new, []);
  assert.deepEqual(frames.deleted, []);
});

test("an identical picture proves nothing when more than one frame could be its source", () => {
  const frames = classifyFrames({ before: [shot("empty-a", "0"), shot("empty-b", "0")], after: [shot("empty-c", "0")] });
  assert.deepEqual(frames.renamed, []);
  assert.deepEqual(frames.new, ["empty-c"]);
  assert.deepEqual(frames.deleted.sort(), ["empty-a", "empty-b"]);
});

test("a rename that also changed its picture, named nowhere, cannot be told from a new frame", () => {
  const frames = classifyFrames({ before: [shot("old", "1")], after: [shot("other", "5")] });
  assert.deepEqual(frames.new, ["other"]);
  assert.deepEqual(frames.deleted, ["old"]);
});

test("a later entry for the same id wins, as it does in the manifest", () => {
  const frames = classifyFrames({ before: [shot("a", "1")], after: [shot("a", "1"), shot("a", "2")] });
  assert.deepEqual(frames.changed, ["a"]);
});

test("successors chains are followed, and releases and circles rename nothing", () => {
  assert.deepEqual(declaredRenames({ a: "b", b: "c", gone: null, x: "y", y: "x" }), [
    { from: "a", to: "c" },
    { from: "b", to: "c" },
  ]);
  assert.deepEqual(declaredRenames(undefined), []);
});

test("sayFrames names every kind that happened", () => {
  const line = sayFrames({ new: ["n"], changed: ["c"], unchanged: ["u"], renamed: [{ from: "o", to: "r", by: "picture" }], deleted: ["d"] });
  assert.equal(line, "frames: 1 new (n), 1 changed (c), 1 renamed (o -> r), 1 removed (d)");
  assert.equal(sayFrames({ new: [], changed: [], unchanged: ["u"], renamed: [], deleted: [] }), "frames: nothing new, changed, renamed or removed");
});

test("sayFrames uses the change report's definition of changed: new bytes with no pixel changed are not counted", () => {
  const frames = { new: [], changed: ["a", "b", "c"], unchanged: [], renamed: [], deleted: [] };
  assert.equal(sayFrames(frames, new Set(["a", "c"])), "frames: 1 changed (b)");
  assert.equal(sayFrames(frames, new Set(["a", "b", "c"])), "frames: nothing new, changed, renamed or removed");
  /* The queue reads the same set, so the line and the waiting map agree. */
  const waiting = nextWaiting({ waiting: {}, frames, before: [], after: [], declared: new Set(["a", "b", "c"]), identical: new Set(["a", "c"]), viewed: true });
  assert.deepEqual(Object.keys(waiting), ["b"]);
});

/**
 * The waiting map after one capture from `before` to `after`, every id in `after` declared unless `declared` says otherwise.
 * The reviewer has visited unless `viewed` says otherwise.
 */
const waitAfter = ({ waiting, before, after, successors = {}, declared, viewed = true }) =>
  nextWaiting({
    waiting,
    frames: classifyFrames({ before, after, successors }),
    before,
    after,
    declared: declared ?? new Set(after.map((one) => one.screenId)),
    successors,
    viewed,
  });

test("a new frame waits as new and a changed one as changed; an unchanged one does not wait", () => {
  const before = [shot("a", "1"), shot("b", "2")];
  const after = [shot("a", "9"), shot("b", "2"), shot("c", "3")];
  assert.deepEqual(waitAfter({ waiting: undefined, before, after }), { c: "new", a: "changed" });
});

test("before the reviewer's first visit nothing is queued, however many captures run", () => {
  assert.equal(waitAfter({ waiting: undefined, before: [], after: [shot("a", "1"), shot("b", "2")], viewed: false }), undefined);
  const before = [shot("a", "1"), shot("b", "2")];
  const after = [shot("a", "9"), shot("b", "2"), shot("c", "3")];
  assert.equal(waitAfter({ waiting: undefined, before, after, viewed: false }), undefined);
  const empty = {};
  assert.equal(waitAfter({ waiting: empty, before, after, viewed: false }), empty, "the same map comes back");
});

test("after the first visit a frame that arrives waits as new, even on a canvas with no earlier picture", () => {
  const before = [shot("a", "1")];
  const after = [shot("a", "1"), shot("b", "2")];
  assert.deepEqual(waitAfter({ waiting: {}, before, after }), { b: "new" });
  assert.deepEqual(waitAfter({ waiting: {}, before: [], after: [shot("a", "1")] }), { a: "new" });
});

test("a frame still waiting as new stays new when its picture changes again", () => {
  const before = [shot("a", "1")];
  const after = [shot("a", "2")];
  assert.deepEqual(waitAfter({ waiting: { a: "new" }, before, after }), { a: "new" });
});

test("earlier entries stay, undeclared ones go, and the same map comes back when nothing changed", () => {
  const before = [shot("a", "1"), shot("b", "2")];
  const after = [shot("a", "1"), shot("b", "2")];
  const map = { a: "changed" };
  assert.equal(waitAfter({ waiting: map, before, after }), map);
  assert.deepEqual(waitAfter({ waiting: { a: "changed", gone: "new" }, before, after }), { a: "changed" });
});

test("a rename carries the entry, and a reviewed frame renamed with a new picture waits as changed", () => {
  const before = [shot("old", "1"), shot("was", "5"), shot("same", "7")];
  const after = [shot("fresh", "2"), shot("now", "5"), shot("kept", "7")];
  const successors = { old: "fresh", was: "now" };
  assert.deepEqual(waitAfter({ waiting: {}, before, after, successors }), { fresh: "changed" });
  assert.deepEqual(waitAfter({ waiting: { was: "new" }, before, after, successors }), { fresh: "changed", now: "new" });
});

test("a declared rename whose new id arrives in a later capture takes the old id's entry, or none", () => {
  /* The old id left in an earlier capture; its entry was kept because `successors` still names it. */
  const before = [shot("other", "1")];
  const after = [shot("other", "1"), shot("renamed", "2")];
  const successors = { gone: "renamed" };
  assert.deepEqual(waitAfter({ waiting: { gone: "new" }, before, after, successors }), { renamed: "new" });
  assert.equal(waitAfter({ waiting: undefined, before, after, successors }), undefined);
});

test("a frame the change report measured identical does not wait as changed, so the queue and the report agree", () => {
  const before = [shot("a", "1"), shot("b", "2"), shot("old", "3")];
  const after = [shot("a", "9"), shot("b", "8"), shot("renamed", "4")];
  const successors = { old: "renamed" };
  const frames = classifyFrames({ before, after, successors });
  const declared = new Set(["a", "b", "renamed"]);
  assert.deepEqual(nextWaiting({ waiting: {}, frames, before, after, declared, successors, viewed: true }), { a: "changed", b: "changed", renamed: "changed" });
  assert.deepEqual(nextWaiting({ waiting: {}, frames, before, after, declared, successors, identical: new Set(["b", "renamed"]), viewed: true }), { a: "changed" });
  /* The report's verdict: a few pixels past the tolerance (a corner radius) are a change; none at all is identical. */
  assert.equal(judge({ changedPct: 0.00017, outsidePct: 0.00017, hasComments: false, sizeChanged: false }).status, "changed");
  assert.equal(judge({ changedPct: 0, outsidePct: 0, hasComments: false, sizeChanged: false }).status, "identical");
});
