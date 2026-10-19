#!/usr/bin/env node
/**
 * design-canvas — the capture pipeline. This is where the canvas gets its pictures.
 *
 *   node design-canvas/capture.mjs --canvas <slug> [--only home,empty-list] [--all] [--url <address>] [--lanes <n>] [--first <ids>]
 *
 * The address, the saved session, the browser and the login route come from design-canvas/settings.json; `--url` and the other
 * flags override it for one run (a production build is always captured at a port of its own). Changed frames only by default
 * (the stamp, below); `--all` captures every frame. `--lanes <n>` (or `CANVAS_LANES`) is how many frames are photographed at
 * once, 6 unless said (`capture-run.mjs` asks for 8 against its build, the background recapture 2 for a large set), 1 to 16.
 * `--first <ids>` photographs those frames before the rest of the selection. `--no-network-wait` switches off the wait for a page's data (`NETWORK_WAIT`). What a screen's
 * `network` rules do is in `network.mjs`, its `steps` in `steps.mjs`, and what a picture must not replace in `shot-guard.mjs`.
 *
 * The canvas draws pictures rather than live pages because dozens of live pages on one surface cannot be panned smoothly. So
 * everything a live page could show is PROVED HERE, at the moment the shutter opens, in this order:
 *
 *   1. LOADED       the document is complete, has rendered text, its fonts are loaded, and every image in the shot has
 *                   finished, in the frames the page mounts of its own too.
 *   2. FINISHED     every animation and transition that ends has ended; only the ones that never end are paused.
 *   3. FROZEN       a stylesheet pins everything and every video is paused, so nothing moves between the next two steps.
 *   4. TRUE         every claim the screen declares is in the page, across all its frames.
 *   5. STABLE       two consecutive captures come out BYTE FOR BYTE IDENTICAL. A page still loading or moving cannot.
 *
 * All of it is written into `shots/<slug>/manifest.json` beside the images. WebP through Chromium's own encoder
 * (`Page.captureScreenshot`), about a tenth of a PNG's size.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

import {
  checkLoginRedirect,
  clickDismissals,
  closeBrowser,
  die,
  forbidRemedy,
  guardCrashes,
  hideDevOverlay,
  launchBrowser,
  loadDismissals,
  openContext,
  requireStorageState,
  SETUP_EXIT,
  seedDismissals,
  stableShot,
} from "./browser-guards.mjs";
import { requireAppAnswers } from "./app-reachable.mjs";
import { filesReachedFrom } from "./closure.mjs";
import { applyMoves, declaredFrames, markStale, planPins, planSummary, refusalLines } from "./comment-integrity.mjs";
import { screensFor } from "./dump-screens.mjs";
import { markUnproven } from "./live-pass.mjs";
import { afterCapture, undrainedIn } from "./reminders.mjs";
import { applyNetwork, describeHits, hasNetwork, LONG_LIVED_MS, mergeNetwork, parseNetwork, QUIET_CAP_MS, QUIET_MS, unmetClaim } from "./network.mjs";
import { nextBases, releaseRetired } from "./parity.mjs";
import { recordToday } from "./preflight-rules.mjs";
import { loadSettings, requireAppUrl } from "./project-settings.mjs";
import { brokenImagesVerdict, brokenShot, textLength } from "./shot-guard.mjs";
import { cssLocator, isCssTarget, parseSteps, runSteps, StepError, SURFACE_TEXT } from "./steps.mjs";
import { CONTROLS, FLAG_PCT, removedControls, removedLines, reportVisualChange } from "./visual-delta.mjs";
import { classifyFrames, nextWaiting, sayFrames } from "./new-frames.mjs";
import { commentPaths, commitHistory, readCommentFile, writeCommentFile } from "./core/comment-file.mjs";
import { declStamp, lockHolder, takeLock } from "./recapture.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** The project root. `HERE` is `design-canvas/`. */
const ROOT = path.join(HERE, "..");

/**
 * WHICH CANVAS (`--canvas <slug>`, `main` by default). The slug namespaces the pictures, the manifest the orphans are pruned
 * against, and the comment file: two canvases sharing one folder would delete each other's frames as orphans.
 */
const canvasSlug = (() => {
  const at = process.argv.indexOf("--canvas");
  return at >= 0 ? process.argv[at + 1] : "main";
})();

const SHOTS = path.join(HERE, "shots", canvasSlug);

/* This canvas's review file and its pictures (`core/comment-file.mjs`). Every write of it in this run is one, at the end
   (`saveComments`), and goes through the same module as the route's, history included. */
const REVIEW = commentPaths(HERE, canvasSlug);
const COMMENT_IMAGES = REVIEW.images;

/**
 * A COMMENT GOES WITH THE SCREEN IT POINTS AT. The orphan prune already deletes the picture and the manifest
 * entry; this is the third thing that was supposed to go with them and never did.
 *
 * What that cost: retiring an exploration round deleted its options from the declaration, so the frames went,
 * the shots went — and the verdicts left on those frames stayed in the comment file forever. They could not be
 * drawn (no frame), could not be approved (approval is a press on a pin), and were counted by nothing, because
 * the canvas filters them out of every view on purpose. The only thing in the product that could still see them
 * was the arming step of Clear All, which reads the raw array, so it counted far more than the hand-off said.
 * A comment attached to something that was deleted is deleted with it.
 *
 * AN UNREAD NOTE IS NOT SWEPT, AND THAT EXCEPTION IS LOAD-BEARING. `canvas-view.tsx` counts an unread note
 * whether or not its frame survives, because a comment whose screen is gone is still feedback — the rule was
 * written after two real notes about deleted options stopped being handed off and the canvas showed nothing to
 * hand over at all. Unread words survive their screen and keep travelling until an agent drains them.
 *
 * WHERE THEY GO. The route commits every write to `design-canvas/comments/.history`, so a swept record is one
 * `git log -p` away rather than gone.
 *
 * A FUNCTION, AND CALLED FROM BOTH EXITS, because the no-op exit is where this class of bug lives. The orphan
 * prune had to learn the same thing: the pruning sat at the end of a run, so a capture where nothing had
 * changed skipped it, and a screen that left the declaration kept its picture forever. A run that captures
 * nothing still has to clean up after a declaration that did change — that is exactly when a screen was
 * deleted and nothing else was touched.
 */
function sweepAnsweredComments(comments, declaredIds) {
  const swept = [];
  const kept = comments.filter((comment) => {
    const answered = Boolean(comment.consumedAt);
    const verdict = Boolean(comment.kind) && comment.kind !== "note";
    const homeless = !declaredIds.has(comment.screenId);
    /**
     * A NOTE needs BOTH: answered by an agent AND its screen gone. Either alone is still somebody's turn — an
     * unread note travels in the hand-off whatever happened to its frame, and an answered one on a live screen
     * is the reviewer's to approve.
     *
     * A VERDICT needs EITHER. Consumed, it is spent by definition; homeless, the option it judged does not
     * exist, so there is nothing left to build three variations of. That second case is the one that piled up,
     * because `canvas-view.tsx` already refuses to count it (`spent()`) and nothing ever removed it.
     */
    if (!(verdict ? answered || homeless : answered && homeless)) return true;
    swept.push(comment.id);
    return false;
  });
  for (const id of swept) {
    /* `c` plus digits is the only id the route mints, and it is the only shape allowed to reach a path here. */
    if (!/^c\d+$/.test(id)) continue;
    const picture = path.join(COMMENT_IMAGES, `${id}.png`);
    if (existsSync(picture)) rmSync(picture);
  }
  return { kept, swept };
}

/**
 * THE REVIEW FILE, WRITTEN ONCE PER RUN, from both exits: the re-pins planned before anything was captured, the sweep, the
 * stale marks on re-photographed screens (`byScreen`, `rephotographed`) and the waiting queue (`lineage`, `before`,
 * `after`). The file is read again here, so a comment left during the capture is kept. When records move or go, the file
 * as found is committed to the history first, so their words survive in the commit before.
 */
async function saveComments({ declaredIds, lineage, before, after, byScreen = new Map(), rephotographed = new Set(), identical }) {
  const file = await readCommentFile(REVIEW);
  const { kept, swept } = sweepAnsweredComments(applyMoves(file.comments, pinMoves, pinFrames, pinHashOf), declaredIds);
  /* `byScreen` is the manifest's own map, last write wins, so a screen that needed a second pass answers with its fresh shot. */
  const { comments, flagged } = markStale(kept, { byScreen, rephotographed, moved: movedThisRun });
  const waiting = nextWaiting({ waiting: file.waiting, frames: lineage, before, after, declared: declaredIds, successors: declaration.successors, identical, viewed: Boolean(file.viewedAt) });
  const why = [
    pinMoves.length > 0 ? `capture re-pinned ${pinMoves.map((move) => move.id).join(", ")} to their successor frames` : null,
    swept.length > 0 ? `capture swept ${swept.join(", ")}` : null,
    flagged > 0 ? `capture marked ${flagged} stale` : null,
    waiting !== file.waiting ? "capture queued screens for review" : null,
  ].filter(Boolean);
  if (why.length === 0) return;
  if (pinMoves.length > 0 || swept.length > 0)
    await commitHistory(REVIEW, `as found, before the capture ${pinMoves.length > 0 ? "re-pinned" : "swept"} it`);
  await writeCommentFile(REVIEW, { ...file, comments, waiting }, why.join("; "));
  if (flagged > 0) console.log(`\n${flagged} comment(s) marked stale: the screen under them was captured again`);
  if (swept.length > 0) console.log(`\n${swept.length} answered comment(s) removed with the screen they pointed at: ${swept.join(", ")}`);
  if (waiting !== file.waiting) {
    const count = (kind) => Object.values(waiting ?? {}).filter((one) => one === kind).length;
    console.log(`screens waiting for review: ${count("new")} new, ${count("changed")} changed`);
  }
}

/**
 * THE ADDRESS the pages are photographed at: `--url`, else the project's dev server from `design-canvas/settings.json`. There is
 * no default port: an assumed `localhost:3000` is often another app's server.
 */
