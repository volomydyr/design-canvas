#!/usr/bin/env node
/**
 * design-canvas — the boundary check. Run it before capturing anything.
 *
 *   node <skill>/scripts/check-install.mjs [--target <repo root>]
 *
 * `check-canvas.mjs` proves the canvas WORKS. This proves it is still the same canvas, and that the seams
 * it needs outside its own folder are actually there. Four claims:
 *
 *   1. Every file in design-canvas/core/ is byte for byte what the skill shipped. The canvas's design is
 *      finished and travels as-is; a core file edited in a target project is the failure this whole
 *      arrangement exists to prevent, and it is silent otherwise.
 *   2. Nothing in core/ imports from the project. The core is a viewer: react, react-dom, next, lucide-react, node
 *      builtins and its own relative siblings, and nothing else. One import of a host component is how a
 *      generic folder stops being portable.
 *   3. design-canvas/project/ holds only the three adapter files. Anything else there is core work in the
 *      wrong place, or a screen being reimplemented instead of viewed.
 *   4. The seams exist: the three route stubs, the Tailwind glob, the gitignore lines.
 *
 * A failure here is a build error, not a note.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function argOf(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
const target = path.resolve(argOf("target") ?? process.cwd());
const CANVAS = path.join(target, "design-canvas");

const failures = [];
const notes = [];

if (!existsSync(CANVAS)) {
  console.error(`No design-canvas/ in ${target}. Run install-canvas.mjs first.`);
  process.exit(1);
}

/* ------------------------------------------------- 1. the core is what was shipped */

