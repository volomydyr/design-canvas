/**
 * Tests for the five things a round is made of: comment integrity (a frame leaves, its comments go somewhere or the run
 * stops), the one-command round and its settings, the preflight's rules, click steps, and the visual change report.
 *
 *   node --test tool/tests/tools.test.mjs tool/tests/round.test.mjs
 *
 * Everything above the last heading needs no browser, no app and no dependencies, so it runs in the skill's own checkout. The
 * tests under "in a browser" need Playwright, which a project carries and the skill does not: point CANVAS_TEST_PROJECT at a
 * project that has it (an install of the canvas will do) and they run; without it they are skipped, by name, never silently.
 *
 *   CANVAS_TEST_PROJECT=/path/to/project node --test tool/tests/round.test.mjs
 *
 * NOT INSTALLED into a project: the installer copies only the files it lists.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

import { applyMoves, commentsFileFor, declaredFrames, markStale, planPins, planSummary, refusalFailures, refusalLines, remedyLine, routeAndState } from "../comment-integrity.mjs";
import { buildContactSheet, cropWindow, sheetHtml } from "../contact-sheet.mjs";
import { EDGE_VERBS, checkEdgeLabel } from "../copy-rules.mjs";
import {
  checkLocaleFiles,
  claimFindings,
  collectClaims,
  coverageGaps,
  coverageNote,
  detectLocales,
  flattenLocale,
  lintAll,
  lintCopy,
  lintDeclaration,
  lintSteps,
  loadProjectTexts,
  SHARED_SURFACE_FILES,
  stateNames,
  templateMatches,
  unknownStateProblems,
} from "../preflight-rules.mjs";
import { MAX_STEPS, describeStep, describeSteps, parseSteps, runSteps } from "../steps.mjs";
import { CONTROLS, FLAG_PCT, compareRgba, judge, regionRect, removedControls, removedLines, reportVisualChange } from "../visual-delta.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOL = path.join(HERE, "..");
const made = [];
const scratch = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "canvas-round-test-"));
  made.push(dir);
  return dir;
};
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ item 1: comment integrity */

const frames = declaredFrames([
  { id: "home", flowId: "tour", label: "Home Page", url: "/" },
  { id: "settings-open", flowId: "tour", label: "Settings Open", url: "/settings?tab=alerts&canvas=open-state" },
  { id: "products", flowId: "lists", label: "Product List", url: "/products" },
]);
const note = (id, screenId, extra = {}) => ({ id, screenId, flowId: "old", label: screenId, route: "/old", state: null, note: `note ${id}`, region: { xPct: 1, yPct: 1, wPct: 5, hPct: 5 }, ...extra });

test("a live note on a frame that left follows its successor, unread or answered, and keeps everything it said", () => {
  const plan = planPins({
    comments: [note("c1", "gone-a"), note("c2", "gone-a", { consumedAt: "2026-09-30T10:00:00Z", stale: true }), note("c3", "home")],
    declared: frames,
    successors: { "gone-a": "settings-open" },
  });
  assert.deepEqual(plan.moves, [
    { id: "c1", from: "gone-a", to: "settings-open", state: "unread" },
    { id: "c2", from: "gone-a", to: "settings-open", state: "answered" },
  ]);
  assert.equal(plan.refused.length, 0);
  assert.equal(plan.problems.length, 0);
  const moved = applyMoves([note("c1", "gone-a", { shotHash: "old-frames-hash" }), note("c2", "gone-a", { consumedAt: "x", stale: true }), note("c3", "home")], plan.moves, frames, (frame) => (frame === "settings-open" ? "hash-of-successor" : undefined));
  assert.equal(moved[0].screenId, "settings-open");
  assert.equal(moved[0].flowId, "tour", "filed under the group it is drawn in");
  assert.equal(moved[0].label, "Settings Open");
  assert.equal(moved[0].route, "/settings?tab=alerts", "the route without the pin parameter");
  assert.equal(moved[0].state, "open-state");
  assert.equal(moved[0].movedFrom, "gone-a");
  assert.equal(moved[0].shotHash, "hash-of-successor", "measured against the successor's picture from now on, never the old frame's");
  assert.deepEqual(moved[0].region, { xPct: 1, yPct: 1, wPct: 5, hPct: 5 }, "the rectangle is untouched");
  assert.equal(moved[0].note, "note c1");
  assert.equal(moved[1].consumedAt, "x", "answered stays answered");
  assert.equal(moved[1].stale, true);
  assert.equal(moved[2].screenId, "home", "a comment on a declared frame is not touched");
  assert.equal(moved[2].movedFrom, undefined);
  assert.match(planSummary(plan), /2 comment\(s\) follow their frame \(gone-a → settings-open\): c1, c2/);
});

test("a capture marks stale only the comments on frames it photographed, against the hash they were drawn or reopened on", () => {
  /* c1 was reopened on the picture "now" after being drawn on "first"; its frame is kept this run (another frame was photographed). */
  const byScreen = new Map([
    ["home", { screenId: "home", hash: "now" }],
    ["products", { screenId: "products", hash: "fresh" }],
  ]);
  const comments = [
    note("c1", "home", { shotHash: "now" }),
    note("c2", "home", { shotHash: "first" }),
    note("c3", "products", { shotHash: "older" }),
    note("c4", "products", { shotHash: "fresh" }),
    note("c5", "products", { kind: "like" }),
  ];
  const kept = markStale(comments, { byScreen, rephotographed: new Set(["products"]) });
  assert.equal(kept.flagged, 2);
  assert.deepEqual(kept.comments.map((one) => Boolean(one.stale)), [false, false, true, false, true], "home was not photographed, so neither comment on it changes");
  /* The same reopened note on a run that does photograph its frame, with an identical picture: still not stale. */
  const again = markStale([note("c1", "home", { shotHash: "now" })], { byScreen, rephotographed: new Set(["home"]) });
  assert.equal(again.flagged, 0);
  const moved = markStale([note("c6", "products")], { byScreen, rephotographed: new Set(["products"]), moved: new Set(["c6"]) });
  assert.equal(moved.flagged, 0, "moved onto a frame with no hash to compare: left alone");
});

test("a moved comment with no hash to give drops the old frame's rather than keeping a wrong one", () => {
  const [moved] = applyMoves([note("c1", "gone", { shotHash: "old" })], [{ id: "c1", from: "gone", to: "home", state: "unread" }], frames);
  assert.equal("shotHash" in moved, false);
});

test("a chain of successors is followed to the frame that is still declared", () => {
  const plan = planPins({ comments: [note("c1", "v1")], declared: frames, successors: { v1: "v2", v2: "products" } });
  assert.deepEqual(plan.moves, [{ id: "c1", from: "v1", to: "products", state: "unread" }]);
});

