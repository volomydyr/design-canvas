#!/usr/bin/env node
/**
 * design-canvas — THE REGISTRY: which parts the design new work builds from is actually made of.
 *
 *   node design-canvas/registry.mjs          a short summary: how many frames and components, then each component
 *   node design-canvas/registry.mjs --json   the registry itself
 *
 * WHY IT EXISTS. The reuse checks (`checks.mjs`) have to answer one question for every import an agent writes into design
 * work: is this component part of the design we build from, or is it today's code? The canvas already knows the answer
 * without anyone typing a folder name into a rule: `design-canvas/settings.json` names the canvases to build from
 * (`buildFrom`), each canvas declares its frames, and each frame names the files that draw it. So the registry is worked
 * out from that, every time it is needed:
 *
 *   1. the frames of the named canvases (every screen of every flow, minus the ones that are not a picture of the real
 *      built design: explanation panels, references to somebody else's product, stills of the old app, wireframes;
 *      explorations never count, they are options not yet chosen),
 *   2. the import closure of each frame's `source` files, walked with `closure.mjs`, the same walk the capture stamps with,
 *   3. every component in those closures (a `.tsx` or `.jsx` file outside `design-canvas/` and outside tests that draws
 *      JSX and exports a component), with the frames it appears on. An exported name is a component when it is capitalized,
 *      not ALL_CAPS, and is a function declaration or a `const` holding an arrow function, a function expression or a
 *      `memo(`, `forwardRef(` or `lazy(` call, or an alias of a component that already exists (`DialogPrimitive.Root`,
 *      `observer(Panel)`, `styled(Button)`, a `styled.div` template); a constant, a schema or a context is logic and is
 *      never counted.
 *   4. on every canvas, the component files in the import closure of each exploration's `original` screen (`originals`):
 *      the developer's own, which the reuse check allows a redesign of that screen to keep.
 *
 * Because it follows the CODE, an improvement to a build-from page counts the moment it lands: a new shared component that
 * the Tasks page starts using is in the registry as soon as the file is saved, with nobody keeping a list.
 *
 * CACHED. Walking a few hundred files is cheap, and loading a declaration bundles TypeScript with esbuild, which is not. The
 * result is kept in `design-canvas/rounds/registry.json` together with the modification time of every file it was worked out
 * from (the closure files, `settings.json`, `project/flows.ts`, the per-canvas declarations), and is rebuilt only when one of
 * them has changed. The folder of every import that did not resolve is recorded too, so a file created later where an
 * import was already pointing makes the registry rebuild. A hook that runs on every edit therefore costs a few `stat` calls.
 *
 * With no `buildFrom` there is no registry: `loadRegistry` returns null and every check stays silent.
 *
 * DELETE WITH: the design-canvas/ folder.
 */
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { cached, IMPORT_RE, mtimeOf, resolveSpecifier, specifierBase, timesHold } from "./closure.mjs";
import { declarationFor, loadDeclarations, slugsOf } from "./declarations.mjs";
import { readSettingsSafe } from "./project-settings.mjs";

/**
 * Bumped when the registry's shape or its component detection changes, so a cache written by an older tool is rebuilt and
 * never trusted. Version 1's caches are missing every component declared through a wrapper with type
 * arguments holding a function type (`closingAngle` below says what that cost).
 */
export const REGISTRY_VERSION = 3;

/** A name an agent would call a component: capitalized, and not a CONSTANT. */
export function isComponentName(name) {
  return /^[A-Z]\w*$/.test(name) && !/^[A-Z][A-Z0-9_]*$/.test(name);
}

/**
 * Does this text draw JSX? A closing tag, a self-closing tag or a fragment: every JSX element is one of those, and a type
 * argument such as `Array<string>` or a comparison is none of them.
 */
export function hasJsx(text) {
  return /<\/[A-Za-z][\w.]*\s*>|<[A-Za-z][\w.]*(?:\s[^<>]*)?\/>|<>|<\/>/.test(text);
}

