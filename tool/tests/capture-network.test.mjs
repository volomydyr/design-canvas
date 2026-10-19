/**
 * Tests for what the capture does with `network` rules, selector steps and broken pictures, on REAL pages: the real `capture.mjs`,
 * `preflight.mjs`, `round.mjs` and `capture-run.mjs`, run as child processes in a scratch project, against a fixture app and a fake
 * GraphQL API (`fixture-app.mjs`). It proves:
 *
 *   - a held, failed and answered request each photograph the state they say, and the same route with no rule is the live page
 *   - four frames of ONE route run at once in lanes, and one frame's held request reaches no other frame (a held request never
 *     reaches the server at all, not even when its page closes, and the second pass starts on a clean page)
 *   - every save is aborted (the context's write guard), and a frame can answer a save with a refusal instead
 *   - an answer carries the CORS headers when the API is on another origin
 *   - a rule the page never asks for FAILS the frame, in the capture and in the preflight's live pass, and a hold does not wait out
 *     the loading placeholders it asked for
 *   - the wait for data that arrives with no skeleton and no claim (the quiet wait), and `--no-network-wait` switching it off
 *   - a step that cannot be done is listed apart (`  !`), never queued for the second pass
 *   - the broken-shot guard keeps a picture of a page that did not arrive out of a canvas, and lets a real redesign through
 *   - THE SAME FRAMES from every way the capture runs: the declaration read from the dump (`--screens-file`) or from the served
 *     route, with and without the warm pass, through `round.mjs` (the DEV path: preflight, then capture) and through `capture-run.mjs`
 *     (the PRODUCTION path: the dump, no warm pass), with `--lanes` reaching the capture from both
 *
 * They need Playwright and esbuild, which a project carries and the skill does not: point CANVAS_TEST_PROJECT at a project that has
 * both (only its node_modules is used, read only) and they run; without it they are skipped, by name, never silently.
 *
 *   CANVAS_TEST_PROJECT=/path/to/project node --test tool/tests/capture-network.test.mjs
 *
 * Nothing here touches a dev server: the fixture app is a throwaway server on a port the system picks.
 *
 * NOT INSTALLED into a project: the installer copies only the files it lists.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

import { NEAR_EMPTY_CHARS, SHRINK_RATIO } from "../shot-guard.mjs";
import { startFixture } from "./fixture-app.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.join(HERE, "..", "..");
const TOOL = path.join(SKILL, "tool");
const PROJECT = process.env.CANVAS_TEST_PROJECT;
const needsProject = (name, run) =>
  PROJECT ? test(name, { timeout: 400_000 }, run) : test(name, { skip: "set CANVAS_TEST_PROJECT to a project that has playwright and esbuild to run this test" }, run);

const made = [];
const scratch = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "canvas-capture-network-"));
  made.push(dir);
  return dir;
};
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ the fixture app and its API */

/** In-process, for the tests that read the API's counts directly. The ones that hand a server to `capture-run.mjs` use `startChild`. */
let fixture;
before(async () => {
  if (PROJECT) fixture = await startFixture({ host: "127.0.0.1" });
});
after(() => fixture?.close());
const base = () => `http://127.0.0.1:${fixture.port}`;

/** The fixture as its OWN process, which is what a server `capture-run.mjs --reuse` is pointed at looks like, with HTTP control endpoints. */
async function startChild() {
  const child = spawn(process.execPath, [path.join(HERE, "fixture-app.mjs"), "0"], { stdio: ["ignore", "pipe", "inherit"] });
  const port = await new Promise((resolve, reject) => {
    child.on("exit", () => reject(new Error("the fixture process ended before it was listening")));
    child.stdout.on("data", (chunk) => {
      const found = /fixture listening (\d+)/.exec(String(chunk));
      if (found) resolve(Number(found[1]));
    });
  });
  const url = `http://127.0.0.1:${port}`;
  return {
    port,
    url,
    stop: () => child.kill("SIGTERM"),
    seen: async () => (await fetch(`${url}/__seen`)).json(),
    serve: (slug, json) => fetch(`${url}/__served?canvas=${slug}`, { method: "PUT", body: json }),
  };
}

/* ------------------------------------------------------------------ a scratch project, and runs of the real tools */

/** A project with the skill's tools installed the way the installer lays them out, and the prototype's node_modules beside it. */
function makeProject() {
  const dir = scratch();
  symlinkSync(path.join(PROJECT, "node_modules"), path.join(dir, "node_modules"));
  const canvas = path.join(dir, "design-canvas");
  mkdirSync(path.join(canvas, "project"), { recursive: true });
  for (const file of readdirSync(TOOL)) if (file.endsWith(".mjs")) copyFileSync(path.join(TOOL, file), path.join(canvas, file));
  cpSync(path.join(SKILL, "core"), path.join(canvas, "core"), { recursive: true, filter: (source) => !source.includes("__tests__") });
  return { dir, canvas };
}

/* Labels follow the canvas's own copy rules (Title Case), because the preflight checks them. */
const titleCase = (id) => id.split("-").map((word) => `${word[0].toUpperCase()}${word.slice(1)}`).join(" ");
const screen = (id, route, extra = {}) => ({
  id,
  label: titleCase(id),
  note: "A frame of the fixture app",
  route,
  kind: "Fixture",
  expect: ["Fixture App"],
  oneViewport: true,
  ...extra,
});

/** The declaration of one canvas, written as the project's own `project/flows.ts`. */
const declaration = (screens, extra = {}) => ({
  title: "Fixture",
  note: "The fixture canvas.",
  viewport: { w: 1440, h: 900 },
  frameScale: 0.8,
  flows: [{ id: "fixture", title: "Fixture", note: "Frames of the fixture app.", screens, edges: [] }],
  ...extra,
});

function writeFlows(project, canvases) {
  writeFileSync(path.join(project.canvas, "project", "flows.ts"), `export const CANVASES = ${JSON.stringify(canvases, null, 2)};\n`);
}

/** `dump-screens.mjs` run for real, which is how `capture-run.mjs` and `round.mjs` give the capture its declaration. */
function dump(project, slug) {
  const result = spawnSync(process.execPath, [path.join(project.canvas, "dump-screens.mjs"), "--canvas", slug], { cwd: project.dir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  assert.equal(result.status, 0, `dump-screens failed: ${result.stderr}`);
  const file = path.join(project.dir, `${slug}.screens.json`);
  writeFileSync(file, result.stdout);
  return { file, json: JSON.parse(result.stdout) };
}

/** One of the tools run for real. Asynchronous, because the in-process fixture lives in THIS process and must stay free to answer. */
function runTool(project, script, args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(project.canvas, script), ...args], { cwd: project.dir, env: { ...process.env, ...env } });
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (out += chunk));
    child.on("close", (code) => resolve({ code, out }));
  });
}
const capture = (project, slug, extra = [], env = {}) =>
  runTool(project, "capture.mjs", ["--canvas", slug, "--url", base(), "--no-login-check", "--delta-out", path.join(project.dir, "delta"), ...extra], env);

const manifestOf = (project, slug) => JSON.parse(readFileSync(path.join(project.canvas, "shots", slug, "manifest.json"), "utf8"));
const shotOf = (manifest, id) => manifest.shots.find((one) => one.screenId === id);
const claimsMet = (shot) => shot.claims.every((one) => one.met);
const resultLine = (out, id) => out.split("\n").find((line) => new RegExp(`^(ok  |FAIL|STEP|hold|KEPT) ${id}\\b`).test(line)) ?? "";

/* ------------------------------------------------------------------ the frames */

