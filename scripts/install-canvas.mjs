#!/usr/bin/env node
/**
 * design-canvas — install the canvas into a project.
 *
 *   node <skill>/scripts/install-canvas.mjs [--target <repo root>] [--force] [--checks yes|no | --checks=yes|no] [--share]
 *
 * BEFORE IT OVERWRITES ANYTHING it reads the declaration the project has TODAY and runs the new version's declaration checks
 * over it (the copy rules, the declaration lint, every screen's steps, variants), because an upgrade that newly fails existing
 * edges must not be discovered only at the next oracle run. Every declaration the new version will fail is
 * listed as a warning and the install goes ahead, so an upgrade is never blocked; a declaration the installed version ALREADY
 * fails is listed apart, because the upgrade did not cause it.
 *
 * WHY THIS IS A SCRIPT AND NOT A LIST OF INSTRUCTIONS. The canvas's design is finished. It is copied
 * unchanged into every project, and the single most likely way to get this wrong is to treat it as
 * something to design again — to restyle it to the target's brand, to swap its buttons for the target's
 * components, to "improve" the chrome. A copy nobody hand-writes cannot drift, and `check-install.mjs`
 * then proves byte for byte that it did not.
 *
 * It writes:
 *   design-canvas/core/*            the generic canvas. Overwritten on every run; never edited per project.
 *   design-canvas/*.mjs, canvas-page.tsx, review/page.html   every tool in the skill's tool/ folder, and the share page.
 *                                Overwritten. `settings.json` is the project's own and is never written or overwritten here.
 *   .claude/settings.local.json  the canvas's two local hook entries, merged in on every install (see THE CANVAS'S LOCAL HOOKS
 *                                below). Every other key and entry is kept.
 *   <machine answers file>       the reviewer's answer to that question (see REUSE CHECKS below), kept on this machine outside
 *                                every repo (`checks-answer.mjs`). It is never written into the project.
 *   CLAUDE.md (or AGENTS.md)      the lines for every agent in the project (reuse what exists, record design decisions, grow
 *                                the Design System tab, mark canvas lines and hand-off notes), as one local block (`design-canvas:local
 *                                begin` ... `end`), replaced on every install and never committed; a block an older install
 *                                committed is updated in place, unwrapped, so the next commit does not delete it for the team. The
 *                                rest of the file is the project's and is never touched. A project with neither gets them printed.
 *   design-canvas/README.md        the tool's own half, overwritten; everything below the project marker
 *                                near the end of it is the project's own and is kept.
 *   design-canvas/project/*         the adapter, ONLY when it is not there yet. Never overwritten without
 *                                --force, because it is the one part that is written per project.
 *   app/design-canvas/page.tsx      five route stubs, only when they are not there yet: the index, one canvas
 *   app/design-canvas/[canvas]/page.tsx   per URL segment, the design system's specimen page and the two endpoints.
 *   app/design-canvas/system/[set]/page.tsx   In `src/app` instead when the project keeps its App Router there.
 *   app/api/design-canvas/comments/route.ts
 *   app/api/design-canvas/shots/route.ts
 *   <git folder>/info/exclude    THE CANVAS STAYS ON THIS MACHINE by default: design-canvas/, its routes and .next-canvas/ are
 *                                excluded here (`excludeCanvas` in ignore-rules.mjs), never in .gitignore, so the developers'
 *                                repository never receives canvas files or pictures. A project whose canvas folder is already
 *                                tracked keeps it shared, and one line says so; `--share` opts a repository in (`canvasMode`).
 *   <git folder>                 THE OVERLAY (`tool/overlay.mjs install`): its filter in the local config, `info/attributes`, a
 *                                pre-commit and a pre-push hook chained in front of any the project has. Nothing tracked.
 *   the root layout, the next config, tsconfig.json   the canvas's lines in the project's own files, each marked
 *                                `design-canvas:local` so the overlay keeps it out of every commit (`writeSeams` in seams.mjs). A
 *                                file with no place for a line of its own gets the line printed instead. An older install's
 *                                unmarked lines there are marked when they are lines of their own, and named otherwise.
 *   .gitignore                   a shared canvas only: its scratch (comments, session, share pages, rounds), appended when git does
 *                                not ignore it yet, and NEVER written when the project keeps canvas files local through its own
 *                                exclude list: git is asked (`ignore-rules.mjs`), then one line names what to add and where.
 *
 * REUSE CHECKS, ASKED ONCE. The reuse checks stop agents building new design out of parts the approved design does not use, and
 * the recapture beside them recaptures changed frames at the end of a turn. They change what happens to an agent's work, so they
 * are asked about once, at install, as one question. The answer is kept on THIS MACHINE, outside every repo (`checks-answer.mjs`:
 * $CANVAS_ANSWERS_FILE, else ~/.config/design-canvas/answers.json), filed under the absolute path of the project's git common dir so
 * every worktree of one repo shares it. It is never written into the project: `design-canvas/settings.json` is committed, and a
 * teammate or a CI run that never answered must not be judged by somebody else's yes.
 *
 *   --checks yes|no   (or =yes, =no) records the answer. `hook.mjs` reads it on every event, so it applies at once.
 *   no flag           a project that was never asked gets one line saying so, and the install carries on.
 *
 * The hook entries themselves go in on every install (THE CANVAS'S LOCAL HOOKS below), because the reminders run whatever the answer.
 *
 * It does NOT touch the Tailwind config or the app shell. The canvas pages import `design-canvas/canvas.css`, the canvas's classes
 * prebuilt (`build-canvas-css.mjs`), so no project needs a Tailwind glob for the canvas; the app shell differs in every project,
 * and the printout gives it as a marked line to add.
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  lstatSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { readAnswer, writeAnswer } from "../tool/checks-answer.mjs";
import { appDir, canvasMode, canvasOnlyRootApp, excludeCanvas, optInToSharing, planIgnores } from "./ignore-rules.mjs";
import { CANVAS_CSS, LOCAL_MARK, playwrightCommand, STALE_ROOT_APP, withCanvasCss, writeSeams } from "./seams.mjs";

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function argOf(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
const target = path.resolve(argOf("target") ?? process.cwd());
const force = process.argv.includes("--force");
/* The user asked for the canvas to be shared through git: recorded in the repository's local config (see `canvasMode`). */
const share = process.argv.includes("--share");
/* `--checks yes|no` or `--checks=yes|no`, the answer to the one install question (see REUSE CHECKS above). Any other value, any other
   argument that starts with --checks, or two of them, is refused before a single file is written: a typo read as "no flag" would
   leave the question unanswered without a word, and of two answers neither can be honored. */
