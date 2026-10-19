#!/usr/bin/env node
/**
 * design-canvas — A CANVAS THE TEAM CAN COMMENT ON, as one claude.ai page.
 *
 *   node design-canvas/review-build.mjs --canvas <slug> [--live <review.json read from the live page just now>]
 *
 * The canvas lives on one machine and its comments land in a local file, so nobody else can open it. This
 * turns a canvas's explorations into a single static page that the Artifact tool publishes: every direction frame
 * in its section, the switch to today's same state under each frame, pan and zoom, and comments people draw as a box
 * on a screen and save into the page itself (`review.json`, beside it). Read them back with review-comments.mjs.
 *
 * THE PAGE IS review/page.html, AND IT IS FILLED, NEVER REWRITTEN. That file is the approved share page
 * (the comment button white when off and blue with an X when on,
 * on by default; the zoom's percentage is the fit; a short banner at the bottom left saying which comment tool to
 * use; no drag hint over the canvas; no reference row of today's screens, because the switch already shows them).
 * An agent that hand-builds a share page drifts from it in a dozen places, each one a review comment to repeat.
 * So this script only fills the page's blanks: the canvas's title, the slug, the page owner's name and the data.
 *
 * WHAT IT READS. The declaration (`project/flows.ts`, bundled the way dump-screens.mjs bundles it) and the captures
 * (`shots/<slug>/manifest.json`), after the canvas's out-of-date frames are captured against the dev server (`refreshCanvas` in
 * recapture.mjs): a share never shows an older picture than the code. A frame on the page that cannot be refreshed stops the
 * build. Nothing else is written to the canvas.
 * Optional share settings in `review/<slug>.json`:
 *   { "owner": "the design lead",                         // "Ask <owner> for editor access"; default "the owner"
 *     "include": ["<exploration id>", ...],                // the sections shown, in order; default every one
 *     "sections": { "<exploration id>": { "title": "...", "sub": "..." } },  // default: surface, then title
 *     "url": "https://..." }                               // the published page, recorded after the first publish
 *
 * SECTION LINKS. Each heading carries a button that copies `<url>#<anchor>`; opening that link fits the section. The page
 * runs in a sandboxed frame and cannot read its own address, so the address is the recorded `url`, baked in here. Until a
 * `url` is recorded the buttons are left out, and the build says so.
 *
 * WHAT IT WRITES, all under `review/<slug>/` (gitignored): `index.html`, `shots/<screen>.webp`, `review.json` (created
 * empty once; after that only ever replaced by a copy read off the live page, because it holds the team's comments),
 * `snapshots/` (every distinct copy of the team's comments this project has seen), and `publish.json`, the exact
 * Artifact call.
 *
 * THE LIVE PAGE FIRST. Publishing is where the team's comments are put at risk: a first publish of a re-made page
 * carries `review.json`, and a page that was deleted or overwritten has no other copy. So before a publish the flow
 * reads the live page's review.json (Artifact `read` with `path: "review.json"`), saves it to a file, and builds with
 * `--live <that file>`. The build then keeps it as a snapshot, says so when it differs from the last one the project
 * held (comments added, removed or edited elsewhere), and makes it the working `review.json`. Without `--live`, a
 * page that is already published (`url` in review/<slug>.json) gets a warning, never a silent build.
 *
 * DELETE WITH: the design-canvas/ folder.
 */
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { declarationFor, importCore, loadDeclarations } from "./declarations.mjs";
import { newestSnapshot, takeLive } from "./review-store.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argOf = (name) => {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : undefined;
};
const fail = (message) => {
  console.error(`review-build: ${message}`);
  process.exit(1);
};

const slug = argOf("canvas");
if (!slug || !/^[a-z0-9-]+$/.test(slug)) fail("name the canvas: --canvas <slug>");

/* ---- the declaration, read through the one loader every tool uses (declarations.mjs): variants already expanded, so a share
   page of a canvas that declares them has a frame, and a capture, for each. */
let loaded;
try {
  loaded = await loadDeclarations(HERE);
} catch (error) {
  fail(`could not read the declaration: ${String(error?.message ?? error).split("\n")[0]}`);
}
const picked = declarationFor(loaded, slug);
if (picked.error) fail(picked.error);
const declaration = picked.declaration;
const settingsPath = path.join(HERE, "review", `${slug}.json`);
const settings = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, "utf8")) : {};
/* `include` in the share settings names the sections the page shows, in that order; without it, every exploration. */
const include = settings.include;
const declared = declaration.explorations ?? [];
const explorations = Array.isArray(include)
  ? include.map((id) => declared.find((one) => one.id === id) ?? fail(`share settings include "${id}", which the canvas does not declare`))
  : declared;
