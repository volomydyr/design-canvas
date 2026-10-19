/**
 * Tests for `recapture.mjs`: which frames an edit puts out of date, and the Stop hook that recaptures them in the background.
 *
 *   node --test tool/tests/recapture.test.mjs
 *
 * The stamps in these fixtures are built the way `capture.mjs` builds them (the import closure from `closure.mjs`, each file
 * hashed to 16 hex characters), so the tests hold the mapping to what a real manifest records.
 *
 * NOT INSTALLED into a project.
 */
import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

import { filesReachedFrom } from "../closure.mjs";
import { declStamp, fileStamp, firstFrames, holderRunning, inputsDigest, lanesFor, openCanvases, staleFrames, takeLock, VIEWING_TTL_MS } from "../recapture.mjs";

const TOOL = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const made = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function project(files) {
  const root = mkdtempSync(path.join(tmpdir(), "canvas-recapture-test-"));
  made.push(root);
  for (const [rel, text] of Object.entries(files)) write(root, rel, text);
  return root;
}
function write(root, rel, text) {
  const at = path.join(root, rel);
  mkdirSync(path.dirname(at), { recursive: true });
  writeFileSync(at, text);
}

/** A shot as the capture writes it: the stamp lists every file the frame's source reaches, with its hash at capture time. */
const shotOf = (root, screenId, source) => ({
  screenId,
  stamp: { decl: "d", sources: Object.fromEntries(filesReachedFrom(source, root).map((rel) => [rel, fileStamp(root, rel)])) },
});

const APP = {
  "components/button.tsx": "export const Button = () => null;\n",
  "components/badge.tsx": "export const Badge = () => null;\n",
  "app/home/page.tsx": 'import { Button } from "@/components/button";\nexport default () => null;\n',
  "app/tasks/page.tsx": 'import { Button } from "../../components/button";\nimport { Badge } from "@/components/badge";\nexport default () => null;\n',
  "app/settings/page.tsx": 'import { Badge } from "@/components/badge";\nexport default () => null;\n',
  "app/about/page.tsx": "export default () => null;\n",
};
const SOURCES = {
  home: ["app/home/page.tsx"],
  tasks: ["app/tasks/page.tsx"],
  settings: ["app/settings/page.tsx"],
  about: ["app/about/page.tsx"],
};
function captured() {
  const root = project(APP);
  const shots = Object.entries(SOURCES).map(([id, source]) => shotOf(root, id, source));
  const frames = Object.keys(SOURCES).map((id) => ({ id }));
  return { root, shots, frames, hashOf: (rel) => fileStamp(root, rel) };
}

test("nothing edited: no frame is out of date", () => {
  const { shots, frames, hashOf } = captured();
  assert.deepEqual(staleFrames({ frames, shots, hashOf }), { stale: [], edited: [] });
});

test("an edited shared component puts exactly the frames that import it out of date, directly or through another file", () => {
  const { root, shots, frames, hashOf } = captured();
  write(root, "components/button.tsx", "export const Button = () => 'changed';\n");
  const { stale, edited } = staleFrames({ frames, shots, hashOf });
  assert.deepEqual(stale.map((one) => one.id), ["home", "tasks"]);
  assert.deepEqual(stale[0], { id: "home", files: ["components/button.tsx"], why: "edited" });
  assert.deepEqual(edited, ["components/button.tsx"]);
});

test("two edits: each frame lists the files of its own that changed", () => {
  const { root, shots, frames, hashOf } = captured();
  write(root, "components/button.tsx", "export const Button = () => 1;\n");
  write(root, "components/badge.tsx", "export const Badge = () => 2;\n");
  const { stale } = staleFrames({ frames, shots, hashOf });
  assert.deepEqual(
    stale.map((one) => [one.id, one.files]),
    [
      ["home", ["components/button.tsx"]],
      ["tasks", ["components/badge.tsx", "components/button.tsx"]],
      ["settings", ["components/badge.tsx"]],
    ],
  );
});

