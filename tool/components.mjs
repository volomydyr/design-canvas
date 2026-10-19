#!/usr/bin/env node
/**
 * design-canvas — THE DESIGN SYSTEM: every component this project has, what it takes, where it is used, and whether the
 * design new work builds from uses it.
 *
 *   node design-canvas/components.mjs find "a menu of row actions"   what to use, best first, with a real usage example
 *   node design-canvas/components.mjs show components/ui/button.tsx  one component: exports, props, uses, frames
 *   node design-canvas/components.mjs state                          the state of the design system, in numbers
 *   node design-canvas/components.mjs --json                         the whole index
 *
 * WHY IT EXISTS, and who it is for FIRST. An agent about to write UI has to answer one question: does this already exist?
 * Every mechanism that answered it with prose lost ("prefer reuse" written as a rule never changed a single
 * run), and the one that worked was a registry the agent calls. The reuse check already refuses an import that the
 * approved design never uses, but a refusal only says no; this says what to use instead, which is the half an agent
 * cannot guess. The first goal is to help the agent; the second is to help a person make decisions and understand the
 * state of the design system.
 *
 * WHY IT IS THE WHOLE PROJECT AND NOT THE APPROVED PART. `registry.mjs` answers a narrower question, "is this part of the
 * design we build from", and lists only what the build-from frames reach. A design system that showed only that would
 * hide the thing an agent most needs to know: what else exists, and which of it is today's code not to build from. A
 * partial design system helps neither a person nor an agent decide. So every component file is indexed, and each one is marked
 * `approved` (the build-from design draws it) or not.
 *
 * WHAT IT READS, and what it never does. Files, once each, with no server, no browser and no build: a project of 1,157
 * component files is indexed in about a second. That is deliberate and is the reason this can run inside a PreToolUse
 * hook and on a machine with no room to spare.
 *
 * PER COMPONENT FILE:
 *   exports     the component names it exports (`registry.mjs` decides what a component is; a constant, a schema or a
 *               context is logic and is never one)
 *   approved    the build-from design reaches this file, with the frames it appears on (empty without `buildFrom`)
 *   props       the variant props and their values, read from a `cva(` block: the shapes the component already has, which
 *               is what a new variant has to be added to rather than overridden at a call site
 *   doc         the first sentence of the file's own leading comment, which is where a codebase states when to use a part
 *   decisions   every comment in the file that carries a date (YYYY-MM-DD): the decisions about this part, written beside the
 *               code they govern, newest first. That is the whole knowledge store: no other file, no database, no mining
 *   importers   how many files import it, and a few of them
 *   example     one real call site IN THE APPROVED DESIGN, with its line: a golden example beats a description, and the
 *               approved pages are the ones worth copying
 *   folder      its folder, which is how a project groups its system (`components/ui`, `components/common`)
 *
 * CACHED like the registry, in `design-canvas/rounds/components.json`, with the modification time of every file and folder
 * it was built from. Nothing is rebuilt while nothing has changed, and one new component file rebuilds it.
 *
 * DELETE WITH: the design-canvas/ folder.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { cached, IMPORT_RE, mtimeOf, resolveSpecifier, timesHold } from "./closure.mjs";
import { loadSettings } from "./project-settings.mjs";
import { exportedComponents, hasJsx, isNeverDesign, loadRegistry, stripComments } from "./registry.mjs";
/** Bumped when the index's shape changes, so a cache written by an older tool is rebuilt and never trusted. */
export const INDEX_VERSION = 5;

/** Folders never walked: dependencies, build output, version control, the canvas itself. */
const SKIP_DIRS = new Set(["node_modules", ".git", ".next", ".next-canvas", "design-canvas", "__tests__", "dist", "build", "coverage", ".turbo", ".vercel"]);

/** How many importers and how many frames are listed per component (a count is kept for all of them). */
const LIST_CAP = 8;

/** The most a `find` prints, and the most `state` names per group: a wall of results is the problem, not the answer. */
const FIND_CAP = 6;
const GROUP_CAP = 5;

const rel = (root, at) => path.relative(root, at).split(path.sep).join("/");

/**
 * Every component file in the project, and every folder walked on the way.
 *
 * The folders are recorded because a NEW component file changes its folder's modification time and nothing else: without
 * them a component added after the last build would stay invisible until something else happened to change.
 */
export function walkComponentFiles(root) {
  const files = [];
  const folders = [];
  const visit = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    folders.push(dir);
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const at = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
        visit(at);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!/\.(tsx|jsx)$/.test(entry.name)) continue;
      const path_ = rel(root, at);
      if (isNeverDesign(path_)) continue;
      files.push(path_);
    }
  };
  visit(root);
  return { files, folders: folders.map((at) => rel(root, at)) };
}

/**
 * The keys of an object body that are the object's OWN, never a nested object's.
 *
 * A variant's value is often an object (`open: { a: 1 }`), and reading its keys with a pattern over the whole body
 * returned the nested ones as variant values too (`open, a, shut, b` for two variants).
 */