if (explorations.length === 0) fail(`"${slug}" declares no explorations: the shared page shows explorations only`);

/* ---- refreshed first: a share shows what the code draws now, so this canvas's out-of-date frames are captured before the
   pictures are read, open or not (`refreshCanvas`). The capture's output goes to the recapture log. */
const { logFile, refreshCanvas } = await import("./recapture.mjs");
const toLog = (line) => {
  if (line) appendFileSync(logFile(HERE), `[${new Date().toISOString()}] review-build: ${line}\n`);
};
mkdirSync(path.dirname(logFile(HERE)), { recursive: true });
const { left: stillStale, refreshed } = await refreshCanvas(HERE, slug, toLog);
if (refreshed > 0) console.log(`review-build: ${refreshed} out-of-date frame(s) of "${slug}" captured first`);

/* ---- the captures */
const shotDir = path.join(HERE, "shots", slug);
const manifestPath = path.join(shotDir, "manifest.json");
if (!existsSync(manifestPath)) fail(`no captures for "${slug}" yet: capture the canvas first`);
const shots = new Map(JSON.parse(readFileSync(manifestPath, "utf8")).shots.map((shot) => [shot.screenId, shot]));

/* ---- the page's data: the same shape the approved page was built on */
const permanent = new Map(declaration.flows.flatMap((flow) => flow.screens).map((screen) => [screen.id, screen]));
const uncaptured = [];
const sections = explorations.map((one) => {
  const own = settings.sections?.[one.id] ?? {};
  const frames = one.screens.flatMap((screen) => {
    const shot = shots.get(screen.id);
    if (!shot) {
      uncaptured.push(screen.id);
      return [];
    }
    /* Its row, as the canvas lays it: a frame hanging `under` another sits in that frame's row (one level, the
       skill's rule), a frame hanging under the section's Today frame gets a row of its own before the options. */
    const rowOf = (it) => {
      const up = it.under && one.screens.find((other) => other.id === it.under);
      return up ? rowOf(up) : it.suggests ? `today:${one.id}` : it.id;
    };
    const lead = rowOf(screen);
    return [{ id: screen.id, label: screen.label, note: screen.note ?? "", w: shot.w, h: shot.h, today: screen.redesigns || null, row: lead }];
  });
  return { id: one.id, title: own.title ?? one.surface, sub: own.sub ?? one.title, frames };
});
/* Each section's anchor is the one its exploration has on the canvas, so one link names one section in both places. */
const anchorsModule = await importCore("anchors.ts");
if (!anchorsModule) fail("core/anchors.ts is missing: reinstall the skill");
const canvasAnchors = anchorsModule.canvasSectionAnchors(declaration);
sections.forEach((section) => {
  section.anchor = canvasAnchors.find((one) => one.view === "explore" && one.group === `explore-${section.id}`)?.anchor ?? null;
});
const pageUrl = typeof settings.url === "string" && settings.url ? settings.url.split("#")[0] : null;
if (uncaptured.length > 0) fail(`${uncaptured.length} frame(s) have no capture, recapture first: ${uncaptured.join(", ")}`);
const today = {};
for (const frame of sections.flatMap((section) => section.frames)) {
  const screen = frame.today ? permanent.get(frame.today) : null;
  const shot = screen ? shots.get(screen.id) : null;
  /* No picture of today's screen: the frame draws no switch rather than a broken one. */
  if (screen && shot) today[screen.id] = { label: screen.label, w: shot.w, h: shot.h };
}
{
  const shown = new Set([...sections.flatMap((section) => section.frames.map((frame) => frame.id)), ...Object.keys(today)]);
  const stale = stillStale.filter((id) => shown.has(id));
  if (stale.length > 0)
    fail(`${stale.length} frame(s) on the page are out of date and could not be captured first (${stale.join(", ")}): start the dev server at the settings' appUrl and build again; the reason is in design-canvas/rounds/recapture-log.txt`);
  if (stillStale.length > 0) console.log(`review-build: ${stillStale.length} other frame(s) of "${slug}" are still out of date; none of them is on the page`);
}