const settings = loadSettings(HERE, "capture");
const base = (argOf("url") ?? requireAppUrl(settings, "capture")).replace(/\/+$/, "");
const only = (argOf("only") ?? "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);
/**
 * CHANGED FRAMES ONLY, BY DEFAULT. Each shot records a STAMP: a content hash of every project file the screen's `source` entries
 * reach through their imports (`filesReachedFrom`), the global inputs below, and the screen's own declaration. A screen is
 * captured when any of it differs, when it has no picture, or when its shot has no stamp. Content hashes, because an mtime
 * changes on a checkout and git cannot see an uncommitted edit. `check-canvas.mjs` reports any drift this misses. A full
 * recapture would also mark every comment stale, including the ones on screens nobody touched. `--all` captures everything;
 * `--changed` is still accepted and does nothing.
 */
const captureAll = process.argv.includes("--all");
const changedOnly = !captureAll;

/**
 * THE INPUTS NO IMPORT GRAPH REACHES, hashed into every screen: the design tokens and global stylesheet (wired in by the build)
 * and the pin adapter. A file here that does not exist is skipped. The stylesheet sits in the project's App Router folder: `app/`
 * at the root, else `src/app/` (Next serves a root `app/` when both exist).
 */
const APP_DIR = !existsSync(path.join(ROOT, "app")) && existsSync(path.join(ROOT, "src", "app")) ? "src/app" : "app";
const GLOBAL_INPUTS = [
  "tailwind.config.ts",
  "tailwind.config.js",
  `${APP_DIR}/globals.css`,
  "design-canvas/project/canvas-state-pin.tsx",
];

/**
 * What a screen is made of, hashed: everything it imports, the file that implements its pinned state, and the declaration
 * itself. Two screens of one route at different states have different stamps, because the state is in the declaration.
 */
function stampOf(screen) {
  const sources = {};
  const entries = [...(screen.source ?? []), ...GLOBAL_INPUTS];
  /* A wireframe is its own served HTML, outside the tree: its hash is fetched once per run (below the `declared` line). */
  if (screen.wireframe)
    sources[`wireframe:${screen.url}`] = screen.wireframeHash ?? "unhashed";
  /* A pinned screen depends on the file that implements its state: rewriting a fixture changes the picture. */
  if (/[?&]canvas=/.test(screen.url ?? ""))
    entries.push("design-canvas/project/states.ts");
  for (const file of filesReachedFrom(entries, ROOT)) {
    /* The viewer is in no picture. The pin adapter imports one constant from core/, which would pull the whole viewer into every
       pinned screen's closure, so every reinstall would recapture the canvas. A core change that could affect captures goes
       through `--all`. */
    if (file.startsWith("design-canvas/core/")) continue;
    const at = path.join(ROOT, file);
    sources[file] = existsSync(at)
      ? createHash("sha256").update(readFileSync(at)).digest("hex").slice(0, 16)
      : "missing";
  }
  return {
    /* Everything about the screen that decides what the picture contains (`declStamp` in recapture.mjs, which judges it too). */
    decl: declStamp(screen, declaration),
    sources,
  };
}

/** Has anything this screen is made of changed since the shot in the manifest was taken? */
function changedSince(screen, shot) {
  if (!shot || !shot.stamp) return true;
  const now = stampOf(screen);
  if (now.decl !== shot.stamp.decl) return true;
  const before = shot.stamp.sources ?? {};
  const paths = new Set([...Object.keys(now.sources), ...Object.keys(before)]);
  for (const file of paths) if (now.sources[file] !== before[file]) return true;
  return false;
}

/** Quality of the WebP: type and hairlines survive, and it loads instantly. */
const QUALITY = 92;
/** The scale of the small copy in `small/`, drawn while a frame is small on screen: a second shutter on the same settled page. */
const SMALL_SCALE = 0.25;
/** How long the loaded checks may take before the capture goes ahead and says it timed out. */
const LOAD_TIMEOUT_MS = 45_000;
/** How long to wait for the animations that end. */
const ANIMATION_TIMEOUT_MS = 9_000;
/**
 * THE SETTLE after a load, a press or a resize: no document has changed for `SETTLE_QUIET_MS` (`WATCH_CHANGES` stamps every
 * mutation), for at most `SETTLE_CAP_MS`. A page that keeps changing pays the cap; the waits after it still stand.
 */
const SETTLE_QUIET_MS = 400;
const SETTLE_CAP_MS = 1200;
/**
 * How long a positive claim may take to appear before it is called unproved. Large because a pinned state lands on hydration,
 * which a loaded dev server can delay; a passing claim ends the wait the moment it appears.
 */
const CLAIM_BUDGET_MS = 25_000;
/** How long to wait for the pinned state to be in place: a whole hydration under load. The wait ends when the mark appears. */
const PIN_TIMEOUT_MS = 45_000;
/** The line a states file logs for a state it does not have (`applyCanvasState` in the starter). */
const UNKNOWN_STATE_LINE = /Unknown pinned state/;
/** Below this, the image is blank or nearly so, whatever the DOM claimed. */
const MIN_BYTES = 6_000;
/**
 * A page taller than its viewport by more than this is captured WHOLE. A surface that does not scroll the window (a fixed
 * dialog whose insides scroll) stays one screen, because for it one screen is the design.
 */
const LONG_PAGE_SLACK = 1.1;
/** However long a page is, it stops here. */
const MAX_PAGE_H = 8_000;
/**
 * THE QUIET WAIT: after the page loads and after its steps, until no fetch or XHR has been in flight for `QUIET_MS`, for at most
 * `QUIET_CAP_MS` (network.mjs). Held requests and long-lived ones (`LONG_LIVED_MS`) do not count. A page that is never quiet
 * pays the cap and gets a note, never a failure.
 */
const NETWORK_WAIT = !process.argv.includes("--no-network-wait");

/** How many frames are photographed at once, read before any browser starts so a bad number stops the run first. */
const LANES = (() => {
  const asked = argOf("lanes") ?? process.env.CANVAS_LANES;
  /* Six on a dev server: more pages at once gain nothing there (the server is the bottleneck). capture-run asks for eight. */
  if (asked === undefined || asked === "") return 6;
  const count = Number(asked);
  if (!Number.isInteger(count) || count < 1 || count > 16) die("capture", `--lanes (or CANVAS_LANES) takes a whole number from 1 to 16, not "${asked}"`);
  return count;
})();

function argOf(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

/**
 * THE DECLARATION, read from `project/flows.ts` in process (`screensFor` in dump-screens.mjs), so a capture needs no server for
 * it and reads the same screens against a dev server and a production build. `--screens-file <json>` reads a frozen copy in
 * that shape instead (the tests use it).
 */
const screensFile = argOf("screens-file");
let declaration;
try {
  declaration = screensFile ? JSON.parse(readFileSync(screensFile, "utf8")) : await screensFor(HERE, canvasSlug);
} catch (error) {
  console.error(`capture: ${String(error?.message ?? error).split("\n")[0]}`);
  process.exit(1);
}
const { viewport, screens: served } = declaration;
/* Explanation frames are text panels the flow view draws itself: no route, no picture. They leave the run here. */
const declared = (served ?? []).filter((s) => !s.explain);

/**
 * STEPS AND NETWORK RULES ARE VALIDATED BEFORE ANY BROWSER EXISTS, for every declared screen and the canvas-wide list: a typo
 * fails in milliseconds with the screen and the position named. Exit 2, because nothing was tried.
 */
{
  const bad = [];
  try {
    parseNetwork(declaration.network, "the canvas", { canvas: true });
  } catch (error) {
    bad.push(error.message);
  }
  for (const screen of declared) {
    try {
      parseSteps(screen.steps, screen.id);
    } catch (error) {
      bad.push(error.message);
    }
    try {
      parseNetwork(screen.network, screen.id);
    } catch (error) {
      bad.push(error.message);
    }
  }
  if (bad.length > 0) {
    console.error(`capture: ${bad.length} declaration(s) hold steps or network rules that cannot run:`);
    for (const line of bad) console.error(`  - ${line}`);
    process.exit(SETUP_EXIT);
  }
}

/** The comments this run moves to a successor frame: a move is not a recapture, so the stale pass leaves them alone. */
const movedThisRun = new Set();

/**
 * COMMENT INTEGRITY, BEFORE ANYTHING IS CAPTURED, SWEPT OR SELECTED. A frame that left the declaration takes its live
 * comments to the successor the declaration names (`successors`), and a frame that left with live comments and nowhere
 * to send them REFUSES the run, with the frame and the ids named and nothing touched. See `comment-integrity.mjs`:
 * otherwise comments pinned to frames a promotion removed silently disappear from the review. The moves are applied by
 * `saveComments`, in the run's one write.
 *
 * Every frame the canvas declares counts, explanation frames included: a comment cannot be pinned to one, but a frame
 * that turns into one is still declared.
 */
const pinFrames = declaredFrames(served ?? []);
let pinMoves = [];
/* The picture hash each successor has now, so a moved comment goes stale only if its new frame's picture changes. */
let pinHashOf = () => undefined;
{
  const plan = planPins({ comments: (await readCommentFile(REVIEW)).comments, declared: pinFrames, successors: declaration.successors });
  if (plan.refused.length > 0 || plan.problems.length > 0) {
    console.error(`capture: REFUSED. The declaration drops frames that still carry comments:`);
    for (const line of refusalLines(plan)) console.error(`  - ${line}`);
    process.exit(SETUP_EXIT);
  }
  if (plan.moves.length > 0) {
    const manifestNow = (() => {
      try {
        return JSON.parse(readFileSync(path.join(SHOTS, "manifest.json"), "utf8")).shots ?? [];
      } catch {
        return [];
      }
    })();
    pinHashOf = (frame) => manifestNow.find((shot) => shot.screenId === frame)?.hash;
    pinMoves = plan.moves;
    for (const move of plan.moves) movedThisRun.add(move.id);
  }
  const said = planSummary(plan);
  if (said) console.log(said);
}
/**
 * WIREFRAMES ARE HASHED BEFORE SELECTION, because selection is what the hash decides: a wireframe names no file in this tree,
 * so its served HTML is read here, with every same-origin src and href it names (a reshot still keeps its HTML byte for byte).
 * Unreachable is a value: the capture then says the page did not load.
 */
const assetUrls = (body, base) =>
  [...body.matchAll(/\b(?:src|href)\s*=\s*["']([^"'#]+)["']/gi)]
    .map((m) => {
      try {
        return new URL(m[1], base);
      } catch {
        return null;
      }
    })
    .filter((u) => u && u.origin === new URL(base).origin)
    .map((u) => u.href);
for (const s of declared) {
  if (!s.wireframe || !s.url) continue;
  try {
    const body = await (await fetch(s.url)).text();
    const hash = createHash("sha256").update(body);
    for (const asset of [...new Set(assetUrls(body, s.url))].sort()) {
      try {
        hash.update(asset).update(Buffer.from(await (await fetch(asset)).arrayBuffer()));
      } catch {
        hash.update(`${asset}:unreachable`);
      }
    }
    s.wireframeHash = hash.digest("hex").slice(0, 16);
  } catch {
    s.wireframeHash = "unreachable";
  }
}
/**
 * ONE CAPTURE PER CANVAS AT A TIME: a run holds `rounds/<slug>/capture.lock` from before it reads the manifest until it exits,
 * and a second run waits. `--plan` writes nothing and does not wait.
 */
if (!process.argv.includes("--plan")) {
  const lock = path.join(HERE, "rounds", canvasSlug, "capture.lock");
  let said = false;
  while (!takeLock(lock)) {
    if (!said) console.log(`waiting: another capture of ${canvasSlug} is running (pid ${lockHolder(lock) ?? "unknown"})`);
    said = true;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  process.on("exit", () => {
    if (lockHolder(lock) === process.pid) rmSync(lock, { force: true });
  });
}
/* What was captured last time: selection decides from it. */
const manifestPath = path.join(SHOTS, "manifest.json");
const previous = existsSync(manifestPath)
  ? JSON.parse(readFileSync(manifestPath, "utf8"))
  : { shots: [] };
const shotOfPrevious = new Map(
  (previous.shots ?? []).map((shot) => [shot.screenId, shot]),
);
const declaredIds = new Set(declared.map((screen) => screen.id));

/** Delete the pictures of frames no longer declared and return their entries. Both exits prune: a deleted screen is a change. */
function pruneOrphans() {
  const gone = (previous.shots ?? []).filter((shot) => !declaredIds.has(shot.screenId));
  for (const shot of gone) {
    rmSync(path.join(SHOTS, shot.file), { force: true });
    rmSync(path.join(SHOTS, "small", shot.file), { force: true });
  }
  return gone;
}
/**
 * WHAT EACH EXPLORATION STARTED FROM (`bases`, see parity.mjs): the commit checked out the first time it is captured and the
 * files its original screen reached, kept while it is declared, and for a retired real-code one until its parity check
 * passes. Undefined when there is none (outside git, or no exploration), so the manifest carries no empty key.
 */
function basesNow() {
  try {
    const next = nextBases({ root: ROOT, previous: previous.bases, explorations: declaration.explorations ?? [], screens: served ?? [] });
    const { bases, released, kept } = releaseRetired({ root: ROOT, canvasDir: HERE, bases: next });
    for (const id of released) console.log(`exploration "${id}": its base is released, because its parity check passes after it was retired`);
    for (const id of kept) console.log(`exploration "${id}" is retired and its parity check does not pass yet: node design-canvas/parity.mjs --canvas ${canvasSlug} says what is lost`);
    for (const [id, record] of Object.entries(bases))
      if (!previous.bases?.[id]) console.log(`exploration "${id}": base recorded at ${record.commit.slice(0, 12)} (${record.files.length} file(s) of "${record.original}", ${record.mode} mode)`);
    return Object.keys(bases).length > 0 ? bases : undefined;
  } catch (error) {
    console.log(`could not record the explorations' bases (${String(error?.message ?? error).split("\n")[0]}): the ones on record are kept`);
    return previous.bases;
  }
}

/** The manifest's shots with each exploration frame's switch to today's screen remembered (`recordToday`). */
const withToday = (shots) =>
  recordToday({ shots, previous: previous.shots, explorations: declaration.explorations, successors: declaration.successors });

const screens = (
  only.length > 0
    ? declared.filter((s) => only.includes(s.id))
    : changedOnly
      ? declared.filter((s) => changedSince(s, shotOfPrevious.get(s.id)))
      : declared
).filter((s) => {
  /* A FROZEN screen is preserved history: its state no longer exists in the app, so it is never recaptured once it has a
     picture. See `CanvasScreen.frozen`. */
  if (!s.frozen || !shotOfPrevious.get(s.id)) return true;
  console.log(`frozen ${s.id.padEnd(28)} preserved history — never recaptured`);
  return false;
});

/**
 * `--first <ids>`: the frames on the reviewer's screen. They go to the front of the queue, in that order, so the pictures being
 * looked at arrive first; which frames are captured is decided above and does not change.
 */
{
  const first = (argOf("first") ?? "").split(",").map((id) => id.trim()).filter(Boolean);
  const rank = (screen) => (first.includes(screen.id) ? first.indexOf(screen.id) : first.length);
  if (first.length > 0) screens.sort((a, b) => rank(a) - rank(b));
}

/**
 * TODAY'S SCREEN HAS TO HAVE ITS CONTROLS ON RECORD for an option to be compared with it: a screen an option being captured
 * redesigns, whose picture predates the list, is captured once with it (the picture usually comes out identical).
 */
for (const exploration of declaration.explorations ?? []) {
  for (const one of exploration.screens ?? []) {
    if (typeof one.redesigns !== "string" || !screens.some((s) => s.id === one.id) || screens.some((s) => s.id === one.redesigns)) continue;
    const today = declared.find((s) => s.id === one.redesigns);
    const had = shotOfPrevious.get(one.redesigns);
    if (!today || (today.frozen && had) || Array.isArray(had?.controls)) continue;
    screens.push(today);
    console.log(`also capturing ${today.id}: ${one.id} redesigns it, and its controls are not on record yet`);
  }
}

/**
 * `--plan`: say which screens would be captured, and stop (`round.mjs` opens exactly those in its preflight). The checks above
 * have run; no browser, picture or comment has been touched.
 */
if (process.argv.includes("--plan")) {
  console.log(`plan: ${screens.map((one) => one.id).join(",")}`);
  process.exit(0);
}

/* What was skipped is always said, so nobody reads "3 captured" as "the other 25 were checked". */
if (changedOnly) {
  const skipped = declared.filter((s) => !screens.includes(s));
  console.log(
    `${screens.length} of ${declared.length} screen(s) to capture` +
      (screens.length > 0 ? `: ${screens.map((s) => s.id).join(", ")}` : "") +
      (screens.length === 0 ? " — nothing they depend on has changed" : ""),
  );
  if (skipped.length > 0)
    console.log(
      `  ${skipped.length} left alone: nothing in their import closure, their pinned state or the global tokens changed.\n` +
        `  \`--all\` captures everything regardless; check-canvas.mjs reports any drift this missed.\n`,
    );
  if (screens.length === 0) {
    const gone = pruneOrphans();
    const bases = basesNow();
    if (gone.length > 0 || JSON.stringify(bases ?? null) !== JSON.stringify(previous.bases ?? null)) {
      const { bases: _was, ...rest } = previous;
      writeFileSync(
        manifestPath,
        `${JSON.stringify({ ...rest, shots: withToday((previous.shots ?? []).filter((shot) => declaredIds.has(shot.screenId))), ...(bases ? { bases } : {}) }, null, 2)}\n`,
        "utf8",
      );
      if (gone.length > 0)
        console.log(
          `${gone.length} no longer declared and removed: ${gone.map((shot) => shot.screenId).join(", ")}`,
        );
    }
    /* The comments of those same screens, for the same reason: a declaration that lost a screen is exactly the
       change that captures nothing, so this exit is where an answered comment would otherwise be stranded. */
    const kept = (previous.shots ?? []).filter((shot) => declaredIds.has(shot.screenId));
    await saveComments({
      declaredIds,
      lineage: classifyFrames({ before: previous.shots ?? [], after: kept, successors: declaration.successors }),
      before: previous.shots ?? [],
      after: kept,
    });
    console.log("Nothing has changed. The canvas is up to date.");
    process.exit(0);
  }
}

if (screens.length === 0) {
  console.error("Nothing to capture.");
  process.exit(1);
}

mkdirSync(SHOTS, { recursive: true });

/* ------------------------------------------------------------- in-page steps */

/**
 * Step 0, as the page is built, planted in every document before the app's own scripts: EVERY CHANGE TO A DOCUMENT IS STAMPED
 * (`__canvasChangedAt`, for the settle), and every image is made eager the moment it is added. A headless page never scrolls,
 * so a lazy image would never load and the picture would pass every check with holes where the photographs belong.
 */
const WATCH_CHANGES = () => {
  window.__canvasChangedAt = performance.now();
  const eager = (image) => {
    if (image.loading === "lazy") image.loading = "eager";
    if (image.getAttribute("decoding") === "async") image.setAttribute("decoding", "sync");
  };
  window.__canvasEager = eager;
  new MutationObserver((records) => {
    window.__canvasChangedAt = performance.now();
    for (const record of records) {
      if (record.type === "attributes" && record.target instanceof HTMLImageElement) eager(record.target);
      for (const node of record.addedNodes) {
        if (node instanceof HTMLImageElement) eager(node);
        else if (node.querySelectorAll) for (const image of node.querySelectorAll("img")) eager(image);
      }
    }
  }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
};

/** Step 0 again, on demand: every image already in the page and in the frames it mounts, made eager. */
const EAGER = () => {
  for (const doc of [document, ...[...document.querySelectorAll("iframe")].map((frame) => frame.contentDocument)])
    for (const image of [...(doc?.images ?? [])]) window.__canvasEager(image);
};

/**
 * The settle: every document of the page unchanged for `SETTLE_QUIET_MS`, all within one `SETTLE_CAP_MS`. The quiet counts from
 * the start of the settle at the earliest, because a page reacts to a press or a resize a frame or two later.
 */
async function settle(page) {
  const until = Date.now() + SETTLE_CAP_MS;
  const frames = page.frames();
  for (const frame of frames) await frame.evaluate(() => (window.__canvasSettleFrom = performance.now())).catch(() => undefined);
  for (const frame of frames) {
    const left = until - Date.now();
    if (left <= 0) return;
    await frame
      .waitForFunction(
        (quiet) => performance.now() - Math.max(window.__canvasChangedAt ?? 0, window.__canvasSettleFrom ?? 0) >= quiet,
        SETTLE_QUIET_MS,
        { timeout: left, polling: 50 },
      )
      .catch(() => undefined);
  }
}

/**
 * Step 1. Everything that has to have arrived: the document, its text, its fonts, and ONLY THE IMAGES THAT WILL BE IN THE
 * PICTURE (a whole-page picture: every image down the page), in the frames the page mounts too. A cross-origin frame cannot be
 * read and is not waited for.
 */
const LOADED = (wholePage = false) => {
  const inShot = (image) => {
    const box = image.getBoundingClientRect();
    return (
      box.width > 2 &&
      box.height > 2 &&
      (wholePage || (box.bottom > 0 && box.top < window.innerHeight)) &&
      box.right > 0 &&
      box.left < window.innerWidth
    );
  };
  const ready = (doc) =>
    Boolean(doc) &&
    doc.readyState === "complete" &&
    (doc.body?.innerText ?? "").trim().length > 0 &&
    [...doc.images].filter(inShot).every((image) => image.complete);
  if (!ready(document)) return false;
  if (document.fonts && document.fonts.status !== "loaded") return false;
  for (const frame of [...document.querySelectorAll("iframe")]) {
    if (!frame.src || frame.src === "about:blank") continue;
    let doc = null;
    try {
      doc = frame.contentDocument;
    } catch {
      continue;
    }
    if (!doc) continue;
    if (!ready(doc)) return false;
  }
  return true;
};

/** Step 2. Pause what never ends, so that waiting for the rest can actually finish. */
const PAUSE_ENDLESS = () => {
  for (const animation of document.getAnimations()) {
    const timing = animation.effect?.getTiming?.();
    if (timing && timing.iterations === Infinity) animation.pause();
  }
};

/**
 * Step 2's test: nothing is still playing. `getAnimations()` knows CSS animations and transitions only, so motion an app drives
 * itself (`requestAnimationFrame`, timers) says so with `data-canvas-busy` on an element while it moves or has beats still to
 * come (references/traps.md, trap 16). A scroll-driven animation never stops (nothing scrolls), so it is not waited for: the
 * freeze shows it revealed.
 */
const NOTHING_RUNNING = () =>
  document
    .getAnimations()
    .filter((animation) => !animation.timeline || animation.timeline instanceof DocumentTimeline)
    .every((animation) => animation.playState !== "running") && !document.querySelector("[data-canvas-busy]");

/** Step 3. The freeze, so nothing can move between the two captures that prove the page is still. */
const FREEZE = () => {
  const STYLE_ID = "design-canvas-hold";
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `*, *::before, *::after {
      animation-play-state: paused !important;
      animation-delay: 0s !important;
      transition: none !important;
      caret-color: transparent !important;
    }`;
    (document.head ?? document.documentElement).appendChild(style);
  }
  for (const animation of document.getAnimations()) {
    if (animation.playState === "running") animation.pause();
  }
  /**
   * SCROLL-DRIVEN REVEALS ARE SHOWN REVEALED. A band that fades in as it scrolls into view holds `opacity: 0` before its range,
   * and a whole-page shot never scrolls, so every band below the fold would be a white hole. Re-attaching the animation in
   * JavaScript does not survive the shot's own resize (the cascade rebuilds it), so the elements are stamped and a rule drops
   * the animation; `opacity: 1` covers an IntersectionObserver reveal of the same shape.
   */
  const REVEALED = "data-canvas-revealed";
  for (const animation of document.getAnimations()) {
    if (!animation.timeline || animation.timeline instanceof DocumentTimeline)
      continue;
    const target = animation.effect?.target;
    if (target instanceof Element) target.setAttribute(REVEALED, "");
  }
  const REVEAL_ID = "design-canvas-revealed";
  if (
    document.querySelector(`[${REVEALED}]`) &&
    !document.getElementById(REVEAL_ID)
  ) {
    const style = document.createElement("style");
    style.id = REVEAL_ID;
    style.textContent = `[${REVEALED}] { animation: none !important; opacity: 1 !important; }`;
    (document.head ?? document.documentElement).appendChild(style);
  }
  for (const video of [...document.querySelectorAll("video")]) {
    try {
      video.pause();
    } catch {
      /* a video that refuses to pause is not worth failing a capture over */
    }
  }
  /* NOTHING IS LEFT FOCUSED, IN ANY DOCUMENT: a caret blinks with no animation attached, and a focus ring (an `autoFocus` field)
     is not the resting design. Frames a surface mounts are blurred too. */
  const blurAll = (doc) => {
    if (doc?.activeElement instanceof doc.defaultView.HTMLElement)
      doc.activeElement.blur();
  };
  blurAll(document);
  for (const frame of [...document.querySelectorAll("iframe")]) {
    try {
      blurAll(frame.contentDocument);
    } catch {
      /* Cross-origin: nothing to blur and nothing to fail over. */
    }
  }
};

/* ------------------------------------------------------------------ the run */

/**
 * AN APP BEHIND A LOGIN is captured with a Playwright storage state the person saved once, by hand:
 *   npx playwright open --save-storage=design-canvas/auth-state.json <app url>
 * `--storage-state <path>`, `CANVAS_STORAGE_STATE` or `storageState` in settings.json names it. It holds live session tokens:
 * gitignored by the installer, and never printed. A missing or unreadable file stops the run with the fix.
 */
const storageState =
  argOf("storage-state") ?? process.env.CANVAS_STORAGE_STATE ?? settings.storageState ?? undefined;
requireStorageState("capture", storageState, base);
/* A crash past the catches below prints one line, never a call log carrying the session. */
guardCrashes({ who: "capture", storageState });

/**
 * WHICH BROWSER. The bundled Chromium has no H.264 codec, so an MP4 player photographs as an error box; an app with video
 * captures on the installed Chrome (`--browser-channel chrome`, `CANVAS_BROWSER_CHANNEL` or `browserChannel` in settings.json).
 */
const browserChannel =
  argOf("browser-channel") ?? process.env.CANVAS_BROWSER_CHANNEL ?? settings.browserChannel ?? undefined;

/** Where the run's seconds went: the run's own steps, and each wait summed over every frame, printed at the end. */
const spent = new Map();
const spend = (name, ms) => spent.set(name, (spent.get(name) ?? 0) + ms);
const runPhases = [];
/* From the start of the process, so reading the declaration and the comments counts as the run's first step. */
let runLapAt = Date.now() - Math.round(process.uptime() * 1000);
const runLap = (name) => {
  const now = Date.now();
  runPhases.push(`${name} ${((now - runLapAt) / 1000).toFixed(1)}s`);
  runLapAt = now;
};

/* A DEAD ADDRESS IS ONE LINE, before any browser or lane starts (a wireframe-only run asks the app for nothing). */
if (screens.some((screen) => !screen.wireframe)) await requireAppAnswers("capture", base);

/* A launch or context failure is one line, scrubbed of anything from the session (browser-guards.mjs). */
const browser = await launchBrowser(chromium, {
  who: "capture",
  channel: browserChannel,
  storageState,
});
/* THE BROWSER IS CLOSED HOWEVER THE RUN ENDS: this `try` runs to the end of the file (left unindented), and its `finally` closes
   the browser and its process group; an exit, a signal or a SIGKILL is caught by browser-lifecycle.mjs (trap 37). */
try {
const context = await openContext(
  browser,
  {
    viewport: { width: viewport.w, height: viewport.h },
    deviceScaleFactor: 1,
    /* Motion is allowed to run so it can FINISH: reduced motion would capture a different product. A service worker answers
       from itself and never reaches a route, so it is blocked whenever network rules exist (the write guard blocks it too). */
    ...(hasNetwork(declaration.network, undefined) || screens.some((one) => hasNetwork(undefined, one.network)) ? { serviceWorkers: "block" } : {}),
  },
  { who: "capture", storageState, origin: base },
);
/* THE CAPTURE MARKS ITS OWN BROWSER, so a photograph-only shortcut in app code (`canvasCapturing()` in the project's states
   file) applies here and never on the page a reviewer's Open button lands on. The oracle does not set it. Trap 22. */
await context.addInitScript(() => {
  window.__designCanvasCapture = true;
});
await context.addInitScript(WATCH_CHANGES);

/**
 * THE OVERLAYS THIS PROJECT HAS DECLARED (`design-canvas/dismiss.json`): localStorage seeds planted before the app's scripts,
 * clicks on each page once it has loaded. What the list misses is caught by `forbid`. See browser-guards.mjs.
 */
const dismissals = loadDismissals(HERE, canvasSlug, "capture");
await seedDismissals(context, dismissals.seeds);
/** What the click steps actually did this run, by button name, so a dismissal that never fires is visible. */
const dismissed = new Map();
runLap("browser");
const dismissNow = async (page) => {
  if (dismissals.clicks.length === 0) return;
  for (const name of await clickDismissals(page, dismissals.clicks))
    dismissed.set(name, (dismissed.get(name) ?? 0) + 1);
};

/**
 * A LOGIN REDIRECT STOPS THE RUN IN SECONDS: the first real page is opened once, before anything else, and a sign-in route
 * ends the run with exit 2 and the fix. `--no-login-check` is for a canvas whose first frame is deliberately behind a redirect;
 * `--login-route /welcome` (or `CANVAS_LOGIN_ROUTE`) names a sign-in route that is not called login or sign-in.
 */
if (!process.argv.includes("--no-login-check")) {
  const first = screens.find((screen) => !screen.wireframe && screen.url);
  if (first) {
    const probe = await context.newPage();
    const firstUrl = `${base}${first.url}`;
    const reached = await probe
      .goto(firstUrl, { waitUntil: "domcontentloaded", timeout: 30_000 })
      .then(() => true, () => false);
    /* A page that does not load at all is the real pass's to report, with the screen's own name on it. */
    if (reached)
      await checkLoginRedirect(probe, firstUrl, {
        who: "capture",
        storageState,
        appUrl: base,
        loginRoute: argOf("login-route") ?? process.env.CANVAS_LOGIN_ROUTE ?? settings.loginRoute ?? undefined,
      });
    await probe.close();
  }
  runLap("login check");
}

/**
 * THE WARM PASS: `next dev` compiles a route inside the load budget of whichever capture asks first, so every route is visited
 * once in a browser (an HTTP fetch never runs the client bundle), failures ignored. `--no-warm` skips it (a build is warm).
 */
if (!process.argv.includes("--no-warm")) {
  const warmUrls = [
    /* A wireframe is a static file on another server: nothing to compile, nothing to warm. */
    ...new Set(
      screens
        .filter((screen) => !screen.wireframe)
        .map((screen) => `${base}${screen.route}`),
    ),
  ];
  process.stdout.write(`warming ${warmUrls.length} route(s) `);
  const warmPage = await context.newPage();
  for (const url of warmUrls) {
    try {
      await warmPage.goto(url, { waitUntil: "load", timeout: 90_000 });
      /* One settle beat so the client bundle actually evaluates rather than just arriving. */
      await warmPage.waitForTimeout(400);
      process.stdout.write(".");
    } catch {
      process.stdout.write("!");
    }
  }
  await warmPage.close();
  process.stdout.write(" done\n");
  runLap("warm");
}

const shots = [];
/** Screen id to `{ before, after, size }`, for every picture this run wrote: the visual change report reads it. */
const deltaInputs = new Map();
/** Screen ids whose picture was actually written this run. Filled at the one place a fresh shot is pushed. */
const rephotographed = new Set();
const failures = [];
/** Frames whose steps could not be done: listed apart, never retried. See `StepError`. */
const staleSteps = [];
/** Frames with an image that finished failing (a dead file): listed apart, never retried. See `brokenImagesVerdict`. */
const brokenImageFrames = [];
const notes = [];

/**
 * THE CHANNELS THIS RUN STOPPED WAITING FOR, shared by every page so a request the app always holds open is learned once
 * (`LONG_LIVED_MS` in network.mjs), and the frames each was skipped on, said once at the end.
 */
const longLived = new Set();
/** signature -> screen ids whose quiet wait did not count it */
const longLivedSkipped = new Map();

/** The quiet wait (`NETWORK_WAIT`): a note, never a failure, when the page's data was still out at the cap. */
async function waitForQuiet(screen, control, when) {
  if (!NETWORK_WAIT) return;
  const result = await control.tracker.quiet({ quietMs: QUIET_MS, capMs: QUIET_CAP_MS });
  for (const signature of result.ignored ?? []) {
    const frames = longLivedSkipped.get(signature) ?? new Set();
    frames.add(screen.id);
    longLivedSkipped.set(signature, frames);
  }
  if (result.quiet) return;
  const first = result.pending[0] ?? "";
  notes.push(
    `${screen.id}: the network was not quiet within ${QUIET_CAP_MS / 1000}s ${when} (${result.pending.length} request(s) still in flight, the first ${first.length > 90 ? `${first.slice(0, 90)}...` : first}): ` +
      `the picture may be taken before that data arrived; --no-network-wait switches the wait off for an app that always has one`,
  );
}

/**
 * A SECOND PASS, ALONE, FOR THE SCREENS THE LANES COULD NOT PROVE: one at a time, after the lanes drain and a calm of
 * `SECOND_PASS_CALM_MS`, because the cause is contention (a route compiling under load, a pin landing late), not a short
 * timeout (trap 21). A screen that needed it is listed at the end; one that fails again keeps its previous picture.
 */
const SECOND_PASS_CALM_MS = 3_000;
const needsSecondPass = [];
const provedOnSecondPass = [];

async function captureOne(screen, secondPass = false) {
  const page = await context.newPage();
  /* THE STATES FILE'S OWN WORD that the pinned state does not exist: read beside the pin component's mark, so a project whose pin
     component predates the mark is caught too. */
  let unknownState = false;
  if (screen.state)
    page.on("console", (message) => {
      if (message.type() === "error" && UNKNOWN_STATE_LINE.test(message.text())) unknownState = true;
    });
  /**
   * THIS SCREEN'S VIEWPORT: its own `viewport`, else its device's (`deviceViewport`, resolved in the declaration), else the
   * canvas's. Always set, a desktop one included: a page keeps whatever size the previous screen left it at, so a desktop frame
   * after a phone frame would be laid out at the phone's width. Every measurement below is against this one.
   */
  const shotViewport =
    screen.viewport?.w && screen.viewport?.h
      ? screen.viewport
      : screen.deviceViewport?.w && screen.deviceViewport?.h
        ? screen.deviceViewport
        : viewport;
  await page.setViewportSize({ width: shotViewport.w, height: shotViewport.h });
  /* A wireframe's url is already absolute: its own server, not the app's base. */
  const url = screen.wireframe ? screen.url : `${base}${screen.url}`;
  const started = Date.now();
  /* Where this frame's seconds went, printed on its line. */
  const phases = [];
  let lapAt = started;
  const lap = (name) => {
    const now = Date.now();
    if (now - lapAt >= 500) phases.push(`${name} ${Math.round((now - lapAt) / 100) / 10}`);
    spend(name, now - lapAt);
    lapAt = now;
  };
  /* A page that never finishes loading cannot be captured honestly; an animation that never ends is ordinary (a spinner) and
     is pinned by the freeze. */
  let neverLoaded = false;
  let stillMoving = 0;
  /* What the page's data does on this frame (`network.mjs`), put on THIS page before it navigates, so it reaches no other frame. */
  const net = mergeNetwork(declaration.network, screen.network);
  let control = null;
  /** Step 0 and 1: every image made eager, then everything in the shot arrived (`wholePage`: down the whole page). */
  const ready = async (wholePage, timeout) => {
    await page.evaluate(EAGER).catch(() => undefined);
    await page.waitForFunction(LOADED, wholePage, { timeout }).catch(() => {
      neverLoaded = true;
    });
  };
  /** After the load and after the steps: arrived, settled, declared overlays dismissed, and the page's data in. */
  const arrive = async (when) => {
    await ready(false, LOAD_TIMEOUT_MS);
    lap("load");
    await settle(page);
    lap("settle");
    await dismissNow(page);
    lap("dismiss");
    await waitForQuiet(screen, control, when);
    lap("quiet");
  };
  /** The text of every document in the page, its frames included, read by `fn`. */
  const readFrames = async (fn) => {
    const texts = [];
    for (const frame of page.frames()) texts.push(await frame.evaluate(fn).catch(() => ""));
    return texts.join("\n");
  };

  try {
    control = await applyNetwork(page, net, { longLived });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    lap("open");
    await arrive("after the page loaded");

    /* WHAT A PERSON DOES TO GET HERE (`steps`), pressed by the module the oracle's Open pass uses, then the same arrival again:
       the press may mount a dialog, a list, an image. A step that cannot be done throws a `StepError`. */
    if (screen.steps?.length) {
      await runSteps(page, screen.steps, { dismissals });
      lap("steps");
      await arrive("after its steps");
    }

    /* MEASURE THE LOADED DESIGN, NOT THE SKELETON: the height is decided below, and a list still fetching measures short. So
       the declared claims are waited for first, bounded; on a miss it measures what is there and the claim fails later. */
    if (screen.expect?.length) {
      await page
        .waitForFunction(
          (needles) => {
            const text = document.body?.innerText ?? "";
            return needles.every((needle) => text.includes(needle));
          },
          screen.expect,
          { timeout: 15_000 },
        )
        .catch(() => undefined);
    }

    /* THE PAGE MUST BE LAID OUT AT THE WIDTH ITS PICTURE CLAIMS (a scrollbar may cost a few pixels; a device apart may not). */
    const laidOutAt = await page.evaluate(() => window.innerWidth);
    if (Math.abs(laidOutAt - shotViewport.w) > 24) {
      throw new Error(
        `laid out at ${laidOutAt}px but its picture is ${shotViewport.w}px wide — the viewport moved under this screen`,
      );
    }
    /**
     * HOW TALL THE PICTURE IS, decided by the page: the taller of what the window scrolls (`doc`) and what the page's main inner
     * scroller hides (`inner`), because an app may scroll a content column and never the window. Only a scroller at least half
     * the viewport tall counts, and one inside something `position: fixed` (a dialog, sized to the viewport by definition) does
     * not: growing the window for it would photograph a dialog nobody at this size sees.
     */
    const scrolls = await page.evaluate((vh) => {
      const pinned = (node) => {
        for (let at = node; at && at !== document.documentElement; at = at.parentElement) {
          if (getComputedStyle(at).position === "fixed") return true;
        }
        return false;
      };
      let inner = 0;
      let innerPinned = false;
      for (const node of document.querySelectorAll("*")) {
        const overflow = getComputedStyle(node).overflowY;
        if (overflow !== "auto" && overflow !== "scroll") continue;
        if (node.clientHeight < vh * 0.5) continue;
        const over = node.scrollHeight - node.clientHeight;
        if (over <= inner) continue;
        if (pinned(node)) {
          innerPinned = true;
          continue;
        }
        inner = over;
      }
      return { doc: document.documentElement.scrollHeight, inner, innerPinned };
    }, shotViewport.h);
    /* `oneViewport` declines the inner-scroller growth only (a data table sized to the viewport); the document's own height
       still decides, so it cannot hide content below the fold. */
    const pageHeight = screen.oneViewport
      ? scrolls.doc
      : Math.max(scrolls.doc, shotViewport.h + scrolls.inner);
    let wholePage = pageHeight > shotViewport.h * LONG_PAGE_SLACK;
    let shotH = wholePage ? Math.min(pageHeight, MAX_PAGE_H) : shotViewport.h;
    /* AN INNER SCROLLER IS OPENED BY GROWING THE WINDOW, as a tall monitor would, never by editing its overflow (which reflows
       the page into something the design never is). */
    let grown =
      wholePage && scrolls.inner > 0 && scrolls.doc <= shotViewport.h;
    if (grown) {
      await page.setViewportSize({ width: shotViewport.w, height: shotH });
      await settle(page);
    }
    /* Everything below the fold is in the shot now, so it has to have arrived. */
    if (wholePage) await ready(true, LOAD_TIMEOUT_MS);
    /* A LONG SHOT MUST HAVE CONTENT IN ITS LENGTH, checked on the result: when the deepest visible leaf (containers stretch
       with the window and prove nothing) sits within one viewport, the extension revealed nothing and the frame is one screen. */
    if (wholePage) {
      const contentBottom = await page
        .evaluate(() => {
          let bottom = 0;
          for (const el of document.body.querySelectorAll("*")) {
            const isMedia = /^(IMG|VIDEO|CANVAS|SVG)$/.test(el.tagName);
            if (el.children.length > 0 && !isMedia) continue;
            const box = el.getBoundingClientRect();
            if (box.width < 2 || box.height < 2) continue;
            const edge = box.bottom + window.scrollY;
            if (edge > bottom) bottom = edge;
          }
          return bottom;
        })
        .catch(() => shotH);
      if (contentBottom <= shotViewport.h * LONG_PAGE_SLACK) {
        wholePage = false;
        grown = false;
        shotH = shotViewport.h;
        await page.setViewportSize({
          width: shotViewport.w,
          height: shotViewport.h,
        });
        await settle(page);
        notes.push(
          `${screen.id}: a long-page measure revealed no content below one screen — captured one viewport`,
        );
      }
    }
    /* Once more before the shutter: the wait above gave the page time to render more of itself. */
    await ready(wholePage, 15_000);

    /* Every document in the page, its frames included: an animation inside a mounted frame can ruin a capture too. */
    const inEveryFrame = async (fn) => {
      for (const frame of page.frames())
        await frame.evaluate(fn).catch(() => undefined);
    };
    lap("page height");
    await inEveryFrame(PAUSE_ENDLESS);
    for (const frame of page.frames()) {
      await frame
        .waitForFunction(NOTHING_RUNNING, null, {
          timeout: ANIMATION_TIMEOUT_MS,
        })
        .catch(async () => {
          /* Counted, not failed: the freeze pins what is left and the two identical shots prove the picture is still. */
          stillMoving += await frame
            .evaluate(
              () =>
                document
                  .getAnimations()
                  .filter((a) => a.playState === "running").length,
            )
            .catch(() => 1);
        });
    }
    await inEveryFrame(FREEZE);
    await hideDevOverlay(page);
    lap("motion");

    /**
     * `focus: "<selector>"` PUTS THE FOCUS BACK after the freeze blurred it, for a frame of someone typing, with the caret at the
     * end of the field (and invisible, so the two shots agree). It is a claim: a selector that stops matching fails the frame.
     */
    let focusClaim = null;
    if (screen.focus) {
      const target = await page.$(screen.focus).catch(() => null);
      if (target) {
        await target.focus().catch(() => undefined);
        await page
          .evaluate((selector) => {
            const node = document.querySelector(selector);
            if (
              node instanceof HTMLInputElement ||
              node instanceof HTMLTextAreaElement
            ) {
              const end = node.value.length;
              node.setSelectionRange(end, end);
            }
          }, screen.focus)
          .catch(() => undefined);
      }
      focusClaim = {
        claim: `focus on ${screen.focus}`,
        met: await page
          .evaluate(
            (selector) => document.activeElement === document.querySelector(selector),
            screen.focus,
          )
          .catch(() => false),
      };
    }

    /**
     * Step 4, the claims, across every document. A positive claim is read from the frame's own SURFACE (`SURFACE_TEXT` in
     * steps.mjs: the open dialog stack, or the body when nothing is open), so the page behind a dialog is not evidence, and it
     * is re-read until every claim is in or `CLAIM_BUDGET_MS` runs out: a pinned state lands on hydration, which a loaded run
     * delays. The canvas's `forbid` reads the whole document.
     */
    const readPage = () => readFrames(SURFACE_TEXT);
    /* The visible controls and labels of every document, kept on the shot: an option is compared with today's screen by them. */
    const readControls = async () => {
      const all = [];
      for (const frame of page.frames()) all.push(...(await frame.evaluate(CONTROLS).catch(() => [])));
      return [...new Set(all)];
    };
    const readWholeDocument = () => readFrames(() => document.body?.innerText ?? "");

    /* A SKELETON IS NOT A SCREEN: a list still loading is steady and quiet, so its placeholders are waited out, and a frame that
       still shows them after the budget says so. */
    const countSkeletons = () =>
      page
        .evaluate(
          () =>
            document.querySelectorAll(
              '[aria-busy="true"],[data-loading="true"],[data-skeleton],.animate-pulse',
            ).length,
        )
        .catch(() => 0);
    /**
     * FIRST, THE PIN ITSELF: `CanvasStatePin` sets `data-canvas-pinned` on `<html>` once the store holds the pinned state and the
     * page has rendered with it; everything else is satisfiable by the default rendering (trap 19). A pin that never arrives is
     * one claim that names the cause, not every claim missing (the pinned body is hidden, so its text reads empty).
     */
    let pinned = true;
    if (screen.state) {
      pinned = await page
        .waitForFunction(
          () => document.documentElement.hasAttribute("data-canvas-pinned"),
          { timeout: PIN_TIMEOUT_MS },
        )
        .then(() => true)
        .catch(() => false);
      /* A STATE THE STATES FILE DOES NOT HAVE: the page is the default rendering, so nothing on it is evidence for this frame. */
      const mark = await page.evaluate(() => document.documentElement.getAttribute("data-canvas-pinned")).catch(() => null);
      if (mark === "unknown") unknownState = true;
      if (unknownState) pinned = false;
    }

    /* A second pass: an overlay that opened late (a promo on a timer) is gone before the claims are read. */
    await dismissNow(page);
    const wanted = pinned ? (screen.expect ?? []) : [];
    /* A frame that IS a loading state (`animated`, or a hold rule that was hit) keeps its placeholders: they are its picture. */
    let skeletons = screen.animated || control.holding() ? 0 : await countSkeletons();
    if (skeletons > 0) {
      const settleBy = Date.now() + CLAIM_BUDGET_MS;
      while (Date.now() < settleBy && skeletons > 0) {
        await page.waitForTimeout(250);
        skeletons = await countSkeletons();
      }
    }
    /* An `expectSelector` is waited for like text, in the frame's own document or any nested one. */
    const selectorFound = async () => {
      if (!screen.expectSelector) return true;
      for (const frame of page.frames()) if (await frame.$(screen.expectSelector).catch(() => null)) return true;
      return false;
    };
    let page_text = await readPage();
    lap("placeholders");
    let selectorMet = await selectorFound();
    /* A rule of this frame's own is a claim too: the page has to have ASKED for what the capture holds, fails or answers. */
    const allMet = () => wanted.every((claim) => page_text.includes(claim)) && selectorMet && control.unmet().length === 0;
    if (!allMet()) {
      const until = Date.now() + CLAIM_BUDGET_MS;
      while (Date.now() < until && !allMet()) {
        await page.waitForTimeout(250);
        page_text = await readPage();
        selectorMet = await selectorFound();
      }
    }
    lap("claims");
    const claims = wanted.map((claim) => ({
      claim,
      met: page_text.includes(claim),
    }));
    for (const rule of control.unmet()) claims.push({ claim: unmetClaim(rule), met: false });
    if (skeletons > 0)
      claims.push({
        claim: `the surface finished loading within ${CLAIM_BUDGET_MS / 1000}s (${skeletons} placeholder(s) still on screen)`,
        met: false,
      });
    if (unknownState)
      claims.push({
        claim: `the pinned state "${screen.state}" exists in design-canvas/project/states.ts (the page showed the default instead)`,
        met: false,
      });
    else if (!pinned)
      claims.push({
        claim: `the pinned state "${screen.state}" was applied within ${PIN_TIMEOUT_MS / 1000}s`,
        met: false,
      });
    /* `expectMissing` is the positive claim inverted, so it reads the frame's own surface; the page behind a dialog is full of
       other states' words. */
    const whole_text = await readWholeDocument();
    const controls = await readControls();
    for (const absent of screen.expectMissing ?? []) {
      claims.push({
        claim: `nothing saying "${absent}"`,
        met: !page_text.includes(absent),
      });
    }
    /* Canvas-wide forbidden text, checked on every frame against the whole document: the tripwire for an overlay. */
    for (const banned of declaration.forbid ?? []) {
      claims.push({
        claim: `nothing saying "${banned}" — text this canvas forbids on every frame`,
        met: !whole_text.includes(banned),
      });
    }
    if (focusClaim) claims.push(focusClaim);
    if (screen.expectSelector) claims.push({ claim: screen.expectSelector, met: selectorMet });

    /* LATE ARRIVALS FINISH THEIR ENTRANCE: a surface that mounted after the freeze would be pinned at frame zero of its entry
       animation, invisible in both proof shots. So every animation is driven to its end right before the shutter (trap 49). */
    const finishAll = async () => {
      for (const frame of page.frames()) {
        await frame
          .evaluate(() => {
            for (const animation of document.getAnimations()) {
              try {
                animation.finish();
              } catch {
                animation.cancel();
              }
            }
          })
          .catch(() => undefined);
      }
    };
    await finishAll();
    await page.waitForTimeout(150);

    /* Step 4b, the photography arrived, counted in every document. TWO KINDS OF HOLE: an image not yet `complete` is on its way
       (a second pass can catch it), one that is complete with no natural size has finished FAILING (`broken`, a dead file: no
       retry fills it; trap 47). */
    let media = { shown: 0, empty: 0, broken: 0 };
    const brokenSources = [];
    for (const frame of page.frames()) {
      const counted = await frame
        .evaluate((all) => {
          let shown = 0;
          let empty = 0;
          let broken = 0;
          const sources = [];
          for (const image of [...document.images]) {
            const box = image.getBoundingClientRect();
            const onScreen =
              box.width > 2 &&
              box.height > 2 &&
              (all || (box.bottom > 0 && box.top < window.innerHeight)) &&
              box.right > 0 &&
              box.left < window.innerWidth;
            if (!onScreen) continue;
            shown += 1;
            if (image.naturalWidth !== 0) continue;
            empty += 1;
            if (image.complete) {
              broken += 1;
              if (sources.length < 3) sources.push(image.currentSrc || image.getAttribute("src") || "(no src)");
            }
          }
          return { shown, empty, broken, sources };
        }, wholePage)
        .catch(() => ({ shown: 0, empty: 0, broken: 0, sources: [] }));
      media = {
        shown: media.shown + counted.shown,
        empty: media.empty + counted.empty,
        broken: media.broken + counted.broken,
      };
      brokenSources.push(...counted.sources);
    }
    /** Images still on their way when the shutter opened: a hole a later pass can fill. */
    const unarrived = media.empty - media.broken;

    /* Step 5 — identical twice over. */
    lap("measure");
    const cdp = await context.newCDPSession(page);
    /* THE SHUTTER'S OWN SESSION CARRIES THE VIEWPORT: a clipped `Page.captureScreenshot` from a second session makes installed
       Chrome drop Playwright's emulation and lay the page out at its window's height (trap 45). The guard after the shots names
       any repeat. */
    const laidOut = page.viewportSize() ?? { width: shotViewport.w, height: shotViewport.h };
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: laidOut.width,
      height: laidOut.height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const shoot = async (scale = 1) => {
      const { data } = await cdp.send("Page.captureScreenshot", {
        format: "webp",
        quality: QUALITY,
        /* Beyond the viewport only when the WINDOW is what scrolls; a grown window already shows the whole page. The clip is
           this screen's width and the recorded height, so the manifest and the file cannot disagree. */
        captureBeyondViewport: wholePage && !grown,
        clip: { x: 0, y: 0, width: shotViewport.w, height: shotH, scale },
      });
      return Buffer.from(data, "base64");
    };
    /* An `animated` surface cannot produce the same bytes twice, so its last shot is accepted as one instant of it; the loop
       still runs in full, because the retries are also the page's settling time. Every later shot finishes the animations
       first, for a surface that mounted during the gap. */
    const { image, stable, tries } = await stableShot(page, () => shoot(), { before: finishAll });
    /* Optional: a frame without its small copy is drawn from the full picture. */
    const small = await shoot(SMALL_SCALE).catch(() => null);
    lap("shots");
    /* The page was still the height its picture claims when the shutter closed. */
    const shotAt = await page.evaluate(() => window.innerHeight).catch(() => laidOut.height);
    if (shotAt !== laidOut.height) {
      throw new Error(
        `laid out ${shotAt}px tall during the shots but its viewport is ${laidOut.height}px — the browser dropped the viewport under the shutter`,
      );
    }

    /**
     * Step 5b, THE INTERACTION ORIGINS, measured: each declared `CanvasEdge.origin` resolves on the settled page to exactly one
     * visible control (text: the innermost element whose whole text is the spec; `css=`: a selector, as in `steps`), in picture pixels, inside
     * the picture. Anything else fails like a missed claim. Main frame only (an iframe has its own coordinates).
     */
    const origins = [];
    /* The origin claims that failed: measured on the settled page, so a second pass would measure the same. */
    const originMisses = new Set();
    for (const wanted_origin of screen.origins ?? []) {
      /* A `css=` origin resolves through the same Playwright lookup as a `css=` step (`cssLocator`, so `:has-text()` and `>> nth=`
         mean the same in both); text is matched in the page against `document`, from `:root`. */
      const css = isCssTarget(wanted_origin.origin);
      const found = await (css ? cssLocator(page, wanted_origin.origin) : page.locator(":root"))
        .evaluateAll(
          (elements, { spec, css }) => {
            const visible = (el) => {
              const box = el.getBoundingClientRect();
              if (box.width < 3 || box.height < 3) return false;
              const style = window.getComputedStyle(el);
              return style.visibility !== "hidden" && style.display !== "none";
            };
            let matches = [];
            if (css) {
              matches = elements.filter(visible);
            } else {
              const text = spec.trim();
              const all = [...document.querySelectorAll("*")].filter(
                (el) =>
                  visible(el) &&
                  (el.innerText ?? "").trim() === text &&
                  el.children.length < 12,
              );
              /* Innermost only: a pressed button matches along with every wrapper around it. */
              matches = all.filter(
                (el) => !all.some((other) => other !== el && el.contains(other)),
              );
            }
            if (matches.length !== 1) return { count: matches.length };
            const box = matches[0].getBoundingClientRect();
            return {
              count: 1,
              x: Math.round(box.x + window.scrollX),
              y: Math.round(box.y + window.scrollY),
              w: Math.round(box.width),
              h: Math.round(box.height),
            };
          },
          { spec: wanted_origin.origin, css },
        )
        .catch(() => ({ count: 0 }));
      if (found.count !== 1) {
        const miss = {
          claim: `origin "${wanted_origin.origin}" (edge to ${wanted_origin.to}) resolves to exactly one visible place — it resolved to ${found.count}`,
          met: false,
        };
        claims.push(miss);
        originMisses.add(miss);
        continue;
      }
      /* A few pixels of overhang is rounding at the crop line and is clamped in; more is a control the picture does not show. */
      const SLACK = 8;
      const overX = Math.max(0, -found.x) + Math.max(0, found.x + found.w - shotViewport.w);
      const overY = Math.max(0, -found.y) + Math.max(0, found.y + found.h - shotH);
      if (overX > SLACK || overY > SLACK) {
        const miss = {
          claim: `origin "${wanted_origin.origin}" (edge to ${wanted_origin.to}) sits inside the captured picture — it measured at ${found.x},${found.y} ${found.w}x${found.h} on a ${shotViewport.w}x${shotH} shot`,
          met: false,
        };
        claims.push(miss);
        originMisses.add(miss);
        continue;
      }
      origins.push({
        to: wanted_origin.to,
        origin: wanted_origin.origin,
        x: Math.min(Math.max(found.x, 0), shotViewport.w - found.w),
        y: Math.min(Math.max(found.y, 0), shotH - found.h),
        w: found.w,
        h: found.h,
      });
    }

    const file = `${screen.id}.webp`;
    /**
     * A FAILED CAPTURE NEVER REPLACES A PICTURE THAT WORKED: a shot with a problem below is reported and dropped, and the previous
     * file and its manifest entry stay. A screen with no previous picture is written anyway: an unfinished frame is better
     * evidence than a missing one. `brokenImages: true` declares an app that really shows a broken image, `sparse` a page that
     * really is under the blank floor; a declared-broken screen where every image loads fails (the flag is stale).
     */
    const kept = shotOfPrevious.get(screen.id);
    const keptExists = Boolean(kept && existsSync(path.join(SHOTS, kept.file)));
    /* A picture far smaller than the one it replaces, from a page with almost no text, is a page that did not arrive
       (`shot-guard.mjs`). */
    const broken = brokenShot({
      bytes: image.byteLength,
      previousBytes: keptExists ? kept.bytes : undefined,
      chars: textLength(whole_text),
      sparse: Boolean(screen.sparse),
    });
    /* A broken image refuses the picture only when the old one had fewer holes, and never goes to the second pass. */
    const worseImages = brokenImagesVerdict({
      broken: media.broken,
      previousHoles: keptExists ? (kept.images?.broken ?? kept.images?.empty ?? 0) : undefined,
      declared: Boolean(screen.brokenImages),
    });
    const missed = claims.filter((one) => !one.met);
    /* Each problem once: `reason` says why a picture is refused, `line` is its failure when the picture is written anyway. */
    const problems = [
      missed.length > 0 && {
        reason: "a claim it does not prove",
        line: `captured a page that does not have ${missed.map((one) => `"${one.claim}"`).join(", ")}`,
      },
      neverLoaded && { reason: "a page that never finished arriving", line: "gave up waiting for the page to finish arriving" },
      image.byteLength < MIN_BYTES && !screen.sparse && {
        reason: "a blank page",
        line: `the picture is ${image.byteLength} bytes, which is a blank page`,
      },
      broken && { reason: broken },
      !screen.brokenImages && unarrived > 0 && {
        reason: `images that never loaded (${unarrived} of ${media.shown})`,
        line: `${unarrived} of ${media.shown} images on screen never loaded — the picture has holes in it`,
      },
      worseImages && { reason: worseImages },
      Boolean(screen.brokenImages) && media.shown > 0 && media.empty === 0 && {
        reason: "no broken image on a screen declared broken — the bug healed",
        line: "declared broken images and every image loaded — the bug healed, update the declaration",
      },
    ].filter(Boolean);
    const rejected = problems.map((one) => one.reason);
    /* A STATE THAT DOES NOT EXIST IS FINAL AND NEVER WRITTEN: a second pass renders the same default, and the default under this
       frame's name is a wrong picture, not an unfinished one, so even a frame with no previous picture gets none. */
    if (unknownState) {
      if (keptExists) shots.push(kept);
      failures.push(
        `${screen.id}: its pinned state "${screen.state}" is not in design-canvas/project/states.ts, so the page showed the default and ${keptExists ? "the previous picture was KEPT" : "no picture was written"}. Add the state, or point the frame at one that exists`,
      );
      console.log(`${keptExists ? "KEPT" : "FAIL"} ${screen.id.padEnd(28)} unknown pinned state "${screen.state}"${keptExists ? " — previous picture left in place" : ""}`);
      return;
    }
    const brokenNamed = brokenSources.length > 0 ? ` (${brokenSources.join(", ")}${media.broken > brokenSources.length ? ", ..." : ""})` : "";
    if (rejected.length > 0 && keptExists) {
      /* Refused for the broken images alone: final, because a second pass would load the same dead address. */
      if (rejected.length === 1 && worseImages) {
        shots.push(kept);
        brokenImageFrames.push(`${screen.id}: ${worseImages}${brokenNamed}, so the previous picture was KEPT (restore the file, or declare brokenImages: true if the app really shows it broken)`);
        console.log(`KEPT ${screen.id.padEnd(28)} ${worseImages}${brokenNamed} — previous picture left in place`);
        return;
      }
      /* First time round this is not a verdict yet: queued for the quiet pass, and nothing is reported. A frame refused for its
         origins alone is final at once. */
      const onlyOrigins = rejected.length === 1 && missed.length > 0 && missed.every((one) => originMisses.has(one));
      if (!secondPass && !onlyOrigins) {
        needsSecondPass.push(screen);
        shots.push(kept);
        console.log(
          `hold ${screen.id.padEnd(28)} ${rejected.join(", ")} — second pass queued`,
        );
        return;
      }
      shots.push(kept);
      failures.push(
        `${screen.id}: captured ${rejected.join(" and ")}${secondPass ? " on both passes" : ""}, so the previous picture was KEPT — fix it, then capture this one screen`,
      );
      if (missed.length > 0)
        failures.push(
          `${screen.id}: the page does not have ${missed.map((one) => `"${one.claim}"`).join(", ")}`,
        );
      console.log(
        `KEPT ${screen.id.padEnd(28)} ${rejected.join(", ")} — previous picture left in place`,
      );
      return;
    }
    if (secondPass) provedOnSecondPass.push(screen.id);

    /* The picture this one replaces, read BEFORE it is overwritten: the visual change report compares the two. */
    const replaced = path.join(SHOTS, file);
    deltaInputs.set(screen.id, { before: existsSync(replaced) ? readFileSync(replaced) : null, after: image, size: { w: shotViewport.w, h: shotH } });
    writeFileSync(replaced, image);
    const smallFile = path.join(SHOTS, "small", file);
    if (small) {
      mkdirSync(path.dirname(smallFile), { recursive: true });
      writeFileSync(smallFile, small);
    } else rmSync(smallFile, { force: true });
    const hash = createHash("sha256").update(image).digest("hex").slice(0, 16);
    const shot = {
      screenId: screen.id,
      url: screen.url,
      file,
      /* THIS screen's size, which the canvas lays the frame out by. */
      w: shotViewport.w,
      h: shotH,
      wholePage,
      bytes: image.byteLength,
      /* The size of the copy in `small/`. */
      ...(small ? { small: { w: Math.round(shotViewport.w * SMALL_SCALE), h: Math.round(shotH * SMALL_SCALE) } } : {}),
      capturedAt: new Date().toISOString(),
      claims,
      stable,
      /* Declared perpetual motion: the oracle reads this to skip its own stability verdict. */
      animated: Boolean(screen.animated),
      tries,
      hash,
      images: media,
      /* Animations that never ended and were pinned mid-flight. Zero is the normal answer. */
      pausedMidFlight: stillMoving,
      /* What this picture is OF: selection and the oracle's drift note both read it. */
      stamp: stampOf(screen),
      /* What an option is compared with today's screen by (`removedControls` in visual-delta.mjs). */
      controls,
      /* Present only when declared: an empty field would say "measured, found none". */
      ...(screen.origins?.length ? { origins } : {}),
      ...(net.rules.length > 0 ? { network: control.report() } : {}),
    };
    shots.push(shot);
    /* Only fresh writes land here, never a kept picture: the comment pass needs that distinction. */
    rephotographed.add(screen.id);

    const lines = problems.filter((one) => one.line).map((one) => `${screen.id}: ${one.line}`);
    if (!stable && !screen.animated) lines.splice(missed.length > 0 ? 1 : 0, 0, `${screen.id}: never captured the same picture twice — still moving`);
    failures.push(...lines);
    if (stillMoving > 0)
      notes.push(
        `${screen.id}: ${stillMoving} animation(s) never ended and were pinned where they were`,
      );
    if (!screen.brokenImages && media.broken > 0)
      brokenImageFrames.push(`${screen.id}: photographed with ${media.broken} of ${media.shown} images broken${brokenNamed} (the file failed to load; restore it, or declare brokenImages: true if the app really shows it broken)`);

    console.log(
      `${missed.length === 0 && (stable || screen.animated) && !neverLoaded ? "ok  " : "FAIL"} ${screen.id.padEnd(28)} ` +
        `${String(Math.round(image.byteLength / 1024)).padStart(4)}kb ` +
        `${String(shotH).padStart(4)}px${wholePage ? "*" : " "} ` +
        `claims=${claims.length - missed.length}/${claims.length} stable=${stable}(${tries}) ` +
        `images=${media.shown - media.empty}/${media.shown}${media.broken > 0 ? `(${media.broken} broken)` : ""} ` +
        (net.rules.length > 0 ? `net=[${describeHits(control)}] ` : "") +
        `${Math.round((Date.now() - started) / 100) / 10}s` +
        (lap("write"), phases.length ? ` [${phases.join(", ")}]` : "") +
        /* Why a frame went full length: `doc` is what the document claims, `col` what the tallest inner scroller hides. */
        `${wholePage ? ` whole:doc=${scrolls.doc},col=${scrolls.inner},pinned=${scrolls.innerPinned}` : ""}`,
    );
  } catch (error) {
    if (error instanceof StepError) {
      /* A STEP THAT COULD NOT BE DONE IS FINAL and listed apart: the declaration no longer describes the page, and a second pass
         would wait out the same timeouts. The previous picture stays. */
      staleSteps.push(`${screen.id}: ${error.message}`);
      console.log(`STEP ${screen.id.padEnd(28)} ${error.message}`);
    } else {
      failures.push(`${screen.id}: ${error.message}`);
      console.log(`FAIL ${screen.id.padEnd(28)} ${error.message}`);
    }
  } finally {
    /* A held request is aborted BEFORE its page closes: closing a page with a request still paused lets the browser send it. */
    const closing = Date.now();
    await control?.dispose();
    await page.close();
    spend("close", Date.now() - closing);
  }
}

/* A shared queue rather than a chunked split, so a slow page cannot hold four fast ones behind it. */
console.log(`capturing ${screens.length} screen(s), ${Math.min(LANES, screens.length)} at a time`);
const queue = [...screens];
await Promise.all(
  Array.from({ length: Math.min(LANES, queue.length) }, async () => {
    for (let next = queue.shift(); next; next = queue.shift())
      await captureOne(next);
  }),
);
runLap("frames");

/* THE QUIET PASS, after a calm: a dev server is still finishing the compiles the lanes asked for when they empty (measured: a
   pass fired at once still failed two of four screens that pass alone). Paid only when something needs it. */
if (needsSecondPass.length > 0) {
  console.log(
    `\nsecond pass, one at a time: ${needsSecondPass.map((one) => one.id).join(", ")}`,
  );
  await new Promise((done) => setTimeout(done, SECOND_PASS_CALM_MS));
  for (const screen of needsSecondPass) await captureOne(screen, true);
  runLap("second pass");
}

/* What this run did to each frame against the manifest it started from (`new-frames.mjs`), read before the report so a renamed
   frame is compared with the picture it had under its old id. */
const lineage = classifyFrames({
  before: previous.shots ?? [],
  after: [...(previous.shots ?? []).filter((shot) => declaredIds.has(shot.screenId)), ...shots],
  successors: declaration.successors,
});
for (const { from, to } of lineage.renamed) {
  const input = deltaInputs.get(to);
  const old = shotOfPrevious.get(from);
  const oldFile = old ? path.join(SHOTS, old.file) : null;
  if (input && !input.before && oldFile && existsSync(oldFile)) input.before = readFileSync(oldFile);
}

/* THE VISUAL CHANGE REPORT (`visual-delta.mjs`), while the browser that decodes the pictures is open. It never fails a capture. */
let measured = [];
if (!process.argv.includes("--no-delta")) {
  try {
    const here = applyMoves((await readCommentFile(REVIEW)).comments, pinMoves, pinFrames, pinHashOf);
    measured = await reportVisualChange({
      context,
      inputs: deltaInputs,
      comments: here,
      outDir: argOf("delta-out") ?? path.join(HERE, "rounds", canvasSlug, "latest"),
      canvasSlug,
      flagPct: settings.flagPct ?? FLAG_PCT,
      /* A round's own folder: a retry of a round that failed compares with the pictures the round started from. */
      keepOriginals: process.argv.includes("--keep-originals"),
    });
  } catch (error) {
    console.log(`\nvisual change report skipped: ${String(error?.message ?? error).split("\n")[0]}`);
  }
  runLap("change report");
}

await closeBrowser(browser);
runLap("close");

/* The manifest is MERGED (a changed-only run keeps the rest) and PRUNED (a screen deleted from the declaration takes its
   picture and entry with it). One entry per screen, last write wins: the second pass pushes a fresh shot after the kept one. */
const orphans = pruneOrphans();
const byScreen = new Map();
for (const shot of [...(previous.shots ?? []).filter((shot) => declaredIds.has(shot.screenId)), ...shots]) byScreen.set(shot.screenId, shot);
const final = withToday([...byScreen.values()]);
const bases = basesNow();
writeFileSync(
  manifestPath,
  `${JSON.stringify(
    {
      contract:
        "Captured by design-canvas/capture.mjs. Every shot records the claims that were true in the page when it was taken, and `stable` means two consecutive captures came out identical, which is the proof it is a settled design and not a page mid-load. Recapture with `node design-canvas/capture.mjs`.",
      capturedAt: new Date().toISOString(),
      viewport,
      shots: final.sort((a, b) => a.screenId.localeCompare(b.screenId)),
      ...(bases ? { bases } : {}),
    },
    null,
    2,
  )}\n`,
  "utf8",
);

/* WHAT THE ORACLE'S LIVE PASS OWES A VISIT: the frames this run re-photographed, whose Open destination nobody has opened yet.
   A list that cannot be written costs the next oracle run a note, never this capture. */
try {
  if (rephotographed.size > 0) markUnproven(HERE, canvasSlug, [...rephotographed]);
} catch (error) {
  notes.push(`could not record the re-photographed frames for the oracle's live pass (${String(error?.message ?? error).split("\n")[0]}): run check-canvas.mjs with --live-all to open them`);
}

/* The review file, beside the orphan prune its sweep belongs to. */
/* Identical to the picture it replaced: a frame compared with a retried round's original is judged against the replaced file. */
const sameAsReplaced = (id) => Boolean(deltaInputs.get(id)?.before?.equals(deltaInputs.get(id).after));
const identical = new Set(measured.filter((frame) => (frame.sinceFirstAttempt ? sameAsReplaced(frame.id) : frame.status === "identical")).map((frame) => frame.id));
console.log(`\n${sayFrames(lineage, identical)}`);
await saveComments({ declaredIds, lineage, before: previous.shots ?? [], after: final, byScreen, rephotographed, identical });

for (const [signature, frames] of longLivedSkipped) {
  notes.push(
    `not waited for on ${frames.size} frame(s): ${signature.length > 90 ? `${signature.slice(0, 90)}...` : signature}, a request open longer than ` +
      `${LONG_LIVED_MS / 1000}s (a stream, a subscription or a long-poll${longLived.has(signature) ? ", still open when its page closed" : ""}); if it is a slow read instead, its frames may be taken before it answered`,
  );
}
/* Frame phases are summed over every frame, so with several lanes they add up to more than the run's own "frames" step. */
console.log(`\ntime: ${runPhases.join(", ")}`);
if (spent.size > 0)
  console.log(`time in frames, summed: ${[...spent].map(([name, ms]) => `${name} ${(ms / 1000).toFixed(1)}s`).join(", ")}`);
if (notes.length > 0) {
  console.log("\nnotes:");
  for (const note of notes) console.log(`  - ${note}`);
}
console.log(
  /* Distinct screens THIS run touched, not the size of the whole manifest. */
  `\n${new Set(shots.map((shot) => shot.screenId)).size} of ${screens.length} screens captured into design-canvas/shots/` +
    (orphans.length > 0
      ? `\n${orphans.length} no longer declared and removed: ${orphans.map((shot) => shot.screenId).join(", ")}`
      : ""),
);
/* A screen that only passes when it is captured alone is a fact about the screen. */
if (provedOnSecondPass.length > 0)
  console.log(
    `${provedOnSecondPass.length} needed a second pass alone: ${provedOnSecondPass.join(", ")}`,
  );
if (dismissed.size > 0)
  console.log(
    `dismissed from design-canvas/dismiss.json: ${[...dismissed].map(([name, count]) => `"${name}" x${count}`).join(", ")}`,
  );
/* Stale steps and broken images are listed apart from the problems (`  !`): neither is retried, because a retry would wait out the
   same timeouts or load the same dead address. */
if (staleSteps.length > 0) {
  console.log(
    `\n${staleSteps.length} FRAME(S) WHOSE STEPS COULD NOT BE DONE, not run again (the declaration no longer describes the page, or the server was too slow to show the control; capture the frame alone with --only <id> to tell which):`,
  );
  for (const line of staleSteps) console.log(`  ! ${line}`);
}
if (brokenImageFrames.length > 0) {
  console.log(`\n${brokenImageFrames.length} FRAME(S) WITH A BROKEN IMAGE, not run again (an image the browser finished loading with nothing in it):`);
  for (const line of brokenImageFrames) console.log(`  ! ${line}`);
}
if (failures.length > 0) {
  console.log(`\n${failures.length} PROBLEM(S):`);
  for (const failure of failures) console.log(`  - ${failure}`);
  /* A forbidden text on a frame is an overlay covering the picture: the remedy is named once, under the failures. */
  const forbidHits = new Set(
    failures.filter((failure) => failure.includes("text this canvas forbids")).map((failure) => failure.split(":")[0]),
  ).size;
  if (forbidHits > 0)
    console.log(`\n${forbidRemedy({ appUrl: base, storageState, hits: forbidHits })}`);
  process.exit(1);
}
if (staleSteps.length > 0) {
  console.log(`\n${staleSteps.length} frame(s) were not captured: their steps could not be done (listed above)`);
  process.exit(1);
}
if (brokenImageFrames.length > 0) {
  console.log(`\n${brokenImageFrames.length} frame(s) have a broken image in them (listed above)`);
  process.exit(1);
}
console.log("every capture proved its claims and came out identical twice");
/* What comes after a capture, said last because most readers see only the tail. `round.mjs` passes --no-next and says its own. */
if (!process.argv.includes("--no-next")) {
  /* What each option photographed now no longer shows of today's screen, for the hand-over. */
  const removed = removedLines(removedControls({ explorations: declaration.explorations, shots: final, ids: rephotographed }));
  if (removed.length > 0) console.log(`\n${removed.join("\n")}\nnext: include this list in the hand-over, per option, so nothing today's screen does goes missing unseen`);
  let undrained = [];
  try {
    undrained = undrainedIn((await readCommentFile(REVIEW)).comments);
  } catch {
    /* An unreadable comments file is the oracle's to report. */
  }
  const files = [...new Set(shots.filter((shot) => rephotographed.has(shot.screenId)).map((shot) => shot.file))].map((file) =>
    path.relative(ROOT, path.join(SHOTS, file)).split(path.sep).join("/"),
  );
  const lines = afterCapture({ slug: canvasSlug, files, undrained });
  if (lines.length > 0) console.log(`\n${lines.join("\n")}`);
}
} finally {
  await closeBrowser(browser);
}
