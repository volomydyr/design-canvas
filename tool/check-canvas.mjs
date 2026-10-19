#!/usr/bin/env node
/**
 * design-canvas — the oracle.
 *
 *   node design-canvas/check-canvas.mjs --canvas <slug> [--only <ids>] [--live-all] [--url <address>]
 *                                    [--comment-on <screen id>] [--shell-selector "<css>"]
 *
 * The address, the saved session, the browser and the login route come from design-canvas/settings.json; `--url` and the other
 * flags override it for one run. The live Open pass visits only the frames captured since their last clean visit (`--only` names
 * some, `--live-all` visits every frame): see live-pass.mjs.
 *
 * The frames on the canvas are pictures now, so the proof splits in two and this script owns the second
 * half. `capture.mjs` proves things about the PAGES at the moment each shutter opened, and writes what it
 * proved into the manifest. This proves things about the CANVAS, in a real browser, from the DOM:
 *
 *   1. no app shell around it — the canvas is not a page of the prototype;
 *   2. every declared screen has a frame on the canvas AND a capture behind it;
 *   3. every capture proved its own claims, came out identical twice, and has no unloaded images in it,
 *      as recorded by the capture run. A manifest entry that says otherwise fails here;
 *   4. every frame's picture actually loads in the browser at the size it was captured at;
 *   5. every declared edge is drawn and starts and ends ON THE FRAMES IT NAMES — before and after a real
 *      drag and a real zoom, which is the whole claim of a canvas whose edges belong to it;
 *   6. panning and zooming work, driven as real input rather than by calling the canvas's own methods;
 *   7. an outline can be drawn on a frame, and the comment lands in a comments file with its region and an
 *      annotated PNG on disk, the size of the shot it was drawn on. THE FILE IS A THROWAWAY ONE, never the
 *      reviewer's: the browser's requests to the comments route are pointed at a reserved canvas key
 *      (`oracle-probe-<slug>`), so the round trip can never write, answer or delete anything of theirs;
 *   8. the by-kind grouping holds every frame and draws no edges.
 *
 * A failure here is a build error, not a note.
 *
 * THE LAST LINE OF THE OUTPUT IS THE VERDICT: `PASS`, or `FAIL (<count>): <kind> <n>, ...`. Everything above it
 * is evidence; the tail of a long run can cut the failure list off and leave green lines on screen, and once a
 * green claim was made from exactly that tail. Exit codes: 0 pass, 1 failures, 2 the run could not start (no
 * browser, no session, the login redirect on the first page).
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

/* Shared with capture.mjs so the two cannot disagree: crashes that never print the session, the login redirect,
   the overlays a project has declared. */
import {
  checkFetchedLogin,
  checkLoginRedirect,
  clickDismissals,
  closeBrowser,
  forbidRemedy,
  guardCrashes,
  launchBrowser,
  loadDismissals,
  openContext,
  requireStorageState,
  seedDismissals,
  setClosing,
} from "./browser-guards.mjs";
/* The project's own address, session, browser and login route, written once in design-canvas/settings.json. */
import { loadSettings, requireAppUrl, runSettings } from "./project-settings.mjs";
import { requireAppAnswers } from "./app-reachable.mjs";
/* A frame that left the declaration with comments still pinned to it, and the steps a screen presses before its picture:
   both are read by the capture too, through these two modules, so the tools cannot disagree about them. */
import { declaredFrames, planPins, refusalFailures, remedyLine } from "./comment-integrity.mjs";
import { undrainedIn } from "./reminders.mjs";
/* Which frames the live Open pass visits: the ones captured since their last clean visit, not every route of the app. */
import { chooseLive, describeLive, markProven, readUnproven } from "./live-pass.mjs";
/* What the page's data does on a frame (a held, failed or answered request, an aborted save): put on the oracle's Open pass exactly as
   the capture puts it on the frame, through the same module, so a loading frame's claims are re-proved on a page that is loading. */
import { applyNetwork, hasNetwork, mergeNetwork } from "./network.mjs";
/* The variants of one component must come out as different pictures (a route that ignores ?variant= passes every other check). */
import { lintAll, variantPictureProblems } from "./preflight-rules.mjs";
/* The stamp's hash of one file, as the capture writes it. */
import { fileStamp } from "./recapture.mjs";
import { runSteps, SURFACE_TEXT } from "./steps.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function argOf(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

/**
 * THE APP'S ADDRESS comes from `--url`, else from `design-canvas/settings.json` (`appUrl`), and there is NO default
 * port: `localhost:3000` was what this said, and on a machine with several apps running that is often another project's dev
 * server, which the oracle would then check for minutes without noticing. A run
 * on its own, with no flags, reads the file; the reviewer never supplies a port. A run that cannot find the address says where
 * to write it and ends on the verdict line, exit code 2.
 */
setClosing((reason, print = console.log) => print(`FAIL: ${reason}`));
const settings = loadSettings(HERE, "check-canvas");
/* The session, the browser and the login route are read as capture.mjs reads them, so one project setting serves both tools. */
const { appUrl, storageState, browserChannel, loginRoute } = runSettings(process.argv, settings);
const base = appUrl ?? requireAppUrl(settings, "check-canvas");

/**
 * WHICH CANVAS IS BEING PROVEN. A project can hold several, addressed as `/design-canvas/<slug>`, each with its
 * own declaration, its own pictures and its own review. `main` is the starter registry's slug, so a
 * single-canvas project passes nothing.
 */
const canvasSlug = argOf("canvas") ?? "main";
/* A slug is a URL segment and a file name at once, and this script deletes files named from it (the throwaway
   comments file below): so it is a whitelist, the same one the route and verdicts.mjs use. */
if (!/^[a-z0-9][a-z0-9-]*$/.test(canvasSlug)) {
  console.error(`check-canvas: refusing --canvas "${canvasSlug}": a canvas slug is lowercase letters, digits and dashes only`);
  console.log("FAIL: the run could not start");
  process.exit(2);
}
const canvasUrl = `${base}/design-canvas/${canvasSlug}`;
const shotsApi = `${base}/api/design-canvas/shots?canvas=${encodeURIComponent(canvasSlug)}`;
const commentsApi = `${base}/api/design-canvas/comments?canvas=${encodeURIComponent(canvasSlug)}`;

/**
 * THE ROUND TRIP NEVER TOUCHES THE REVIEWER'S FILE. It draws a real outline and saves, answers and deletes a real
 * comment, and it used to do that in the canvas's own comments file, where it could add test comments to the
 * reviewer's file and delete a real comment along with its own. So the browser's requests to
 * the comments route are pointed at a RESERVED CANVAS KEY instead, and that key's file is the oracle's alone: made
 * empty before the page loads, read back from disk after, removed at the end.
 */
const PROBE_KEY = `oracle-probe-${canvasSlug}`;
const probeApi = `${base}/api/design-canvas/comments?canvas=${encodeURIComponent(PROBE_KEY)}`;
const probeFile = path.join(HERE, "comments", `${PROBE_KEY}.json`);
const probeImages = path.join(HERE, "comments", PROBE_KEY);

/** This canvas's review file. This is the REVIEWER'S file: the round trip writes to the throwaway one above. */
function commentsFile() {
  return path.join(HERE, "comments", `${canvasSlug}.json`);
}

/**
 * HOW "NO APP SHELL AROUND IT" IS ASKED, in a project this script knows nothing about.
 *
 * The canvas renders as one `position: fixed; inset: 0` surface, so anything the app's own layout draws
 * is a sibling of it in the same document. Landmarks are the generic evidence of that: a header, a nav
 * or an aside outside the canvas surface means the canvas is a page of the app rather than its own
 * surface, which is the failure this whole tool was rebuilt to fix. A project whose shell is none of
 * those can name its own with `--shell-selector`.
 */
const SHELL_SELECTOR =
  argOf("shell-selector") ?? "header, nav, aside, [data-app-shell]";

/* The declaration comes from the running app, so this can never check a different set of screens, or arrows, than the
   canvas draws. */
async function declared() {
  const response = await fetch(`${shotsApi}&screens=1`);
  /* An app behind a login answers this with the sign-in page after a silent redirect. */
  checkFetchedLogin("check-canvas", `${shotsApi}&screens=1`, response, { storageState, appUrl: base, loginRoute });
  const served = await response.json();
  return {
    ...served,
    groups: served.groups ?? [],
    explorations: served.explorations ?? [],
    successors: served.successors ?? {},
    /* The canvas-wide network rules the route serves (`writes: "abort"` lives there): empty when the app has none, or when it
       predates the field. */
    network: served.network ?? [],
  };
}

const failures = [];
const notes = [];

/**
 * WHAT KIND EACH FAILURE IS, so the last line can count them. `stage` names the part of the run that is
 * executing (set at each section below), and a failure takes the stage it was pushed in; two kinds are known by
 * their own prefix instead, because they can surface anywhere.
 */
let stage = "declaration";
const failureKinds = [];
const pushFailure = failures.push.bind(failures);
failures.push = (...items) => {
  for (const item of items)
    failureKinds.push(/^copy: /.test(item) ? "copy" : /^page error: /.test(item) ? "page error" : stage);
  return pushFailure(...items);
};

/** The verdict, as the last line of the output. `reason` is for a run that ended without finishing. */
function finalLine(reason) {
  const counts = new Map();
  for (const kind of failureKinds) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  const by = [...counts].map(([kind, n]) => `${kind} ${n}`).join(", ");
  if (reason) return `FAIL: ${reason}${failures.length > 0 ? ` (${failures.length} failure(s) before it: ${by})` : ""}`;
  return failures.length === 0 ? "PASS" : `FAIL (${failures.length}): ${by}`;
}
/* Anything that still throws ends as one line and a FAIL, never as a call log: see browser-guards.mjs. */
guardCrashes({
  who: "check-canvas",
  storageState,
  tail: (reason, print = console.log) => print(finalLine(reason)),
});
/* A missing or unreadable session file stops the run with the one line that names the fix, before any browser
   starts: and before anything asks the served app for anything, because an app behind a login redirects that too. */
requireStorageState("check-canvas", storageState, base);
/* A dead address is one line, before any browser starts or anything is asked of the app. */
await requireAppAnswers("check-canvas", base);