/**
 * What an import or export statement holds between its keyword and its `from`: the comments in it, and where it ends. `start`
 * is the index right after the keyword. Only the characters a clause is made of are walked over (names, braces, commas, stars,
 * spaces, comments); anything else (a paren, an `=`, a quote, a `;`) means this is no import clause, and the answer is null.
 * The walk also stops at the next `import` or `export` word, so a text full of those words is still read in one pass.
 * `{ spans, end }`: `spans` are `[from, to, isBlock]` for each comment, `end` the index to carry on from. A plain export list
 * (`export { A, B }`, no `from`) counts too, up to its closing brace. Null when it is no clause.
 */
function clauseComments(src, start, isExport) {
  const n = src.length;
  const spans = [];
  let i = start;
  let depth = 0;
  let braceEnd = -1;
  let spansAtBrace = 0;
  while (i < n) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      if (end === -1) return null;
      spans.push([i, end + 2, true]);
      i = end + 2;
    } else if (c === "/" && src[i + 1] === "/") {
      let end = i;
      while (end < n && src[end] !== "\n" && src[end] !== "\r") end++;
      spans.push([i, end, false]);
      i = end;
    } else if (/\s/.test(c) || c === "," || c === "*") {
      i++;
    } else if (c === "{") {
      depth++;
      i++;
    } else if (c === "}") {
      if (--depth < 0) break;
      i++;
      if (depth === 0) {
        braceEnd = i;
        spansAtBrace = spans.length;
      }
    } else if (/[\w$]/.test(c)) {
      let end = i + 1;
      while (end < n && /[\w$]/.test(src[end])) end++;
      const word = src.slice(i, end);
      if (word === "import" || word === "export") break;
      if (word === "from" && depth === 0) {
        /* Between `from` and the quote there may be spaces and comments of its own. */
        const after = [];
        let k = end;
        for (;;) {
          while (k < n && /\s/.test(src[k])) k++;
          if (src[k] === "/" && src[k + 1] === "*" && src.indexOf("*/", k + 2) !== -1) {
            const close = src.indexOf("*/", k + 2) + 2;
            after.push([k, close, true]);
            k = close;
          } else if (src[k] === "/" && src[k + 1] === "/") {
            let close = k;
            while (close < n && src[close] !== "\n" && src[close] !== "\r") close++;
            after.push([k, close, false]);
            k = close;
          } else break;
        }
        if (src[k] === '"' || src[k] === "'") return { spans: [...spans, ...after], end: k };
      }
      i = end;
    } else {
      break;
    }
  }
  return isExport && braceEnd !== -1 ? { spans: spans.slice(0, spansAtBrace), end: braceEnd } : null;
}

/**
 * The text with its comments taken out, so code that is only talked about in a comment (`// was: import { X } from "..."`) is
 * never read as code. Strings and template literals are skipped over whole, so a `//` inside `"http://x"` is not a comment. A
 * quoted string ends at the end of its line, which bounds the damage of an apostrophe in JSX text (`<p>Don't</p>`) or a quote
 * inside a regular expression to that one line. A block comment becomes one space (so two words never run together); a line
 * comment loses everything up to its line break.
 *
 * WHICH BLOCK COMMENTS COUNT. A slash-star is the start of a comment only where a comment really is: at the start of a line
 * (after spaces, or right after another comment that was one), or inside an import or export statement (between its keyword
 * and its `from`). A slash-star anywhere else is left alone, because there it may be a regular expression (`/[/*]/`) or JSX
 * text, and reading it as a comment would hide every import after it. The cost goes the harmless way: a block comment that
 * trails code on a line and talks about an import is read as that import, which can only make the check stricter.
 * A `//` comment is still taken out wherever it stands, since it only ever costs the rest of its own line.
 */
