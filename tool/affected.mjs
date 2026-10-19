#!/usr/bin/env node
/**
 * design-canvas — WHAT ELSE A COMMENT REACHES: the other frames drawn from the same files as the commented one.
 *
 *   node design-canvas/affected.mjs --canvas <slug>                 every open comment on that canvas
 *   node design-canvas/affected.mjs --canvas <slug> --ids c4,c7     those comments
 *   node design-canvas/affected.mjs --canvas <slug> --screen <id>   one frame, with no comment needed
 *   add --all to list every shared file and every frame instead of the closest few, --json for the groups themselves
 *
 * WHY. A comment is pinned to one frame, and the fix for it usually lands in a file other frames draw too: a row, a badge, a
 * dialog. An agent that works the comment and recaptures only that frame leaves every other frame drawn from the same file
 * stale, unchecked and unseen by the reviewer. This names them before the edit, so the round covers what really changes.
 *
 * DERIVED, NEVER DECLARED. Every frame already names its `source`, and `closure.mjs` (the walk the capture stamps frames
 * with) turns that into every project file the frame draws. Two frames are connected when their walks share a file. Nothing
 * new is written into a declaration, and a component added or removed in the code changes the answer at once.
 *
 * WHAT IS COMPARED. The commented frame's own files, not only the component under the box: the capture keeps no map from a
 * pixel to the component that drew it, and building one would mean instrumenting every page at capture time, which no
 * project-independent mechanism does reliably. So the answer is per frame, and it is ranked so the likely culprit leads.
 *
 * HOW IT READS, closest first:
 *   1. the same page: frames at the same route, query aside (other states of it, other canvases' widths, options on it);
 *   2. each shared component, fewest frames first: a part used by two screens is a closer tie than one used by thirty, and is
 *      the likelier place for a fix aimed at one screen. Files with exactly the same frames are one line, named by their
 *      components. At most `CAP` lines (`--all` lifts it), each naming at most `FRAME_CAP` frames and the count of the rest;
 *   3. SHELL-LEVEL FILES IN ONE LINE. A file that draws at least three quarters of some canvas's frames (a layout, the app
 *      shell, the global stylesheet) would put every frame in every list. It is said once, with its count, rather than
 *      dropped: on a canvas about one feature the busiest file can be that feature's own table, and a fix there really does
 *      reach nearly everything.
 *
 * DELETE WITH: the design-canvas/ folder.
 */
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveSpecifier } from "./closure.mjs";
import { findDefinition, importItems } from "./checks.mjs";
import { commentsFileFor } from "./comment-integrity.mjs";
import { declarationFor, loadDeclarations, slugsOf } from "./declarations.mjs";
import { exportedComponents, isNeverDesign } from "./registry.mjs";

/** How many shared-file lines are printed per frame, and how many frames each line names. */
export const CAP = 5;
export const FRAME_CAP = 8;
/** The share of a canvas's frames a file has to draw to count as shell level, and the smallest canvas the rule applies to. */
export const SHELL_SHARE = 0.75;
export const SHELL_MIN_FRAMES = 4;

/**
 * The frames of one canvas that are drawn from project code: every flow screen and exploration option with a `source`, minus
 * the ones that are pictures of something else (explanations, references, stills, wireframes). Ids are `<canvas>/<screen>`.
 */
