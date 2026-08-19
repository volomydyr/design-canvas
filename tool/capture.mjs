#!/usr/bin/env node
/**
 * design-canvas — the capture pipeline. This is where the canvas gets its pictures.
 *
 *   node design-canvas/capture.mjs [--url http://localhost:3000] [--only home,empty-store]
 *
 * WHY PICTURES AT ALL. The canvas used to draw every screen as a live route in an iframe, which is
 * unbeatable for fidelity and unusable in practice: thirty-eight live Next pages on one surface cannot be
 * panned or zoomed smoothly, and a canvas that stutters is not a canvas. So the frames are images now, and
 * everything the live version could interrogate about a page is instead PROVED HERE, at the moment the
 * shutter opens, and written into a manifest the canvas reads.
 *
 * THE WHOLE DIFFICULTY IS WHEN TO PRESS THE SHUTTER. A page screenshotted a moment too early is a
 * half-loaded page, a page caught mid-animation is a design that never existed, and either one presented on
 * a canvas is a lie the reviewer cannot detect. So a capture only happens after all of this, in order:
 *
 *   1. LOADED       the document is complete, it has rendered text, its fonts have loaded, and every image
 *                   in it has finished — including in the frames the page mounts of its own (the share menu
 *                   a preview surface draws the page it previews in one, a setup flow draws it in another).
 *   2. FINISHED     every animation and transition that ENDS has ended, rather than being paused where it
 *                   happened to be. Only the ones that never end are paused, because those never finish.
 *   3. FROZEN       a stylesheet then pins everything still in every document, and every video is paused,
 *                   so nothing can start moving between the next two steps.
 *   4. TRUE         every claim the screen declares is actually in the page, checked across all its frames.
 *                   A mislabelled frame is caught here, before it can become a picture.
 *   5. STABLE       two consecutive captures come out BYTE FOR BYTE IDENTICAL. This is the strongest cheap
 *                   proof that the picture is of a settled design: a page still loading or still moving
 *                   cannot produce the same bytes twice. If it never does, the shot is recorded as unstable
 *                   and the run fails rather than quietly shipping it.
 *
 * All of that is written into `shots/manifest.json` beside the images, so the canvas can say out loud which
 * frames proved themselves and which did not, and so a comment can be flagged stale when the screen under
 * it is captured again.
 *
 * WebP through the browser's own encoder (Chromium's `Page.captureScreenshot` takes it, Playwright's own
 * helper does not) — high quality at about a tenth of a PNG's size, and no new dependency for either.
 */
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** The project root. `HERE` is `design-canvas/`, so everything repo-relative hangs off its parent. */
const ROOT = path.join(HERE, "..");

/**
 * WHICH CANVAS THIS RUN IS FOR. A project can hold several, addressed as `/design-canvas/<slug>`, and the slug
 * namespaces everything this script touches: the pictures it writes, the manifest it prunes against, and the
 * comment file it marks stale. Two canvases sharing one folder would have each run delete the other's frames
 * as orphans, because a screen the other canvas declares is a screen this one has never heard of.
 *
 * Defaults to `main`, which is the slug the starter registry uses, so a single-canvas project passes nothing.
 * `--canvas <slug>` for anything else.
 */
const canvasSlug = (() => {
  const at = process.argv.indexOf("--canvas");
  return at >= 0 ? process.argv[at + 1] : "main";
})();

const SHOTS = path.join(HERE, "shots", canvasSlug);

/* Namespaced, falling back to the flat file a project reviewed before slugs existed — the route does the same,
   and marking a reviewer's comments stale is the one job here whose silent failure nobody would notice. */
const COMMENTS = (() => {
  const namespaced = path.join(HERE, "comments", `${canvasSlug}.json`);
  if (existsSync(namespaced)) return namespaced;
  const flat = path.join(HERE, "comments.json");
  return existsSync(flat) ? flat : namespaced;
})();

/* Next's default port. Pass `--url http://localhost:<port>` when the server is somewhere else — and for a
   production build, which is what captures should run against, it always is. */
const base = argOf("url") ?? "http://localhost:3000";
const only = (argOf("only") ?? "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);
/**
 * `--changed` — recapture what a change actually touched, and leave the rest alone.
 *
 * A round of design feedback means editing the app and then recapturing. Recapturing EVERYTHING is slow and,
 * worse, it marks every comment on the canvas stale — including the ones about screens nobody touched, which
 * puts work back in the reviewer's queue that they already answered. Recapturing by hand means remembering
 * which ids to pass to `--only`, and a screen you forget looks current and is not.
 *
 * So each shot records a STAMP: a content hash of every file the screen declares in `source`, plus a hash of
 * the screen's own declaration (its address, its pinned state, its claims). `--changed` re-hashes and captures
 * a screen when any of them differs, when it has never been captured, or when it has no stamp yet.
 *
 * CONTENT HASHES, NOT TIMESTAMPS AND NOT GIT. An mtime changes when a formatter runs and when a branch is
 * checked out, so timestamps recapture things that did not change; git needs a clean tree to be honest about
 * an uncommitted edit, which is exactly the state this runs in. A hash of the bytes is true in every case and
 * needs nothing installed.
 *
 * IT FOLLOWS IMPORTS, so a shared component IS seen: `source` names one or two entry files and `stampOf`
 * walks out from them through every project file they reach. A change to a button used by nine screens marks
 * those nine and leaves the rest alone. See `filesReachedFrom` for what it deliberately does not follow.
 */
/**
 * CHANGED-ONLY IS THE DEFAULT NOW, and `--all` is how you override it.
 *
 * It could not be, while the stamp was one or two hand-named files: skipping a screen whose shared component had
 * changed would have left a stale picture on the canvas with nothing saying so. Three things make it safe. The
 * stamp is the transitive import closure, so a shared component is seen. `GLOBAL_INPUTS` covers the files no
 * import graph reaches. And `check-canvas.mjs` reports "captured before X changed" as a note on every run, so
 * drift is surfaced by the checker even in the case this misses.
 *
 * Why bother: a full run is 33 pages against a dev server that compiles on demand, and every one of them is a
 * chance for a claim to arrive late. Capturing 4 screens instead of 33 is not only faster, it is four chances
 * instead of thirty-three — most of the cost of this loop was the retries, not the captures.
 *
 * `--changed` is still accepted and does nothing, because it is in the skill's own instructions and in muscle
 * memory. `--all` is the escape hatch for the one case that stays legitimate: proving the whole canvas from
 * scratch after something the stamp cannot model.
 */
const captureAll = process.argv.includes("--all");
const changedOnly = !captureAll;

/**
 * EVERY PROJECT FILE A SCREEN ACTUALLY DEPENDS ON, by following its imports.
 *
 * WHY THIS EXISTS. `--changed` used to hash only the one or two files a screen names in `source`, and said so:
 * "a shared component that a screen's `source` does not name is invisible here." That warning was honest and it
 * was expensive. Editing one shared control component — which every frame of a whole canvas renders — changed
 * nothing any screen declared, so the only safe move was a full run: 33 screens to see 12 of them differ. Do
 * that eight times in an afternoon while iterating on one shared row and the recapture loop is most of the day.
 * The owner's complaint was the wall clock of exactly that: _"around 30 minutes for our canvas. But it doesn't
 * make any sense."_
 *
 * So the stamp is the transitive closure instead. `source` stays one or two files — the route and the surface,
 * written by hand — and this finds the rest.
 *
 * BOUNDED AND DELIBERATELY OVER-INCLUSIVE. Only the project's own files are followed: a bare specifier is a
 * package and is skipped, because `node_modules` cannot change without a lockfile change and walking it would
 * cost more than the full run this is avoiding. A specifier that cannot be resolved is IGNORED rather than
 * guessed at — the failure mode of this function has to be "recaptured something it did not need to", never
 * "skipped something it should have taken".
 */
/**
 * THE INPUTS NO IMPORT GRAPH CAN REACH, hashed into every screen.
 *
 * The walker follows what a component imports, and a component does not import its design tokens: the Tailwind
 * config and the global stylesheet are wired in by the build, so changing a colour, a font size or a spacing scale
 * repaints every frame while touching nothing any screen names. Same for the pin adapter, which decides what
 * `?canvas=` does at all.
 *
 * This is the list that makes changed-only capture SOUND rather than merely cheap. A file here that stops existing
 * is skipped, so a project laid out differently loses precision and never correctness.
 */
const GLOBAL_INPUTS = [
  "tailwind.config.ts",
  "tailwind.config.js",
  "app/globals.css",
  "design-canvas/project/canvas-state-pin.tsx",
];

const IMPORT_RE = /(?:import|export)[\s\S]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;
const EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".mjs", ".css"];