test("a frame that left with live notes and nowhere to send them REFUSES the run, naming the frame and the ids", () => {
  const plan = planPins({
    comments: [note("c4", "removed", { consumedAt: "x" }), note("c5", "removed"), note("c6", "removed"), note("c7", "home")],
    declared: frames,
    successors: {},
  });
  assert.equal(plan.moves.length, 0);
  assert.deepEqual(plan.refused, [{ frame: "removed", unread: ["c5", "c6"], answered: ["c4"], released: false, dead: null }]);
  const lines = refusalLines(plan);
  assert.match(lines[0], /frame "removed" is no longer declared and still carries 3 comment\(s\)/);
  assert.match(lines[0], /unread: c5, c6/);
  assert.match(lines[0], /answered, waiting for the reviewer's Approve: c4/);
  assert.ok(lines.at(-1).includes('successors: { "removed": "<the frame that replaces it>" }'));
  assert.ok(lines.at(-1).includes("Nothing was captured, swept or moved."));
  assert.ok(!remedyLine(plan, { nothingMoved: false }).includes("Nothing was captured"), "the oracle reads a finished state and says no such thing");
  assert.equal(refusalFailures(plan).length, 1, "one sentence per frame, for a caller that prints its own remedy");
});

test("null releases ANSWERED notes on purpose, and never an unread one", () => {
  const released = planPins({ comments: [note("c1", "old", { consumedAt: "x" })], declared: frames, successors: { old: null } });
  assert.deepEqual(released.released, [{ id: "c1", from: "old" }]);
  assert.equal(released.refused.length, 0);
  const mixed = planPins({ comments: [note("c1", "old", { consumedAt: "x" }), note("c2", "old")], declared: frames, successors: { old: null } });
  assert.equal(mixed.refused.length, 1);
  assert.deepEqual(mixed.refused[0].unread, ["c2"]);
  assert.equal(mixed.refused[0].released, true);
  assert.match(refusalFailures(mixed)[0], /releases ANSWERED notes only: drain the unread ones first/);
});

test("a like or a dislike is not a note: it goes with the option it judged, as it always did", () => {
  const plan = planPins({ comments: [note("c1", "dropped-option", { kind: "like" }), note("c2", "dropped-option", { kind: "dislike", consumedAt: "x" })], declared: frames, successors: {} });
  assert.equal(plan.refused.length, 0);
  assert.deepEqual(plan.verdicts.map((one) => one.id), ["c1", "c2"]);
});

test("a successor that leads in a circle, to nothing, or to a dead end is a named problem and refuses the run", () => {
  const circle = planPins({ comments: [note("c1", "a")], declared: frames, successors: { a: "b", b: "a" } });
  assert.match(circle.problems.join("\n"), /leads round in a circle/);
  assert.equal(circle.refused.length, 1);
  const dead = planPins({ comments: [note("c1", "a")], declared: frames, successors: { a: "b" } });
  assert.match(dead.problems.join("\n"), /"a" leads to "b", which is not a declared frame/);
  assert.equal(dead.refused.length, 1);
  const bad = planPins({ comments: [note("c1", "a")], declared: frames, successors: { a: "" } });
  assert.match(bad.problems.join("\n"), /must name a frame or be null/);
});

test("routeAndState splits the address the way a comment records it", () => {
  assert.deepEqual(routeAndState("/settings?tab=alerts&canvas=open-state"), { route: "/settings?tab=alerts", state: "open-state" });
  assert.deepEqual(routeAndState("/products"), { route: "/products", state: null });
  assert.deepEqual(routeAndState(null), { route: undefined, state: null });
});

test("commentsFileFor finds the canvas's own review file, or null", () => {
  const dir = scratch();
  mkdirSync(path.join(dir, "comments"), { recursive: true });
  assert.equal(commentsFileFor(dir, "library"), null);
  writeFileSync(path.join(dir, "comments.json"), JSON.stringify({ comments: [] }));
  assert.equal(commentsFileFor(dir, "library"), null, "a flat file is the installer's to migrate, never read here");
  writeFileSync(path.join(dir, "comments", "library.json"), JSON.stringify({ comments: [] }));
  assert.equal(commentsFileFor(dir, "library"), path.join(dir, "comments", "library.json"));
});

/* ------------------------------------------------------------------ item 4: click steps, parsed */

test("parseSteps accepts the five step types and returns the list unchanged", () => {
  const list = [
    { click: "Adjust" },
    { click: "Save", role: "button", within: "[role=dialog]", nth: 1 },
    { fill: "Guests", with: "12" },
    { press: "Enter", on: "Guests" },
    { waitText: "Export Tasks" },
    { closeWelcome: true },
    { closeWelcome: "Got it" },
  ];
  assert.equal(parseSteps(list, "t"), list);
  assert.deepEqual(parseSteps(undefined, "t"), []);
  assert.deepEqual(parseSteps([], "t"), []);
});

test("an unknown step type THROWS, with the screen and the position", () => {
  assert.throws(() => parseSteps([{ click: "Adjust" }, { tap: "Adjust" }], "home-settings"), /home-settings: steps\[1\] has an unknown step type "tap"\. The step types are: click, fill, press, waitText, closeWelcome/);
  assert.throws(() => parseSteps([{}], "s"), /steps\[0\] has an unknown step type "\(empty\)"/);
  assert.throws(() => parseSteps(["click"], "s"), /steps\[0\] is not an object/);
  assert.throws(() => parseSteps({ click: "x" }, "s"), /steps must be a list/);
});

test("a step does one thing, takes only its own keys, and has its values", () => {
  assert.throws(() => parseSteps([{ click: "A", press: "Enter" }], "s"), /names click and press: one step does one thing/);
  assert.throws(() => parseSteps([{ click: "A", with: "x" }], "s"), /click does not take "with"/);
  assert.throws(() => parseSteps([{ fill: "Field" }], "s"), /fill needs "with"/);
  assert.throws(() => parseSteps([{ click: "" }], "s"), /click needs the exact text/);
  assert.throws(() => parseSteps([{ waitText: 4 }], "s"), /waitText needs the exact text/);
  assert.throws(() => parseSteps([{ closeWelcome: false }], "s"), /closeWelcome takes true/);
  assert.throws(() => parseSteps([{ click: "A", nth: -2 }], "s"), /nth counts from 0, and -1 is the last one/);
  assert.throws(() => parseSteps([{ click: "A", nth: 1.5 }], "s"), /nth counts from 0/);
  assert.throws(() => parseSteps([{ click: "A", role: "" }], "s"), /role must be a role name/);
});

test("a list longer than twelve is a script and is refused", () => {
  assert.equal(MAX_STEPS, 12);
  const twelve = Array.from({ length: 12 }, () => ({ press: "Tab" }));
  assert.equal(parseSteps(twelve, "s").length, 12);
  assert.throws(() => parseSteps([...twelve, { press: "Tab" }], "s"), /13 steps is a script/);
});

test("describeSteps reads as what a person does", () => {
  assert.equal(describeStep({ click: "Adjust" }), 'click "Adjust"');
  assert.equal(describeStep({ fill: "Guests", with: "12" }), 'fill "Guests" with "12"');
  assert.equal(describeStep({ press: "Enter", on: "Guests" }), 'press Enter on "Guests"');
  assert.equal(describeStep({ closeWelcome: true }), "closeWelcome (dismiss.json)");
  assert.equal(describeSteps([{ click: "A" }, { waitText: "B" }]), 'click "A", waitText "B"');
});

/* ------------------------------------------------------------------ item 3: the preflight's rules */

const base = () => ({
  title: "Demo Canvas",
  note: "Two flows.",
  kinds: null,
  groups: [
    { id: "tour", title: "Tour", note: "A tour.", edges: [{ from: "a", to: "b", label: "Presses Continue" }] },
    { id: "lists", title: "Lists", note: "Lists.", edges: [] },
  ],
  explorations: [],
  screens: [
    { id: "a", flowId: "tour", label: "First Frame", note: "First.", url: "/a" },
    { id: "b", flowId: "tour", label: "Second Frame", note: "Second.", url: "/b" },
    { id: "c", flowId: "lists", label: "Third Frame", note: "Third.", url: "/c" },
  ],
});

test("a clean declaration lints clean", () => {
  assert.deepEqual(lintDeclaration(base()), []);
});

test("lintAll holds the file to every static rule the oracle holds the served declaration to, by kind", () => {
  const decl = base();
  decl.groups[0].edges[0].origin = { x: 0.1, y: 0.1, w: 0.1, h: 0.1 };
  const clean = lintAll(decl);
  assert.deepEqual({ ...clean, without: undefined }, { copy: [], declaration: [], steps: [], network: [], without: undefined });
  decl.kinds = [{ id: "Lists", whatBelongs: "the lists" }];
  decl.screens[2].kind = "Tables";
  decl.screens.push({ id: "why", flowId: "tour", label: "Why", note: "", explain: "Text.", url: "/why" });
  decl.groups[1].edges = [{ from: "c", to: "c2", label: "When it is empty" }];
  decl.screens.push({ id: "c2", flowId: "lists", label: "Empty List", note: "Empty.", url: "/c?empty=1" });
  decl.groups[0].edges.push({ from: "b", to: "a", label: "Presses Go Back Home" });
  decl.explorations = [{ id: "ex", original: "nope", screens: [{ id: "a", evidence: [{ file: "x.png", w: 10, h: 10 }] }] }];
  decl.screens.push({ id: "z", flowId: "tour", label: "Zed", note: "Zed.", url: null, steps: [{ hover: 3 }] });
  const lint = lintAll(decl, { evidenceDir: path.join(scratch(), "evidence", "s") });
  const has = (pattern) => assert.ok(lint.declaration.some((one) => pattern.test(one)), `${pattern}: ${lint.declaration.join(" | ")}`);
  has(/c: filed under "Tables", which this canvas does not declare/);
  has(/why: carries both a route and an explanation/);
  has(/flow "lists" has no action edge/);
  has(/tour: edge b → a \("Presses Go Back Home"\) is a press with no origin/);
  has(/exploration ex: original "nope" is not a screen this canvas declares/);
  has(/a: its evidence "x\.png" is not in design-canvas\/evidence\/s\//);
  has(/z: no route and no explanation/);
  assert.ok(lint.steps.length > 0, "an unknown step is a steps problem");
});

test("lintAll, given the project folder, names a source file that does not exist, for the preflight and the oracle alike", () => {
  const root = scratch();
  mkdirSync(path.join(root, "app"), { recursive: true });
  writeFileSync(path.join(root, "app", "page.tsx"), "export default function Page() { return null; }\n");
  const decl = base();
  decl.groups[0].edges[0].origin = { x: 0.1, y: 0.1, w: 0.1, h: 0.1 };
  decl.screens[0].source = ["app/page.tsx", "app/pgae.tsx"];
  assert.deepEqual(lintAll(decl, { root }).declaration, [`${decl.screens[0].id}: names the file app/pgae.tsx and there is no such file`]);
  assert.deepEqual(lintAll(decl).declaration, [], "without a folder to look in, nothing is claimed");
});

test("duplicate pictures: one address and device is one picture, but what is pressed makes a different one", () => {
  const decl = base();
  decl.screens.push({ id: "a2", flowId: "tour", label: "Same", note: "Same.", url: "/a" });
  assert.deepEqual(lintDeclaration(decl), ["a2 and a are both /a, so they are one picture twice"]);
  const pressed = base();
  pressed.screens.push({ id: "a-open", flowId: "tour", label: "Open", note: "Open.", url: "/a", steps: [{ click: "Adjust" }] });
  pressed.screens.push({ id: "a-open-again", flowId: "tour", label: "Open Again", note: "Open.", url: "/a", steps: [{ click: "Adjust" }] });
  assert.deepEqual(lintDeclaration(pressed), ['a-open-again and a-open are both /a after click "Adjust", so they are one picture twice']);
  const phone = base();
  phone.screens.push({ id: "a-phone", flowId: "tour", label: "Phone", note: "Phone.", url: "/a", device: "phone" });
  assert.deepEqual(lintDeclaration(phone), [], "a twin on another device is the same design answered twice, not a duplicate");
  const twice = base();
  twice.screens.push({ id: "a", flowId: "lists", label: "Again", note: "Again.", url: "/elsewhere" });
  assert.match(lintDeclaration(twice)[0], /screen id "a" is declared twice/);
});

test("`under` goes one level: a step under a step is refused, and the fix names the option", () => {
  const decl = base();
  decl.explorations = [
    {
      id: "ov",
      original: "a",
      screens: [
        { id: "o1", under: null, suggests: null },
        { id: "o1-2", under: "o1", suggests: null },
        { id: "o1-3", under: "o1-2", suggests: null },
        { id: "o1-4", under: "o1-3", suggests: null },
        { id: "lost", under: "not-in-this-panel", suggests: null },
        { id: "sug", under: null, suggests: "o1" },
        { id: "sug-2", under: "sug", suggests: null },
      ],
    },
  ];
  const problems = lintDeclaration(decl);
  assert.equal(problems.filter((one) => /itself sits under/.test(one)).length, 2);
  assert.match(problems.find((one) => /"o1-3" sits under/.test(one)), /put "o1-3" under "o1"/);
  assert.match(problems.find((one) => /"o1-4" sits under/.test(one)), /put "o1-4" under "o1"/, "names the root option however deep it is");
  assert.match(problems.find((one) => /"lost"/.test(one)), /not a frame of that panel/);
  /* A suggestion's own steps carry its `suggests` too (graph-layout.ts); a plain step under a suggestion is drawn nowhere. */
  assert.match(problems.find((one) => /"sug-2"/.test(one)), /which is not an option in that panel/);
});

test("a section id is never a screen id, whichever kind of section it is", () => {
  const decl = base();
  decl.groups[1].id = "a";
  decl.explorations = [{ id: "b", original: "a", screens: [] }];
  decl.kinds = [{ id: "c", whatBelongs: "Things" }];
  const problems = lintDeclaration(decl);
  assert.ok(problems.some((one) => /the flow id "a" is also a screen id/.test(one)));
  assert.ok(problems.some((one) => /the exploration id "b" is also a screen id/.test(one)));
  assert.ok(problems.some((one) => /the section id "c" is also a screen id/.test(one)));
});

test("an arrow stays in its flow, and an arrow to nothing is named", () => {
  const decl = base();
  decl.groups[0].edges.push({ from: "b", to: "c", label: "Presses Continue" }, { from: "a", to: "ghost", label: "Presses Continue" });
  const problems = lintDeclaration(decl);
  assert.ok(problems.some((one) => /edge b → c crosses groups: "c" belongs to "lists"/.test(one)));
  assert.ok(problems.some((one) => /edge a → ghost names "ghost", which is no screen on this canvas/.test(one)));
});

test("an edge label follows the one rule the oracle holds, from one shared list", () => {
  assert.ok(EDGE_VERBS.includes("When") && EDGE_VERBS.includes("Presses") && EDGE_VERBS.length === 14);
  assert.deepEqual(checkEdgeLabel("Presses Continue"), []);
  assert.deepEqual(checkEdgeLabel("When no items exist"), []);
  assert.match(checkEdgeLabel("an item")[0], /does not start with an action or "When"/);
  assert.match(checkEdgeLabel("Opens it").join(), /8 characters, outside 12 to 24/);
  assert.match(checkEdgeLabel("")[0], /has no label/);
  const decl = base();
  decl.groups[0].edges[0].label = "an item";
  assert.ok(lintDeclaration(decl).some((one) => /flow "tour": edge a → b: "an item" does not start/.test(one)));
});

test("the copy rules run over the declaration file's own words", () => {
  const decl = base();
  decl.title = "Demo, canvas";
  decl.screens[0].note = "This is simply a note.";
  const problems = lintCopy(decl);
  assert.ok(problems.some((one) => /canvas title is a sentence, not a name/.test(one)));
  assert.ok(problems.some((one) => /says "simply"/.test(one)));
});

test("case, spelling variety and punctuation style are the project's own: none of them is a copy failure", () => {
  const decl = base();
  decl.title = "demo canvas";
  decl.screens[0].label = "Colour settings.";
  decl.screens[0].note = "The page shows the colour picker — and nothing else.";
  assert.deepEqual(lintCopy(decl), []);
});

test("the one-word rule holds the canvas's own words and leaves the product's people words alone", () => {
  const decl = base();
  decl.screens[0].note = "The user opens the screenshot.";
  const problems = lintCopy(decl);
  assert.ok(problems.some((one) => /says "screenshot", and one word one meaning means "frame"/.test(one)));
  assert.ok(!problems.some((one) => /says "user"/.test(one)));
});

test("lintSteps reports every screen whose steps cannot run", () => {
  const screens = [{ id: "ok", steps: [{ click: "A" }] }, { id: "bad", steps: [{ tap: "A" }] }, { id: "none" }];
  const problems = lintSteps(screens);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /bad: steps\[0\] has an unknown step type "tap"/);
});

test("claims: what the app ships decides which are found, which drifted, and which are unknown", () => {
  const locale = flattenLocale({ tasks: { title: "Task details.", saved: "Saved {name}", greet: "Hello %s, you have {{n}} items" }, list: ["Open tasks", "Closed tasks"], n: 4 });
  assert.deepEqual(locale, ["Task details.", "Saved {name}", "Hello %s, you have {{n}} items", "Open tasks", "Closed tasks"]);
  const found = claimFindings({
    claims: [
      { screen: "s1", claim: "Task Details" },
      { screen: "s2", claim: "Open tasks" },
      { screen: "s3", claim: "Saved Blue Mug" },
      { screen: "s4", claim: "Hello Bob, you have 3 items" },
      { screen: "s5", claim: "Jane Doe" },
      { screen: "s6", claim: "From the source" },
      { screen: "s7", claim: "open tasks" },
    ],
    locale,
    source: 'const x = "From the source";',
  });
  assert.deepEqual(found.drift, [
    { screen: "s1", claim: "Task Details", shipped: "Task details." },
    { screen: "s7", claim: "open tasks", shipped: "Open tasks" },
  ]);
  assert.deepEqual(found.unknown, [{ screen: "s5", claim: "Jane Doe" }]);
  assert.equal(found.found, 4);
});

test("a claim the last capture PROVED on the page is found, whatever the locale files say", () => {
  const found = claimFindings({
    claims: [{ screen: "unlink", claim: "Remove Member" }, { screen: "other", claim: "Remove Member" }],
    locale: ["Remove member"],
    source: "",
    proven: new Set(["unlink\u0000Remove Member"]),
  });
  assert.equal(found.found, 1, "the page said it, on that frame");
  assert.deepEqual(found.drift, [{ screen: "other", claim: "Remove Member", shipped: "Remove member" }], "a frame nothing proved is still a finding");
});

test("a short claim is never called drift because a longer string contains it in another case", () => {
  const found = claimFindings({ claims: [{ screen: "s", claim: "Library" }], locale: ["Your library is full"], source: "" });
  assert.deepEqual(found.drift, [], "one word: too likely to be a different use of the word");
  assert.deepEqual(found.unknown, [{ screen: "s", claim: "Library" }]);
});

test("templates stand for anything, and a template with nothing of its own stands for nothing", () => {
  assert.equal(templateMatches("Saved {name}", "Saved Blue Mug"), true);
  assert.equal(templateMatches("Saved {name}", "Loaded Blue Mug"), false);
  assert.equal(templateMatches("{a} {b}", "anything at all"), false);
  assert.equal(templateMatches("No placeholder here", "No placeholder here"), false, "an exact string is found by the exact test, not the template one");
  assert.equal(templateMatches("Hello %s, you have ${count} items", "Hello Bob, you have 3 items"), true);
});

test("collectClaims skips explanation frames, frozen history and wireframes, and reads a string as a list of one", () => {
  const claims = collectClaims([
    { id: "a", expect: ["One", "Two"] },
    { id: "b", expect: "Three" },
    { id: "c", explain: "text", expect: ["Never"] },
    { id: "d", frozen: true, expect: ["Never"] },
    { id: "e" },
    { id: "f", wireframe: true, expect: ["Words on a drawing"] },
  ]);
  assert.deepEqual(claims, [{ screen: "a", claim: "One" }, { screen: "a", claim: "Two" }, { screen: "b", claim: "Three" }]);
});

test("the project's shipped copy: locale files are found, and source is read without the dirs that are never copy", () => {
  const root = scratch();
  mkdirSync(path.join(root, "messages"), { recursive: true });
  mkdirSync(path.join(root, "app"), { recursive: true });
  mkdirSync(path.join(root, "node_modules", "pkg"), { recursive: true });
  mkdirSync(path.join(root, "design-canvas"), { recursive: true });
  writeFileSync(path.join(root, "messages", "en.json"), JSON.stringify({ a: { b: "Shipped words" } }));
  writeFileSync(path.join(root, "messages", "de.json"), JSON.stringify({ a: { b: "Andere Worte" } }));
  writeFileSync(path.join(root, "app", "page.tsx"), "export default () => <p>Literal in source</p>;");
  writeFileSync(path.join(root, "node_modules", "pkg", "index.js"), "module.exports = 'From a package';");
  writeFileSync(path.join(root, "design-canvas", "flows.ts"), "expect: ['Declared claim']");
  const locales = detectLocales(root);
  assert.deepEqual(locales.map((file) => path.relative(root, file)), [path.join("messages", "en.json")]);
  const texts = loadProjectTexts(root, locales);
  assert.deepEqual(texts.locale, ["Shipped words"]);
  assert.ok(texts.source.includes("Literal in source"));
  assert.ok(!texts.source.includes("From a package"), "a package is not the app's copy");
  assert.ok(!texts.source.includes("Declared claim"), "the declaration is not evidence for itself");
  const checked = checkLocaleFiles([locales[0], path.join(root, "messages", "missing.json")]);
  assert.equal(checked.present.length, 1);
  assert.deepEqual(checked.missing, [path.join(root, "messages", "missing.json")]);
});

/* ------------------------------------------------------------------ item 2: the settings, and the round that reads them */

/** Run a piece of module code against the tool folder and report how it ended. */
const runModule = (code) => spawnSync(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8" });
const settingsCode = (dir) =>
  `import { loadSettings, requireAppUrl, settingsEnv } from ${JSON.stringify(path.join(TOOL, "project-settings.mjs"))};
   const s = loadSettings(${JSON.stringify(dir)}, "t");
   console.log(JSON.stringify({ s, env: settingsEnv(s), url: process.argv.includes("need") ? requireAppUrl(s, "t") : null }));`;

test("settings: no file is an empty object, and a tool that needs the address says where to write it and does not guess", () => {
  const canvas = path.join(scratch(), "design-canvas");
  mkdirSync(canvas, { recursive: true });
  const ok = runModule(settingsCode(canvas));
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(ok.stdout).s.appUrl, null);
  const need = spawnSync(process.execPath, ["--input-type=module", "-e", settingsCode(canvas).replace('process.argv.includes("need")', "true")], { encoding: "utf8" });
  assert.equal(need.status, 2);
  assert.match(need.stderr, /does not guess a port \(3000 is usually a neighbour's app\)/);
  assert.match(need.stderr, /"appUrl": "http:\/\/localhost:<this project's dev port>"/);
});

test("settings: paths are read from the project root, the port is read out of the address, and the session becomes the environment", () => {
  const root = scratch();
  const canvas = path.join(root, "design-canvas");
  mkdirSync(canvas, { recursive: true });
  writeFileSync(path.join(canvas, "settings.json"), JSON.stringify({ appUrl: "http://localhost:3042", storageState: "design-canvas/auth-state.json", browserChannel: "chrome", loginRoute: "/welcome", locales: ["messages/en.json"] }));
  const run = runModule(settingsCode(canvas));
  assert.equal(run.status, 0, run.stderr);
  const { s, env } = JSON.parse(run.stdout);
  assert.equal(s.appUrl, "http://localhost:3042");
  assert.equal(s.port, 3042);
  assert.equal(s.storageState, path.join(root, "design-canvas", "auth-state.json"));
  assert.deepEqual(s.locales, [path.join(root, "messages", "en.json")]);
  assert.deepEqual(env, { CANVAS_STORAGE_STATE: path.join(root, "design-canvas", "auth-state.json"), CANVAS_BROWSER_CHANNEL: "chrome", CANVAS_LOGIN_ROUTE: "/welcome" });
  writeFileSync(path.join(canvas, "settings.json"), JSON.stringify({ appUrl: "http://localhost:3042/" }));
  assert.equal(JSON.parse(runModule(settingsCode(canvas)).stdout).s.port, 3042, "the port is read out of the address");
});

test("settings: a typo, a bad value and a disagreement each stop the run with one line", () => {
  const canvas = path.join(scratch(), "design-canvas");
  mkdirSync(canvas, { recursive: true });
  const cases = [
    [{ browserchannel: "chrome" }, /unknown key "browserchannel"/],
    [{ appUrl: "localhost:3042" }, /"appUrl" must start with http/],
    [{ port: 3042 }, /"port" is no longer read; write the address instead: "appUrl": "http:\/\/localhost:3042"/],
    [{ locales: "messages/en.json" }, /"locales" must be a list/],
    [{ flagPct: 500 }, /"flagPct" must be a number from 0 to 100/],
  ];
  for (const [value, pattern] of cases) {
    writeFileSync(path.join(canvas, "settings.json"), JSON.stringify(value));
    const run = runModule(settingsCode(canvas));
    assert.equal(run.status, 2, JSON.stringify(value));
    assert.match(run.stderr, pattern);
  }
  writeFileSync(path.join(canvas, "settings.json"), "{ not json");
  assert.match(runModule(settingsCode(canvas)).stderr, /is not valid JSON/);
});

test("round.mjs with no settings stops before it touches anything: exit 2, the address is the missing fact", () => {
  const run = spawnSync(process.execPath, [path.join(TOOL, "round.mjs"), "--canvas", "library"], { encoding: "utf8" });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /round: there is no design-canvas\/settings\.json, and this tool does not guess a port/);
  assert.equal(run.stderr.trim().split("\n").at(-1), "ROUND FAIL: the run could not start", "the verdict is the last line, even here");
  const slug = spawnSync(process.execPath, [path.join(TOOL, "round.mjs"), "--canvas", "../x"], { encoding: "utf8" });
  assert.equal(slug.status, 2);
  assert.match(slug.stderr, /a canvas slug is lowercase letters, digits and dashes only/);
});

/* ------------------------------------------------------------------ item 5: the visual change report */

/** An RGBA picture of one colour, `w` by `h`. */
const solid = (w, h, [r, g, b, a = 255]) => {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < out.length; i += 4) out.set([r, g, b, a], i);
  return out;
};
/** Paint a rectangle onto a picture. */
const paint = (pixels, w, rect, [r, g, b, a = 255]) => {
  for (let y = rect.y; y < rect.y + rect.h; y += 1) for (let x = rect.x; x < rect.x + rect.w; x += 1) pixels.set([r, g, b, a], (y * w + x) * 4);
  return pixels;
};

test("compareRgba counts changed pixels, those outside the commented rectangles, and the box round all of them", () => {
  const w = 100;
  const h = 100;
  const before = solid(w, h, [255, 255, 255]);
  const after = paint(solid(w, h, [255, 255, 255]), w, { x: 10, y: 10, w: 10, h: 10 }, [0, 0, 0]);
  paint(after, w, { x: 60, y: 70, w: 5, h: 4 }, [200, 0, 0]);
  const both = compareRgba(before, after, w, h, [], 32);
  assert.equal(both.changed, 120);
  assert.equal(both.outside, 120, "with no comment, everything is outside");
  assert.deepEqual(both.bbox, { x: 10, y: 10, w: 55, h: 64 });
  const covered = compareRgba(before, after, w, h, [{ x: 5, y: 5, w: 20, h: 20 }], 32);
  assert.equal(covered.changed, 120);
  assert.equal(covered.outside, 20, "only the change beside the comment is unrelated to it");
  const identical = compareRgba(before, solid(w, h, [255, 255, 255]), w, h, [], 32);
  assert.deepEqual([identical.changed, identical.outside, identical.bbox], [0, 0, null]);
  const noise = compareRgba(before, solid(w, h, [250, 252, 255]), w, h, [], 32);
  assert.equal(noise.changed, 0, "encoder noise below the tolerance is not a change");
});

test("rows one picture has and the other lacks count as changed", () => {
  const w = 10;
  const a = solid(w, 10, [255, 255, 255]);
  const b = new Uint8ClampedArray(w * 10 * 4);
  b.set(solid(w, 5, [255, 255, 255]), 0);
  const result = compareRgba(a, b, w, 10, [], 32);
  assert.equal(result.changed, 50);
  assert.deepEqual(result.bbox, { x: 0, y: 5, w: 10, h: 5 });
});

test("a comment's rectangle is widened before anything beside it is called unrelated", () => {
  const rect = regionRect({ xPct: 10, yPct: 20, wPct: 30, hPct: 10 }, 1000, 2000, { share: 0.02, px: 12 });
  assert.deepEqual(rect, { x: 100 - 32, y: 400 - 52, w: 300 + 64, h: 200 + 104 });
});

test("judge: identical, changed where it was commented, changed where nobody asked, and size", () => {
  assert.deepEqual(judge({ changedPct: 0, outsidePct: 0, hasComments: false, sizeChanged: false }), { status: "identical", flag: null });
  assert.deepEqual(judge({ changedPct: 4, outsidePct: 0.1, hasComments: true, sizeChanged: false }), { status: "changed", flag: null });
  assert.equal(judge({ changedPct: 4, outsidePct: 2, hasComments: true, sizeChanged: false }).flag, "changed outside the commented region");
  assert.equal(judge({ changedPct: 4, outsidePct: 4, hasComments: false, sizeChanged: false }).flag, "changed and nothing is commented here");
  assert.equal(judge({ changedPct: 0.1, outsidePct: 0.1, hasComments: false, sizeChanged: false }).flag, null, "a hair of change is not a flag");
  assert.equal(judge({ changedPct: 0.1, outsidePct: 0.1, hasComments: false, sizeChanged: true }).flag, "changed and nothing is commented here", "a frame that changed size always is");
  assert.equal(FLAG_PCT, 0.5);
});

/* ------------------------------------------------------------------ item 2: the contact sheet */

test("the report calls the same bytes identical without decoding them, and still decodes a picture that differs", async () => {
  const dir = scratch();
  let decoded = 0;
  /* A stand-in page: any decode is counted and refused, so a pair that reached the browser shows up as "unreadable". */
  const context = {
    newPage: async () => ({
      goto: async () => undefined,
      addScriptTag: async () => undefined,
      evaluate: async () => {
        decoded += 1;
        throw new Error("no browser here");
      },
      close: async () => undefined,
    }),
  };
  const same = Buffer.from("the same picture");
  const inputs = new Map([
    ["kept", { before: same, after: Buffer.from(same), size: { w: 400, h: 300 } }],
    ["moved", { before: same, after: Buffer.from("another picture"), size: { w: 400, h: 300 } }],
  ]);
  const report = await reportVisualChange({ context, inputs, comments: [], outDir: dir, canvasSlug: "t", log: () => undefined });
  const by = Object.fromEntries(report.map((frame) => [frame.id, frame]));
  assert.equal(by.kept.status, "identical");
  assert.equal(by.kept.changedPct, 0);
  assert.deepEqual(by.kept.after, { w: 400, h: 300 });
  assert.equal(by.moved.status, "unreadable", "a different picture still goes to the browser");
  assert.equal(decoded, 1);
});

test("a picture taller than a row is cropped around what changed, and kept whole when it fits", () => {
  assert.deepEqual(cropWindow({ w: 1120, h: 900 }), { scale: 0.5, top: 0, height: 450, cropped: false });
  const tall = cropWindow({ w: 1120, h: 6000, bbox: { x: 0, y: 4000, w: 100, h: 200 } });
  assert.equal(tall.cropped, true);
  assert.equal(tall.height, 760);
  assert.equal(tall.top, Math.round((4100 * 0.5) - 380), "centred on the change");
  assert.ok(tall.fromPx < 4000 && tall.toPx > 4200);
  const top = cropWindow({ w: 1120, h: 6000, bbox: { x: 0, y: 0, w: 10, h: 10 } });
  assert.equal(top.top, 0, "clamped to the top");
  const bottom = cropWindow({ w: 1120, h: 6000, bbox: { x: 0, y: 5990, w: 10, h: 10 } });
  assert.equal(bottom.top, 3000 - 760, "clamped to the bottom");
  /* A change at the top and a few pixels near the bottom: a box down the page, whose middle holds nothing. */
  const spread = cropWindow({ w: 1440, h: 2783, bbox: { x: 333, y: 331, w: 944, h: 2241 }, focusY: 340 });
  assert.ok(spread.fromPx <= 331 && spread.toPx > 360, `the window holds the change at the top: ${spread.fromPx} to ${spread.toPx}`);
  assert.deepEqual(cropWindow({ w: 1120, h: 6000, bbox: { x: 0, y: 4000, w: 100, h: 200 }, focusY: 4010 }), tall, "a box that fits is centred as it was");
});

test("focusY is the row by which half the changed pixels are counted, and always holds a change", () => {
  const w = 20;
  const h = 300;
  const after = paint(solid(w, h, [255, 255, 255]), w, { x: 0, y: 10, w: 20, h: 5 }, [0, 0, 0]);
  paint(after, w, { x: 0, y: 290, w: 2, h: 2 }, [0, 0, 0]);
  const result = compareRgba(solid(w, h, [255, 255, 255]), after, w, h, [], 32);
  assert.deepEqual(result.bbox, { x: 0, y: 10, w: 20, h: 282 });
  assert.ok(result.focusY >= 10 && result.focusY < 15, `the row is in the band at the top: ${result.focusY}`);
  assert.equal(compareRgba(solid(w, h, [255, 255, 255]), solid(w, h, [255, 255, 255]), w, h, [], 32).focusY, null);
});

test("the sheet names each frame, its change, its comments and its flag, and lists what was identical", () => {
  const html = sheetHtml({
    title: "Round one",
    canvas: "library",
    frames: [
      { id: "home", status: "changed", changedPct: 2.37, commentIds: ["c1"], flag: "changed outside the commented region", bbox: { x: 10, y: 10, w: 100, h: 50 }, before: { w: 1440, h: 900 }, after: { w: 1440, h: 900 }, beforeSrc: "before/home.webp" },
      { id: "fresh", status: "new", changedPct: null, commentIds: [], flag: null, bbox: null, after: { w: 1440, h: 900 } },
    ],
    identical: ["products"],
    afterSrc: (frame) => `../shots/${frame.id}.webp`,
  });
  assert.match(html, /<h2>home<\/h2>/);
  assert.match(html, /2\.37% changed/);
  assert.match(html, /comments c1/);
  assert.match(html, /<b>changed outside the commented region<\/b>/);
  assert.match(html, /before\/home\.webp/);
  assert.match(html, /\.\.\/shots\/fresh\.webp/);
  assert.match(html, /New frame/);
  assert.match(html, /Identical to the previous shot, not drawn: products/);
  assert.ok(!html.includes("<figcaption>Before</figcaption>") || html.split("<figcaption>Before</figcaption>").length === 2, "a new frame has no before");
  assert.ok(!/[A-Z]{4,}/.test(html.replace(/<!doctype html>|DOCTYPE/gi, "").replace(/<style>[\s\S]*<\/style>/, "").replace(/<[^>]+>/g, " ").replace(/\b(?:UTF|PNG|CSS)\b/g, "")), "no all-caps words in the copy");
  assert.equal(sheetHtml({ title: "t", canvas: "c", frames: [], identical: [], afterSrc: () => "" }).includes("Nothing changed in this round."), true);
});

/* ------------------------------------------------------------------ in a browser */

const project = process.env.CANVAS_TEST_PROJECT;
let chromium = null;
if (project) {
  try {
    chromium = createRequire(path.join(project, "package.json"))("playwright").chromium;
  } catch {
    chromium = null;
  }
}
const inBrowser = chromium ? {} : { skip: "set CANVAS_TEST_PROJECT to a project that has playwright to run the browser tests" };

test("in a browser: on a tall frame changed at the top and a little at the bottom, the sheet shows the change at the top", inBrowser, async () => {
  const dir = scratch();
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 400, height: 3000 } });
    const shoot = async (html) => {
      const page = await context.newPage();
      await page.setContent(`<body style="margin:0">${html}</body>`);
      const cdp = await context.newCDPSession(page);
      const { data } = await cdp.send("Page.captureScreenshot", { format: "webp", quality: 92 });
      await page.close();
      return Buffer.from(data, "base64");
    };
    const box = (y, w, h, color) => `<div style="position:absolute;left:20px;top:${y}px;width:${w}px;height:${h}px;background:${color}"></div>`;
    const before = await shoot(box(100, 300, 40, "#000"));
    const after = await shoot(box(100, 300, 40, "#c00") + box(2900, 4, 4, "#c00"));
    const report = await reportVisualChange({ context, inputs: new Map([["tall", { before, after, size: { w: 400, h: 3000 } }]]), comments: [], outDir: dir, canvasSlug: "t", log: () => undefined });
    assert.ok(report[0].bbox.h > 2700, "the box spans the page");
    const saved = JSON.parse(readFileSync(path.join(dir, "delta.json"), "utf8"));
    const shots = path.join(dir, "shots");
    mkdirSync(shots, { recursive: true });
    writeFileSync(path.join(shots, "tall.webp"), after);
    const sheet = await buildContactSheet({ chromium, deltaDir: dir, delta: saved, shotsDir: shots, canvas: "t", title: "Round" });
    const shown = /showing (\d+) to (\d+) px of 3000/.exec(readFileSync(sheet.htmlFile, "utf8"));
    assert.ok(shown, "the frame is cropped");
    assert.ok(Number(shown[1]) <= 100 && Number(shown[2]) >= 140, `the window holds the red band at 100 to 140: ${shown[0]}`);
  } finally {
    await browser.close();
  }
});

