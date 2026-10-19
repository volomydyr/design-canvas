#!/usr/bin/env node
/**
 * design-canvas — the boundary check. Run it before capturing anything.
 *
 *   node <skill>/scripts/check-install.mjs [--target <repo root>]
 *
 * `check-canvas.mjs` proves the canvas WORKS. This proves it is still the same canvas, and that the seams
 * it needs outside its own folder are actually there. Five claims:
 *
 *   1. Every file in design-canvas/core/ is byte for byte what the skill shipped. The canvas's design is
 *      finished and travels as-is; a core file edited in a target project is the failure this whole
 *      arrangement exists to prevent, and it is silent otherwise.
 *   2. Nothing in core/ imports from the project. The core is a viewer: react, react-dom, next, lucide-react, node
 *      builtins and its own relative siblings, and nothing else. One import of a host component is how a
 *      generic folder stops being portable.
 *   3. design-canvas/project/ holds only the adapter files. Anything else there is core work in the
 *      wrong place, or a screen being reimplemented instead of viewed.
 *   4. The seams exist: the route stubs, the canvas pages' stylesheet, and git ignoring the reviewer's comments and the saved
 *      session (asked of git, which answers for any source: a .gitignore, the repository's exclude list or a global file). A local
 *      canvas (the default, `canvasMode`) is kept out of git whole; a shared one is NOT ignored through a .gitignore where a teammate
 *      needs it (`SHARED` in ignore-rules.mjs), and what it has not committed yet is a note. The overlay is in place
 *      (`overlayProblems` in tool/overlay.mjs): its filter and hooks, every file with canvas lines under the filter, no canvas line
 *      unmarked in what would be committed or pushed, and no line waiting to be re-fitted.
 *   5. Every tool's `./x.mjs` imports are installed (static and dynamic, so the hook's are covered), and when THIS machine's
 *      answer for the project (kept outside the repo, `checks-answer.mjs`) is yes to the reuse checks, the hook entries are
 *      really in .claude/settings.local.json and git ignores that file. A new git worktree shares the answer but not the local
 *      file, which is exactly what this catches. With no answer or a no, nothing about the hook is checked.
 *
 * A failure here is a build error, not a note.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readAnswer } from "../tool/checks-answer.mjs";
import { overlayProblems } from "../tool/overlay.mjs";
import { appDir, askGit, canvasMode, canvasOnlyRootApp, localProblems, sharingProblems, uncommitted, uncommittedNote } from "./ignore-rules.mjs";
import { CANVAS_CSS, nextMajor, playwrightCommand, STALE_ROOT_APP, usesTailwind } from "./seams.mjs";

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

/** The files of a core folder, as the installer copies them: the core is one flat folder (its tests stay in the skill). */
const coreFiles = (dir) => readdirSync(dir, { withFileTypes: true }).filter((one) => one.isFile()).map((one) => one.name).sort();