test("a file saved with the same bytes changes nothing, and a deleted file counts as an edit", () => {
  const { root, shots, frames, hashOf } = captured();
  write(root, "components/button.tsx", APP["components/button.tsx"]);
  assert.deepEqual(staleFrames({ frames, shots, hashOf }).stale, []);
  rmSync(path.join(root, "components/badge.tsx"));
  assert.deepEqual(staleFrames({ frames, shots, hashOf }).stale.map((one) => one.id), ["tasks", "settings"]);
});

test("a new import is seen, because adding it edits a file already in the closure", () => {
  const { root, shots, frames, hashOf } = captured();
  write(root, "app/about/page.tsx", 'import { Badge } from "@/components/badge";\nexport default () => null;\n');
  assert.deepEqual(staleFrames({ frames, shots, hashOf }).stale.map((one) => one.id), ["about"]);
});

test("a frame with no picture is listed; frozen, explanation and unstamped frames and wireframe keys are left alone", () => {
  const { root, shots, hashOf } = captured();
  write(root, "components/button.tsx", "export const Button = () => 3;\n");
  const frames = [
    { id: "home", frozen: true },
    { id: "tasks" },
    { id: "brand-new" },
    { id: "why", explain: true },
    { id: "old" },
    { id: "sketch" },
  ];
  const all = [
    ...shots,
    { screenId: "old" },
    { screenId: "sketch", stamp: { decl: "d", sources: { "wireframe:http://localhost:1/a.html": "abc" } } },
  ];
  assert.deepEqual(
    staleFrames({ frames, shots: all, hashOf }).stale.map((one) => [one.id, one.why]),
    [
      ["tasks", "edited"],
      ["brand-new", "no picture"],
    ],
  );
});

test("each file is hashed once, however many frames list it", () => {
  const { shots, frames, root } = captured();
  const counts = new Map();
  staleFrames({
    frames,
    shots,
    hashOf: (rel) => {
      counts.set(rel, (counts.get(rel) ?? 0) + 1);
      return fileStamp(root, rel);
    },
  });
  assert.ok([...counts.values()].every((count) => count === 1), JSON.stringify([...counts]));
});

test("a frame whose own declaration changed is out of date, and only that frame", () => {
  const { shots, frames, hashOf } = captured();
  const declOf = (frame) => (frame.id === "tasks" ? "changed" : "d");
  assert.deepEqual(staleFrames({ frames, shots, hashOf, declOf }).stale, [{ id: "tasks", files: [], why: "declaration" }]);
  assert.deepEqual(staleFrames({ frames, shots, hashOf }).stale, [], "with no declOf, the declaration is not compared");
});

test("declStamp leaves out the words on a tile and the canvas's write policy, and sees what changes the page", () => {
  const screen = { id: "a", url: "/a", label: "A", note: "One", expect: ["A"] };
  const same = declStamp(screen, { network: [{ writes: "abort" }] });
  assert.equal(declStamp({ ...screen, label: "Renamed", note: "Other", kind: "K" }, {}), same);
  assert.equal(declStamp({ ...screen, device: "desktop", expectMissing: [], steps: [] }, {}), same, "defaults stamp as absent");
  assert.notEqual(declStamp({ ...screen, expect: ["B"] }, {}), same);
  assert.notEqual(declStamp(screen, { network: [{ hold: "Q" }] }), same, "a canvas-wide rule changes what the page shows");
});

/* ------------------------------------------------------------------ focus */