const checksArgs = process.argv
  .slice(2)
  .flatMap((arg, at, all) => (arg === "--checks" ? [all[at + 1]] : arg.startsWith("--checks=") ? [arg.slice("--checks=".length)] : arg.startsWith("--checks") ? [arg] : []));
if (checksArgs.length > 1) {
  console.error("install-canvas: --checks was given more than once. Pass it once, with yes or no.");
  process.exit(1);
}
const checksFlag = checksArgs[0];
if (checksArgs.length === 1 && checksFlag !== "yes" && checksFlag !== "no") {
  console.error(`install-canvas: --checks takes yes or no, got ${checksFlag === undefined ? "nothing" : `"${checksFlag}"`}.`);
  process.exit(1);
}

if (!existsSync(path.join(target, "package.json"))) {
  console.error(
    `No package.json in ${target}. Point --target at the repo root.`,
  );
  process.exit(1);
}

/**
 * THE NEW VERSION'S DECLARATION CHECKS, run over the declaration the project has today, before anything is written.
 *
 * The skill's own `dump-screens.mjs` reads the project's `project/flows.ts` (`--dir`), so the declaration is expanded by the NEW
 * core's variants and judged by the NEW rules in `tool/preflight-rules.mjs`. The rules the project has installed (when it has
 * them) judge the same declaration, so what the upgrade itself breaks can be told from what was already broken, and only the
 * first is the upgrade's to report. With no installed rules to compare against, everything the new ones fail counts as new, which is the safe side.
 *
 * It returns what the new rules fail, split into `fresh` (the upgrade's own) and `known` (already failing), and how many canvases
 * it checked. Nothing here blocks: the install warns and goes ahead. A declaration that cannot be read at all is reported too:
 * the install is how a project gets the tools that would read it better.
 */
async function declarationChecks() {
  const canvasDir = path.join(target, "design-canvas");
  if (!existsSync(path.join(canvasDir, "project", "flows.ts"))) return { fresh: [], known: [], checked: 0 };
  const dump = (args) =>
    spawnSync(process.execPath, [path.join(SKILL, "tool", "dump-screens.mjs"), "--dir", canvasDir, ...args], {
      cwd: target,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    });
  const firstLine = (text) => String(text ?? "").trim().split("\n")[0] || "no output";
  const listed = dump(["--list"]);
  if (listed.status !== 0) {
    console.log(`declaration checks skipped: the declaration could not be read (${firstLine(listed.stderr)})\n`);
    return { fresh: [], known: [], checked: 0 };
  }
  const slugs = JSON.parse(listed.stdout);
  const rules = await import(pathToFileURL(path.join(SKILL, "tool", "preflight-rules.mjs")).href);
  /* The rules this project has installed, when it has any and they load: the baseline for "already failing". */
  let installed = null;
  try {
    const file = path.join(canvasDir, "preflight-rules.mjs");
    if (existsSync(file)) installed = await import(pathToFileURL(file).href);
  } catch {
    installed = null;
  }
  const judge = (module, decl) => [...module.lintCopy(decl), ...module.lintDeclaration(decl), ...module.lintSteps(decl.screens)];
  const fresh = [];
  const known = [];
  for (const slug of slugs) {
    const dumped = dump(["--canvas", slug]);
    if (dumped.status !== 0) {
      /* The new version cannot even expand it (a variants screen with a bad list): that IS something the upgrade refuses. */
      fresh.push({ slug, text: firstLine(dumped.stderr) });
      continue;
    }
    const decl = JSON.parse(dumped.stdout);
    let before = null;
    if (installed) {
      try {
        before = new Set(judge(installed, decl));
      } catch {
        before = null;
      }
    }
    for (const text of judge(rules, decl)) (before?.has(text) ? known : fresh).push({ slug, text });
  }
  return { fresh, known, checked: slugs.length };
}

{
  const { fresh, known, checked } = await declarationChecks();
  const list = (items) => {
    const bySlug = new Map();
    for (const item of items) bySlug.set(item.slug, [...(bySlug.get(item.slug) ?? []), item.text]);
    return [...bySlug].map(([slug, texts]) => `  ${slug}\n${texts.map((text) => `    - ${text}`).join("\n")}`).join("\n");
  };
  if (known.length > 0)
    console.log(`${known.length} thing(s) in the declaration already fail the installed version's checks, so this upgrade did not cause them:\n${list(known)}\n`);
  if (fresh.length > 0)
    console.log(
      `Warning: the new version's declaration checks fail ${fresh.length} thing(s) in this project's declaration that the installed version accepts:\n\n${list(fresh)}\n\n` +
        `Installing anyway. The capture, the preflight and the oracle refuse these, so fix them (each line names its rule) before the next capture.\n`,
    );
  else if (known.length > 0) console.log(`declaration checks: the new version's rules add nothing to the list above\n`);
  else if (checked > 0) console.log(`declaration checks: ${checked} canvas(es) pass the new version's rules\n`);
}