const shipped = coreFiles(path.join(SKILL, "core"));
for (const file of shipped) {
  const here = path.join(CANVAS, "core", file);
  if (!existsSync(here)) {
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
  (file) => !shipped.includes(file),
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

/* system.tsx: the design system's component sets, the project's own like the declaration. */
const ADAPTER = ["flows.ts", "states.ts", "canvas-state-pin.tsx", "system.tsx"];
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
      `project/${file} is not one of the adapter files (${ADAPTER.join(", ")}). The adapter is ` +
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
  /* The design system's specimen page. Without it system-capture.mjs has nothing to photograph. */
  "app/design-canvas/system/[set]/page.tsx",
];
const APP = appDir(target);
for (const stub of STUBS.map((one) => one.replace(/^app\//, `${APP}/`)))
  if (!existsSync(path.join(target, stub))) failures.push(`${stub} is missing`);
if (canvasOnlyRootApp(target)) failures.push(STALE_ROOT_APP);
/* Route config re-exported from the core: Next 16 refuses it and covers every page of the app with an error overlay. */
for (const stub of ["api/design-canvas/comments/route.ts", "api/design-canvas/shots/route.ts"].map((one) => `${APP}/${one}`)) {
  const at = path.join(target, stub);
  if (!existsSync(at) || !/export\s*\{[^}]*\b(?:dynamic|runtime)\b[^}]*\}\s*from/.test(readFileSync(at, "utf8"))) continue;
  const text = `${stub} re-exports dynamic and runtime, which Next 16 refuses: write them in the file instead, as the shipped stub does (export const runtime = "nodejs"; export const dynamic = "force-dynamic";)`;
  (nextMajor(target) >= 16 ? failures : notes).push(text);
}

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
 * THE CANVAS PAGES' STYLES. The installer's page stubs import the prebuilt stylesheet, so the canvas is styled in every project. A
 * page without it is styled only when the project's Tailwind scans the canvas folder (an older install), and otherwise every class the
 * canvas uses that the app does not already use is silently dropped: the canvas renders as a wireframe of itself, and every styling
 * fix afterwards is a no-op, which reads as a CSS problem rather than a build one.
 */
const tailwindNamesCanvas = () => {
  const config = ["tailwind.config.ts", "tailwind.config.js", "tailwind.config.mjs", "tailwind.config.cjs"].map((name) => path.join(target, name)).find((file) => existsSync(file));
  if (config) return readFileSync(config, "utf8").includes("design-canvas");
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
  for (const dir of ["app", "src", "styles"]) walk(path.join(target, dir), 0);
  return css.some((file) => readFileSync(file, "utf8").includes("design-canvas"));
};
for (const stub of ["design-canvas/page.tsx", "design-canvas/[canvas]/page.tsx"].map((one) => `${APP}/${one}`)) {
  const at = path.join(target, stub);
  if (!existsSync(at) || readFileSync(at, "utf8").includes(CANVAS_CSS) || (usesTailwind(target) && tailwindNamesCanvas())) continue;
  failures.push(
    `${stub} does not import the canvas's stylesheet, so the canvas renders unstyled: add ` +
      `import "${path.relative(path.dirname(at), path.join(target, CANVAS_CSS))}"; as its first import`,
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
const SHOTS_NOTE =
  "design-canvas/shots/ is gitignored, so a fresh clone opens the canvas on empty frames until someone " +
  "captures. Deliberate for a private review; wrong if the canvas is being handed to a team.";
/* GIT IS ASKED WHETHER IT IGNORES EACH PATH, through whichever source (`git check-ignore`, see ignore-rules.mjs), and the
   `.gitignore` text is not read. A project that keeps canvas files local through its exclude list or a global file has them ignored
   and used to fail `.gitignore does not ignore ...` for paths git was in fact ignoring. Outside a git checkout there is nothing to
   ask, and the file's own lines are read as they always were. */
const asked = askGit(target);
const mode = canvasMode(target);
/* What must never be committed: the reviewer's comments, and the saved session, which holds live tokens. */
const REQUIRED = ["design-canvas/comments/", "design-canvas/comments.json", "design-canvas/auth-state.json"];
if (asked.git) {
  for (const rule of asked.rules.filter((one) => REQUIRED.includes(one.line)))
    if (!rule.ignored)
      failures.push(
        `git does not ignore ${rule.probe} (${rule.what}): add ${asked.prefix}${rule.line} to .gitignore, which install-canvas.mjs does, ` +
          `or to this repository's exclude list when the project keeps canvas files local`,
      );
  if (mode.mode === "local") {
    /* A local canvas: git takes none of it. */
    failures.push(...localProblems(asked));
  } else {
    /* A shared canvas: what a teammate needs is NOT ignored, so the canvas a clone opens is the one this checkout sees. */
    const sharing = sharingProblems(asked);
    failures.push(...sharing.failures);
    notes.push(...sharing.notes);
    const pending = uncommittedNote(uncommitted(target));
    if (pending) notes.push(pending);
  }
  /* The overlay, asked from inside the project: its filter, its hooks, and nothing unmarked on its way to a commit or a push. */
  const here = process.cwd();
  process.chdir(target);
  const overlay = overlayProblems();
  process.chdir(here);
  failures.push(...overlay.failures);
  notes.push(...overlay.notes);
} else {
  const gitignore = ignorePatterns(
    existsSync(path.join(target, ".gitignore"))
      ? readFileSync(path.join(target, ".gitignore"), "utf8")
      : "",
  );
  for (const line of REQUIRED)
    if (!gitignore.includes(line))
      failures.push(`.gitignore does not ignore ${line}`);
  if (gitignore.includes("design-canvas/shots/")) notes.push(SHOTS_NOTE);
}

/* The README's project half. This is the one place local knowledge lives — the ports, the seams cut into
   this repo, the known gaps — and an install can pass every other check here while recording none of it.
   A note, not a failure: an install can be minutes old. */
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

/* The design system's lines for agents, in the project's own agent file: without them no agent doing UI work ever
   hears of the lookup, which is the whole point of it. */
{
  const block = readFileSync(path.join(SKILL, "stubs", "agents-block.md"), "utf8").trim();
  const holder = ["CLAUDE.md", "AGENTS.md"].find((one) => existsSync(path.join(target, one)) && readFileSync(path.join(target, one), "utf8").includes("<!-- design-canvas:agents"));
  if (!holder)
    notes.push("neither CLAUDE.md nor AGENTS.md carries the design system lines for agents, so agents doing UI work never hear of the lookup: install-canvas.mjs writes them into either file, or prints them when the project has neither");
  else if (!readFileSync(path.join(target, holder), "utf8").includes(block))
    notes.push(`${holder} carries an old copy of the design system lines for agents: rerun install-canvas.mjs`);
}

/* The two seams a script cannot see from outside: whether /design-canvas escapes the app shell, and
   whether the state pin is mounted. check-canvas.mjs asserts the first from the DOM; the second shows up
   as a frame that renders the default while claiming a state. */
if (!flows.includes("state:"))
  notes.push(
    "no screen declares a state — nothing to pin, and project/states.ts can be deleted",
  );
/* A test run in the app must never see a pin: the starter's canvasPinsAllowed() says no under a test runner. */
{
  const states = path.join(projectDir, "states.ts");
  const text = existsSync(states) ? readFileSync(states, "utf8") : "";
  if (/function canvasPinsAllowed\b/.test(text) && !/VITEST|JEST_WORKER_ID/.test(text))
    notes.push(
      'project/states.ts lets pins through under a test runner: start canvasPinsAllowed() with `if (process.env.NODE_ENV === "test" || ' +
        'process.env.VITEST || process.env.JEST_WORKER_ID) return false;` as the shipped starter does',
    );
}

/**
 * EVERY TOOL'S IMPORTS ARE INSTALLED. The tools share modules (`steps.mjs`, `comment-integrity.mjs`, `browser-guards.mjs` and
 * the rest), and a project that reinstalled half of an upgrade has a capture that imports a file that is not there: the run
 * dies at import with a Node stack and no hint that the fix is one command. Read from the installed scripts' own
 * `import ... from "./x.mjs"` lines rather than from a list kept here, so a module the next upgrade adds is covered without
 * touching this file.
 */
{
  const installed = readdirSync(CANVAS).filter((name) => name.endsWith(".mjs"));
  for (const name of installed) {
    const text = readFileSync(path.join(CANVAS, name), "utf8");
    /* Static imports and exports, and `import("./x.mjs")`: the reuse-check hook loads its modules inside a try so that any
       failure lets the edit through, and a dynamic import is how that is written. */
    const imported = [
      ...text.matchAll(/^\s*(?:import|export)\s[^"']*["']\.\/([\w.-]+\.mjs)["']/gm),
      ...text.matchAll(/\bimport\(\s*["']\.\/([\w.-]+\.mjs)["']\s*\)/g),
    ];
    for (const match of imported) {
      if (!existsSync(path.join(CANVAS, match[1])))
        failures.push(`design-canvas/${name} imports ./${match[1]}, which is not installed — the upgrade is half done: rerun install-canvas.mjs`);
    }
  }
  /* The tools import Playwright from design-canvas/, and a project that has only `@playwright/test` (pnpm does not hoist) cannot. */
  const addPlaywright = playwrightCommand(target);
  if (addPlaywright) failures.push(`playwright does not load from design-canvas/, and every capture needs it: run ${addPlaywright}`);
  if (!existsSync(path.join(CANVAS, "settings.json")))
    notes.push(
      "no design-canvas/settings.json: every tool (round, preflight, capture, check-canvas, drain, split-canvas) reads the app's " +
        'address, the saved session and the browser from it, once, and none guesses a port. Write it: { "appUrl": "http://localhost:<this project\'s dev port>", ' +
        '"storageState": "design-canvas/auth-state.json", "browserChannel": "chrome", "locales": ["messages/en.json"] }',
    );
}

/**
 * THE CANVAS'S LOCAL HOOK ENTRIES, when THIS machine said yes to the reuse checks.
 *
 * The answer is kept on the machine, outside every repo (`checks-answer.mjs`), so a clone, a CI run or a teammate who never answered
 * is never judged by somebody else's yes. With a yes, the two entries the installer writes (`design-canvas/hook.mjs`, before a tool
 * and at the end of a turn) must be in THIS checkout's `.claude/settings.local.json`, which a new git worktree does not have, and git
 * must ignore that file so they are never committed.
 */
if (readAnswer(target)?.checksHook === true) {
  const local = ".claude/settings.local.json";
  let hooks = {};
  try {
    hooks = JSON.parse(readFileSync(path.join(target, local), "utf8").replace(/^\uFEFF/, ""))?.hooks ?? {};
  } catch {
    hooks = {};
  }
  for (const event of ["PreToolUse", "PostToolUse", "Stop"]) {
    const list = hooks?.[event];
    if (!(Array.isArray(list) && list.some((entry) => Array.isArray(entry?.hooks) && entry.hooks.some((hook) => String(hook?.command ?? "").includes("design-canvas/hook.mjs")))))
      failures.push(
        `this machine's answer for this project is yes to the reuse checks, but ${local} has no ${event} entry for design-canvas/hook.mjs: run install-canvas.mjs in this checkout (a new worktree needs it too)`,
      );
  }
  const gitRun = (...args) => spawnSync("git", ["-C", target, ...args], { encoding: "utf8" });
  const inGit = gitRun("rev-parse", "--is-inside-work-tree");
  if (inGit.status === 0 && inGit.stdout.trim() === "true" && gitRun("check-ignore", "-q", local).status !== 0)
    failures.push(`git does not ignore ${local}, so the hook entries could be committed: run install-canvas.mjs, which adds it to this checkout's exclude list`);
}

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