/* Collected rather than reported one by one: a canvas captured before stamping existed would print the same
   note thirty times and bury everything else. */
const unstamped = [];
/** Frames whose picture is older than a file it is made of: one note for the canvas, never a failure. */
const outOfDate = [];

const served = await declared();
const { screens, kinds: declaredKinds, groups, forbid, explorations, successors, network: canvasNetwork } = served;
/* The arrows this canvas draws: both ends are frames on it (an arrow to a variants screen's own id draws nothing). */
const declaredIds = new Set(screens.map((screen) => screen.id));
const edges = groups.flatMap((group) => group.edges ?? []).filter((edge) => declaredIds.has(edge.from) && declaredIds.has(edge.to));

/**
 * EVERY RULE THE DECLARATION ALONE CAN BREAK, by the preflight's own rules (`lintAll` in preflight-rules.mjs): the copy, the
 * pictures and ids, `under`, sections, arrows and their labels, the switches to today's screen, explanation frames, declared
 * sections, actions and their origins, steps and network rules. A FAILURE, as in the preflight; the preflight only learns it sooner.
 */
{
  const lastManifest = path.join(HERE, "shots", canvasSlug, "manifest.json");
  const lastShots = existsSync(lastManifest) ? JSON.parse(readFileSync(lastManifest, "utf8")).shots ?? [] : [];
  const lint = lintAll(served, { shots: lastShots, evidenceDir: path.join(HERE, "evidence", canvasSlug), root: path.join(HERE, "..") });
  failures.push(...lint.steps.map((one) => `steps: ${one}`), ...lint.network.map((one) => `network: ${one}`), ...lint.declaration, ...lint.copy.map((one) => `copy: ${one}`));
}

/* The explanation frames (text panels that are never captured), and the ids whose `kind` was claimed as able to stand alone: built
   from the served declaration, because `group.screens` below is a list of ids and carries no fields of its own. */
const explainScreens = screens.filter((screen) => screen.explain);
const explainIds = new Set(explainScreens.map((screen) => screen.id));
const soloKindIds = new Set(
  screens.filter((screen) => screen.soloKind).map((screen) => screen.id),
);
/* A canvas that names its sections holds every screen to them (`lintAll`); one that names none is told the kinds in use, so the next
   agent can adopt one rather than invent a neighbor. */
const kindsInUse = [...new Set(screens.map((screen) => screen.kind).filter(Boolean))].sort();
if (Array.isArray(declaredKinds) && declaredKinds.length > 0) {
  const unused = declaredKinds.filter((one) => !kindsInUse.includes(one.id));
  if (unused.length > 0)
    notes.push(
      `declared section(s) with no screens in them: ${unused.map((one) => one.id).join(", ")}`,
    );
} else if (kindsInUse.length > 0) {
  notes.push(
    `this canvas does not declare its sections. The kinds in use are: ${kindsInUse.join(", ")}. ` +
      `Add \`kinds\` to the declaration, each with a line saying what belongs in it, and a screen filed ` +
      `outside them becomes a failure instead of a heading nobody notices.`,
  );
}

/**
 * HAS THIS CANVAS OUTGROWN ITSELF? — said out loud, with the split it thinks is there.
 *
 * A canvas grows one frame at a time and nobody notices the moment it stops being one thing: a big canvas that
 * mixes two features is hard to read, for its author and more so for everyone else, and the tool said nothing.
 *
 * TWO SIGNALS, AND BOTH HAVE TO AGREE, because either one alone cries wolf. Size on its own is not a problem — a
 * long single feature is allowed to be long. What makes a canvas two canvases is size PLUS a seam: two families of
 * route with no arrow crossing between them. The seam is computed from what the declaration already says, the
 * route of every screen and the ends of every edge, so it needs nothing new to be declared.
 *
 * A NOTE AND NEVER A FAILURE. A canvas
 * that is honestly one big feature is not broken, and a check that failed on it would teach everyone to raise the
 * threshold rather than to think about the split.
 */
const FRAME_LIMIT = 45;
const SECTION_LIMIT = 8;
if (screens.length > FRAME_LIMIT || kindsInUse.length > SECTION_LIMIT) {
  /* The first path segment of each screen's route, which is what a product's own navigation is built out of. */
  const familyOf = (url) => {
    try {
      return new URL(url, "http://x").pathname.split("/").filter(Boolean)[0] ?? "/";
    } catch {
      return "/";
    }
  };
  const families = new Map();
  for (const screen of screens) {
    const family = familyOf(screen.url);
    families.set(family, (families.get(family) ?? 0) + 1);
  }
  /* A family is joined to another when an edge has one end in each: those two cannot be separated. */
  const familyById = new Map(screens.map((screen) => [screen.id, familyOf(screen.url)]));
  const joined = new Set();
  for (const edge of edges) {
    const a = familyById.get(edge.from);
    const b = familyById.get(edge.to);
    if (a && b && a !== b) joined.add([a, b].sort().join(" + "));
  }
  const loose = [...families.entries()]
    .filter(([family]) => ![...joined].some((pair) => pair.split(" + ").includes(family)))
    .sort((one, two) => two[1] - one[1]);
  notes.push(
    `this canvas holds ${screens.length} frames in ${kindsInUse.length} section(s), which is where a canvas starts ` +
      `being hard to hold in one head.` +
      (loose.length > 1
        ? ` Route families that no arrow crosses: ${loose
            .map(([family, count]) => `/${family} (${count})`)
            .join(", ")}. A second canvas for one of them costs nothing but a slug — see SKILL.md on splitting.`
        : ` Every route family here is joined by an arrow, so there is no clean seam to split on.`),
  );
}

/**
 * A frame count is per VIEW, not per canvas. The two permanent views draw the flow screens; the exploration tab
 * draws the directions and nothing else. Counting every declared screen against one view was correct while
 * there were only two of them, and would now fail every canvas that has an open question on it.
 *
 * `view` is served by the shots route rather than guessed here. A declaration with no explorations produces an
 * empty list, no third tab, and every assertion below behaves exactly as it did before the tab existed.
 */
/**
 * THREE POPULATIONS, ONE PER VIEW, because a screen can belong to one permanent view and not the other.
 *
 * `flow` is drawn by both permanent views. `kinds` is drawn only by the grouped one — a `groupedOnly` flow, a set
 * of frames to compare rather than a journey. `exploration` is the third tab. Counting one number against every
 * view is how a canvas passes its checks while a whole section is missing from a view that should hold it.
 */
/**
 * THE COUNT ASSERTIONS ARE ONE DEVICE'S, because the canvas draws one device at a time.
 *
 * The device switch is a level above the three views (see `CanvasDevice`), so "every declared screen" stopped
 * being "every drawn frame" once a second device is declared. The checks below run against the
 * device the canvas is actually showing, which is the one the switch opens on — the first device the declaration
 * has. A canvas with one device is unaffected.
 *
 * The per-screen picture pass further down DOES walk every device, by driving the switch through the canvas's own
 * test hook. What stays scoped to the opening device is the group-count arithmetic below, which is about how a
 * declaration is grouped rather than about whether a picture arrived.
 */
const devicesDeclared = [
  ...new Set(screens.map((one) => one.device ?? "desktop")),
];
const CANVAS_DEVICE = devicesDeclared[0] ?? "desktop";
const onDevice = screens.filter(
  (screen) => (screen.device ?? "desktop") === CANVAS_DEVICE,
);
if (onDevice.length !== screens.length)
  console.log(
    `${screens.length} screens declared across devices; asserting the ${onDevice.length} on "${CANVAS_DEVICE}", which is what the canvas opens on`,
  );

/* "flowOnly" is drawn by the flows view too: it is a screen kept OUT of the grouped one, not out of
   the journey. Counting only "flow" here reported the flows view as over-full by exactly the number
   of edge cases in it. */
const flowScreens = onDevice.filter(
  (screen) => screen.view === "flow" || screen.view === "flowOnly",
);
const kindScreens = onDevice.filter(
  (screen) => screen.view === "flow" || screen.view === "kinds",
);
const exploreScreens = onDevice.filter(
  (screen) => screen.view === "exploration",
);
const views = exploreScreens.length > 0 ? ["flows", "kinds", "explore"] : ["flows", "kinds"];

/* ------------------------------------------------- what the capture run proved */
stage = "capture";