const LIST_EMPTY = { taskList: { data: [], totalRecords: 0 } };
/**
 * The frames. ONE ADDRESS FOR EVERY TASKS FRAME unless `distinct` is set, which is the real case (a loading, an empty and a failed list
 * share a route) and the one that found a held request reaching the server when its page closed: with a `?frame=` on each route that
 * never showed. `distinct` puts the frame's name in the address, so the API's log can say WHICH frame asked.
 */
const frames = ({ distinct = false } = {}) => {
  const tasks = (frame) => (distinct ? `/tasks?frame=${frame}` : "/tasks");
  return [
    /* The live frame is FIRST on purpose: the capture opens the first frame's route bare, with no rules, to see a sign-in redirect (the
       login probe), and the warm pass opens every route bare to make a dev server compile it. Both ask the real server by design; a
       frame's own page is what carries its rules. */
    screen("tasks-live", tasks("live"), { expect: ["Task 1", "Task 2"] }),
    screen("tasks-loading", tasks("loading"), { network: [{ hold: "TaskList" }], expect: ["Open Tasks", "Loading tasks"] }),
    screen("tasks-empty", tasks("empty"), { network: [{ answer: "TaskList", data: LIST_EMPTY }], expect: ["No tasks yet"], expectMissing: "Task 1" }),
    screen("tasks-error", tasks("error"), { network: [{ fail: "TaskList", message: "Offline" }], expect: ["Could not load tasks"] }),
    screen("tasks-filter", tasks("filter"), {
      steps: [{ waitFor: "css=[data-testid=open-filter]" }, { click: "css=[data-testid=open-filter]" }, { waitFor: "css=[role=dialog]" }],
      expect: ["Filter tasks"],
    }),
    screen("save-aborted", "/save", { steps: [{ click: "Save task" }, { waitText: "Could not save" }], expect: ["Could not save"] }),
    screen("save-refused", "/save", {
      network: [{ answer: "SaveTask", data: null, errors: [{ message: "refused", extensions: { code: 403 } }] }],
      steps: [{ click: "Save task" }, { waitText: "Save refused: refused" }],
      expect: ["Save refused: refused"],
    }),
    screen("cors-answered", "/cors", { network: [{ answer: "CorsList", data: { corsList: { total: 0 } } }], expect: ["Cors items: 0"] }),
    screen("total-late", "/total", { expect: ["Totals"], expectMissing: "Total: 0" }),
  ];
};
const GOOD = frames().map((one) => one.id);
const BAD = [
  screen("never-asked", "/plain", { network: [{ hold: "TaskList" }] }),
  screen("stale-step", "/plain", { steps: [{ click: "css=[data-testid=gone]" }] }),
];
const withWrites = (list) => declaration(list, { network: [{ writes: "abort" }] });

/* ------------------------------------------------------------------ the tests */

needsProject("the capture holds, fails and answers a frame's data, runs frames of one route in lanes without leaks, and aborts every save", async () => {
  const project = makeProject();
  writeFlows(project, { fixture: withWrites([...frames(), ...BAD]) });
  const { file, json } = dump(project, "fixture");

  /* THE DECLARATION REACHES THE CAPTURE WITH ITS RULES: the dump carries each frame's own list and the canvas-wide one. */
  assert.deepEqual(json.network, [{ writes: "abort" }]);
  assert.deepEqual(json.screens.find((one) => one.id === "tasks-loading").network, [{ hold: "TaskList" }]);
  assert.deepEqual(json.screens.find((one) => one.id === "tasks-live").network, [], "a frame with no rules carries an empty list, as the route serves it");

  const before = fixture.mark();
  const run = await capture(project, "fixture", ["--screens-file", file, "--no-warm", "--all", "--lanes", "4"]);
  const manifest = manifestOf(project, "fixture");
  assert.match(run.out, /capturing 11 screen\(s\), 4 at a time/);

  /* Every frame of the route is its own page: four were in flight at once and each one is what its rule says. */
  for (const id of GOOD) {
    const shot = shotOf(manifest, id);
    assert.ok(shot, `${id} was captured\n${run.out}`);
    assert.ok(claimsMet(shot), `${id} proved its claims: ${JSON.stringify(shot.claims)}\n${run.out}`);
    assert.equal(shot.stable, true, `${id} came out identical twice`);
    /* THE QUARTER-SCALE COPY the canvas draws zoomed out: written beside the picture, its size in the manifest. */
    assert.deepEqual(shot.small, { w: Math.round(shot.w / 4), h: Math.round(shot.h / 4) }, `${id} records its small copy`);
    const small = readFileSync(path.join(project.canvas, "shots", "fixture", "small", shot.file));
    assert.ok(small.byteLength > 0 && small.byteLength < shot.bytes, `${id}: the copy is smaller than the picture`);
  }
  assert.deepEqual(shotOf(manifest, "tasks-loading").network, [{ rule: "hold TaskList", scope: "screen", hits: 1 }]);
  assert.deepEqual(shotOf(manifest, "tasks-empty").network, [{ rule: "answer TaskList", scope: "screen", hits: 1 }]);
  assert.deepEqual(shotOf(manifest, "tasks-error").network, [{ rule: "fail TaskList", scope: "screen", hits: 1 }]);
  assert.equal(shotOf(manifest, "tasks-live").network, undefined, "a frame with no rules records none");
  assert.match(resultLine(run.out, "tasks-loading"), /net=\[hold TaskList x1\]/);

  /* The four pictures of one route are four different pictures. */
  const hashes = ["tasks-loading", "tasks-live", "tasks-empty", "tasks-error"].map((id) => shotOf(manifest, id).hash);
  assert.equal(new Set(hashes).size, 4, "loading, live, empty and failed look different");

  /* A HELD REQUEST NEVER REACHES THE SERVER, and nothing leaked from one lane to another: only the two frames with no rule asked the real API. */
  assert.equal(fixture.since(before, "TaskList"), 2, `tasks-live and tasks-filter reached the API; the held, answered and failed frames did not. Asked by: ${fixture.state.askedBy.join(" | ")}`);

  /* EVERY SAVE IS ABORTED AND NEVER REACHES THE SERVER, and the guard names it; a frame can answer a save with a refusal instead. */
  assert.equal(fixture.since(before, "SaveTask"), 0, "no save reached the server");
  assert.match(run.out, /write guard blocked mutation SaveTask/);

  /* AN ANSWER CARRIES THE CORS HEADERS: the page asked another origin, and got the capture's answer. */
  assert.equal(fixture.since(before, "CorsList"), 0, "the real API of the other origin was never asked");

  /* THE QUIET WAIT: the data of total-late arrives after 4.5 seconds with no skeleton and nothing to wait for but the network. */
  assert.ok(claimsMet(shotOf(manifest, "total-late")), "the frame is not the zero state: the capture waited for the data to be in");

  /* A hold is not failed for its own placeholders, and a rule the page never asked for IS failed, by name. */
  assert.ok(!/tasks-loading.*finished loading/.test(run.out), "the held frame's skeleton is its picture");
  assert.match(run.out, /never-asked: captured a page that does not have "the page asked for TaskList and the capture held it"/);

  /* A STEP THAT CANNOT BE DONE: listed apart, naming the step, not queued for the second pass, and not on the problem list. */
  assert.match(resultLine(run.out, "stale-step"), /^STEP stale-step\s+step 1 \(click "css=\[data-testid=gone\]"\): no visible element matching css=\[data-testid=gone\]/);
  assert.match(run.out, /1 FRAME\(S\) WHOSE STEPS COULD NOT BE DONE, not run again/);
  assert.ok(!/stale-step.*second pass queued/.test(run.out), "a stale step is not retried");
  const problems = new Set(run.out.split("\n").map((line) => /^\s+- ([a-zA-Z0-9_-]+):/.exec(line)?.[1]).filter(Boolean));
  assert.ok(problems.has("never-asked"), "a frame that failed its claims is on the problem list");
  assert.ok(!problems.has("stale-step"), "a stale step is listed apart, not with the problems");
  assert.equal(shotOf(manifest, "stale-step"), undefined, "nothing was written for a frame whose steps could not be done");
  assert.equal(run.code, 1);

  /* THE QUIET WAIT IS WHAT MAKES total-late PASS: without it the frame is photographed while the total still reads zero. */
  const without = await capture(project, "fixture", ["--screens-file", file, "--no-warm", "--only", "total-late", "--no-network-wait"]);
  assert.equal(without.code, 1, without.out);
  assert.match(without.out, /nothing saying "Total: 0"/);
  assert.match(without.out, /KEPT total-late/, "the earlier picture, taken after the data arrived, stayed on the canvas");
});

