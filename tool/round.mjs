#!/usr/bin/env node
/**
 * design-canvas — ONE COMMAND PER ROUND.
 *
 *   node design-canvas/round.mjs --canvas tasks --only tasks-overview,tasks-detail --drain c40,c41
 *
 * A round used to be six commands typed by hand, each with its own flags: dump the declaration, capture the frames that
 * changed, mark the comments worked, run the oracle, look at what changed. The app's address, the saved session, the browser
 * and the login route were typed into every one, differently for the capture and for the check, and every compaction hand-off
 * retyped the whole block, and a round has to be fast enough to iterate in seconds, not minutes per option. So a round is
 * one command, and the facts it needs are written once in `design-canvas/settings.json`.
 *
 * IN THIS ORDER, stopping at the first thing that fails, so nothing later runs on a foundation that is wrong:
 *
 *   1. settings     the app's address, session, browser and login route, read once (`project-settings.mjs`). No default port.
 *   2. declaration  read from the file (`screensFor` in dump-screens.mjs).
 *   3. the server   proved to serve THIS project's declaration: every declared frame must be one the server at that address
 *                   knows. A neighbor's dev server on the next port, or a server that predates the edit, stops the run here.
 *   4. preflight    the copy rules, the declaration lint, the claims against the shipped copy, the comments that would be
 *                   left homeless, the steps, real-code mode's option and parity checks (`parity.mjs`, which runs on its own
 *                   under `--no-preflight`), and (for the frames about to be captured: `--only`, or what `capture.mjs --plan`
 *                   says changed) the served pages themselves. Seconds (`preflight.mjs`). Each exploration's mode is said
 *                   in one `mode:` line before it.
 *   5. capture      `--only` the frames named (or whichever changed) against the running dev server, which also re-pins the
 *                   comments of any frame that left the declaration, runs each screen's click steps, and prints the visual
 *                   change report (`capture.mjs`).
 *   6. drain        `--drain c1,c2`: the comments the agent worked are marked consumed, AFTER the capture succeeded, never before
 *                   (consumed is the agent's word, and a capture that failed did not deliver the work). Skipped if the capture
 *                   reported problems.
 *   7. check        the oracle, ONCE (`check-canvas.mjs`). `--no-check` for the quick loop; it is the only slow step.
 *   8. contact sheet  before beside after for every frame that changed, with the changed box drawn on it, as a PNG whose path
 *                   is the last thing printed (`contact-sheet.mjs`). Above it, per exploration option photographed, the controls
 *                   and labels of today's screen that the option no longer shows, for the hand-over.
 *   9. focus        the canvases a reviewer has open now refresh their out-of-date frames in the background
 *                   (`recapture.mjs --focus`); every other canvas waits until it is opened.
 *
 * The last line is the verdict: `ROUND PASS`, or `ROUND FAIL: <the phase that stopped it>`. Exit codes: 0 pass, 1 a phase found
 * problems, 2 the round could not start.
 *
 * WHAT IT DOES NOT DO: build. It captures against the server already running at `appUrl`, which is what makes a round a few
 * seconds. A canvas being PROVED for a review is still captured against a production build (`capture-run.mjs`, SKILL.md step 5).
 *
 * DELETE WITH: the design-canvas/ folder.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { deadAddressLine, unreachable } from "./app-reachable.mjs";
import { checkFetchedLogin, die, guardCrashes, requireStorageState, waitForServedFrames } from "./browser-guards.mjs";
import { spawnTracked } from "./browser-lifecycle.mjs";
import { commentsFileFor } from "./comment-integrity.mjs";
import { buildContactSheet } from "./contact-sheet.mjs";
import { screensFor } from "./dump-screens.mjs";
import { explorationMode, modeLine } from "./parity.mjs";
import { loadSettings, requireAppUrl } from "./project-settings.mjs";
import { afterRound, undrainedIn } from "./reminders.mjs";
import { removedControls, removedLines } from "./visual-delta.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const argv = process.argv.slice(2);
const argOf = (name) => {
  const at = argv.indexOf(`--${name}`);
  return at === -1 ? undefined : argv[at + 1];
};
const has = (name) => argv.includes(`--${name}`);
const list = (text) => (text ?? "").split(",").map((one) => one.trim()).filter(Boolean);

const started = Date.now();
const timings = [];
const say = (line) => console.log(`[round ${((Date.now() - started) / 1000).toFixed(1)}s] ${line}`);

/** What stopped the round, for the last line. */
let stopped = null;
/** The contact sheet, once it exists: `report()` runs from several places and must be able to ask. */
let sheet = null;
const finalLine = (reason) => (reason ? `ROUND FAIL: ${reason}` : stopped ? `ROUND FAIL: ${stopped}` : "ROUND PASS");
/** The mark of a round that has not passed yet: the next run continues it as a retry. A round that passes takes it away. */
const OPEN = "open";
guardCrashes({ who: "round", tail: (reason, print = console.log) => print(finalLine(reason)) });