export function stripComments(text) {
  const src = String(text ?? "");
  const n = src.length;
  let out = "";
  let last = 0;
  let i = 0;
  /* Just after the last block comment taken out at the start of a line: a second comment right behind it still starts a line. */
  let leadEnd = -1;
  const atLineStart = (at) => {
    let k = at - 1;
    while (k >= 0 && (src[k] === " " || src[k] === "\t" || src[k] === "﻿")) k--;
    return k < 0 || src[k] === "\n" || src[k] === "\r" || k === leadEnd - 1;
  };
  while (i < n) {
    const c = src[i];
    const next = src[i + 1];
    if (c === "/" && next === "/") {
      out += src.slice(last, i);
      while (i < n && src[i] !== "\n" && src[i] !== "\r") i++;
      last = i;
    } else if (c === "/" && next === "*") {
      if (atLineStart(i)) {
        out += src.slice(last, i) + " ";
        const end = src.indexOf("*/", i + 2);
        i = end === -1 ? n : end + 2;
        last = i;
        leadEnd = i;
      } else {
        i++;
      }
    } else if ((c === "i" || c === "e") && (src.startsWith("import", i) || src.startsWith("export", i)) && !/[\w$.]/.test(src[i - 1] ?? "") && !/[\w$]/.test(src[i + 6] ?? "")) {
      const clause = clauseComments(src, i + 6, c === "e");
      if (clause === null) {
        i += 6;
      } else {
        for (const [from, to, isBlock] of clause.spans) {
          out += src.slice(last, from) + (isBlock ? " " : "");
          last = to;
        }
        i = clause.end;
      }
    } else if (c === '"' || c === "'") {
      i++;
      while (i < n && src[i] !== c && src[i] !== "\n") i += src[i] === "\\" ? 2 : 1;
      i++;
    } else if (c === "`") {
      i++;
      while (i < n && src[i] !== "`") i += src[i] === "\\" ? 2 : 1;
      i++;
    } else {
      i++;
    }
  }
  return out + src.slice(last);
}

/**
 * Where the value of `const NAME ...` starts: just after the `=`, skipping an optional type annotation (`: React.FC<Props>`,
 * which may itself hold `=>`, brackets and braces). `from` is the index right after the name. -1 when there is no `=`.
 */
function initializerStart(text, from) {
  let i = from;
  while (i < text.length && /\s/.test(text[i])) i++;
  if (text[i] === "=" && text[i + 1] !== ">") return i + 1;
  if (text[i] !== ":") return -1;
  let depth = 0;
  for (i++; i < text.length && i < from + 600; i++) {
    const c = text[i];
    if (c === "=" && text[i + 1] === ">") i++;
    else if (c === "<" || c === "(" || c === "{" || c === "[") depth++;
    else if (c === ">" || c === ")" || c === "}" || c === "]") depth--;
    else if (c === "=" && depth <= 0) return i + 1;
    else if (c === ";" && depth <= 0) return -1;
  }
  return -1;
}

/**
 * The index just after the `>` that closes the type arguments starting at `<`, or -1.
 *
 * WHY THIS IS NOT A REGEX. The patterns below used to read type arguments as `<[^()]*>`, which cannot cross a parenthesis,
 * so a component was invisible the moment its props type was written inline and any prop was a FUNCTION:
 * `forwardRef<HTMLButtonElement, { label: string; onSelect?: () => void }>((p, r) => …)` read as logic, and a menu row, a
 * dialog or a field declared that way was missing from the registry, never refused by the reuse check and never suggested
 * in another part's place. Real codebases declare many components through a wrapper with type arguments. A `=>` inside a
 * function type is not a closing angle, and a bracket of another kind is skipped whole.
 */
function closingAngle(text, open) {
  let angle = 0;
  for (let i = open; i < text.length && i < open + 2000; i++) {
    const c = text[i];
    if (c === "(" || c === "{" || c === "[") {
      let depth = 0;
      for (; i < text.length && i < open + 2000; i++) {
        const d = text[i];
        if (d === "(" || d === "{" || d === "[") depth++;
        else if (d === ")" || d === "}" || d === "]") {
          depth--;
          if (depth === 0) break;
        }
      }
      continue;
    }
    if (c === "<") angle++;
    else if (c === ">") {
      if (text[i - 1] === "=") continue;
      angle--;
      if (angle === 0) return i + 1;
    }
  }
  return -1;
}

/** `head` with the type arguments that start at `from` taken out, so a pattern that only cares about the call can read it. */
function withoutTypeArgs(head, from) {
  if (head[from] !== "<") return head;
  const close = closingAngle(head, from);
  return close === -1 ? head : head.slice(0, from) + head.slice(close);
}