/** Same recursive walk the installer uses: `core/__tests__/` means a flat listing is not enough. */
function coreFiles(dir, prefix = "") {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory())
      out.push(...coreFiles(path.join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out;
}

const shipped = coreFiles(path.join(SKILL, "core"));
for (const file of shipped) {
  const here = path.join(CANVAS, "core", file);
  if (!existsSync(here)) {
    /* The core's own test is installed only into a project that has vitest — see the installer. */
    if (file.startsWith("__tests__/")) continue;
    failures.push(`core/${file} is missing — rerun install-canvas.mjs`);
    continue;
  }
  const mine = createHash("sha256")
    .update(readFileSync(path.join(SKILL, "core", file)))
    .digest("hex");
  const theirs = createHash("sha256").update(readFileSync(here)).digest("hex");
  if (mine !== theirs) {
    failures.push(
      `core/${file} has been edited in this project. The canvas has ONE appearance everywhere it is ` +
        `installed; put project-specific work in design-canvas/project/ and restore this file with ` +
        `install-canvas.mjs. If the change is a real improvement, make it in the skill so every ` +
        `project gets it.`,
    );
  }
}
/**
 * NOT INSTALLED YET IS AN ANSWER, NOT A CRASH — and this is the first thing a new user hits.
 *
 * Every check below assumes `design-canvas/core/` exists. Run against a project that has not installed the canvas
 * (or against the wrong directory, which is the same mistake with a different cause) and the walk threw a raw
 * `ENOENT` with a Node stack trace: the one moment where a clear sentence matters most produced the least useful
 * output this tool can emit. It says what is missing and what to run instead.
 */
if (!existsSync(path.join(CANVAS, "core"))) {
  console.error(
    `no design-canvas/core in ${target}\n\n` +
      `Either this project has no canvas installed — run the skill's install-canvas.mjs against it — or this is ` +
      `the wrong directory. Point the check at the project root with --target.`,
  );
  process.exit(1);
}

const extra = coreFiles(path.join(CANVAS, "core")).filter(
  (file) => !shipped.includes(file) && file !== ".checksums.json",
);
for (const file of extra)
  failures.push(
    `core/${file} is not part of the shipped core — the core is generic, project/ is not`,
  );

/* ------------------------------------------- 2. the core imports nothing from the project */

const ALLOWED = [
  /^\.\//,
  /^\.\.\//,
  /^react$/,
  /^react\//,
  /* `react-dom` is React, not the project. The canvas needs `createPortal` for exactly one thing: `position:
     fixed` does not escape an ancestor with a `transform`, and the canvas world is one big transform, so a
     hover panel rendered in place gets positioned and SCALED by the zoom it exists to be immune to. Any host
     that can render this core already has react-dom — it is what puts the canvas on screen. */
  /^react-dom$/,
  /^react-dom\//,
  /^next\//,
  /^lucide-react$/,
  /^node:/,
  /* The one shipped test, which the installer only lands where it will run. */
  /^vitest$/,
];
for (const file of shipped.filter((name) => /\.tsx?$/.test(name))) {
  /* A file the loop above already reported as missing: read it and this script dies with an ENOENT stack
     instead of printing the failure it had already found. Pointing this at a canvas that predates the skill
     is exactly when that happens, and a checker that crashes reads as a broken checker. */
  if (!existsSync(path.join(CANVAS, "core", file))) continue;
  const source = readFileSync(path.join(CANVAS, "core", file), "utf8");
  for (const match of source.matchAll(/^\s*import[^"']*["']([^"']+)["']/gm)) {
    const spec = match[1];
    if (!ALLOWED.some((allowed) => allowed.test(spec)))
      failures.push(
        `core/${file} imports "${spec}" — the core may not reach into the project`,
      );
  }
}

/* ------------------------------------------------------ 3. the adapter is three files */

const ADAPTER = ["flows.ts", "states.ts", "canvas-state-pin.tsx"];
const projectDir = path.join(CANVAS, "project");
if (!existsSync(path.join(projectDir, "flows.ts")))
  failures.push("project/flows.ts is missing — it is the only place screens are named");
else if (
  !/export const CANVASES\b/.test(
    readFileSync(path.join(projectDir, "flows.ts"), "utf8"),
  )
)
  /* The route stubs are SHIPPED files and import the registry by name. A project that calls it something else
     gets `Module has no exported member 'CANVASES'` from the type checker, which names the symptom rather than
     the rule — so the rule is stated here. Installing over a canvas that predates named canvases is exactly
     when it happens, and the fix is two lines: keep the declaration, add
     `export const CANVASES = { <slug>: CANVAS }`. */
  failures.push(
    "project/flows.ts must `export const CANVASES` — the route stubs import that name, and they are shipped",
  );
for (const file of existsSync(projectDir) ? readdirSync(projectDir) : []) {
  /* A canvas may live in its own file under project/canvases/ when a declaration is large; flows.ts is still
     the one place a canvas is NAMED, which is the rule that matters. */
  if (!ADAPTER.includes(file) && file !== "canvases")
    failures.push(
      `project/${file} is not one of the three adapter files (${ADAPTER.join(", ")}). The adapter is ` +
        `the declaration, the state pinning and the pin component — nothing else belongs here.`,
    );
}
const flows = existsSync(path.join(projectDir, "flows.ts"))
  ? readFileSync(path.join(projectDir, "flows.ts"), "utf8")
  : "";
if (flows.includes("REPLACE ME") || flows.includes('id: "example"'))
  failures.push(
    "project/flows.ts is still the starter. Declare the real screens, from the code rather than from memory.",
  );

/* --------------------------------------------------------------- 4. the seams outside */

const STUBS = [
  "app/design-canvas/page.tsx",
  /* One canvas per URL segment. Without this the index lists canvases that 404 when opened. */
  "app/design-canvas/[canvas]/page.tsx",
  "app/api/design-canvas/comments/route.ts",
  "app/api/design-canvas/shots/route.ts",
];
for (const stub of STUBS)
  if (!existsSync(path.join(target, stub))) failures.push(`${stub} is missing`);

/**
 * THE CAPTURE'S BUILD FOLDER, which fails SILENTLY when it is missing — the worst kind.
 *
 * `capture-run.mjs` captures against a production build, because `next dev` compiles each route inside the
 * capture's own load budget and makes a run a lottery. It sets `CANVAS_BUILD_DIR` so the build lands somewhere
 * harmless. If the project's next config does not read that variable, the variable does nothing: the build
 * overwrites `.next` and takes down the dev server the reviewer is looking at, and the only symptom is that
 * their canvas stopped loading in the middle of a review.
 *
 * Only checked for Next projects, and only as a WARNING for a project that has no capture-run yet — the canvas
 * itself works fine without it; it is the fast capture that does not.
 */
const nextConfigs = [
  "next.config.mjs",
  "next.config.js",
  "next.config.ts",
  "next.config.cjs",
].map((name) => path.join(target, name));
const nextConfig = nextConfigs.find((file) => existsSync(file));
if (nextConfig && existsSync(path.join(target, "design-canvas", "capture-run.mjs"))) {
  if (!readFileSync(nextConfig, "utf8").includes("CANVAS_BUILD_DIR"))
    failures.push(
      `${path.basename(nextConfig)} does not read CANVAS_BUILD_DIR — add ` +
        `\`distDir: process.env.CANVAS_BUILD_DIR || ".next"\`, or capture-run.mjs will build over .next and ` +
        `stop the dev server mid-review`,
    );
}

/**
 * TAILWIND'S CONTENT GLOBS, and this one is worth failing loudly over. A folder outside them has every
 * class it uses that the app does not already use silently dropped — the canvas renders as a wireframe of
 * itself, and every styling fix afterwards is a no-op. On the build this came from it cost several rounds
 * before anyone suspected the build rather than the CSS.
 */
const configs = [
  "tailwind.config.ts",
  "tailwind.config.js",
  "tailwind.config.mjs",
  "tailwind.config.cjs",
].map((name) => path.join(target, name));
const config = configs.find((file) => existsSync(file));
if (config) {
  if (!readFileSync(config, "utf8").includes("design-canvas"))
    failures.push(
      `${path.basename(config)} does not list design-canvas in its content globs — every class the canvas ` +
        `uses that the app does not already use will be silently dropped`,
    );
} else {
  /* Tailwind v4 has no JS config: the globs are @source directives in the CSS entry. */
  const css = [];
  const walk = (dir, depth) => {
    if (depth > 3 || !existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, depth + 1);
      else if (entry.endsWith(".css")) css.push(full);
    }
  };
  walk(path.join(target, "app"), 0);
  walk(path.join(target, "src"), 0);
  walk(path.join(target, "styles"), 0);
  const sourced = css.some((file) =>
    readFileSync(file, "utf8").includes("design-canvas"),
  );
  if (!sourced)
    failures.push(
      'no Tailwind config names design-canvas, and no CSS entry has `@source "../design-canvas";` — without ' +
        "one of the two, the canvas renders unstyled",
    );
}


/** The patterns a .gitignore actually declares: comment lines mention paths without ignoring them, and a
 *  substring match on the whole file reads a note ABOUT `design-canvas/shots/` as a rule ignoring it. */
function ignorePatterns(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}
const gitignore = ignorePatterns(
  existsSync(path.join(target, ".gitignore"))
    ? readFileSync(path.join(target, ".gitignore"), "utf8")
    : "",
);
/* The comments only. `design-canvas/shots/` is committed on purpose — see the installer's own note — so a
   project that ignores it is making a choice rather than making a mistake, and this says so instead of
   failing. */
for (const line of ["design-canvas/comments/", "design-canvas/comments.json"])
  if (!gitignore.includes(line))
    failures.push(`.gitignore does not ignore ${line}`);
if (gitignore.includes("design-canvas/shots/"))
  notes.push(
    "design-canvas/shots/ is gitignored, so a fresh clone opens the canvas on empty frames until someone " +
      "captures. Deliberate for a private review; wrong if the canvas is being handed to a team.",
  );

/* The README's project half. This is the one place local knowledge lives — the ports, the seams cut into
   this repo, the known gaps — and an install can pass every other check here while recording none of it,
   which is exactly what happened to the first project handed its canvas: the shipped half told its
   developers port 3000 and the real one was 3040. A note, not a failure: an install can be minutes old. */
{
  const marker = "<!-- design-canvas:project";
  const readmePath = path.join(target, "design-canvas", "README.md");
  const readme = existsSync(readmePath)
    ? readFileSync(readmePath, "utf8")
    : "";
  const at = readme.indexOf(marker);
  if (at < 0)
    notes.push(
      "design-canvas/README.md has no project marker, so a re-install will overwrite it whole — re-run " +
        "install-canvas.mjs to get the marker, then write this project's half under it",
    );
  else if (readme.slice(at).includes("Nothing written here yet"))
    notes.push(
      "design-canvas/README.md still carries the placeholder project half: the ports this canvas runs on, " +
        "the seams this install added and the gaps it has are recorded nowhere",
    );
}

/* The two seams a script cannot see from outside: whether /design-canvas escapes the app shell, and
   whether the state pin is mounted. check-canvas.mjs asserts the first from the DOM; the second shows up
   as a frame that renders the default while claiming a state. */
if (!flows.includes("state:"))
  notes.push(
    "no screen declares a state — nothing to pin, and project/states.ts can be deleted",
  );

/* --------------------------------------------------------------------------- report */

if (notes.length > 0) {
  console.log("notes:");
  for (const note of notes) console.log(`  - ${note}`);
  console.log("");
}
if (failures.length > 0) {
  console.log(`${failures.length} FAILURE(S):`);
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exit(1);
}
console.log(
  `the core is byte for byte as shipped (${shipped.length} files), imports nothing from the project, ` +
    `and every seam is in place`,
);
