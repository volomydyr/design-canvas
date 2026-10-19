/**
 * Tests for the two modules the tools share: browser-guards.mjs (what capture.mjs and check-canvas.mjs must agree on)
 * and review-store.mjs (what review-build.mjs and review-comments.mjs must agree on). They need no browser, no app and no
 * dependencies, so they run in the skill's own checkout:
 *
 *   node --test tool/tests/tools.test.mjs
 *
 * The core's tests are a separate suite (vitest, inside a project the canvas is installed into), because they need React.
 *
 * NOT INSTALLED into a project: the installer copies only the files it lists.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

import { loadDismissals, loginRedirect, safeLine, waitForServedFrames } from "../browser-guards.mjs";
import { describeChange, inside, plainName, sayChange, snapshotReview, takeLive, vetComments } from "../review-store.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/* Every folder a test makes is removed when the suite ends. */
const made = [];
const scratch = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "canvas-tools-test-"));
  made.push(dir);
  return dir;
};
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ item 2: a crash never prints the session */

test("safeLine keeps the first line only", () => {
  const error = new Error("browser.newContext: Target closed\nCall log:\n  - options: {\"storageState\":{\"cookies\":[1]}}");
  assert.equal(safeLine(error), "browser.newContext: Target closed");
});

test("safeLine scrubs every cookie and localStorage value of the storage state out of the line", () => {
  const dir = scratch();
  const state = path.join(dir, "auth-state.json");
  writeFileSync(
    state,
    JSON.stringify({
      cookies: [{ name: "sid", value: "COOKIE-SECRET-VALUE-123", domain: "localhost", path: "/" }],
      origins: [{ origin: "http://localhost:3000", localStorage: [{ name: "jwt", value: "LOCAL-SECRET-TOKEN-456" }] }],
    }),
  );
  const line = safeLine(new Error("bad header COOKIE-SECRET-VALUE-123 and LOCAL-SECRET-TOKEN-456 in one line"), state);
  assert.ok(!line.includes("COOKIE-SECRET-VALUE-123"), line);
  assert.ok(!line.includes("LOCAL-SECRET-TOKEN-456"), line);
  assert.match(line, /\[redacted\]/);
});

test("safeLine withholds a line that still looks like session data", () => {
  assert.match(safeLine(new Error('context options {"cookies":[{"name":"sid"}]}')), /withheld/);
  assert.match(safeLine(new Error("token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc leaked")), /withheld/);
});

test("safeLine caps a very long line", () => {
  assert.ok(safeLine(new Error("x".repeat(2000))).length <= 240);
});

/* ------------------------------------------------------------------ item 4: the login redirect */

test("loginRedirect names a redirect to a sign-in route, and only that", () => {
  assert.deepEqual(loginRedirect("http://x/home", "http://x/login?next=/home"), { from: "/home", to: "/login" });
  assert.deepEqual(loginRedirect("http://x/home", "http://x/auth/sign-in"), { from: "/home", to: "/auth/sign-in" });
  assert.deepEqual(loginRedirect("http://x/", "http://x/users/sign_in"), { from: "/", to: "/users/sign_in" });
  assert.equal(loginRedirect("http://x/home", "http://x/home"), null, "no redirect");
  assert.equal(loginRedirect("http://x/login", "http://x/login"), null, "a screen that IS the login page");
  assert.equal(loginRedirect("http://x/login", "http://x/sign-in"), null, "asked for a login route, landed on another");
  assert.equal(loginRedirect("http://x/home", "http://x/dashboard"), null, "an ordinary redirect");
  assert.equal(loginRedirect("http://x/home", "http://x/auth/profile"), null, "bare /auth is a real screen in many apps");
  assert.equal(loginRedirect("http://x/home", "http://x/enter"), null, "a route called something else is not guessed");
  assert.deepEqual(loginRedirect("http://x/home", "http://x/enter", "/enter"), { from: "/home", to: "/enter" }, "unless it is named once");
  assert.deepEqual(loginRedirect("http://x/home", "http://x/enter/step-2", "/enter/"), { from: "/home", to: "/enter/step-2" });
  assert.equal(loginRedirect("http://x/entered", "http://x/entered", "/enter"), null);
  assert.equal(loginRedirect("http://x/home", "http://x/entered", "/enter"), null, "a prefix is a path prefix, not a string prefix");
});

