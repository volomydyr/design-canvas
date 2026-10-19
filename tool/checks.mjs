/**
 * design-canvas — THE REUSE CHECKS: the verdicts, as functions that decide and never touch the disk or the screen.
 *
 * WHAT THEY ENFORCE. The formula for design work is: structure and content from the wireframes, feature parity
 * (business logic, queries, types) from the real original code, and the UI components, surfaces and styles from the pages
 * that are already the good design. Agents kept breaking the third part by taking a component from today's code into new
 * design. `registry.mjs` knows which components the design to build from is made of; this function judges an edit against it:
 *
 *   importVerdict    an import the edit ADDS that brings today's component into design work: refused. Logic (hooks, functions,
 *                    constants, types) from today's code is never refused: that is the parity half of the formula.
 *                    An import through a barrel (`index.ts`, `export * from`) is judged by the file that really defines the
 *                    name, and a dynamic `import("x")` is judged like a static one. A namespace import (`import * as B from`,
 *                    `export * as B from`) and a dynamic import that names no export bring in EVERY component the module or
 *                    barrel re-exports, so each of those is judged, and each today's component among them is named.
 *                    A component the original screen of an exploration already draws (its import closure) is the developer's
 *                    own and is allowed: a redesign that keeps it reuses that screen, it does not reach for other code.
 *
 * The refusal is overridden by a comment in the WRITTEN content, `reuse-check: <what>, because <reason>`. A reason is read
 * only from what the agent wrote in this very edit (the Write content, the Edit's new text), never from a transcript: a
 * transcript can be hundreds of megabytes and unreadable, and a reason that cannot be read makes the agent be refused again
 * for something it already answered.
 *
 * `judgeEdit` is the whole decision for one edit, with the file system and git reached through functions the caller passes
 * in, so the tests can hold every case without a project. `hook.mjs` is the thin shell that supplies the real ones.
 *
 * DELETE WITH: the design-canvas/ folder.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { resolveSpecifier } from "./closure.mjs";
import { componentExports, hasJsx, isComponentName, isNeverDesign, stripComments } from "./registry.mjs";

/* ------------------------------------------------------------------ what is design work */

/**
 * A `designFiles` entry as a test: a trailing "/" is a folder prefix, a "*" makes a glob, anything else is one file. A leading
 * "./" is dropped first, because the paths the checks compare against are project-relative without one.
 */