test("the inputs' fingerprint changes with a stamped file, a declaration or a new picture, and only then", () => {
  const { root, shots, frames, hashOf } = captured();
  const declOf = () => "d";
  const at = inputsDigest({ frames, shots, hashOf, declOf });
  assert.equal(inputsDigest({ frames, shots, hashOf, declOf }), at, "nothing changed");
  write(root, "app/about/page.tsx", "export default () => 'edited';\n");
  const edited = inputsDigest({ frames, shots, hashOf, declOf });
  assert.notEqual(edited, at);
  assert.notEqual(inputsDigest({ frames, shots, hashOf, declOf: (frame) => (frame.id === "home" ? "e" : "d") }), edited);
  assert.notEqual(inputsDigest({ frames, shots: shots.slice(1), hashOf, declOf }), edited, "a picture gone or new");
  write(root, "components/unused.tsx", "export const Unused = 1;\n");
  assert.equal(inputsDigest({ frames, shots, hashOf, declOf }), edited, "a file no picture is made of changes nothing");
});

test("open canvases: fresh reports only, every viewer counts, frames on screen newest first", () => {
  const dir = project({});
  const now = Date.parse("2026-10-19T12:00:00Z");
  const ago = (ms) => new Date(now - ms).toISOString();
  write(dir, "rounds/viewing.json", JSON.stringify({
    viewers: {
      a: { canvas: "one", tab: "kinds", visible: ["one-home", "one-list"], at: ago(30_000) },
      b: { canvas: "one", tab: "flows", visible: ["one-list", "one-done"], at: ago(5_000) },
      c: { canvas: "two", tab: "kinds", visible: ["two-home"], at: ago(1_000) },
      d: { canvas: "three", tab: "kinds", visible: ["three-home"], at: ago(VIEWING_TTL_MS + 1) },
    },
  }));
  const open = openCanvases(dir, now);
  assert.deepEqual([...open.keys()].sort(), ["one", "two"], "an expired report, a closed or hidden tab, does not count");
  assert.deepEqual(open.get("one"), { visible: ["one-list", "one-done", "one-home"], tabs: ["flows", "kinds"] });
  write(dir, "rounds/viewing.json", "{ torn");
  assert.equal(openCanvases(dir, now).size, 0);
});

test("the frames on screen go first, and a large set runs fewer lanes unless CANVAS_LANES says", () => {
  const plan = { stale: [{ id: "a" }, { id: "b" }, { id: "c" }] };
  assert.deepEqual(firstFrames(plan, ["c", "x", "a"]), ["c", "a"]);
  assert.equal(lanesFor(10, {}), undefined);
  assert.equal(lanesFor(11, {}), 2);
  assert.equal(lanesFor(40, { CANVAS_LANES: "6" }), undefined);
});

/* ------------------------------------------------------------------ the hook */

/** A project with the canvas folder holding this tool and the declaration reader, and no declaration. */
function canvasFolder() {
  const root = project({ "package.json": "{}\n" });
  const dir = path.join(root, "design-canvas");
  mkdirSync(dir, { recursive: true });
  for (const file of ["recapture.mjs", "declarations.mjs", "dump-screens.mjs", "project-settings.mjs", "browser-guards.mjs", "browser-lifecycle.mjs", "network.mjs"])
    copyFileSync(path.join(TOOL, file), path.join(dir, file));
  return { root, dir };
}
const waitFor = async (check, ms = 10_000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
};

test("the hook returns at once, prints nothing and exits 0 on any input; the background run logs why it did nothing", async () => {
  const { dir } = canvasFolder();
  const started = Date.now();
  const run = spawnSync(process.execPath, [path.join(dir, "recapture.mjs"), "--hook"], {
    input: "not json",
    encoding: "utf8",
    env: { ...process.env, CANVAS_RECAPTURE_QUIET_MS: "50" },
  });
  assert.equal(run.status, 0);
  assert.equal(run.stdout, "");
  assert.ok(Date.now() - started < 3000, "the turn is not held");
  const log = path.join(dir, "rounds", "recapture-log.txt");
  assert.ok(await waitFor(() => existsSync(log) && readFileSync(log, "utf8").includes("could not be read")), "the run says why");
  assert.ok(await waitFor(() => !existsSync(path.join(dir, "rounds", "recapture.lock"))), "the lock is released");
});