test("requireStorageState stops a run with exit code 2 and one line, without printing the file", () => {
  const dir = scratch();
  const state = path.join(dir, "auth-state.json");
  writeFileSync(state, JSON.stringify({ not: "a storage state", secret: "SHOULD-NEVER-PRINT" }));
  const run = (file) =>
    spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { requireStorageState } from ${JSON.stringify(path.join(HERE, "..", "browser-guards.mjs"))};
         requireStorageState("capture", ${JSON.stringify(file)}, "http://localhost:3000");`,
      ],
      { encoding: "utf8" },
    );
  const missing = run(path.join(dir, "absent.json"));
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /does not exist/);
  assert.match(missing.stderr, /npx playwright open --save-storage=/);
  assert.equal(missing.stderr.trim().split("\n").length, 1);
  const wrong = run(state);
  assert.equal(wrong.status, 2);
  assert.ok(!wrong.stderr.includes("SHOULD-NEVER-PRINT"));
  assert.equal(wrong.stderr.trim().split("\n").length, 1);
});

/* ------------------------------------------------------------------ item 5: declared dismissals */

test("loadDismissals reads the bare-array form, the per-canvas form and the wildcard together", () => {
  const dir = scratch();
  writeFileSync(path.join(dir, "dismiss.json"), JSON.stringify([{ localStorage: { promo: "1" } }, { click: "Got it" }]));
  assert.deepEqual(loadDismissals(dir, "anything", "t"), {
    seeds: { promo: "1" },
    clicks: [{ click: "Got it", within: null }],
    file: path.join(dir, "dismiss.json"),
  });
  writeFileSync(
    path.join(dir, "dismiss.json"),
    JSON.stringify({
      "*": [{ localStorage: { welcome: true } }],
      trips: [{ click: "Maybe later", within: "[role=dialog]" }],
      other: [{ click: "Not mine" }],
    }),
  );
  const got = loadDismissals(dir, "trips", "t");
  assert.deepEqual(got.seeds, { welcome: "true" }, "a non-string value is stored as JSON");
  assert.deepEqual(got.clicks, [{ click: "Maybe later", within: "[role=dialog]" }], "another canvas's steps are not applied");
  assert.deepEqual(loadDismissals(scratch(), "trips", "t"), { seeds: {}, clicks: [], file: null }, "no file, no steps");
});

test("a dismiss.json step that is neither kind stops the run with exit code 2", () => {
  const dir = scratch();
  writeFileSync(path.join(dir, "dismiss.json"), JSON.stringify([{ tap: "Got it" }]));
  const run = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { loadDismissals } from ${JSON.stringify(path.join(HERE, "..", "browser-guards.mjs"))};
       loadDismissals(${JSON.stringify(dir)}, "x", "capture");`,
    ],
    { encoding: "utf8" },
  );
  assert.equal(run.status, 2);
  assert.match(run.stderr, /step 1 is neither/);
});

/* ------------------------------------------------------------------ item 1: a stranger's ids never reach a path */

test("plainName accepts letters, digits, dash and underscore and nothing else", () => {
  for (const good of ["p3", "opt-a", "report_open-2", "A1"]) assert.equal(plainName(good), true, good);
  for (const bad of ["", "../x", "a/b", "a\\b", "a.b", "a b", "p3\n", ".", "..", "%2e%2e", "p3\0", 7, null, undefined, {}, "x".repeat(121)])
    assert.equal(plainName(bad), false, JSON.stringify(bad));
});

test("vetComments refuses a record whose id, frame or box could do harm, and keeps the rest", () => {
  const region = { x: 1, y: 2, w: 3, h: 4 };
  const { usable, refused } = vetComments([
    { id: "p1", frame: "opt-a", region },
    { id: "../../pwned", frame: "opt-a", region },
    { id: "p3", frame: "../../etc/passwd", region },
    { id: "p4", frame: "opt-a", region: "not a box" },
    { id: "p5", frame: "opt-a", region: { x: 1, y: 2, w: NaN, h: 4 } },
    null,
    { id: "constructor", frame: "opt-b", region },
  ]);
  assert.deepEqual(usable.map((one) => one.id), ["p1", "constructor"]);
  assert.equal(refused.length, 5);
  assert.match(refused[0].why, /id .* is not a plain name/);
  assert.match(refused[1].why, /frame .* is not a plain name/);
  assert.match(refused[2].why, /box/);
});

test("inside refuses a path that leaves its base", () => {
  const base = scratch();
  assert.equal(inside(base, "shots", "a.webp"), path.join(base, "shots", "a.webp"));
  assert.throws(() => inside(base, "..", "x.png"), /outside/);
  assert.throws(() => inside(base, "comments", "../../x.png"), /outside/);
});

/* ------------------------------------------------------------------ item 7: snapshots and what changed elsewhere */

test("describeChange and sayChange name what was added, removed and edited, whatever the key order", () => {
  const before = { comments: [{ id: "p1", note: "a", by: "x" }, { id: "p2", note: "b" }, { id: "p3", note: "c" }] };
  const after = { comments: [{ by: "x", note: "a", id: "p1" }, { id: "p3", note: "changed" }, { id: "p4", note: "new" }] };
  const change = describeChange(before, after);
  assert.deepEqual(change, { added: ["p4"], removed: ["p2"], edited: ["p3"] });
  assert.equal(sayChange(change), "1 new (p4), 1 removed (p2), 1 edited (p3)");
});