const written = [];
const kept = [];

/* LEGACY LAYOUT MIGRATION (scripts/migrate-layout.mjs): an older install's flat comments.json, flat shots/ and seen/changed
   review fields move to today's layout once, here, so no runtime code reads an old layout. Nothing is deleted. */
{
  const canvasDir = path.join(target, "design-canvas");
  if (existsSync(canvasDir)) for (const line of (await import("./migrate-layout.mjs")).migrateLayout(canvasDir)) console.log(`migrated: ${line}`);
}

/**
 * `overwrite: false` means "this file belongs to the project" — the declaration, the states, the route
 * stubs — and `--force` DOES NOT override that. Force is for the core: "re-copy the shipped files over
 * whatever is here". A re-install never replaces a project's declaration with the starter.
 */
function put(from, to, { overwrite = true, transform } = {}) {
  const absolute = path.join(target, to);
  /**
   * NOTHING IS WRITTEN OUTSIDE `--target`, checked rather than assumed.
   *
   * A path that escapes the target is a bug, and a bug that edits a checkout somebody is working in (the
   * main checkout beside a worktree, say) must stop the install rather than land quietly. `--target` is
   * this script's whole contract.
   */
  const root = path.resolve(target);
  const inside = path.resolve(absolute);
  if (inside !== root && !inside.startsWith(root + path.sep)) {
    console.error(`install-canvas: refusing to write outside --target.\n  target: ${root}\n  path:   ${inside}`);
    process.exit(1);
  }
  if (existsSync(absolute) && !overwrite) {
    kept.push(to);
    return;
  }
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, transform ? transform(readFileSync(from, "utf8")) : readFileSync(from));
  written.push(to);
}

/* The core and the tools, byte for byte: every file in the skill's core/ and tool/ lands, so adding one there does not mean
   editing this script. tool/README.md is half the project's (below), tool/review/ holds the share page, and the tests of both
   stay in the skill: they are the skill's suite, never the project's. */
const filesIn = (dir) => readdirSync(dir, { withFileTypes: true }).filter((one) => one.isFile()).map((one) => one.name).sort();
for (const file of filesIn(path.join(SKILL, "core"))) put(path.join(SKILL, "core", file), path.join("design-canvas", "core", file));
for (const file of filesIn(path.join(SKILL, "tool")))
  if (file !== "README.md") put(path.join(SKILL, "tool", file), path.join("design-canvas", file));
/* Tools a newer version no longer ships. They are the skill's files, never the project's, so an upgrade takes them out
   rather than leave a dead command an agent might still run. `system-knowledge.mjs` mined session transcripts for
   decisions; the decisions now live as dated comments in each component's own file, read by components.mjs.
   `unsee.mjs` put existing frames back in the new-screens queue by hand; new is now decided from the pictures alone.
   `core/.checksums.json` was a receipt nothing read, and `core/__tests__/` the core's own suite, which runs in the skill.
   `checks-hook.mjs` and `reminder-hook.mjs` are now the two branches of `hook.mjs`. `adopt.mjs` cleared the marks before a
   first delivery by hand; the reviewer's first visit now does that. */
for (const file of ["system-knowledge.mjs", "unsee.mjs", "core/.checksums.json", "core/__tests__", "checks-hook.mjs", "reminder-hook.mjs", "adopt.mjs"]) {
  const at = path.join(target, "design-canvas", file);
  if (existsSync(at)) {
    rmSync(at, { recursive: true });
    written.push(`design-canvas/${file} (removed: no longer shipped)`);
  }
}
/* The shared page itself, replaced on every install like the tools: it is the skill's, not the project's. */
put(path.join(SKILL, "tool", "review", "page.html"), path.join("design-canvas", "review", "page.html"));

/**
 * The README is the one shipped file that is half the project's. Above the marker is this tool's own
 * description, replaced on every install so an upgrade cannot leave a stale one behind; from the marker
 * down is the project's — its ports, the seams the install cut into that repo, what is known to be broken
 * there — and none of it is derivable from anything the installer can see.
 *
 * A file that is rewritten from the outside cannot hold local knowledge unless something protects the
 * local half, so this does.
 */
const README_MARKER = "<!-- design-canvas:project";

function putReadme() {
  const to = path.join("design-canvas", "README.md");
  const absolute = path.join(target, to);
  const shipped = readFileSync(path.join(SKILL, "tool", "README.md"), "utf8");
  const shippedAt = shipped.indexOf(README_MARKER);
  if (shippedAt < 0) {
    /* The marker is what makes the split possible; a shipped README without one would silently start
       eating project halves, so this stops rather than guesses. */
    console.error(
      `The skill's tool/README.md has no "${README_MARKER}" marker, so the project's own half cannot be kept.`,
    );
    process.exit(1);
  }
  const existing = existsSync(absolute) ? readFileSync(absolute, "utf8") : "";
  const existingAt = existing.indexOf(README_MARKER);
  const projectHalf =
    existingAt >= 0 ? existing.slice(existingAt) : shipped.slice(shippedAt);
  writeFileSync(
    absolute,
    `${shipped.slice(0, shippedAt)}${projectHalf}`,
    "utf8",
  );
  written.push(existingAt >= 0 ? `${to} (kept this project's half)` : to);
}
putReadme();

/**
 * THE FEW LINES EVERY AGENT IN THE PROJECT READS: reuse what exists, follow and record design decisions, grow the
 * Design System tab, load the canvas skill and do what its commands print next. An agent doing UI work never opens this
 * skill or the canvas's README, but it reads the project's own agent file, so that is where these instructions go: the
 * project's CLAUDE.md, else its AGENTS.md, between two markers, replaced on every install, everything else in the file kept.
 * A project with neither file gets none: the block is printed with the receipt, with one line saying where it belongs.
 */
