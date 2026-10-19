/**
 * Tests for the switch to today's screen under every exploration frame (`redesigns`), and the rule that keeps it from going
 * missing as a declaration changes over rounds: `recordToday` (what the capture writes into the manifest) and
 * `todaySwitchProblems` (what the preflight and the oracle refuse).
 *
 *   node --test tool/tests/today-switch.test.mjs
 *
 * NOT INSTALLED into a project: the installer copies only the files it lists.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { recordToday, todaySwitchProblems } from "../preflight-rules.mjs";

/* A small canvas: two of today's screens, and one panel of two options, the first with a step. */
const screens = [
  { id: "list", view: "flow" },
  { id: "list-empty", view: "flow" },
  { id: "opt-a", view: "exploration" },
  { id: "opt-a-empty", view: "exploration" },
  { id: "opt-b", view: "exploration" },
];
const panel = (links) => [
  {
    id: "panel",
    original: "list",
    screens: [
      { id: "opt-a", ...links["opt-a"] },
      { id: "opt-a-empty", under: "opt-a", ...links["opt-a-empty"] },
      { id: "opt-b", ...links["opt-b"] },
    ],
  },
];
const shot = (screenId, extra = {}) => ({ screenId, hash: screenId, ...extra });

test("a declaration that links every frame passes, and a null frame is listed as having no switch", () => {
  const explorations = panel({ "opt-a": { redesigns: "list" }, "opt-a-empty": { redesigns: "list-empty" }, "opt-b": { redesigns: null } });
  const { problems, without } = todaySwitchProblems({ explorations, screens, shots: [] });
  assert.deepEqual(problems, []);
  assert.deepEqual(without, ["opt-b"]);
});

test("a reference hung under an option with redesigns: null is listed too, as every null frame is", () => {
  const explorations = panel({ "opt-a": { redesigns: "list" }, "opt-a-empty": { redesigns: "list-empty" }, "opt-b": { redesigns: "list" } });
  explorations[0].screens.push({ id: "ref", reference: true, suggests: "opt-a", redesigns: null });
  const { problems, without } = todaySwitchProblems({ explorations, screens: [...screens, { id: "ref", view: "exploration" }], shots: [] });
  assert.deepEqual(problems, []);
  assert.deepEqual(without, ["ref"]);
});

test("a frame that says nothing, names no screen, or names an exploration frame is refused", () => {
  const explorations = panel({ "opt-a": {}, "opt-a-empty": { redesigns: "gone" }, "opt-b": { redesigns: "opt-a" } });
  const { problems } = todaySwitchProblems({ explorations, screens, shots: [] });
  assert.equal(problems.length, 3);
  assert.ok(problems[0].includes('"opt-a" does not say what it redesigns'));
  assert.ok(problems[1].includes('redesigns "gone", which is not a screen this canvas declares'));
  assert.ok(problems[2].includes('redesigns "opt-a", an exploration frame'));
});

test("the capture remembers each frame's link, and only for exploration frames", () => {
  const explorations = panel({ "opt-a": { redesigns: "list" }, "opt-a-empty": { redesigns: "list-empty" }, "opt-b": { redesigns: null } });
  const out = recordToday({ shots: [shot("list"), shot("opt-a"), shot("opt-a-empty"), shot("opt-b")], previous: [], explorations });
  assert.deepEqual(
    out.map((one) => [one.screenId, one.today]),
    [["list", undefined], ["opt-a", "list"], ["opt-a-empty", "list-empty"], ["opt-b", undefined]],
  );
});