function designFilePattern(raw) {
  const entry = raw.replace(/^(?:\.\/)+/, "");
  if (entry.endsWith("/")) return (rel) => rel.startsWith(entry);
  if (entry.includes("*")) {
    const source = entry
      .split("**/")
      .map((part) =>
        part
          .split("**")
          .map((piece) => piece.split("*").map((chunk) => chunk.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*"))
          .join(".*"),
      )
      .join("(?:.*/)?");
    const re = new RegExp(`^${source}$`);
    return (rel) => re.test(rel);
  }
  return (rel) => rel === entry;
}

/** Is this project-relative path named by `settings.designFiles`? */
export function matchesDesignFiles(rel, designFiles) {
  return (designFiles ?? []).some((entry) => designFilePattern(entry)(rel));
}

/** Does the text hold one of the markers as a whole word? */
export function hasDesignMarker(text, markers) {
  return (markers ?? []).some((word) => new RegExp(`(?<![A-Za-z0-9_])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9_])`).test(text));
}

/**
 * Is this file design work? Never for the canvas itself, dependencies, build output and tests; only `.tsx` and `.jsx`.
 * Yes for a file that is new, one the build-from pages draw, one `designFiles` names, one whose text carries a marker.
 * `isUntracked(rel)` is asked last and only when the cheaper answers are all no, because it costs a git call.
 */
export function isDesignWork({ rel, text, existed, registry, settings, isUntracked }) {
  if (isNeverDesign(rel) || !/\.(tsx|jsx)$/.test(rel)) return false;
  if (!existed) return true;
  if (registry?.files && Object.hasOwn(registry.files, rel)) return true;
  if (matchesDesignFiles(rel, settings?.designFiles)) return true;
  if (hasDesignMarker(text ?? "", settings?.designMarkers)) return true;
  return Boolean(isUntracked?.(rel));
}

/* ------------------------------------------------------------------ reasons */

/**
 * Every well-formed reason in the text: a line holding `reuse-check:` (any case, so an upper-case REUSE-CHECK counts),
 * then a target, then the reason after ", because " or after a dash (an em dash, an en dash, " - " or " -- "). A reason needs
 * at least three words; fewer is not a reason. The end of a block comment or of an HTML comment is cut off the reason.
 */
export function parseReasons(text) {
  const out = [];
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const at = line.search(/reuse-check:/i);
    if (at === -1) continue;
    const rest = line.slice(at).replace(/^reuse-check:/i, "");
    const parts = /^\s*(.+?)(?:,\s*because\s+|\s+--?\s+|\s*[\u2014\u2013]\s*)(.+)$/i.exec(rest);
    if (!parts) continue;
    const target = parts[1].replace(/[`"']/g, "").trim();
    const reason = parts[2].replace(/\s*(?:\*\/\s*\}?|-->)\s*$/, "").trim();
    if (target === "" || reason.split(/\s+/).filter(Boolean).length < 3) continue;
    out.push({ target, reason });
  }
  return out;
}

const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Does a reason's target name this thing: the word itself, or any of the paths that mean it? */
function targetNames(target, name, paths = []) {
  if (new RegExp(`(?<![A-Za-z0-9_])${escapeRe(name)}(?![A-Za-z0-9_])`, "i").test(target)) return true;
  return paths.some((one) => one && target.toLowerCase().includes(one.toLowerCase()));
}

/* ------------------------------------------------------------------ imports */

/**
 * The imported or re-exported items of a text, one per name, with the specifier they come from. Whole statements marked
 * `import type` and individual names marked `type` carry `isType`. `import ... from`, `export ... from` and the dynamic
 * `import("spec")` count (the last as one item named `dynamic`: which name it takes from the module is only known at the
 * call site). COMMENTS ARE TAKEN OUT FIRST, so a commented-out import is never read and a comment inside the braces of an
 * import does not hide it. Spaces are optional where the language allows it: `import{A}from"a"` is read.
 */
export function importItems(text) {
  const items = [];
  const src = stripComments(text);
  const re = /\b(import|export)(?=[\s{*])(\s+type(?=[\s{*]))?([\w$*\s,{}]*?)(?<![\w$])from\s*(["'])([^"']+)\4/g;
  for (const match of src.matchAll(re)) {
    const [, keyword, typeWord, clause, , specifier] = match;
    if (clause.trim() === "") continue;
    const statementType = Boolean(typeWord);
    const brace = /\{([^}]*)\}/.exec(clause);
    const outside = clause.replace(/\{[^}]*\}/, "").split(",").map((one) => one.trim()).filter(Boolean);
    if (brace) {
      for (const part of brace[1].split(",")) {
        const piece = part.trim();
        if (!piece) continue;
        const isType = statementType || /^type\s+/.test(piece);
        const [imported, local] = piece.replace(/^type\s+/, "").split(/\s+as\s+/).map((one) => one.trim());
        items.push({ keyword, specifier, imported, local: local ?? imported, isType });
      }
    }
    for (const one of outside) {
      const star = /^\*(?:\s*as\s+([\w$]+))?$/.exec(one);
      if (star) items.push({ keyword, specifier, imported: "*", local: star[1] ?? "*", isType: statementType });
      else if (/^[\w$]+$/.test(one)) items.push({ keyword, specifier, imported: "default", local: one, isType: statementType });
    }
  }
  for (const specifier of dynamicImportSpecifiers(src)) {
    items.push({ keyword: "import()", specifier, imported: "dynamic", local: "dynamic", isType: false });
  }
  return items;
}

/**
 * The specifiers of the dynamic `import("spec")` calls in a text (given with its comments already taken out where they stand
 * at a line start; the rest are skipped here). Block and line comments may stand around the specifier inside the parentheses
 * (a webpackChunkName comment before it, a note after it) and a trailing comma may follow it; none of that hides the import.
 * Anything else inside the parentheses (a variable, a concatenation, a second argument) is no literal import and is left out.
 * Walked by hand instead of with one big pattern, so a text full of unterminated comments costs one pass and not one per call.
 */
function dynamicImportSpecifiers(src) {
  const out = [];
  const n = src.length;
  /* Once a search for a comment's end has failed, no later comment can end either: never search again. */
  let noMoreBlockEnds = false;
  /* The index after the spaces and comments that start at `i`, or -1 when a comment never ends. */
  const skip = (from) => {
    let i = from;
    for (;;) {
      while (i < n && /\s/.test(src[i])) i++;
      if (src[i] === "/" && src[i + 1] === "*") {
        const end = noMoreBlockEnds ? -1 : src.indexOf("*/", i + 2);
        if (end === -1) {
          noMoreBlockEnds = true;
          return -1;
        }
        i = end + 2;
      } else if (src[i] === "/" && src[i + 1] === "/") {
        while (i < n && src[i] !== "\n" && src[i] !== "\r") i++;
      } else {
        return i;
      }
    }
  };
  const opening = /\bimport\s*\(/g;
  for (let match = opening.exec(src); match !== null; match = opening.exec(src)) {
    let i = skip(match.index + match[0].length);
    if (i === -1 || (src[i] !== '"' && src[i] !== "'")) continue;
    const quote = src[i];
    const end = src.indexOf(quote, i + 1);
    const specifier = end === -1 ? "" : src.slice(i + 1, end);
    if (specifier === "" || /["']/.test(specifier)) continue;
    i = skip(end + 1);
    if (i !== -1 && src[i] === ",") i = skip(i + 1);
    if (i !== -1 && src[i] === ")") out.push(specifier);
  }
  return out;
}

const itemKey = (one) => `${one.specifier}|${one.imported}|${one.local}`;

/** The items the edit ADDS: present after, absent before. A name the file already imported is never judged again. */
export function addedItems(before, after) {
  const had = new Set(importItems(before).map(itemKey));
  return importItems(after).filter((one) => !had.has(itemKey(one)));
}

const relOf = (root, at) => path.relative(root, at).split(path.sep).join("/");

/** The names to compare a refusal with a part: the words of a camelCase or kebab name, lowercase. */
export function wordsOf(name) {
  return String(name ?? "")
    .replace(/\.[a-z]+$/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .map((one) => one.toLowerCase())
    .filter(Boolean);
}

const STOP_WORDS = new Set(["index", "component", "components", "view", "page", "ui", "tsx", "jsx", "props", "the", "of"]);

/**
 * The parts of the registry that share the most words with the given name, best first. `words` is a list of lowercase words,
 * or a name to split. Ties go to the part on more frames. Icon parts (an export whose name ends in `Icon`, a module called
 * `svgs.*` or `icons.*`) are skipped. Nothing at all when no word is shared: a guess that shares nothing is noise, and the
 * message then points at the registry listing instead.
 */
export function closestParts(words, registry, n) {
  const wanted = new Set((Array.isArray(words) ? words : wordsOf(words)).filter((one) => one.length > 1 && !STOP_WORDS.has(one)));
  if (wanted.size === 0 || !registry?.components) return [];
  const scored = [];
  for (const [rel, one] of Object.entries(registry.components)) {
    /* Icons are never a suggestion: each one is on every frame that draws any icon, so by frame count they would always win. */
    if (/^(?:svgs|icons)\.[a-z]+$/i.test(path.basename(rel))) continue;
    const fileWords = wordsOf(path.basename(rel));
    for (const name of one.exports) {
      if (/Icon$/.test(name)) continue;
      const have = new Set([...wordsOf(name), ...fileWords]);
      let score = 0;
      for (const word of wanted) if (have.has(word)) score++;
      if (score === 0) continue;
      scored.push({ name, rel, score, frames: one.frames.length, label: registry.frames?.[one.frames[0]]?.label ?? "" });
    }
  }
  scored.sort((a, b) => b.score - a.score || b.frames - a.frames || a.name.localeCompare(b.name));
  const seen = new Set();
  const out = [];
  for (const one of scored) {
    if (seen.has(one.name)) continue;
    seen.add(one.name);
    out.push({ name: one.name, rel: one.rel, frames: one.frames, label: one.label });
    if (out.length >= n) break;
  }
  return out;
}

const noun = (n) => `${n} ${n === 1 ? "frame" : "frames"}`;
const LISTED_BY = "The parts it builds from are listed by: node design-canvas/registry.mjs";

/** `RecordTable (on 12 frames, like "Tasks list")`, the long form of a part. */
const longPart = (part) => `${part.name} (on ${noun(part.frames)}${part.label ? `, like "${part.label}"` : ""})`;

/* ------------------------------------------------------------------ following re-exports to the real definition */

/** The names in the braces of an export list: `A, B as C, type D` gives [{ orig: "A", exported: "A" }, { orig: "B", exported: "C" }]. */
function exportNames(list) {
  const out = [];
  for (const part of list.split(",")) {
    if (/^\s*type\s/.test(part)) continue;
    const [orig, exported] = part.trim().split(/\s+as\s+/).map((one) => one.trim());
    if (orig) out.push({ orig, exported: exported ?? orig });
  }
  return out;
}

/**
 * What a module (given without comments) says about its exports: `defined`, the names it declares itself (`default` too), and
 * `edges`, the places it re-exports from: `export * from`, `export { a as b } from`, `export * as ns from`, and the
 * `import { A } from "./a"; export { A }` spelling of the same thing.
 */
function describeExports(plain) {
  const defined = new Set();
  const edges = [];
  if (/\bexport\s+default\b/.test(plain)) defined.add("default");
  for (const m of plain.matchAll(/\bexport\s+(?:declare\s+)?(?:async\s+)?(?:function\s*\*?|abstract\s+class|class|const|let|var|enum|type|interface)\s+([A-Za-z_$][\w$]*)/g)) defined.add(m[1]);
  for (const m of plain.matchAll(/\bexport\s*\*\s*(?:as\s+([\w$]+)\s*)?from\s*(["'])([^"']+)\2/g)) edges.push({ star: true, ns: m[1] ?? null, spec: m[3], names: [] });
  for (const m of plain.matchAll(/\bexport\s*(type\s+)?\{([^}]*)\}\s*from\s*(["'])([^"']+)\3/g)) {
    if (!m[1]) edges.push({ star: false, ns: null, spec: m[4], names: exportNames(m[2]) });
  }
  const bound = new Map();
  for (const one of importItems(plain)) if (one.keyword === "import" && !one.isType && one.imported !== "*") bound.set(one.local, one);
  for (const m of plain.matchAll(/\bexport\s*\{([^}]*)\}(?!\s*from\b)/g)) {
    for (const { orig, exported } of exportNames(m[1])) {
      const imported = bound.get(orig);
      if (imported) edges.push({ star: false, ns: null, spec: imported.specifier, names: [{ orig: imported.imported, exported }] });
      else defined.add(exported);
    }
  }
  return { defined, edges };
}

/** How many re-exports are followed before giving up: a barrel that re-exports a barrel that re-exports a barrel, five deep. */
const MAX_REEXPORT_DEPTH = 5;

/**
 * The file that REALLY defines `name` as imported from the module at `at`: that module itself when it declares the name, else
 * the file its `export ... from` statements lead to, followed up to five levels, with a guard against a cycle (two barrels
 * that export each other). `{ at, text, name }` (the name as it is called where it is defined, so `default` for a default
 * export), or null when it cannot be found (a package, an unreadable file, nothing exports it).
 */
export function findDefinition({ at, name, root, readText, depth = 0, seen = new Set() }) {
  const key = `${at}|${name}`;
  if (depth > MAX_REEXPORT_DEPTH || seen.has(key) || !/\.(tsx?|jsx?|mjs)$/.test(at)) return null;
  seen.add(key);
  let text;
  try {
    text = readText(at);
  } catch {
    return null;
  }
  const { defined, edges } = describeExports(stripComments(text));
  if (defined.has(name)) return { at, text, name };
  for (const edge of edges) {
    const next = resolveSpecifier(edge.spec, at, root);
    if (next === null) continue;
    if (edge.star) {
      /* `export *` never carries the default export; `export * as ns` makes a namespace, which is not one component. */
      if (edge.ns !== null || name === "default") continue;
      const found = findDefinition({ at: next, name, root, readText, depth: depth + 1, seen });
      if (found) return found;
    } else {
      for (const { orig, exported } of edge.names) {
        if (exported !== name) continue;
        const found = findDefinition({ at: next, name: orig, root, readText, depth: depth + 1, seen });
        if (found) return found;
      }
    }
  }
  return null;
}

/** Is `name`, as found by `findDefinition` in `found.text`, a component there? (`default` asks about the default export.) */
function isComponentThere(found) {
  const ce = componentExports(found.text);
  return found.name === "default" ? ce.defaultName !== null : ce.named.includes(found.name);
}

/**
 * EVERY component a module exports, its own and the ones it re-exports: what `import * as B from "x"` (or `export * as B`)
 * brings in. The module's own components first, then each `export * from`, `export * as ns from` and `export { a as b } from`
 * it holds, followed through the same up-to-five-level chain as `findDefinition`, with a module visited only once so a cycle
 * of barrels ends. `[{ at, text, name }]`, `at` the file that really defines it, `name` as the module exports it (the alias
 * of a renamed re-export), the default export under its own name. Unreadable modules and packages add nothing. `export *` never
 * carries the default export, so a module reached through one contributes only its named components.
 */
export function allComponents({ at, root, readText, depth = 0, seen = new Set(), withDefault = true }) {
  const visit = `${at}|${withDefault}`;
  if (depth > MAX_REEXPORT_DEPTH || seen.has(visit) || !/\.(tsx?|jsx?|mjs)$/.test(at)) return [];
  seen.add(visit);
  let text;
  try {
    text = readText(at);
  } catch {
    return [];
  }
  const out = [];
  const own = componentExports(text);
  for (const name of own.named) out.push({ at, text, name, orig: name });
  if (withDefault && own.defaultName !== null) out.push({ at, text, name: own.defaultName, orig: own.defaultName });
  for (const edge of describeExports(stripComments(text)).edges) {
    const next = resolveSpecifier(edge.spec, at, root);
    if (next === null) continue;
    if (edge.star) {
      out.push(...allComponents({ at: next, root, readText, depth: depth + 1, seen, withDefault: edge.ns !== null }));
    } else {
      for (const { orig, exported } of edge.names) {
        const found = findDefinition({ at: next, name: orig, root, readText, depth: depth + 1 });
        if (!found || !isComponentThere(found)) continue;
        const definedAs = found.name === "default" ? componentExports(found.text).defaultName : found.name;
        out.push({ at: found.at, text: found.text, name: exported === "default" ? definedAs : exported, orig: definedAs });
      }
    }
  }
  /* The same component reached twice (once under an alias, once as itself) is one: it is named the first time it is met. */
  const unique = new Map();
  for (const one of out) if (!unique.has(`${one.at}|${one.orig}`)) unique.set(`${one.at}|${one.orig}`, one);
  return [...unique.values()];
}

/**
 * The components this import brings in, each with where it is defined: `[{ at, text, name }]`, empty when it is logic (a
 * hook, a function, a constant, a schema) or cannot be told. A default import counts when the default export is a component
 * (followed through barrels); a named import when that name is. A namespace import (`import * as B from`, `export * as B
 * from`) brings in EVERY component the module exports or re-exports, and so does a dynamic `import("x")`: it names no export,
 * so the whole module is what it takes.
 */
function componentsBehind(item, at, root, readText) {
  if (item.imported === "*" || item.imported === "dynamic") return allComponents({ at, root, readText });
  if (item.imported === "default") {
    const found = findDefinition({ at, name: "default", root, readText });
    const ce = found ? componentExports(found.text) : null;
    if (found && ce.defaultName) return [{ at: found.at, text: found.text, name: isComponentName(item.local) ? item.local : ce.defaultName }];
    return [];
  }
  const found = findDefinition({ at, name: item.imported, root, readText });
  return found && isComponentThere(found) ? [{ at: found.at, text: found.text, name: item.imported }] : [];
}

/**
 * Judge the imports an edit adds. Returns `{ refused, given }`:
 *   refused  [{ kind: "component", name, specifier, module, message }]
 *   given    [{ name, reason }]   refusals that an agent's written reason lifted
 * `context` carries `root`, `rel` (the edited file), `before`, `after`, `written` (the pieces of text the agent wrote),
 * `registry`, `settings`, and `isUntracked(rel)`; `readText(absolute)` defaults to reading the disk.
 */
export function importVerdict(context) {
  const { root, rel, before, after, written, registry, settings, isUntracked } = context;
  const readText = context.readText ?? ((at) => readFileSync(at, "utf8"));
  const fromFile = path.join(root, rel);
  const reasons = parseReasons((written ?? []).join("\n"));
  const refused = [];
  const given = [];
  const seen = new Set();

  for (const item of addedItems(before, after)) {
    if (item.isType) continue;
    const at = resolveSpecifier(item.specifier, fromFile, root);

    if (at === null) continue;

    /* DOES THIS ITEM BRING IN A COMPONENT? Only a component is refused; a hook, a function, a constant, a schema is logic.
       The answer is looked for where the name is really DEFINED: an import through a barrel (`components/trash/index.ts`
       re-exporting `./trash-grid-view`) is judged by the file behind it, never by the barrel. */
    /* A namespace import and a whole dynamic import bring in every component of the module, so each one is judged on its own
       and each today's component among them is named in the refusal. */
    for (const behind of componentsBehind(item, at, root, readText)) {
      const { name, text } = behind;
      const moduleRel = relOf(root, behind.at);
      if (registry?.components && Object.hasOwn(registry.components, moduleRel)) continue;
      /* The developer's own: a component the redesigned screen's original already draws (`originals` in registry.mjs). */
      if (Array.isArray(registry?.originals) && registry.originals.includes(moduleRel)) continue;
      if (isDesignWork({ rel: moduleRel, text, existed: true, registry, settings, isUntracked })) continue;
      if (!/\.(tsx|jsx)$/.test(moduleRel) || !hasJsx(stripComments(text))) continue;
      if (seen.has(`component|${moduleRel}|${name}`)) continue;
      seen.add(`component|${moduleRel}|${name}`);

      const reason = reasons.find((one) => targetNames(one.target, name, [item.specifier, relOf(root, at), moduleRel]));
      if (reason) {
        given.push({ name, reason: reason.reason });
        continue;
      }
      const parts = closestParts([...wordsOf(name), ...wordsOf(path.basename(moduleRel))], registry, 2);
      const build =
        parts.length === 0
          ? LISTED_BY + "."
          : parts.length === 1
            ? `Build it with ${longPart(parts[0])}.`
            : `Build it with ${longPart(parts[0])} or ${parts[1].name}.`;
      refused.push({
        kind: "component",
        name,
        specifier: item.specifier,
        module: moduleRel,
        message: `Today's ${name} (${moduleRel}) is not part of the design new work builds from. ${build} If none fits, add a comment in the file, reuse-check: ${name}, because <reason>, and edit again.`,
      });
    }
  }
  return { refused, given };
}