test("the team page never reuses a deleted comment's id, so a removal is reported as one", () => {
  /* The page numbers from maxId as well as from the comments it holds (review/page.html, nextId). */
  const page = readFileSync(path.join(HERE, "..", "review", "page.html"), "utf8");
  assert.match(page, /function nextId\(\) \{ return "p" \+ \(Math\.max\(review\.maxId \|\| 0, highest\(review\.comments\)\) \+ 1\); \}/);
  const before = { comments: [{ id: "p1", note: "a" }, { id: "p2", note: "b" }, { id: "p3", note: "c" }], maxId: 3 };
  const after = { comments: [{ id: "p1", note: "a" }, { id: "p2", note: "b" }, { id: "p4", note: "d" }], maxId: 4 };
  assert.deepEqual(describeChange(before, after), { added: ["p4"], removed: ["p3"], edited: [] });
});

test("snapshotReview keeps every distinct version once, byte for byte, and never rewrites one", () => {
  const out = scratch();
  const one = '{\n  "comments": [{"id":"p1"}]\n}\n';
  const two = '{\n  "comments": [{"id":"p1"},{"id":"p2"}]\n}\n';
  const first = snapshotReview(out, one, "live");
  assert.equal(first.wrote, true);
  assert.equal(readFileSync(first.file, "utf8"), one);
  assert.equal(snapshotReview(out, one, "live").wrote, false, "the same bytes again adds nothing");
  const second = snapshotReview(out, two, "answered");
  assert.equal(second.wrote, true);
  assert.equal(snapshotReview(out, one, "live").wrote, false, "an older version coming back is still the same version");
  assert.equal(readdirSync(path.join(out, "snapshots")).length, 2);
});

test("takeLive reports a removed comment, keeps the live copy, and makes it the working review.json", () => {
  const out = scratch();
  const lines = [];
  const log = console.log;
  console.log = (line) => lines.push(String(line));
  try {
    takeLive({ who: "t", outDir: out, liveText: JSON.stringify({ comments: [{ id: "p1" }, { id: "p2" }] }), source: "live", relativeTo: out });
    takeLive({ who: "t", outDir: out, liveText: JSON.stringify({ comments: [{ id: "p1" }, { id: "p9" }] }), source: "live", relativeTo: out });
  } finally {
    console.log = log;
  }
  assert.ok(lines.some((line) => /first snapshot/.test(line)));
  assert.ok(lines.some((line) => /changed elsewhere/.test(line) && /1 new \(p9\)/.test(line) && /1 removed \(p2\)/.test(line)));
  assert.ok(lines.some((line) => /WARNING/.test(line) && /p2/.test(line)), "a removed comment is a warning");
  assert.deepEqual(JSON.parse(readFileSync(path.join(out, "review.json"), "utf8")).comments.map((one) => one.id), ["p1", "p9"]);
  assert.equal(existsSync(path.join(out, "snapshots")), true);
  mkdirSync(path.join(out, "x"), { recursive: true });
});

test("no output line names the retired --changed flag; only the capture's own note that it is still accepted mentions it", () => {
  const toolDir = path.join(HERE, "..");
  const scriptsDir = path.join(HERE, "..", "..", "scripts");
  const files = [
    ...readdirSync(toolDir).filter((name) => name.endsWith(".mjs")).map((name) => path.join(toolDir, name)),
    ...readdirSync(scriptsDir).filter((name) => name.endsWith(".mjs")).map((name) => path.join(scriptsDir, name)),
  ];
  const offenders = [];
  for (const file of files)
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, at) => {
        if (!line.includes("--changed")) return;
        /* A comment line is documentation, not output. */
        if (/^\s*(\*|\/\/|\/\*)/.test(line)) return;
        offenders.push(`${path.basename(file)}:${at + 1}`);
      });
  assert.deepEqual(offenders, []);
});

test("a run waits for a dev server that has not reloaded the declaration yet, and gives up after its bound", async () => {
  /* The server learns the new frame on the third ask. */
  let asks = 0;
  const reloading = async () => (++asks >= 3 ? new Set(["a", "b", "new"]) : new Set(["a", "b"]));
  assert.deepEqual(await waitForServedFrames(reloading, ["a", "b", "new"], { timeoutMs: 2_000, intervalMs: 10 }), []);
  assert.equal(asks, 3);
  /* One that never learns it: the ids still unknown come back once the bound has passed. */
  const started = Date.now();
  assert.deepEqual(await waitForServedFrames(async () => new Set(["a"]), ["a", "new"], { timeoutMs: 100, intervalMs: 20 }), ["new"]);
  assert.ok(Date.now() - started >= 100);
  /* Nothing to wait for: one ask. */
  let once = 0;
  assert.deepEqual(await waitForServedFrames(async () => (once++, new Set(["a"])), ["a"]), []);
  assert.equal(once, 1);
});