const AGENTS_OPEN = "<!-- design-canvas:agents";
const AGENTS_CLOSE = "<!-- /design-canvas:agents -->";
/* The block is a local one: its lines name tools in a folder the developers do not have, so the overlay keeps it out of commits. An
   older install's block, without the two local lines around it, is replaced the same way. The blank line that sets it apart sits
   inside it, so the file without the block is the file as it was. */
const WRAP_OPEN = `<!-- ${LOCAL_MARK} begin -->\n\n`;
const WRAP_CLOSE = `\n<!-- ${LOCAL_MARK} end -->`;
const agentsBlock = readFileSync(path.join(SKILL, "stubs", "agents-block.md"), "utf8").trim();
const agentsLocal = `${WRAP_OPEN}${agentsBlock}${WRAP_CLOSE}`;
const agentsFile = ["CLAUDE.md", "AGENTS.md"].find((one) => existsSync(path.join(target, one)));
/* An older install committed the block: the committed text is the team's, so it is updated in place, unwrapped, and the change
   shows in git like any edit of a tracked line. Wrapping it in local lines would make the next commit delete it for everyone. */
const agentsCommitted =
  agentsFile !== undefined && (spawnSync("git", ["-C", target, "show", `HEAD:./${agentsFile}`], { encoding: "utf8" }).stdout ?? "").includes(AGENTS_OPEN);
if (agentsFile) {
  const absolute = path.join(target, agentsFile);
  const existing = readFileSync(absolute, "utf8");
  const block = agentsCommitted ? agentsBlock : agentsLocal;
  let from = existing.indexOf(AGENTS_OPEN);
  let until = existing.indexOf(AGENTS_CLOSE);
  if (until > from) until += AGENTS_CLOSE.length;
  if (from >= 0 && existing.slice(Math.max(0, from - WRAP_OPEN.length), from) === WRAP_OPEN) from -= WRAP_OPEN.length;
  if (until > from && existing.slice(until, until + WRAP_CLOSE.length) === WRAP_CLOSE) until += WRAP_CLOSE.length;
  const next =
    from >= 0 && until > from
      ? `${existing.slice(0, from)}${block}${existing.slice(until)}`
      : existing === ""
        ? `${block}\n`
        : `${existing}${existing.endsWith("\n") ? "" : "\n"}${block}\n`;
  if (next === existing) kept.push(`${agentsFile} (design system lines already current)`);
  else {
    writeFileSync(absolute, next, "utf8");
    written.push(`${agentsFile} (the design system lines for agents${agentsCommitted ? ", updated in place: this repository has them committed, so the change shows in git" : ""})`);
  }
}

/* The adapter, only if there is not one already: this is the part that is written per project, and
   overwriting a real declaration with the starter would throw away the actual work. */
put(
  path.join(SKILL, "stubs", "project-flows.starter.ts"),
  "design-canvas/project/flows.ts",
  {
    overwrite: false,
  },
);
put(
  path.join(SKILL, "stubs", "project-states.starter.ts"),
  "design-canvas/project/states.ts",
  {
    overwrite: false,
  },
);
put(
  path.join(SKILL, "stubs", "project-canvas-state-pin.tsx"),
  "design-canvas/project/canvas-state-pin.tsx",
  { overwrite: false },
);
/* The design system's sets, the project's own like the declaration. Starts empty: no set, no Design System tab. */
put(
  path.join(SKILL, "stubs", "project-system.starter.tsx"),
  "design-canvas/project/system.tsx",
  { overwrite: false },
);

/* The route stubs, in the project's App Router folder (`src/app` when it keeps it there; see `appDir`). Also never overwritten: a
   project may have wired them differently, and clobbering a working route is a worse failure than telling someone one already
   exists. Their imports are relative to `app/`, so under `src/app` each climbs one folder more. The index, one canvas per URL
   segment (`/design-canvas/<slug>`), the design system's specimen page that system-capture.mjs photographs (a static segment,
   so `system` is not a slug), and the two endpoints. */
const APP = appDir(target);
const staleRootApp = canvasOnlyRootApp(target);
/* The two canvas pages import the prebuilt stylesheet in every project, so the canvas never depends on the app's Tailwind setup and
   no Tailwind config has to name the canvas folder. */
