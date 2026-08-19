#!/usr/bin/env node
/**
 * design-canvas — the oracle.
 *
 *   node design-canvas/check-canvas.mjs [--url http://localhost:3000] [--comment-on <screen id>]
 *                                    [--shell-selector "<css>"]
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
 *   7. an outline can be drawn on a frame, and the comment lands in `comments.json` with its region and an
 *      annotated PNG on disk, the size of the shot it was drawn on;
 *   8. the by-kind grouping holds every frame and draws no edges.
 *
 * A failure here is a build error, not a note.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

/* The copy standard, as code. Its docblock carries the rules and where they come from. */
import { checkCanvasCopy } from "./copy-rules.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function argOf(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

/* Next's default port. Pass `--url` when the dev server is somewhere else. */
const base = argOf("url") ?? "http://localhost:3000";

/**
 * WHICH CANVAS IS BEING PROVEN. A project can hold several, addressed as `/design-canvas/<slug>`, each with its
 * own declaration, its own pictures and its own review. `main` is the starter registry's slug, so a
 * single-canvas project passes nothing.
 */
const canvasSlug = argOf("canvas") ?? "main";
const canvasUrl = `${base}/design-canvas/${canvasSlug}`;
const shotsApi = `${base}/api/design-canvas/shots?canvas=${encodeURIComponent(canvasSlug)}`;
const commentsApi = `${base}/api/design-canvas/comments?canvas=${encodeURIComponent(canvasSlug)}`;

/**
 * Where this canvas's comments are, resolved the same way the route resolves them: namespaced, falling back to
 * the flat file a project reviewed before canvases were named. Resolved per call rather than once, because the
 * round-trip probe below CREATES the file — the namespaced path does not exist until it has run.
 */
function commentsFile() {
  const namespaced = path.join(HERE, "comments", `${canvasSlug}.json`);
  if (existsSync(namespaced)) return namespaced;
  const flat = path.join(HERE, "comments.json");
  return existsSync(flat) ? flat : namespaced;
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

/* The declaration comes from the running app, so this can never check a different set of screens than the
   canvas draws. The edges are read from the file as text, because they are the one thing the route does not
   serve — and reading them separately is a second opinion rather than a shortcut. */
async function declared() {
  const response = await fetch(`${shotsApi}&screens=1`);
  const { screens, kinds, title, note, groups } = await response.json();
  const source = readFileSync(path.join(HERE, "project", "flows.ts"), "utf8");
  const all = [
    ...source.matchAll(
      /from:\s*"([^"]+)",\s*to:\s*"([^"]+)"(?:,\s*label:\s*"([^"]+)")?/g,
    ),
  ].map((match) => ({ from: match[1], to: match[2], label: match[3] ?? null }));
  /**
   * ONE FILE HOLDS EVERY CANVAS, so the scrape has to be narrowed to the one being checked.
   *
   * `project/flows.ts` is the whole project's declaration: with two canvases installed side by side it held 67
   * edges, and this script asserted all 67 were drawn on whichever canvas it was pointed at — 22 of them, so it
   * failed on a canvas that was perfectly correct. Reading the source is still the second opinion it was meant to
   * be; it just cannot assume the file describes one canvas any more.
   *
   * An edge belongs to this canvas when BOTH ends are screens this canvas declares. An edge with one end here and
   * one end nowhere is a typo, and it is reported rather than quietly dropped — which is the check this filter
   * would otherwise have hidden.
   */
  const here = new Set(screens.map((screen) => screen.id));
  const edges = all.filter((edge) => here.has(edge.from) && here.has(edge.to));
  const half = all.filter(
    (edge) =>
      (here.has(edge.from) || here.has(edge.to)) &&
      !(here.has(edge.from) && here.has(edge.to)),
  );
  return { screens, edges, half, kinds, title, note, groups };
}

const failures = [];
const notes = [];
/* Collected rather than reported one by one: a canvas captured before stamping existed would print the same
   note thirty times and bury everything else. */