/* ------------------------------------------------------------------ one edit, whole decision */

/**
 * One Edit or one MultiEdit step applied to a text, the way the tool applies it: the first match, or every match with
 * `replace_all`. Null when the edit cannot apply (the text is not there, or the edit is malformed): the tool will refuse that
 * edit itself, so the hook has nothing to judge.
 *
 * `creating` is true when the file does not exist yet. An edit with an EMPTY `old_string` on a file that does not exist is how
 * a file is created through the Edit tool, so it is read as a Write of `new_string`: without that, a new component file could
 * be made past every check. On a file that exists, an empty `old_string` stays an edit that cannot apply.
 */
export function applyEdit(text, edit, creating = false) {
  const { old_string: from, new_string: to, replace_all: all } = edit ?? {};
  if (creating && from === "" && typeof to === "string") return to;
  if (typeof from !== "string" || typeof to !== "string" || from === "" || !text.includes(from)) return null;
  if (all) return text.split(from).join(to);
  const at = text.indexOf(from);
  return text.slice(0, at) + to + text.slice(at + from.length);
}

/**
 * The whole decision for one edit. Returns `{ design, refused, given, message }`: `design` is false when the file is not
 * design work (nothing is judged), `refused` and `given` are the records for the log, `message` is the single refusal text
 * (several refusals listed one per line) or null when the edit may go ahead.
 *
 * `context`: `root`, `rel`, `existed`, `before`, `after`, `written`, `registry`, `settings`, `isUntracked(rel)`, and optionally
 * `readText(absolute)`.
 */
export function judgeEdit(context) {
  const { rel, existed, after, registry, settings, isUntracked } = context;
  if (!registry) return { design: false, refused: [], given: [], message: null };
  const design = isDesignWork({ rel, text: after, existed, registry, settings, isUntracked });
  if (!design) return { design: false, refused: [], given: [], message: null };
  const { refused, given } = importVerdict(context);
  return {
    design: true,
    refused: refused.map((one) => ({ check: "import", name: one.name })),
    given: given.map((one) => ({ check: "import", name: one.name, reason: one.reason })),
    message: refused.length === 0 ? null : refused.map((one) => one.message).join("\n"),
  };
}