test("a turn that ends while a run is going leaves a mark and stops, so the running one looks again", () => {
  const { dir } = canvasFolder();
  mkdirSync(path.join(dir, "rounds"), { recursive: true });
  /* A live process holds the lock: this test's own. */
  writeFileSync(path.join(dir, "rounds", "recapture.lock"), JSON.stringify({ pid: process.pid }));
  const run = spawnSync(process.execPath, [path.join(dir, "recapture.mjs"), "--worker"], { encoding: "utf8" });
  assert.equal(run.status, 0);
  assert.ok(existsSync(path.join(dir, "rounds", "recapture.again")), "the mark is left for the holder");
  assert.ok(existsSync(path.join(dir, "rounds", "recapture.lock")), "the holder's lock is not taken");
});

test("a lock left by a run that died is taken over", async () => {
  const { dir } = canvasFolder();
  mkdirSync(path.join(dir, "rounds"), { recursive: true });
  writeFileSync(path.join(dir, "rounds", "recapture.lock"), JSON.stringify({ pid: 999_999_999 }));
  const run = spawnSync(process.execPath, [path.join(dir, "recapture.mjs"), "--worker"], {
    encoding: "utf8",
    env: { ...process.env, CANVAS_RECAPTURE_QUIET_MS: "50" },
  });
  assert.equal(run.status, 0);
  assert.ok(readFileSync(path.join(dir, "rounds", "recapture-log.txt"), "utf8").includes("could not be read"));
  assert.ok(!existsSync(path.join(dir, "rounds", "recapture.lock")));
  assert.ok(!existsSync(path.join(dir, "rounds", "recapture.again")));
});

test("the plain command says a background run is going and stops, instead of capturing beside it", () => {
  const { dir } = canvasFolder();
  mkdirSync(path.join(dir, "rounds"), { recursive: true });
  writeFileSync(path.join(dir, "rounds", "recapture.lock"), JSON.stringify({ pid: process.pid }));
  const run = spawnSync(process.execPath, [path.join(dir, "recapture.mjs")], { encoding: "utf8" });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /a background run is capturing right now/);
});

const PROJECT = process.env.CANVAS_TEST_PROJECT;
test("an edit to one canvas's declaration file puts only that canvas's changed frame out of date", PROJECT ? {} : { skip: "set CANVAS_TEST_PROJECT to a project that has esbuild" }, async () => {
  const { root, dir } = canvasFolder();
  symlinkSync(path.join(PROJECT, "node_modules"), path.join(root, "node_modules"));
  const canvas = (prefix, expect) => ({ title: prefix, viewport: { w: 800, h: 600 }, flows: [{ id: "f", title: "F", screens: [{ id: `${prefix}-home`, label: "Home", route: "/", expect: [expect] }, { id: `${prefix}-list`, label: "List", route: "/list" }] }] });
  const writeCanvas = (slug, value) => write(root, `design-canvas/project/canvases/${slug}.ts`, `export const ${slug.toUpperCase()} = ${JSON.stringify(value)};\n`);
  writeCanvas("one", canvas("one", "Welcome"));
  writeCanvas("two", canvas("two", "Welcome"));
  write(root, "design-canvas/project/flows.ts", 'import { ONE } from "./canvases/one";\nimport { TWO } from "./canvases/two";\nexport const CANVASES = { one: ONE, two: TWO };\n');
  /* Each canvas's manifest stamped the way the capture stamps it: the served shape, through declStamp. */
  const { project: served } = await import(path.join(dir, "dump-screens.mjs"));
  const { declarationFor, loadDeclarations } = await import(path.join(dir, "declarations.mjs"));
  const loaded = await loadDeclarations(dir);
  for (const slug of ["one", "two"]) {
    const declaration = served(declarationFor(loaded, slug).declaration);
    const shots = declaration.screens.map((screen) => ({ screenId: screen.id, stamp: { decl: declStamp(screen, declaration), sources: {} } }));
    write(root, `design-canvas/shots/${slug}/manifest.json`, JSON.stringify({ shots }));
  }
  const plan = () => spawnSync(process.execPath, [path.join(dir, "recapture.mjs"), "--plan"], { cwd: root, encoding: "utf8" });
  assert.deepEqual(plan().stdout.trim().split("\n"), ["one: up to date", "two: up to date"], plan().stderr);
  writeCanvas("two", canvas("two", "Hello"));
  assert.deepEqual(plan().stdout.trim().split("\n"), ["one: up to date", "two: 1 frame(s) out of date: two-home (its declaration)"]);
  /* A label is no part of the picture; a frame that left the declaration is. */
  writeCanvas("one", { ...canvas("one", "Welcome"), flows: [{ id: "f", title: "F", screens: [{ id: "one-home", label: "Start", route: "/", expect: ["Welcome"] }] }] });
  assert.equal(plan().stdout.trim().split("\n")[0], "one: 1 picture(s) of frames the declaration no longer has: one-list");
});