function topLevelKeys(body) {
  const keys = [];
  let depth = 0;
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i];
    if (c === "{" || c === "[" || c === "(") depth += 1;
    else if (c === "}" || c === "]" || c === ")") depth -= 1;
    else if (depth === 0) {
      const key = /^([A-Za-z_$][\w$]*|"[^"]+"|'[^']+'|true|false)\s*:/.exec(body.slice(i));
      /* A key starts the body or follows a comma, so a word inside a value is never read as one. */
      if (key && (keys.length === 0 ? /^\s*$/.test(body.slice(0, i)) : /,\s*$/.test(body.slice(0, i)))) {
        keys.push(key[1].replace(/^["']|["']$/g, ""));
        i += key[0].length - 1;
      }
    }
  }
  return keys;
}

/**
 * The variant props a `cva(` block declares, as `{ prop: [values] }`.
 *
 * Why this and not the component's TypeScript props: a design system's real shapes live in its `cva` variants (a new
 * shape is usually a new value in the existing cva block, never a className override at the call site), and they are
 * the one part of a component's interface that is written as data rather than as types.
 * A props type would need a TypeScript program; this needs the file's text.
 */
export function variantProps(text) {
  const src = stripComments(text);
  const out = {};
  for (const call of src.matchAll(/\bcva\s*\(/g)) {
    const from = src.indexOf("variants", call.index);
    if (from === -1) continue;
    const open = src.indexOf("{", from);
    if (open === -1) continue;
    /* The `variants` object, by brace depth: its direct keys are the props, each holding an object of values. */
    let depth = 0;
    let end = -1;
    for (let i = open; i < src.length; i += 1) {
      if (src[i] === "{") depth += 1;
      else if (src[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) continue;
    const body = src.slice(open + 1, end);
    let at = 0;
    while (at < body.length) {
      const key = /([A-Za-z_$][\w$]*|"[^"]+"|'[^']+')\s*:\s*\{/.exec(body.slice(at));
      if (!key) break;
      const keyStart = at + key.index;
      const valueOpen = keyStart + key[0].length - 1;
      let d = 0;
      let valueEnd = -1;
      for (let i = valueOpen; i < body.length; i += 1) {
        if (body[i] === "{") d += 1;
        else if (body[i] === "}") {
          d -= 1;
          if (d === 0) {
            valueEnd = i;
            break;
          }
        }
      }
      if (valueEnd === -1) break;
      const prop = key[1].replace(/^["']|["']$/g, "");
      out[prop] = topLevelKeys(body.slice(valueOpen + 1, valueEnd));
      if (out[prop].length === 0) delete out[prop];
      at = valueEnd + 1;
    }
  }
  /* A part written without cva says its shapes in its types: `variant?: "primary" | "secondary"`, directly or through an
     alias (`type ButtonVariant = "primary" | "secondary"`). A union of two or more string literals is read the same way. */
  const unions = new Map();
  for (const m of src.matchAll(/\btype\s+([A-Z]\w*)\s*=\s*((?:\|\s*)?"[^"\n]+"(?:\s*\|\s*"[^"\n]+")+)/g)) unions.set(m[1], m[2]);
  for (const m of src.matchAll(/\b([a-z]\w*)\??\s*:\s*([A-Z]\w*|(?:\|\s*)?"[^"\n]+"(?:\s*\|\s*"[^"\n]+")+)/g)) {
    const union = m[2].startsWith('"') || m[2].startsWith("|") ? m[2] : unions.get(m[2]);
    if (!union || out[m[1]]) continue;
    const values = [...union.matchAll(/"([^"]+)"/g)].map((one) => one[1]);
    if (values.length >= 2) out[m[1]] = values;
  }
  return out;
}

/**
 * The first sentence of what a file says about itself: its leading comment, or the comment written directly above its
 * first exported component.
 *
 * THE SECOND PLACE IS WHERE MOST OF IT ACTUALLY IS. Many files describe a component under the imports, immediately above
 * the export, so reading only the top of the file misses most descriptions. A comment BETWEEN imports is about that import
 * and is still never read.
 */
export function leadingDoc(text) {
  const own = fileOwnDoc(text);
  if (own !== null) return own;
  /* The comment directly above the first exported component: the part's own description, written where it is declared. */
  const at = /\n(?:\/\*\*[\s\S]*?\*\/|(?:[ \t]*\/\/[^\n]*\n)+)\s*export\s+(?:default\s+)?(?:async\s+)?(?:function|const|let|var|class)\s/.exec(text);
  if (!at) return null;
  const comment = /\/\*\*([\s\S]*?)\*\//.exec(at[0]) ?? null;
  const body = comment ? comment[1] : at[0].split("\n").filter((line) => line.trim().startsWith("//")).map((line) => line.trim().replace(/^\/\/\s?/, "")).join(" ");
  return firstSentence(body);
}

/** The comment at the very top of a file, before any import, or null. */
function fileOwnDoc(text) {
  const head = text.slice(0, 4000);
  const block = /^\s*(?:"use client";?\s*|'use client';?\s*)?\/\*\*?([\s\S]*?)\*\//.exec(head);
  let body = null;
  if (block) body = block[1];
  else {
    const lines = [];
    for (const line of head.split("\n")) {
      const bare = line.trim();
      if (bare === "" || /^["']use client["'];?$/.test(bare)) {
        if (lines.length > 0) break;
        continue;
      }
      if (!bare.startsWith("//")) break;
      lines.push(bare.replace(/^\/\/\s?/, ""));
    }
    if (lines.length > 0) body = lines.join(" ");
  }
  return firstSentence(body);
}

/** One sentence, cleaned of a comment's own decoration, or null when there is nothing to say. */
function firstSentence(body) {
  if (body === null || body === undefined) return null;
  const words = body
    .split("\n")
    .map((line) => line.replace(/^\s*\*\s?/, "").trim())
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (words === "") return null;
  const stop = /[.!?](\s|$)/.exec(words);
  const first = stop ? words.slice(0, stop.index + 1) : words;
  return first.length > 240 ? `${first.slice(0, 237)}...` : first;
}

/**
 * WHAT WAS DECIDED ABOUT A PART: every comment in its file that carries a date.
 *
 * The decisions about a component live in the component's own file, as short dated comments that state the decision in
 * neutral words, written while that file is being edited anyway: `// 2026-10-18: never a second primary button in one footer`.
 * The older form with a label after the date (`// 2026-10-18, design review: ...`) is read the same way.
 * A comment beside the code it governs moves and changes with that code, and it needs nothing installed to read or write. So the
 * rule is the simplest one that holds in any codebase: a comment with a date in it is a decision, and the lookup prints
 * it. Any name, any wording, any project.
 *
 * The scanner skips strings, so a URL or a date inside code is never read as one.
 */
export function commentBlocks(text) {
  const blocks = [];
  let last = null;
  let line = 1;
  const n = text.length;
  for (let i = 0; i < n; ) {
    const c = text[i];
    const d = text[i + 1];
    if (c === "\n") {
      line += 1;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      /* A plain string ends at its line, so an apostrophe in JSX text never hides more than that line. */
      i += 1;
      while (i < n && text[i] !== c) {
        if (text[i] === "\\") i += 1;
        else if (text[i] === "\n") {
          if (c !== "`") break;
          line += 1;
        }
        i += 1;
      }
      if (text[i] === c) i += 1;
      continue;
    }
    if (c === "/" && d === "/") {
      const stop = text.indexOf("\n", i) === -1 ? n : text.indexOf("\n", i);
      const ownLine = /^[ \t]*$/.test(text.slice(text.lastIndexOf("\n", i - 1) + 1, i));
      const body = text.slice(i + 2, stop).trim();
      /* Consecutive `//` lines are one comment. */
      if (last && ownLine && last.ownLine && last.endLine === line - 1) {
        last.text += `\n${body}`;
        last.endLine = line;
      } else {
        last = { line, endLine: line, text: body, ownLine };
        blocks.push(last);
      }
      i = stop;
      continue;
    }
    if (c === "/" && d === "*") {
      const close = text.indexOf("*/", i + 2);
      const stop = close === -1 ? n : close;
      const raw = text.slice(i + 2, stop);
      const body = raw
        .split("\n")
        .map((one) => one.replace(/^\s*\*+\s?/, "").trim())
        .join("\n")
        .trim();
      blocks.push({ line, endLine: line + (raw.match(/\n/g) ?? []).length, text: body });
      line += (raw.match(/\n/g) ?? []).length;
      last = null;
      i = stop + 2;
      continue;
    }
    i += 1;
  }
  return blocks;
}

const DATE_RE = /\b20\d\d-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])\b/g;
const DECISION_CAP = 360;

/** A long comment cut to what an agent needs: its headline, then the sentence the date sits in. */
function clipDecision(flat) {
  if (flat.length <= DECISION_CAP) return flat;
  const dateAt = flat.search(DATE_RE);
  const sentenceAt = Math.max(0, flat.lastIndexOf(". ", dateAt) + 2);
  if (sentenceAt < 160) return `${flat.slice(0, DECISION_CAP - 3)}...`;
  const head = /^.{1,160}?[.!?](\s|$)/.exec(flat)?.[0].trim() ?? `${flat.slice(0, 120)}...`;
  const room = DECISION_CAP - head.length - 7;
  return `${head} [...] ${flat.slice(sentenceAt, sentenceAt + room)}${flat.length > sentenceAt + room ? "..." : ""}`;
}

/** The decisions in one file's text, newest first: `{ at, line, text }`. */
export function decisionsIn(text) {
  const out = [];
  for (const block of commentBlocks(text)) {
    const flat = block.text.replace(/\s+/g, " ").trim();
    const dates = flat.match(DATE_RE);
    if (!dates) continue;
    out.push({ at: [...dates].sort().at(-1), line: block.line, text: clipDecision(flat) });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at) || a.line - b.line);
}

/**
 * What agents wrote to pass the reuse check (`rounds/checks-log.jsonl`): a sentence about whether a part fits, left
 * behind by an edit that was refused. Read, never required: a project where nothing was refused has no log.
 */
export function readKnowledge(canvasDir) {
  const reasons = new Map();
  const refusals = new Map();
  try {
    for (const line of readFileSync(path.join(canvasDir, "rounds", "checks-log.jsonl"), "utf8").split("\n")) {
      if (line.trim() === "") continue;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      const name = entry.name;
      if (typeof name !== "string" || name === "") continue;
      if (entry.outcome === "refused") refusals.set(name, (refusals.get(name) ?? 0) + 1);
      if (typeof entry.reason === "string" && entry.reason.trim() !== "") {
        if (!reasons.has(name)) reasons.set(name, []);
        const list = reasons.get(name);
        const said = entry.reason.trim();
        if (!list.some((one) => one.reason === said)) list.push({ reason: said, file: entry.file ?? null, at: entry.at ?? null });
      }
    }
  } catch {
    /* No log yet. */
  }
  const files = [path.join(path.basename(canvasDir), "rounds", "checks-log.jsonl").split(path.sep).join("/")];
  return { reasons, refusals, files };
}

/**
 * The design system's sets, by the file each one draws, as the last `system-capture.mjs` wrote them: the parts on the
 * Design System tab. Empty until a set is photographed.
 */
export function readSystem(canvasDir) {
  const out = {};
  try {
    const manifest = JSON.parse(readFileSync(path.join(canvasDir, "shots", "_system", "manifest.json"), "utf8"));
    for (const set of manifest.sets ?? []) {
      /* The grid's own words ("Warning", "Icon only") are a designer's words for the variants, so `find` matches on them. */
      const labels = (set.blocks ?? []).flatMap((block) => [block.title, ...block.rows.map((one) => one.label), ...block.columns.map((one) => one.label)]);
      (out[set.source] ??= []).push({ id: set.id, name: set.name, level: set.level, group: set.group, labels });
    }
  } catch {
    /* Nothing photographed yet. */
  }
  return out;
}

/**
 * LOOK-ALIKES: parts that do one job. A component's job is the last word of its name (`IconButton`, `GhostButton` and
 * `Button` are all buttons; `DialogContent` is a piece of a dialog, not another dialog), and the raw HTML element is the
 * same job done with no part at all. Fifty buttons where one would do is the failure this exists to make visible.
 */
const KINDS = {
  button: { words: ["button", "btn"], tag: "button" },
  menu: { words: ["menu", "dropdown"] },
  dialog: { words: ["dialog", "modal"], tag: "dialog" },
  sheet: { words: ["sheet", "drawer"] },
  "pill or badge": { words: ["pill", "badge", "chip", "tag"] },
  "text field": { words: ["input", "field", "textarea"], tag: "input" },
  select: { words: ["select", "picker", "combobox"], tag: "select" },
  tabs: { words: ["tabs", "tab"] },
  card: { words: ["card"] },
  toggle: { words: ["toggle", "switch", "checkbox"] },
  tooltip: { words: ["tooltip", "popover"] },
  table: { words: ["table"], tag: "table" },
};
const RAW_TAGS = [...new Set(Object.values(KINDS).map((one) => one.tag).filter(Boolean))];

/** The surfaces that open over a page, by the same name table: what a coverage check looks for behind a screen. */
const SURFACES = ["dialog", "sheet", "menu"];

/** "dialog", "sheet" or "menu" when a component's name says it is one (its last word, as `KINDS` reads names), else null. */
export function surfaceKind(name) {
  const last = nameWords(name).at(-1);
  return SURFACES.find((kind) => KINDS[kind].words.includes(last)) ?? null;
}

/** How often each raw element is drawn in one file's text. */
function rawSites(text) {
  const src = stripComments(text);
  const out = {};
  for (const tag of RAW_TAGS) {
    const count = (src.match(new RegExp(`<${tag}(?=[\\s/>])`, "g")) ?? []).length;
    if (count > 0) out[tag] = count;
  }
  return out;
}

/** The direct project-relative imports of one file's text, resolved to repo-relative paths. */
function importsOf(text, file, root) {
  const out = new Set();
  for (const match of text.matchAll(IMPORT_RE)) {
    const spec = match[1] ?? match[2];
    if (!spec) continue;
    const at = resolveSpecifier(spec, file, root);
    if (at) out.add(rel(root, at));
  }
  return [...out];
}

/**
 * The line a file first draws `<Name` on, as `{ line, text }`, or null.
 *
 * THE END OF THE LINE COUNTS AS A BOUNDARY. A component with its props on the following lines is written `<MenuRow`
 * and nothing else on that line, which is the normal shape for anything taking more than one prop; requiring a
 * character after the name found the tag in the whole file and in none of its lines, so the most-used parts in the
 * project came back with no example at all.
 */
function drawnAt(text, name) {
  const lines = text.split("\n");
  const tag = new RegExp(`<${name}(?=[\\s/>]|$)`);
  for (let i = 0; i < lines.length; i += 1) {
    if (!tag.test(lines[i])) continue;
    /* THE WHOLE OPENING TAG, not the line it starts on: `<MenuRow` alone is nothing anybody can copy. Take lines
       until the tag closes, and no more than a handful, because the point is the shape and its props. */
    const taken = [];
    for (let j = i; j < lines.length && taken.length < 8; j += 1) {
      const closes = /\/?>\s*$/.test(lines[j]);
      /* The source's own commentary is not part of the shape to copy, and a long one ate the whole snippet. */
      const bare = lines[j].trim();
      if (!bare.startsWith("//") && !bare.startsWith("/*") && !bare.startsWith("*")) taken.push(lines[j]);
      if (closes) break;
    }
    if (taken.length === 0) continue;
    /* Printed as written, minus the indentation the first line carries, so it reads as a snippet and not as a column. */
    const indent = /^\s*/.exec(taken[0])[0].length;
    const snippet = taken.map((line) => line.slice(Math.min(indent, /^\s*/.exec(line)[0].length))).join("\n");
    return { line: i + 1, text: snippet.length > 600 ? `${snippet.slice(0, 597)}...` : snippet };
  }
  return null;
}

/**
 * Build the index: every component file, with what the header above lists.
 *
 * `registry` is the build-from registry (`registry.mjs`) or null. It decides one field, `approved`, and where the usage
 * examples are taken from, and nothing else: with no design named to build from the index is still the whole system.
 */
export function buildIndex({ root, registry, knowledge = { reasons: new Map(), refusals: new Map() } }) {
  const { files, folders } = walkComponentFiles(root);
  const approvedFiles = new Set(Object.keys(registry?.components ?? {}));
  const framesOf = (file) => registry?.components?.[file]?.frames ?? [];

  /* One read per file: its text answers every question asked of it, and is then dropped. */
  const texts = new Map();
  const found = new Map();
  const importedBy = new Map();
  const fileMtimes = {};
  const raw = {};
  for (const file of files) {
    const at = path.join(root, file);
    let text;
    try {
      text = readFileSync(at, "utf8");
    } catch {
      continue;
    }
    fileMtimes[file] = mtimeOf(at);
    texts.set(file, text);
    const sites = rawSites(text);
    if (Object.keys(sites).length > 0) raw[file] = sites;
    const imports = importsOf(text, at, root);
    for (const target of imports) {
      if (!importedBy.has(target)) importedBy.set(target, []);
      importedBy.get(target).push(file);
    }
    const exports = hasJsx(text) ? [...new Set(exportedComponents(text))] : [];
    if (exports.length === 0) continue;
    found.set(file, {
      exports: exports.sort(),
      imports: imports.filter((one) => one !== file).sort(),
      approved: approvedFiles.has(file),
      frames: framesOf(file).slice(0, LIST_CAP),
      frameCount: framesOf(file).length,
      props: variantProps(text),
      doc: leadingDoc(text),
      decisions: decisionsIn(text),
      folder: file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : ".",
    });
  }

  /* Importers, and one example from the approved design. A component's own file importing itself is not a use. */
  for (const [file, entry] of found) {
    const users = (importedBy.get(file) ?? []).filter((one) => one !== file).sort();
    entry.importers = users.length;
    entry.importedBy = users.slice(0, LIST_CAP);
    entry.example = null;
    const first = entry.exports[0];
    /* An approved call site first, because those pages are the ones worth copying; any call site otherwise. */
    for (const candidate of [...users.filter((one) => approvedFiles.has(one)), ...users]) {
      const text = texts.get(candidate);
      if (!text) continue;
      for (const name of entry.exports) {
        const site = drawnAt(text, name);
        if (!site) continue;
        entry.example = { file: candidate, line: site.line, text: site.text, name, approved: approvedFiles.has(candidate) };
        break;
      }
      if (entry.example) break;
    }
    if (entry.example === null && first) entry.example = null;

    /* What agents said when the reuse check stopped them reaching for it. */
    entry.refused = entry.exports.reduce((sum, name) => sum + (knowledge.refusals.get(name) ?? 0), 0);
    entry.reasons = entry.exports
      .flatMap((name) => (knowledge.reasons.get(name) ?? []).map((one) => ({ ...one, name })))
      .sort((a, b) => String(b.at).localeCompare(String(a.at)))
      .slice(0, 3);
  }

  const components = {};
  for (const file of [...found.keys()].sort()) components[file] = found.get(file);
  const folderMtimes = {};
  for (const folder of folders) folderMtimes[folder] = mtimeOf(path.join(root, folder));
  /* The reuse check's log: a reason written a minute ago has to show. */
  for (const known of knowledge.files ?? []) fileMtimes[known] = mtimeOf(path.join(root, known));

  const values = Object.values(components);
  return {
    version: INDEX_VERSION,
    builtAt: new Date().toISOString(),
    buildFrom: registry?.buildFrom ?? [],
    counts: {
      files: values.length,
      components: values.reduce((sum, one) => sum + one.exports.length, 0),
      approved: values.filter((one) => one.approved).length,
      today: values.filter((one) => !one.approved).length,
      unused: values.filter((one) => one.importers === 0).length,
      withProps: values.filter((one) => Object.keys(one.props).length > 0).length,
      /* How much of the system says when to use it: a decision beside its code, a description of its own, a reason from real work. */
      withDecision: values.filter((one) => one.decisions.length > 0).length,
      withReason: values.filter((one) => one.reasons.length > 0).length,
      withDoc: values.filter((one) => one.doc).length,
    },
    components,
    raw,
    files: fileMtimes,
    folders: folderMtimes,
  };
}

/** Is a cached index still the answer? Same version, same canvases named, every recorded modification time unchanged. */
function isFresh(cached, root, buildFrom) {
  if (!cached || cached.version !== INDEX_VERSION) return false;
  if (JSON.stringify(cached.buildFrom ?? []) !== JSON.stringify(buildFrom)) return false;
  /* A new component file moves its folder's time and nothing else, so the folders are what catch an addition. */
  return timesHold(root, cached.files, cached.folders);
}

/** The index for this project: the cache when nothing has changed, otherwise a fresh build, written back when it can be. */
export async function loadIndex({ root, canvasDir, settings, cachePath, registry }) {
  const built = registry === undefined ? await loadRegistry({ root, canvasDir, settings }) : registry;
  const buildFrom = built?.buildFrom ?? [];
  return cached(
    cachePath ?? path.join(canvasDir, "rounds", "components.json"),
    (value) => isFresh(value, root, buildFrom),
    () => buildIndex({ root, registry: built, knowledge: readKnowledge(canvasDir) }),
  );
}

/** The words of a phrase, lowercase, without the ones that carry no meaning in a search. */
export function words(phrase) {
  /* Words that carry no meaning in a search. `one`, `few`, `some` and `any` are here because a question such as "one of a
     few exclusive choices" otherwise matches whatever is called `OneScrollPageSwitch`, which is a wrong answer given
     with the tool's blessing. */
  const stop = new Set(["a", "an", "the", "of", "for", "to", "in", "on", "with", "and", "or", "that", "this", "it", "is", "my", "our", "one", "few", "some", "any", "new", "all"]);
  return [...new Set(String(phrase).toLowerCase().split(/[^a-z0-9]+/).filter((one) => one.length > 1 && !stop.has(one)))];
}

/** A name split into its words: `RecordTable` is "record table", `task-list` is "task list". */
function nameWords(text) {
  return String(text)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * What to use for the thing described, best first.
 *
 * EACH EXPORTED NAME IS SCORED ON ITS OWN, and a file is only as good as its best name. Pooled together, a file with
 * hundreds of icon exports would top almost every search, because one of its names shares a word with anything. A name is
 * also judged on how much of IT the question explains, so `EmptyState` answers "an empty state" and `EmptyListIcon` does not.
 *
 * The weights, in order: the matched NAME is the strongest signal an agent has, then the file's own description, then its
 * folder and path. Being part of the approved design is worth more than any single word, because an approved part is the
 * answer even when a closer-named one sits in today's code: that is the whole point of the reuse rule. How much a part is
 * used breaks the remaining ties, since the thing fifty files already draw is the system's own answer.
 */
export function find(index, phrase, { cap = FIND_CAP, approvedOnly = false, system = {} } = {}) {
  const wanted = words(phrase);
  if (wanted.length === 0) return [];
  const scored = [];
  for (const [file, entry] of Object.entries(index.components)) {
    if (approvedOnly && !entry.approved) continue;
    const doc = words(entry.doc ?? "");
    /* A decision, a reason an agent wrote and the tab's own labels are the words of the PROBLEM, not of the code, so
       they are the one signal that can answer a question the names cannot. */
    const said = words(
      [
        ...(entry.decisions ?? []).slice(0, 12).map((one) => one.text),
        ...(entry.reasons ?? []).map((one) => one.reason),
        ...(system[file] ?? []).flatMap((set) => [set.name, set.group, ...(set.labels ?? [])]),
      ].join(" "),
    );
    const place = nameWords(file);
    /* The file's own signals, counted once however many names it exports. */
    let around = 0;
    for (const word of wanted) {
      if (doc.includes(word)) around += 4;
      else if (said.includes(word)) around += 4;
      else if (place.includes(word)) around += 3;
    }
    let best = 0;
    let matched = null;
    for (const name of entry.exports) {
      const parts = nameWords(name);
      let hits = 0;
      let near = 0;
      for (const word of wanted) {
        if (parts.includes(word)) hits += 1;
        else if (word.length > 3 && parts.some((one) => one.startsWith(word) || word.startsWith(one))) near += 1;
      }
      if (hits === 0 && near === 0) continue;
      /* How much of the NAME the question explains: a whole name answered beats one word of a longer name. */
      const covered = parts.length === 0 ? 0 : hits / parts.length;
      const score = hits * 10 + near * 2 + covered * 8;
      if (score > best) {
        best = score;
        matched = name;
      }
    }
    /* A WEAK MATCH IS WORSE THAN NONE. A name has to carry a whole word of the question, or its description has to carry
       two: "one of a few exclusive choices" shares no word with `RadioGroup`, and answering it with whatever happened to
       score 3 sends an agent to the wrong part with the tool's blessing. Nothing found is a true answer, and the caller
       says so and points at the listing. */
    const strong = best >= 10 || around >= 8;
    if (!strong) continue;
    let score = best + around;
    if (entry.approved) score += 12;
    /* A part of the design system is the shared vocabulary: it leads any other match of the same strength. */
    if (system[file]) score += 10;
    score += Math.min(entry.importers, 10) / 10;
    scored.push({ file, score, matched: matched ?? entry.exports[0] ?? null, ...entry });
  }
  return scored.sort((a, b) => b.score - a.score || b.importers - a.importers).slice(0, cap);
}

/** One line for a component in a list: its names, where it is, and whether new design builds from it. */
function oneLine(entry) {
  const names = entry.exports.slice(0, 3).join(", ") + (entry.exports.length > 3 ? `, +${entry.exports.length - 3}` : "");
  const mark = entry.approved ? "approved" : "today's code";
  return `${names}  (${entry.file ?? ""})  ${mark}, used by ${entry.importers}`;
}

/** Everything an agent needs about one component, as lines. `all` prints every decision, not the newest three. */
export function describe(entry, file, system = {}, { all = false, judged = true } = {}) {
  const out = [];
  out.push(`${entry.exports.join(", ")}  (${file})`);
  for (const set of system[file] ?? []) out.push(`  on the Design System tab: ${set.name} (set "${set.id}", ${set.level}, section "${set.group}")`);
  /* The decisions first: they are the one thing the code's shape does not say, and the reason an agent is asking. */
  const decisions = entry.decisions ?? [];
  const shown = all ? decisions : decisions.slice(0, 3);
  for (const one of shown) out.push(`  decided ${one.at} (${file}:${one.line}): ${one.text}`);
  if (decisions.length > shown.length) out.push(`  ${decisions.length - shown.length} more decision(s): node design-canvas/components.mjs show ${file}`);
  /* Approved or not means something only once a design to build from is named. */
  if (judged) out.push(entry.approved ? `  the approved design draws this, on ${entry.frameCount} frame(s)${entry.frames.length ? `: ${entry.frames.slice(0, 4).join(", ")}` : ""}` : "  today's code: new design does not build from this");
  if (entry.doc) out.push(`  ${entry.doc}`);
  for (const said of entry.reasons ?? []) out.push(`  said in real work (${said.file ?? "unknown file"}): ${said.reason}`);
  if (entry.refused > 0) out.push(`  the reuse check has refused reaching for this ${entry.refused} time(s) in design work`);
  const props = Object.entries(entry.props);
  if (props.length > 0) out.push(`  props: ${props.map(([prop, values]) => `${prop}=${values.join("|")}`).join("  ")}`);
  out.push(`  used by ${entry.importers} file(s)${entry.importedBy.length ? `: ${entry.importedBy.slice(0, 4).join(", ")}` : ""}`);
  if (entry.example) out.push(`  example${judged ? ` (${entry.example.approved ? "approved" : "today's"})` : ""} ${entry.example.file}:${entry.example.line}: ${entry.example.text}`);
  return out;
}

/**
 * Look-alikes, by job. The SHARED part of a job is its most-used one; a look-alike that draws it is a composition (a
 * feature's dialog built on the shared Dialog), and one that does not is the same job built a second time, which is the
 * number to watch. The raw element is the job done with no part at all.
 */
export function lookalikes(index, system = {}) {
  const out = [];
  for (const [kind, { words: heads, tag }] of Object.entries(KINDS)) {
    const files = [];
    for (const [file, entry] of Object.entries(index.components)) {
      const names = entry.exports.filter((name) => {
        const parts = nameWords(name);
        return parts.length > 0 && heads.includes(parts.at(-1));
      });
      if (names.length > 0) files.push({ file, names, importers: entry.importers, imports: entry.imports ?? [] });
    }
    /* The raw element outside the shared part itself: `Button` drawing its own `<button>` is the one that should exist. */
    const rawUse = tag ? { sites: 0, files: 0 } : null;
    if (files.length === 0 && !Object.values(index.raw ?? {}).some((sites) => tag && sites[tag])) continue;
    /* The shared ones: the parts on the Design System tab, else the one named for the job itself (`Card`), else the most used. */
    /* A tab part counts when the set is THAT part (`Select`'s file also exports `SelectScrollDownButton`, no second button). */
    const squash = (text) => text.toLowerCase().replace(/[^a-z0-9]/g, "");
    const onTab = files.filter((one) => (system[one.file] ?? []).some((set) => one.names.some((name) => squash(name) === squash(set.name))));
    const rank = (one) => [one.names.some((name) => heads.includes(name.toLowerCase())) ? 1 : 0, one.importers];
    const best = [...files].sort((a, b) => rank(b)[0] - rank(a)[0] || rank(b)[1] - rank(a)[1])[0];
    const shared = onTab.length > 0 ? onTab : best ? [best] : [];
    const sharedFiles = new Set(shared.map((one) => one.file));
    /* A part the shared one is built ON (the primitive under a wrapper) is not a second one. */
    const under = new Set(shared.flatMap((one) => one.imports));
    const apart = files.filter((one) => !sharedFiles.has(one.file) && !under.has(one.file) && !one.imports.some((dep) => sharedFiles.has(dep)));
    if (tag)
      for (const [file, sites] of Object.entries(index.raw ?? {}))
        if (sites[tag] && !sharedFiles.has(file) && !under.has(file)) {
          rawUse.sites += sites[tag];
          rawUse.files += 1;
        }
    out.push({
      kind,
      components: files.reduce((sum, one) => sum + one.names.length, 0),
      files: files.length,
      shared: shared.map((one) => ({ name: one.names[0], file: one.file, importers: one.importers })),
      apart: [...new Set(apart.map((one) => one.names[0]))].sort(),
      tag: tag ?? null,
      raw: rawUse,
    });
  }
  return out.sort((a, b) => b.apart.length + (b.raw?.sites ?? 0) - (a.apart.length + (a.raw?.sites ?? 0)));
}

/**
 * The state of the design system, in numbers and names.
 *
 * Written for the second reader, a person: how much of the system the approved design actually uses, what carries no
 * variants, what nothing uses, and which names exist twice. Every line is read from the code, so none of it can drift.
 */
export function state(index, system = {}) {
  const entries = Object.entries(index.components).map(([file, one]) => ({ file, ...one }));
  const byName = new Map();
  for (const one of entries)
    for (const name of one.exports) {
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push(one.file);
    }
  const twice = [...byName.entries()].filter(([, files]) => files.length > 1).sort((a, b) => b[1].length - a[1].length);
  const unused = entries.filter((one) => one.importers === 0).sort((a, b) => (a.file < b.file ? -1 : 1));
  const folders = new Map();
  for (const one of entries) folders.set(one.folder, (folders.get(one.folder) ?? 0) + 1);
  return {
    counts: index.counts,
    busiest: entries.sort((a, b) => b.importers - a.importers).slice(0, GROUP_CAP),
    folders: [...folders.entries()].sort((a, b) => b[1] - a[1]).slice(0, GROUP_CAP),
    twice: twice.slice(0, GROUP_CAP),
    twiceCount: twice.length,
    unused: unused.slice(0, GROUP_CAP),
    unusedCount: unused.length,
    lookalikes: lookalikes(index, system),
  };
}

/* ------------------------------------------------------------------ the command */

const HERE = path.dirname(fileURLToPath(import.meta.url));

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const argv = process.argv.slice(2);
  const canvasDir = HERE;
  const root = path.dirname(canvasDir);
  const settings = loadSettings(canvasDir, "components");
  const index = await loadIndex({ root, canvasDir, settings });
  const command = argv[0] ?? (argv.includes("--json") ? "--json" : "state");

  if (argv.includes("--json")) {
    console.log(JSON.stringify(index, null, 2));
  } else if (command === "find") {
    const phrase = argv.slice(1).filter((one) => !one.startsWith("--")).join(" ");
    if (!phrase) {
      console.error('components: find takes words, for example: find "a menu of row actions"');
      process.exit(2);
    }
    const system = readSystem(canvasDir);
    const hits = find(index, phrase, { approvedOnly: argv.includes("--approved"), system });
    if (hits.length === 0) {
      console.log(
        `Nothing in this project matches "${phrase}". If it is a part other screens will need too (a button, a field, a menu), build it once as a shared component, then add its set to design-canvas/project/system.tsx and photograph it (node design-canvas/system-capture.mjs --only <set id>). Otherwise keep it local to the screen.`,
      );
    } else {
      console.log(`For "${phrase}", best first:\n`);
      for (const hit of hits) {
        for (const line of describe(hit, hit.file, system, { judged: index.buildFrom.length > 0 })) console.log(line);
        console.log("");
      }
      if (index.buildFrom.length > 0) console.log(`"approved" means the ${index.buildFrom.join(", ")} canvas(es) draw it. Build from those; a part marked today's code is refused in design work.`);
    }
  } else if (command === "show") {
    const file = argv[1];
    const entry = index.components[file];
    if (!entry) {
      console.error(`components: ${file ?? "(no file given)"} is not a component file in this project. Try: components.mjs find "<what it does>"`);
      process.exit(1);
    }
    for (const line of describe(entry, file, readSystem(canvasDir), { all: true, judged: index.buildFrom.length > 0 })) console.log(line);
  } else {
    const report = state(index, readSystem(canvasDir));
    const c = report.counts;
    console.log(`${c.files} component file(s), ${c.components} exported component(s)`);
    if (index.buildFrom.length > 0) console.log(`  ${c.approved} drawn by the approved design (${index.buildFrom.join(", ")}), ${c.today} are today's code`);
    else console.log(`  no design named to build from yet (settings.json "buildFrom"), so nothing is marked approved`);
    console.log(`  ${c.withProps} carry variant props, ${c.withDecision} carry a dated decision, ${c.unused} are imported by nothing`);
    const tab = Object.values(readSystem(canvasDir)).flat();
    console.log(`  ${tab.length} set(s) on the Design System tab${tab.length ? `: ${tab.map((one) => one.name).join(", ")}` : ""}`);
    console.log(`\nLook-alikes (parts doing one job; the goal is one shared part per job):`);
    for (const one of report.lookalikes) {
      const parts = [];
      if (one.shared.length > 0) parts.push(`${one.files} ${one.kind} part(s); shared: ${one.shared.map((s) => `${s.name} (${s.file}, used by ${s.importers})`).join(", ")}`);
      if (one.apart.length > 0) parts.push(`${one.apart.length} built without it (${one.apart.slice(0, 8).join(", ")}${one.apart.length > 8 ? `, +${one.apart.length - 8}` : ""})`);
      if (one.raw?.sites) parts.push(`raw <${one.tag}> at ${one.raw.sites} place(s) in ${one.raw.files} file(s)`);
      console.log(`  ${parts.join("; ")}`);
    }
    console.log(`\nMost used:`);
    for (const one of report.busiest) console.log(`  ${oneLine(one)}`);
    console.log(`\nBiggest folders:`);
    for (const [folder, count] of report.folders) console.log(`  ${folder}  ${count} file(s)`);
    if (report.twiceCount > 0) {
      console.log(`\n${report.twiceCount} name(s) exist in more than one file, which is where an agent picks the wrong one:`);
      for (const [name, files] of report.twice) console.log(`  ${name}: ${files.join(", ")}`);
    }
    if (report.unusedCount > 0) {
      console.log(`\n${report.unusedCount} file(s) nothing imports:`);
      for (const one of report.unused) console.log(`  ${one.file}`);
    }
  }
}