const manifestPath = path.join(HERE, "shots", canvasSlug, "manifest.json");
if (!existsSync(manifestPath)) {
  console.log("Nothing captured yet. Run: node design-canvas/capture.mjs");
  failures.push("nothing captured yet");
  console.log(finalLine());
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const shotOf = new Map(manifest.shots.map((shot) => [shot.screenId, shot]));

/**
 * THE DRAIN GATE: a comment whose screen you recaptured, that you never marked consumed, is a FAILURE.
 *
 * This exists because the mistake is easy to make and recurs in the same shape: work
 * the reviewer's comments, recapture the screens, hand it back — and never PATCH `{ consumed: true }`. Nothing
 * breaks loudly. The reviewer opens the canvas, sees every note still sitting there unanswered, and gets no review
 * bar at all, because the bar counts comments that are consumed AND stale. So the work looks undone, and the
 * mistake recurs unless it is checked.
 *
 * WHY `stale && !consumedAt` IS THE RIGHT SIGNAL, and why it cannot cry wolf:
 *   - `stale` is set BY THE CAPTURE, and only when the screen under a comment is photographed again. So it means
 *     "the thing this note is about has changed since the note was written".
 *   - `consumedAt` is set by the agent, and means "I have read this and acted".
 *   - A comment that is stale and not consumed is therefore a note whose screen you rebuilt while leaving the note
 *     marked unread. There is no innocent version of that pair. A note you have not acted on yet is not stale,
 *     because you have not recaptured its screen.
 *
 * It is a failure rather than a note on purpose. A note is what the last three runs printed and nobody read.
 */
const comments = await fetch(commentsApi)
  .then((response) => (response.ok ? response.json() : { comments: [] }))
  .catch(() => ({ comments: [] }));
/* Verdicts are left out (`undrainedIn`): draining one deletes the reviewer's like or dislike. */
const undrained = undrainedIn(comments.comments);
if (undrained.length > 0)
  failures.push(
    `${undrained.length} comment(s) sit on a screen you recaptured and were never marked consumed ` +
      `(${undrained.join(", ")}). ` +
      `The reviewer sees them as unanswered and gets no review bar. ` +
      `Mark the ones you acted on: node design-canvas/drain.mjs --canvas ${canvasSlug} --ids ${undrained.join(",")}`,
  );

/**
 * AND WHAT IS STILL OUTSTANDING, EVERY RUN, WITH ITS IDS — because the gate above cannot see the worst case.
 *
 * `stale && !consumedAt` only catches a comment whose screen was recaptured, which means it only catches notes the
 * agent already touched. A note it never opened is not stale, so it passes this oracle in silence. That is how a run
 * ends clean with real feedback untouched: some notes worked, some never read, and every check passed, so the
 * hand-off missed comments.
 *
 * So the run always states the whole set. A NOTE and not a failure, because unconsumed comments are the normal state
 * of a canvas the moment after a review: the reviewer writes them, and the capture that follows is often the one that
 * photographs the screens they were written on. What matters is that the number is said out loud, next to the ids, so
 * it can be compared with what was worked.
 *
 * THE SPENT ONES ARE EXCLUDED, by the same rule the canvas uses (`canvas-view.tsx`): a like or a dislike on a screen
 * this declaration no longer names was already acted on, and acting on it is why the screen is gone. They stay in the
 * file so the reviewer can read back what they judged, and they are not work. Notes are never excluded, homeless or
 * not: a note whose frame was deleted is still feedback and still travels.
 */
/**
 * NO COMMENT IS LEFT PINNED TO A FRAME THAT IS NOT DRAWN. A frame that left the declaration with live notes on it and no
 * `successors` entry hides its comments from the reviewer: the canvas draws no pin without a picture, so they cannot be
 * seen, answered or approved. The capture refuses to run in this state and moves the
 * comments when a successor is named; this is the net under the run where the declaration changed and nobody captured.
 * The same planner, the same sentences: see `comment-integrity.mjs`.
 */
{
  const plan = planPins({ comments: comments.comments ?? [], declared: declaredFrames(screens), successors });
  const said = refusalFailures(plan);
  if (said.length > 0) {
    failures.push(...said.map((line, at) => (at === 0 && remedyLine(plan, { nothingMoved: false }) ? `${line}\n  ${remedyLine(plan, { nothingMoved: false })}` : line)));
  }
  if (plan.moves.length > 0)
    failures.push(
      `${plan.moves.length} comment(s) still sit on frames that are gone and have a successor named (${plan.moves.map((move) => `${move.id} ${move.from} → ${move.to}`).join(", ")}): run the capture, which moves them`,
    );
}

const outstanding = (comments.comments ?? []).filter(
  (comment) =>
    !comment.consumedAt &&
    !(comment.kind && comment.kind !== "note" && !declaredIds.has(comment.screenId)),
);
if (outstanding.length > 0)
  notes.push(
    `${outstanding.length} comment(s) are still unconsumed (${outstanding
      .map((one) => one.id)
      .join(", ")}). ` +
      `That is the whole set the canvas hands off. If you worked fewer than this, you missed some.`,
  );

for (const screen of screens) {
  /* Nothing was captured on purpose: an explanation frame is drawn by the canvas, not photographed. */
  if (screen.explain) {
    /* And nothing can be measured on it either: an origin needs a live page to resolve against. */
    if ((screen.origins ?? []).length > 0)
      failures.push(
        `${screen.id}: an explanation frame cannot own an interaction origin — there is no page to measure "${screen.origins[0].origin}" on`,
      );
    continue;
  }
  const shot = shotOf.get(screen.id);
  if (!shot) {
    failures.push(`${screen.id}: declared and never captured`);
    continue;
  }
  /**
   * EVERY DECLARED INTERACTION ORIGIN WAS MEASURED, and nothing measured is still declared. The capture
   * resolves each `CanvasEdge.origin` into a rectangle or fails; this is the net under the run where the
   * declaration changed and nobody recaptured — a ring drawn from a stale rectangle circles the wrong
   * control while every claim still passes.
   */
  for (const wanted of screen.origins ?? []) {
    const measured = (shot.origins ?? []).find(
      (one) => one.to === wanted.to && one.origin === wanted.origin,
    );
    if (!measured)
      failures.push(
        `${screen.id}: the edge to ${wanted.to} declares origin "${wanted.origin}" and the capture never measured it — recapture this screen`,
      );
    else if (
      ![measured.x, measured.y, measured.w, measured.h].every(Number.isFinite) ||
      measured.w < 3 ||
      measured.h < 3
    )
      failures.push(
        `${screen.id}: the measured origin "${wanted.origin}" is not a usable rectangle (${measured.x},${measured.y} ${measured.w}x${measured.h})`,
      );
  }
  for (const measured of shot.origins ?? []) {
    if (
      !(screen.origins ?? []).some(
        (one) => one.to === measured.to && one.origin === measured.origin,
      )
    )
      failures.push(
        `${screen.id}: the manifest holds an origin for the edge to ${measured.to} ("${measured.origin}") that the declaration no longer declares — recapture this screen`,
      );
  }
  if (shot.url !== screen.url)
    failures.push(
      `${screen.id}: captured ${shot.url}, the declaration now says ${screen.url}`,
    );
  const missed = (shot.claims ?? []).filter((claim) => !claim.met);
  for (const claim of missed)
    failures.push(
      `${screen.id}: the captured page does not contain "${claim.claim}"`,
    );
  if ((shot.claims ?? []).length === 0)
    notes.push(`${screen.id}: nothing asserted about this screen`);
  if (!shot.stable && !screen.animated)
    failures.push(
      `${screen.id}: two captures came out different, so the page was still moving`,
    );
  if (shot.images && shot.images.empty > 0 && !screen.brokenImages)
    failures.push(
      `${screen.id}: ${shot.images.empty} image(s) on screen never loaded, so the picture has holes in it`,
    );
  else if (
    screen.brokenImages &&
    shot.images &&
    shot.images.shown > 0 &&
    shot.images.empty === 0
  )
    failures.push(
      `${screen.id}: declared broken images and every image loaded — the bug healed, update the declaration`,
    );
  if (!existsSync(path.join(HERE, "shots", canvasSlug, shot.file)))
    failures.push(
      `${screen.id}: the manifest names ${shot.file} and there is no such file`,
    );
  /* A `source` path that does not exist is a declaration rule (`lintAll`, above), shared with the preflight. */
  /* A wireframe has no component behind it by definition; the note would nag about the thing it is for. */
  if ((screen.source ?? []).length === 0 && !screen.wireframe)
    notes.push(`${screen.id}: no source file declared`);

  /**
   * IS THE PICTURE OLDER THAN WHAT IT IS A PICTURE OF? `capture.mjs` stamps every shot with a content hash of
   * the files its screen declares; this re-hashes them and says so when they differ. It is the safety net
   * under the capture's own selection of changed frames: this catches the edit made after the last capture.
   * A note rather than a failure, because a changed file does not always change a picture — but an
   * unexplained one here is how a canvas quietly stops being true.
   */
  const stamped = shot.stamp?.sources ?? null;
  if (stamped) {
    const moved = [];
    for (const [file, was] of Object.entries(stamped)) {
      /* A wireframe's stamp is the served HTML's hash under a `wireframe:` key, not a path in this tree. The
         capture re-reads it every run; there is nothing on disk here to compare it with. */
      if (file.startsWith("wireframe:")) continue;
      if (fileStamp(path.join(HERE, ".."), file) !== was) moved.push(file);
    }
    if (moved.length > 0 && !screen.frozen) outOfDate.push(`${screen.id} (${moved.join(", ")})`);
  } else if ((screen.source ?? []).length > 0) {
    unstamped.push(screen.id);
  }
}
/* Out of date is a state, not a fault: pictures refresh at the moments a recapture runs, so the oracle counts them in one note. */
if (outOfDate.length > 0)
  notes.push(
    `${outOfDate.length} frame(s) out of date on ${canvasSlug}, captured before files they are made of changed: ${outOfDate.slice(0, 6).join(", ")}${outOfDate.length > 6 ? ` and ${outOfDate.length - 6} more` : ""}; ` +
      `they refresh when the canvas is opened, or now with node design-canvas/recapture.mjs --canvas ${canvasSlug}`,
  );
if (unstamped.length > 0)
  notes.push(
    `${unstamped.length} shot(s) have no stamp, so nothing can tell whether they are out of date: ` +
      `${unstamped.join(", ")} — one full capture fixes it`,
  );
failures.push(...variantPictureProblems(screens, manifest.shots));
const orphans = manifest.shots.filter(
  (shot) => !screens.some((one) => one.id === shot.screenId),
);
for (const shot of orphans)
  notes.push(`${shot.screenId}: captured and no longer declared`);
console.log(
  `${screens.length} screens declared, ${manifest.shots.length} captured, ${edges.length} edges declared\n`,
);

/* ----------------------------------------------------------------- the canvas */
stage = "canvas";

/**
 * AN APP BEHIND A LOGIN GUARDS ITS CANVAS TOO. This browser opens the canvas page itself, and on an
 * authenticated app that page 307s to the sign-in screen and `__devCanvas` never appears — the oracle
 * times out before asserting anything. Same remedy as the capture: `--storage-state <path>` or
 * `CANVAS_STORAGE_STATE`, the saved session made once. `--browser-channel` /
 * `CANVAS_BROWSER_CHANNEL` rides along for apps whose pages need the real Chrome. Both absent means
 * exactly the old behavior.
 */
/* A launch or context failure is ONE LINE: the first line of the error, scrubbed of anything from the session.
   Playwright's own message carries the options the context was given, and the saved storage state (live login
   tokens) is one of them. */
const browser = await launchBrowser(chromium, {
  who: "check-canvas",
  channel: browserChannel,
  storageState,
});
/* THE BROWSER IS CLOSED HOWEVER THE RUN ENDS. This `try` runs to the end of the file, and its `finally` closes the browser
   and kills what is left of its process group (`browser-lifecycle.mjs`); an exit, a signal and a SIGKILL of this process are
   caught by the lifecycle's own hooks and watchdog. It is deliberately not indented: re-indenting the oracle below would bury
   the diff of this change in two thousand lines of whitespace. */
try {
const checkContext = await openContext(
  browser,
  {
    viewport: { width: 1600, height: 1000 },
    /* A service worker answers from the worker and never reaches the route a frame's network rules are on: blocked, as in the
       capture, when any frame (or the canvas) declares rules. */
    ...(hasNetwork(canvasNetwork, undefined) || screens.some((one) => hasNetwork(undefined, one.network)) ? { serviceWorkers: "block" } : {}),
  },
  { who: "check-canvas", storageState },
);

/**
 * THE OVERLAYS THIS PROJECT HAS DECLARED (`design-canvas/dismiss.json`), for the oracle's own browser too: its
 * Open-destination pass loads the same pages the capture does, so it meets the same first-run and promo dialogs
 * and would fail on them for the same reason. Same file, same steps, read by the same code.
 */
const dismissals = loadDismissals(HERE, canvasSlug, "check-canvas");
await seedDismissals(checkContext, dismissals.seeds);
const dismissed = new Map();
const dismissNow = async (pageToClear) => {
  if (dismissals.clicks.length === 0) return;
  for (const name of await clickDismissals(pageToClear, dismissals.clicks))
    dismissed.set(name, (dismissed.get(name) ?? 0) + 1);
};
/** Screens whose Open destination showed text the canvas forbids: the remedy is printed once for them. */
const forbidHits = new Set();

/**
 * EVERY REQUEST THE CANVAS MAKES TO THE COMMENTS ROUTE GOES TO THE THROWAWAY KEY, from the first page load on: the
 * pins it draws, the new-screen marks it saves, and the comment the round trip writes. The reviewer's pins are not
 * on this page at all, so nothing in this run can press Approve on one of them, which deletes.
 */
await checkContext.route(/\/api\/design-canvas\/comments(?:\?|$)/, async (route) => {
  const url = new URL(route.request().url());
  url.searchParams.set("canvas", PROBE_KEY);
  await route.continue({ url: url.toString() });
});
/** Start the throwaway file from nothing, before the page loads: a run that was killed mid-way leaves its comment
    behind, and a pin from it swallows the next run's drag. It is ours by name, so it is cleared by name. */
const clearProbe = () => {
  for (const file of [probeFile, ...[1, 2, 3, 4, 5].map((n) => `${probeFile}.${n}`)]) rmSync(file, { force: true });
  rmSync(probeImages, { recursive: true, force: true });
};
clearProbe();
mkdirSync(path.dirname(probeFile), { recursive: true });
/* Present on disk, so the route answers from THIS file and never falls back to a flat legacy one. */
writeFileSync(probeFile, '{\n  "comments": []\n}\n');
/** The reviewer's own file, as it is now: the round trip must leave it as it found it. */
const reviewerBefore = existsSync(commentsFile())
  ? createHash("sha256").update(readFileSync(commentsFile())).digest("hex")
  : null;
const page = await checkContext.newPage();
page.on("pageerror", (error) => failures.push(`page error: ${error.message}`));

/**
 * ONE RELOAD BEFORE GIVING UP. Against a dev server the first hit of the canvas route compiles it, and
 * on a loaded machine that compile alone can outrun the 30-second wait — a whole oracle run then dies on
 * a page that would have been fine two seconds later. A reload after a failed wait gets the already
 * compiled page; a second failure is a real one and propagates.
 */
await page.goto(canvasUrl, { waitUntil: "domcontentloaded" });
/* AN APP BEHIND A LOGIN redirects the canvas page itself, and `__devCanvas` then never appears: this used to wait
   out 30 seconds, reload, and wait 120 more. One look at where the page landed, and one line naming the fix. */
await checkLoginRedirect(page, canvasUrl, { who: "check-canvas", storageState, appUrl: base, loginRoute });
try {
  await page.waitForFunction(() => Boolean(window.__devCanvas), null, {
    timeout: 30_000,
  });
} catch {
  /* A guard that redirects late (after its own request) lands here instead of above. */
  await checkLoginRedirect(page, canvasUrl, { who: "check-canvas", storageState, appUrl: base, loginRoute, graceMs: 0 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__devCanvas), null, {
    timeout: 120_000,
  });
}

/**
 * ASK FOR THE VIEW BEFORE COUNTING ITS FRAMES — and WAIT FOR IT TO ACTUALLY RENDER. This script's own
 * trap #8 in reverse, twice over: the canvas no longer opens on a fixed view, and on a loaded machine a
 * fixed sleep after `setView` still counted the PREVIOUS view once (64 grouped frames reported as the
 * flows view). `__devCanvas.view()` reports the rendered view, so the switch is awaited, never slept on.
 */
const switchView = async (mode) => {
  await page.evaluate((next) => window.__devCanvas.setView(next), mode);
  await page.waitForFunction(
    (next) => window.__devCanvas?.view?.() === next,
    mode,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(200);
};
await switchView("kinds");

const chrome = await page.evaluate((shellSelector) => {
  const surface = document.querySelector("[data-canvas-surface]");
  /* Only what is OUTSIDE the canvas counts: the canvas has landmarks of its own inside it. */
  const shell = [...document.querySelectorAll(shellSelector)].filter(
    (node) => !surface || !surface.contains(node),
  );
  return {
    shell: shell.map((node) => node.tagName.toLowerCase()),
    surface: Boolean(surface),
    frames: document.querySelectorAll("[data-canvas-screen]").length,
  };
}, SHELL_SELECTOR);
if (!chrome.surface) failures.push("the canvas surface did not render");
if (chrome.shell.length > 0)
  failures.push(
    `the app shell is around the canvas: ${chrome.shell.join(", ")} outside its own surface`,
  );
else console.log("no app shell around it: the canvas is its own surface");
/* The canvas opens on GROUPED screens, so the count to meet here is the grouped population. Exploration
   directions live in the third tab and are counted there, below. */
if (chrome.frames !== kindScreens.length)
  failures.push(
    `${chrome.frames} frames on the canvas, ${kindScreens.length} declared for this view`,
  );

/**
 * WARM THE PICTURE ROUTE BEFORE TIMING ANYTHING AGAINST IT.
 *
 * The image wait below allows ten seconds, which is generous for reading a file off disk and not always enough
 * for `next dev` to COMPILE the route that serves it — the request that pays for the compile is the first one,
 * so exactly one screen fails, the same one, and it passes on a re-run. That is a flaky assertion, which is
 * nearly as bad as an assertion that cannot fail: it teaches whoever runs this to try again rather than to look.
 * One throwaway request first, awaited, and the cost lands here instead of on a screen.
 */
await page
  .evaluate(async (url) => {
    await fetch(url, { cache: "no-store" }).catch(() => undefined);
  }, `${shotsApi}&id=${encodeURIComponent(screens[0]?.id ?? "")}`)
  .catch(() => undefined);

/**
 * Every picture loads, at the size it was captured at. The manifest can only say what happened at capture
 * time; this is the browser saying the file is really there and really an image.
 */
/* Each frame checked while the view that draws it is the one on screen: an exploration direction has no frame in
   the grouped view, so a single pass over every declared screen would report half of them missing. */
let inView = null;
/**
 * EVERY DEVICE, NOT JUST THE ONE THE CANVAS OPENS ON.
 *
 * This pass used to run over one device's screens and say so, which left a whole device unasserted: its frames
 * could be missing from the canvas, or drawing a picture of the wrong size, and nothing here would know.
 *
 * So the loop is device-major: switch the canvas to a device through its own test hook, then check that device's
 * screens in whichever view draws them. The switch is the same mechanism the view switch below uses, and it needs
 * the same settling pause for the same reason — the layout is rebuilt from scratch and a frame checked in the same
 * tick is checked against the previous device's positions.
 */
let onCanvasDevice = null;
for (const screen of screens) {
  const wantsDevice = screen.device ?? "desktop";
  if (wantsDevice !== onCanvasDevice) {
    await page.evaluate(
      (next) => window.__devCanvas.setDevice?.(next),
      wantsDevice,
    );
    await page.waitForTimeout(500);
    onCanvasDevice = wantsDevice;
    /* A device switch re-fits the canvas, so whatever view was showing is showing a new world: force the next
       comparison to re-assert it rather than trusting the last one. */
    inView = null;
  }
  /**
   * AN EXPLANATION FRAME HAS NO PICTURE TO ASSERT — its check is that the PANEL is on the flows view,
   * drawn by the canvas itself, exactly once. `data-canvas-explain` is its mark; asking for an `img`
   * inside it would fail a node that is correct by design.
   */
  if (screen.explain) {
    if (inView !== "flows") {
      await switchView("flows");
      inView = "flows";
    }
    await page.evaluate((id) => window.__devCanvas.goTo(id), screen.id);
    const panels = await page
      .locator(`[data-canvas-explain="${screen.id}"]`)
      .count()
      .catch(() => 0);
    if (panels !== 1)
      failures.push(
        `${screen.id}: its explanation panel appears ${panels} time(s) on the flows view, not once`,
      );
    /* THREE KINDS, THREE CHROMES — the rendered kind must match the declared one, or a boundary node
       quietly reads as a third party's page (the confusion the split exists to prevent). The declared
       value "canvas:<slug>" renders as the attribute "canvas". */
    if (panels === 1) {
      const declaredKind = (screen.explainKind ?? "outside").startsWith("canvas:")
        ? "canvas"
        : (screen.explainKind ?? "outside");
      const renderedKind = await page
        .locator(`[data-canvas-explain="${screen.id}"]`)
        .getAttribute("data-canvas-explain-kind")
        .catch(() => null);
      if ((renderedKind ?? "outside") !== declaredKind)
        failures.push(
          `${screen.id}: declared explainKind "${screen.explainKind ?? "outside"}" but the panel renders as "${renderedKind ?? "outside"}"`,
        );
    }
    continue;
  }
  /* A flowOnly screen is not drawn in the grouped view at all, so asking for its picture there found
     an empty frame every time. It lives in the flows, which is the whole point of the flag. */
  const wants =
    screen.view === "exploration"
      ? "explore"
      : screen.view === "flowOnly"
        ? "flows"
        : "kinds";
  /**
   * SWITCHING THE VIEW IS NOT INSTANT, and jumping in the same tick lands on the OLD layout.
   *
   * `goTo` centres a node using the layout React has rendered. Called immediately after `setView`, it runs
   * against the previous view's positions, the frame ends up off screen, `content-visibility` skips rendering it,
   * and its lazy picture never loads — so the assertion below failed on exactly one screen, the first one after
   * each view change, every run. It read as a broken image and was a race in this script.
   */
  if (wants !== inView) {
    await switchView(wants);
    inView = wants;
  }
  await page.evaluate((id) => window.__devCanvas.goTo(id), screen.id);
  /* WAITED FOR, NOT SLEPT THROUGH. A frame's picture is lazy and its container skips rendering while it is off
     screen, so it only starts loading once the canvas has arrived at it. A fixed pause passed on a quiet
     machine and failed thirteen frames on a busy one, which is a flaky assertion rather than a finding. */
  const image = await page
    /* The frame's OWN picture: a frame can also carry evidence screenshots beside it, and a bare `img` would match
       those too and fail the strict locator. */
    .locator(`[data-canvas-screen="${screen.id}"] img[data-canvas-shot]`)
    .evaluate(async (node) => {
      for (let i = 0; i < 100; i += 1) {
        /* Zoomed out, a frame draws the small copy (`size=small`); the jump to the screen brings the full one back. */
        if (node.complete && node.naturalWidth > 0 && !node.src.endsWith("&size=small")) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return {
        complete: node.complete,
        w: node.naturalWidth,
        h: node.naturalHeight,
        src: node.getAttribute("src"),
      };
    })
    .catch(() => null);
  if (!image) {
    failures.push(`${screen.id}: no picture in its frame on the canvas`);
    continue;
  }
  const shot = shotOf.get(screen.id);
  if (!image.complete || image.w === 0)
    failures.push(
      `${screen.id}: its picture did not load in the canvas (${image.src})`,
    );
  else if (shot && (image.w !== shot.w || image.h !== shot.h))
    failures.push(
      `${screen.id}: the picture is ${image.w}x${image.h}, the manifest says ${shot.w}x${shot.h}`,
    );
  /**
   * A SCREEN THAT ASKS FOR ITS OWN VIEWPORT MUST HAVE BEEN PHOTOGRAPHED AT IT.
   *
   * `CanvasScreen.viewport` was documented, declared, and silently ignored end to end: the capture never applied it
   * and the screens endpoint dropped the field before the capture could read it. Two frames asked to be 1240 and
   * 1340 tall and both came back 900, which no assertion here would have caught. The width is the honest thing to
   * check — the height of a shot is decided by the page, which may legitimately be longer than one viewport, but
   * the width is exactly what was asked for or the run did not honour the request.
   */
  else if (shot && screen.viewport?.w && shot.w !== screen.viewport.w)
    failures.push(
      `${screen.id}: asked for a ${screen.viewport.w}px viewport and its picture is ${shot.w}px wide`,
    );
  /**
   * ONE DEFINED SIZE PER DEVICE, AND HEIGHT IS THE PAGE'S TO DECIDE.
   *
   * The rule, already half-enforced: every desktop screen has one defined size, 1440x900, unless the page has
   * more content under the scroll, in which case the whole page is photographed.
   *
   * The capture has always done that part: a page inside `LONG_PAGE_SLACK` of the viewport is photographed at
   * exactly one viewport, and one that genuinely runs past the fold is photographed whole. What defeated it
   * was a per-screen viewport that kept the canvas's WIDTH and only raised its HEIGHT — which is not a device,
   * it is padding, and it made every frame in a group 200px taller than any real window. It went unnoticed for
   * two rounds of review because the check above deliberately ignores height, and was found only by eye.
   *
   * So: a screen may name a different DEVICE, which means a different width — a phone among desktop frames is
   * exactly what that is for. Keeping the width and stretching the height is refused, and the failure says
   * what the page actually measured, because the fix is usually to delete the override.
   */
  else if (
    shot &&
    screen.viewport?.h &&
    screen.viewport.w === manifest.viewport.w &&
    screen.viewport.h !== manifest.viewport.h
  )
    failures.push(
      `${screen.id}: its own viewport is ${screen.viewport.w}x${screen.viewport.h}, the same width as the ` +
        `canvas at a different height, which pads the frame rather than naming a device. Its picture came ` +
        `out ${shot.w}x${shot.h}${shot.wholePage ? " (a whole-page shot)" : " (one viewport)"}. Delete the ` +
        `override and let the page decide: a page that runs past the fold is captured whole on its own.`,
    );
}
console.log(
  `${screens.length} pictures load on the canvas at their captured size, across ${devicesDeclared.length} device(s)`,
);

/* ----------------------------------------------------------------- the edges */
stage = "edges";

/* The edges only exist in the flows view, and the canvas no longer opens on it — grouped screens is the default.
   Asked for explicitly rather than assumed, or every assertion below would quietly pass against a view that
   draws no edges at all. */
await switchView("flows");

/**
 * An edge belongs to the canvas, not to a picture of it: it must start on the frame it comes from and end on
 * the frame it goes to, and it must still do that after the canvas has been dragged and zoomed. Measured in
 * SCREEN coordinates through the path's own transform matrix, so it is a claim about what is on screen.
 */
const attachment = () =>
  page.evaluate(() => {
    const near = (point, rect) =>
      point.x >= rect.left - 3 &&
      point.x <= rect.right + 3 &&
      point.y >= rect.top - 3 &&
      point.y <= rect.bottom + 3;
    /* An edge end can be a captured frame OR an explanation panel — both are real nodes on the path,
       and each carries its id under its own mark. Looking up only data-canvas-screen would read every edge
       through an explain node as detached. */
    const frameOf = (id) =>
      document.querySelector(`[data-canvas-screen="${id}"]`) ??
      document.querySelector(`[data-canvas-explain="${id}"]`);
    return [...document.querySelectorAll("path[data-canvas-edge]")].map(
      (path) => {
        const pair = path.getAttribute("data-canvas-edge");
        const [from, to] = pair.split("->");
        const a = frameOf(from);
        const b = frameOf(to);
        if (!a || !b)
          return { pair, attached: false, why: "an end of it names no frame" };
        const matrix = path.getScreenCTM();
        const project = (point) => ({
          x: point.x * matrix.a + point.y * matrix.c + matrix.e,
          y: point.x * matrix.b + point.y * matrix.d + matrix.f,
        });
        const start = project(path.getPointAtLength(0));
        const end = project(path.getPointAtLength(path.getTotalLength()));
        const onFrom = near(start, a.getBoundingClientRect());
        const onTo = near(end, b.getBoundingClientRect());
        return {
          pair,
          attached: onFrom && onTo,
          why: onFrom
            ? "its end is off its frame"
            : "its start is off its frame",
        };
      },
    );
  });

/**
 * NO EDGE CROSSES A FRAME IT DOES NOT BELONG TO. Sampled along every path in screen coordinates rather than
 * reasoned about: forty points per edge, and any one of them landing inside a frame that is neither of its two
 * ends is a failure. This is the general rule, so a declaration that adds an edge spanning two columns cannot
 * quietly draw a line across the screens in between.
 */
const crossings = () =>
  page.evaluate(() => {
    /* Explanation panels are frames for this rule too: an edge slicing through one is exactly as
       misleading as one slicing through a picture. */
    const frames = [
      ...document.querySelectorAll("[data-canvas-screen]"),
      ...document.querySelectorAll("[data-canvas-explain]"),
    ].map((node) => ({
      id:
        node.getAttribute("data-canvas-screen") ??
        node.getAttribute("data-canvas-explain"),
      box: node.getBoundingClientRect(),
    }));
    const bad = [];
    for (const path of [
      ...document.querySelectorAll("path[data-canvas-edge]"),
    ]) {
      const pair = path.getAttribute("data-canvas-edge");
      const [from, to] = pair.split("->");
      const matrix = path.getScreenCTM();
      const total = path.getTotalLength();
      const hit = new Set();
      for (let i = 1; i < 40; i += 1) {
        const point = path.getPointAtLength((total * i) / 40);
        const x = point.x * matrix.a + point.y * matrix.c + matrix.e;
        const y = point.x * matrix.b + point.y * matrix.d + matrix.f;
        for (const frame of frames) {
          if (frame.id === from || frame.id === to) continue;
          const inside =
            x > frame.box.left + 2 &&
            x < frame.box.right - 2 &&
            y > frame.box.top + 2 &&
            y < frame.box.bottom - 2;
          if (inside) hit.add(frame.id);
        }
      }
      if (hit.size > 0) bad.push({ pair, over: [...hit] });
    }
    return bad;
  });

const drawn = await attachment();
if (drawn.length !== edges.length)
  failures.push(`${edges.length} edges declared, ${drawn.length} drawn`);
for (const edge of drawn.filter((one) => !one.attached))
  failures.push(`edge ${edge.pair}: ${edge.why}`);
console.log(
  `${drawn.length} edges drawn, ${drawn.filter((one) => one.attached).length} attached`,
);

const crossed = await crossings();
for (const edge of crossed)
  failures.push(`edge ${edge.pair} is drawn across ${edge.over.join(", ")}`);
if (crossed.length === 0)
  console.log(`no edge crosses a frame it does not belong to`);

/**
 * THE INTERACTION-ORIGIN MODE, EXERCISED LIKE A REVIEWER WOULD. When any measured origin exists the
 * toggle has to exist, the rings have to be ABSENT while it rests off, and one press has to draw exactly
 * one numbered ring per measured origin with its edge re-anchored. Checked from the DOM rather than
 * trusted, because a ring that silently fails to draw turns the mode into a control that lies.
 */
const declaredOrigins = screens.flatMap((screen) =>
  (screen.origins ?? []).map((one) => ({ from: screen.id, ...one })),
);
const measuredOrigins = declaredOrigins.filter((one) => {
  const shot = shotOf.get(one.from);
  return (shot?.origins ?? []).some(
    (measured) => measured.to === one.to && measured.origin === one.origin,
  );
});
if (measuredOrigins.length > 0) {
  const toggles = await page.locator("[data-canvas-origins-toggle]").count();
  if (toggles !== 1) {
    failures.push(
      `the canvas holds ${measuredOrigins.length} measured origin(s) and ${toggles} origin toggle(s) — the mode is unreachable`,
    );
  } else {
    const before = await page.locator("[data-canvas-origin]").count();
    if (before > 0)
      failures.push(
        `${before} origin ring(s) are drawn while the mode is off — it must rest off`,
      );
    await page.locator("[data-canvas-origins-toggle]").click();
    await page.waitForTimeout(200);
    const rings = await page.evaluate(() =>
      [...document.querySelectorAll("[data-canvas-origin]")].map((el) => ({
        pair: el.getAttribute("data-canvas-origin"),
        spec: el.getAttribute("data-canvas-origin-spec"),
      })),
    );
    for (const wanted of measuredOrigins) {
      const drawn = rings.filter(
        (ring) =>
          ring.pair === `${wanted.from}->${wanted.to}` &&
          ring.spec === wanted.origin,
      );
      if (drawn.length !== 1)
        failures.push(
          `origin "${wanted.origin}" on ${wanted.from} → ${wanted.to}: drawn ${drawn.length} time(s) with the mode on, not once`,
        );
    }
    if (rings.length !== measuredOrigins.length)
      failures.push(
        `${rings.length} origin ring(s) drawn with the mode on, ${measuredOrigins.length} measured in the manifest`,
      );
    const anchored = await page
      .locator("path[data-canvas-edge-anchored]")
      .count();
    if (anchored !== measuredOrigins.length)
      failures.push(
        `${anchored} edge(s) re-anchored to their origin ring, ${measuredOrigins.length} expected`,
      );
    /* Back off, so the pan and zoom below run the canvas in its resting state. */
    await page.locator("[data-canvas-origins-toggle]").click();
    await page.waitForTimeout(200);
    if (failures.length === 0)
      console.log(
        `interaction origins: ${measuredOrigins.length} highlight(s) drawn with the mode on, none at rest`,
      );
  }
}

/* Pan and zoom as REAL INPUT. Calling the canvas's own methods would prove the methods, not the gestures:
   the drag goes through the pointer handlers and the zoom through the wheel handler with the modifier set,
   which is the same event a trackpad pinch delivers. */
/* From a point that is not one of the canvas's own controls. Dragging from the open button or a badge
   deliberately does NOT pan — that is the whole reason they are marked as chrome — so a fixed coordinate made
   this assertion fail on a canvas that was working. */
const grabAt = await page.evaluate(() => {
  /* Scanned from the middle outwards, so there is always room to drag in and the pointer never ends up off
     the viewport — where a wheel event lands nowhere and the zoom assertion fails for no reason. */
  for (let y = window.innerHeight - 200; y > 200; y -= 40) {
    for (let x = 500; x < window.innerWidth - 200; x += 40) {
      const el = document.elementFromPoint(x, y);
      if (el && !el.closest("[data-canvas-chrome]")) return { x, y };
    }
  }
  return { x: 800, y: 500 };
});
/**
 * MEASURED FROM A STILL CANVAS. Every jump to a frame is animated, so reading the transform straight after one
 * catches it mid-flight and the drag's own delta then lands on top of a moving number — which reported "dragging
 * did not pan" on a canvas where dragging worked perfectly in isolation. Two identical reads means it has
 * arrived, the same trick `capture.mjs` uses on the pages themselves.
 */
const whenStill = async () => {
  let last = null;
  for (let i = 0; i < 60; i += 1) {
    const now = await page.evaluate(() => window.__devCanvas.read());
    if (
      last &&
      Math.abs(now.x - last.x) < 0.5 &&
      Math.abs(now.y - last.y) < 0.5 &&
      now.z === last.z
    ) {
      return now;
    }
    last = now;
    await page.waitForTimeout(100);
  }
  return last;
};

const before = await whenStill();
await page.mouse.move(grabAt.x, grabAt.y);
await page.mouse.down();
await page.mouse.move(grabAt.x - 300, grabAt.y - 220, { steps: 12 });
await page.mouse.up();
const afterDrag = await whenStill();
if (
  Math.abs(afterDrag.x - before.x) < 100 ||
  Math.abs(afterDrag.y - before.y) < 100
)
  failures.push(
    `dragging did not pan the canvas (${JSON.stringify(before)} → ${JSON.stringify(afterDrag)})`,
  );

await page.keyboard.down("Control");
await page.mouse.wheel(0, -240);
await page.keyboard.up("Control");
const afterZoom = await whenStill();
/**
 * A RATIO, NOT A DIFFERENCE. Zoom is multiplicative — a wheel step scales it — so an absolute threshold asks
 * for a different amount of zooming at every scale, and fails at small ones for no reason. It failed exactly
 * that way on a canvas whose flow view fits 41 frames: the view opens at the 0.06 floor, one wheel step took
 * it to 0.0895, which is a real 1.49x zoom and a 0.03 difference, and the check called it "did not zoom".
 */
if (afterZoom.z / afterDrag.z < 1.1)
  failures.push(
    `the wheel did not zoom the canvas (${afterDrag.z} → ${afterZoom.z}, ${(afterZoom.z / afterDrag.z).toFixed(2)}x)`,
  );
else
  console.log(
    `pan and zoom hold: panned ${Math.round(afterDrag.x - before.x)}, ${Math.round(afterDrag.y - before.y)}` +
      ` and zoomed ${before.z.toFixed(2)} → ${afterZoom.z.toFixed(2)}`,
  );

const after = await attachment();
for (const edge of after.filter((one) => !one.attached))
  failures.push(
    `edge ${edge.pair} came off its frames after a pan and a zoom: ${edge.why}`,
  );
if (after.every((one) => one.attached))
  console.log(
    `all ${after.length} edges still attached after a pan and a zoom`,
  );

/* ------------------------------------------------- a comment, drawn end to end */
stage = "comments";

/**
 * The comment layer's promise is that the agent reading the file can SEE what was pointed at. So: draw an
 * outline on a real frame, then read the record off disk and the picture beside it. Taken away again
 * afterwards, so running the oracle leaves nothing behind.
 */
/** How every comment this script writes begins, so a later run can recognise and remove its own litter. */
const ORACLE_NOTE_MARK = "oracle:";

/* The first declared screen unless one is named: any real frame proves the round trip, and hard-coding a
   screen id makes this script project-specific for no gain. */
/* A flow screen, because the probe runs while the flows view is the one on screen. */
let on = argOf("comment-on") ?? flowScreens[0]?.id;
/* A CANVAS OF GROUPED SETS ONLY has no flow screen: an exploration drawn before its flows (a canvas whose one
   set is `groupedOnly`) reached this line with `undefined` and the run died on
   `[data-canvas-screen="undefined"]` after every other check had passed. The probe then runs on the grouped
   view, on the first captured frame, which proves the round trip just as well. */
if (!on) {
  on = onDevice.find((screen) => screen.url && !screen.explain)?.id;
  await switchView("kinds");
}
/* THE PROBE'S FRAME MUST BE DRAWN WHERE THE PROBE LOOKS. A flow screen of another device, or one the current view
   does not draw, left `boundingBox()` waiting 30s and the whole run "crashed" after every other check had passed.
   So: go to it, and if it is not on the surface, try the other view, and
   failing that take the first frame the surface does draw; the round trip is proven just as well on any real frame. */
const probeDrawn = async (id) => id != null && (await page.locator(`[data-canvas-screen="${id}"]`).count()) > 0;
const probeGoTo = async (id) => {
  await page.evaluate((target) => window.__devCanvas.goTo(target), id);
  await page.waitForTimeout(900);
};
await probeGoTo(on);
/* A canvas whose frames all live on the exploration tab draws nothing on
   the other two views, so the exploration is tried last. */
for (const mode of ["flows", "kinds", "explore"]) {
  if (await probeDrawn(on)) break;
  await switchView(mode).catch(() => {});
  await probeGoTo(on);
}
if (!(await probeDrawn(on))) {
  on = await page.evaluate(() => document.querySelector("[data-canvas-screen]")?.getAttribute("data-canvas-screen") ?? null);
  if (on) await probeGoTo(on);
}
if (!on) {
  const seen = await page.evaluate(() => ({
    url: location.href,
    view: window.__devCanvas?.view?.(),
    frames: document.querySelectorAll("[data-canvas-screen]").length,
    surface: !!document.querySelector("[data-canvas-surface]"),
    body: document.body.innerText.slice(0, 160),
  }));
  throw new Error(`the comment probe found no drawn frame on the canvas to draw on: ${JSON.stringify(seen)}`);
}
await page.evaluate(() => window.__devCanvas.setCommenting(true));
const box = await page.locator(`[data-canvas-screen="${on}"]`).first().boundingBox();
/**
 * DRAWN ON THE PART OF THE FRAME THAT IS ON SCREEN, which stopped being the whole frame once long pages
 * began capturing at full length: a 4000px landing page means 20% down its bounding box is well below the
 * viewport, and a mouse event there lands on nothing. The failure reads as "could not find Save", which is
 * true and unhelpful.
 *
 * So the drag happens inside the intersection of the frame and the viewport — which is also the only place a
 * reviewer could draw one, so the test now does what a person does.
 */
const view = page.viewportSize();
const visible = {
  x: Math.max(box.x, 0),
  y: Math.max(box.y, 0),
  right: Math.min(box.x + box.width, view.width),
  bottom: Math.min(box.y + box.height, view.height),
};
const vw = visible.right - visible.x;
const vh = visible.bottom - visible.y;
if (vw < 40 || vh < 40)
  failures.push(`${on} is not visible enough on screen to draw a comment on`);
const from = { x: visible.x + vw * 0.2, y: visible.y + vh * 0.2 };
const to = { x: visible.x + vw * 0.55, y: visible.y + vh * 0.45 };
/* The throwaway file is the only one this test writes: the reserved key resolves to its own namespaced file (no flat layout is
   read since the installer migrates it), cleared by name before the page loaded. */
try {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.type(
    `${ORACLE_NOTE_MARK} does this outline land in the file with a picture of itself`,
  );
  await page
    .locator(`[data-canvas-screen="${on}"] button:text-is("Save")`)
    .click({ timeout: 10_000 });
  await page.waitForTimeout(900);

  const file = JSON.parse(readFileSync(probeFile, "utf8"));
  const written = file.comments.find((comment) =>
    comment.note.startsWith("oracle:"),
  );
  if (!written)
    failures.push(
      `an outline was saved and is not in ${path.relative(path.join(HERE, ".."), probeFile)}, the throwaway file the round trip writes to`,
    );
  else {
    const shot = shotOf.get(on);
    const image = path.join(HERE, "..", written.image);
    if (!existsSync(image)) {
      failures.push(
        `the comment names ${written.image} and there is no such file`,
      );
    } else {
      /* PNG dimensions live in the IHDR chunk at a fixed offset, so this needs no image library. */
      const bytes = readFileSync(image);
      const w = bytes.readUInt32BE(16);
      const h = bytes.readUInt32BE(20);
      if (w !== shot.w || h !== shot.h)
        failures.push(
          `the comment's picture is ${w}x${h}, the shot it was drawn on is ${shot.w}x${shot.h}`,
        );
      else
        console.log(
          `\ncomment round trip holds: ${written.id} on ${written.screenId}, region ` +
            `${Math.round(written.region.xPct)}%,${Math.round(written.region.yPct)}% ` +
            `${Math.round(written.region.wPct)}x${Math.round(written.region.hPct)}% → ` +
            `${written.image} at ${w}x${h}`,
        );
    }
    if (written.shotHash !== shotOf.get(on)?.hash)
      failures.push(
        "the comment did not record the hash of the shot it was drawn on",
      );
    /**
     * AN ANSWER ROUND-TRIPS TOO. The agent answers a question with `PATCH { id, answer }`; the file has to hold
     * the words, the write has to consume the comment, and the open pin has to draw them — otherwise an
     * explanation given "on the canvas" reached nobody.
     */
    const answered = await page.evaluate(
      async ({ id, endpoint }) => {
        const response = await fetch(endpoint, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id, answer: "oracle: yes, and this is the answer under the pin" }),
        });
        return response.ok;
      },
      { id: written.id, endpoint: probeApi },
    );
    if (!answered) failures.push(`PATCH { id, answer } on ${written.id} was refused`);
    else {
      const withAnswer = JSON.parse(readFileSync(probeFile, "utf8")).comments.find(
        (comment) => comment.id === written.id,
      );
      if (!withAnswer?.answer?.text?.startsWith("oracle:"))
        failures.push(`the answer on ${written.id} did not land in the file`);
      else if (!withAnswer.consumedAt)
        failures.push(`answering ${written.id} did not mark it consumed`);
      else {
        await page.waitForTimeout(900);
        await page.evaluate((id) => window.__devCanvas.openPin?.(id), written.id);
        await page.waitForTimeout(400);
        const drawn = await page
          .locator(`[data-canvas-answer="${written.id}"]`)
          .innerText()
          .catch(() => "");
        if (!drawn.includes("this is the answer under the pin"))
          failures.push(`the answer on ${written.id} is in the file and not drawn under its pin`);
        else console.log(`answer round trip holds: ${written.id} carries its answer in the file and under the pin`);
      }
    }
    /* The endpoint is passed IN: this closure runs in the browser, where the Node-side consts do not exist. */
    const removed = await page.evaluate(
      async ({ id, endpoint }) => {
        const response = await fetch(
          `${endpoint}&id=${encodeURIComponent(id)}`,
          { method: "DELETE" },
        );
        return response.ok;
      },
      { id: written.id, endpoint: probeApi },
    );
    if (!removed)
      notes.push(
        `could not delete the oracle's own comment ${written.id}; remove it by hand`,
      );
    /* The "it took nothing else with it" assertion that stood here read the reviewer's file before and after, because
       the round trip wrote into it. It writes into the throwaway file now, and the assertion that replaces it is
       below, after the round trip: the reviewer's file must be exactly as it was found. */
  }
} catch (error) {
  failures.push(`could not draw a comment: ${error.message}`);
}
await page.evaluate(() => window.__devCanvas.setCommenting(false));

/**
 * THE REVIEWER'S FILE WAS NOT TOUCHED, and the throwaway one is gone. Anything in the reviewer's file carrying the oracle's
 * mark means the isolation leaked: that is a failure, and the leaked record is removed by its id (only a record the
 * oracle itself marked, never one of theirs). A file that merely changed is a note, not a failure: they may have been
 * reviewing while this ran, and nothing this script wrote can have changed it.
 */
{
  const realFile = commentsFile();
  const real = existsSync(realFile) ? JSON.parse(readFileSync(realFile, "utf8")) : { comments: [] };
  const leaked = (real.comments ?? []).filter((one) => (one.note ?? "").startsWith(ORACLE_NOTE_MARK));
  for (const one of leaked) {
    await fetch(`${commentsApi}&id=${encodeURIComponent(one.id)}`, { method: "DELETE" }).catch(() => undefined);
    failures.push(
      `the round trip leaked the oracle's comment ${one.id} into the reviewer's file (${path.relative(path.join(HERE, ".."), realFile)}): ` +
        `it was removed by id, and the isolation in front of the comments route did not hold`,
    );
  }
  const reviewerAfter = existsSync(realFile) ? createHash("sha256").update(readFileSync(realFile)).digest("hex") : null;
  if (leaked.length === 0 && reviewerBefore !== reviewerAfter)
    notes.push(
      `the reviewer's comments file changed while the oracle ran. The oracle writes only to the throwaway key ${PROBE_KEY}, so this was somebody else (or the canvas itself)`,
    );
  clearProbe();
}

/* ------------------------------------------------------------ the other view */
stage = "views";

await switchView("kinds");
const kinds = await page.evaluate(() => ({
  frames: document.querySelectorAll("[data-canvas-screen]").length,
  edges: document.querySelectorAll("path[data-canvas-edge]").length,
  groups: document.querySelectorAll("[data-canvas-group]").length,
}));
if (kinds.frames !== kindScreens.length)
  failures.push(
    `the by-kind grouping holds ${kinds.frames} frames, not the declared ${kindScreens.length}`,
  );
if (kinds.edges !== 0)
  failures.push(
    `the by-kind grouping drew ${kinds.edges} edges and should draw none`,
  );
console.log(
  `by kind: ${kinds.frames} frames in ${kinds.groups} groups, ${kinds.edges} edges`,
);

/**
 * A GROUP OF ONE IS NOT A GROUP: two frames side by side are a comparison, one frame under a heading is a frame
 * with a heading on it. Read from the canvas's own grouping rather than measured on screen, because a rendered
 * width scales with the zoom and an assertion that cannot fail is worse than no assertion.
 */
for (const mode of views) {
  await switchView(mode);
  const groups = await page.evaluate(() => window.__devCanvas.groups());
  /* Explanation panels are counted apart: they are nodes in a flow's layout, but they are not frames, and
     folding them into the frame count would let a missing PICTURE hide behind a present PANEL. */
  const real = (group) => group.screens.filter((id) => !explainIds.has(id));
  const total = groups.reduce((sum, group) => sum + real(group).length, 0);
  const explainsDrawn = groups.reduce(
    (sum, group) => sum + (group.screens.length - real(group).length),
    0,
  );
  /* Per view: the flow view holds the journeys, the grouped view holds those plus every comparison set, and the
     exploration tab holds the directions, plus today's frame in a panel where something hangs under it (a
     suggestion or a reference); every other panel shows today's design through each frame's switch instead.
     Counted per PANEL, not per screen: two panels redesigning the same screen draw its frame twice. */
  const incumbentsDrawn = explorations.filter(
    (exploration) =>
      onDevice.some((screen) => screen.id === exploration.original) &&
      (exploration.screens ?? []).some((screen) => screen.suggests === exploration.original),
  ).length;
  const expected =
    mode === "explore"
      ? exploreScreens.length + incumbentsDrawn
      : mode === "kinds"
        ? kindScreens.length
        : flowScreens.length;
  if (total !== expected)
    failures.push(
      `${mode}: ${total} frames across its groups, not the declared ${expected}`,
    );
  if (mode === "flows" && explainsDrawn !== explainScreens.length)
    failures.push(
      `flows: ${explainsDrawn} explanation panel(s) across its groups, not the declared ${explainScreens.length}`,
    );
  if (mode !== "flows" && explainsDrawn !== 0)
    failures.push(
      `${mode}: ${explainsDrawn} explanation panel(s) drawn in a view that must not hold any`,
    );
  /**
   * A GROUP OF ONE IS A BUG IN THE TWO PERMANENT VIEWS AND THE CORRECT END STATE IN AN EXPLORATION.
   *
   * Grouped screens and flows exist to put like beside like, so a lone frame there means a `kind` nobody
   * else shares or a flow with one step, and both are declaration mistakes. An exploration is the opposite:
   * it NARROWS. Five directions become three variants become one refined design, and that last round is a
   * panel of one by design: the best options are chosen and improved, round after round, until one specific
   * design remains for each type of screen. This check failed exactly that round, which would have
   * pushed an agent to invent a second option nobody asked for.
   */
  if (mode !== "explore")
    /* Counted on REAL frames: a flow of one screen and one explanation panel is still a flow of one. */
    for (const group of groups.filter((one) => real(one).length < 2)) {
      /* …unless the declaration CLAIMED it. `soloKind` is the author saying there is no existing
         section this frame could have joined, which is the one thing this check cannot work out for
         itself. A kind nobody claimed is still the declaration mistake it always was. */
      if (mode === "kinds" && real(group).every((id) => soloKindIds.has(id))) continue;
      failures.push(
        `${mode}: "${group.title}" is a group of ${real(group).length}, which is not a group`,
      );
    }
  console.log(
    `${mode}: ${groups.length} groups, ${total} frames, smallest ${Math.min(
      ...groups.map((group) => group.screens.length),
    )}`,
  );
}

/**
 * THE SWITCH UNDER AN OPTION FLIPS IT TO TODAY'S SCREEN AND BACK. Every exploration frame but the incumbent
 * carries one (`data-canvas-today` names the screen it flips to). Pressed, the frame's picture becomes that
 * screen's shot and the figure says so (`data-canvas-showing="today"`); pressed again, the option returns. A
 * real press through the mouse, because the surface's pan handler eats clicks that do not reach the chrome.
 */
if (exploreScreens.length > 0) {
  await switchView("explore");
  const first = page.locator("[data-canvas-today]").first();
  const count = await page.locator("[data-canvas-today]").count();
  if (count === 0)
    notes.push("explore: no frame carries the switch to today's screen — every option declares redesigns: null");
  else {
    const figure = first.locator("xpath=ancestor::figure[1]");
    const optionId = await figure.getAttribute("data-canvas-screen");
    const todayId = await first.getAttribute("data-canvas-today");
    await page.evaluate((id) => window.__devCanvas.goTo(id), optionId);
    await page.waitForTimeout(700);
    await first.click({ timeout: 10_000 });
    await page.waitForTimeout(400);
    const showing = await figure.getAttribute("data-canvas-showing");
    const src = (await figure.locator("img").first().getAttribute("src").catch(() => "")) ?? "";
    if (showing !== "today" || !src.includes(`id=${encodeURIComponent(todayId)}`))
      failures.push(
        `explore: the switch on ${optionId} did not flip it to ${todayId} (showing=${showing}, src=${src})`,
      );
    else {
      await first.click({ timeout: 10_000 });
      await page.waitForTimeout(400);
      const back = await figure.getAttribute("data-canvas-showing");
      const srcBack = (await figure.locator("img").first().getAttribute("src").catch(() => "")) ?? "";
      if (back !== null || !srcBack.includes(`id=${encodeURIComponent(optionId)}`))
        failures.push(`explore: the switch on ${optionId} did not flip back to the option`);
      else console.log(`today switch holds: ${optionId} flips to ${todayId} and back`);
    }
  }
}

stage = "open destinations";
/**
 * THE OPEN BUTTON MUST LAND ON WHAT THE PICTURE SHOWS. Every frame carries an Open button to its real URL,
 * and a canvas whose buttons land somewhere else is lying about its own pictures — found live when a whole
 * family of parameter-pinned dialog states opened as bare pages, because the served app was started without
 * the env flag its review-only seams are gated on. So every captured, non-frozen screen's URL is opened here
 * against the SERVED app and its own claims re-asserted on the live page: what must be there, what must not,
 * and the canvas-wide forbidden text. A frozen screen is skipped by definition — its state no longer exists
 * in the app, its picture is preserved history, and its Open lands on today's page.
 */
{
  let opened = 0;
  /* One visit of one URL, returning the claim problems it found (empty = clean). */
  const visit = async (screen) => {
    const live = await checkContext.newPage();
    let control = null;
    try {
      /* THE FRAME'S DATA, as the capture held, failed or answered it, through the same module and on this page only: a loading
         or an empty frame's claims are about a page that is loading or empty, and every one of them would fail on the real data. */
      control = await applyNetwork(live, mergeNetwork(canvasNetwork, screen.network));
      await live.goto(base + screen.url, {
        waitUntil: "domcontentloaded",
        timeout: 45_000,
      });
      const wanted = screen.expect ?? [];
      const banned = screen.expectMissing ?? [];
      const bannedEverywhere = forbid ?? [];
      /* The overlays this project declared (dismiss.json) that opened with the page go before anything is read. The
         beat is paid only by a project that declared any. */
      if (dismissals.clicks.length > 0) {
        await live.waitForTimeout(400);
        await dismissNow(live);
      }
      /* THE SAME STEPS THE CAPTURE PRESSED, through the same module: the frame's claims are about the page AFTER them, so
         proving the claims on a page nothing was pressed on would fail every step frame, and skipping them would pass a
         dialog frame that never opens. A step that cannot be done is its own named problem. */
      if (screen.steps?.length) {
        try {
          await runSteps(live, screen.steps, { dismissals });
        } catch (error) {
          return [`${screen.id}: its steps do not run on the served app — ${error.message}`];
        }
        await live.waitForTimeout(400);
        await dismissNow(live);
      }
      /* THE ORACLE READS WHAT THE CAPTURE READS. While this checked
         `document.body` and the capture checked the open dialog stack, the two
         disagreed on every dialog frame: the oracle passed claims the capture
         had just refused. A green check that contradicts
         the run it is checking is worse than no check. Positive claims read the
         open surface; forbidden text reads the whole document, because an
         overlay is an overlay wherever it sits. */
      const readSurface = async () => {
        let text = "";
        for (const frame of live.frames())
          text += await frame
            /* The one reader the capture and the steps use (`SURFACE_TEXT` in steps.mjs): the open dialog stack and the
               floating layers in front of it, or the body when nothing is open. */
            .evaluate(SURFACE_TEXT)
            .catch(() => "");
        return text;
      };
      const readAll = async () => {
        let text = "";
        for (const frame of live.frames())
          text += await frame
            .evaluate(() => document.body?.innerText ?? "")
            .catch(() => "");
        return text;
      };
      /* The page's own data is in before its claims are read, as the capture waits for it (the quiet wait, capped, and free on a quiet page). */
      await control.tracker.quiet();
      let text = await readSurface();
      /* The same bounded re-read the capture gives claims: dialogs mount after the page settles. */
      const until = Date.now() + 20_000;
      while (
        Date.now() < until &&
        !(wanted.every((claim) => text.includes(claim)) && control.unmet().length === 0)
      ) {
        await live.waitForTimeout(500);
        await dismissNow(live);
        text = await readSurface();
      }
      await dismissNow(live);
      const whole = await readAll();
      const problems = [];
      for (const claim of wanted)
        if (!text.includes(claim))
          problems.push(
            `${screen.id}: its Open destination does not show "${claim}" on the served app — the button does not land on the picture`,
          );
      /* The same proof the capture makes of a frame's own rules: a page that never asked for the operation a rule holds, fails or
         answers is a stale rule, and its picture would be of live data under a label that says otherwise. */
      for (const rule of control.unmet())
        problems.push(
          `${screen.id}: its Open destination never asked for ${rule.op} on the served app, so its rule "${rule.kind} ${rule.op}" matches nothing`,
        );
      /* `expectMissing` is the frame's own claim inverted, so it reads the frame's surface; `forbid` is an
         overlay tripwire, so it reads the whole document. */
      for (const nope of banned)
        if (text.includes(nope))
          problems.push(
            `${screen.id}: its Open destination shows "${nope}" on the served app`,
          );
      for (const nope of bannedEverywhere)
        if (whole.includes(nope)) {
          forbidHits.add(screen.id);
          problems.push(
            `${screen.id}: its Open destination shows "${nope}" on the served app`,
          );
        }
      return problems;
    } catch (error) {
      return [
        `${screen.id}: its Open destination did not load — ${error.message}`,
      ];
    } finally {
      /* A held request is aborted before its page closes, or the browser lets it through (see `dispose` in network.mjs). */
      await control?.dispose();
      await live.close();
    }
  };
  /**
   * ONLY THE FRAMES THAT CHANGED ARE OPENED, because every open asks the reviewer's dev server to compile a route. Opening every
   * frame of a canvas on every round drives a dev server's memory up without limit, and a dev server cannot be restarted
   * under a reviewer (their hot reload breaks). So this visits the frames captured since they last passed a live visit
   * (`live-pass.mjs`; the capture records them), or exactly the ones `--only` names, or every frame with `--live-all`, and says
   * how many it left alone. A frame whose visit is clean comes off the list; one that is not stays on it.
   */
  const liveOnly = (argOf("only") ?? "").split(",").map((one) => one.trim()).filter(Boolean);
  const choice = chooseLive({ screens, only: liveOnly, all: process.argv.includes("--live-all"), unproven: readUnproven(HERE, canvasSlug) });
  for (const id of choice.unknown) failures.push(`--only names "${id}", which is no screen on this canvas`);
  for (const id of choice.unopenable) notes.push(`--only names "${id}", which has no Open destination to visit (an explanation, preserved history or a wireframe)`);
  const clean = [];
  for (const screen of choice.visit) {
    /**
     * ONE RETRY BEFORE A VERDICT. Against a dev server the first hit of a route compiles it, and a cold
     * route plus a one-shot dialog opener lost the race often enough that whole oracle runs failed on a
     * different screen each time — three full reruns in one sitting. The second visit hits the compiled
     * route; a screen that fails BOTH visits has a real problem and every problem is reported.
     */
    let problems = await visit(screen);
    if (problems.length > 0) problems = await visit(screen);
    failures.push(...problems);
    if (problems.length === 0) clean.push(screen.id);
    opened += 1;
  }
  try {
    markProven(HERE, canvasSlug, clean, { declared: new Set(screens.map((one) => one.id)) });
  } catch (error) {
    notes.push(`could not record which frames passed their live visit (${String(error?.message ?? error).split("\n")[0]}): the next run may open them again`);
  }
  console.log(
    `open destinations: ${opened} live URLs re-proved their claims on the served app (${describeLive(choice)})`,
  );
}

await closeBrowser(browser);

if (dismissed.size > 0)
  notes.push(
    `dismissed from design-canvas/dismiss.json: ${[...dismissed].map(([name, count]) => `"${name}" x${count}`).join(", ")}`,
  );
if (notes.length > 0) {
  console.log("\nnotes:");
  for (const note of notes) console.log(`  - ${note}`);
}
if (failures.length > 0) {
  console.log(`\n${failures.length} FAILURE(S):`);
  for (const failure of failures) console.log(`  - ${failure}`);
  /* A forbidden text on an Open destination is an overlay from the app: name the remedy, once, under the failures. */
  if (forbidHits.size > 0)
    console.log(`\n${forbidRemedy({ appUrl: base, storageState, hits: forbidHits.size })}`);
  /* THE LAST LINE, always: the list above can scroll out of a tail, this cannot. */
  console.log(`\n${finalLine()}`);
  process.exit(1);
}
console.log("\nall assertions passed");
console.log(finalLine());
} finally {
  await closeBrowser(browser);
}