/** Resolve one specifier against the project root, the way the bundler would. Null when it is a package. */
function resolveSpecifier(spec, fromFile) {
  let base;
  if (spec.startsWith("@/")) base = path.join(ROOT, spec.slice(2));
  else if (spec.startsWith("./") || spec.startsWith("../"))
    base = path.resolve(path.dirname(fromFile), spec);
  else return null;

  if (existsSync(base) && !statSync(base).isDirectory()) return base;
  for (const ext of EXTENSIONS) if (existsSync(base + ext)) return base + ext;
  for (const ext of EXTENSIONS)
    if (existsSync(path.join(base, "index" + ext)))
      return path.join(base, "index" + ext);
  return null;
}

/** Every project file reachable from these entry files, entries included. Repo-relative, sorted. */
function filesReachedFrom(entries) {
  const seen = new Set();
  const queue = [];
  for (const file of entries) {
    const at = path.join(ROOT, file);
    if (existsSync(at)) queue.push(at);
  }
  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    if (!/\.(tsx?|jsx?|mjs)$/.test(file)) continue;
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const match of text.matchAll(IMPORT_RE)) {
      const spec = match[1] ?? match[2];
      if (!spec) continue;
      const next = resolveSpecifier(spec, file);
      if (next && !seen.has(next)) queue.push(next);
    }
  }
  return [...seen].map((at) => path.relative(ROOT, at)).sort();
}

/**
 * What a screen is made of, hashed: everything it imports, the file that decides its pinned state, and the
 * declaration itself. Two screens of the same route at different states have different stamps, because the state
 * is part of the declaration.
 */
