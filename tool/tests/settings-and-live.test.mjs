/**
 * Tests for two promises that keep a mechanic off the reviewer's mind:
 *
 *   1. EVERY TOOL READS `design-canvas/settings.json`, so none defaults to `localhost:3000` when run on its own (that port is
 *      often another project's dev server), and a
 *      tool that edits the review finds it from any directory.
 *   2. THE ORACLE'S LIVE OPEN PASS VISITS ONLY WHAT CHANGED (`live-pass.mjs`), because every visit asks the reviewer's dev server
 *      to compile a route, and its memory grows with every one.
 *
 *   node --test tool/tests/settings-and-live.test.mjs
 *
 * The tools are copied into a throwaway `design-canvas/` folder and run there, with a small http server standing in for the app
 * so the test can see which address a tool really asked. The tests for `check-canvas.mjs` and `capture.mjs`, which import
 * Playwright at load, need a project that has it:
 *
 *   CANVAS_TEST_PROJECT=/path/to/project node --test tool/tests/settings-and-live.test.mjs
 *
 * NOT INSTALLED into a project: the installer copies only the files it lists.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

import { chooseLive, describeLive, markProven, markUnproven, readUnproven, unprovenFile } from "../live-pass.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOL = path.join(HERE, "..");
const PROJECT = process.env.CANVAS_TEST_PROJECT;
const made = [];
const scratch = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "canvas-settings-test-"));
  made.push(dir);
  return dir;
};
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});
const needsProject = (name, run) => (PROJECT ? test(name, run) : test(name, { skip: "set CANVAS_TEST_PROJECT to a project that has playwright to run this test" }, run));

/** A project folder with the tools and the core copied into `design-canvas/`, and (given a project that has it) its node_modules. */
function project(settings) {
  const root = scratch();
  const canvas = path.join(root, "design-canvas");
  mkdirSync(canvas, { recursive: true });
  for (const file of readdirSync(TOOL)) if (file.endsWith(".mjs")) copyFileSync(path.join(TOOL, file), path.join(canvas, file));
  cpSync(path.join(TOOL, "..", "core"), path.join(canvas, "core"), { recursive: true, filter: (source) => !source.includes("__tests__") });
  if (PROJECT) symlinkSync(path.join(PROJECT, "node_modules"), path.join(root, "node_modules"));
  if (settings !== undefined) writeFileSync(path.join(canvas, "settings.json"), JSON.stringify(settings));
  return { root, canvas };
}