needsProject("the same declaration gives the same results from a dump file and read in process, with and without the warm pass", async () => {
  const project = makeProject();
  writeFlows(project, { fixture: withWrites(frames()), "fixture-route": withWrites(frames()) });
  const fromFile = dump(project, "fixture");

  /* A frozen file (no warm pass) against the declaration read in process from project/flows.ts (warm pass included). */
  const before = fixture.mark();
  const [a, b] = [
    await capture(project, "fixture", ["--screens-file", fromFile.file, "--no-warm", "--all", "--lanes", "2"]),
    await capture(project, "fixture-route", ["--all", "--lanes", "2"]),
  ];
  assert.equal(a.code, 0, a.out);
  assert.equal(b.code, 0, b.out);
  assert.match(b.out, /warming \d+ route\(s\)/, "the second run really did the warm pass");
  assert.ok(!/warming/.test(a.out));
  const [left, right] = [manifestOf(project, "fixture"), manifestOf(project, "fixture-route")];
  assert.deepEqual(left.shots.map((one) => one.screenId), right.shots.map((one) => one.screenId));
  for (const id of GOOD) {
    const [one, other] = [shotOf(left, id), shotOf(right, id)];
    assert.deepEqual(one.claims, other.claims, `${id}: the same claims, met the same way`);
    assert.deepEqual(one.network, other.network, `${id}: the same rules, hit the same number of times`);
    assert.deepEqual([one.w, one.h, one.wholePage], [other.w, other.h, other.wholePage], `${id}: the same frame`);
    assert.equal(one.hash, other.hash, `${id}: the same picture, byte for byte`);
  }
  assert.equal(fixture.since(before, "SaveTask"), 0, "no save reached the server on either path");

  /* The served route fills defaults the dump leaves out. A frame captured from the dump is current when read in that shape. */
  const routeShaped = path.join(project.dir, "route-shaped.json");
  writeFileSync(routeShaped, JSON.stringify({
    ...fromFile.json,
    screens: fromFile.json.screens.map((one) => ({ device: "desktop", expectMissing: [], oneViewport: false, steps: [], ...one })),
  }));
  const plan = await capture(project, "fixture", ["--screens-file", routeShaped, "--plan"]);
  assert.equal(plan.code, 0, plan.out);
  assert.match(plan.out, /^plan: $/m, `nothing to recapture after switching paths: ${plan.out}`);
  /* `--first` puts the frames on the reviewer's screen at the front of the queue and leaves the selection as it was. */
  const wanted = [GOOD.at(-1), GOOD[0]];
  const ordered = await capture(project, "fixture", ["--screens-file", routeShaped, "--plan", "--all", "--first", wanted.join(",")]);
  const all = await capture(project, "fixture", ["--screens-file", routeShaped, "--plan", "--all"]);
  const ids = (out) => /^plan: (.*)$/m.exec(out)[1].split(",");
  assert.deepEqual(ids(ordered.out).slice(0, 2), wanted, ordered.out);
  assert.deepEqual([...ids(ordered.out)].sort(), [...ids(all.out)].sort());
});

needsProject("round.mjs (the dev path) and capture-run.mjs (the production path) give the same frames, take --lanes, and let no held request or save reach the server", async () => {
  const child = await startChild();
  try {
    const list = withWrites(frames({ distinct: true }));
    const [dev, prod] = [makeProject(), makeProject()];
    for (const project of [dev, prod]) writeFlows(project, { fixture: list });
    /* The dev path reads the project's settings, and asks the server at that address for the declaration it serves. */
    writeFileSync(path.join(dev.canvas, "settings.json"), `${JSON.stringify({ appUrl: child.url })}\n`);
    const { json } = dump(dev, "fixture");
    await child.serve("fixture", JSON.stringify(json));

    /* round.mjs: the declaration dump, the server check, the preflight (the static checks, then the planned frames opened on the served
       app WITH their network rules and steps), the capture, the contact sheet. The oracle needs the app's canvas page, which a fixture has not. */
    const round = await runTool(dev, "round.mjs", ["--canvas", "fixture", "--no-check", "--lanes", "2"]);
    assert.equal(round.code, 0, round.out);
    assert.match(round.out, /PREFLIGHT PASS|preflight/i);
    assert.match(round.out, /capturing 9 screen\(s\), 2 at a time/, "--lanes reached the capture through round.mjs");
    assert.match(round.out, /ok\s+tasks-loading\s/, "the preflight's live pass proved the loading frame's claims on a page that was loading");

    /* capture-run.mjs against the same server: the production path, which reads the dump and warms nothing. */
    const production = await runTool(prod, "capture-run.mjs", ["--canvas", "fixture", "--port", String(child.port), "--reuse", "--lanes", "2"]);
    assert.equal(production.code, 0, production.out);
    assert.match(production.out, /capturing 9 screen\(s\), 2 at a time/, "--lanes reached the capture through capture-run.mjs");
    assert.ok(!/warming/.test(production.out));

    const [left, right] = [manifestOf(dev, "fixture"), manifestOf(prod, "fixture")];
    assert.deepEqual(left.shots.map((one) => one.screenId), right.shots.map((one) => one.screenId));
    for (const id of GOOD) {
      const [one, other] = [shotOf(left, id), shotOf(right, id)];
      assert.ok(claimsMet(one) && claimsMet(other), `${id} proved its claims on both paths`);
      assert.deepEqual(one.claims, other.claims, `${id}: the same claims`);
      assert.deepEqual(one.network, other.network, `${id}: the same rules, hit the same number of times`);
        assert.equal(one.hash, other.hash, `${id}: the same picture, byte for byte`);
    }

    /* Whatever ran, on either path, the held, answered and failed frames never reached the real API, and no save did. */
    const { seen, askedBy } = await child.seen();
    const asked = askedBy.filter((line) => line.startsWith("TaskList")).map((line) => line.split(" ")[1]);
    assert.ok(asked.length >= 4, `the two live frames asked, on both paths: ${asked.join(" ")}`);
    for (const who of asked) assert.match(who, /frame=(live|filter)$/, `only a frame with no rule asked the real API: ${who}`);
    assert.equal(seen.SaveTask, undefined, "no save reached the server on either path");
    assert.equal(seen.CorsList, undefined, "the other origin's API was never asked");
  } finally {
    child.stop();
  }
});