export function framesOf(slug, declaration) {
  const out = [];
  const groups = [...(declaration.flows ?? []), ...(declaration.explorations ?? [])];
  const seen = new Set();
  for (const group of groups) {
    for (const screen of group.screens ?? []) {
      if (screen.explain || screen.reference === true || screen.still || screen.wireframe) continue;
      if (!Array.isArray(screen.source) || screen.source.length === 0) continue;
      const key = `${slug}/${screen.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      /* The page is the route without its query: the same page in another state, at another width or as an option. */
      const page = typeof screen.route === "string" ? screen.route.split(/[?#]/)[0] : null;
      out.push({ key, canvas: slug, id: screen.id, label: screen.label ?? screen.id, page, source: [...screen.source] });
    }
  }
  return out;
}

/**
 * THE FILES A FRAME USES, for this list: the import walk of `closure.mjs`, except that a named import is followed to the file
 * that DEFINES the name (`findDefinition`, the reuse check's barrel rule, references/traps.md 38). So one hook imported from an
 * `index.ts` does not tie a frame to everything that barrel re-exports. A namespace or dynamic import, and a name that cannot
 * be traced, still take the whole module; a module's own `export ... from` lines are walked only when it is taken whole;
 * type-only imports draw nothing. The capture's stamp keeps the plain walk on purpose: importing one name from a barrel still
 * evaluates every module the barrel re-exports, and their side effects (a global stylesheet, a registry) can change a picture.
 * Repo-relative, sorted.
 */
export function filesUsedFrom(entries, root) {
  const readText = (at) => readFileSync(at, "utf8");
  const whole = new Set();
  const named = new Set();
  const queue = entries.map((file) => ({ at: path.join(root, file), all: true })).filter((one) => existsSync(one.at));
  while (queue.length > 0) {
    const { at, all } = queue.pop();
    if (whole.has(at) || (!all && named.has(at))) continue;
    (all ? whole : named).add(at);
    if (!/\.(tsx?|jsx?|mjs)$/.test(at)) continue;
    let text;
    try {
      text = readText(at);
    } catch {
      continue;
    }
    for (const item of importItems(text)) {
      if (item.isType || (item.keyword === "export" && !all)) continue;
      const next = resolveSpecifier(item.specifier, at, root);
      if (!next) continue;
      const found = item.imported === "*" || item.imported === "dynamic" ? null : findDefinition({ at: next, name: item.imported, root, readText });
      queue.push(found ? { at: found.at, all: false } : { at: next, all: true });
    }
  }
  return [...new Set([...whole, ...named])].map((at) => path.relative(root, at)).sort();
}

/**
 * Every frame's files, through `filesUsedFrom`. The canvas's own folder, tests and dependencies are left out: they are
 * never part of a picture of the app (the pin adapter is reached by every pinned frame and would connect all of them).
 * Frames with the same `source` share one walk.
 */
export function closuresOf(frames, root) {
  const byEntries = new Map();
  const out = new Map();
  for (const frame of frames) {
    const entries = [...frame.source].sort().join("\n");
    if (!byEntries.has(entries)) byEntries.set(entries, new Set(filesUsedFrom(frame.source, root).filter((rel) => !isNeverDesign(rel))));
    out.set(frame.key, byEntries.get(entries));
  }
  return out;
}

/** Files that draw at least `SHELL_SHARE` of the frames of some canvas with at least `SHELL_MIN_FRAMES` frames. */
export function shellFiles(frames, closures) {
  return new Set(shellByCanvas(frames, closures).keys());
}

/**
 * The same files, each with the canvases it is shell level on. A file can draw nearly every frame of one canvas and a few of
 * another: on the second it is an ordinary shared part, and its frames there are listed like any other.
 */
export function shellByCanvas(frames, closures) {
  const perCanvas = new Map();
  for (const frame of frames) {
    const counts = perCanvas.get(frame.canvas) ?? { total: 0, files: new Map() };
    counts.total += 1;
    for (const file of closures.get(frame.key) ?? []) counts.files.set(file, (counts.files.get(file) ?? 0) + 1);
    perCanvas.set(frame.canvas, counts);
  }
  const shell = new Map();
  for (const [canvas, { total, files }] of perCanvas) {
    if (total < SHELL_MIN_FRAMES) continue;
    for (const [file, count] of files) if (count >= SHELL_SHARE * total) shell.set(file, (shell.get(file) ?? new Set()).add(canvas));
  }
  return shell;
}

/**
 * THE ANSWER FOR ONE FRAME, as data. `target` is a frame key. Returns
 *   { target, samePage: [keys], groups: [{ files, frames: [keys] }], shell: { files, frames: count, of: count } | null }
 * where `groups` is in reading order and complete (the caller caps what it prints), every key is another frame, and a frame
 * on the same page is not repeated in the groups below it. `shell` is `shellByCanvas` (a file is shell level only on the canvases
 * it names), or a plain set of files that are shell level everywhere.
 */
export function alsoAffected({ target, frames, closures, shell = shellByCanvas(frames, closures) }) {
  const isShell = (file, canvas) => (shell instanceof Map ? Boolean(shell.get(file)?.has(canvas)) : shell.has(file));
  const own = frames.find((frame) => frame.key === target);
  const mine = closures.get(target);
  if (!own || !mine) return null;
  const others = frames.filter((frame) => frame.key !== target);

  /* By route, not by `source`: a `source` often names a shared surface beside the page, and sharing that is a shared part. */
  const samePage = own.page ? others.filter((frame) => frame.page === own.page).map((frame) => frame.key) : [];
  const onSamePage = new Set(samePage);

  /* Each shared file and the other frames drawn from it; files with the same frames become one group. */
  const byFrames = new Map();
  const shellReach = new Set();
  const shellHit = [];
  for (const file of [...mine].sort()) {
    const drawing = others.filter((frame) => closures.get(frame.key)?.has(file));
    const inShell = drawing.filter((frame) => isShell(file, frame.canvas)).map((frame) => frame.key);
    if (inShell.length > 0) shellHit.push(file);
    for (const key of inShell) shellReach.add(key);
    const reached = drawing.filter((frame) => !isShell(file, frame.canvas)).map((frame) => frame.key);
    const rest = reached.filter((key) => !onSamePage.has(key));
    if (rest.length === 0) continue;
    const signature = rest.join("\n");
    const group = byFrames.get(signature) ?? { files: [], frames: rest };
    group.files.push(file);
    byFrames.set(signature, group);
  }
  const groups = [...byFrames.values()].sort(
    (a, b) => a.frames.length - b.frames.length || a.files[0].localeCompare(b.files[0]),
  );
  return {
    target,
    samePage,
    groups,
    shell: shellHit.length > 0 ? { files: shellHit, frames: shellReach.size, of: others.length } : null,
  };
}

/** The component names a group's files export, read once per file. Files with none (styles, helpers) give nothing. */
function componentNames(files, root, cache) {
  const names = [];
  for (const file of files) {
    if (!cache.has(file)) {
      let found = [];
      if (/\.(tsx|jsx)$/.test(file)) {
        try {
          found = exportedComponents(readFileSync(path.join(root, file), "utf8"));
        } catch {
          found = [];
        }
      }
      cache.set(file, found);
    }
    names.push(...cache.get(file));
  }
  return [...new Set(names)];
}

/** `a, b, c, +4 more`. */
const capped = (items, cap) => (items.length > cap ? `${items.slice(0, cap).join(", ")}, +${items.length - cap} more` : items.join(", "));

/**
 * The answer as the lines an agent reads. `canvas` is the commented frame's canvas, so its own frames print as bare ids and
 * other canvases' as `<canvas>/<id>`. `system` is `readSystem` from components.mjs: a shared file that is a set on the Design
 * System tab says so. `more` is the exact command that lists everything for this answer: the hidden groups line names it
 * whole, because a bare `--all` means "drain every comment" to `drain.mjs`, where these lines are printed too.
 */
export function formatAffected(result, { canvas, root, all = false, system = {}, names = new Map(), more = `node design-canvas/affected.mjs --canvas ${canvas} --all` }) {
  if (!result) return ["  its frame draws no project files the canvas knows of, so nothing can be derived"];
  const show = (key) => (key.startsWith(`${canvas}/`) ? key.slice(canvas.length + 1) : key);
  const label = (files) => {
    const components = componentNames(files, root, names);
    const sets = files.flatMap((file) => (system[file] ?? []).map((set) => set.name));
    const what = components.length > 0 ? capped(components, 3) : path.basename(files[0]);
    const where = files.length > 1 ? `${files[0]}, +${files.length - 1} more` : files[0];
    return `${what} (${where})${sets.length > 0 ? `, on the Design System tab as ${capped([...new Set(sets)], 2)}` : ""}`;
  };
  const frameCap = all ? Infinity : FRAME_CAP;
  const lines = [];
  if (result.samePage.length > 0) lines.push(`  the same page: ${capped(result.samePage.map(show), frameCap)}`);
  const groups = all ? result.groups : result.groups.slice(0, CAP);
  for (const group of groups)
    lines.push(`  uses the same ${label(group.files)}: ${group.frames.length === 1 ? "" : `${group.frames.length} frames, `}${capped(group.frames.map(show), frameCap)}`);
  const hidden = result.groups.length - groups.length;
  if (hidden > 0) {
    const reached = new Set(result.groups.slice(groups.length).flatMap((group) => group.frames));
    lines.push(`  ${hidden} more shared file group(s), reaching ${reached.size} frame(s): ${more} lists them`);
  }
  if (result.shell)
    lines.push(
      `  shell level, not listed: ${label(result.shell.files)} is on ${result.shell.frames} of the other ${result.shell.of} frames`,
    );
  if (lines.length === 0) lines.push("  nothing else: no other frame is drawn from its files");
  return lines;
}

/** Every frame of every canvas the project declares, with its files. Throws a sentence when the declaration cannot be read. */
export async function loadGraph(canvasDir) {
  const root = path.dirname(canvasDir);
  const loaded = await loadDeclarations(canvasDir);
  const frames = [];
  for (const slug of slugsOf(loaded)) {
    const picked = declarationFor(loaded, slug);
    if (picked.error) throw new Error(picked.error);
    frames.push(...framesOf(slug, picked.declaration));
  }
  const closures = closuresOf(frames, root);
  return { root, frames, closures, shell: shellByCanvas(frames, closures) };
}

/**
 * The lines for a list of comments on one canvas, for any tool that hands comments to an agent (`drain.mjs --list` prints
 * them under each comment). `graph` comes from `loadGraph`. A comment on a frame the canvas no longer declares gets no lines.
 * `screen` says the entries are frames asked for by id (`--screen`), not comments.
 */
export function linesForComments(comments, { canvas, graph, system = {}, all = false, screen = false }) {
  const names = new Map();
  const out = new Map();
  for (const comment of comments) {
    const key = `${canvas}/${comment.screenId}`;
    if (!graph.frames.some((frame) => frame.key === key)) continue;
    const result = alsoAffected({ target: key, frames: graph.frames, closures: graph.closures, shell: graph.shell });
    /* Only plain names go into a printed command: a screen id or a comment id from the review file could carry shell syntax. */
    const plainScreen = /^[A-Za-z0-9_.:-]+$/.test(String(comment.screenId));
    const more = `node design-canvas/affected.mjs --canvas ${canvas} ${screen && plainScreen ? `--screen ${comment.screenId}` : `--ids ${/^c\d+$/.test(String(comment.id)) ? comment.id : "<its id>"}`} --all`;
    out.set(comment.id, formatAffected(result, { canvas, root: graph.root, all, system, names, more }));
  }
  return out;
}

/* ------------------------------------------------------------------ command line */

async function main() {
  const argv = process.argv.slice(2);
  const argOf = (name) => {
    const at = argv.indexOf(`--${name}`);
    return at === -1 ? null : (argv[at + 1] ?? null);
  };
  const has = (name) => argv.includes(`--${name}`);
  const canvasDir = path.resolve(argOf("canvas-dir") ?? path.dirname(fileURLToPath(import.meta.url)));
  const canvas = argOf("canvas") ?? "main";
  const all = has("all");

  const graph = await loadGraph(canvasDir);
  const { readSystem } = await import("./components.mjs");
  const system = readSystem(canvasDir);
  if (!graph.frames.some((frame) => frame.canvas === canvas)) {
    console.error(`affected: no frames on a canvas called "${canvas}" (this project has: ${[...new Set(graph.frames.map((frame) => frame.canvas))].join(", ") || "none"})`);
    process.exit(1);
  }

  /* What to answer for: one frame, the comments named, or every open note. */
  let asked;
  if (argOf("screen")) asked = [{ id: argOf("screen"), screenId: argOf("screen"), label: null }];
  else {
    const file = commentsFileFor(canvasDir, canvas);
    let comments = [];
    try {
      comments = file ? (JSON.parse(readFileSync(file, "utf8")).comments ?? []) : [];
    } catch {
      console.error(`affected: ${path.relative(graph.root, file)} does not parse`);
      process.exit(1);
    }
    const ids = (argOf("ids") ?? "").split(",").map((one) => one.trim()).filter(Boolean);
    if (ids.length > 0) {
      const unknown = ids.filter((id) => !comments.some((one) => one.id === id));
      if (unknown.length > 0) {
        console.error(`affected: no comment ${unknown.join(", ")} on ${canvas}`);
        process.exitCode = 1;
      }
      asked = comments.filter((one) => ids.includes(one.id));
    } else asked = comments.filter((one) => (!one.kind || one.kind === "note") && !one.consumedAt);
  }

  if (has("json")) {
    const answer = asked.map((one) => ({
      id: one.id,
      screenId: one.screenId,
      ...(alsoAffected({ target: `${canvas}/${one.screenId}`, frames: graph.frames, closures: graph.closures, shell: graph.shell }) ?? { missing: true }),
    }));
    console.log(JSON.stringify(answer, (key, value) => (value instanceof Set ? [...value] : value), 2));
    return;
  }
  if (asked.length === 0) {
    console.log(`no open comments on ${canvas}`);
    return;
  }
  const lines = linesForComments(asked, { canvas, graph, system, all, screen: Boolean(argOf("screen")) });
  for (const one of asked) {
    const head = argOf("screen") ? one.screenId : `${one.id} on ${one.screenId}`;
    console.log(`${head}, also affected:`);
    for (const line of lines.get(one.id) ?? ["  that frame is not declared on this canvas any more"]) console.log(line);
  }
}

/* Run as a command only when this file is the one started (compared with symlinks resolved, so a linked checkout works). */
const started = (() => {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (started) {
  main().catch((error) => {
    console.error(`affected: ${String(error?.message ?? error).split("\n")[0]}`);
    process.exit(1);
  });
}