test("in a browser: steps press their way to the state, in order, and report what they could not do", inBrowser, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(`<body>
      <div role="dialog" aria-label="Welcome"><p>Welcome to Scratch</p><button id="welcome-close">Got it</button></div>
      <button id="open">Open settings</button><button class="twin">Twin</button><button class="twin">Twin</button>
      <a href="#x">Products</a>
      <label>Item name <input id="name"></label><input placeholder="Search here">
      <div id="out"></div>
      <script>
        document.getElementById("welcome-close").onclick = () => document.querySelector('[role=dialog]').remove();
        document.getElementById("open").onclick = () => { document.getElementById("out").innerHTML = '<div role="dialog" aria-label="Settings"><h2>App settings</h2><button>Close dialog</button></div>'; };
        document.getElementById("name").onkeydown = (e) => { if (e.key === "Enter") document.getElementById("out").insertAdjacentHTML("beforeend", "<p>Saved " + e.target.value + "</p>"); };
      </script></body>`);
    await runSteps(page, parseSteps([{ closeWelcome: "Got it" }, { click: "Open settings" }, { waitText: "App settings" }, { fill: "Item name", with: "Blue Mug" }, { press: "Enter", on: "Item name" }]), {});
    assert.equal(await page.locator('[role=dialog][aria-label="Welcome"]').count(), 0, "the welcome dialog was closed");
    assert.match(await page.locator("#out").innerText(), /App settings/);
    assert.match(await page.locator("#out").innerText(), /Saved Blue Mug/);
    /* closeWelcome is a condition: with nothing showing it is skipped without a word. */
    await runSteps(page, [{ closeWelcome: "Got it" }], {});
    /* A field is found by its placeholder too. */
    await runSteps(page, [{ fill: "Search here", with: "mugs" }], {});
    assert.equal(await page.locator('input[placeholder="Search here"]').inputValue(), "mugs");
    /* Several controls with one name are an error until nth or within says which. */
    await assert.rejects(runSteps(page, [{ click: "Twin" }], {}), /step 1 \(click "Twin"\): 2 visible controls are named "Twin": add nth \(from 0\) or within/);
    await runSteps(page, [{ click: "Twin", nth: 1 }], {});
    /* A control that is not there says what is. */
    await assert.rejects(runSteps(page, [{ click: "Nonexistent" }], {}), /step 1 \(click "Nonexistent"\): no visible control named "Nonexistent"\. What is showing: .*"Open settings"/);
    await assert.rejects(runSteps(page, [{ waitText: "never on this page" }], {}), /never appeared on the open surface/);
    await assert.rejects(runSteps(page, [{ closeWelcome: true }], {}), /closeWelcome: true performs the click steps of design-canvas\/dismiss\.json and this project has none/);
  } finally {
    await browser.close();
  }
});