/** The index just after the `)` that closes the `(` at `open`, or -1. Strings are not understood: good enough for a parameter list. */
function closingParen(text, open) {
  let depth = 0;
  for (let i = open; i < text.length && i < open + 3000; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return i + 1;
  }
  return -1;
}

/**
 * A call that wraps a component it is handed: `observer(Panel)`, `withAuth(Panel)`, `styled(Button)`, with or without type
 * arguments. Returns the wrapped name, or null. The first argument has to be a capitalized name, so `createContext(null)`,
 * `cva("a", {...})` and `memo(function ...)` are not it. A callee that is plainly not a wrapper is skipped: a hook
 * (`useMemo(Foo)`), a `create...` factory, and the built-ins whose argument is data (`Object.freeze(Foo)`, `z.object(Shape)`).
 */
function wrappedComponent(head, text, seen) {
  const CALL = /^([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)\s*(?:<[^()]*>)?\s*\(\s*([A-Z][\w$]*)\s*[,)]/;
  let m = CALL.exec(head);
  if (!m) {
    /* Type arguments holding a function type (`observer<{ onX?: () => void }>(Panel)`) stop the pattern above: read the
       call without them. */
    const callee = /^[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*\s*/.exec(head);
    if (callee) m = CALL.exec(withoutTypeArgs(head, callee[0].length));
  }
  if (!m || !isComponentName(m[2])) return null;
  if (/^(?:use[A-Z_]|create|Object\b|Array\b|Number\b|String\b|Boolean\b|Symbol\b|Promise\b|Math\b|JSON\b|Map\b|Set\b|Date\b|z\s*\.|zod\b|yup\b)/.test(m[1])) return null;
  /* The wrapper only makes a component when what it wraps is one: a call such as `extendTheme(Base)` or `combine(Parts)` is logic. */
  if (!isComponentInFile(text, m[2], seen)) return null;
  return m[2];
}

/** Is the name drawn as a JSX tag in the text: `<Panel` followed by a space, a slash or the end of the tag? */
function usedAsTag(text, name) {
  return new RegExp(`<${name.replace(/\$/g, "\\$")}(?=[\\s/>])`).test(text);
}

/** Is the name a component as far as this one file can tell: declared as one here, or drawn as a JSX tag here? */
function isComponentInFile(text, name, seen) {
  return usedAsTag(text, name) || localIsComponent(text, name, seen);
}

/**
 * Is the value that starts at `start` a component? An arrow function, a function expression, or a call of `memo(`,
 * `forwardRef(`, `lazy(` (also as `React.memo(` and so on, with or without type arguments). A string, a number, a zod schema,
 * a `createContext(...)` and every other call is a constant, not a component, with three exceptions that make a component
 * out of one that already exists, an ALIAS, each only where the file itself shows it is a component and not a value:
 *   - a member expression that ends in a capitalized name (`DialogPrimitive.Root`), only when the same object is a JSX tag
 *     namespace in the file (a `<DialogPrimitive.` tag appears), so `Tokens.Palette` and `Enums.Status` stay constants;
 *   - a call that is handed a capitalized name (`observer(Panel)`, `styled(Button)`), only when that first argument is itself
 *     a component here: declared as one in this file, or drawn as a JSX tag in it, so `extendTheme(Base)` and
 *     `defineRoutes(Config)` stay logic;
 *   - a tagged template such as `styled.div` followed by a template literal, which counts only when the file draws JSX.
 * `seen` holds the names being judged, so two constants that wrap each other end the walk instead of looping.
 */
function isComponentInitializer(text, start, seen = new Set()) {
  let i = start;
  while (i < text.length && /\s/.test(text[i])) i++;
  const head = text.slice(i, i + 240);
  /* `memo(`, `forwardRef(`, `lazy(`, with or without type arguments. The type arguments are skipped by scanning rather
     than by a pattern, because they often hold a function type (`closingAngle` says why). */
  const wrapper = /^(?:React\.)?(?:memo|forwardRef|lazy)\s*/.exec(head);
  if (wrapper) {
    let at = i + wrapper[0].length;
    if (text[at] === "<") {
      const close = closingAngle(text, at);
      if (close !== -1) at = close;
    }
    if (/^\s*\(/.test(text.slice(at, at + 40))) return true;
  }
  if (wrappedComponent(head, text, seen) !== null) return true;
  if (/^styled\s*\(\s*["'][a-z][\w-]*["']\s*\)/.test(head)) return true;
  if (/^(?:styled|tw)(?:\s*\.\s*[A-Za-z_$][\w$]*|\s*\([^()]*\))(?:\s*\.\s*attrs\s*\([\s\S]{0,160}?\))?\s*(?:<[^`]{0,160}>)?\s*`/.test(head)) return hasJsx(text);
  const member = /^[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)+/.exec(head);
  if (member && isComponentName(member[0].split(".").pop().trim())) {
    /* It has to END there: `Foo.Bar()` and `Foo.Bar + 1` are values, not the component itself. */
    const rest = head.slice(member[0].length);
    const after = /^(\s*)(.?)/.exec(rest);
    const ends = after[2] === "" || /[;,)}]/.test(after[2]) || (/[\r\n]/.test(after[1]) && /[A-Za-z_$]/.test(after[2]));
    /* And the object has to be drawn as a JSX namespace in this file (`<Foo.` somewhere), or it is just a value read off it. */
    const object = member[0].split(".")[0].trim().replace(/\$/g, "\\$");
    if (ends && new RegExp(`<${object}\\s*\\.`).test(text)) return true;
  }
  if (/^(?:async\s+)?function\b/.test(head)) return true;
  const asyncWord = /^async\s+/.exec(head);
  let j = i + (asyncWord ? asyncWord[0].length : 0);
  if (text[j] === "<") {
    const paren = text.indexOf("(", j);
    if (paren === -1 || paren - j > 200) return false;
    j = paren;
  }
  if (text[j] === "(") {
    const close = closingParen(text, j);
    return close !== -1 && /^\s*(?::[\s\S]{0,200}?)?=>/.test(text.slice(close, close + 260));
  }
  return /^[\w$]+\s*=>/.test(text.slice(j, j + 80));
}

/** Is the local declaration of `name` in this text a component: a function, a class that extends Component, or such a const? */
function localIsComponent(text, name, seen = new Set()) {
  if (seen.has(name)) return false;
  seen = new Set(seen).add(name);
  const word = name.replace(/\$/g, "\\$");
  if (new RegExp(`(?:^|[^\\w$.])(?:async\\s+)?function\\s*\\*?\\s*${word}(?![\\w$])`).test(text)) return true;
  if (new RegExp(`(?:^|[^\\w$.])class\\s+${word}\\s+extends\\s+(?:React\\.)?(?:Pure)?Component\\b`).test(text)) return true;
  const decl = new RegExp(`(?:^|[^\\w$.])(?:const|let|var)\\s+${word}(?![\\w$])`).exec(text);
  if (!decl) return false;
  const start = initializerStart(text, decl.index + decl[0].length);
  return start !== -1 && isComponentInitializer(text, start, seen);
}

/**
 * The components a file exports, as `{ named, defaultName }`. A component is a capitalized name that is not ALL_CAPS and that
 * is a function declaration, a class extending Component, or a `const` whose value is an arrow function, a function
 * expression or a `memo(`/`forwardRef(`/`lazy(` call. A constant (`Spacing = "3rem"`), a schema (`FormSchema =
 * z.object(...)`), a context (`createContext(...)`) or a number is NOT one: it is logic, and logic is never refused.
 * `defaultName` is the name of the default export when that is a component, else null. An anonymous default export has no
 * name to give, so it is left out.
 */
export function componentExports(text) {
  const src = stripComments(text);
  const named = new Set();
  let defaultName = null;
  const ok = (name) => isComponentName(name);

  for (const m of src.matchAll(/\bexport\s+(?:async\s+)?function\s*\*?\s*([A-Z][\w$]*)/g)) if (ok(m[1])) named.add(m[1]);
  for (const m of src.matchAll(/\bexport\s+(?:abstract\s+)?class\s+([A-Z][\w$]*)\s+extends\s+(?:React\.)?(?:Pure)?Component\b/g)) if (ok(m[1])) named.add(m[1]);
  for (const m of src.matchAll(/\bexport\s+(?:const|let|var)\s+([A-Z][\w$]*)/g)) {
    if (!ok(m[1])) continue;
    const start = initializerStart(src, m.index + m[0].length);
    if (start !== -1 && isComponentInitializer(src, start)) named.add(m[1]);
  }
  /* `export { A, B as C }` without `from`: the local binding decides. With `from` it is a re-export, followed elsewhere. */
  for (const m of src.matchAll(/\bexport\s*\{([^}]*)\}(\s*from\b)?/g)) {
    if (m[2]) continue;
    for (const part of m[1].split(",")) {
      if (/^\s*type\s/.test(part)) continue;
      const [local, exported] = part.trim().split(/\s+as\s+/).map((one) => one.trim());
      if (!local || !/^[A-Za-z_$][\w$]*$/.test(local)) continue;
      if (!localIsComponent(src, local)) continue;
      const out = exported ?? local;
      if (out === "default") {
        if (ok(local)) defaultName = local;
      } else if (ok(out)) named.add(out);
    }
  }
  const fn = /\bexport\s+default\s+(?:async\s+)?function\s*\*?\s*([A-Z][\w$]*)/.exec(src);
  if (fn && ok(fn[1])) defaultName = fn[1];
  const cls = /\bexport\s+default\s+class\s+([A-Z][\w$]*)\s+extends\s+(?:React\.)?(?:Pure)?Component\b/.exec(src);
  if (cls && ok(cls[1])) defaultName = cls[1];
  const wrapped = /\bexport\s+default\s+(?:React\.)?(?:memo|forwardRef)\s*(?:<[^()]*>)?\s*\(\s*(?:function\s+)?([A-Z][\w$]*)/.exec(src);
  if (wrapped && ok(wrapped[1])) defaultName = wrapped[1];
  /* `export default observer(Panel)`, `export default withAuth(Panel)`: the same wrapper idea with any wrapper's name. */
  const defaultCall = /\bexport\s+default\s+([^;\n]{1,240})/.exec(src);
  const wrappedName = defaultCall ? wrappedComponent(defaultCall[1], src, new Set()) : null;
  if (wrappedName !== null && defaultName === null) defaultName = wrappedName;
  const plain = /\bexport\s+default\s+([A-Z][\w$]*)\s*(?:;|\n|$)/.exec(src);
  if (plain && ok(plain[1]) && localIsComponent(src, plain[1])) defaultName = plain[1];
  return { named: [...named], defaultName };
}

/** The exported component names of a file, the default export's name included: what the registry lists for it. */
export function exportedComponents(text) {
  const { named, defaultName } = componentExports(text);
  return defaultName !== null && !named.includes(defaultName) ? [...named, defaultName] : named;
}

/** A file that is never a part of the design: tests, build output, dependencies, the canvas itself. */
export function isNeverDesign(rel) {
  return /(^|\/)(design-canvas|node_modules|\.next|__tests__)\//.test(rel) || /\.(test|spec)\.[^/]+$/.test(rel);
}

/** Does this relative path hold a component file by its extension and place alone? */
function isComponentCandidate(rel) {
  return /\.(tsx|jsx)$/.test(rel) && !isNeverDesign(rel);
}

/** The screens of a declaration that count as frames of the design: real built screens of the flows. */
function frameScreens(declaration) {
  const out = [];
  for (const flow of declaration.flows ?? []) {
    for (const screen of flow.screens ?? []) {
      if (screen.explain || screen.reference === true || screen.still || screen.wireframe) continue;
      if (!Array.isArray(screen.source) || screen.source.length === 0) continue;
      out.push(screen);
    }
  }
  return out;
}

/** The files whose change means the registry may be wrong: settings, the declaration, the per-canvas declarations. */
function declarationFiles(root, canvasDir) {
  const rel = (at) => path.relative(root, at).split(path.sep).join("/");
  const found = [rel(path.join(canvasDir, "settings.json")), rel(path.join(canvasDir, "project", "flows.ts"))];
  const dir = path.join(canvasDir, "project", "canvases");
  /* The folder itself is recorded too (its modification time moves when a declaration is added or removed). */
  found.push(rel(dir));
  if (existsSync(dir)) for (const name of readdirSync(dir).sort()) if (name.endsWith(".ts")) found.push(rel(path.join(dir, name)));
  return found;
}

/**
 * Work the registry out from the canvases `settings.buildFrom` names. `declarations` may be injected as a list of
 * `{ slug, declaration }` for every canvas (tests do, so they need no esbuild); otherwise the project's own declaration is read.
 */
export async function buildRegistry({ root, canvasDir, settings, declarations }) {
  const buildFrom = settings?.buildFrom ?? [];
  /* Injected declarations (tests) are every canvas; the frames come from the ones `buildFrom` names. */
  let loaded = declarations?.filter((one) => buildFrom.includes(one.slug));
  /* Every canvas, for the explorations' original screens: an exploration on any canvas redesigns the developer's own screen. */
  let everyCanvas = declarations;
  if (!loaded) {
    const source = await loadDeclarations(canvasDir);
    loaded = buildFrom.map((slug) => {
      const found = declarationFor(source, slug);
      if (found.error) throw new Error(found.error);
      return { slug, declaration: found.declaration };
    });
    everyCanvas = slugsOf(source)
      .map((slug) => ({ slug, declaration: declarationFor(source, slug).declaration }))
      .filter((one) => one.declaration);
  }

  /* The folder every project-relative import that did NOT resolve would have lived in: a file that appears there later (the
     import was written first, the file second) changes that folder's modification time, and the registry is then rebuilt. */
  const unresolvedFolders = new Set();

  /* One import graph for all the frames: each file's direct imports are read once. */
  const direct = new Map();
  const importsOf = (file) => {
    if (direct.has(file)) return direct.get(file);
    const next = [];
    direct.set(file, next);
    if (!/\.(tsx?|jsx?|mjs)$/.test(file)) return next;
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      return next;
    }
    for (const match of text.matchAll(IMPORT_RE)) {
      const spec = match[1] ?? match[2];
      if (!spec) continue;
      const at = resolveSpecifier(spec, file, root);
      if (at) next.push(at);
      else {
        const base = specifierBase(spec, file, root);
        if (base !== null) unresolvedFolders.add(path.dirname(base));
      }
    }
    return next;
  };
  const closureOf = (entries) => {
    const seen = new Set();
    const queue = [];
    for (const file of entries) {
      const at = path.join(root, file);
      if (existsSync(at)) queue.push(at);
    }
    while (queue.length > 0) {
      const file = queue.pop();
      if (seen.has(file)) continue;
      seen.add(file);
      for (const next of importsOf(file)) if (!seen.has(next)) queue.push(next);
    }
    return seen;
  };

  const frames = {};
  const components = {};
  const reached = new Set();
  const textCache = new Map();
  const textOf = (at) => {
    if (!textCache.has(at)) {
      try {
        textCache.set(at, readFileSync(at, "utf8"));
      } catch {
        textCache.set(at, null);
      }
    }
    return textCache.get(at);
  };
  for (const { slug, declaration } of loaded) {
    for (const screen of frameScreens(declaration)) {
      const id = `${slug}/${screen.id}`;
      frames[id] = { canvas: slug, label: screen.label };
      for (const at of closureOf(screen.source)) {
        reached.add(at);
        const rel = path.relative(root, at).split(path.sep).join("/");
        if (!isComponentCandidate(rel)) continue;
        if (!components[rel]) {
          const text = textOf(at);
          if (text === null || !hasJsx(text)) {
            components[rel] = null;
            continue;
          }
          const exports = exportedComponents(text);
          components[rel] = exports.length > 0 ? { exports, frames: [] } : null;
        }
        components[rel]?.frames.push(id);
      }
    }
  }
  for (const rel of Object.keys(components)) if (components[rel] === null) delete components[rel];

  /**
   * THE DEVELOPER'S OWN COMPONENTS: every component file in the import closure of an exploration's `original` screen. That screen
   * is today's design, and a redesign of it that keeps one of its components is reusing what the screen already draws, not
   * reaching for today's code from somewhere else, so the reuse check allows them.
   */
  const originals = new Set();
  for (const { declaration } of everyCanvas) {
    const permanent = (declaration.flows ?? []).flatMap((flow) => flow.screens ?? []);
    for (const exploration of declaration.explorations ?? []) {
      const original = permanent.find((screen) => screen.id === exploration.original);
      if (!Array.isArray(original?.source)) continue;
      for (const at of closureOf(original.source)) {
        reached.add(at);
        const rel = path.relative(root, at).split(path.sep).join("/");
        if (isComponentCandidate(rel)) originals.add(rel);
      }
    }
  }

  const files = {};
  for (const at of [...reached].sort()) {
    const rel = path.relative(root, at).split(path.sep).join("/");
    files[rel] = mtimeOf(at);
  }
  for (const rel of declarationFiles(root, canvasDir)) files[rel] = mtimeOf(path.join(root, rel));
  const folders = {};
  for (const at of [...unresolvedFolders].sort()) folders[path.relative(root, at).split(path.sep).join("/")] = mtimeOf(at);

  return { version: REGISTRY_VERSION, builtAt: new Date().toISOString(), buildFrom: [...buildFrom], frames, components, originals: [...originals].sort(), files, folders };
}

/** Is a cached registry still the answer? Same version, same canvases named, every recorded modification time unchanged. */
function isFresh(cached, root, buildFrom) {
  if (!cached || cached.version !== REGISTRY_VERSION || !Array.isArray(cached.buildFrom)) return false;
  if (JSON.stringify(cached.buildFrom) !== JSON.stringify(buildFrom)) return false;
  /* The folders of imports that did not resolve: a file created there since means that import resolves now. */
  return timesHold(root, cached.files, cached.folders);
}

/**
 * The registry for this project: the cached one when nothing it was built from has changed, otherwise a fresh build that is
 * written back (`declarations` is passed through to the build, for tests). Null when the settings name no design to build from. A cache that cannot be written is not an error (the
 * next call simply builds again).
 */
export async function loadRegistry({ root, canvasDir, settings, cachePath, declarations }) {
  const buildFrom = settings?.buildFrom ?? [];
  if (buildFrom.length === 0) return null;
  return cached(
    cachePath ?? path.join(canvasDir, "rounds", "registry.json"),
    (value) => isFresh(value, root, buildFrom),
    () => buildRegistry({ root, canvasDir, settings, declarations }),
  );
}

/** The registry's components, most-used first: [{ rel, exports, frames }]. */
export function componentsByFrames(registry) {
  return Object.entries(registry.components)
    .map(([rel, one]) => ({ rel, exports: one.exports, frames: one.frames }))
    .sort((a, b) => b.frames.length - a.frames.length || a.rel.localeCompare(b.rel));
}

/* ------------------------------------------------------------------ command line */

async function main() {
  const args = process.argv.slice(2);
  const flag = (name) => {
    const at = args.indexOf(name);
    return at === -1 ? null : (args[at + 1] ?? null);
  };
  const canvasDir = path.resolve(flag("--canvas-dir") ?? path.dirname(fileURLToPath(import.meta.url)));
  const root = path.dirname(canvasDir);
  const { settings, error } = readSettingsSafe(canvasDir);
  if (error) {
    console.error(`registry: ${error}`);
    process.exit(1);
  }
  const registry = await loadRegistry({ root, canvasDir, settings });
  if (!registry) {
    console.log(`No design to build from yet. Name one in design-canvas/settings.json, like "buildFrom": ["<canvas slug>"], and the checks start.`);
    return;
  }
  if (args.includes("--json")) {
    console.log(JSON.stringify(registry, null, 2));
    return;
  }
  const list = componentsByFrames(registry);
  console.log(`Building from ${registry.buildFrom.join(", ")}: ${Object.keys(registry.frames).length} frames, ${list.length} components`);
  for (const one of list) {
    const names = one.exports.slice(0, 3).join(", ") + (one.exports.length > 3 ? ", ..." : "");
    console.log(`  ${names}  (${one.rel})  on ${one.frames.length} ${one.frames.length === 1 ? "frame" : "frames"}`);
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
    console.error(`registry: ${String(error?.message ?? error).split("\n")[0]}`);
    process.exit(1);
  });
}