const unstamped = [];

/**
 * EVERY EDGE LABEL FOLLOWS THE SAME RULE, and it is checked here rather than trusted.
 *
 * An action edge starts with a verb and says what the person did on the screen the arrow leaves. A condition
 * edge starts with "When" and says what was true. Both are 12 to 24 characters, across the whole canvas, so
 * thirty chips read as one system. Without this, "keep it short" produced labels like "a piece" — a noun
 * between two screens that explains nothing about how anyone got from one to the other.
 */
const VERBS = [
  "Presses",
  "Opens",
  "Answers",
  "Finishes",
  "Chooses",
  "Picks",
  "Adds",
  "Makes",
  "Searches",
  "Waits",
  /* Added with the small-states rule: the beats between an empty form and a saved one are typing, fixing
     and pressing, and the first two had no verb here. A flow that carries "the state when I enter
     something" needs a label for it. */
  "Types",
  "Fixes",
  "When",
];
function checkLabels(edges) {
  for (const edge of edges) {
    const where = `${edge.from} → ${edge.to}`;
    if (!edge.label) {
      failures.push(
        `edge ${where} has no label, and every arrow has to say what happened`,
      );
      continue;
    }
    const verb = edge.label.split(" ")[0];
    if (!VERBS.includes(verb))
      failures.push(
        `edge ${where}: "${edge.label}" does not start with an action or "When"`,
      );
    if (edge.label.length < 12 || edge.label.length > 24)
      failures.push(
        `edge ${where}: "${edge.label}" is ${edge.label.length} characters, outside 12 to 24`,
      );
  }
}

const {
  screens,
  edges,
  half,
  kinds: declaredKinds,
  title: canvasTitle,
  note: canvasNote,
  groups,
} = await declared();

/**
 * EVERY WORD THIS CANVAS DRAWS, HELD TO ONE STANDARD — see `copy-rules.mjs` for what the standard is and why.
 *
 * A FAILURE rather than a note, unlike the size check beside it. A canvas that is too big is a judgment call; a
 * label of eleven words or a note that says "simply" is not. And the copy is the half of this tool a reader who was
 * not in the room actually depends on.
 */
for (const problem of checkCanvasCopy({
  title: canvasTitle,
  note: canvasNote,
  groups,
  screens,
  kinds: declaredKinds,
}))
  failures.push(`copy: ${problem}`);

/**
 * IS EVERY SCREEN IN A SECTION THIS CANVAS ACTUALLY HAS? — the check that stops a canvas drifting as it grows.
 *
 * `kind` is a free string, so a new screen filed under a section that nearly exists ("Domain setup" for an error
 * state that belongs in "Domain trouble") drew a group heading, looked deliberate, and was wrong. The reviewer
 * caught it and named the real problem, which is that it will keep happening: *"it's important that even after the
 * canvas becomes reeeeally big, you put new screens in their proper places (groups or flows) or create new ones
 * when needed, even if you start from a blank context but in the project with such a canvas already set up."*
 *
 * So the declaration may name its sections and say what belongs in each (`CanvasDeclaration.kinds`), and this
 * refuses any screen filed outside them. Adding a section stays possible and becomes deliberate: declare it, with
 * a sentence, and the check passes. Nothing is guessed from labels or ids — the only authority is the declaration.
 *
 * A canvas that declares nothing is not failed for it: the kinds in use are printed instead, so the next agent has
 * the list in front of it and can adopt one rather than invent a neighbour.
 */