test("in a browser: the report decodes two real pictures and says what changed, where, and whether it was asked for", inBrowser, async () => {
  const dir = scratch();
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 400, height: 300 } });
    const shoot = async (html) => {
      const page = await context.newPage();
      await page.setContent(`<body style="margin:0">${html}</body>`);
      const cdp = await context.newCDPSession(page);
      const { data } = await cdp.send("Page.captureScreenshot", { format: "webp", quality: 92 });
      await page.close();
      return Buffer.from(data, "base64");
    };
    const box = (x, y, color) => `<div style="position:absolute;left:${x}px;top:${y}px;width:120px;height:60px;background:${color}"></div>`;
    const plain = await shoot(box(20, 20, "#000"));
    const inputs = new Map([
      ["same", { before: plain, after: await shoot(box(20, 20, "#000")), size: { w: 400, h: 300 } }],
      ["asked", { before: plain, after: await shoot(box(20, 20, "#c00")), size: { w: 400, h: 300 } }],
      ["unasked", { before: plain, after: await shoot(box(20, 20, "#000") + box(200, 200, "#27c")), size: { w: 400, h: 300 } }],
      ["fresh", { before: null, after: plain, size: { w: 400, h: 300 } }],
    ]);
    const comments = [
      { id: "c1", screenId: "asked", region: { xPct: 4, yPct: 6, wPct: 32, hPct: 25 } },
      { id: "c2", screenId: "unasked", region: { xPct: 4, yPct: 6, wPct: 32, hPct: 25 } },
    ];
    const lines = [];
    const report = await reportVisualChange({ context, inputs, comments, outDir: dir, canvasSlug: "t", log: (line) => lines.push(line) });
    const by = Object.fromEntries(report.map((frame) => [frame.id, frame]));
    assert.equal(by.same.status, "identical");
    assert.equal(by.fresh.status, "new");
    assert.deepEqual(by.fresh.after, { w: 400, h: 300 });
    assert.equal(by.asked.status, "changed");
    assert.equal(by.asked.flag, null, "the change is inside what c1 pointed at");
    assert.ok(by.asked.changedPct > 5 && by.asked.outsidePct < 0.5);
    assert.equal(by.unasked.flag, "changed outside the commented region", "c2 pointed at the black box and the blue one is new");
    assert.ok(by.unasked.outsidePct > 5);
    assert.ok(by.unasked.bbox.x >= 0 && by.unasked.bbox.w > 100);
    assert.ok(lines.join("\n").includes("1 FLAGGED for changing where nobody asked: unasked"));
    const saved = JSON.parse(readFileSync(path.join(dir, "delta.json"), "utf8"));
    assert.equal(saved.frames.length, 4);
    assert.ok(readFileSync(path.join(dir, "before", "asked.webp")).length > 0, "the picture that was replaced is kept, for the sheet");
    /* The sheet, built from that same report. */
    const shots = path.join(dir, "shots");
    mkdirSync(shots, { recursive: true });
    for (const [id, { after }] of inputs) writeFileSync(path.join(shots, `${id}.webp`), after);
    const sheet = await buildContactSheet({ chromium, deltaDir: dir, delta: saved, shotsDir: shots, canvas: "t", title: "Round" });
    assert.equal(sheet.drawn, 3);
    assert.equal(sheet.identical, 1);
    assert.deepEqual(sheet.missing, []);
    assert.ok(readFileSync(sheet.pngFile).length > 1000);
  } finally {
    await browser.close();
  }
});

