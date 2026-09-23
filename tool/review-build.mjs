#!/usr/bin/env node
/**
 * design-canvas — A CANVAS THE TEAM CAN COMMENT ON, as one claude.ai page.
 *
 *   node design-canvas/review-build.mjs --canvas <slug>
 *
 * The canvas lives on the owner's machine and its comments land in a local file, so nobody else can open it. This
 * turns a canvas's explorations into a single static page that the Artifact tool publishes: every direction frame
 * in its section, the switch to today's same state under each frame, pan and zoom, and comments people draw as a box
 * on a screen and save into the page itself (`review.json`, beside it). Read them back with review-comments.mjs.
 *
 * THE PAGE IS review/page.html, AND IT IS FILLED, NEVER REWRITTEN. That file is the page the owner approved after
 * five rounds of feedback on the first shared canvas (the comment button white when off and blue with an X when on,
 * on by default; the zoom's percentage is the fit; a short banner at the bottom left saying which comment tool to
 * use; no drag hint over the canvas; no reference row of today's screens, because the switch already shows them).
 * An agent that hand-builds a share page drifts from it in a dozen places, and the owner then explains each one
 * again. So this script only fills the page's blanks: the canvas's title, the slug, the owner's name and the data.
 *
 * WHAT IT READS. The declaration (`project/flows.ts`, bundled the way dump-screens.mjs bundles it) and the captures
 * (`shots/<slug>/manifest.json`). Both are read, never written: sharing a canvas changes nothing about the canvas.
 * Optional share settings in `review/<slug>.json`:
 *   { "owner": "Alex",                                    // "Ask <owner> for editor access"; default "the owner"
 *     "sections": { "<exploration id>": { "title": "...", "sub": "..." } } }  // default: surface, then title
 *
 * WHAT IT WRITES, all under `review/<slug>/` (gitignored): `index.html`, `shots/<screen>.webp`, `review.json` (created
 * empty once, never overwritten, because it holds the team's comments), and `publish.json`, the exact Artifact call.
 *
 * DELETE WITH: the design-canvas/ folder.
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildSync } from "esbuild";

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

/* ---- the declaration, bundled exactly as dump-screens.mjs does it (types erase, per-canvas files fold in) */
const js = buildSync({
  entryPoints: [path.join(HERE, "project", "flows.ts")],
  bundle: true,
  format: "esm",
  target: "node18",
  platform: "neutral",
  write: false,
}).outputFiles[0].text;
const tmp = mkdtempSync(path.join(tmpdir(), "canvas-review-"));
writeFileSync(path.join(tmp, "flows.mjs"), js);
const mod = await import(`file://${path.join(tmp, "flows.mjs")}`);
rmSync(tmp, { recursive: true, force: true });
const registry = Object.values(mod).find(
  (value) => value && typeof value === "object" && !Array.isArray(value.flows) && Object.values(value).some((one) => one && Array.isArray(one.flows)),
);
const declaration = registry ? registry[slug] : Object.values(mod).find((value) => value && Array.isArray(value?.flows));
if (!declaration) fail(`no canvas called "${slug}"${registry ? `; this project has ${Object.keys(registry).join(", ")}` : ""}`);
const explorations = declaration.explorations ?? [];
if (explorations.length === 0) fail(`"${slug}" declares no explorations: the shared page shows explorations only`);

/* ---- the captures */
const shotDir = path.join(HERE, "shots", slug);
const manifestPath = path.join(shotDir, "manifest.json");
if (!existsSync(manifestPath)) fail(`no captures for "${slug}" yet: capture the canvas first`);
const shots = new Map(JSON.parse(readFileSync(manifestPath, "utf8")).shots.map((shot) => [shot.screenId, shot]));

const settingsPath = path.join(HERE, "review", `${slug}.json`);
const settings = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, "utf8")) : {};

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
    return [{ id: screen.id, label: screen.label, note: screen.note ?? "", w: shot.w, h: shot.h, today: screen.redesigns || null }];
  });
  return { id: one.id, title: own.title ?? one.surface, sub: own.sub ?? one.title, frames };
});
if (uncaptured.length > 0) fail(`${uncaptured.length} frame(s) have no capture, recapture first: ${uncaptured.join(", ")}`);
const today = {};
for (const frame of sections.flatMap((section) => section.frames)) {
  const screen = frame.today ? permanent.get(frame.today) : null;
  const shot = screen ? shots.get(screen.id) : null;
  /* No picture of today's screen: the frame says "No today's version to compare" rather than a broken switch. */
  if (screen && shot) today[screen.id] = { label: screen.label, w: shot.w, h: shot.h };
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
  .replace("__CANVAS_DATA__", () => JSON.stringify({ sections, today }).replace(/<\//g, "<\\/"));

const out = path.join(HERE, "review", slug);
mkdirSync(path.join(out, "shots"), { recursive: true });
writeFileSync(path.join(out, "index.html"), page);
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
      /* The first publish carries the empty review file; every later one leaves it out, or the team's comments go. */
      first: { files: { "review.json": "review.json", ...pictures } },
      update: { files: pictures },
    },
    null,
    2,
  )}\n`,
);
const frames = sections.reduce((sum, section) => sum + section.frames.length, 0);
console.log(
  `built ${path.relative(path.dirname(HERE), out)}: ${sections.length} sections, ${frames} frames, ` +
    `${Object.keys(today).length} of today's screens behind the switch, ${used.length} pictures` +
    (fresh ? ", an empty review.json" : ", review.json kept as it was"),
);