/** Run a tool and collect what it said. Async on purpose: the stand-in app below lives in this process. */
function run(file, args, { cwd, env = {} } = {}) {
  return new Promise((resolve) => {
    /* The machine's own CANVAS_* variables are removed first: an ambient one would beat the file under test. (An EMPTY one
       beats it too, on purpose: `CANVAS_BROWSER_CHANNEL=` is how one run asks for the bundled browser against a settings file
       that names Chrome.) */
    const base = { ...process.env };
    for (const key of Object.keys(base)) if (key.startsWith("CANVAS_")) delete base[key];
    const child = spawn(process.execPath, [file, ...args], { cwd, env: { ...base, ...env } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    setTimeout(() => child.kill("SIGKILL"), 60_000).unref();
  });
}

/** A stand-in for the app's dev server: records every request path, answers comments with an empty list and the rest with 404. */
async function standIn() {
  const seen = [];
  const server = http.createServer((request, response) => {
    seen.push(request.url);
    if (request.url.startsWith("/api/design-canvas/comments")) {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ comments: [] }));
    } else {
      response.statusCode = 404;
      response.end("not found");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { seen, port: server.address().port, close: () => new Promise((resolve) => server.close(resolve)) };
}

/* ------------------------------------------------------------------ 1. no tool guesses a port */

test("drain with no settings and no --url stops, names the settings file, and does not guess port 3000", async () => {
  const { root } = project();
  const out = await run(path.join(root, "design-canvas", "drain.mjs"), ["--canvas", "main", "--list"], { cwd: root });
  assert.equal(out.code, 2);
  assert.match(out.stderr, /design-canvas\/settings\.json/);
  assert.match(out.stderr, /does not guess a port/);
  assert.doesNotMatch(out.stderr + out.stdout, /localhost:3000\b(?!\))/, "it never says it tried 3000");
});

test("drain asks the address settings.json names, and --url still overrides it for one run", async () => {
  const app = await standIn();
  try {
    const { root } = project({ appUrl: `http://localhost:${app.port}` });
    const out = await run(path.join(root, "design-canvas", "drain.mjs"), ["--canvas", "main", "--list"], { cwd: root });
    assert.equal(out.code, 0, out.stderr);
    assert.ok(app.seen.some((one) => one.startsWith("/api/design-canvas/comments?canvas=main")), app.seen.join(" "));

    const away = project({ appUrl: "http://127.0.0.1:1" });
    const overridden = await run(path.join(away.root, "design-canvas", "drain.mjs"), ["--canvas", "main", "--list", "--url", `http://127.0.0.1:${app.port}`], { cwd: away.root });
    assert.equal(overridden.code, 0, overridden.stderr);
  } finally {
    await app.close();
  }
});

test("drain --list prints every open comment whole: its kind, all of its note, and the earlier rounds of a reopened one", async () => {
  const long = `${"The cards need more room between them, and ".repeat(4)}the last line says what to do.\nA second line of the same note`;
  const comments = [
    { id: "c1", screenId: "home", note: long, consumedAt: null },
    {
      id: "c2",
      screenId: "settings",
      note: "Still says Alerts, rename it",
      consumedAt: null,
      history: [
        { note: "Rename Alerts to Notifications", at: "2026-01-02T10:00:00.000Z" },
        { note: "Is this the final name?", at: "2026-01-03T11:30:00.000Z", answer: "Yes, it matches the menu" },
      ],
    },
    { id: "c3", kind: "like", screenId: "option-a", note: "Liked. Keep this direction.", consumedAt: null },
    { id: "c4", kind: "dislike", screenId: "option-b", note: "Disliked. Drop this option.", consumedAt: null },
    { id: "c5", screenId: "home", note: "Done already", consumedAt: "2026-01-04T00:00:00.000Z" },
  ];
  const server = http.createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url.startsWith("/api/design-canvas/comments")) response.end(JSON.stringify({ comments }));
    else response.end(JSON.stringify({ screens: ["home", "settings", "option-a", "option-b"].map((id) => ({ id })) }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { root } = project({ appUrl: `http://127.0.0.1:${server.address().port}` });
    const out = await run(path.join(root, "design-canvas", "drain.mjs"), ["--canvas", "main", "--list"], { cwd: root });
    assert.equal(out.code, 0, out.stderr);
    assert.match(out.stdout, /5 comment\(s\) on main, 4 not yet worked/);
    assert.ok(out.stdout.includes("the last line says what to do."), "the whole note, not its first 72 characters");
    assert.ok(out.stdout.includes("      A second line of the same note"), "the note keeps its own lines");
    assert.match(out.stdout, /c1 {2}home {2}\[note\]/);
    assert.match(out.stdout, /c2 {2}settings {2}\[note, reopened 2 times\]\n {6}Still says Alerts, rename it\n {6}earlier rounds, oldest first:\n {8}1\. sent back 2026-01-02 10:00\n {11}Rename Alerts to Notifications\n {8}2\. sent back 2026-01-03 11:30\n {11}Is this the final name\?\n {11}answered:\n {13}Yes, it matches the menu/);
    assert.match(out.stdout, /c3 {2}option-a {2}\[like\]\n {6}Liked\. Keep this direction\./);
    assert.match(out.stdout, /c4 {2}option-b {2}\[dislike\]\n {6}Disliked\. Drop this option\./);
    assert.ok(!out.stdout.includes("Done already"), "a worked comment is not listed");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("drain says which address it could not reach, and where that address is written", async () => {
  const { root } = project({ appUrl: "http://127.0.0.1:1" });
  const out = await run(path.join(root, "design-canvas", "drain.mjs"), ["--canvas", "main", "--list"], { cwd: root });
  assert.equal(out.code, 1);
  assert.match(out.stderr, /http:\/\/127\.0\.0\.1:1/);
  assert.match(out.stderr, /"appUrl" in design-canvas\/settings\.json/);
});

test("split-canvas asks the address settings.json names", async () => {
  const app = await standIn();
  try {
    const { root } = project({ appUrl: `http://127.0.0.1:${app.port}` });
    const out = await run(path.join(root, "design-canvas", "split-canvas.mjs"), ["--from", "a", "--to", "b", "--dry"], { cwd: root });
    assert.equal(out.code, 1);
    assert.ok(app.seen.includes("/api/design-canvas/shots?canvas=b&screens=1"), app.seen.join(" "));
    assert.match(out.stderr, new RegExp(`127\\.0\\.0\\.1:${app.port}`));
  } finally {
    await app.close();
  }
});

test("split-canvas with no settings stops and names the settings file", async () => {
  const { root } = project();
  const out = await run(path.join(root, "design-canvas", "split-canvas.mjs"), ["--from", "a", "--to", "b", "--dry"], { cwd: root });
  assert.equal(out.code, 2);
  assert.match(out.stderr, /design-canvas\/settings\.json/);
});

test("verdicts finds the review from any directory, because the folder it sits in is design-canvas/", async () => {
  const { canvas } = project();
  mkdirSync(path.join(canvas, "comments"));
  writeFileSync(path.join(canvas, "comments", "demo.json"), JSON.stringify({ comments: [], waiting: { a: "new", b: "changed" } }));
  const elsewhere = scratch();
  const verdicts = await run(path.join(canvas, "verdicts.mjs"), ["list", "--canvas", "demo"], { cwd: elsewhere });
  assert.equal(verdicts.code, 0, verdicts.stderr);
});

test("system-capture with no settings stops, names the settings file, and does not guess port 3000", async () => {
  const { root } = project();
  const out = await run(path.join(root, "design-canvas", "system-capture.mjs"), [], { cwd: root });
  assert.equal(out.code, 2);
  assert.match(out.stderr, /design-canvas\/settings\.json/);
  assert.doesNotMatch(out.stderr + out.stdout, /localhost:3000\b(?!\))/, "it never says it tried 3000");
});

test("system-capture stops with the fix when the session file settings.json names is missing", async () => {
  const { root } = project({ appUrl: "http://127.0.0.1:1", storageState: "design-canvas/no-such-state.json" });
  const out = await run(path.join(root, "design-canvas", "system-capture.mjs"), [], { cwd: root });
  assert.equal(out.code, 2);
  assert.match(out.stderr, /no-such-state\.json.*does not exist/);
});

needsProject("system-capture photographs a part that counts up once it has stopped, not mid-flight", async () => {
  /* A specimen page in the shape the core's system route serves: the declaration as JSON, a ready mark, and one cell whose bar
     grows from nothing to 200px over 1.2 seconds, driven by script (no CSS animation for anything to wait on). */
  const sets = [{ id: "motion", name: "Motion", level: "atoms", group: "Display", source: "components/bar.tsx", blocks: [{ id: "b", title: "Bar", rows: [{ id: "bar", label: "Bar" }], columns: [{ id: "default", label: "Default" }], cells: { "bar/default": null } }] }];
  const page = (body) => `<!doctype html><html><body style="margin:0"><script type="application/json" id="canvas-system">${JSON.stringify({ sets, problems: [] })}</script>${body}<div data-system-ready></div></body></html>`;
  const cell = `<div data-system-cell="bar/default" style="width:220px;height:40px;margin:20px"><div data-system-target><div id="bar" style="width:0;height:40px;background:#2f9e44"></div></div></div>
    <script>const start = performance.now(); const grow = () => { const t = Math.min(1, (performance.now() - start) / 1200); document.getElementById("bar").style.width = Math.round(200 * (1 - (1 - t) ** 3)) + "px"; if (t < 1) requestAnimationFrame(grow); }; requestAnimationFrame(grow);</script>`;
  const server = http.createServer((request, response) => {
    response.setHeader("content-type", "text/html");
    response.end(request.url.startsWith("/design-canvas/system/motion") ? page(cell) : page(""));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { root, canvas } = project({ appUrl: `http://127.0.0.1:${server.address().port}` });
    const out = await run(path.join(canvas, "system-capture.mjs"), [], { cwd: root });
    assert.equal(out.code, 0, out.stdout + out.stderr);
    const file = path.join(canvas, "shots", "_system", "motion", "bar--default.png");
    const { chromium } = createRequire(path.join(PROJECT, "package.json"))("playwright");
    const browser = await chromium.launch();
    try {
      const reader = await browser.newPage();
      /* At 2x: the bar's right end (x 190 of 220) is green only once it has grown all the way. */
      const at = await reader.evaluate(async (src) => {
        const image = new Image();
        image.src = src;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const g = canvas.getContext("2d");
        g.drawImage(image, 0, 0);
        return Array.from(g.getImageData(380, 40, 1, 1).data.slice(0, 3));
      }, `data:image/png;base64,${readFileSync(file).toString("base64")}`);
      assert.deepEqual(at, [0x2f, 0x9e, 0x44], "the bar was photographed at its full width");
    } finally {
      await browser.close();
    }
  } finally {
    server.close();
  }
});

needsProject("check-canvas with no settings stops before it asks anybody anything, and ends on the verdict line", async () => {
  const { root } = project();
  const out = await run(path.join(root, "design-canvas", "check-canvas.mjs"), ["--canvas", "main"], { cwd: root });
  assert.equal(out.code, 2);
  assert.match(out.stderr, /design-canvas\/settings\.json/);
  assert.equal(out.stderr.trim().split("\n").pop(), "FAIL: the run could not start", "the stop still ends on the oracle's verdict line");
});

needsProject("check-canvas and capture ask the address settings.json names, with no flag at all", async () => {
  const app = await standIn();
  try {
    const { root, canvas } = project({ appUrl: `http://localhost:${app.port}` });
    await run(path.join(root, "design-canvas", "check-canvas.mjs"), ["--canvas", "main"], { cwd: root });
    assert.ok(app.seen.some((one) => one.startsWith("/api/design-canvas/shots?canvas=main&screens=1")), `check-canvas asked: ${app.seen.join(" ")}`);
    app.seen.length = 0;
    /* The capture reads its declaration from source; the pages it opens are on the address the settings name. */
    const declaration = path.join(canvas, "screens.json");
    writeFileSync(declaration, JSON.stringify({ viewport: { w: 1440, h: 900 }, screens: [{ id: "home", url: "/home", route: "/home", label: "Home", expect: [] }] }));
    await run(path.join(root, "design-canvas", "capture.mjs"), ["--canvas", "main", "--all", "--no-warm", "--screens-file", declaration], { cwd: root });
    assert.ok(app.seen.includes("/home"), `capture opened: ${app.seen.join(" ")}`);
  } finally {
    await app.close();
  }
});

needsProject("check-canvas and capture take the saved session from settings.json when no flag or variable names one", async () => {
  const { root, canvas } = project({ appUrl: "http://127.0.0.1:1", storageState: "design-canvas/no-such-state.json" });
  /* The capture reads its declaration from a file here, so it gets as far as the session without asking an app anything. */
  const declaration = path.join(canvas, "screens.json");
  writeFileSync(declaration, JSON.stringify({ viewport: { w: 1440, h: 900 }, screens: [{ id: "home", url: "/", route: "/", label: "Home", expect: [] }] }));
  for (const [tool, args] of [["check-canvas.mjs", ["--canvas", "main"]], ["capture.mjs", ["--canvas", "main", "--all", "--screens-file", declaration]]]) {
    const out = await run(path.join(root, "design-canvas", tool), args, { cwd: root });
    assert.equal(out.code, 2, `${tool}: ${out.stderr}`);
    assert.match(out.stderr, /no-such-state\.json.*does not exist/, tool);
  }
});

/* ------------------------------------------------------------------ 2. the live pass visits what changed */

const screen = (id, extra = {}) => ({ id, url: `/${id}`, ...extra });
const screens = [screen("home"), screen("list"), screen("explain", { url: null, explain: "text" }), screen("old", { frozen: true }), screen("wire", { wireframe: true }), screen("edit")];

test("by default only the frames captured since their last live visit are opened", () => {
  const choice = chooseLive({ screens, unproven: new Set(["list", "edit", "gone"]) });
  assert.deepEqual(choice.visit.map((one) => one.id), ["list", "edit"]);
  assert.equal(choice.eligible, 3, "an explanation, preserved history and a wireframe have no Open destination");
  assert.equal(choice.left, 1);
  assert.match(describeLive(choice), /2 of 3 live Open destination\(s\) visited: the frames captured since their last live visit; 1 left alone, because nothing was captured on them since their last live visit/);
  assert.match(describeLive(choice), /--live-all opens every frame/);
});

test("nothing captured means nothing opened, and it says so", () => {
  const choice = chooseLive({ screens, unproven: new Set() });
  assert.equal(choice.visit.length, 0);
  assert.match(describeLive(choice), /0 of 3 .* 3 left alone/);
});

test("--only opens exactly the frames named, changed or not, and reports a name that is no screen and one with nothing to open", () => {
  const choice = chooseLive({ screens, only: ["home", "nope", "explain"], unproven: new Set(["list"]) });
  assert.deepEqual(choice.visit.map((one) => one.id), ["home"]);
  assert.deepEqual(choice.unknown, ["nope"]);
  assert.deepEqual(choice.unopenable, ["explain"]);
  assert.match(describeLive(choice), /the frames --only names; 2 left alone \(--live-all opens every frame\)/);
});

test("--live-all opens every frame that has an Open destination, in declared order", () => {
  const choice = chooseLive({ screens, all: true, unproven: new Set() });
  assert.deepEqual(choice.visit.map((one) => one.id), ["home", "list", "edit"]);
  assert.equal(describeLive(choice), "3 of 3 live Open destination(s) visited: every frame (--live-all)");
});

test("the capture's list survives between runs, a clean visit takes a frame off it, and a frame that left the declaration goes too", () => {
  const dir = scratch();
  assert.deepEqual([...readUnproven(dir, "demo")], [], "no file is an empty list, not an error");
  markUnproven(dir, "demo", ["a", "b"]);
  markUnproven(dir, "demo", ["b", "c"]);
  assert.deepEqual([...readUnproven(dir, "demo")].sort(), ["a", "b", "c"]);
  markProven(dir, "demo", ["a"], { declared: new Set(["b", "c"]) });
  assert.deepEqual([...readUnproven(dir, "demo")].sort(), ["b", "c"]);
  markProven(dir, "demo", [], { declared: new Set(["c"]) });
  assert.deepEqual([...readUnproven(dir, "demo")], ["c"], "b is no longer declared, so nobody will ever visit it");
  assert.ok(unprovenFile(dir, "demo").includes(path.join("rounds", "demo")), "kept under the scratch folder the installer gitignores");
});

test("a corrupt list is an empty one, and a write leaves no half-written file behind", () => {
  const dir = scratch();
  mkdirSync(path.join(dir, "rounds", "demo"), { recursive: true });
  writeFileSync(unprovenFile(dir, "demo"), "{ not json");
  assert.deepEqual([...readUnproven(dir, "demo")], []);
  markUnproven(dir, "demo", ["a"]);
  assert.deepEqual([...readUnproven(dir, "demo")], ["a"]);
  assert.deepEqual(readdirSync(path.join(dir, "rounds", "demo")), ["live-unproven.json"], "the temporary file was renamed into place");
  assert.ok(existsSync(unprovenFile(dir, "demo")) && JSON.parse(readFileSync(unprovenFile(dir, "demo"), "utf8")).frames.length === 1);
});

test("the git-ignored rounds folder is where the list lives, so it never reaches a commit", () => {
  /* The installer's ignore lines live in ignore-rules.mjs, which it and check-install.mjs share (git is asked about each one). */
  const rules = readFileSync(path.join(HERE, "..", "..", "scripts", "ignore-rules.mjs"), "utf8");
  assert.match(rules, /"design-canvas\/rounds\/"/);
});