test("settings: one run's address, session, browser and login route come from the flag, then the environment, then the file", async () => {
  const { runSettings } = await import(path.join(TOOL, "project-settings.mjs"));
  const file = { appUrl: "http://localhost:3042", storageState: "/p/auth.json", browserChannel: "chrome", loginRoute: "/welcome" };
  assert.deepEqual(runSettings([], file), file);
  assert.equal(runSettings(["--url", "http://127.0.0.1:9/"], file).appUrl, "http://127.0.0.1:9");
  assert.equal(runSettings([], { ...file, appUrl: null }).appUrl, null);
  const saved = process.env.CANVAS_BROWSER_CHANNEL;
  process.env.CANVAS_BROWSER_CHANNEL = "msedge";
  try {
    assert.equal(runSettings([], file).browserChannel, "msedge");
    assert.equal(runSettings(["--browser-channel", "chromium"], file).browserChannel, "chromium");
  } finally {
    if (saved === undefined) delete process.env.CANVAS_BROWSER_CHANNEL;
    else process.env.CANVAS_BROWSER_CHANNEL = saved;
  }
});

/* ------------------------------------------------------------------ a retried round keeps the pictures it started from */

test("in a browser: a retried round compares with the pictures it started from, never with its own first attempt", inBrowser, async () => {
  const dir = scratch();
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 400, height: 300 } });
    const shoot = async (color) => {
      const page = await context.newPage();
      await page.setContent(`<body style="margin:0"><div style="position:absolute;left:20px;top:20px;width:120px;height:60px;background:${color}"></div></body>`);
      const cdp = await context.newCDPSession(page);
      const { data } = await cdp.send("Page.captureScreenshot", { format: "webp", quality: 92 });
      await page.close();
      return Buffer.from(data, "base64");
    };
    const size = { w: 400, h: 300 };
    const [original, first, second, elsewhere] = [await shoot("#000"), await shoot("#c00"), await shoot("#27c"), await shoot("#2a2")];
    const run = (inputs) => reportVisualChange({ context, inputs: new Map(inputs), comments: [], outDir: dir, canvasSlug: "t", log: () => undefined, keepOriginals: true });

    /* The first attempt: one frame changed, one is new, one is untouched. */
    await run([
      ["edited", { before: original, after: first, size }],
      ["added", { before: null, after: original, size }],
      ["steady", { before: original, after: original, size }],
      ["moved", { before: original, after: first, size }],
    ]);
    /* The retry: each "before" is now what the first attempt wrote, except "moved", which another capture changed in between. */
    const report = await run([
      ["edited", { before: first, after: second, size }],
      ["added", { before: original, after: second, size }],
      ["moved", { before: elsewhere, after: second, size }],
    ]);
    const by = Object.fromEntries(report.map((frame) => [frame.id, frame]));
    assert.equal(by.edited.status, "changed");
    assert.equal(by.edited.sinceFirstAttempt, true);
    assert.ok(readFileSync(path.join(dir, "before", "edited.webp")).equals(original), "the before is the picture the round started from");
    assert.equal(by.added.status, "new", "a frame new to the round stays new on its retry");
    assert.equal(by.moved.sinceFirstAttempt, undefined, "a picture changed in between is compared as it is");
    assert.ok(readFileSync(path.join(dir, "before", "moved.webp")).equals(elsewhere));
    const saved = JSON.parse(readFileSync(path.join(dir, "delta.json"), "utf8"));
    assert.deepEqual(saved.frames.map((frame) => frame.id).sort(), ["added", "edited", "moved", "steady"], "the first attempt's other frames stay on the round's record");

    /* Without the flag (a capture on its own) the report compares with the picture it replaced, as it always did. */
    const plain = scratch();
    const alone = await reportVisualChange({ context, inputs: new Map([["edited", { before: first, after: second, size }]]), comments: [], outDir: plain, canvasSlug: "t", log: () => undefined });
    assert.equal(alone[0].sinceFirstAttempt, undefined);
    assert.ok(readFileSync(path.join(plain, "before", "edited.webp")).equals(first));
  } finally {
    await browser.close();
  }
});