const kindsInUse = [...new Set(screens.map((screen) => screen.kind).filter(Boolean))].sort();
if (Array.isArray(declaredKinds) && declaredKinds.length > 0) {
  const known = new Set(declaredKinds.map((one) => one.id));
  for (const screen of screens)
    if (screen.kind && !known.has(screen.kind))
      failures.push(
        `${screen.id}: filed under "${screen.kind}", which this canvas does not declare. ` +
          `Its sections are: ${declaredKinds.map((one) => `"${one.id}" (${one.whatBelongs})`).join("; ")}. ` +
          `Move the screen into one of them, or add the section to \`kinds\` on purpose.`,
      );
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
 * A canvas grows one frame at a time and nobody notices the moment it stops being one thing. The owner noticed it
 * for us: *"we are now at a point when the canvas becomes pretty big … it will start to be really difficult to
 * understand for me and especially for other people … even if we look at the online store canvas, it has stuff
 * related to the online store. It has stuff related to domains."* He was right, and the tool said nothing.
 *
 * TWO SIGNALS, AND BOTH HAVE TO AGREE, because either one alone cries wolf. Size on its own is not a problem — a
 * long single feature is allowed to be long. What makes a canvas two canvases is size PLUS a seam: two families of
 * route with no arrow crossing between them. The seam is computed from what the declaration already says, the
 * route of every screen and the ends of every edge, so it needs nothing new to be declared.
 *
 * A NOTE AND NEVER A FAILURE, which is the owner's own call out of three offered: *"a note in the oracle"*. A canvas
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

/* An edge with one end on this canvas and the other on nothing: a renamed or deleted screen left an arrow behind. */
for (const edge of half)
  failures.push(
    `edge ${edge.from} → ${edge.to}: one end is not a screen on this canvas`,
  );
checkLabels(edges);

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
 * being "every drawn frame" the moment a phone was declared: the first one made four count assertions fail at
 * once, all of them correctly measuring a canvas that was showing desktop. The checks below run against the
 * device the canvas is actually showing, which is the one the switch opens on — the first device the declaration
 * has. A canvas with one device is unaffected, which is every canvas built before this.
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

const flowScreens = onDevice.filter((screen) => screen.view === "flow");
const kindScreens = onDevice.filter(
  (screen) => screen.view === "flow" || screen.view === "kinds",
);
const exploreScreens = onDevice.filter(
  (screen) => screen.view === "exploration",
);
const views = exploreScreens.length > 0 ? ["flows", "kinds", "explore"] : ["flows", "kinds"];

/**
 * NO TWO TILES MAY BE THE SAME PICTURE, and this is the assertion that was missing.
 *
 * Two screens at one address with one state pinned photograph identically, and a reader has no way to know
 * the repetition was deliberate: they look for the difference, do not find it, and stop trusting the canvas.
 * It happened, in the project this came from: a group of four tiles where three were other tiles re-drawn
 * "for comparison", and the reviewer's verdict was "I don't understand any of those screenshots. What are
 * they supposed to show, do we really need all of them?" A state worth its own tile gets its own pinned
 * state; if it cannot have one, it does not need a tile.
 */
/**
 * A TWIN IS NOT A DUPLICATE. Two screens at one address on DIFFERENT DEVICES are the same design answered
 * twice, which is the whole point of `CanvasScreen.twin` — the first phone frame ever declared failed this
 * check against its own desktop counterpart. So the address is keyed with the device.
 */
const byUrl = new Map();
for (const screen of screens) {
  const key = `${screen.device ?? "desktop"} ${screen.url}`;
  const seen = byUrl.get(key);
  if (seen)
    failures.push(
      `${screen.id} and ${seen} are both ${screen.url}, so they are one picture twice`,
    );
  else byUrl.set(key, screen.id);
}

/* ------------------------------------------------- what the capture run proved */

const manifestPath = path.join(HERE, "shots", canvasSlug, "manifest.json");
if (!existsSync(manifestPath)) {
  console.log("Nothing captured yet. Run: node design-canvas/capture.mjs");
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const shotOf = new Map(manifest.shots.map((shot) => [shot.screenId, shot]));

/**
 * THE DRAIN GATE: a comment whose screen you recaptured, that you never marked consumed, is a FAILURE.
 *
 * This exists because the same mistake has now been made three times in one project, by me, in the same shape: work
 * the reviewer's comments, recapture the screens, hand it back — and never PATCH `{ consumed: true }`. Nothing
 * breaks loudly. The reviewer opens the canvas, sees every note still sitting there unanswered, and gets no review
 * bar at all, because the bar counts comments that are consumed AND stale. So the work looks undone.
 *
 * Owner, on the third time: _"why do my comments still are not marked as updated? I mean, I still see my comments
 * and I don't see the review wall component… that's something that would be good to fix in the skill because that's
 * not the first time you do this mistake."_
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
const undrained = (comments.comments ?? []).filter(
  (comment) => comment.stale === true && !comment.consumedAt,
);
if (undrained.length > 0)
  failures.push(
    `${undrained.length} comment(s) sit on a screen you recaptured and were never marked consumed ` +
      `(${undrained.map((one) => one.id).join(", ")}). ` +
      `The reviewer sees them as unanswered and gets no review bar. ` +
      `PATCH ${commentsApi} with { id, consumed: true } for each one you acted on.`,
  );

/**
 * AND WHAT IS STILL OUTSTANDING, EVERY RUN, WITH ITS IDS — because the gate above cannot see the worst case.
 *
 * `stale && !consumedAt` only catches a comment whose screen was recaptured, which means it only catches notes the
 * agent already touched. A note it never opened is not stale, so it passes this oracle in silence. That is how a run
 * ends clean with real feedback untouched: fifteen were waiting, ten were worked, five were never read, and every
 * check passed. The owner, on finding those five still sitting there: *"I don't know how that's possible that there
 * are comments that were not in my handoff."*
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
const declaredIds = new Set(screens.map((screen) => screen.id));
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
  const shot = shotOf.get(screen.id);
  if (!shot) {
    failures.push(`${screen.id}: declared and never captured`);
    continue;
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
  if (!shot.stable)
    failures.push(
      `${screen.id}: two captures came out different, so the page was still moving`,
    );
  if (shot.images && shot.images.empty > 0)
    failures.push(
      `${screen.id}: ${shot.images.empty} image(s) on screen never loaded, so the picture has holes in it`,
    );
  if (!existsSync(path.join(HERE, "shots", canvasSlug, shot.file)))
    failures.push(
      `${screen.id}: the manifest names ${shot.file} and there is no such file`,
    );
  /* The badges under a frame point at real files, so a rename in the app has to be caught here rather than by
     someone following a path that no longer exists. */
  for (const file of screen.source ?? []) {
    if (!existsSync(path.join(HERE, "..", file)))
      failures.push(
        `${screen.id}: names the file ${file} and there is no such file`,
      );
  }
  if ((screen.source ?? []).length === 0)
    notes.push(`${screen.id}: no source file declared`);

  /**
   * IS THE PICTURE OLDER THAN WHAT IT IS A PICTURE OF? `capture.mjs` stamps every shot with a content hash of
   * the files its screen declares; this re-hashes them and says so when they differ. It is the safety net
   * under `capture.mjs --changed`: that flag decides what to recapture, this catches the run where nobody
   * passed it. A note rather than a failure, because a changed file does not always change a picture — but an
   * unexplained one here is how a canvas quietly stops being true.
   */
  const stamped = shot.stamp?.sources ?? null;
  if (stamped) {
    const moved = [];
    for (const [file, was] of Object.entries(stamped)) {
      const at = path.join(HERE, "..", file);
      const now = existsSync(at)
        ? createHash("sha256")
            .update(readFileSync(at))
            .digest("hex")
            .slice(0, 16)
        : "missing";
      if (now !== was) moved.push(file);
    }
    if (moved.length > 0)
      notes.push(
        `${screen.id}: captured before ${moved.join(", ")} changed — recapture it with capture.mjs --changed`,
      );
  } else if ((screen.source ?? []).length > 0) {
    unstamped.push(screen.id);
  }
}
if (unstamped.length > 0)
  notes.push(
    `${unstamped.length} shot(s) have no stamp, so nothing can tell whether they are out of date: ` +
      `${unstamped.join(", ")} — one full capture fixes it`,
  );
const orphans = manifest.shots.filter(
  (shot) => !screens.some((one) => one.id === shot.screenId),
);
for (const shot of orphans)
  notes.push(`${shot.screenId}: captured and no longer declared`);
console.log(
  `${screens.length} screens declared, ${manifest.shots.length} captured, ${edges.length} edges declared\n`,
);

/* ----------------------------------------------------------------- the canvas */

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on("pageerror", (error) => failures.push(`page error: ${error.message}`));

await page.goto(canvasUrl, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => Boolean(window.__devCanvas), null, {
  timeout: 30_000,
});

/**
 * ASK FOR THE VIEW BEFORE COUNTING ITS FRAMES. This script's own trap #8 in reverse: the canvas no longer opens
 * on a fixed view — an open exploration takes the first tab and the first paint — so a count taken "as it loads"
 * is a count of whichever view happened to win. Stated explicitly, the number below means one thing on every
 * canvas.
 */
await page.evaluate(() => window.__devCanvas.setView("kinds"));
await page.waitForTimeout(400);

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
 * could be missing from the canvas, or drawing a picture of the wrong size, and nothing here would know. The
 * owner: *"definitely fix 'The oracle still doesn't walk the second device'."*
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
  const wants = screen.view === "exploration" ? "explore" : "kinds";
  /**
   * SWITCHING THE VIEW IS NOT INSTANT, and jumping in the same tick lands on the OLD layout.
   *
   * `goTo` centres a node using the layout React has rendered. Called immediately after `setView`, it runs
   * against the previous view's positions, the frame ends up off screen, `content-visibility` skips rendering it,
   * and its lazy picture never loads — so the assertion below failed on exactly one screen, the first one after
   * each view change, every run. It read as a broken image and was a race in this script.
   */
  if (wants !== inView) {
    await page.evaluate((next) => window.__devCanvas.setView(next), wants);
    await page.waitForTimeout(500);
    inView = wants;
  }
  await page.evaluate((id) => window.__devCanvas.goTo(id), screen.id);
  /* WAITED FOR, NOT SLEPT THROUGH. A frame's picture is lazy and its container skips rendering while it is off
     screen, so it only starts loading once the canvas has arrived at it. A fixed pause passed on a quiet
     machine and failed thirteen frames on a busy one, which is a flaky assertion rather than a finding. */
  const image = await page
    .locator(`[data-canvas-screen="${screen.id}"] img`)
    .evaluate(async (node) => {
      for (let i = 0; i < 100; i += 1) {
        if (node.complete && node.naturalWidth > 0) break;
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
   * The rule the owner stated, and it was already half-enforced: *"for all the desktop screens, we need a
   * defined size … like 1440x900 if it's not a page that has more content and available under the scroll, and
   * if it does and the screenshot requires it to show more than just 900 pixels of height, then it should
   * definitely make it longer, like screenshot the whole page. And we need to make it a clear rule."*
   *
   * The capture has always done that part: a page inside `LONG_PAGE_SLACK` of the viewport is photographed at
   * exactly one viewport, and one that genuinely runs past the fold is photographed whole. What defeated it
   * was a per-screen viewport that kept the canvas's WIDTH and only raised its HEIGHT — which is not a device,
   * it is padding, and it made every frame in a group 200px taller than any real window. It went unnoticed for
   * two rounds of review because the check above deliberately ignores height. The owner found it by eye:
   * *"it's for some reason big. like it does not look like a typical viewport that we use for capturing
   * desktop screenshots."*
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

/* The edges only exist in the flows view, and the canvas no longer opens on it — grouped screens is the default.
   Asked for explicitly rather than assumed, or every assertion below would quietly pass against a view that
   draws no edges at all. */
await page.evaluate(() => window.__devCanvas.setView("flows"));
await page.waitForTimeout(800);

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
    return [...document.querySelectorAll("path[data-canvas-edge]")].map(
      (path) => {
        const pair = path.getAttribute("data-canvas-edge");
        const [from, to] = pair.split("->");
        const a = document.querySelector(`[data-canvas-screen="${from}"]`);
        const b = document.querySelector(`[data-canvas-screen="${to}"]`);
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
    const frames = [...document.querySelectorAll("[data-canvas-screen]")].map(
      (node) => ({
        id: node.getAttribute("data-canvas-screen"),
        box: node.getBoundingClientRect(),
      }),
    );
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
const on = argOf("comment-on") ?? flowScreens[0]?.id;
await page.evaluate((id) => window.__devCanvas.goTo(id), on);
await page.waitForTimeout(900);
await page.evaluate(() => window.__devCanvas.setCommenting(true));
const box = await page.locator(`[data-canvas-screen="${on}"]`).boundingBox();
/**
 * DRAWN ON THE PART OF THE FRAME THAT IS ON SCREEN, which stopped being the whole frame once long pages
 * began capturing at full length: a 4045px storefront means 20% down its bounding box is well below the
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
/**
 * FIRST, SWEEP UP AFTER EVERY PREVIOUS RUN OF THIS TEST — because when it does not, it locks itself out.
 *
 * The delete at the end of this block is best-effort: kill the script, or let anything else rewrite the comment
 * file between the write and the delete, and the oracle's own comment survives. It then sits at exactly the
 * coordinates below, and a pin swallows the next run's pointerdown — pins stop propagation on purpose, so no
 * drag ever starts and the failure reads "could not draw a comment: waiting for … button Save", which is true
 * and points nowhere near the cause. Measured: one interrupted run left `c38` at 20%,20% 35x25% and every run
 * after it failed identically.
 *
 * So the marker in the note is load-bearing, and this removes anything carrying it before drawing anything new.
 */
/* A CANVAS WHOSE REVIEW HAS NOT STARTED HAS NO COMMENT FILE, and that is not an error: the file is written by
   the first comment. This read assumed one existed, so pointing the oracle at a fresh canvas — or at one whose
   reviews live in another checkout, since `comments/` is gitignored — crashed the whole run at the last step,
   after every assertion had already passed. */
const commentsPath = commentsFile();
const leftovers = (
  existsSync(commentsPath)
    ? (JSON.parse(readFileSync(commentsPath, "utf8")).comments ?? [])
    : []
).filter((one) => (one.note ?? "").startsWith(ORACLE_NOTE_MARK));
for (const stale of leftovers) {
  const gone = await page.evaluate(
    async ({ id, endpoint }) => {
      const response = await fetch(`${endpoint}&id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      return response.ok;
    },
    { id: stale.id, endpoint: commentsApi },
  );
  notes.push(
    gone
      ? `swept up a leftover oracle comment (${stale.id}) before drawing`
      : `could not sweep up leftover oracle comment ${stale.id}; remove it by hand or this test cannot draw`,
  );
}
/* A RELOAD, NOT A WAIT. Deleting the record does not remove the PIN that is already drawn — the client is
   holding the comment list it fetched at load — and that pin is exactly what swallows the drag below. Waiting
   was tried first and the same run still failed while the next one passed, which is a test that heals itself
   one run too late. */
if (leftovers.length > 0) {
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await page.evaluate((next) => window.__devCanvas.setView(next), "flow");
  await page.waitForTimeout(500);
  await page.evaluate((id) => window.__devCanvas.goTo(id), on);
  await page.waitForTimeout(900);
  await page.evaluate(() => window.__devCanvas.setCommenting(true));
  await page.waitForTimeout(300);
}
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

  const file = JSON.parse(
    readFileSync(commentsFile(), "utf8"),
  );
  const written = file.comments.find((comment) =>
    comment.note.startsWith("oracle:"),
  );
  if (!written)
    failures.push(
      `an outline was saved and is not in ${path.relative(path.join(HERE, ".."), commentsFile())}`,
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
    /* The endpoint is passed IN: this closure runs in the browser, where the Node-side consts do not exist. */
    const removed = await page.evaluate(
      async ({ id, endpoint }) => {
        const response = await fetch(
          `${endpoint}&id=${encodeURIComponent(id)}`,
          { method: "DELETE" },
        );
        return response.ok;
      },
      { id: written.id, endpoint: commentsApi },
    );
    if (!removed)
      notes.push(
        `could not delete the oracle's own comment ${written.id}; remove it by hand`,
      );
    /**
     * AND IT TOOK NOTHING ELSE WITH IT. The round trip writes and deletes a record in the reviewer's own
     * file, so the one thing it must prove beyond "my comment landed" is that every other comment is still
     * there afterwards. One of the reviewer's comments went missing during a run of this script on
     * — c1, deleted by a single-id DELETE nobody could account for — and this assertion is what
     * would have named it on the spot instead of leaving it to be noticed later by eye.
     */
    /* Through the resolver, not a hardcoded path: a canvas's review lives at `comments/<slug>.json` now, and
       reading the flat file threw ENOENT on every namespaced canvas — which failed the probe that was added to
       protect the reviewer's comments, on the one canvas that has any. */
    const after = JSON.parse(readFileSync(commentsFile(), "utf8"));
    const before = new Set(
      file.comments.filter((one) => one.id !== written.id).map((one) => one.id),
    );
    const survived = new Set(after.comments.map((one) => one.id));
    const lost = [...before].filter((id) => !survived.has(id));
    if (lost.length > 0)
      failures.push(
        `the round trip lost ${lost.length} of the reviewer's comments: ${lost.join(", ")} — restore from ${path.relative(path.join(HERE, ".."), commentsFile())}.1`,
      );
  }
} catch (error) {
  failures.push(`could not draw a comment: ${error.message}`);
}
await page.evaluate(() => window.__devCanvas.setCommenting(false));

/* ------------------------------------------------------------ the other view */

await page.evaluate(() => window.__devCanvas.setView("kinds"));
await page.waitForTimeout(600);
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
  await page.evaluate((next) => window.__devCanvas.setView(next), mode);
  await page.waitForTimeout(400);
  const groups = await page.evaluate(() => window.__devCanvas.groups());
  const total = groups.reduce((sum, group) => sum + group.screens.length, 0);
  /* Per view: the flow view holds the journeys, the grouped view holds those plus every comparison set, and the
     exploration tab holds the directions. */
  const expected =
    mode === "explore"
      ? exploreScreens.length
      : mode === "kinds"
        ? kindScreens.length
        : flowScreens.length;
  if (total !== expected)
    failures.push(
      `${mode}: ${total} frames across its groups, not the declared ${expected}`,
    );
  /**
   * A GROUP OF ONE IS A BUG IN THE TWO PERMANENT VIEWS AND THE CORRECT END STATE IN AN EXPLORATION.
   *
   * Grouped screens and flows exist to put like beside like, so a lone frame there means a `kind` nobody
   * else shares or a flow with one step, and both are declaration mistakes. An exploration is the opposite:
   * it NARROWS. Five directions become three variants become one refined design, and that last round is a
   * panel of one by design — the owner's own description of the funnel: _"we choose the best ones out of the
   * best ones and we improve them. Then we choose the best ones again until we have a very specific single
   * design for each type of screens we need."_ This check failed exactly that round, which would have
   * pushed an agent to invent a second option nobody asked for.
   */
  if (mode !== "explore")
    for (const group of groups.filter((one) => one.screens.length < 2))
      failures.push(
        `${mode}: "${group.title}" is a group of ${group.screens.length}, which is not a group`,
      );
  console.log(
    `${mode}: ${groups.length} groups, ${total} frames, smallest ${Math.min(
      ...groups.map((group) => group.screens.length),
    )}`,
  );
}

await browser.close();

if (notes.length > 0) {
  console.log("\nnotes:");
  for (const note of notes) console.log(`  - ${note}`);
}
if (failures.length > 0) {
  console.log(`\n${failures.length} FAILURE(S):`);
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exit(1);
}
console.log("\nall assertions passed");