function stampOf(screen) {
  const sources = {};
  /**
   * THE PINNING FILE COUNTS TOO, and leaving it out was a hole with teeth. `decl` hashes the state's NAME, not
   * what the state does — so rewriting the fixture a state calls (adding a failure cause, changing a count)
   * changed the picture of a dozen screens while marking none of them stale. Every screen that pins a state
   * depends on the file that implements it.
   */
  const entries = [...(screen.source ?? []), ...GLOBAL_INPUTS];
  /* READ OFF THE URL, not off a `state` field: the declaration is served over the API and what arrives is the
     resolved `url` with `?canvas=<state>` in it. `screen.state` is always undefined here, so the first version of
     this check never fired once — the hole it was written to close stayed open and the test above found it. */
  if (/[?&]canvas=/.test(screen.url ?? ""))
    entries.push("design-canvas/project/states.ts");
  for (const file of filesReachedFrom(entries)) {
    const at = path.join(ROOT, file);
    sources[file] = existsSync(at)
      ? createHash("sha256").update(readFileSync(at)).digest("hex").slice(0, 16)
      : "missing";
  }
  return {
    /* Everything about the screen that decides what the picture should contain. `label`, `note` and `kind` are
       left out on purpose: renaming a tile does not change the page under it. */
    decl: createHash("sha256")
      .update(
        JSON.stringify([
          screen.url,
          screen.state ?? null,
          screen.expect ?? null,
          screen.expectMissing ?? null,
          screen.expectSelector ?? null,
          screen.focus ?? null,
          screen.viewport ?? null,
          /* THE DEVICE IS PART OF WHAT THE PICTURE IS. Without these two a screen moved from desktop to phone
             kept its desktop shot, because nothing else about the declaration changed. */
          screen.device ?? null,
          screen.deviceViewport ?? null,
        ]),
      )
      .digest("hex")
      .slice(0, 16),
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

/** Quality of the WebP. High enough that type and hairlines survive, small enough to load instantly. */
const QUALITY = 92;
/** How long the loaded checks may take before the capture goes ahead and says it timed out. */
const LOAD_TIMEOUT_MS = 45_000;
/** How long to wait for the animations that end. */
const ANIMATION_TIMEOUT_MS = 9_000;
/** A floor under every capture, so a one-off entrance animation is never caught mid-flight. */
const MIN_SETTLE_MS = 1200;
/** How many attempts at two identical captures. */
const STABLE_TRIES = 5;
/** Between attempts. */
const STABLE_GAP_MS = 600;
/**
 * How long a positive claim may take to appear before the capture calls it unproved.
 *
 * WHY IT IS THIS LARGE, and why the pin mark below is not enough on its own. `CanvasStatePin` lives in the ROOT
 * layout, so its effect — and therefore the mark — can fire before the page's own tree has finished rendering.
 * The mark proves the STORE holds the pinned state; it does not prove the failure list has been drawn from it.
 * Under a full run's concurrency against `next dev`, which compiles routes on demand, that gap was still costing
 * screens whose text is plainly there when they are captured alone.
 *
 * Twenty-five seconds, and the cost is paid only by screens that actually fail: a passing claim ends the wait the
 * moment it appears. The alternative was another round of chasing content bugs that were clocks.
 */
const CLAIM_BUDGET_MS = 25_000;
/**
 * How long to wait for the pinned state to actually be in place.
 *
 * Generous on purpose, and much larger than the claim budget: this is a whole hydration under the load of a
 * full run against `next dev`, which compiles routes on demand. Eight seconds was tried and was not enough —
 * it failed a different handful of screens on each run, which is the signature of a threshold set inside the
 * distribution it is trying to exclude. Waiting longer costs nothing on a healthy screen, because the wait ends
 * the moment the mark appears.
 */
const PIN_TIMEOUT_MS = 45_000;
/** Below this, the image is blank or nearly so, whatever the DOM claimed. */
const MIN_BYTES = 6_000;
/**
 * A page taller than its viewport by more than this is captured WHOLE.
 *
 * The rule is not a list of pages, it is a fact about the page: if the window itself scrolls, what the person
 * meets is longer than one screen and a viewport-height crop would hide most of the design. If it does not —
 * because the surface is a fixed-height overlay whose insides scroll, like the share menu — then one screen IS
 * the design, and a "full page" capture of it would be the same picture with a different name.
 */
const LONG_PAGE_SLACK = 1.1;
/**
 * ON, at the owner's word: "what about fullscreen pages where it is important to show the full length?"
 *
 * It was parked pending exactly that decision. A storefront, a listing and a product page are designs
 * that happen down a scroll — 4045px and 4760px in the project this came from — and a 900px crop of one
 * shows its first fold and hides the rest, which is no use for judging it whole.
 *
 * WHAT IT DOES NOT DO, and this is the part worth keeping: it does not make every frame tall. `LONG_PAGE_SLACK`
 * above means a page only goes full-length if it is meaningfully longer than a viewport, so the share menu and
 * the first-run dialog — fixed-height surfaces whose insides scroll — stay one screen, because for them one
 * screen IS the design and a "full page" shot would be the same picture under a longer name.
 */
const CAPTURE_WHOLE_PAGES = true;
/** However long a page is, it stops here. A frame nobody can read on a canvas is not worth the megabytes. */
const MAX_PAGE_H = 8_000;

function argOf(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

/**
 * WHERE THE DECLARATION COMES FROM, which is not necessarily where the PAGES come from.
 *
 * The declaration comes from the RUNNING APP rather than from parsing TypeScript, so the pictures can never
 * be of a different set of screens than the canvas draws. But its route is dev-only and 404s under
 * `NODE_ENV=production`, and the pages are best captured from a PRODUCTION BUILD — see the note on
 * `--url` below. So the two can be pointed at different servers:
 *
 *   node design-canvas/capture.mjs --url http://localhost:3055 --screens-url http://localhost:3000
 *
 * `--screens-url` defaults to `--url`, so the ordinary all-dev invocation is unchanged.
 */
const screensBase = argOf("screens-url") ?? base;
const screensFile = argOf("screens-file");
let declaration = null;
if (screensFile) {
  /* From a file, so a capture run needs NO dev server at all. Dump it once with
     `curl "$DEV/api/design-canvas/shots?screens=1" -o screens.json` while a dev server is up, then capture
     against a build for ever after. This is what removes the contention that made captures unreliable: a
     `next build` and a `next dev` sharing one `.next` corrupt each other's chunks, and the resulting SSR
     500s look exactly like a broken app. */
  declaration = JSON.parse(readFileSync(screensFile, "utf8"));
} else {
  const endpoint = `${screensBase}/api/design-canvas/shots?screens=1&canvas=${encodeURIComponent(canvasSlug)}`;
  const listing = await fetch(endpoint).catch(() => null);
  if (!listing?.ok) {
    console.error(
      `Could not read the declaration from ${endpoint} — is the dev server up, and is "${canvasSlug}" a canvas this project declares?`,
    );
    process.exit(1);
  }
  declaration = await listing.json();
}
const { viewport, screens: declared } = declaration;
/* What was captured last time, read before anything is taken, because `--changed` decides from it. */
const manifestPath = path.join(SHOTS, "manifest.json");
const previous = existsSync(manifestPath)
  ? JSON.parse(readFileSync(manifestPath, "utf8"))
  : { shots: [] };
const shotOfPrevious = new Map(
  (previous.shots ?? []).map((shot) => [shot.screenId, shot]),
);

const screens =
  only.length > 0
    ? declared.filter((s) => only.includes(s.id))
    : changedOnly
      ? declared.filter((s) => changedSince(s, shotOfPrevious.get(s.id)))
      : declared;

/**
 * WHAT WAS SKIPPED IS SAID OUT LOUD, always. Silent completeness is the failure mode of every incremental
 * build: a run that prints "3 screens captured" and nothing else leaves a reader believing the other
 * twenty-five were checked, when they were only left alone.
 */
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
    /**
     * IT STILL PRUNES BEFORE IT LEAVES, which it did not, and that is how a deleted screen kept its picture.
     *
     * The pruning lives at the end of a capture, next to the manifest write, so this early exit skipped it: split a
     * canvas in two, recapture, and every frame that moved away was still in the old manifest and still on disk,
     * because nothing that REMAINED had changed. The oracle then reported thirty "captured and no longer declared"
     * screens on a canvas that was perfectly correct, every run, forever.
     *
     * A screen leaving the declaration is a change like any other, so this branch does the same two things the full
     * run does: delete the orphaned files, and write the manifest without them.
     */
    const gone = (previous.shots ?? []).filter(
      (shot) => !declared.some((screen) => screen.id === shot.screenId),
    );
    if (gone.length > 0) {
      for (const shot of gone) {
        const file = path.join(SHOTS, shot.file);
        if (existsSync(file)) rmSync(file);
      }
      writeFileSync(
        path.join(SHOTS, "manifest.json"),
        `${JSON.stringify(
          {
            ...previous,
            shots: (previous.shots ?? []).filter(
              (shot) => !gone.some((one) => one.screenId === shot.screenId),
            ),
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
      console.log(
        `${gone.length} no longer declared and removed: ${gone.map((shot) => shot.screenId).join(", ")}`,
      );
    }
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
 * Step 0. FORCE EVERY LAZY IMAGE TO LOAD, and it is the step that matters most.
 *
 * A jewelry store is photographs. The first run of this pipeline captured the customer front page at eleven
 * kilobytes — a correct layout with nothing in it — because the product photography is lazy and a headless
 * page never scrolls, so the browser never reached any of it. Every claim the screen declared was met, the
 * capture was perfectly stable, and the picture was of a store with no jewelry in it. That is the exact
 * failure this whole pipeline exists to prevent: a picture that passes every check and is not the design.
 *
 * So laziness is switched off and then waited on. Applied to every document, repeatedly, because a lazy
 * image can be added by a component that renders after the first pass.
 */
const EAGER = () => {
  const force = (doc) => {
    if (!doc) return;
    for (const image of [...doc.images]) {
      if (image.loading === "lazy") image.loading = "eager";
      if (image.getAttribute("decoding") === "async")
        image.setAttribute("decoding", "sync");
    }
  };
  force(document);
  for (const frame of [...document.querySelectorAll("iframe")])
    force(frame.contentDocument);
};

/**
 * Step 1. Everything that has to have arrived before a page is worth looking at.
 *
 * ONLY THE IMAGES THAT WILL BE IN THE PICTURE, and this is the second half of the lazy-loading lesson.
 * Requiring every image in the document sounds stricter and is actually just slower and less honest: a
 * collection page carries thirty-nine photographs, six of them above the fold, and waiting for the other
 * thirty-three — which no viewport-height capture can ever show — took forty-five seconds and then timed out.
 * What has to have loaded is what the shutter will see, and `EAGER` above is what makes sure those are not
 * waiting for a scroll that never comes.
 */
const LOADED = () => {
  const inShot = (image) => {
    const box = image.getBoundingClientRect();
    return (
      box.width > 2 &&
      box.height > 2 &&
      box.bottom > 0 &&
      box.top < window.innerHeight &&
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
    /* A frame with no address of its own is not something to wait for. */
    if (!frame.src || frame.src === "about:blank") continue;
    /* Nor is one whose document cannot be read. A cross-origin embed reports `contentDocument: null`
       forever, and treating that as "not ready yet" is what made one page wait forty-five seconds and then
       give up on a page that had been finished the whole time. */
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

/** Step 2, the wait: nothing is still playing. */
/**
 * Step 2's test. `getAnimations()` covers CSS animations and transitions, which is everything the platform
 * knows about — and nothing about motion driven by `requestAnimationFrame`, which the freeze below cannot
 * stop either. So anything animating itself in JS has to say so, and the convention is `data-cursor-moving`
 * on the element while it moves. The teaching rail's pointer is the first of these (see `SlideCursor` in
 * a teaching animation that moved a drawn pointer with rAF) and was captured mid-walk before this existed.
 *
 * `data-rail-busy` is the second and answers a harder version of the same problem: a page whose beats are
 * scheduled with `setTimeout` has LULLS in which nothing is animating and more motion is queued. Waiting for
 * quiet finds such a lull, and the next beat then fires between the two proof shots. A pending timer cannot be
 * observed, so the surface declares it — the component publishes the attribute until its last beat has
 * arrived. Any timeline-driven surface added to a canvas owes the same.
 */
const NOTHING_RUNNING = () =>
  document
    .getAnimations()
    /* A SCROLL-DRIVEN ANIMATION IS NEVER GOING TO STOP RUNNING, because what advances it is the scroll
       position and nothing here scrolls. Waiting for one is waiting for the whole animation budget to run
       out: `collection` and `set` each spent it on one reveal band, `piece` on two, and every one of those
       runs then reported the band as "paused mid-flight" — which was the truth, and was the blank space the
       owner asked about. The freeze finishes these instead, so they are not something to wait for. */
    .filter(
      (animation) =>
        !animation.timeline || animation.timeline instanceof DocumentTimeline,
    )
    .every((animation) => animation.playState !== "running") &&
  !document.querySelector("[data-cursor-moving]") &&
  !document.querySelector("[data-rail-busy]");

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
   * SCROLL-DRIVEN REVEALS ARE SHOWN REVEALED, and this is the reason a whole-page shot needs it.
   *
   * A band that fades up as it comes into view is an `animation-timeline: view()` animation with `both` fill:
   * before its range it holds its FROM state, which is `opacity: 0`. Whole-page captures never scroll —
   * `captureBeyondViewport` photographs past the fold with the window still at the top — so every band below
   * the first screen sits in that before-phase and photographs as a white hole. It cost two of the owner's
   * comments: 625px of nothing where a "More collections" band belongs, 928px where a "Meet the maker" band
   * belongs, both below the fold. Measured, not guessed: the reveal animation on a `ViewTimeline`, at
   * `currentTime: -79%`.
   *
   * WHY THIS IS DONE IN THE CASCADE AND NOT IN JAVASCRIPT, which is how it was written first and which
   * failed in a way worth recording. Re-attaching each animation to the document timeline and finishing it
   * DOES work — measured, opacity 0 to 1, in the same production build. It just does not survive: the shot
   * itself resizes the viewport to reach past the fold, styles recompute, and a CSS animation's timeline
   * comes from the cascade, so the browser rebuilds the animation and hands it back to its ViewTimeline. The
   * page then photographs exactly as blank as before, while every check in this script says it is fine.
   *
   * So the elements are STAMPED and a rule is written for them. `animation: none` drops the keyframes
   * entirely, which is what returns the element to its resting style; `opacity: 1` covers the other shape of
   * this pattern, where the resting style is the hidden one and an IntersectionObserver flips it. Only
   * elements that were actually carrying a scroll-driven animation are touched, so nothing else in the page
   * can be revealed by it.
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
  /**
   * NOTHING IS LEFT FOCUSED, IN ANY DOCUMENT. Two reasons, and the second is why this reaches into frames.
   *
   * The blinking text cursor is the one thing that moves with no animation attached to it. And a focus RING is
   * a state the design does not have at rest — owner: "it's important that you accidentally don't use the focus
   * or tab key because sometimes I see that screenshots make some elements focused and it's not supposed to be
   * like that in the UI." Nothing here types or presses Tab, so the focus is not the capture's doing: it is
   * `autoFocus` on a field the surface mounts, which is real behaviour and still not what a canvas frame should
   * show, because it is a picture of the resting design.
   *
   * IT USED TO BLUR ONLY THE TOP DOCUMENT, which missed the ones that matter: the share menu and the first-run
   * band both draw the previewed page in an iframe of their own, and such surfaces mount focused inputs
   * inside them. Same shape as `LOADED`, which walks frames for the same reason.
   */
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

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: viewport.w, height: viewport.h },
  deviceScaleFactor: 1,
  /* Motion is still allowed to run: the point is to let it FINISH, so what is captured is the design the
     animation was taking the page to. Reduced motion would capture a different product. */
});

/**
 * THE WARM PASS, and it is the difference between a reliable capture run and a lottery.
 *
 * `next dev` compiles a route the first time it is asked for, and that compile happens INSIDE the load budget
 * of whichever capture asked first. With several pages in flight the cost lands on different screens every
 * run, which is exactly what it looked like: 31 problems, then 22, with a different set of screens blank each
 * time and every failure sitting at the timeout while every success came in under 30s.
 *
 * Warming over HTTP does not work, and that was the first attempt: `curl` fetches the server-rendered HTML
 * and never executes the client bundle, so the client-side compile still happened during the real capture.
 * It has to be a browser.
 *
 * So every route is visited once here, with no waiting for stability and every failure ignored — the only job
 * is to make the server compile it. The real pass then measures a warm route. Skip with `--no-warm` when the
 * server is already warm and the extra minute is not worth it.
 *
 * NOT A REPLACEMENT FOR CAPTURING AGAINST A STILL TREE. Editing the project during a run still invalidates
 * everything, because the recompile lands mid-flight. This only removes the FIRST compile from the budget.
 */
if (!process.argv.includes("--no-warm")) {
  const warmUrls = [
    ...new Set(screens.map((screen) => `${base}${screen.route}`)),
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
      /* A route that will not warm is a route the real pass will report on properly. */
      process.stdout.write("!");
    }
  }
  await warmPage.close();
  process.stdout.write(" done\n");
}

const shots = [];
/** Screen ids whose picture was actually written this run. Filled at the one place a fresh shot is pushed. */
const rephotographed = new Set();
const failures = [];
const notes = [];

/**
 * SEVERAL PAGES AT ONCE. One at a time was four to six minutes for thirty-seven screens, nearly all of it spent
 * waiting — for a dev route to compile, for fonts, for photographs. Four in flight keeps the dev server busy
 * without starving it, and every screen still proves itself independently: the claims are read from its own
 * document and the two identical captures are its own. Nothing about the result depends on the order they run
 * in, which is what makes this safe to parallelise at all.
 */
const LANES = 4;

/** How long to let the dev server go idle before the second pass. See the pass itself for why. */
const SECOND_PASS_CALM_MS = 3_000;

/**
 * A SECOND PASS, ALONE, FOR THE SCREENS A FULL RUN COULD NOT PROVE.
 *
 * This is the hand work the loop was made of. Every full run against `next dev` leaves a handful of screens whose
 * claims did not appear — trap 19's shape: the route is compiling under four lanes of load, the pin lands after
 * the claim is read, and the text is plainly there when the same screen is captured on its own. The fix was
 * always the same two commands, and doing it by hand is most of what made a recapture feel like half an hour.
 *
 * So the run does it: whatever failed goes round once more, SEQUENTIALLY, after the lanes have drained and the
 * dev server is idle. That is the whole trick — not a longer timeout, which trap 19 records as having failed
 * twice, but the absence of contention.
 *
 * AND IT SAYS SO. A screen that needed a second pass prints `ok(2nd)` and is listed at the end, because a screen
 * that only ever passes alone is a fact worth seeing rather than a fact worth hiding. A retry that fails again is
 * a failure exactly as before: the previous picture is kept and the run reports it.
 */
const needsSecondPass = [];
const provedOnSecondPass = [];

async function captureOne(screen, secondPass = false) {
  const page = await context.newPage();
  /**
   * A SCREEN MAY ASK FOR ITS OWN VIEWPORT, and until now asking did nothing.
   *
   * `CanvasScreen.viewport` is documented in core/types.ts as "Renders this one screen at a different viewport,
   * e.g. a phone surface among desktop ones", and this file read it in exactly one place: the change-detection
   * stamp. So a declaration could set it, the hash would change, the screen would be recaptured — at the shared
   * viewport, unchanged. Two frames were declared at 1240 and 1340 tall on one canvas and both came back
   * at 900.
   *
   * Set on the page rather than by building a second browser context: one context, one set of cookies and one
   * cache, and a page's viewport is per-page anyway.
   */
  /* A screen's own override wins; otherwise its DEVICE's viewport, which the screens endpoint has already
     resolved (`deviceViewport`). A phone is photographed at a phone's size without any screen having to name it,
     which is the whole point of declaring a device rather than a viewport per frame. */
  const want =
    screen.viewport?.w && screen.viewport?.h
      ? screen.viewport
      : screen.deviceViewport?.w && screen.deviceViewport?.h
        ? screen.deviceViewport
        : null;
  if (want) await page.setViewportSize({ width: want.w, height: want.h });
  /**
   * AND EVERY MEASUREMENT BELOW IS AGAINST THIS SCREEN'S VIEWPORT, not the canvas's.
   *
   * `viewport` is the canvas-wide one. A phone at 390 by 844 judged against a desktop's 900 would be called a
   * short page, cropped to 900, and recorded as 900 tall — a frame 56px taller than the device it is meant to be.
   * One name, resolved once, used by the whole-page rule and by the shot's own height.
   */
  const shotViewport = want ?? viewport;
  const url = `${base}${screen.url}`;
  const started = Date.now();
  /* Two different waits can run out, and only one of them is a problem. A page that never finishes loading
     cannot be captured honestly; an animation that never ends is ordinary (a spinner, a marquee, a CSS
     animation with `duration: auto`) and gets pinned by the freeze a moment later. */
  let neverLoaded = false;
  let stillMoving = 0;

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    /* Twice, a beat apart: the second pass catches the images belonging to components that had not rendered
       when the first one ran. */
    await page.evaluate(EAGER).catch(() => undefined);
    await page.waitForTimeout(400);
    await page.evaluate(EAGER).catch(() => undefined);
    await page
      .waitForFunction(LOADED, false, { timeout: LOAD_TIMEOUT_MS })
      .catch(() => {
        neverLoaded = true;
      });
    await page.waitForTimeout(MIN_SETTLE_MS);

    /**
     * HOW TALL THE PICTURE IS, decided by the page rather than by a list kept somewhere. A window that scrolls
     * means the design is longer than one screen; a window that does not means the surface is a fixed-height
     * one and its own insides scroll.
     */
    /**
     * THE WINDOW IS NOT THE ONLY THING THAT SCROLLS, and assuming it was cost a whole canvas its lower halves.
     *
     * This measured `document.documentElement.scrollHeight` alone, and read a document that does not scroll as
     * "a fixed-height surface whose insides scroll" — a real shape, but the wrong conclusion. An app whose
     * routes hand scrolling to a content column (`<div class="h-full overflow-y-auto">`, which is a documented
     * convention in the project this was found in) has a document that NEVER scrolls, however long the design
     * is. Every frame came out exactly one viewport tall, every claim passed, and everything below the fold —
     * on this page, an entire activity table — was simply not in the picture. The reviewer spotted it
     * immediately: _"You clearly captured not a full page where you needed to show the full page screenshot."_
     *
     * So the height is the taller of the two: what the window scrolls, and what the page's own main scroller
     * has hidden inside it. Small scrollers are ignored on purpose — a 200px dropdown list is not the design
     * being longer than a screen — so only an element at least half the viewport tall counts.
     */
    const scrolls = await page.evaluate((vh) => {
      let inner = 0;
      for (const node of document.querySelectorAll("*")) {
        const overflow = getComputedStyle(node).overflowY;
        if (overflow !== "auto" && overflow !== "scroll") continue;
        if (node.clientHeight < vh * 0.5) continue;
        inner = Math.max(inner, node.scrollHeight - node.clientHeight);
      }
      return { doc: document.documentElement.scrollHeight, inner };
    }, shotViewport.h);
    const pageHeight = Math.max(scrolls.doc, shotViewport.h + scrolls.inner);
    const wholePage =
      CAPTURE_WHOLE_PAGES && pageHeight > shotViewport.h * LONG_PAGE_SLACK;
    const shotH = wholePage ? Math.min(pageHeight, MAX_PAGE_H) : shotViewport.h;
    /**
     * AN INNER SCROLLER IS OPENED BY GROWING THE WINDOW, not by editing its overflow. The column is sized to the
     * viewport, so a taller viewport is a taller column and the page lays itself out exactly as it would on a
     * tall monitor. Forcing `overflow: visible` instead reflows a flex column into something the design never
     * is — and a frame showing a state no user can see is the one thing this tool must not produce.
     */
    const grown =
      wholePage && scrolls.inner > 0 && scrolls.doc <= shotViewport.h;
    if (grown) {
      await page.setViewportSize({ width: shotViewport.w, height: shotH });
      await page.waitForTimeout(MIN_SETTLE_MS);
    }
    if (wholePage) {
      /* Everything below the fold is in this one now, so everything below the fold has to have arrived. */
      await page.evaluate(EAGER).catch(() => undefined);
      await page
        .waitForFunction(LOADED, true, { timeout: LOAD_TIMEOUT_MS })
        .catch(() => {
          neverLoaded = true;
        });
    }
    /* And once more before the shutter, because the wait above is what gave the page time to render the
       parts that own the rest of the photography. */
    await page.evaluate(EAGER).catch(() => undefined);
    await page
      .waitForFunction(LOADED, wholePage, { timeout: 15_000 })
      .catch(() => {
        neverLoaded = true;
      });

    /* Every document in the page, its own and every frame inside it: an animation in the page the
       share menu mounts is as capable of ruining a capture as one in the menu itself. */
    const inEveryFrame = async (fn) => {
      for (const frame of page.frames())
        await frame.evaluate(fn).catch(() => undefined);
    };
    await inEveryFrame(PAUSE_ENDLESS);
    for (const frame of page.frames()) {
      await frame
        .waitForFunction(NOTHING_RUNNING, null, {
          timeout: ANIMATION_TIMEOUT_MS,
        })
        .catch(async () => {
          /* Counted and reported rather than failed: the freeze below pins whatever is left exactly where it
             is, and the two identical captures then prove the picture is at least a still one. */
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

    /**
     * A FIELD THAT IS SUPPOSED TO BE FOCUSED GETS ITS FOCUS BACK, and this is an opt-in, one screen at a time.
     *
     * The freeze above blurs every document, on purpose: a frame is a picture of the resting design and an
     * accidental focus ring is a lie about it. But a flow's small states include the beat where someone is
     * TYPING, and that frame has nothing to show if the shutter blurs the field first — the owner, on a frame
     * labelled "Typing their address": *"this state that you're showing when the user is typing something, if
     * it says that they are typing their address, it actually should show that they're typing their address. It
     * does not right now."* It was the capture doing it, not the page.
     *
     * So a screen may declare `focus: "<selector>"`, the focus is put back AFTER the freeze, and the caret is
     * left at the end of whatever is in the field. The caret itself stays invisible (`caret-color` is
     * transparent in the freeze) because a blinking cursor is the one thing that could differ between the two
     * shots that prove the page is still; what shows is the design's own focused state.
     *
     * It is a CLAIM, so a selector that stops matching fails the capture rather than quietly photographing the
     * resting state again.
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
     * Step 4 — the claims, across every document in the page.
     *
     * THE POSITIVE CLAIMS GET A BOUNDED WAIT, and that is a settle wait rather than a weakened oracle.
     *
     * A claim used to be read once, the instant the page was judged settled. On a one-screen run that is fine;
     * across a whole canvas it is not, and the failure is a lie in the honest direction: once a full
     * 41-screen run failed `failures-nested`, `reauth-inline`, `fix-here-per-product` and `collection-picking`
     * for missing text those pages plainly contain, and all four passed in six seconds each when captured on
     * their own. The cause is that a pinned state is applied on HYDRATION, and under a full run's load the
     * settle signals can fire before hydration has finished, so the text is read from a page that is still the
     * server's version.
     *
     * A run whose verdicts depend on how many other screens were captured beside them is a run nobody can act
     * on, which is worse than a slow one. So the text is re-read until every positive claim is present or the
     * budget runs out. A claim that is never true still fails, and takes the budget to do it.
     */
    const readPage = async () => {
      const texts = [];
      for (const frame of page.frames()) {
        texts.push(
          await frame
            .evaluate(() => document.body?.innerText ?? "")
            .catch(() => ""),
        );
      }
      return texts.join("\n");
    };
    /**
     * FIRST, WAIT FOR THE PIN ITSELF. `CanvasStatePin` sets `data-canvas-pinned` on `<html>` in the effect that
     * reveals the page, which is the one signal that means "the store holds the pinned state AND React has
     * rendered with it". Everything else the capture waits on — network quiet, fonts, animations, two identical
     * screenshots — is satisfiable by the server's default rendering, so without this the claims can be read off
     * the wrong screen entirely. Only for pinned addresses: an ordinary route never sets it.
     */
    /**
     * AND IF IT NEVER ARRIVES, SAY THAT — do not let it masquerade as missing content.
     *
     * While the pin's style is up the body is `visibility: hidden`, and `innerText` of a hidden element is the
     * EMPTY STRING. So a capture that gave up waiting read no text at all and reported every claim as absent,
     * which reads exactly like a page that lost its content. Three rounds of chasing phantom content bugs came
     * out of that one silent `catch`. A timeout is now a claim of its own, and it names the real cause.
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
    }

    const wanted = pinned ? (screen.expect ?? []) : [];
    let page_text = await readPage();
    if (wanted.length > 0) {
      /* And still a bounded re-read, for text that arrives just after the pin: a lazy list, a deferred image's
         caption. The pin wait removes the race; this absorbs the tail. */
      const until = Date.now() + CLAIM_BUDGET_MS;
      while (
        Date.now() < until &&
        !wanted.every((claim) => page_text.includes(claim))
      ) {
        await page.waitForTimeout(250);
        page_text = await readPage();
      }
    }
    const claims = wanted.map((claim) => ({
      claim,
      met: page_text.includes(claim),
    }));
    /* One honest failure instead of a list of misleading ones. */
    if (!pinned)
      claims.push({
        claim: `the pinned state "${screen.state}" was applied within ${PIN_TIMEOUT_MS / 1000}s`,
        met: false,
      });
    /* An absence, written so the manifest reads as a sentence: the failure line prints the claim verbatim. */
    for (const absent of screen.expectMissing ?? []) {
      claims.push({
        claim: `nothing saying "${absent}"`,
        met: !page_text.includes(absent),
      });
    }
    if (focusClaim) claims.push(focusClaim);
    if (screen.expectSelector) {
      let met = false;
      for (const frame of page.frames()) {
        if (await frame.$(screen.expectSelector).catch(() => null)) met = true;
      }
      claims.push({ claim: screen.expectSelector, met });
    }

    /**
     * Step 4b — the photography actually arrived. An image element that is on screen and has no natural
     * size is a hole in the picture, and a hole in a picture of a jewelry store is the difference between
     * reviewing a design and reviewing an empty layout. Counted rather than assumed, in every document.
     */
    let media = { shown: 0, empty: 0 };
    for (const frame of page.frames()) {
      const counted = await frame
        .evaluate((all) => {
          let shown = 0;
          let empty = 0;
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
            if (image.naturalWidth === 0) empty += 1;
          }
          return { shown, empty };
        }, wholePage)
        .catch(() => ({ shown: 0, empty: 0 }));
      media = {
        shown: media.shown + counted.shown,
        empty: media.empty + counted.empty,
      };
    }

    /* Step 5 — identical twice over. */
    const cdp = await context.newCDPSession(page);
    const shoot = async () => {
      const { data } = await cdp.send("Page.captureScreenshot", {
        format: "webp",
        quality: QUALITY,
        /* Beyond the viewport only when the WINDOW is what scrolls, with an explicit clip so the height in the
           manifest and the height of the file cannot disagree. A page opened by growing the window is already
           entirely on screen, and asking for more than the viewport it now has photographs a band of empty
           background under it. */
        captureBeyondViewport: wholePage && !grown,
        /* THIS screen's width: a phone clipped to a desktop's 1440 would be photographed with 1050px of empty
           page beside it, and the manifest would record that as the frame's width. */
        clip: { x: 0, y: 0, width: shotViewport.w, height: shotH, scale: 1 },
      });
      return Buffer.from(data, "base64");
    };
    let previous = null;
    let image = null;
    let stable = false;
    let tries = 0;
    while (tries < STABLE_TRIES) {
      tries += 1;
      image = await shoot();
      if (previous && Buffer.compare(previous, image) === 0) {
        stable = true;
        break;
      }
      previous = image;
      await page.waitForTimeout(STABLE_GAP_MS);
    }

    const file = `${screen.id}.webp`;
    /**
     * A FAILED CAPTURE NEVER REPLACES A PICTURE THAT WORKED. This is the guard that has to exist, because
     * without it one command can quietly destroy a canvas: a run against a loaded dev server photographed
     * half-arrived pages, wrote them over 18 good frames, and turned "update three screens" into an hour of
     * repair — owner, mid-repair: *"didnt you have to update three screens? WHY 20 MINUTES?"*
     *
     * So a shot that misses a claim, comes out blank, gives up waiting or has holes in it is REPORTED and
     * DROPPED: the previous file and its manifest entry stay exactly as they were. The failure is still loud,
     * and nothing that was already proved is lost to it. A screen with no previous picture is written anyway,
     * because there is nothing to protect and an unfinished frame is better evidence than a missing one.
     */
    const rejected = [
      claims.some((one) => !one.met) && "a claim it does not prove",
      neverLoaded && "a page that never finished arriving",
      image.byteLength < MIN_BYTES && "a blank page",
      media.empty > 0 && "images that never loaded",
    ].filter(Boolean);
    const kept = shotOfPrevious.get(screen.id);
    if (rejected.length > 0 && kept && existsSync(path.join(SHOTS, kept.file))) {
      /* First time round, this is not a verdict yet: queue it for the quiet pass and say nothing. Reporting a
         failure that a second pass is about to disprove is how the run cries wolf. */
      if (!secondPass) {
        needsSecondPass.push(screen);
        shots.push(kept);
        console.log(
          `hold ${screen.id.padEnd(28)} ${rejected.join(", ")} — second pass queued`,
        );
        return;
      }
      shots.push(kept);
      failures.push(
        `${screen.id}: captured ${rejected.join(" and ")} on both passes, so the previous picture was KEPT — fix it, then capture this one screen`,
      );
      const missedHere = claims.filter((one) => !one.met);
      if (missedHere.length > 0)
        failures.push(
          `${screen.id}: the page does not have ${missedHere.map((one) => `"${one.claim}"`).join(", ")}`,
        );
      console.log(
        `KEPT ${screen.id.padEnd(28)} ${rejected.join(", ")} — previous picture left in place`,
      );
      return;
    }
    /* It passed. If that took two passes, the run has to say which screens those were. */
    if (secondPass) provedOnSecondPass.push(screen.id);

    writeFileSync(path.join(SHOTS, file), image);
    const hash = createHash("sha256").update(image).digest("hex").slice(0, 16);
    const shot = {
      screenId: screen.id,
      url: screen.url,
      file,
      /* THIS screen's width, not the canvas's. It was `viewport.w`, which is the desktop width, so the first
         phone frame ever captured recorded itself as 1440 wide and the canvas drew it as a desktop frame with
         the page squeezed into a corner of it. The picture itself was already clipped correctly; only the
         receipt was wrong, which is the worse of the two because the layout believes the receipt. */
      w: shotViewport.w,
      h: shotH,
      /* Said out loud in the manifest: this one is the whole page, that one is one screen of a fixed-height
         surface. The canvas draws each frame at the size it was actually captured at. */
      wholePage,
      bytes: image.byteLength,
      capturedAt: new Date().toISOString(),
      claims,
      stable,
      tries,
      hash,
      images: media,
      /* Animations that never ended and were pinned mid-flight. Zero is the normal answer. */
      pausedMidFlight: stillMoving,
      /* What this picture is OF, hashed: the declaration and every file the screen names. `--changed` and the
         oracle both read it, which is how "recapture only what moved" is a decision rather than a memory. */
      stamp: stampOf(screen),
    };
    shots.push(shot);
    /* WHICH SCREENS THIS RUN ACTUALLY RE-PHOTOGRAPHED. Only fresh writes land here — a kept picture from a failed
       attempt does not — and the comment pass below needs exactly that distinction. See `rephotographed`. */
    rephotographed.add(screen.id);

    const missed = claims.filter((one) => !one.met);
    if (missed.length > 0)
      failures.push(
        `${screen.id}: captured a page that does not have ${missed.map((one) => `"${one.claim}"`).join(", ")}`,
      );
    if (!stable)
      failures.push(
        `${screen.id}: never captured the same picture twice — still moving`,
      );
    if (image.byteLength < MIN_BYTES)
      failures.push(
        `${screen.id}: the picture is ${image.byteLength} bytes, which is a blank page`,
      );
    if (neverLoaded)
      failures.push(
        `${screen.id}: gave up waiting for the page to finish arriving`,
      );
    if (stillMoving > 0)
      notes.push(
        `${screen.id}: ${stillMoving} animation(s) never ended and were pinned where they were`,
      );
    if (media.empty > 0)
      failures.push(
        `${screen.id}: ${media.empty} of ${media.shown} images on screen never loaded — the picture has holes in it`,
      );

    console.log(
      `${missed.length === 0 && stable && !neverLoaded ? "ok  " : "FAIL"} ${screen.id.padEnd(28)} ` +
        `${String(Math.round(image.byteLength / 1024)).padStart(4)}kb ` +
        `${String(shotH).padStart(4)}px${wholePage ? "*" : " "} ` +
        `claims=${claims.length - missed.length}/${claims.length} stable=${stable}(${tries}) ` +
        `images=${media.shown - media.empty}/${media.shown} ` +
        `${Math.round((Date.now() - started) / 100) / 10}s`,
    );
  } catch (error) {
    failures.push(`${screen.id}: ${error.message}`);
    console.log(`FAIL ${screen.id.padEnd(28)} ${error.message}`);
  } finally {
    await page.close();
  }
}

/* A shared queue rather than a chunked split, so a slow page cannot hold four fast ones behind it. */
const queue = [...screens];
await Promise.all(
  Array.from({ length: Math.min(LANES, queue.length) }, async () => {
    for (let next = queue.shift(); next; next = queue.shift())
      await captureOne(next);
  }),
);

/**
 * THE QUIET PASS. One at a time, after the lanes have drained — the point is the absence of contention.
 *
 * AND AFTER A PAUSE, which is not superstition: measured, a second pass fired the instant the lanes emptied still
 * failed two of four screens that pass when captured alone. `next dev` is still finishing the compiles the lanes
 * asked for, so "the lanes have stopped sending requests" is not the same as "the server is idle". Three seconds
 * of nothing is the cheapest way to actually mean the second thing, and it is paid once per run, only when
 * something needs it.
 */
if (needsSecondPass.length > 0) {
  console.log(
    `\nsecond pass, one at a time: ${needsSecondPass.map((one) => one.id).join(", ")}`,
  );
  await new Promise((done) => setTimeout(done, SECOND_PASS_CALM_MS));
  for (const screen of needsSecondPass) await captureOne(screen, true);
}

await browser.close();

/**
 * The manifest is MERGED, not replaced, so `--only` and `--changed` recapture some screens without throwing
 * away the rest — and PRUNED, so a screen deleted from the declaration does not leave its picture and its
 * entry behind for the checker to grumble about forever. Both halves are printed.
 */
const declaredIds = new Set(declared.map((screen) => screen.id));
const orphans = (previous.shots ?? []).filter(
  (shot) => !declaredIds.has(shot.screenId),
);
for (const shot of orphans) {
  const file = path.join(SHOTS, shot.file);
  if (existsSync(file)) rmSync(file);
}
const merged = [
  ...(previous.shots ?? []).filter(
    (shot) =>
      declaredIds.has(shot.screenId) &&
      !shots.some((fresh) => fresh.screenId === shot.screenId),
  ),
  ...shots,
];
/**
 * ONE ENTRY PER SCREEN, LAST WRITE WINS. The second pass pushes a fresh shot for a screen whose kept picture is
 * already in this list, so without this the manifest would carry both and the canvas would draw whichever it read
 * first — which is the stale one.
 */
const byScreen = new Map();
for (const shot of merged) byScreen.set(shot.screenId, shot);
const final = [...byScreen.values()];
writeFileSync(
  manifestPath,
  `${JSON.stringify(
    {
      contract:
        "Captured by design-canvas/capture.mjs. Every shot records the claims that were true in the page when it was taken, and `stable` means two consecutive captures came out identical, which is the proof it is a settled design and not a page mid-load. Recapture with `node design-canvas/capture.mjs`.",
      capturedAt: new Date().toISOString(),
      viewport,
      shots: final.sort((a, b) => a.screenId.localeCompare(b.screenId)),
    },
    null,
    2,
  )}\n`,
  "utf8",
);

/* A comment points at a rectangle on a picture. If that picture has been taken again, what is under the
   rectangle may not be what was being complained about — so the comment is flagged rather than trusted. */
if (existsSync(COMMENTS)) {
  const file = JSON.parse(readFileSync(COMMENTS, "utf8"));
  let flagged = 0;
  const comments = (file.comments ?? []).map((comment) => {
    /**
     * `byScreen`, NOT `shots.find(...)` — and this was a real bug, twice in one session.
     *
     * `shots` holds every attempt this run made, and a screen that needed a second pass is in it TWICE: the kept
     * picture from the failed attempt first, the fresh one after. `find` returns the first, whose hash is by
     * definition the hash the comment already recorded, so nothing was ever flagged and the reviewer's notes never
     * reached the review bar. Owner: _"there's again some issue with the comments on the canvas. I have like 11
     * comments... but it now marks only one comment out of eleven as ready to approve."_
     *
     * `byScreen` is the map the manifest itself is built from, twenty lines above, and it already resolves this the
     * right way: last write wins, so the fresh shot is the one that answers.
     */
    const shot = byScreen.get(comment.screenId);
    if (!shot) return comment;
    /**
     * A COMMENT WITH NO RECORDED HASH still gets flagged, PROVIDED its screen was really re-photographed.
     *
     * The old condition bailed out on `!comment.shotHash`, so every comment written before that field existed — and
     * every verdict, which the client does not stamp — was permanently exempt from going stale. Without a hash
     * there is nothing to compare, but `rephotographed` is a fact rather than a comparison: this run took a new
     * picture of that screen, so whatever the rectangle was drawn over is not necessarily there any more.
     *
     * Screens this run did NOT touch stay untouched, which is what keeps a `--changed` run from shoving answered
     * work back into the queue.
     */
    const changed = comment.shotHash
      ? comment.shotHash !== shot.hash
      : rephotographed.has(comment.screenId);
    if (!changed) return comment;
    flagged += 1;
    return { ...comment, stale: true };
  });
  if (flagged > 0) {
    writeFileSync(
      COMMENTS,
      `${JSON.stringify({ ...file, updatedAt: new Date().toISOString(), comments }, null, 2)}\n`,
      "utf8",
    );
    console.log(
      `\n${flagged} comment(s) marked stale: the screen under them was captured again`,
    );
  }
}

if (notes.length > 0) {
  console.log("\nnotes:");
  for (const note of notes) console.log(`  - ${note}`);
}
console.log(
  /* Distinct screens THIS run touched, not the size of the whole manifest: a `--only` run of two screens
     reported "33 of 2" once `final` existed, which is nonsense in both directions. */
  `\n${new Set(shots.map((shot) => shot.screenId)).size} of ${screens.length} screens captured into design-canvas/shots/` +
    (orphans.length > 0
      ? `\n${orphans.length} no longer declared and removed: ${orphans.map((shot) => shot.screenId).join(", ")}`
      : ""),
);
/* Said out loud: a screen that only passes when it is captured alone is a fact about the screen, not noise. */
if (provedOnSecondPass.length > 0)
  console.log(
    `${provedOnSecondPass.length} needed a second pass alone: ${provedOnSecondPass.join(", ")}`,
  );
if (failures.length > 0) {
  console.log(`\n${failures.length} PROBLEM(S):`);
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exit(1);
}
console.log("every capture proved its claims and came out identical twice");