needsProject("capture-run.mjs runs the capture once and passes its exit code on, and the preflight's live pass names a rule its page never asked for", async () => {
  const child = await startChild();
  try {
    const project = makeProject();
    writeFlows(project, { fixture: declaration([screen("fine", "/plain"), screen("stale-step", "/plain", { steps: [{ click: "css=[data-testid=gone]" }] })]), asked: declaration([screen("never-asked", "/plain", { network: [{ hold: "TaskList" }] })]) });
    const run = await runTool(project, "capture-run.mjs", ["--canvas", "fixture", "--port", String(child.port), "--reuse"]);
    assert.equal(run.code, 1, run.out);
    assert.match(run.out, /STEP stale-step/);
    assert.equal(run.out.match(/step 1 \(click "css=\[data-testid=gone\]"\)/g)?.length, 2, "named once on its own line and once in the list apart, and never run again");
    assert.equal(shotOf(manifestOf(project, "fixture"), "fine").screenId, "fine", "the other frame was captured");

    /* The preflight's live pass proves the frame's own rules in seconds, without photographing: a stale rule is named. */
    const preflight = await runTool(project, "preflight.mjs", ["--canvas", "asked", "--url", child.url, "--live", "--only", "never-asked", "--no-claims"]);
    assert.equal(preflight.code, 1, preflight.out);
    assert.match(preflight.out, /never-asked: the served page never asked for TaskList, so its rule "hold TaskList" matches nothing/);
    assert.match(preflight.out, /PREFLIGHT FAIL \(1\): live 1/);
  } finally {
    child.stop();
  }
});

needsProject("a rule on an address holds, fails and answers a REST request the page makes, and the real API hears only the live frame", async () => {
  const project = makeProject();
  writeFlows(project, {
    rest: declaration([
      screen("rest-live", "/rest", { expect: ["Trips: 3"] }),
      screen("rest-loading", "/rest", { network: [{ hold: "/api/rest/trips" }], expect: ["Loading trips"] }),
      screen("rest-empty", "/rest", { network: [{ answer: "/api/rest/trips", data: { count: 0 } }], expect: ["No trips yet"] }),
      screen("rest-error", "/rest", { network: [{ fail: "/api/rest/trips", message: "Offline" }], expect: ["Could not load trips (500)"] }),
    ]),
  });
  const before = fixture.mark();
  const run = await capture(project, "rest", ["--no-warm", "--all"]);
  assert.equal(run.code, 0, run.out);
  const manifest = manifestOf(project, "rest");
  for (const id of ["rest-live", "rest-loading", "rest-empty", "rest-error"]) assert.ok(claimsMet(shotOf(manifest, id)), `${id}: ${run.out}`);
  assert.deepEqual(shotOf(manifest, "rest-loading").network, [{ rule: "hold /api/rest/trips", scope: "screen", hits: 1 }]);
  assert.equal(fixture.since(before, "rest"), 1, "only the live frame reached the real address");
});

needsProject("a rule or a step that cannot run stops the capture before any browser, with the screen and the position", async () => {
  const project = makeProject();
  writeFlows(project, {
    fixture: declaration(
      [
        screen("bad-rule", "/plain", { network: [{ hold: "A" }, { wait: "B" }] }),
        screen("bad-step", "/plain", { steps: [{ hover: "css=" }] }),
        screen("bad-writes", "/tasks", { network: [{ writes: "abort" }] }),
      ],
      { network: [{ writes: "block" }] },
    ),
  });
  const { file } = dump(project, "fixture");
  const run = await capture(project, "fixture", ["--screens-file", file]);
  assert.equal(run.code, 2, run.out);
  assert.match(run.out, /4 declaration\(s\) hold steps or network rules that cannot run/);
  assert.match(run.out, /the canvas: network\[0\] writes takes "abort"/);
  assert.match(run.out, /bad-rule: network\[1\] has an unknown rule "wait"/);
  assert.match(run.out, /bad-step: steps\[0\] hover needs a selector after "css="/);
  assert.match(run.out, /bad-writes: network\[0\] writes is declared once, on the canvas/);
  /* A bad lane count stops the run just as early, with a valid declaration. The command line and the environment both say it. */
  writeFlows(project, { fixture: declaration([screen("fine", "/plain")]) });
  const fine = dump(project, "fixture");
  const lanes = await capture(project, "fixture", ["--screens-file", fine.file, "--lanes", "0"]);
  assert.equal(lanes.code, 2, lanes.out);
  assert.match(lanes.out, /--lanes \(or CANVAS_LANES\) takes a whole number from 1 to 16, not "0"/);
  const envLanes = await capture(project, "fixture", ["--screens-file", fine.file], { CANVAS_LANES: "many" });
  assert.equal(envLanes.code, 2, envLanes.out);
  assert.match(envLanes.out, /takes a whole number from 1 to 16, not "many"/);
  assert.ok(!/warming|ok /.test(`${lanes.out}${envLanes.out}`), "nothing was photographed or warmed");
});

needsProject("the broken-shot guard keeps a picture of a page that did not arrive, lets a real redesign through, and sparse switches it off", async () => {
  const project = makeProject();
  writeFlows(project, {
    guard: declaration([
      /* Both pages ask for TaskList on every load, and both frames hold it: the real API must never hear of it. */
      screen("flaky", "/flaky", { network: [{ hold: "TaskList" }] }),
      screen("flaky-sparse", "/flaky2", { sparse: true, network: [{ hold: "TaskList" }] }),
    ]),
  });
  const { file } = dump(project, "guard");
  const args = ["--screens-file", file, "--no-warm", "--all"];
  const before = fixture.mark();

  fixture.state.flakyMode = "good";
  const first = await capture(project, "guard", args);
  assert.equal(first.code, 0, first.out);
  const good = manifestOf(project, "guard");
  const [flakyGood, sparseGood] = [shotOf(good, "flaky"), shotOf(good, "flaky-sparse")];
  const smallOf = (id) => readFileSync(path.join(project.canvas, "shots", "guard", "small", `${id}.webp`));
  const flakySmall = smallOf("flaky");
  if (process.env.STILLS_DEBUG) console.log(`guard sizes: good ${flakyGood.bytes}`);

  /* A skeleton with no words where a rich page was: far smaller, almost no text. Held for the second pass, then kept. */
  fixture.state.flakyMode = "skeleton";
  const broken = await capture(project, "guard", args);
  assert.equal(broken.code, 1, broken.out);
  const afterBroken = manifestOf(project, "guard");
  assert.equal(shotOf(afterBroken, "flaky").hash, flakyGood.hash, "the picture on the canvas is the one that worked");
  assert.ok(smallOf("flaky").equals(flakySmall), "and so is its small copy: a refused capture leaves both in place");
  assert.match(broken.out, /hold flaky\s+.*looks like a page that did not arrive \(sparse: true says the page is meant to be this small\) — second pass queued/s);
  assert.match(broken.out, /a picture of \d+kb where the last one was \d+kb, from a page with \d+ characters? of text: it looks like a page that did not arrive/);
  assert.match(broken.out, /KEPT flaky\b/);
  assert.match(broken.out, /flaky: captured .*on both passes, so the previous picture was KEPT/);
  /* sparse says the page IS this empty: the new picture is written. */
  assert.notEqual(shotOf(afterBroken, "flaky-sparse").hash, sparseGood.hash, "a sparse frame is allowed to be small");
  assert.ok(!/KEPT flaky-sparse/.test(broken.out));
  if (process.env.STILLS_DEBUG) console.log(`guard sizes: skeleton ${shotOf(afterBroken, "flaky-sparse").bytes}`);
  /* THE HOLD APPLIED ON BOTH PASSES: the page asks for TaskList every time, and the real API never heard of it. */
  assert.equal(fixture.since(before, "TaskList"), 0, "the held request reached no server on the first pass, on the second pass or on any run");

  /* A short page that really is this small, with words on it, is a redesign and goes through. */
  fixture.state.flakyMode = "empty";
  const redesign = await capture(project, "guard", args);
  assert.equal(redesign.code, 0, redesign.out);
  const afterRedesign = manifestOf(project, "guard");
  assert.notEqual(shotOf(afterRedesign, "flaky").hash, flakyGood.hash, "the new, smaller picture replaced the old one");
  assert.ok(shotOf(afterRedesign, "flaky").bytes < flakyGood.bytes * SHRINK_RATIO, "it IS far smaller: only its text lets it through");
  if (process.env.STILLS_DEBUG) console.log(`guard sizes: empty ${shotOf(afterRedesign, "flaky").bytes} (limit ${Math.round(flakyGood.bytes * SHRINK_RATIO)}), ${NEAR_EMPTY_CHARS} chars`);
});