/**
 * THE MOMENTS, END TO END: two canvases share a component, one is open. The capture is a stand-in that writes down how it was
 * started, and the app is a server that answers, so what is captured, in what order, and what is said are all visible.
 */
test("a turn that edits a shared component recaptures only the open canvas, its frames on screen first, and names the other; a turn with no change starts nothing; opening the other refreshes it", PROJECT ? {} : { skip: "set CANVAS_TEST_PROJECT to a project that has esbuild" }, async () => {
  const { root, dir } = canvasFolder();
  for (const file of ["checks-answer.mjs", "reminders.mjs"]) copyFileSync(path.join(TOOL, file), path.join(dir, file));
  symlinkSync(path.join(PROJECT, "node_modules"), path.join(root, "node_modules"));
  write(root, "components/card.tsx", "export const Card = () => null;\n");
  for (const route of ["home", "list"]) write(root, `app/${route}/page.tsx`, 'import { Card } from "../../components/card";\nexport default () => Card;\n');
  const canvas = (prefix) => ({ title: prefix, viewport: { w: 800, h: 600 }, flows: [{ id: "f", title: "F", screens: ["home", "list"].map((route) => ({ id: `${prefix}-${route}`, label: route, route: `/${route}`, source: [`app/${route}/page.tsx`] })) }] });
  write(root, "design-canvas/project/flows.ts", `export const CANVASES = ${JSON.stringify({ one: canvas("one"), two: canvas("two") })};\n`);
  const { project: served } = await import(path.join(dir, "dump-screens.mjs"));
  const { declarationFor, loadDeclarations } = await import(path.join(dir, "declarations.mjs"));
  const loaded = await loadDeclarations(dir);
  for (const slug of ["one", "two"]) {
    const declaration = served(declarationFor(loaded, slug).declaration);
    const shots = declaration.screens.map((screen) => ({ screenId: screen.id, stamp: { decl: declStamp(screen, declaration), sources: Object.fromEntries(filesReachedFrom(screen.source, root).map((rel) => [rel, fileStamp(root, rel)])) } }));
    write(root, `design-canvas/shots/${slug}/manifest.json`, JSON.stringify({ shots }));
  }
  const server = createServer((request, response) => response.end("ok"));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  after(() => server.close());
  write(root, "design-canvas/settings.json", JSON.stringify({ appUrl: `http://127.0.0.1:${server.address().port}` }));
  /* The stand-in capture: one line per start, with its arguments. */
  const calls = path.join(root, "calls.txt");
  write(root, "design-canvas/capture.mjs", `import { appendFileSync } from "node:fs";\nappendFileSync(${JSON.stringify(calls)}, JSON.stringify(process.argv.slice(2)) + "\\n");\n`);
  const env = { ...process.env, CANVAS_ANSWERS_FILE: path.join(root, "answers.json"), CANVAS_RECAPTURE_QUIET_MS: "50" };
  const { writeAnswer } = await import(path.join(dir, "checks-answer.mjs"));
  const saved = process.env.CANVAS_ANSWERS_FILE;
  process.env.CANVAS_ANSWERS_FILE = env.CANVAS_ANSWERS_FILE;
  writeAnswer(root, true);
  if (saved === undefined) delete process.env.CANVAS_ANSWERS_FILE;
  else process.env.CANVAS_ANSWERS_FILE = saved;
  const viewing = (viewers) => write(root, "design-canvas/rounds/viewing.json", JSON.stringify({ viewers }));
  const hook = () => spawnSync(process.execPath, [path.join(dir, "recapture.mjs"), "--hook"], { cwd: root, input: "{}", encoding: "utf8", env });
  const lock = path.join(dir, "rounds", "recapture.lock");
  const settled = () => waitFor(() => !existsSync(lock) && !existsSync(path.join(dir, "rounds", "recapture.again")));
  const started = () => (existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : []);

  /* The first turn records the fingerprint; everything is current, so nothing is captured and nothing is said. */
  viewing({ "tab-a": { canvas: "one", tab: "kinds", visible: ["one-list"], at: new Date().toISOString() } });
  assert.equal(hook().stdout, "");
  /* The background run has looked (its plan is in the log) and let go of the lock before the next turn ends. */
  assert.ok(await waitFor(() => existsSync(logFileOf(dir)) && readFileSync(logFileOf(dir), "utf8").includes("two: up to date")));
  assert.ok(await settled());
  assert.deepEqual(started(), []);

  /* A turn that edits the shared component: only the open canvas is captured, its frame on screen first. */
  write(root, "components/card.tsx", "export const Card = () => 'changed';\n");
  const said = hook();
  assert.equal(said.status, 0);
  assert.deepEqual(JSON.parse(said.stdout), { systemMessage: "design-canvas: 2 frame(s) on canvases not open now are out of date (two 2); each canvas refreshes when it is opened" });
  assert.ok(await waitFor(() => started().length > 0));
  assert.ok(await settled());
  assert.deepEqual(started(), [["--canvas", "one", "--first", "one-list"]]);
  assert.match(readFileSync(logFileOf(dir), "utf8"), /left out of date until opened: two 2/);

  /* A turn that changed nothing a picture is made of starts nothing. */
  write(root, "components/unrelated.tsx", "export const Unrelated = 1;\n");
  assert.equal(hook().stdout, "");
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.ok(await settled());
  assert.equal(started().length, 1);

  /* Opening the other canvas refreshes it there and then, behind the same answer. */
  /* Started without blocking this process, which serves the app the capture checks first. */
  await new Promise((resolve, reject) => execFile(process.execPath, [path.join(dir, "recapture.mjs"), "--opened", "two"], { cwd: root, env }, (error) => (error ? reject(error) : resolve())));
  assert.deepEqual(started()[1], ["--canvas", "two"], readFileSync(logFileOf(dir), "utf8").slice(-1500));
  /* With no yes on this machine, opening a canvas captures nothing. */
  const noAnswer = spawnSync(process.execPath, [path.join(dir, "recapture.mjs"), "--opened", "two"], { cwd: root, encoding: "utf8", env: { ...env, CANVAS_ANSWERS_FILE: path.join(root, "none.json") } });
  assert.equal(noAnswer.status, 0);
  assert.equal(started().length, 2);
});
const logFileOf = (dir) => path.join(dir, "rounds", "recapture-log.txt");