const canvasSlug = argOf("canvas") ?? "main";
if (!/^[a-z0-9][a-z0-9-]*$/.test(canvasSlug)) die("round", `refusing --canvas "${canvasSlug}": a canvas slug is lowercase letters, digits and dashes only`);
const only = list(argOf("only"));
const drain = list(argOf("drain"));

/* ------------------------------------------------------------------ 1. the settings, once */

const settings = loadSettings(HERE, "round");
if (has("show-settings")) {
  const relative = (file) => (file ? path.relative(ROOT, file) : null);
  console.log(
    JSON.stringify(
      {
        file: relative(settings.file),
        appUrl: settings.appUrl,
        port: settings.port,
        storageState: relative(settings.storageState),
        browserChannel: settings.browserChannel,
        loginRoute: settings.loginRoute,
        locales: settings.locales.map(relative),
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
const appUrl = requireAppUrl(settings, "round");
/* The environment wins over the file. Every tool this round runs reads the same two, in the same order. */
const env = process.env;
const storageState = env.CANVAS_STORAGE_STATE ?? settings.storageState ?? undefined;
const browserChannel = env.CANVAS_BROWSER_CHANNEL ?? settings.browserChannel ?? undefined;
const loginRoute = env.CANVAS_LOGIN_ROUTE ?? settings.loginRoute ?? undefined;
requireStorageState("round", storageState, appUrl);
say(`${canvasSlug} on ${appUrl}${storageState ? ", saved session" : ""}${browserChannel ? `, ${browserChannel}` : ""}`);

/** One phase, timed. `run` returns an exit code, or a promise of one. */
async function phase(name, run) {
  const at = Date.now();
  const code = await run();
  timings.push([name, Date.now() - at, code]);
  return code;
}
/**
 * A CHILD TOOL IS RUN WITHOUT BLOCKING THIS PROCESS (`spawnTracked`), which `spawnSync` was not: a blocked process cannot run a
 * signal handler, so a round that was killed left its capture running to the end with its browser open. Now a signal reaches the
 * child, the child closes its own browser, and a SIGKILL of the round still takes the child's browser with it (the child is told
 * who started it). See browser-lifecycle.mjs.
 */
const node = (script, args, extra = {}) => spawnTracked(process.execPath, [path.join(HERE, script), ...args], { cwd: ROOT, env, ...extra });
/** What stopped the round and with which code (2: the phase could not begin, 1: it ran and found problems). */
let stoppedCode = 1;
const stop = (name, code) => {
  stopped = code === 2 ? `${name}: the run could not start` : `${name} found problems`;
  stoppedCode = code === 2 ? 2 : 1;
  return code;
};

/* ------------------------------------------------------------------ 2. the declaration, read once */

const roundsDir = path.join(HERE, "rounds", canvasSlug);
/**
 * A RETRY IS THE SAME ROUND: when the newest round of this canvas did not pass (its folder still holds `open`), this run
 * continues in that folder, so the "before" pictures stay the ones the round started from and never become its own first
 * attempt's (`keepOriginals` in visual-delta.mjs). A round that passes removes the mark, and the next run starts a new one.
 */
const roundDirs = () => {
  try {
    return readdirSync(roundsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^\d{8}-\d{6}$/.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
};
const newest = roundDirs().at(-1);
const unfinished = newest && existsSync(path.join(roundsDir, newest, OPEN)) ? newest : null;
const stamp = unfinished ?? new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-");
const roundDir = path.join(roundsDir, stamp);
mkdirSync(roundDir, { recursive: true });
writeFileSync(path.join(roundDir, OPEN), `${new Date().toISOString()}\n`);
if (unfinished) say(`continuing round ${stamp}: it did not pass, so its pictures from before its first attempt stay the "before"`);
let dumped = null;
{
  const code = await phase("declaration", async () => {
    try {
      dumped = await screensFor(HERE, canvasSlug);
      return 0;
    } catch (error) {
      console.error(`dump-screens: ${error.message}`);
      return 2;
    }
  });
  if (code !== 0) {
    stop("declaration", 2);
    console.log(`\n${finalLine()}`);
    process.exit(2);
  }
}
/* Each exploration's mode in one line (`parity.mjs`), so the agent can say how the options are built and why. */
for (const exploration of dumped.explorations ?? []) say(`mode: ${modeLine(explorationMode({ root: ROOT, exploration, screens: dumped.screens }))}`);
const declaredIds = (dumped.screens ?? []).map((screen) => screen.id);
const unknownOnly = only.filter((id) => !declaredIds.includes(id));
if (unknownOnly.length > 0) die("round", `--only names ${unknownOnly.map((id) => `"${id}"`).join(", ")}, which ${unknownOnly.length === 1 ? "is" : "are"} no screen on the ${canvasSlug} canvas`);

/* ------------------------------------------------------------------ 3. the server is THIS project's */

{
  const endpoint = `${appUrl}/api/design-canvas/shots?canvas=${encodeURIComponent(canvasSlug)}&screens=1`;
  const at = Date.now();
  /* The same one-line stop as the capture and the oracle (`app-reachable.mjs`), then the request that proves whose server it is. */
  const dead = await unreachable(appUrl);
  const response = dead
    ? { failed: dead }
    : await fetch(endpoint, { signal: AbortSignal.timeout(20_000) }).catch((error) => ({ failed: String(error?.cause?.code ?? error?.message ?? error) }));
  if (response.failed) {
    stop("server", 2);
    console.error(`round: ${deadAddressLine(appUrl, response.failed)}`);
    console.log(`\n${finalLine()}`);
    process.exit(2);
  }
  checkFetchedLogin("round", endpoint, response, { storageState, appUrl, loginRoute });
  /* A 400 is the canvas route saying it has no canvas of this name: a canvas declared a moment ago that the server has not
     reloaded yet, which the wait below covers exactly as it covers frames it does not serve yet. */
  const notYet = !response.ok && response.status === 400;
  if (!response.ok && !notYet) {
    stop("server", 2);
    console.error(`round: ${endpoint} answered ${response.status}. That is either not this project's dev server or not in dev mode; check "appUrl" in design-canvas/settings.json.`);
    console.log(`\n${finalLine()}`);
    process.exit(2);
  }
  const idsIn = async (answer) => new Set(((await answer.json()).screens ?? []).map((screen) => screen.id));
  const first = notYet ? new Set() : await idsIn(response);
  /* A declaration saved a moment ago may not be served yet: wait for the reload, within a bound, before calling it another app. */
  const waitMs = 30_000;
  let unknown = declaredIds.filter((id) => !first.has(id));
  if (unknown.length > 0) {
    say(`the server does not serve ${unknown.length} declared frame(s) yet; waiting up to ${waitMs / 1000} s for it to reload the declaration`);
    unknown = await waitForServedFrames(
      () =>
        fetch(endpoint, { signal: AbortSignal.timeout(20_000) })
          .then((again) => (again.ok ? idsIn(again) : new Set()))
          .catch(() => new Set()),
      declaredIds,
      { timeoutMs: waitMs },
    );
  }
  timings.push(["server", Date.now() - at, unknown.length > 0 ? 2 : 0]);
  if (unknown.length > 0) {
    stop("server", 2);
    console.error(
      `round: after ${waitMs / 1000} s the server at ${appUrl} still does not know ${unknown.length} of this canvas's ${declaredIds.length} frames (${unknown.slice(0, 5).join(", ")}${unknown.length > 5 ? ", ..." : ""}). ` +
        `Either it never reloaded the declaration (save design-canvas/project/flows.ts again, or restart the dev server), or it is another app's dev server (a neighbor on the next port). Nothing was captured.`,
    );
    console.log(`\n${finalLine()}`);
    process.exit(2);
  }
  say(`the server at ${appUrl} serves all ${declaredIds.length} declared frames`);
}

/* ------------------------------------------------------------------ 4. the preflight */

/** The arguments the capture takes in every call below, so `--plan` and the real run select the same screens. */
const captureBase = ["--canvas", canvasSlug, "--url", appUrl];

/**
 * WHICH FRAMES THE PREFLIGHT OPENS ON THE SERVED APP: the ones named with `--only`, or, when none are, the ones the capture
 * is about to photograph (it decides by stamp, and `capture.mjs --plan` says which without photographing anything). The claims
 * of exactly those frames are what the live pass decides before a capture pays for them.
 */
let planned = only;
if (only.length === 0 && !has("no-preflight") && !has("no-live")) {
  const asked = spawnSync(process.execPath, [path.join(HERE, "capture.mjs"), ...captureBase, "--plan"], { cwd: ROOT, encoding: "utf8", env });
  const line = (asked.stdout ?? "").split("\n").find((one) => one.startsWith("plan: "));
  if (asked.status !== 0 || line === undefined) {
    process.stdout.write(asked.stdout ?? "");
    process.stderr.write(asked.stderr ?? "");
    stop("capture", asked.status === 2 ? 2 : 1);
    report();
    process.exit(stoppedCode);
  }
  planned = line.slice("plan: ".length).split(",").filter(Boolean);
}

/* The preflight runs the parity check; a round that skips the preflight still runs it, because it gates the round. */
if (has("no-preflight")) {
  const code = await phase("parity", () => node("parity.mjs", ["--canvas", canvasSlug]));
  if (code !== 0) {
    stop("parity", code);
    report();
    process.exit(code);
  }
}

if (!has("no-preflight")) {
  const args = ["--canvas", canvasSlug, "--url", appUrl, ...(planned.length > 0 && !has("no-live") ? ["--live", "--only", planned.join(",")] : [])];
  const code = await phase("preflight", () => node("preflight.mjs", args));
  if (code !== 0) {
    stop("preflight", code);
    report();
    process.exit(code);
  }
}

/* ------------------------------------------------------------------ 5. the capture */

const captureCode = await phase("capture", () =>
  node("capture.mjs", [
    ...captureBase,
    /* The preflight's live pass has just opened these frames, so their routes are compiled; nothing to warm. */
    ...(planned.length > 0 && !has("no-preflight") && !has("no-live") ? ["--no-warm"] : []),
    ...(only.length > 0 ? ["--only", only.join(",")] : []),
    /* How many frames at once: a fragile dev server carries fewer (`CANVAS_LANES` says the same, and reaches capture.mjs by itself). */
    ...(argOf("lanes") ? ["--lanes", argOf("lanes")] : []),
    "--delta-out", roundDir,
    "--keep-originals",
    /* This round runs the drain and the oracle itself, so the capture's own next steps would be wrong here; it says its own. */
    "--no-next",
  ]),
);
if (captureCode !== 0) stop("capture", captureCode);

/* ------------------------------------------------------------------ 6. drain, only after a capture that delivered */

if (drain.length > 0) {
  if (captureCode !== 0) say(`not draining ${drain.join(", ")}: the capture reported problems, so the work is not on the canvas yet`);
  else {
    const code = await phase("drain", () => node("drain.mjs", ["--canvas", canvasSlug, "--url", appUrl, "--ids", drain.join(",")]));
    if (code !== 0) stop("drain", code);
  }
} else if (captureCode === 0) {
  /* The oracle fails on exactly this pair (recaptured, never consumed), so say it before it costs a check. */
  const file = commentsFileFor(HERE, canvasSlug);
  if (file) {
    try {
      const undrained = undrainedIn(JSON.parse(readFileSync(file, "utf8")).comments);
      if (undrained.length > 0)
        say(`${undrained.length} comment(s) sit on a recaptured frame and are not marked consumed (${undrained.join(", ")}): the check will fail on them. Run again with --drain ${undrained.join(",")} if you worked them.`);
    } catch {
      /* An unreadable comments file is the oracle's to report. */
    }
  }
}

/* ------------------------------------------------------------------ 7. the oracle, once */

if (captureCode === 0 && !stopped) {
  if (has("no-check")) say("the check was skipped (--no-check)");
  else {
    /* The oracle's live Open pass visits the frames this round photographed (and any an earlier round left unproven); `--live-all`
       visits every frame. The reviewer's dev server is never asked to compile a route nothing changed on. */
    const code = await phase("check", () => node("check-canvas.mjs", ["--canvas", canvasSlug, "--url", appUrl, ...(has("live-all") ? ["--live-all"] : [])]));
    if (code !== 0) stop("check", code);
  }
}

/* ------------------------------------------------------------------ 8. the contact sheet */

const deltaFile = path.join(roundDir, "delta.json");
if (existsSync(deltaFile)) {
  const at = Date.now();
  try {
    const { chromium } = await import("playwright");
    sheet = await buildContactSheet({
      chromium,
      launchOptions: browserChannel ? { channel: browserChannel } : {},
      deltaDir: roundDir,
      delta: JSON.parse(readFileSync(deltaFile, "utf8")),
      shotsDir: path.join(HERE, "shots", canvasSlug),
      canvas: canvasSlug,
      title: `Round ${stamp}: ${only.length > 0 ? only.join(", ") : "the frames that changed"}`,
    });
  } catch (error) {
    say(`no contact sheet: ${String(error?.message ?? error).split("\n")[0]}`);
  }
  timings.push(["sheet", Date.now() - at, 0]);
}

report();
process.exit(stopped ? stoppedCode : 0);

/** The phases, what they cost, where the sheet is, and the verdict as the last line. */
function report() {
  pruneRounds();
  /* A round is one of the moments a recapture runs: the canvases a reviewer has open now refresh in the background, behind the
     same install answer and per-canvas lock as the end of a turn (`recapture.mjs --focus`). */
  spawnSync(process.execPath, [path.join(HERE, "recapture.mjs"), "--focus"], { cwd: ROOT, env, stdio: "ignore", timeout: 10_000 });
  if (!stopped) rmSync(path.join(roundDir, OPEN), { force: true });
  console.log("\nthis round:");
  for (const [name, ms, code] of timings) console.log(`  ${name.padEnd(12)} ${(ms / 1000).toFixed(1).padStart(6)}s${code !== 0 ? "   stopped the round" : ""}`);
  console.log(`  ${"total".padEnd(12)} ${((Date.now() - started) / 1000).toFixed(1).padStart(6)}s`);
  /* What each option this round photographed no longer shows of today's screen: said here, where the hand-over is written from. */
  try {
    const ids = new Set((JSON.parse(readFileSync(path.join(roundDir, "delta.json"), "utf8")).frames ?? []).map((frame) => frame.id));
    const shots = JSON.parse(readFileSync(path.join(HERE, "shots", canvasSlug, "manifest.json"), "utf8")).shots ?? [];
    const removed = removedLines(removedControls({ explorations: dumped?.explorations, shots, ids }));
    if (removed.length > 0) console.log(`\n${removed.join("\n")}\nnext: include this list in the hand-over, per option, so nothing today's screen does goes missing unseen`);
  } catch {
    /* Nothing photographed this round, or no pictures yet: nothing to compare. */
  }
  if (sheet) {
    console.log(`\ncontact sheet: ${path.relative(ROOT, sheet.pngFile)}  (${sheet.drawn} frame(s) drawn${sheet.identical > 0 ? `, ${sheet.identical} identical` : ""})`);
    if (sheet.missing.length > 0) console.log(`  no current picture on disk for: ${sheet.missing.join(", ")}`);
    for (const line of afterRound({ sheet: path.relative(ROOT, sheet.pngFile) })) console.log(line);
  }
  console.log(`\n${finalLine()}`);
}

/** Only the newest ten rounds are kept: the folder is scratch, and the record of a round is git and the comments history. */
function pruneRounds() {
  try {
    const dirs = readdirSync(roundsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^\d{8}-\d{6}$/.test(entry.name))
      .map((entry) => entry.name)
      .sort();
    for (const name of dirs.slice(0, Math.max(0, dirs.length - 10))) if (name !== stamp) rmSync(path.join(roundsDir, name), { recursive: true, force: true });
  } catch {
    /* Nothing to prune. */
  }
}