needsProject("a capture says which frames are new, changed, renamed and removed, and queues them for the reviewer", async () => {
  const project = makeProject();
  const answered = (total) => ({ network: [{ answer: "CorsList", data: { corsList: { total } } }] });
  const first = declaration([
    screen("keep", "/plain"),
    screen("move", "/save"),
    screen("edit", "/dialog", { expect: ["Dialog over the whole window"] }),
    screen("old-name", "/cors", answered(0)),
    screen("drop", "/plain?drop=1"),
  ]);
  writeFlows(project, { lineage: first });
  const args = (file) => ["--screens-file", file, "--no-warm", "--all"];
  const one = await capture(project, "lineage", args(dump(project, "lineage").file));
  assert.equal(one.code, 0, one.out);
  assert.match(one.out, /frames: 5 new \(/, "a first capture has nothing before it");
  const review = path.join(project.canvas, "comments", "lineage.json");
  assert.ok(!existsSync(review), "nothing is queued before the reviewer's first visit, so no review file is written");

  /* The reviewer has visited, and one frame is still waiting from an earlier round: its entry follows it through the rename. */
  mkdirSync(path.join(project.canvas, "comments"), { recursive: true });
  writeFileSync(review, JSON.stringify({ comments: [], waiting: { move: "new", drop: "changed" }, viewedAt: "2026-01-01T00:00:00.000Z" }));

  writeFlows(project, {
    lineage: declaration(
      [
        screen("keep", "/plain"),
        /* Renamed with the same picture and no entry anywhere. */
        screen("moved", "/save"),
        /* The same id, a different picture. */
        screen("edit", "/plain?edit=1"),
        /* Renamed and redrawn at once, which only `successors` can say. */
        screen("new-name", "/cors", answered(5)),
        screen("added", "/dialog", { expect: ["Dialog over the whole window"] }),
      ],
      { successors: { "old-name": "new-name" } },
    ),
  });
  const two = await capture(project, "lineage", args(dump(project, "lineage").file));
  assert.equal(two.code, 0, two.out);
  const line = two.out.split("\n").find((one) => one.startsWith("frames: ")) ?? "";
  assert.match(line, /1 new \(added\)/, line);
  assert.match(line, /1 changed \(edit\)/, line);
  assert.match(line, /2 renamed \(.*old-name -> new-name.*\)/, line);
  assert.match(line, /move -> moved/, line);
  assert.match(line, /1 removed \(drop\)/, line);
  /* moved keeps its entry; new-name was reviewed under its old id and came back redrawn; drop left with its entry. */
  assert.deepEqual(JSON.parse(readFileSync(review, "utf8")).waiting, { moved: "new", edit: "changed", "new-name": "changed", added: "new" });
  assert.match(two.out, /screens waiting for review: 2 new, 2 changed/);
});

/* ------------------------------------------------------------------ the shutter: long-lived requests, broken images, Chrome's viewport */

/** The seconds a frame took, from its result line: `ok   stream-a ... 6.4s [...]`. */
const secondsOf = (out, id) => Number(/ (\d+(?:\.\d+)?)s(?: \[|$)/m.exec(resultLine(out, id))?.[1] ?? NaN);

needsProject("a request held open forever is learned once per run and never waited to the cap, and the page's own data is still waited for", async () => {
  const project = makeProject();
  writeFlows(project, {
    stream: declaration(["a", "b", "c"].map((name) => screen(`stream-${name}`, `/stream?frame=${name}`, { expect: ["Streamed rows: 3"], expectMissing: ["Streamed rows: 0"] }))),
  });
  const { file } = dump(project, "stream");
  const startedAt = Date.now();
  const run = await capture(project, "stream", ["--screens-file", file, "--no-warm", "--all", "--lanes", "1"]);
  const took = (Date.now() - startedAt) / 1000;
  assert.equal(run.code, 0, run.out);
  const manifest = manifestOf(project, "stream");
  for (const id of ["stream-a", "stream-b", "stream-c"]) assert.ok(claimsMet(shotOf(manifest, id)), `${id} waited for its rows: ${run.out}`);
  /* THE CHANNEL IS NAMED ONCE, for the run, and the cap was never reached. */
  assert.match(run.out, /not waited for on 3 frame\(s\): POST http:\/\/127\.0\.0\.1:\d+\/api\/graphql Forever, a request open longer than 6s/);
  assert.match(run.out, /still open when its page closed/);
  assert.ok(!/network was not quiet within/.test(run.out), `no frame paid the cap: ${run.out}`);
  /* THE FIRST FRAME PAYS THE THRESHOLD, THE REST DO NOT: a learned channel costs one quiet window. */
  const [first, second, third] = ["stream-a", "stream-b", "stream-c"].map((id) => secondsOf(run.out, id));
  if (process.env.STILLS_DEBUG) console.log(`stream frames: ${first}s, ${second}s, ${third}s, run ${took}s`);
  assert.ok(first >= 5.5, `the first frame waited the threshold out (${first}s)`);
  assert.ok(second < first - 3 && third < first - 3, `the later frames did not (${first}s, ${second}s, ${third}s)`);
  /* Three frames at the old cap would be over 30 seconds of waiting alone. */
  assert.ok(took < 30, `the run took ${took}s`);
});

needsProject("a broken image is photographed and named, never sent to a second pass, and kept out only when the old picture had fewer holes", async () => {
  const project = makeProject();
  writeFlows(project, { gallery: declaration([screen("gallery", "/broken", { expect: ["Two photographs, one of them gone"] })]) });
  const { file } = dump(project, "gallery");
  const args = ["--screens-file", file, "--no-warm", "--all"];

  /* A FIRST PICTURE IS WRITTEN, the image named, and the frame listed apart from the problems. */
  const first = await capture(project, "gallery", args);
  assert.equal(first.code, 1, first.out);
  const written = shotOf(manifestOf(project, "gallery"), "gallery");
  assert.deepEqual(written.images, { shown: 2, empty: 1, broken: 1 });
  assert.match(first.out, /1 FRAME\(S\) WITH A BROKEN IMAGE, not run again/);
  assert.match(first.out, /  ! gallery: photographed with 1 of 2 images broken \(http:\/\/127\.0\.0\.1:\d+\/media\/gone\.png\)/);
  assert.ok(!/^\s+- gallery:/m.test(first.out), "not on the problem list");
  assert.ok(!/second pass/.test(first.out), "a dead file is not retried");

  /* THE OLD PICTURE IS NO BETTER (it had the same hole): the new one replaces it. This is the run that used to keep 32 good frames' old pictures. */
  const again = await capture(project, "gallery", args);
  assert.equal(again.code, 1, again.out);
  assert.match(resultLine(again.out, "gallery"), /^ok   gallery .*images=1\/2\(1 broken\)/);
  assert.ok(!/KEPT gallery|second pass/.test(again.out), again.out);
  assert.notEqual(shotOf(manifestOf(project, "gallery"), "gallery").capturedAt, written.capturedAt, "the picture was written again");

  /* THE OLD PICTURE HAD ITS PHOTOGRAPH (as when a media server is down for the moment): kept, still without a second pass. */
  const manifestFile = path.join(project.canvas, "shots", "gallery", "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
  const whole = manifest.shots.find((one) => one.screenId === "gallery");
  whole.images = { shown: 2, empty: 0 };
  writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
  const kept = await capture(project, "gallery", args);
  assert.equal(kept.code, 1, kept.out);
  assert.match(kept.out, /KEPT gallery\s+1 broken image where the previous picture had 0 \(http:\/\/127\.0\.0\.1:\d+\/media\/gone\.png\) — previous picture left in place/);
  assert.ok(!/second pass/.test(kept.out), "kept on the first pass: a second one would load the same dead address");
  assert.ok(!/^\s+- gallery:/m.test(kept.out));
  assert.equal(shotOf(manifestOf(project, "gallery"), "gallery").capturedAt, whole.capturedAt, "the better picture stayed");
});

/** Can the installed Chrome be started here? The viewport test is about that browser and is skipped by name without it. */
async function chromeHere() {
  if (!PROJECT) return false;
  const { chromium } = createRequire(path.join(PROJECT, "package.json"))("playwright");
  try {
    const browser = await chromium.launch({ channel: "chrome" });
    await browser.close();
    return true;
  } catch {
    return false;
  }
}

/** The colour of a picture's middle column at its last row and 60 rows above it, decoded by the browser itself. */
async function edgeColours(file) {
  const { chromium } = createRequire(path.join(PROJECT, "package.json"))("playwright");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    return await page.evaluate(async (src) => {
      const image = new Image();
      image.src = src;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const g = canvas.getContext("2d");
      g.drawImage(image, 0, 0);
      const at = (y) => Array.from(g.getImageData(Math.floor(image.naturalWidth / 2), y, 1, 1).data.slice(0, 3));
      return { h: image.naturalHeight, last: at(image.naturalHeight - 1), above: at(image.naturalHeight - 60) };
    }, `data:image/webp;base64,${readFileSync(file).toString("base64")}`);
  } finally {
    await browser.close();
  }
}

test("in installed Chrome, a dialog fixed over the window is photographed at the viewport's full height", { timeout: 400_000 }, async (t) => {
  if (!PROJECT) return t.skip("set CANVAS_TEST_PROJECT to a project that has playwright and esbuild to run this test");
  if (!(await chromeHere())) return t.skip("installed Chrome is not on this machine: the viewport loss is Chrome's, the bundled Chromium never showed it");
  const project = makeProject();
  writeFlows(project, { chrome: declaration([screen("full-dialog", "/dialog", { expect: ["Dialog over the whole window"] })]) });
  const { file } = dump(project, "chrome");
  const run = await capture(project, "chrome", ["--screens-file", file, "--no-warm", "--all", "--browser-channel", "chrome"]);
  assert.equal(run.code, 0, run.out);
  const colours = await edgeColours(path.join(project.canvas, "shots", "chrome", "full-dialog.webp"));
  assert.equal(colours.h, 900);
  const dialogBlue = ([r, g, b]) => Math.abs(r - 0x12) < 12 && Math.abs(g - 0x34) < 12 && Math.abs(b - 0x56) < 12;
  assert.ok(dialogBlue(colours.above), `the dialog is in the picture: ${colours.above}`);
  assert.ok(dialogBlue(colours.last), `and reaches the last row, with no white band under it: ${colours.last}`);
});

/** The colour of a picture at each point, and its size, decoded by the browser itself. */
async function coloursAt(file, points) {
  const { chromium } = createRequire(path.join(PROJECT, "package.json"))("playwright");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    return await page.evaluate(
      async ({ src, points }) => {
        const image = new Image();
        image.src = src;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const g = canvas.getContext("2d");
        g.drawImage(image, 0, 0);
        return { h: image.naturalHeight, at: points.map(([x, y]) => Array.from(g.getImageData(x, y, 1, 1).data.slice(0, 3))) };
      },
      { src: `data:image/webp;base64,${readFileSync(file).toString("base64")}`, points },
    );
  } finally {
    await browser.close();
  }
}
const near = ([r, g, b], hex) => {
  const [R, G, B] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
  return Math.abs(r - R) < 16 && Math.abs(g - G) < 16 && Math.abs(b - B) < 16;
};

needsProject("the settle ends when the page stops changing, and a panel that arrives after it is photographed finished, not faded out", async () => {
  const project = makeProject();
  writeFlows(project, { late: declaration([screen("late-panel", "/late"), screen("plain-page", "/plain")]) });
  const { file } = dump(project, "late");
  const run = await capture(project, "late", ["--screens-file", file, "--no-warm", "--all", "--lanes", "1"]);
  assert.equal(run.code, 0, run.out);
  const { at } = await coloursAt(path.join(project.canvas, "shots", "late", "late-panel.webp"), [[220, 400]]);
  assert.ok(near(at[0], "#0a7d3b"), `the late panel is in the picture at full strength: ${at[0]}\n${run.out}`);
  /* The time line: every frame's settle is summed, and a page that stopped changing at once does not pay the old fixed 1.2 seconds. */
  const settled = /time in frames, summed: .*\bsettle ([\d.]+)s/.exec(run.out);
  assert.ok(settled, `the run says where its time went:\n${run.out}`);
  assert.ok(Number(settled[1]) < 2.4, `two quiet frames settle in less than two fixed waits: ${settled[1]}s`);
  assert.match(run.out, /^time: .*browser [\d.]+s.*frames [\d.]+s/m);
});

needsProject("a lazy picture a script adds below the fold after load is in a whole-page picture", async () => {
  const project = makeProject();
  writeFlows(project, { lazy: declaration([screen("lazy-deep", "/lazy")]) });
  const { file } = dump(project, "lazy");
  const run = await capture(project, "lazy", ["--screens-file", file, "--no-warm", "--all"]);
  assert.equal(run.code, 0, run.out);
  const shot = shotOf(manifestOf(project, "lazy"), "lazy-deep");
  assert.ok(shot.wholePage, "the page runs past the fold");
  assert.equal(shot.images.shown - shot.images.empty, 1, JSON.stringify(shot.images));
  const deep = await coloursAt(path.join(project.canvas, "shots", "lazy", "lazy-deep.webp"), [[200, shot.h - 60]]);
  assert.ok(near(deep.at[0], "#c2255c"), `the deep picture is drawn: ${deep.at[0]} on a ${deep.h}px shot`);
});

needsProject("a whole-page picture waits for a slow image below the fold before the shutter, not after it", async () => {
  const project = makeProject();
  writeFlows(project, { deep: declaration([screen("deep-slow", "/deep")]) });
  const { file } = dump(project, "deep");
  const run = await capture(project, "deep", ["--screens-file", file, "--no-warm", "--all"]);
  assert.equal(run.code, 0, run.out);
  const first = resultLine(run.out, "deep-slow");
  assert.match(first, /^ok\s+deep-slow\b.* images=1\/1 /, `the first attempt already has the picture: ${first}`);
  assert.doesNotMatch(run.out, /never loaded/, run.out);
  const shot = shotOf(manifestOf(project, "deep"), "deep-slow");
  assert.ok(shot.wholePage, "the page runs past the fold");
  const deep = await coloursAt(path.join(project.canvas, "shots", "deep", "deep-slow.webp"), [[200, shot.h - 60]]);
  assert.ok(near(deep.at[0], "#c2255c"), `the deep picture is drawn: ${deep.at[0]} on a ${deep.h}px shot`);
});

needsProject("a second capture of the same canvas waits for the running one's lock instead of writing the manifest beside it", async () => {
  const project = makeProject();
  writeFlows(project, { locked: declaration([screen("locked-plain", "/plain")]) });
  const { file } = dump(project, "locked");
  const lock = path.join(project.canvas, "rounds", "locked", "capture.lock");
  const manifest = path.join(project.canvas, "shots", "locked", "manifest.json");
  mkdirSync(path.dirname(lock), { recursive: true });
  /* This test's own process is the running capture. */
  writeFileSync(lock, JSON.stringify({ pid: process.pid }));
  const running = capture(project, "locked", ["--screens-file", file, "--no-warm", "--all"]);
  await new Promise((resolve) => setTimeout(resolve, 3000));
  assert.ok(!existsSync(manifest), "nothing is written while another capture holds the canvas");
  rmSync(lock);
  const run = await running;
  assert.equal(run.code, 0, run.out);
  assert.match(run.out, /waiting: another capture of locked is running \(pid \d+\)/);
  assert.ok(existsSync(manifest), "the waiting capture runs once the lock is free");
  assert.ok(!existsSync(lock), "and releases the lock when it exits");
});

needsProject("a session kept in localStorage reaches the capture's own port, and a session check sent as a POST is named, then let through by allowWrites", async () => {
  const project = makeProject();
  writeFlows(project, { session: declaration([screen("account", "/account", { expect: ["Signed in as Tester"] })]) });
  /* Saved against the same host on another port, as a session saved on the dev server is. Test data, not a credential. */
  const state = path.join(project.dir, "session.json");
  writeFileSync(state, JSON.stringify({ cookies: [], origins: [{ origin: `http://127.0.0.1:${fixture.port + 1}`, localStorage: [{ name: "fixture-session", value: "test-token-1" }] }] }));
  const run = () => runTool(project, "capture.mjs", ["--canvas", "session", "--url", base(), "--storage-state", state, "--no-warm", "--all", "--delta-out", path.join(project.dir, "delta")]);

  /* The session arrived (the page sent its check), the guard blocked the check, and the stop names the request and the setting. */
  const blocked = await run();
  assert.equal(blocked.code, 2, blocked.out);
  assert.match(blocked.out, /redirected to the login route \(\/login\) after the write guard blocked POST 127\.0\.0\.1:\d+\/api\/session\/verify/);
  assert.match(blocked.out, /"allowWrites": \["\/api\/session\/verify"\]/);
  assert.doesNotMatch(blocked.out, /test-token-1/, "the session's value is never printed");

  writeFileSync(path.join(project.canvas, "settings.json"), JSON.stringify({ appUrl: base(), allowWrites: ["/api/session/verify"] }));
  const before = fixture.mark();
  const allowed = await run();
  assert.equal(allowed.code, 0, allowed.out);
  assert.ok(claimsMet(shotOf(manifestOf(project, "session"), "account")), allowed.out);
  assert.ok(fixture.since(before, "verify") >= 1, "the listed check reached the server");
});

needsProject("the dev server's indicator is in no picture", async () => {
  const project = makeProject();
  writeFlows(project, { dev: declaration([screen("dev-badge", "/dev-badge")]) });
  const run = await capture(project, "dev", ["--no-warm", "--all"]);
  assert.equal(run.code, 0, run.out);
  const { at } = await coloursAt(path.join(project.canvas, "shots", "dev", "dev-badge.webp"), [[40, 900 - 40]]);
  assert.ok(!near(at[0], "#e03131"), `the badge's corner is the page, not the badge: ${at[0]}`);
});

needsProject("a css= origin resolves through Playwright as a css= step does, so :has-text() and >> nth= work in both", async () => {
  const project = makeProject();
  const goals = screen("goals", "/goals", { steps: [{ hover: "css=main button:has-text('Goal') >> nth=0" }] });
  const flows = [{ id: "goals", title: "Goals", note: "Goals and a plain page.", screens: [goals, screen("plain-page", "/plain")], edges: [
    { from: "goals", to: "plain-page", origin: "css=main button:has-text('Goal') >> nth=0" },
    { from: "goals", to: "plain-page", origin: "Goal Report" },
  ] }];
  writeFlows(project, { goals: declaration([], { flows }) });
  const run = await capture(project, "goals", ["--no-warm", "--all"]);
  assert.equal(run.code, 0, run.out);
  const shot = shotOf(manifestOf(project, "goals"), "goals");
  assert.ok(claimsMet(shot), JSON.stringify(shot.claims));
  const [bySelector, byText] = shot.origins;
  assert.equal(bySelector.origin, "css=main button:has-text('Goal') >> nth=0");
  assert.ok(bySelector.w > 0 && byText.w > 0 && bySelector.x < byText.x, `the first Goal button, then the report button: ${JSON.stringify(shot.origins)}`);
});

needsProject("a frame refused only for an origin keeps its picture at once, with no second pass and no rerun", async () => {
  const project = makeProject();
  const flows = (origin) => [{ id: "goals", title: "Goals", note: "Goals and a plain page.", screens: [screen("goals", "/goals"), screen("plain-page", "/plain")], edges: [{ from: "goals", to: "plain-page", origin }] }];
  writeFlows(project, { goals: declaration([], { flows: flows("Goal Report") }) });
  const first = await capture(project, "goals", ["--no-warm", "--all"]);
  assert.equal(first.code, 0, first.out);
  writeFlows(project, { goals: declaration([], { flows: flows("No Such Control") }) });
  const second = await capture(project, "goals", ["--no-warm", "--all"]);
  assert.equal(second.code, 1, second.out);
  assert.doesNotMatch(second.out, /second pass/, "an origin is measured on the settled page: a second pass would measure the same");
  assert.match(resultLine(second.out, "goals"), /^KEPT goals/);
  assert.match(second.out, /goals: captured a claim it does not prove, so the previous picture was KEPT/);
  assert.match(second.out, /origin "No Such Control" \(edge to plain-page\) resolves to exactly one visible place — it resolved to 0/);
});

needsProject("six lanes by default, eight under capture-run.mjs, and --lanes or CANVAS_LANES still decide", async () => {
  const child = await startChild();
  try {
    const project = makeProject();
    const nine = Array.from({ length: 9 }, (_, at) => screen(`plain-${"abcdefghi"[at]}`, `/plain?frame=${at}`));
    writeFlows(project, { lanes: declaration(nine) });
    const dev = await runTool(project, "capture.mjs", ["--canvas", "lanes", "--url", child.url, "--no-login-check", "--no-warm", "--all"]);
    assert.match(dev.out, /capturing 9 screen\(s\), 6 at a time/, dev.out);
    const build = await runTool(project, "capture-run.mjs", ["--canvas", "lanes", "--port", String(child.port), "--reuse", "--all"]);
    assert.match(build.out, /capturing 9 screen\(s\), 8 at a time/, build.out);
    const said = await runTool(project, "capture-run.mjs", ["--canvas", "lanes", "--port", String(child.port), "--reuse", "--all"], { CANVAS_LANES: "3" });
    assert.match(said.out, /capturing 9 screen\(s\), 3 at a time/, said.out);
  } finally {
    child.stop();
  }
});

needsProject("a project that keeps its App Router in src/app stamps src/app/globals.css into every frame", async () => {
  const project = makeProject();
  mkdirSync(path.join(project.dir, "src", "app"), { recursive: true });
  writeFileSync(path.join(project.dir, "src", "app", "globals.css"), "body { margin: 0; }\n");
  writeFlows(project, { styles: declaration([screen("plain-page", "/plain")]) });
  const run = await capture(project, "styles", ["--no-warm", "--all"]);
  assert.equal(run.code, 0, run.out);
  const sources = shotOf(manifestOf(project, "styles"), "plain-page").stamp.sources;
  assert.ok("src/app/globals.css" in sources, `the global stylesheet is in the stamp: ${Object.keys(sources).join(", ")}`);
  assert.ok(!("app/globals.css" in sources));
});

needsProject("a frame whose pinned state no longer exists fails and keeps its picture, and a new one gets no picture of the default", async () => {
  const project = makeProject();
  const pinned = (state, extra = {}) => screen("pin-panel", "/pinned", { state, expect: ["Fixture App"], ...extra });
  writeFlows(project, { pins: declaration([pinned("open", { expect: ["Pinned open"] })]) });
  const first = await capture(project, "pins", ["--no-warm", "--all"]);
  assert.equal(first.code, 0, first.out);
  const file = path.join(project.canvas, "shots", "pins", "pin-panel.webp");
  const picture = readFileSync(file);

  /* The state is renamed away in the states file: the page shows the default and marks the pin unknown. */
  writeFlows(project, { pins: declaration([pinned("gone"), screen("pin-new", "/pinned", { state: "missing" })]) });
  const second = await capture(project, "pins", ["--no-warm", "--all"]);
  assert.equal(second.code, 1, second.out);
  assert.match(resultLine(second.out, "pin-panel"), /^KEPT pin-panel\s+unknown pinned state "gone"/);
  assert.match(second.out, /pin-panel: its pinned state "gone" is not in design-canvas\/project\/states\.ts, so the page showed the default and the previous picture was KEPT/);
  assert.ok(!/second pass queued/.test(second.out), "a state that does not exist is final, never retried");
  assert.ok(readFileSync(file).equals(picture), "the picture of the real state is still on the canvas, byte for byte");
  assert.equal(shotOf(manifestOf(project, "pins"), "pin-panel").hash, createHash("sha256").update(picture).digest("hex").slice(0, 16), "and its manifest entry with it");
  assert.match(resultLine(second.out, "pin-new"), /^FAIL pin-new\s+unknown pinned state "missing"/);
  assert.equal(shotOf(manifestOf(project, "pins"), "pin-new"), undefined, "the default is never written under a state's name");
  assert.ok(!existsSync(path.join(project.canvas, "shots", "pins", "pin-new.webp")));

  /* A pin component older than the mark sets it on every page; the states file's own error line still fails the frame. */
  writeFlows(project, { pins: declaration([screen("pin-panel", "/pinned?legacy=1", { state: "gone", expect: ["Fixture App"] })]) });
  const legacy = await capture(project, "pins", ["--no-warm", "--all"]);
  assert.equal(legacy.code, 1, legacy.out);
  assert.match(resultLine(legacy.out, "pin-panel"), /^KEPT pin-panel\s+unknown pinned state "gone"/);
  assert.ok(readFileSync(file).equals(picture));
});

needsProject("a dead address stops the capture and the oracle in one line, before any browser or lane starts", async () => {
  const project = makeProject();
  writeFlows(project, { dead: declaration([screen("plain-page", "/plain")]) });
  const free = await new Promise((resolve) => {
    const server = http.createServer().listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
  const dead = `http://127.0.0.1:${free}`;
  const run = await runTool(project, "capture.mjs", ["--canvas", "dead", "--url", dead, "--all"]);
  assert.equal(run.code, 2, run.out);
  assert.match(run.out, new RegExp(`capture: nothing answers at ${dead.replace(/[.]/g, "\\.")} \\(ECONNREFUSED\\)`));
  assert.ok(!/capturing|warming|FAIL plain-page/.test(run.out), `no lane started: ${run.out}`);
  const oracle = await runTool(project, "check-canvas.mjs", ["--canvas", "dead", "--url", dead]);
  assert.equal(oracle.code, 2, oracle.out);
  assert.match(oracle.out, /check-canvas: nothing answers at .* \(ECONNREFUSED\)/);
  assert.match(oracle.out.trim().split("\n").at(-1), /^FAIL: the run could not start/);
});

needsProject("a round that did not pass is continued by the next run, whose before pictures stay the ones the round started from", async () => {
  const child = await startChild();
  try {
    const project = makeProject();
    writeFileSync(path.join(project.canvas, "settings.json"), `${JSON.stringify({ appUrl: child.url })}\n`);
    const at = async (route) => {
      writeFlows(project, { retry: declaration([screen("retry-frame", route)]) });
      await child.serve("retry", JSON.stringify(dump(project, "retry").json));
    };
    const roundsDir = path.join(project.canvas, "rounds", "retry");
    const rounds = () => readdirSync(roundsDir).filter((name) => /^\d{8}-\d{6}$/.test(name)).sort();
    const picture = () => readFileSync(path.join(project.canvas, "shots", "retry", "retry-frame.webp"));

    await at("/plain");
    const passed = await runTool(project, "round.mjs", ["--canvas", "retry", "--no-check"]);
    assert.equal(passed.code, 0, passed.out);
    const original = picture();
    await new Promise((resolve) => setTimeout(resolve, 1100));

    /* The first attempt captures a new design and then fails (a comment id that does not exist cannot be drained). */
    await at("/goals");
    const failed = await runTool(project, "round.mjs", ["--canvas", "retry", "--no-check", "--drain", "c999"]);
    assert.equal(failed.code, 1, failed.out);
    assert.match(failed.out, /ROUND FAIL: drain found problems/);
    assert.equal(rounds().length, 2, "a round after a passed one is a new round");
    await new Promise((resolve) => setTimeout(resolve, 1100));

    /* The retry: the same round, and its "before" is the picture from before the first attempt, not the first attempt's. */
    await at("/late");
    const retried = await runTool(project, "round.mjs", ["--canvas", "retry", "--no-check"]);
    assert.equal(retried.code, 0, retried.out);
    assert.match(retried.out, /continuing round \d{8}-\d{6}: it did not pass/);
    assert.equal(rounds().length, 2, "the retry continued the round that failed");
    const folder = path.join(roundsDir, rounds()[1]);
    assert.ok(readFileSync(path.join(folder, "before", "retry-frame.webp")).equals(original), "the before is the round's starting picture");
    const delta = JSON.parse(readFileSync(path.join(folder, "delta.json"), "utf8"));
    assert.equal(delta.frames.find((frame) => frame.id === "retry-frame").sinceFirstAttempt, true);
    assert.ok(!existsSync(path.join(folder, "open")), "a round that passed is no longer open, so the next run starts a new one");
  } finally {
    child.stop();
  }
});

needsProject("an option that redesigns today's screen is listed with what it no longer shows, by the capture and by the round", async () => {
  const child = await startChild();
  try {
    const project = makeProject();
    writeFileSync(path.join(project.canvas, "settings.json"), `${JSON.stringify({ appUrl: child.url })}\n`);
    const today = screen("goals-today", "/goals");
    const option = { ...screen("goals-plain", "/plain"), kind: undefined, redesigns: "goals-today" };
    writeFlows(project, { opts: declaration([today], { explorations: [{ id: "goal layout", title: "Goal Layout", note: "Two ways to lay out the goals", original: "goals-today", screens: [option] }] }) });
    await child.serve("opts", JSON.stringify(dump(project, "opts").json));

    /* Today's screen was never captured with its controls: the capture takes it along once, then compares. */
    const run = await runTool(project, "capture.mjs", ["--canvas", "opts", "--url", child.url, "--no-login-check", "--no-warm", "--only", "goals-plain"]);
    assert.equal(run.code, 0, run.out);
    assert.match(run.out, /also capturing goals-today: goals-plain redesigns it, and its controls are not on record yet/);
    assert.deepEqual(shotOf(manifestOf(project, "opts"), "goals-today").controls.sort(), ["Fixture App", "Goal Report", "Goals", "New Goal"]);
    assert.match(run.out, /what each option no longer shows of today's screen \(its controls and labels\):\n {2}goals-plain against goals-today: "Goals", "New Goal", "Goal Report"\nnext: include this list in the hand-over, per option/);

    /* The round says it too, at its end, where the hand-over is written from. */
    const round = await runTool(project, "round.mjs", ["--canvas", "opts", "--no-check", "--only", "goals-plain"]);
    assert.equal(round.code, 0, round.out);
    const tail = round.out.slice(round.out.indexOf("this round:"));
    assert.match(tail, /goals-plain against goals-today: "Goals", "New Goal", "Goal Report"\nnext: include this list in the hand-over/);
    assert.ok(!/also capturing/.test(round.out), "once today's controls are on record it is not taken again");
  } finally {
    child.stop();
  }
});