const deeper = (text) => (APP === "app" ? text : text.replace(/from "\.\.\//g, 'from "../../'));
const stubText = (text) => withCanvasCss(deeper(text));
for (const [stub, to] of [
  ["app-design-canvas-page.tsx", "design-canvas/page.tsx"],
  ["app-design-canvas-slug-page.tsx", "design-canvas/[canvas]/page.tsx"],
  ["app-design-canvas-system-page.tsx", "design-canvas/system/[set]/page.tsx"],
  ["app-api-canvas-comments-route.ts", "api/design-canvas/comments/route.ts"],
  ["app-api-canvas-shots-route.ts", "api/design-canvas/shots/route.ts"],
])
  put(path.join(SKILL, "stubs", stub), `${APP}/${to}`, { overwrite: false, transform: stubText });
/* A canvas page from an older install leaned on the app's Tailwind scanning the canvas folder. The prebuilt stylesheet makes
   that unnecessary, so the import is added to the page (a canvas file, never the app's). */
for (const to of ["design-canvas/page.tsx", "design-canvas/[canvas]/page.tsx"]) {
  const at = path.join(target, APP, to);
  if (!existsSync(at)) continue;
  const text = readFileSync(at, "utf8");
  const next = withCanvasCss(text);
  if (text.includes(CANVAS_CSS) || next === text) continue;
  writeFileSync(at, next);
  written.push(`${APP}/${to} (the canvas's stylesheet import)`);
}

/**
 * WHAT IS IGNORED, AND WHAT IS DELIBERATELY NOT.
 *
 * The comments are one reviewer's working notes plus megabytes of annotated PNGs: consumed, then dead, and a
 * merge conflict inside somebody's feedback is a bad day. Ignored.
 *
 * WHAT A TEAMMATE NEEDS IS NOT IGNORED: the core, the declaration, the captured screens and their manifests, the Design System
 * tab's pictures, the evidence, settings.json, the share page template and the route stubs (`SHARED` in ignore-rules.mjs). The
 * pictures are artefacts that `capture.mjs` regenerates, but a checkout without them opens the canvas on empty frames, and the
 * canvas is a thing people are sent to read. `check-install.mjs` fails when a `.gitignore` hides
 * any of them. A checkout that keeps them local on purpose lists them in its own exclude list (`.git/info/exclude`), which no clone
 * shares, and the check says so as a note.
 */
/**
 * THE LINES THEMSELVES ARE IN `ignore-rules.mjs` (`IGNORE_RULES`), beside the sample path each one has to cover:
 *   design-canvas/comments/, comments.json   the reviewer's notes, and an older install's flat file until it is migrated
 *   design-canvas/auth-state.json   the Playwright storage state the capture logs in with. Live session tokens: never committed.
 *   design-canvas/review/*, then a slash   built share pages (review-build.mjs output): pictures copied from shots/ and the team's
 *                                   review.json, both regenerated or read back from the live page. The template and the
 *                                   review/<slug>.json settings stay committed.
 *   design-canvas/rounds/           what a round leaves behind (round.mjs, capture.mjs): the dumped declaration, the pictures a
 *                                   capture replaced, the visual change report and the contact sheet. Scratch; the record of a
 *                                   round is git and the comments history.
 *
 * GIT IS ASKED, NOT THE FILE. The lines used to be appended to the tracked `.gitignore` whenever its TEXT lacked them, which wrote
 * into a project that keeps canvas files local through its own exclude list (so canvas mechanics never travel to the team) and
 * had to be taken back out by hand every time. Now `git check-ignore` says, per path and through whichever source, what is
 * ignored already (see `planIgnores`): all of it, and `.gitignore` is not touched; some of it through a source that is not a
 * `.gitignore`, and the project keeps its canvas files local, so `.gitignore` is NEVER touched and one line names the paths git
 * does not ignore yet and the exclude file to add them to (this installer writes only inside `--target`, so it never edits an
 * exclude list, which may be a repository's shared one above it); otherwise only the lines git still misses are appended, as before.
 * Outside a git checkout it reads the file, as it always did.
 */
/**
 * LOCAL OR SHARED. A local canvas (the default) is excluded whole through the repository's exclude list, which covers its scratch
 * too, so `.gitignore` and `.gitattributes` are not written at all. A shared canvas gets the lines below as before.
 */
/** One line each about what the install decided for the ignore rules and the project has to do by hand. Printed with the receipt. */
const ignoreLines = [];
if (share && !optInToSharing(target)) ignoreLines.push("Sharing: this is not a git checkout, so there is nothing to share the canvas through.");
const mode = canvasMode(target);
if (mode.mode !== "none") {
  const excluded = excludeCanvas(target, mode.mode === "shared");
  if (excluded.changed) written.push(`${path.relative(target, excluded.file) || excluded.file} (the canvas's lines)`);
}
if (mode.mode === "local")
  ignoreLines.push(
    "Canvas: it stays on this machine. design-canvas/, its routes and .next-canvas/ are in the repository's exclude list, so no commit carries them. " +
      "If the user asks for the canvas to be shared through git, run this installer again with --share.",
  );
else if (mode.why === "tracked")
  ignoreLines.push("Canvas: this project's canvas folder is tracked in git, so it stays shared, and teammates who pull get it. Its lines in app files still stay local.");
else if (mode.why === "opted in")
  ignoreLines.push("Canvas: shared through git. Commit design-canvas/ and its routes for teammates to get it. Its lines in app files still stay local.");
const gitignorePath = path.join(target, ".gitignore");
const gitignore = existsSync(gitignorePath)
  ? readFileSync(gitignorePath, "utf8")
  : "";
const ignorePlan = mode.mode === "local" ? { kind: "covered", lines: [] } : planIgnores(target, gitignore);
if (ignorePlan.kind === "local" && ignorePlan.missing.length > 0) {
  ignoreLines.push(
    `Ignore rules: .gitignore was left alone, because this project keeps canvas files out of git through ${ignorePlan.exclude}. ` +
      `git does not ignore ${ignorePlan.missing.map((one) => one.probe).join(", ")} yet: add ${ignorePlan.missing.map((one) => one.line).join(", ")} to that file.`,
  );
}
const missingIgnores = ignorePlan.lines;
if (missingIgnores.length > 0) {
  writeFileSync(
    gitignorePath,
    `${gitignore}${gitignore.endsWith("\n") || gitignore === "" ? "" : "\n"}
# design feedback from the review canvas, with its annotated pictures. One reviewer's working notes:
# consumed and then dead. The CAPTURED SCREENS in design-canvas/shots/ are committed on purpose, so a
# fresh checkout of this shared canvas opens on real frames.
# DELETE WITH: the design-canvas/ folder.
${missingIgnores.join("\n")}
`,
    "utf8",
  );
  written.push(".gitignore");
}

/**
 * THE MANIFEST IS COMMITTED AND SHOULD STOP DROWNING REVIEWS.
 *
 * `shots/<canvas>/manifest.json` is generated, and it carries a per-file hash map, so one capture run can
 * add thousands of changed lines to a pull request or a review diff, enough to crowd real source files
 * out of an automated reviewer's byte budget. It still has to be committed: the
 * oracle reads it and a fresh checkout needs it.
 *
 * So it is marked GENERATED rather than removed. Git then shows it as one changed file instead of a wall
 * of hashes, GitHub collapses it by default, and nothing about how the tools read it changes.
 */
const ATTRIBUTES = [
  "design-canvas/shots/**/manifest.json -diff linguist-generated=true",
];
const attributesPath = path.join(target, ".gitattributes");
const attributes = existsSync(attributesPath) ? readFileSync(attributesPath, "utf8") : "";
const missingAttributes = mode.mode === "local" ? [] : ATTRIBUTES.filter((line) => !attributes.includes(line.split(" ")[0]));
if (missingAttributes.length > 0) {
  writeFileSync(
    attributesPath,
    `${attributes}${attributes.endsWith("\n") || attributes === "" ? "" : "\n"}
# The capture manifest is generated by design-canvas and carries a per-file hash map. Committed on
# purpose, shown as one line rather than thousands.
# DELETE WITH: the design-canvas/ folder.
${missingAttributes.join("\n")}
`,
    "utf8",
  );
  written.push(".gitattributes");
}

/**
 * THE CANVAS'S LOCAL HOOKS, AND THE PROOF THEY STAY LOCAL.
 *
 * Four entries in `.claude/settings.local.json`, the one settings file Claude Code keeps out of version control, all running
 * `design-canvas/hook.mjs`: PreToolUse for Bash (the reminders before a canvas command, the overlay before a git command, which may
 * scan a long push, so it gets a minute) and for Write, Edit and MultiEdit (the reuse checks before an edit, ten seconds),
 * PostToolUse for Bash, Write, Edit and MultiEdit (the overlay and the parity bases after a git command, the overlay after an edit)
 * and Stop (the background recapture). Claude Code keys hooks by event, so one entry cannot serve them all. Whether
 * the checks and the recapture do anything is this machine's answer (REUSE CHECKS above), read by the hook itself; the reminders
 * always run. Four things keep the entries local rather than assumed to be:
 *
 *   - A TRACKED FILE IS REFUSED. If git tracks `.claude/settings.local.json`, an entry written into it would be committed, so
 *     nothing is written and one line says so.
 *   - THE FILE IS MERGED, NEVER REPLACED. Whatever permissions, env and unrelated hooks the checkout already has stay exactly as
 *     they were; an entry is recognized by the hook's path in its command, so a second run adds nothing. The entries of the three
 *     hook files an older install wrote are taken out. An empty or whitespace-only file counts as `{}` and a leading byte-order mark
 *     is ignored.
 *   - GIT IS ASKED, NOT TRUSTED. `git check-ignore` says whether the file is ignored here (a global ignore file often already covers
 *     it). When it is not, the rule goes into the repository's exclude list (`git rev-parse --git-path info/exclude`), never into a
 *     tracked .gitignore, anchored at the project: the same list the canvas's own lines go in (`excludeCanvas`), which no clone
 *     receives, in a linked worktree and in a project in a subfolder too.
 *   - A FILE THAT CANNOT BE READ IS LEFT ALONE. A settings file that is not valid JSON is somebody's work in progress.
 *
 * A failure exits 1 only when the answer is yes, because then the reuse checks the reviewer asked for are not in place.
 *
 * The command is a shell one-liner and not a bare `node` call because Claude Code can be started in a subfolder of the project:
 * `$CLAUDE_PROJECT_DIR` is tried first, then the git top level of it, and if neither has the hook (a checkout the canvas is not
 * installed in) it exits 0. A hook that fails must never block an edit, so every way out is exit 0: node's stderr is dropped and its
 * exit code ignored (a hook file with a missing import or a syntax error makes node exit 1 before the hook's own handler exists).
 * What the hook prints on stdout still reaches Claude Code.
 */
const LOCAL_SETTINGS = ".claude/settings.local.json";
const HOOK_MARK = "design-canvas/hook.mjs";
/** The hook files an older install wired in one entry each; their entries are replaced by the four below. */
const RETIRED_MARKS = ["design-canvas/checks-hook.mjs", "design-canvas/reminder-hook.mjs", "design-canvas/recapture.mjs"];
const HOOK_COMMAND =
  `sh -c 'command -v node >/dev/null 2>&1 || exit 0; ` +
  `for d in "$CLAUDE_PROJECT_DIR" "$(git -C "$CLAUDE_PROJECT_DIR" rev-parse --show-toplevel 2>/dev/null)"; do ` +
  `f="$d/${HOOK_MARK}"; if [ -f "$f" ]; then node "$f" 2>/dev/null; exit 0; fi; done; exit 0'`;
const HOOK_ENTRIES = {
  PreToolUse: [
    { matcher: "Bash", hooks: [{ type: "command", command: HOOK_COMMAND, timeout: 60 }] },
    { matcher: "Write|Edit|MultiEdit", hooks: [{ type: "command", command: HOOK_COMMAND, timeout: 10 }] },
  ],
  PostToolUse: [{ matcher: "Bash|Write|Edit|MultiEdit", hooks: [{ type: "command", command: HOOK_COMMAND, timeout: 60 }] }],
  Stop: [{ hooks: [{ type: "command", command: HOOK_COMMAND, timeout: 10 }] }],
};
const checksLines = [];
let checksFailed = false;
const git = (...args) => spawnSync("git", ["-C", target, ...args], { encoding: "utf8" });
const isGit = (() => {
  const inside = git("rev-parse", "--is-inside-work-tree");
  return inside.status === 0 && inside.stdout.trim() === "true";
})();

/** One JSON object from a file: `{ value }` (an empty object when there is no file, or it is empty or only whitespace) or `{ error }`
 *  when it is not an object. A leading byte-order mark, which some editors write, is not part of the JSON. */
function readJsonObject(file) {
  if (!existsSync(file)) return { value: {} };
  try {
    const text = readFileSync(file, "utf8").replace(/^﻿/, "");
    if (text.trim() === "") return { value: {} };
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) return { error: "it is not one JSON object" };
    return { value };
  } catch (error) {
    return { error: `it is not valid JSON (${String(error.message).split("\n")[0]})` };
  }
}

/**
 * The settings file with the canvas's two entries in place and the retired ones out, or `{ why }` when it cannot be written. Every
 * other key, entry and hook is kept where it was; an entry that also holds somebody else's hook keeps that hook.
 */
function mergeHooks() {
  /* `.claude` there as something other than a folder (a regular file, or a link that leads nowhere) can never hold the file. */
  const claudeDir = path.join(target, ".claude");
  const attempt = (probe) => {
    try {
      return probe();
    } catch {
      return false;
    }
  };
  if (attempt(() => lstatSync(claudeDir)) && !attempt(() => statSync(claudeDir).isDirectory())) return { why: `.claude exists in ${target} but is not a folder, so ${LOCAL_SETTINGS} cannot be created. Move it away and run again` };
  const read = readJsonObject(path.join(target, LOCAL_SETTINGS));
  if (read.error) return { why: `${LOCAL_SETTINGS} was left untouched because ${read.error}. Fix it and run again` };
  const settings = read.value;
  const hooks = settings.hooks ?? {};
  if (typeof hooks !== "object" || Array.isArray(hooks) || Object.keys(HOOK_ENTRIES).some((event) => !Array.isArray(hooks[event] ?? [])))
    return { why: `${LOCAL_SETTINGS} was left untouched because its "hooks" are not in the shape Claude Code reads. Fix it and run again` };
  const ours = (hook) => typeof hook?.command === "string" && [HOOK_MARK, ...RETIRED_MARKS].some((mark) => hook.command.includes(mark));
  const next = { ...hooks };
  for (const event of new Set([...Object.keys(HOOK_ENTRIES), ...Object.keys(hooks)])) {
    if (!Array.isArray(hooks[event])) continue;
    const kept = [];
    for (const entry of hooks[event]) {
      if (!Array.isArray(entry?.hooks) || !entry.hooks.some(ours)) kept.push(entry);
      else if (entry.hooks.some((hook) => !ours(hook))) kept.push({ ...entry, hooks: entry.hooks.filter((hook) => !ours(hook)) });
    }
    if (kept.length > 0 || event in HOOK_ENTRIES) next[event] = kept;
    else delete next[event];
  }
  for (const [event, entries] of Object.entries(HOOK_ENTRIES)) next[event] = [...(next[event] ?? []), ...entries];
  /* Already exactly this (a second install): nothing to write. */
  return { settings: { ...settings, hooks: next }, unchanged: JSON.stringify(next) === JSON.stringify(hooks) };
}
/**
 * Prove git ignores the local settings file; when it does not, add the rule to the repository's exclude list. Returns null, or the
 * line that says what to do instead.
 */
function ignoreLocalSettings() {
  if (git("check-ignore", "-q", LOCAL_SETTINGS).status === 0) return null;
  /* An exclude pattern with a slash is anchored at the top of the repository, so a project in a subfolder needs its prefix. */
  const rule = `${git("rev-parse", "--show-prefix").stdout.trim()}${LOCAL_SETTINGS}`;
  const where = git("rev-parse", "--git-path", "info/exclude");
  if (where.status !== 0 || where.stdout.trim() === "") return `git does not ignore ${LOCAL_SETTINGS} and its exclude list could not be found. Add the line ${LOCAL_SETTINGS} to your global git ignore`;
  const exclude = path.resolve(target, where.stdout.trim());
  try {
    const existing = existsSync(exclude) ? readFileSync(exclude, "utf8") : "";
    mkdirSync(path.dirname(exclude), { recursive: true });
    writeFileSync(exclude, `${existing}${existing === "" || existing.endsWith("\n") ? "" : "\n"}${rule}\n`, "utf8");
  } catch (error) {
    return `git does not ignore ${LOCAL_SETTINGS} and the exclude list (${exclude}) could not be written (${String(error.message).split("\n")[0]}). Add the line ${rule} to it, then run again`;
  }
  if (git("check-ignore", "-q", LOCAL_SETTINGS).status !== 0) return `git still does not ignore ${LOCAL_SETTINGS} after the rule was added to ${exclude}. Add the line ${rule} to your global git ignore`;
  checksLines.push(`Canvas hooks: ${LOCAL_SETTINGS} was not ignored by git, so the rule is now in ${exclude} (the repository's own exclude list, nothing tracked).`);
  return null;
}

{
  /* The answer, when this run gives one. */
  if (checksFlag) {
    const recorded = writeAnswer(target, checksFlag === "yes");
    if (!recorded.ok) {
      checksLines.push(`Reuse checks: the answer was not recorded: ${recorded.error}.`);
      checksFailed = true;
    }
  }
  const answer = readAnswer(target)?.checksHook;
  /* The entries, on every install. */
  let why = null;
  if (isGit && git("ls-files", "--error-unmatch", "--", LOCAL_SETTINGS).status === 0)
    why = `${LOCAL_SETTINGS} is tracked by git, so the hooks cannot be added privately (the entries would be committed): untrack that file and run again`;
  const merged = why ? null : mergeHooks();
  if (merged?.why) why = merged.why;
  if (!why && isGit && git("check-ignore", "-q", LOCAL_SETTINGS).status !== 0) why = ignoreLocalSettings();
  if (!why && !merged.unchanged) {
    try {
      mkdirSync(path.join(target, ".claude"), { recursive: true });
      writeFileSync(path.join(target, LOCAL_SETTINGS), `${JSON.stringify(merged.settings, null, 2)}\n`, "utf8");
      written.push(`${LOCAL_SETTINGS} (the canvas's hooks)`);
    } catch (error) {
      why = `${LOCAL_SETTINGS} could not be written (${String(error.message).split("\n")[0]})`;
    }
  }
  if (why) {
    checksLines.push(`Canvas hooks: not added. ${why}.`);
    if (answer === true) checksFailed = true;
  }
  if (answer === true && !why) checksLines.unshift("Reuse checks: on for this project, with the background recapture beside them.");
  else if (answer === false && checksFlag === "no") checksLines.unshift("Reuse checks: off for this project.");
  else if (answer === undefined) checksLines.push("Reuse checks: not set for this project. Ask the reviewer once and run again with --checks yes or --checks no.");
}

/**
 * THE CANVAS'S LINES IN THE PROJECT'S OWN FILES, then THE OVERLAY that keeps them out of every commit (`tool/overlay.mjs`). The seams
 * are written first so the overlay's first sync registers their files. Outside a git checkout there is nothing to keep them out of.
 */
const seams = writeSeams(target, APP);
for (const file of seams.written) written.push(`${file} (the canvas's lines, marked ${LOCAL_MARK})`);
const at = (one) => `${one.file}:${one.line}`;
const seamLines = [];
if (seams.marked.length > 0)
  seamLines.push(`Older lines: an earlier install left ${seams.marked.length} canvas line(s) unmarked; they are marked ${LOCAL_MARK} now, so no commit carries them: ${seams.marked.map(at).join(", ")}.`);
if (seams.manual.length > 0)
  seamLines.push(
    `Older lines to fix by hand: an earlier install's canvas line(s) that change the team's own lines, so they were not marked: ` +
      `${seams.manual.map((one) => `${at(one)} ${JSON.stringify(one.text.slice(0, 80))}`).join("; ")}. Put the team's version back and add the canvas's part as a marked line of its own, or remove it.`,
  );
const overlayLines = [];
if (mode.mode !== "none") {
  const run = spawnSync(process.execPath, [path.join(target, "design-canvas", "overlay.mjs"), "install"], { cwd: target, encoding: "utf8" });
  if (run.status === 0) overlayLines.push(...run.stdout.split("\n").filter(Boolean));
  else {
    overlayLines.push(`Overlay: not installed (${String(run.stderr || run.stdout).trim().split("\n")[0] || `exit ${run.status}`}), so canvas lines in app files could be committed. Fix it and run again.`);
    process.exitCode = 1;
  }
}

console.log(`installed into ${target}\n`);
for (const file of written) console.log(`  wrote  ${file}`);
for (const file of kept)
  console.log(`  kept   ${file} (already there, not overwritten)`);

if (!agentsFile)
  console.log(`Agent lines: this project has no CLAUDE.md or AGENTS.md, so none was written. Put these lines in the file your agents read:\n\n${agentsLocal}\n`);
if (staleRootApp) console.log(`Routes: ${STALE_ROOT_APP}.\n`);
const addPlaywright = playwrightCommand(target, { local: mode.mode === "local" });
if (addPlaywright) console.log(`Playwright: the capture needs it and it does not load from design-canvas/ in this project. Add it with:\n\n  ${addPlaywright}\n`);
for (const line of [...ignoreLines, ...seamLines, ...overlayLines]) console.log(line);
if (ignoreLines.length + seamLines.length + overlayLines.length > 0) console.log("");
for (const line of checksLines) console.log(line);
if (checksLines.length > 0) console.log("");

const seamTodo = seams.todo.map((line, at) => `  ${at + 3}. ${line}`).join("\n");
console.log(`
Still to do by the agent, because every project does these differently. Each line added to an app file is
an added line only, ending in a \`${LOCAL_MARK}\` comment (or inside a \`${LOCAL_MARK} begin\` ... \`end\` block),
so it stays in this working copy and no commit carries it:

  1. No app shell. However this project decides a route renders without app chrome, put /design-canvas in
     it: the whole subtree, so /design-canvas/<slug> is covered too. The canvas is a canvas that imports the
     prototype, not a page of the prototype.
  2. Write design-canvas/project/flows.ts and name every canvas in its \`CANVASES\` record. Until it is real,
     check-canvas.mjs fails, which is the correct state for a half-written declaration.
${seamTodo ? `${seamTodo}\n` : ""}
The canvas pages import ${CANVAS_CSS}, the canvas's classes prebuilt, so no Tailwind config needs the canvas folder.
${seams.written.length > 0 ? `Marked canvas lines written this run: ${seams.written.join(", ")}.\n` : ""}
Each canvas is addressed by its slug, and the slug namespaces its pictures and its review:

  /design-canvas/<slug>                     the canvas
  design-canvas/shots/<slug>/               its pictures
  design-canvas/comments/<slug>.json        its review
  design-canvas/comments/.history           every review's history, a git repo of its own

Then, per canvas:
  node design-canvas/capture-run.mjs --canvas <slug> && node design-canvas/check-canvas.mjs --canvas <slug>

Both default to \`main\`, which is the starter registry's one entry, so a single-canvas project can pass
nothing. Upgrading an existing install: this installer moves an older flat layout (design-canvas/comments.json,
design-canvas/shots/) to the namespaced paths once, deleting nothing, and the routes read only the namespaced
ones. The first capture after that recaptures every screen, because the old manifest is set aside, not reused.
`);
if (checksFailed) process.exitCode = 1;