/* ------------------------------------------------------------------ every pinned state exists in the states file */

test("a pinned state the states file does not have is a declaration problem, and names built in code still count", () => {
  const statesFile = [
    `const STATES: Record<string, () => void> = {`,
    `  "menu-open": () => undefined,`,
    `  plain: () => undefined,`,
    `  ...Object.fromEntries(KINDS.map((kind) => [\`failed-\${kind}\`, () => undefined])),`,
    `};`,
  ].join("\n");
  const screens = [
    { id: "a", state: "menu-open" },
    { id: "b", state: "plain" },
    { id: "c", state: "failed-upload" },
    { id: "d", state: "renamed-away" },
    { id: "e", state: "gone-for-good", frozen: true },
    { id: "f" },
  ];
  const found = unknownStateProblems(screens, [statesFile]);
  assert.equal(found.length, 1, found.join("\n"));
  assert.match(found[0], /^d: pins the state "renamed-away", which design-canvas\/project\/states\.ts does not have/);
  /* A split states file: a name in a file it imports counts. */
  assert.deepEqual(unknownStateProblems([{ id: "g", state: "from-elsewhere" }], [statesFile, `export const MORE = { "from-elsewhere": () => undefined };`]), []);
  /* No states file at all: every pinned frame says so. */
  assert.match(unknownStateProblems([{ id: "h", state: "any" }], null)[0], /^h: pins the state "any" and this project has no design-canvas\/project\/states\.ts/);
  assert.deepEqual(unknownStateProblems([{ id: "i" }], null), [], "nothing pinned, nothing to say");
  assert.deepEqual(stateNames(["const s = `plain-${x}`;"]).prefixes, ["plain-"]);
});