test("REPRODUCTION: a later round rewrites the declaration with null, and the switch would vanish without a word", () => {
  /* Round one: both frames of option A flip to today's screens, and the capture writes the manifest. */
  const roundOne = panel({ "opt-a": { redesigns: "list" }, "opt-a-empty": { redesigns: "list-empty" }, "opt-b": { redesigns: null } });
  const manifest = recordToday({ shots: [shot("opt-a"), shot("opt-a-empty"), shot("opt-b")], previous: [], explorations: roundOne });

  /* Round two: the declaration is regenerated, and the step's link comes back as null (or not at all). */
  const roundTwo = panel({ "opt-a": { redesigns: "list" }, "opt-a-empty": { redesigns: null }, "opt-b": {} });
  const { problems, without } = todaySwitchProblems({ explorations: roundTwo, screens, shots: manifest });
  assert.equal(problems.length, 2, problems.join("\n"));
  assert.ok(problems[0].includes('"opt-a-empty" switched to today\'s "list-empty" when it was last captured and now declares redesigns: null'));
  assert.ok(problems[0].includes('put redesigns: "list-empty" back'));
  /* opt-b never had a link, so it is refused for saying nothing, not for losing one. */
  assert.ok(problems[1].includes('"opt-b" does not say what it redesigns'));
  assert.deepEqual(without, []);
});

test("the link survives a capture that ran on the forgetful declaration, so the next check still refuses it", () => {
  const roundOne = panel({ "opt-a": { redesigns: "list" }, "opt-a-empty": { redesigns: "list-empty" }, "opt-b": { redesigns: null } });
  const first = recordToday({ shots: [shot("opt-a"), shot("opt-a-empty"), shot("opt-b")], previous: [], explorations: roundOne });
  const forgetful = panel({ "opt-a": { redesigns: "list" }, "opt-a-empty": { redesigns: null }, "opt-b": { redesigns: null } });
  /* The step is photographed again from the forgetful declaration: a fresh entry, with nothing about today on it. */
  const second = recordToday({ shots: [shot("opt-a", { today: "list" }), shot("opt-a-empty", { hash: "new" }), shot("opt-b")], previous: first, explorations: forgetful });
  assert.equal(second.find((one) => one.screenId === "opt-a-empty").today, "list-empty");
  const { problems } = todaySwitchProblems({ explorations: forgetful, screens, shots: second });
  assert.equal(problems.length, 1);
  assert.ok(problems[0].includes('"opt-a-empty" switched to today\'s "list-empty"'));
});

test("a changed link is followed, not refused", () => {
  const roundOne = panel({ "opt-a": { redesigns: "list" }, "opt-a-empty": { redesigns: "list" }, "opt-b": { redesigns: null } });
  const first = recordToday({ shots: [shot("opt-a"), shot("opt-a-empty"), shot("opt-b")], previous: [], explorations: roundOne });
  const corrected = panel({ "opt-a": { redesigns: "list" }, "opt-a-empty": { redesigns: "list-empty" }, "opt-b": { redesigns: null } });
  assert.deepEqual(todaySwitchProblems({ explorations: corrected, screens, shots: first }).problems, []);
  const second = recordToday({ shots: first, previous: first, explorations: corrected });
  assert.equal(second.find((one) => one.screenId === "opt-a-empty").today, "list-empty");
});

test("a frame that replaces a removed one (successors) takes over its link", () => {
  const before = [shot("old-step", { today: "list-empty" })];
  const renamed = [
    {
      id: "panel",
      original: "list",
      screens: [
        { id: "opt-a", redesigns: "list" },
        { id: "opt-a-empty-2", under: "opt-a", redesigns: null },
      ],
    },
  ];
  const after = recordToday({ shots: [shot("opt-a"), shot("opt-a-empty-2")], previous: before, explorations: renamed, successors: { "old-step": "opt-a-empty-2" } });
  assert.equal(after.find((one) => one.screenId === "opt-a-empty-2").today, "list-empty");
  const { problems } = todaySwitchProblems({
    explorations: renamed,
    screens: [...screens, { id: "opt-a-empty-2", view: "exploration" }],
    shots: after,
  });
  assert.equal(problems.length, 1);
  assert.ok(problems[0].includes('"opt-a-empty-2" switched to today\'s "list-empty"'));
});

test("a manifest written before links were remembered refuses nothing", () => {
  const explorations = panel({ "opt-a": { redesigns: "list" }, "opt-a-empty": { redesigns: null }, "opt-b": { redesigns: null } });
  const { problems } = todaySwitchProblems({ explorations, screens, shots: [shot("opt-a"), shot("opt-a-empty"), shot("opt-b")] });
  assert.deepEqual(problems, []);
});