/* ---- the page */
const escape = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const template = readFileSync(path.join(HERE, "review", "page.html"), "utf8");
const blanks = ["__TITLE__", "__CANVAS_TITLE__", "__SLUG__", "__OWNER__", "__CANVAS_DATA__"];
const missing = blanks.filter((blank) => !template.includes(blank));
if (missing.length > 0) fail(`review/page.html lost its blank(s) ${missing.join(", ")}: reinstall the skill`);
const title = declaration.title ?? slug;
const page = template
  .replace("__TITLE__", escape(`${title} Redesign Review`))
  .replace("__CANVAS_TITLE__", escape(title))
  .replaceAll("__SLUG__", slug)
  .replaceAll("__OWNER__", escape(settings.owner ?? "the owner"))
  .replace("__CANVAS_DATA__", () => JSON.stringify({ sections, today, url: pageUrl }).replace(/<\//g, "<\\/"));

const out = path.join(HERE, "review", slug);
mkdirSync(path.join(out, "shots"), { recursive: true });
writeFileSync(path.join(out, "index.html"), page);

/* ---- the team's comments, from the live page first */
const relativeTo = path.dirname(HERE);
const liveArg = argOf("live");
if (liveArg) {
  if (!existsSync(liveArg)) fail(`--live names ${liveArg}, which does not exist: read review.json off the live page (Artifact action read, path review.json) and pass the file it was saved to`);
  const liveText = readFileSync(liveArg, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(liveText);
  } catch {
    fail(`${liveArg} is not valid JSON`);
  }
  if (!parsed || !Array.isArray(parsed.comments)) fail(`${liveArg} holds no comments list`);
  if (path.resolve(liveArg) === path.resolve(out, "review.json"))
    console.error(`review-build: WARNING --live is the project's own copy (${path.relative(relativeTo, liveArg)}), not the live page: it proves nothing about what the team added`);
  takeLive({ who: "review-build", outDir: out, liveText, source: "live-at-build", relativeTo });
} else if (typeof settings.url === "string" && settings.url) {
  console.error(
    `review-build: WARNING this page is already published (${settings.url}) and its live review.json was NOT read first. ` +
      `Read it now (Artifact action read, path review.json), save it to a file, and build again with --live <that file>. ` +
      `Until then nothing here knows what the team added since the last snapshot, and a publish built on an older read drops a teammate's note or is refused.`,
  );
} else {
  const newest = newestSnapshot(out);
  if (newest)
    console.log(`review-build: no live page recorded for "${slug}" (no url in review/${slug}.json): a first publish will carry the newest snapshot, ${path.relative(relativeTo, newest)}`);
}
const used = [...new Set([...sections.flatMap((section) => section.frames.map((frame) => frame.id)), ...Object.keys(today)])];
for (const id of used) copyFileSync(path.join(shotDir, shots.get(id).file), path.join(out, "shots", `${id}.webp`));
const fresh = !existsSync(path.join(out, "review.json"));
if (fresh) writeFileSync(path.join(out, "review.json"), '{\n  "comments": []\n}\n');

const pictures = Object.fromEntries(used.sort().map((id) => [`shots/${id}.webp`, `shots/${id}.webp`]));
writeFileSync(
  path.join(out, "publish.json"),
  `${JSON.stringify(
    {
      file_path: path.join(out, "index.html"),
      root: out,
      capabilities: { artifact: {}, user: { scopes: ["profile"] } },
      /* The first publish carries the working review file: empty the first time, afterwards the newest copy of the
         team's comments the project holds, so a page that was deleted comes back with them. An update leaves it out, or
         a stale file replaces what the team wrote since. */
      first: { files: { "review.json": "review.json", ...pictures } },
      update: { files: pictures },
    },
    null,
    2,
  )}\n`,
);
const frames = sections.reduce((sum, section) => sum + section.frames.length, 0);
if (!pageUrl) console.log(`review-build: no section links yet: record the page's url in review/${slug}.json after the first publish and build again`);
console.log(
  `built ${path.relative(path.dirname(HERE), out)}: ${sections.length} sections, ${frames} frames, ` +
    `${Object.keys(today).length} of today's screens behind the switch, ${used.length} pictures` +
    (liveArg ? ", review.json taken from the live page" : fresh ? ", an empty review.json" : ", review.json kept as it was"),
);