/* ------------------------------------------------------------------ coverage: what the declared screens reach and no frame shows */

test("coverage: dialogs, sheets and menus the declared screens render, and addresses they link to, that no frame shows", () => {
  const root = scratch();
  const put = (rel, text) => {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), text);
  };
  put("app/list/page.tsx", [
    `import { Dialog } from "some-ui-package";`,
    `import { DeleteItemDialog } from "../../components/delete-item-dialog";`,
    `import { RowMenu } from "../../components/row-menu";`,
    `import { Sheet } from "../../components/icons";`,
    `import { DialogShell } from "../../components/dialog-shell";`,
    `import { FilterSheet } from "../../components/filter-sheet";`,
    `import Link from "next/link";`,
    `export default function Page({ router, id, name }) {`,
    `  const clean = name.replace("/", "-");`,
    `  return (<main>`,
    `    <Dialog /><DeleteItemDialog /><RowMenu /><Sheet /><DialogShell><p>x</p></DialogShell><FilterSheet /><LocalMenu />`,
    `    <Link href="/list/archived">Archived</Link><Link href={\`/items/\${id}/edit\`}>Edit</Link><Link href="/list">List</Link>`,
    `    <a href="/api/export">Export</a><a href="/logo.svg">Logo</a><a href="//cdn.example.com/x">x</a>`,
    `    <button onClick={() => router.push(withBase("/settings/profile"))}>Profile</button>`,
    `  </main>);`,
    `}`,
    `function LocalMenu() { return <ul />; }`,
  ].join("\n"));
  put("components/delete-item-dialog.tsx", `export function DeleteItemDialog() {\n  return <div role="dialog">Delete</div>;\n}\n`);
  put("components/row-menu.tsx", `export function RowMenu() {\n  return <ul role="menu" />;\n}\n`);
  put("components/filter-sheet.tsx", `export function FilterSheet() {\n  return <aside />;\n}\n`);
  put("components/icons.ts", `export { Sheet } from "some-icon-package";\n`);
  put("components/dialog-shell.tsx", `export function DialogShell({ children }) {\n  return <div role="dialog">{children}</div>;\n}\n`);
  const screens = [{ id: "list", route: "/list", source: ["app/list/page.tsx"] }];
  const declared = { routes: ["/list", "/items/42/edit"], sources: ["app/list/page.tsx", "components/filter-sheet.tsx"] };
  const found = coverageGaps({ root, screens, declared });
  assert.deepEqual(found.surfaces, [
    { name: "DeleteItemDialog", kind: "dialog", file: "components/delete-item-dialog.tsx" },
    { name: "RowMenu", kind: "menu", file: "components/row-menu.tsx" },
  ], "a package primitive, an icon re-export, a bare kind name, a shell, and a surface in a file a frame lists are left out");
  assert.deepEqual(found.routes, [
    { route: "/list/archived", from: "app/list/page.tsx" },
    { route: "/settings/profile", from: "app/list/page.tsx" },
  ], "an API, a file, another host, a string's own replace and a declared address (a built segment included) are left out");
  const note = coverageNote(found);
  assert.match(note, /^Reachable but not on the canvas: dialog DeleteItemDialog \(components\/delete-item-dialog\.tsx\), menu RowMenu \(components\/row-menu\.tsx\); routes \/list\/archived \(linked from app\/list\/page\.tsx\), \/settings\/profile \(linked from app\/list\/page\.tsx\)\./);
  assert.equal(coverageNote({ surfaces: [], routes: [] }), null, "nothing reached and undeclared, nothing said");
  /* A part rendered from many files is a shared part, not one flow's surface. */
  for (let at = 0; at < SHARED_SURFACE_FILES + 1; at += 1) put(`app/p${at}.tsx`, `import { RowMenu } from "../components/row-menu";\nexport default function P() {\n  return <RowMenu />;\n}\n`);
  const many = coverageGaps({ root, screens: Array.from({ length: SHARED_SURFACE_FILES + 1 }, (_, at) => ({ id: `p${at}`, source: [`app/p${at}.tsx`] })), declared: { routes: [], sources: [] } });
  assert.deepEqual(many.surfaces, []);
});