test("a turn whose background run captured nothing is retried by the next turn, though nothing changed in between", PROJECT ? {} : { skip: "set CANVAS_TEST_PROJECT to a project that has esbuild" }, async () => {
  const { root, dir } = canvasFolder();
  for (const file of ["checks-answer.mjs", "reminders.mjs"]) copyFileSync(path.join(TOOL, file), path.join(dir, file));
  symlinkSync(path.join(PROJECT, "node_modules"), path.join(root, "node_modules"));
  write(root, "components/card.tsx", "export const Card = () => null;\n");
  write(root, "app/home/page.tsx", 'import { Card } from "../../components/card";\nexport default () => Card;\n');
  write(root, "design-canvas/project/flows.ts", `export const CANVASES = ${JSON.stringify({ one: { title: "one", viewport: { w: 800, h: 600 }, flows: [{ id: "f", title: "F", screens: [{ id: "one-home", label: "home", route: "/home", source: ["app/home/page.tsx"] }] }] } })};\n`);
  const { project: served } = await import(path.join(dir, "dump-screens.mjs"));
  const { declarationFor, loadDeclarations } = await import(path.join(dir, "declarations.mjs"));
  const declaration = served(declarationFor(await loadDeclarations(dir), "one").declaration);
  const shots = declaration.screens.map((screen) => ({ screenId: screen.id, stamp: { decl: declStamp(screen, declaration), sources: Object.fromEntries(filesReachedFrom(screen.source, root).map((rel) => [rel, fileStamp(root, rel)])) } }));
  write(root, "design-canvas/shots/one/manifest.json", JSON.stringify({ shots }));
  /* A port nothing listens on yet. */
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  write(root, "design-canvas/settings.json", JSON.stringify({ appUrl: `http://127.0.0.1:${port}` }));
  const calls = path.join(root, "calls.txt");
  write(root, "design-canvas/capture.mjs", `import { appendFileSync } from "node:fs";\nappendFileSync(${JSON.stringify(calls)}, JSON.stringify(process.argv.slice(2)) + "\\n");\n`);
  const env = { ...process.env, CANVAS_ANSWERS_FILE: path.join(root, "answers.json"), CANVAS_RECAPTURE_QUIET_MS: "50" };
  const viewing = () => write(root, "design-canvas/rounds/viewing.json", JSON.stringify({ viewers: { "tab-aaaaaaaa": { canvas: "one", tab: "kinds", visible: ["one-home"], at: new Date().toISOString() } } }));
  const hook = () => spawnSync(process.execPath, [path.join(dir, "recapture.mjs"), "--hook"], { cwd: root, input: "{}", encoding: "utf8", env });
  const lock = path.join(dir, "rounds", "recapture.lock");
  const settled = () => waitFor(() => !existsSync(lock) && !existsSync(path.join(dir, "rounds", "recapture.again")));
  const started = () => (existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").filter(Boolean) : []);
  const log = () => (existsSync(logFileOf(dir)) ? readFileSync(logFileOf(dir), "utf8") : "");

  /* An edit while the dev server is down: nothing is captured. */
  write(root, "components/card.tsx", "export const Card = () => 'changed';\n");
  viewing();
  hook();
  assert.ok(await waitFor(() => log().includes("nothing answers")));
  assert.ok(await settled());
  assert.deepEqual(started(), []);
  /* The server is up, the canvas still open, nothing edited: the next turn captures. */
  const server = createServer((request, response) => response.end("ok"));
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  after(() => server.close());
  viewing();
  hook();
  assert.ok(await waitFor(() => started().length > 0), log().slice(-800));
  assert.ok(await settled());
  /* A run that worked is not repeated by a turn that changed nothing. */
  viewing();
  hook();
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.ok(await settled());
  assert.equal(started().length, 1);
});

test("a lock whose pid now belongs to another process is taken over; one its writer still holds is not", () => {
  const dir = project({});
  const file = path.join(dir, "rounds", "capture.lock");
  /* Written long before the live process with that pid started: the pid was reused. */
  write(dir, "rounds/capture.lock", JSON.stringify({ pid: process.pid, at: "2000-01-01T00:00:00.000Z" }));
  assert.equal(holderRunning(JSON.parse(readFileSync(file, "utf8"))), false);
  assert.equal(takeLock(file), true);
  assert.equal(JSON.parse(readFileSync(file, "utf8")).pid, process.pid);
  /* Written by this process, which is running: held. */
  assert.equal(holderRunning(JSON.parse(readFileSync(file, "utf8"))), true);
  assert.equal(takeLock(file), false);
});