/* ------------------------------------------------------------------ what an option no longer shows of today's screen */

test("removed controls: per option, what today's screen shows that the option no longer does, by its recorded controls", () => {
  const explorations = [
    {
      id: "layout",
      original: "list",
      screens: [
        { id: "cards", redesigns: "list" },
        { id: "cards-empty", under: "cards", redesigns: "list-empty" },
        { id: "fresh", redesigns: null },
        { id: "table", redesigns: "list" },
      ],
    },
  ];
  const shots = [
    { screenId: "list", controls: ["Sort by date", "Export", "New Trip", "Trips"] },
    { screenId: "list-empty", controls: ["New Trip", "No trips yet"] },
    { screenId: "cards", controls: ["new trip", "Trips", "Grid view"] },
    { screenId: "cards-empty" },
    { screenId: "table", controls: ["Sort by date", "Export", "New  Trip", "Trips"] },
  ];
  const list = removedControls({ explorations, shots });
  assert.deepEqual(list, [
    { option: "cards", frame: "cards", today: "list", removed: ["Sort by date", "Export"] },
    { option: "cards", frame: "cards-empty", today: "list-empty", removed: null },
    { option: "table", frame: "table", today: "list", removed: [] },
  ]);
  assert.deepEqual(removedLines(list), [
    "what each option no longer shows of today's screen (its controls and labels):",
    `  cards against list: "Sort by date", "Export"`,
    "  cards, cards-empty against list-empty: not compared yet, a picture has no list of its controls (it is recorded at its next capture)",
    "  table against list: nothing removed",
  ]);
  /* Only the frames a run photographed, or whose today's screen it photographed. */
  assert.deepEqual(removedControls({ explorations, shots, ids: new Set(["table"]) }).map((one) => one.frame), ["table"]);
  assert.deepEqual(removedControls({ explorations, shots, ids: new Set(["list"]) }).map((one) => one.frame), ["cards", "table"]);
  assert.deepEqual(removedLines([]), []);
});

test("in a browser: the controls a page records are its visible buttons, links, tabs, fields, labels, headings and short label lines", inBrowser, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(`<main><h1>Trips</h1><button>New   Trip</button><button aria-label="Close"><svg width="10" height="10"></svg></button>
      <a href="/x">All trips</a><a>Not a link</a><div role="tab">Upcoming</div><input placeholder="Search trips"><label>Notes <textarea></textarea></label>
      <button style="display:none">Hidden</button><button style="visibility:hidden">Invisible</button>
      <p>A sentence of prose is far too long to be a label on any screen at all</p><p>Short label</p><p>12 trips</p><p>Sep 18, 2026</p>
      <table><tr><th>Destination</th></tr><tr><td>Lisbon</td></tr></table></main>`);
    const controls = await page.evaluate(CONTROLS);
    assert.deepEqual([...controls].sort(), ["All trips", "Close", "Destination", "Lisbon", "New Trip", "Notes", "Search trips", "Short label", "Trips", "Upcoming"]);
    for (const absent of ["Hidden", "Invisible", "New Trip All tripsNot a link", "A sentence of prose is far too long to be a label on any screen at all", "12 trips", "Sep 18, 2026"])
      assert.ok(!controls.includes(absent), absent);
  } finally {
    await browser.close();
  }
});
