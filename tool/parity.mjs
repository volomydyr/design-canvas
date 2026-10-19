#!/usr/bin/env node
/**
 * design-canvas — REAL-CODE MODE: an exploration over a screen that already works must not lose what it does.
 *
 *   node design-canvas/parity.mjs --canvas <slug>                                   check every real-code exploration
 *   node design-canvas/parity.mjs --canvas <slug> --exploration <id> --base <commit>   move one exploration's base
 *   node design-canvas/parity.mjs --canvas <slug> --exploration <id> --remove <file:line[#n]> --said-file <path>
 *                                                                                    record a removal the reviewer asked for, with
 *                                                                                    their exact words: said in conversation, written
 *                                                                                    to a file (`-` reads stdin); or --said-from <id>
 *                                                                                    for the words of one of their canvas comments
 *
 * WHY IT EXISTS. Options built beside a working screen lose its behavior: a condition that decides who sees a button, a
 * handler, a hidden field, a translation key, what an action opens. A picture shows none of that, and reviewing by eye
 * misses it every time. What converged was building each option as a layer of UI over the screen's own hooks and
 * handlers, folding the chosen one into the screen's own file, and a deterministic check that every piece of the
 * original's logic is still there. This file is that mode:
 *
 *   1. MODE        per exploration, from the files its `original` screen reaches (`closure.mjs`): real-code when they make
 *                  data calls or mutations, hold server actions or route handlers, read a store or check a permission;
 *                  simple otherwise. `mode` on the exploration overrides it. One line says which and why.
 *   2. UI ONLY     in real-code mode, an option's own files (what its `source` reaches that the original's does not) may
 *                  not make data calls of their own: a raw client call is refused, and a named data hook only when the
 *                  original's files do not use it.
 *   3. BASE        the commit the exploration started from, recorded by the first capture (`bases` in the manifest), with
 *                  the files the original reached then. A pull that brings the developers' commits to those files moves it
 *                  to the pulled commit (`followRemote`, run by the hook after the git command); `--base` moves it by hand.
 *   4. PARITY      every logic unit of those files at the base must still be in the same file in the working tree. A unit
 *                  is a statement or a condition header (from the TypeScript AST, with markup cut out), a condition in the
 *                  markup, a handler, a form field's name and its literal behavior attributes, a door (where a link, a form
 *                  or a navigation goes, a dialog or form that is rendered), a rendered component whose own file does
 *                  something, a prop given to such a component or named for behavior, a translation key and its default
 *                  copy. Layout is not a unit: element types, nesting, lists and render functions, props of components that
 *                  only draw. Units are compared as a multiset, so dropping one of two identical gated controls is still a
 *                  loss, except keys and copy, which only have to be present; a unit that differs only by a renamed local
 *                  still matches, and code in a declaration nothing uses gives no units. A file that held logic or behavior
 *                  and is no longer reached is a loss too.
 *   5. EXCEPTIONS  `design-canvas/project/parity-exceptions.json`: `[{ "file", "kind", "unit", "movedTo": "<file>:<line>",
 *                  "why" }]`. Only an entry whose `movedTo` really holds the unit's logic is accepted; one without a location,
 *                  or with one that does not hold it, is refused and fails the check.
 *                  The place must be reached from today's screen. A behavior removed on purpose is a removal entry,
 *                  `{ "file", "kind", "removed", "said" }`, written only by `--remove <file:line[#n]> --said-file <path>` (the
 *                  reviewer's exact words, from the conversation) or `--said-from <comment id>`; it excuses exactly that unit,
 *                  and one with no words is refused. An agent never writes one on its own, and never puts the words on the
 *                  command line. Simple mode over a screen that holds real logic is recorded the same way, `--mode simple`.
 *                  THE TOOL'S OWN RECORDS: every removal and simple-mode entry carries `sig`, a digest of its exploration, unit
 *                  and words keyed by a secret this machine keeps outside every repository (`recordProblem`), so an entry
 *                  written by hand, by any route, is refused by the check, naming the command that records it.
 *
 * The preflight and the round run this by themselves for every real-code exploration, and a failure fails the round. The
 * last line of the command is the verdict: `PARITY PASS` or `PARITY FAIL (<count>)`. Exit codes: 0 pass, 1 problems, 2 the
 * check could not start.
 *
 * DELETE WITH: the design-canvas/ folder.
 */
import { execFileSync } from "node:child_process";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { answersFile } from "./checks-answer.mjs";
import { filesReachedFrom, IMPORT_RE, resolveSpecifier, specifierBase } from "./closure.mjs";
import { surfaceKind } from "./components.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const MODES = ["real-code", "simple"];
/** A value put into a printed command: a plain name as it is, anything else as a placeholder, so no hint carries shell syntax. */
/** Text made one line: control and line-separator characters become spaces. */
const oneLine = (text) => String(text).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ");
/** A value from an exceptions entry, shown as quoted data: an entry may arrive in someone else's commit. */
const entryText = (value) => JSON.stringify(oneLine(value ?? "?").slice(0, 200));
/** How an exceptions entry is named in a line: its file and unit quoted, its kind when it is a plain word. */
const entryName = (entry, unit) => `${entryText(entry?.file)} ${/^[a-z]+$/.test(String(entry?.kind)) ? entry.kind : entryText(entry?.kind)} ${entryText(unit)}`;
const commandArg = (value, placeholder = "<its id>") => (/^[A-Za-z0-9_-]+$/.test(String(value)) ? String(value) : placeholder);
export const EXCEPTIONS_FILE = "parity-exceptions.json";

/* ------------------------------------------------------------------ the tool's own records */

/*
 * WHAT THE SIGNATURE GUARDS AGAINST. Entries that arrive from outside (someone else's commit, a teammate's machine) carry no
 * digest this machine's key produces, so they are refused, and their text is shown quoted on one line. The local agent itself
 * runs as the same user and can read the key, so against it the signature is a guard against drift, not a boundary: a hand
 * edit made by mistake is refused and named in the report, which is what it is for.
 */

/**
 * The key the tool's records are signed with: one random secret per machine, beside the machine's answers file (`answersFile` in
 * checks-answer.mjs, so `$CANVAS_ANSWERS_FILE` moves it too), readable by its owner only. Created on the first record. Null when
 * there is none and `create` is false, or it cannot be made.
 */
const secretFile = () => path.join(path.dirname(answersFile()), "parity-secret");
function machineSecret(create) {
  try {
    const text = readFileSync(secretFile(), "utf8").trim();
    if (text) return text;
  } catch {
    /* None yet. */
  }
  if (!create) return null;
  try {
    mkdirSync(path.dirname(secretFile()), { recursive: true, mode: 0o700 });
    writeFileSync(secretFile(), `${randomBytes(32).toString("hex")}\n`, { mode: 0o600, flag: "wx" });
  } catch (error) {
    if (error?.code !== "EEXIST") return null;
  }
  return machineSecret(false);
}
/** What a record's digest covers: its kind, exploration, unit and words. */
const signedText = (entry) =>
  JSON.stringify("removed" in entry ? ["removal", entry.exploration ?? "", entry.file, entry.kind, entry.removed, entry.said] : ["mode", entry.exploration ?? "", entry.mode, entry.said]);
const digest = (secret, entry) => createHmac("sha256", secret).update(signedText(entry)).digest("hex");

/** The entry with its digest, or null when this machine cannot keep a secret. */
export function signRecord(entry) {
  const secret = machineSecret(true);
  return secret ? { ...entry, sig: digest(secret, entry) } : null;
}

/** How many times a declaration's text sets `mode: "simple"`: what the hook's early warning compares before and after an edit. */
export const simpleModeLines = (text) => (String(text).match(/\bmode\s*:\s*\\?["'`]simple\\?["'`]/g) ?? []).length;

/** Is this a record only the tool writes: a removal, or a simple mode set on the reviewer's words? */
export const isToolRecord = (entry) => Boolean(entry) && typeof entry === "object" && ("removed" in entry || "mode" in entry);

/**
 * THE ONE VALIDATOR of the tool's records, used by the check and by the hook's early warning: null when the entry was written by
 * this tool on this machine with exactly these fields, else why not, with the command that records it properly.
 */
export function recordProblem(entry) {
  if (!isToolRecord(entry)) return null;
  const how =
    "removed" in entry
      ? `node design-canvas/parity.mjs --canvas <slug> --exploration ${commandArg(entry.exploration)} --remove <file:line> --said-file <a file holding the reviewer's exact words>`
      : `node design-canvas/parity.mjs --canvas <slug> --exploration ${commandArg(entry.exploration)} --mode simple --said-file <a file holding the reviewer's exact words>`;
  const secret = machineSecret(false);
  const given = typeof entry.sig === "string" && /^[0-9a-f]{64}$/.test(entry.sig) ? Buffer.from(entry.sig, "hex") : null;
  const ok = secret && given && timingSafeEqual(given, Buffer.from(digest(secret, entry), "hex"));
  return ok ? null : `it was not recorded by parity.mjs on this machine, or was changed after (no valid "sig"), so nothing shows the reviewer's words are theirs: record it with ${how}`;
}

/* ------------------------------------------------------------------ reading files */

/** The text with comments blanked out and every line break kept, so a match's line number is the line it is on. */
export function blankComments(text) {
  const src = String(text ?? "");
  let out = "";
  let i = 0;
  const blank = (from, to) => src.slice(from, to).replace(/[^\n]/g, " ");
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (c === "/" && next === "/") {
      const end = src.indexOf("\n", i);
      const stop = end === -1 ? src.length : end;
      out += blank(i, stop);
      i = stop;
    } else if (c === "/" && next === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? src.length : end + 2;
      out += blank(i, stop);
      i = stop;
    } else if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < src.length && src[j] !== c && (c === "`" || src[j] !== "\n")) j += src[j] === "\\" ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

const lineOf = (text, index) => text.slice(0, index).split("\n").length;

/** Project source a screen is made of: code, not styles, tests, type declarations or the canvas itself. */
export const isCodeFile = (rel) =>
  /\.(tsx|ts|jsx|js|mjs)$/.test(rel) && !/\.d\.ts$/.test(rel) && !/(^|\/)(design-canvas|node_modules)\//.test(rel) && !/(\.test\.|\.spec\.|\.stories\.|(^|\/)__tests__\/)/.test(rel);

function readSafe(at) {
  try {
    return readFileSync(at, "utf8");
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ 1. real logic, and the mode */

/**
 * WHAT COUNTS AS REAL LOGIC, by the shapes common clients, frameworks and stores give it. `raw` marks a call that talks to a
 * backend directly (a library hook or a client), which an option may never make on its own; any other data hook is named
 * and may be reused when the original uses it too.
 */
const LOGIC_RULES = [
  { kind: "data", raw: true, re: /(?<![\w$.])(use(?:Query|Queries|Mutation|InfiniteQuery|SuspenseQuery|SuspenseInfiniteQuery|Subscription|LazyQuery|SWR|SWRMutation|SWRInfinite))\s*[<(]/g },
  { kind: "data", raw: false, re: /(?<![\w$.])(use[A-Z][\w$]*?(?:Query|Queries|Mutation|Subscription))\s*[<(]/g },
  { kind: "data", raw: false, re: /(?<![\w$.])(use(?:Fetch|Fetcher|Loader|ActionData|ActionState|FormState)[\w$]*)\s*[<(]/g },
  { kind: "data", raw: true, re: /(?<![\w$.])(fetch|\$fetch|ofetch)\s*\(/g },
  { kind: "data", raw: true, re: /(?<![\w$.])(axios(?:\.\w+)?)\s*[<(]/g },
  { kind: "data", raw: true, re: /(?<![\w$.])([\w$]*[cC]lient\.(?:query|mutate|mutation|request|subscribe))\s*[<(]/g },
  { kind: "data", raw: true, re: /(?<![\w$.])(gql|graphql)\s*[`(]/g },
  { kind: "data", raw: true, re: /(?<![\w$.])((?:trpc|api)\.[\w$.]+\.(?:useQuery|useMutation|useSuspenseQuery|useInfiniteQuery|query|mutate))\s*\(/g },
  { kind: "data", raw: true, re: /(?<![\w$.])(supabase\.(?:from|rpc)|prisma\.[\w$]+\.[\w$]+|getDocs?|addDoc|setDoc|updateDoc|deleteDoc|onSnapshot)\s*\(/g },
  /* An ORM, a query builder or an HTTP client through the names projects export them as: `db.task.findMany()`, `db.select()`,
     `api.get("/tasks")`, `http.get(...)`; and SQL as a tagged template. */
  { kind: "data", raw: true, re: /(?<![\w$.])((?:db|prisma|client|api|http|ky)\.[\w$]+(?:\.[\w$]+)*)\s*[<(]/g },
  { kind: "data", raw: true, re: /(?<![\w$.])(ky|sql)\s*[<(`]/g },
  { kind: "server", raw: true, re: /^\s*(["']use server["'])/gm },
  { kind: "server", raw: true, re: /\bexport\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|loader|action|getServerSideProps)\b/g },
  { kind: "server", raw: true, re: /\bexport\s+const\s+(GET|POST|PUT|PATCH|DELETE|loader|action)\s*=/g },
  { kind: "store", raw: false, re: /(?<![\w$.])(createStore|configureStore|createSlice|defineStore|useSelector|useDispatch|useAtom|useAtomValue|useSetAtom|useRecoilState|useRecoilValue)\s*[<(]/g },
  { kind: "store", raw: false, re: /(?<![\w$.])(use[A-Z][\w$]*(?:Store|Selector|Dispatch))\s*[<(]/g },
  { kind: "store", raw: false, re: /(?<![\w$.])(useContext)\s*[<(]/g },
  /* What a server component reads and how it turns a request away. */
  { kind: "server", raw: true, re: /(?<![\w$.])(cookies|headers|draftMode)\s*\(/g },
  { kind: "permission", raw: false, re: /(?<![\w$.])(auth|currentUser|useUser|redirect|permanentRedirect|notFound|unauthorized|forbidden)\s*\(/g },
  {
    kind: "permission",
    raw: false,
    re: /(?<![\w$.])(can|cannot|hasPermissions?|hasRoles?|hasAccess|isAllowed|isAuthorized|checkPermissions?|authorize|getServerSession|use(?:[A-Z][\w$]*)?(?:Permissions?|Ability|Authorization|Roles?|Session|Auth))\s*\(/g,
  },
  { kind: "permission", raw: false, re: /\.((?:role|roles|permissions)\s*(?:===|!==|==|!=|\.includes\s*\())/g },
  { kind: "permission", raw: false, re: /\.(isAdmin|isOwner|isSuperuser)\b/g },
];

/** A store made with a library whose maker has a generic name (`create` from zustand), only in a file importing it. */
const STORE_MAKER = { from: /\bfrom\s*["']zustand(?:\/[\w-]+)?["']/, re: /(?<![\w$.])(create|createStore|createWithEqualityFn)\s*[<(]/g };
/** A server component (an async function named like a component) and the calls it awaits. */
const SERVER_COMPONENT = /\basync\s+function\s+[A-Z][\w$]*\s*\(|\b(?:const|let)\s+[A-Z][\w$]*\s*=\s*async\s*\(/;
const AWAITED = /\bawait\s+([\w$]+(?:\.[\w$]+)*)\s*[<(`]/g;

/** Every real-logic call in one file's text: `{ file, line, kind, raw, what }`, `what` being the call as written. */
export function logicIn(text, file) {
  const src = blankComments(text);
  const found = [];
  const at = new Set();
  const push = (index, kind, raw, what) => {
    /* Two rules naming the same call once: the first, more specific one, wins. */
    if (at.has(index)) return;
    at.add(index);
    /* `function useX(` defines a hook rather than calls one. */
    const defines = /function\s*\*?\s*$/.test(src.slice(Math.max(0, index - 16), index));
    found.push({ file, line: lineOf(src, index), kind, raw, what: what.replace(/\s+/g, " ").trim(), ...(defines ? { defines: true } : {}) });
  };
  for (const rule of LOGIC_RULES) for (const match of src.matchAll(rule.re)) push(match.index, rule.kind, rule.raw, match[1]);
  if (STORE_MAKER.from.test(src)) for (const match of src.matchAll(STORE_MAKER.re)) push(match.index, "store", false, match[1]);
  if (/\.(tsx|jsx|js)$/.test(file ?? "") && SERVER_COMPONENT.test(src))
    for (const match of src.matchAll(AWAITED)) if (match[1] !== "import") push(match.index + match[0].indexOf(match[1]), "server", false, `await ${match[1]}`);
  return found.sort((a, b) => a.line - b.line);
}

/** Every real-logic call in these project files (repo-relative). */
export function logicInFiles(root, files) {
  const out = [];
  for (const rel of files) {
    if (!isCodeFile(rel)) continue;
    const text = readSafe(path.join(root, rel));
    if (text != null) out.push(...logicIn(text, rel));
  }
  return out;
}

/** The files a screen is made of: everything its `source` reaches, code only. */
export const screenFiles = (root, screen) => filesReachedFrom(screen?.source ?? [], root).filter(isCodeFile);

/**
 * THE FILES TODAY'S SCREEN IS MADE OF, without the options: the walk of `closure.mjs` from its `source`, never entering an
 * option's own entry file. The switch that makes an option reachable at an address usually imports the option from the
 * original's own file, and the option is not part of what the original does.
 */
export function originalFiles(root, original, avoid = [], commit = null) {
  const skip = new Set(avoid.map((rel) => path.join(root, rel)));
  /* At a commit, each file is read as that commit has it. */
  const read = (file) => (commit ? fileAt(root, commit, path.relative(root, file)) : null) ?? readSafe(file);
  const seen = new Set();
  const queue = (original?.source ?? []).map((rel) => path.join(root, rel)).filter((at) => existsSync(at) && !skip.has(at));
  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    if (!/\.(tsx?|jsx?|mjs)$/.test(file)) continue;
    const text = read(file);
    if (text == null) continue;
    for (const match of text.matchAll(IMPORT_RE)) {
      const next = resolveSpecifier(match[1] ?? match[2], file, root);
      if (next && !seen.has(next) && !skip.has(next)) queue.push(next);
    }
  }
  return [...seen].map((at) => path.relative(root, at)).filter(isCodeFile).sort();
}

/** The code files today's screen reaches at a commit, among the ones that commit has: what a base moved there checks. */
export function filesAt(root, record, commit) {
  const reached = originalFiles(root, { source: record.entries ?? [] }, record.avoid ?? [], commit);
  if (reached.length === 0) return record.files ?? [];
  try {
    const tracked = new Set(git(root, ["ls-tree", "-r", "--name-only", commit, "--", ...reached]).split("\n").filter(Boolean));
    return reached.filter((rel) => tracked.has(rel));
  } catch {
    return record.files ?? [];
  }
}

/* ------------------------------------------------------------------ names through re-exports */

const STAR_FROM = /\bexport\s*\*\s*(?:as\s+[\w$]+\s*)?from\s*["']([^"']+)["']/g;
const NAMED_FROM = /\bexport\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g;
const IMPORT_NAMES = /^import\s+(?:type\s+)?(?:([\w$]+)\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s*["']/;
const escapeRe = (text) => text.replace(/[$()*+.?[\\\]^{|}]/g, "\\$&");
/** `a as b` in an import or export list: [the name where it comes from, the name it has here]. */
const splitAs = (part) => {
  const [from, as = from] = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/).map((one) => one.trim());
  return [from, as];
};
/** Does this module's own code (re-exports cut out) export `name`? */
function exportsItself(src, name) {
  if (name === "default") return /\bexport\s+default\b/.test(src) || /\bexport\s*\{[^}]*\bas\s+default\b/.test(src);
  if (new RegExp(`\\bexport\\s+(?:declare\\s+)?(?:async\\s+)?(?:function\\*?|const|let|var|class|enum)\\s+${escapeRe(name)}\\b`).test(src)) return true;
  return [...src.matchAll(/\bexport\s*\{([^}]*)\}/g)].some((match) => match[1].split(",").some((part) => splitAs(part)[1] === name));
}
/**
 * THE FILE THAT DEFINES AN EXPORTED NAME, following `export { x } from` and `export * from` through barrels (an `index.ts` of
 * re-exports). Absolute path, or null when no module on the way exports it.
 */
export function definingFile(root, file, name, depth = 0) {
  if (depth > 8) return null;
  const text = readSafe(file);
  if (text == null) return null;
  const src = blankComments(text);
  for (const match of src.matchAll(NAMED_FROM))
    for (const part of match[1].split(",")) {
      const [from, as] = splitAs(part);
      if (as !== name || !from) continue;
      const next = resolveSpecifier(match[2], file, root);
      return next ? (definingFile(root, next, from, depth + 1) ?? next) : null;
    }
  if (exportsItself(src.replace(NAMED_FROM, " ").replace(STAR_FROM, " "), name)) return file;
  for (const match of src.matchAll(STAR_FROM)) {
    const next = resolveSpecifier(match[1], file, root);
    const found = next && definingFile(root, next, name, depth + 1);
    if (found) return found;
  }
  return null;
}
/** The names an import statement takes (`default` for a default import), or null when it takes the module whole. */
function importedNames(statement) {
  const match = IMPORT_NAMES.exec(statement.trim());
  if (!match || (!match[1] && match[2] === undefined)) return null;
  return new Set([...(match[1] ? ["default"] : []), ...(match[2] ?? "").split(",").map((part) => splitAs(part)[0]).filter(Boolean)]);
}
/**
 * EVERY PROJECT FILE THESE ENTRIES REACH, BY THE NAMES THEY IMPORT: like `filesReachedFrom`, except that a barrel's re-exports are
 * followed only to the modules that define a name asked of it, so importing one hook from a folder of hooks reaches that hook's
 * file and not every file the folder holds. Repo-relative, sorted.
 */
export function namedFilesReachedFrom(root, entries) {
  const seen = new Map();
  const queue = (entries ?? []).map((rel) => [path.join(root, rel), null]).filter(([at]) => existsSync(at));
  while (queue.length > 0) {
    const [file, names] = queue.pop();
    const had = seen.get(file);
    if (seen.has(file) && (had === null || (names !== null && [...names].every((one) => had.has(one))))) continue;
    const wanted = names === null || had === null ? null : new Set([...(had ?? []), ...names]);
    seen.set(file, wanted);
    if (!/\.(tsx?|jsx?|mjs)$/.test(file)) continue;
    const text = readSafe(file);
    if (text == null) continue;
    const src = blankComments(text);
    for (const match of src.matchAll(STAR_FROM)) {
      const next = resolveSpecifier(match[1], file, root);
      if (!next) continue;
      const asked = wanted === null ? null : [...wanted].filter((one) => definingFile(root, next, one));
      if (asked === null || asked.length > 0) queue.push([next, asked === null ? null : new Set(asked)]);
    }
    for (const match of src.matchAll(NAMED_FROM)) {
      const next = resolveSpecifier(match[2], file, root);
      if (!next) continue;
      const pairs = match[1].split(",").map(splitAs).filter(([from]) => from);
      const asked = wanted === null ? pairs.map(([from]) => from) : pairs.filter(([, as]) => wanted.has(as)).map(([from]) => from);
      if (asked.length > 0) queue.push([next, new Set(asked)]);
    }
    for (const match of src.replace(STAR_FROM, " ").replace(NAMED_FROM, " ").matchAll(IMPORT_RE)) {
      const next = resolveSpecifier(match[1] ?? match[2], file, root);
      if (next) queue.push([next, match[1] ? importedNames(match[0]) : null]);
    }
  }
  return [...seen.keys()].map((at) => path.relative(root, at)).sort();
}

/** The entry files of an exploration's options. */
const optionEntries = (explorationId, screens) => optionScreens(explorationId, screens).flatMap((one) => one.source ?? []);

/**
 * THE MODE OF ONE EXPLORATION: `{ id, mode, forced, original, reasons, why }`. `exploration` is the dumped one (with `mode`
 * and `original`), `screens` every dumped screen of the canvas. The `mode` field wins; otherwise the original's files decide.
 */
export function explorationMode({ root, exploration, screens, canvasDir = path.join(root, "design-canvas") }) {
  const id = exploration.id;
  /* Simple mode recorded on the reviewer's words (`recordMode`) forces it; a `mode: "simple"` in the declaration alone forces it
     only over a screen with no real logic. */
  const approved = (() => {
    try {
      return loadExceptions(canvasDir).entries.some((one) => one?.mode === "simple" && !("removed" in one) && one.exploration === id && !recordProblem(one));
    } catch {
      return false;
    }
  })();
  if (approved)
    return { id, mode: "simple", forced: true, original: exploration.original ?? null, reasons: [], why: "set to simple on the reviewer's words, recorded by parity.mjs --mode simple" };
  const originalId = exploration.original ?? null;
  const original = (screens ?? []).find((one) => one.id === originalId && one.view !== "exploration") ?? (screens ?? []).find((one) => one.id === originalId);
  /* The screen's own files first: they are what the line names. */
  const own = (original?.source ?? []).filter(isCodeFile);
  const logicOf = () => logicInFiles(root, [...own, ...originalFiles(root, original, optionEntries(id, screens)).filter((rel) => !own.includes(rel))]);
  let ignored = null;
  if (MODES.includes(exploration.mode)) {
    /* Set by hand to simple over a screen that holds real logic: it does not count without the reviewer's recorded words. */
    const held = exploration.mode === "simple" && original ? logicOf() : [];
    if (held.length > 0)
      ignored = `; its declaration sets mode: "simple", which over real logic counts only with the reviewer's words: node design-canvas/parity.mjs --canvas <slug> --exploration ${commandArg(id)} --mode simple --said-file <a file holding their exact words>`;
    else return {
      id,
      mode: exploration.mode,
      forced: true,
      original: originalId,
      reasons: [],
      why: `set in its declaration (mode: "${exploration.mode}")`,
    };
  }
  /* An original that cannot be read is a problem, not simple mode: the screen may be full of logic nobody checks. */
  if (!original) return originalId ? { id, mode: "simple", forced: false, original: originalId, reasons: [], unread: true, why: `its original "${originalId}" is no screen on this canvas` } : { id, mode: "simple", forced: false, original: originalId, reasons: [], why: "it names no original screen" };
  if (!(original.source ?? []).length) return { id, mode: "simple", forced: false, original: originalId, reasons: [], unread: true, why: `today's screen "${originalId}" lists no \`source\` files to read` };
  const reasons = logicOf();
  if (reasons.length === 0)
    return { id, mode: "simple", forced: false, original: originalId, reasons, why: `the files of today's screen "${originalId}" make no data calls, server actions, store reads or permission checks` };
  const shown = [];
  for (const one of reasons) if (!shown.some((seen) => seen.kind === one.kind) && shown.length < 3) shown.push(one);
  return {
    id,
    mode: "real-code",
    forced: false,
    original: originalId,
    reasons,
    why: `the files of today's screen "${originalId}" hold real logic (${shown.map((one) => `${one.what} at ${one.file}:${one.line}`).join("; ")}${reasons.length > shown.length ? `, ${reasons.length} in all` : ""})${ignored ?? ""}`,
  };
}

/** The one line the agent repeats to the user. */
export function modeLine(result) {
  const head = `exploration "${result.id}": ${result.mode} mode, because ${result.why}`;
  return result.mode === "real-code"
    ? `${head}. Options are UI-only files over its hooks and handlers, the chosen one is folded into its files, and the parity check gates every round`
    : `${head}. Options are built as usual`;
}

/* ------------------------------------------------------------------ 2. options are UI only */

/** The option frames of one exploration: what is compared, never a reference, a note, a suggestion or a wireframe. */
export const optionScreens = (explorationId, screens) =>
  (screens ?? []).filter((one) => one.flowId === explorationId && one.view === "exploration" && !one.reference && !one.suggests && !one.wireframe && !one.explain && !one.sticky);

/**
 * THE OPTION FILES' OWN DATA CALLS, in real-code mode: one line per call that an option's own files make (files its `source`
 * reaches that the original's do not). A raw call to a backend is always refused there, because the original's data comes
 * from the original's hooks; a named data hook is refused when the original's files neither call nor define it.
 */
export function ownDataCalls({ root, explorationId, screens, originalFiles }) {
  const theirs = new Set(originalFiles);
  /* What today's files call, not what they only define: a hooks folder re-exported whole reaches every hook it holds. */
  const known = new Set(logicInFiles(root, originalFiles).filter((one) => !one.defines).map((one) => one.what));
  const problems = [];
  const seen = new Set();
  for (const option of optionScreens(explorationId, screens)) {
    if (!(option.source ?? []).length) {
      problems.push(`${option.id}: names no \`source\`, so nothing can show it reuses the original's data: list the option's file`);
      continue;
    }
    for (const rel of namedFilesReachedFrom(root, option.source).filter(isCodeFile)) {
      if (theirs.has(rel)) continue;
      for (const call of logicIn(readSafe(path.join(root, rel)) ?? "", rel)) {
        if (call.kind !== "data" && call.kind !== "server") continue;
        const named = !call.raw && known.has(call.what);
        if (named) continue;
        const key = `${rel}:${call.line}:${call.what}`;
        if (seen.has(key)) continue;
        seen.add(key);
        problems.push(
          `${option.id}: ${rel}:${call.line} makes its own data call ${call.what}, which today's screen does not make: an option in real-code mode imports the original's hooks, handlers and data and only draws`,
        );
      }
    }
  }
  return problems;
}

/* ------------------------------------------------------------------ 3. the base */

const git = (root, args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] });

/** The commit checked out now, or null outside git. */
export function headCommit(root) {
  try {
    return git(root, ["rev-parse", "HEAD"]).trim() || null;
  } catch {
    return null;
  }
}

/** A commit-ish resolved to its full id, or null. */
export function resolveCommit(root, rev) {
  try {
    return git(root, ["rev-parse", "--verify", `${rev}^{commit}`]).trim() || null;
  } catch {
    return null;
  }
}

/** The file as it was at a commit (a path relative to `root`), or null when the commit does not have it. */
export function fileAt(root, commit, rel) {
  try {
    return git(root, ["show", `${commit}:./${rel}`]);
  } catch {
    return null;
  }
}

/**
 * THE BASE OF ONE EXPLORATION: the commit checked out when it was first captured and the code files today's screen reached
 * then, the ones that commit has. Files that differed from the commit at that moment are listed under `dirty`: their
 * uncommitted lines are not part of the base.
 */
export function baseRecord({ root, explorationId, mode, original, entries, avoid = [], commit = headCommit(root), at = new Date().toISOString() }) {
  if (!commit) return null;
  const reached = originalFiles(root, { source: entries ?? [] }, avoid);
  let tracked = new Set();
  let dirty = [];
  if (reached.length > 0) {
    try {
      tracked = new Set(git(root, ["ls-tree", "-r", "--name-only", commit, "--", ...reached]).split("\n").filter(Boolean));
      dirty = git(root, ["diff", "--name-only", "--relative", commit, "--", ...reached]).split("\n").filter(Boolean);
    } catch {
      /* A path git cannot read: the files it could are still the base. */
    }
  }
  return {
    exploration: explorationId,
    mode,
    original,
    entries: [...(entries ?? [])],
    commit,
    recordedAt: at,
    files: reached.filter((rel) => tracked.has(rel)),
    ...(avoid.length > 0 ? { avoid: [...avoid] } : {}),
    ...(dirty.length > 0 ? { dirty } : {}),
  };
}

/**
 * THE MANIFEST'S `bases` AFTER A CAPTURE: every declared exploration keeps the base it has (its mode refreshed), a new one gets
 * one, and one no longer declared keeps its base until its parity check passes (`releasable`), so retiring an exploration in
 * the same edit as the fold-in still checks the fold-in.
 */
export function nextBases({ root, previous = {}, explorations = [], screens = [], commit = headCommit(root) }) {
  const bases = {};
  const declared = new Set();
  for (const exploration of explorations) {
    declared.add(exploration.id);
    const { mode } = explorationMode({ root, exploration, screens });
    const had = previous?.[exploration.id];
    if (had?.commit) {
      bases[exploration.id] = { ...had, mode };
      continue;
    }
    const original = screens.find((one) => one.id === exploration.original && one.view !== "exploration") ?? screens.find((one) => one.id === exploration.original);
    const record = original
      ? baseRecord({ root, explorationId: exploration.id, mode, original: exploration.original, entries: original.source ?? [], avoid: optionEntries(exploration.id, screens), commit })
      : null;
    if (record) bases[exploration.id] = record;
  }
  for (const [id, record] of Object.entries(previous ?? {})) if (!declared.has(id) && record?.mode === "real-code") bases[id] = { ...record, retired: true };
  return bases;
}

/**
 * THE BASE FOLLOWS THE DEVELOPERS. When a pull, merge or rebase brings commits a remote-tracking ref holds, and they change files
 * an exploration's base lists, that base moves to the newest commit brought from the remote: the developers' version of those
 * files becomes what the option must keep, and only the designer's own edits are compared with it. Commits that were already
 * checked out before the command (the designer's own, pushed or not) never move a base. `before` is the commit checked out
 * before the git command (`rememberHead`). Returns one line per moved base; the manifests are written under each canvas's
 * capture lock, and a canvas whose capture is running is named with the command to move it by hand.
 */
const headFile = (canvasDir) => path.join(canvasDir, "rounds", "git-head");
export function rememberHead({ root, canvasDir }) {
  const head = headCommit(root);
  if (!head) return;
  mkdirSync(path.dirname(headFile(canvasDir)), { recursive: true });
  writeFileSync(headFile(canvasDir), `${head}\n`);
}
export function takeHead(canvasDir) {
  try {
    const head = readFileSync(headFile(canvasDir), "utf8").trim();
    rmSync(headFile(canvasDir), { force: true });
    return head || null;
  } catch {
    return null;
  }
}
const revs = (root, args) => {
  try {
    return git(root, ["rev-list", ...args]).split("\n").filter(Boolean);
  } catch {
    return [];
  }
};
/**
 * The commits the remote had when it was last fetched, not reachable from `before`: the values a fetch, a pull or a clone wrote
 * into the remote-tracking refs' logs. A push writes there too, so the refs as they are now would count the designer's own
 * pushed commits (a merge or a rebase the same command made) as the developers'. Null when the refs keep no log.
 */
function fetchedSince(root, before) {
  let refs = [];
  try {
    refs = git(root, ["for-each-ref", "--format=%(refname)", "refs/remotes"]).split("\n").filter(Boolean);
  } catch {
    return null;
  }
  const tips = new Set();
  let logged = false;
  for (const ref of refs) {
    let log = "";
    try {
      log = git(root, ["log", "-g", "--format=%H%x09%gs", ref, "--"]);
    } catch {
      continue;
    }
    for (const line of log.split("\n").filter(Boolean)) {
      logged = true;
      const [sha, subject = ""] = line.split("\t");
      if (/^(?:fetch|pull|clone)\b/.test(subject)) tips.add(sha);
    }
  }
  if (!logged) return null;
  return new Set(tips.size === 0 ? [] : revs(root, [...tips, "--not", before]));
}
export async function followRemote({ root, canvasDir, before }) {
  const head = headCommit(root);
  if (!before || !head || head === before) return [];
  const onRemote = fetchedSince(root, before) ?? new Set(revs(root, ["--remotes", "--not", before]));
  const brought = revs(root, ["--topo-order", head, "--not", before]).filter((sha) => onRemote.has(sha));
  if (brought.length === 0) return [];
  const tip = brought[0];
  const broughtSet = new Set(brought);
  const { lockHolder, takeLock } = await import("./recapture.mjs");
  const lines = [];
  let slugs = [];
  try {
    slugs = readdirSync(path.join(canvasDir, "shots"), { withFileTypes: true }).filter((one) => one.isDirectory() && !one.name.startsWith("_")).map((one) => one.name);
  } catch {
    return [];
  }
  for (const slug of slugs) {
    const manifest = readManifest(canvasDir, slug);
    const moves = Object.entries(manifest.bases ?? {})
      .filter(([, record]) => record?.commit && record.commit !== tip && (record.files ?? []).length > 0)
      .map(([id, record]) => ({ id, record, changed: [...new Set(revs(root, [head, "--not", before, "--", ...record.files]).filter((sha) => broughtSet.has(sha)))] }))
      .filter((one) => one.changed.length > 0);
    if (moves.length === 0) continue;
    const lock = path.join(canvasDir, "rounds", slug, "capture.lock");
    if (!takeLock(lock)) {
      for (const one of moves)
        lines.push(`design-canvas: the pull changed files of exploration "${one.id}" on ${slug}, and its base did not move because a capture of ${slug} is running (pid ${lockHolder(lock) ?? "unknown"}): node design-canvas/parity.mjs --canvas ${slug} --exploration ${commandArg(one.id, "<the exploration's id>")} --base ${tip.slice(0, 12)}`);
      continue;
    }
    try {
      const fresh = readManifest(canvasDir, slug);
      for (const one of moves) {
        if (!fresh.bases?.[one.id]) continue;
        const files = (one.record.files ?? []).filter((rel) => revs(root, [head, "--not", before, "--", rel]).some((sha) => broughtSet.has(sha)));
        fresh.bases[one.id] = { ...fresh.bases[one.id], commit: tip, files: filesAt(root, fresh.bases[one.id], tip), movedAt: new Date().toISOString() };
        lines.push(`design-canvas: the base of exploration "${one.id}" on ${slug} moved to ${tip.slice(0, 12)}, the pulled commit, because it changed ${files.slice(0, 2).join(", ")}${files.length > 2 ? ` and ${files.length - 2} more` : ""}`);
      }
      writeFileSync(path.join(canvasDir, "shots", slug, "manifest.json"), `${JSON.stringify(fresh, null, 2)}\n`, "utf8");
    } finally {
      rmSync(lock, { force: true });
    }
  }
  return lines;
}

/* ------------------------------------------------------------------ 4. the units */

/**
 * TypeScript, from the project first, then this folder, then a copy the machine already has (the global packages, then npx's
 * cache). Null when none has it: a JavaScript project without TypeScript gets a note instead of a parity check.
 */
export function loadTypescript(root) {
  for (const from of [root, HERE]) {
    try {
      return createRequire(path.join(from, "package.json"))("typescript");
    } catch {
      /* Not installed along this path. */
    }
  }
  const elsewhere = [path.join(path.dirname(process.execPath), "..", "lib", "node_modules", "typescript")];
  const npx = path.join(process.env.npm_config_cache || path.join(homedir(), ".npm"), "_npx");
  try {
    for (const one of readdirSync(npx)) elsewhere.push(path.join(npx, one, "node_modules", "typescript"));
  } catch {
    /* No npx cache. */
  }
  for (const dir of elsewhere) {
    if (!existsSync(path.join(dir, "package.json"))) continue;
    try {
      return createRequire(path.join(dir, "package.json"))(dir);
    } catch {
      /* A broken copy: the next one. */
    }
  }
  return null;
}

/** What the report says when no TypeScript is found, so the check is visibly off rather than failing every round. */
const NO_TYPESCRIPT = "parity is not checked: the parity check reads code with the typescript package, and neither this project nor this machine has it (npm install --save-dev typescript turns it on)";

const STYLE_PROPS = new Set(["className", "class", "style", "sx", "css", "tw", "variant", "size", "color", "tone", "intent", "appearance", "radius", "gap", "align", "justify", "direction", "width", "height", "icon", "theme", "key", "ref"]);
const DOOR_PROPS = new Set(["href", "to"]);
const NAV_CALLEE = /^(?:[\w$]*(?:router|history|navigation|navigator)[\w$]*\.(?:push|replace|navigate)|navigate|redirect|permanentRedirect|window\.open|(?:window\.)?location\.(?:assign|replace))$/i;
const I18N_CALLEE = /^(?:t|tc|tn|\$t|translate|formatMessage|__|_)$/;
const I18N_TAGS = /^(?:Trans|FormattedMessage|FormattedHTMLMessage)$/;
const I18N_KEY_FIELDS = new Set(["id", "key", "i18nKey"]);
const I18N_COPY_FIELDS = new Set(["defaultMessage", "defaultValue", "message", "defaults"]);
/** A component that is something an action opens: its last word says so, and it is not only that word. */
const OPENS_WORDS = /(?:Form|Wizard|Popover)$/;
const opensName = (name) => /^[A-Z]/.test(name) && /[a-z0-9][A-Z]/.test(name) && (surfaceKind(name) !== null || OPENS_WORDS.test(name));

/** Tokens of a piece of code, whitespace and comments out, strings in one quoting, `;` and trailing commas dropped. */
export function tokensOf(ts, text) {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, text);
  const out = [];
  const stack = [];
  for (let kind = scanner.scan(), guard = 0; kind !== ts.SyntaxKind.EndOfFileToken && guard < 200_000; kind = scanner.scan(), guard++) {
    if (kind === ts.SyntaxKind.CloseBraceToken && stack.at(-1) === "template") {
      kind = scanner.reScanTemplateToken(false);
      if (kind === ts.SyntaxKind.TemplateTail) stack.pop();
      out.push(scanner.getTokenText());
      continue;
    }
    if (kind === ts.SyntaxKind.TemplateHead) stack.push("template");
    else if (kind === ts.SyntaxKind.OpenBraceToken) stack.push("brace");
    else if (kind === ts.SyntaxKind.CloseBraceToken) stack.pop();
    if (kind === ts.SyntaxKind.SemicolonToken) continue;
    if (kind === ts.SyntaxKind.StringLiteral) out.push(JSON.stringify(scanner.getTokenValue()));
    else out.push(scanner.getTokenText());
  }
  return out.filter((token, at) => !(token === "," && [")", "]", "}"].includes(out[at + 1])));
}

const JSX_MARK = "<…>";
const T_MARK = "t(…)";
const TRIVIAL = new Set(["return", "break", "continue", "null", "undefined", "true", "false", "this", "void", "export", "default", "const", "let", "var", JSX_MARK, T_MARK]);

/** A short stable name for a binding's origin, written into the renamed form of a unit. */
const placeholderOf = (key) => {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619);
  return `$b${(hash >>> 0).toString(36)}`;
};
/** Attributes whose literal value is behavior: where a form or link goes and how, and what a field accepts. */
const DOOR_ATTRS = new Set(["action", "formAction", "target", "download"]);
const FIELD_ATTRS = new Set(["method", "required", "accept", "pattern", "min", "max", "minLength", "maxLength", "step", "multiple", "readOnly", "disabled"]);
const SUBMIT_TYPES = new Set(['"submit"', '"reset"', '"button"']);

/**
 * THE UNITS OF ONE FILE: `{ kind, text, alpha, line, end, pos, endPos, core }`. `text` is the unit as compared and printed;
 * `alpha` is the same unit with every locally bound name replaced by where its value comes from, so a renamed variable still
 * matches; `core` is the part an exception's location has to hold (the condition of a gated element, a handler's expression,
 * a key). An `element` unit is a rendered component (`from` is its import specifier, null when the file neither imports nor
 * declares it). Code inside a top-level declaration nothing in the module uses is dead and gives no units.
 */
export function unitsOf(ts, source, file) {
  const kindOf = /\.(tsx|jsx)$/.test(file) ? ts.ScriptKind.TSX : /\.(js|mjs)$/.test(file) ? ts.ScriptKind.JSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kindOf);
  const units = [];
  /* Set while the second walk writes the renamed form (`alpha`). */
  let alpha = false;
  const placeholders = new Map();
  const lineAt = (pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;
  const isJsx = (n) => ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n);
  const calleeName = (call) => {
    const callee = call.expression;
    if (ts.isIdentifier(callee)) return callee.text;
    if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
    return null;
  };
  const isI18nCall = (n) => ts.isCallExpression(n) && I18N_CALLEE.test(calleeName(n) ?? "") && n.arguments.length > 0;
  const isNavCall = (n) => ts.isCallExpression(n) && NAV_CALLEE.test(n.expression.getText(sf).replace(/\s+/g, ""));
  const contains = (node, test) => {
    let found = false;
    const visit = (n) => {
      if (found) return;
      if (test(n)) found = true;
      else ts.forEachChild(n, visit);
    };
    visit(node);
    return found;
  };
  /** A name in a position where it is a property or an attribute, not the binding: never renamed. */
  const isNamePosition = (n) => {
    const up = n.parent;
    return Boolean(
      up &&
        (((ts.isPropertyAccessExpression(up) || ts.isPropertyAssignment(up) || ts.isJsxAttribute(up) || ts.isMethodDeclaration(up) || ts.isPropertyDeclaration(up) || ts.isPropertySignature(up)) && up.name === n) ||
          (ts.isBindingElement(up) && up.propertyName === n) ||
          ts.isImportSpecifier(up) ||
          ts.isExportSpecifier(up) ||
          (ts.isQualifiedName(up) && up.right === n)),
    );
  };
  /** In the renamed form: what replaces this node, or null to keep it. A shorthand `{ data }` is written `data : <origin>`. */
  const renameOf = (n) => {
    if (!alpha) return null;
    if (ts.isIdentifier(n) && placeholders.has(n.text) && !isNamePosition(n)) return placeholders.get(n.text);
    if (ts.isShorthandPropertyAssignment(n) && placeholders.has(n.name.text) && !n.objectAssignmentInitializer) return `${n.name.text} : ${placeholders.get(n.name.text)}`;
    if (ts.isBindingElement(n) && !n.propertyName && !n.dotDotDotToken && !n.initializer && ts.isIdentifier(n.name) && placeholders.has(n.name.text) && ts.isObjectBindingPattern(n.parent))
      return `${n.name.text} : ${placeholders.get(n.name.text)}`;
    return null;
  };
  /** The node's code with markup and translation calls cut out (each is its own unit). */
  const codeOf = (node) => {
    const start = node.getStart(sf);
    let text = sf.text.slice(start, node.getEnd());
    const cuts = [];
    const visit = (n) => {
      if (isJsx(n)) return cuts.push([n.getStart(sf) - start, n.getEnd() - start, JSX_MARK]);
      if (isI18nCall(n)) return cuts.push([n.getStart(sf) - start, n.getEnd() - start, T_MARK]);
      const renamed = renameOf(n);
      if (renamed !== null) return cuts.push([n.getStart(sf) - start, n.getEnd() - start, renamed]);
      ts.forEachChild(n, visit);
    };
    if (isJsx(node)) return JSX_MARK;
    if (isI18nCall(node)) return T_MARK;
    const whole = renameOf(node);
    if (whole !== null) return whole;
    ts.forEachChild(node, visit);
    for (const [a, b, mark] of cuts.sort((x, y) => y[0] - x[0])) text = `${text.slice(0, a)} ${mark} ${text.slice(b)}`;
    return text;
  };
  const norm = (code) =>
    tokensOf(ts, code.replaceAll(JSX_MARK, " __JSX__ ").replaceAll(T_MARK, " __T__ "))
      .map((token) => (token === "__JSX__" ? JSX_MARK : token === "__T__" ? T_MARK : token))
      .join(" ")
      .replace(/\( (?:\( )*<…>(?: \))* \)/g, JSX_MARK);
  const add = (kind, node, text, core = text) => {
    if (!text || text.split(" ").every((token) => TRIVIAL.has(token) || /^[(){}[\],.:=;]+$/.test(token))) return;
    units.push({ kind, text, line: lineAt(node.getStart(sf)), end: lineAt(node.getEnd()), pos: node.getStart(sf), endPos: node.getEnd(), core });
  };
  /** A handler that only forwards to another function (`() => onDelete()`, `(e) => onChange(e)`) is that function. */
  const forwarded = (expr) => {
    if (!ts.isArrowFunction(expr) || !ts.isCallExpression(expr.body)) return expr;
    const callee = expr.body.expression;
    if (!ts.isIdentifier(callee) && !ts.isPropertyAccessExpression(callee)) return expr;
    const params = expr.parameters.map((one) => (ts.isIdentifier(one.name) ? one.name.text : null));
    const args = expr.body.arguments.map((one) => (ts.isIdentifier(one) ? one.text : null));
    return args.length === 0 || (args.length === params.length && args.every((one, at) => one !== null && one === params[at])) ? callee : expr;
  };

  /* WHAT THE FILE IMPORTS AND DECLARES, for the rendered components. */
  const imported = new Map();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !st.importClause || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    const spec = st.moduleSpecifier.text;
    if (st.importClause.name) imported.set(st.importClause.name.text, { spec, name: "default" });
    const bindings = st.importClause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) imported.set(bindings.name.text, { spec, name: null });
    else if (bindings) for (const one of bindings.elements) imported.set(one.name.text, { spec, name: (one.propertyName ?? one.name).text });
  }
  const declared = new Set();
  const namesIn = (name) => (ts.isIdentifier(name) ? [name.text] : ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name) ? name.elements.flatMap((one) => (ts.isOmittedExpression(one) ? [] : namesIn(one.name))) : []);

  /* THE BINDINGS, by where each value comes from: a name bound from one origin only is renamed to that origin in `alpha`. */
  const origins = new Map();
  const bind = (name, key) => {
    if (ts.isIdentifier(name)) {
      if (!origins.has(name.text)) origins.set(name.text, new Set());
      origins.get(name.text).add(key);
    } else if (ts.isObjectBindingPattern(name)) {
      for (const one of name.elements) bind(one.name, `${key}.${one.dotDotDotToken ? "..." : (one.propertyName ?? one.name).getText(sf)}`);
    } else if (ts.isArrayBindingPattern(name)) name.elements.forEach((one, at) => !ts.isOmittedExpression(one) && bind(one.name, `${key}[${at}]`));
  };
  const ownerOf = (fn) => {
    if (fn.name && ts.isIdentifier(fn.name)) return fn.name.text;
    const up = fn.parent;
    if (up && ts.isVariableDeclaration(up) && ts.isIdentifier(up.name)) return up.name.text;
    if (up && ts.isCallExpression(up)) return `${calleeName(up) ?? "call"}(${up.arguments.indexOf(fn)})`;
    if (up && ts.isJsxExpression(up) && up.parent && ts.isJsxAttribute(up.parent)) return `@${up.parent.name.getText(sf)}`;
    if (up && ts.isPropertyAssignment(up)) return `:${up.name.getText(sf)}`;
    return "fn";
  };
  const collect = (node) => {
    if (ts.isVariableDeclaration(node)) {
      const loop = node.parent?.parent;
      const key = node.initializer ? `=${norm(codeOf(node.initializer))}` : loop && (ts.isForOfStatement(loop) || ts.isForInStatement(loop)) ? `of ${norm(codeOf(loop.expression))}` : `#${node.name.getText(sf)}`;
      bind(node.name, key);
      for (const one of namesIn(node.name)) declared.add(one);
    } else if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node)) {
      const owner = ownerOf(node);
      node.parameters.forEach((one, at) => bind(one.name, `${owner}#${at}`));
      if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) && node.name) declared.add(node.name.text);
    } else if (ts.isClassDeclaration(node) && node.name) declared.add(node.name.text);
    else if (ts.isCatchClause(node) && node.variableDeclaration) bind(node.variableDeclaration.name, "catch");
    ts.forEachChild(node, collect);
  };
  collect(sf);
  for (const [name, keys] of origins) if (keys.size === 1) placeholders.set(name, placeholderOf([...keys][0]));

  /* DEAD CODE: a top-level function, class or function-valued constant that is not exported and that nothing live in the module
     uses. A statement that is not such a declaration is live, and so is what a live statement names, until nothing changes. */
  const dead = new Set();
  const exportedHere = (st) => (st.modifiers ?? []).some((one) => one.kind === ts.SyntaxKind.ExportKeyword);
  const isModule = sf.statements.some((st) => ts.isImportDeclaration(st) || ts.isExportDeclaration(st) || ts.isExportAssignment(st) || exportedHere(st));
  if (isModule) {
    const functionValued = (init) => {
      let e = init;
      while (e && (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression?.(e))) e = e.expression;
      return Boolean(e) && (ts.isArrowFunction(e) || ts.isFunctionExpression(e) || ts.isClassExpression(e));
    };
    const candidates = [];
    for (const st of sf.statements) {
      if (exportedHere(st)) continue;
      if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && st.name) candidates.push({ st, names: [st.name.text] });
      else if (ts.isVariableStatement(st) && st.declarationList.declarations.every((one) => functionValued(one.initializer)))
        candidates.push({ st, names: st.declarationList.declarations.flatMap((one) => namesIn(one.name)) });
    }
    const usedBy = new Map();
    const usedIn = (st) => {
      if (!usedBy.has(st)) {
        const names = new Set();
        const walk = (n) => {
          if (ts.isIdentifier(n) && !isNamePosition(n)) names.add(n.text);
          ts.forEachChild(n, walk);
        };
        walk(st);
        usedBy.set(st, names);
      }
      return usedBy.get(st);
    };
    const live = new Set(sf.statements.filter((st) => !candidates.some((one) => one.st === st)));
    for (let grew = true; grew; ) {
      grew = false;
      const named = new Set();
      for (const st of live) for (const name of usedIn(st)) named.add(name);
      for (const one of candidates)
        if (!live.has(one.st) && one.names.some((name) => named.has(name))) {
          live.add(one.st);
          grew = true;
        }
    }
    for (const one of candidates) if (!live.has(one.st)) dead.add(one.st);
  }
  /** The outermost elements an expression renders, by tag, for the printed unit. */
  const outerTags = (node) => {
    const tags = [];
    const visit = (n) => {
      if (ts.isJsxElement(n)) return tags.push(n.openingElement.tagName.getText(sf));
      if (ts.isJsxSelfClosingElement(n)) return tags.push(n.tagName.getText(sf));
      if (ts.isJsxFragment(n)) return n.children.forEach(visit);
      ts.forEachChild(n, visit);
    };
    visit(node);
    return [...new Set(tags)];
  };
  /** The test part of a gated expression: `a` of `a && <X/>`, `c` of `c ? <A/> : <B/>`. */
  const conditionOf = (expr) => {
    let e = expr;
    while (ts.isParenthesizedExpression(e)) e = e.expression;
    if (ts.isConditionalExpression(e)) return norm(codeOf(e.condition));
    if (ts.isBinaryExpression(e) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(e.operatorToken.kind))
      return norm(codeOf(e.left));
    return norm(codeOf(e)).split(JSX_MARK)[0].trim() || norm(codeOf(e));
  };
  const literalOf = (n) => (n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? JSON.stringify(n.text) : null);
  const i18nObject = (obj, node) => {
    for (const prop of obj.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      const name = prop.name.getText(sf).replace(/["']/g, "");
      const value = literalOf(prop.initializer) ?? (I18N_KEY_FIELDS.has(name) ? norm(codeOf(prop.initializer)) : null);
      if (value == null) continue;
      if (I18N_KEY_FIELDS.has(name)) add("key", node, value);
      else if (I18N_COPY_FIELDS.has(name)) add("copy", node, value);
    }
  };
  const outsideParens = (node) => {
    let up = node.parent;
    while (up && ts.isParenthesizedExpression(up)) up = up.parent;
    return up;
  };
  const statementKind = (node) => (contains(node, isNavCall) ? "door" : "logic");
  const hasStatementInside = (node) => {
    let found = false;
    const visit = (n) => {
      if (found) return;
      if (ts.isStatement(n) && !ts.isBlock(n)) found = true;
      else ts.forEachChild(n, visit);
    };
    ts.forEachChild(node, visit);
    return found;
  };

  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node) || dead.has(node)) return;

    /* Statements: the leaves whole, a compound statement by its header. */
    if (ts.isIfStatement(node)) add("logic", node, `if ( ${norm(codeOf(node.expression))} )`, norm(codeOf(node.expression)));
    else if (ts.isWhileStatement(node) || ts.isDoStatement(node)) add("logic", node, `while ( ${norm(codeOf(node.expression))} )`, norm(codeOf(node.expression)));
    else if (ts.isSwitchStatement(node)) add("logic", node, `switch ( ${norm(codeOf(node.expression))} )`, norm(codeOf(node.expression)));
    else if (ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node)) {
      const header = norm(sf.text.slice(node.getStart(sf), node.statement.getStart(sf)));
      add("logic", node, header);
    } else if (ts.isCaseClause(node)) add("logic", node, `case ${norm(codeOf(node.expression))} :`, norm(codeOf(node.expression)));
    else if (ts.isCatchClause(node) && node.variableDeclaration) add("logic", node, `catch ( ${norm(node.variableDeclaration.getText(sf))} )`);
    else if (ts.isStatement(node) && !ts.isBlock(node) && !hasStatementInside(node)) {
      const text = norm(codeOf(node));
      add(statementKind(node), node, text);
    }

    /* Translation calls and message objects: the key, and the default copy. */
    if (isI18nCall(node)) {
      const [first, second] = node.arguments;
      if (ts.isObjectLiteralExpression(first)) i18nObject(first, node);
      else add("key", node, literalOf(first) ?? norm(codeOf(first)));
      if (second && literalOf(second)) add("copy", node, literalOf(second));
      else if (second && ts.isObjectLiteralExpression(second)) i18nObject(second, node);
    } else if (ts.isObjectLiteralExpression(node) && !(node.parent && isI18nCall(node.parent))) {
      const names = node.properties.filter(ts.isPropertyAssignment).map((prop) => prop.name.getText(sf).replace(/["']/g, ""));
      if (names.includes("id") && names.some((name) => name === "defaultMessage")) i18nObject(node, node);
    }

    /* Markup: what an element is given, what it is gated by, what it opens. */
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(sf);
      if (I18N_TAGS.test(tag)) {
        let keyed = false;
        for (const attr of node.attributes.properties) {
          if (!ts.isJsxAttribute(attr)) continue;
          const name = attr.name.getText(sf);
          const value = attr.initializer && (literalOf(attr.initializer) ?? (ts.isJsxExpression(attr.initializer) && attr.initializer.expression ? literalOf(attr.initializer.expression) ?? norm(codeOf(attr.initializer.expression)) : null));
          if (value == null) continue;
          if (I18N_KEY_FIELDS.has(name)) {
            add("key", node, value);
            keyed = true;
          } else if (I18N_COPY_FIELDS.has(name)) add("copy", node, value);
        }
        const element = node.parent;
        if (!keyed && ts.isJsxOpeningElement(node) && ts.isJsxElement(element)) {
          const words = element.children.filter(ts.isJsxText).map((one) => one.getText(sf)).join(" ").replace(/\s+/g, " ").trim();
          if (words) add("copy", node, JSON.stringify(words));
        }
      }
      const root = tag.split(".")[0];
      if (opensName(tag)) add("opens", node, `<${tag}>`, tag);
      else if (/^[A-Z]/.test(root) && root !== "React" && tag !== "Fragment" && !I18N_TAGS.test(tag) && !(declared.has(root) && !imported.has(root)))
        units.push({ kind: "element", text: `<${tag}>`, line: lineAt(node.getStart(sf)), end: lineAt(node.getEnd()), pos: node.getStart(sf), endPos: node.getEnd(), core: tag, from: imported.get(root)?.spec ?? null, name: imported.get(root) ? (imported.get(root).name ?? tag.split(".")[1] ?? null) : null });
      /* What a prop is given to: a prop counts only where it is behavior (see `PROP_BEHAVIOR` and `parityOf`). */
      const owner = { tag, from: imported.get(root)?.spec ?? null, name: imported.get(root) ? (imported.get(root).name ?? tag.split(".")[1] ?? null) : null, local: declared.has(root) && !imported.has(root), intrinsic: !/^[A-Z]/.test(root) };
      const addProp = (attr, text, core, attrName) => {
        const had = units.length;
        add("prop", attr, text, core);
        if (units.length > had) Object.assign(units[units.length - 1], { attr: attrName, of: owner });
      };
      for (const attr of node.attributes.properties) {
        if (ts.isJsxSpreadAttribute(attr)) {
          addProp(attr, `{ ... ${norm(codeOf(attr.expression))} }`, norm(codeOf(attr.expression)), null);
          continue;
        }
        const name = attr.name.getText(sf);
        const init = attr.initializer;
        /* A literal value, written as a string or in braces: `type="submit"`, `required`, `required={true}`. */
        const literal = !init ? true : ts.isStringLiteral(init) ? literalOf(init) : ts.isJsxExpression(init) && init.expression && (literalOf(init.expression) ?? (init.expression.kind === ts.SyntaxKind.TrueKeyword ? true : null));
        if (literal != null && literal !== false && (DOOR_ATTRS.has(name) || FIELD_ATTRS.has(name) || (name === "type" && (/^(?:input|button)$/.test(tag) || SUBMIT_TYPES.has(literal))))) {
          const text = literal === true ? name : `${name} = ${literal}`;
          add(DOOR_ATTRS.has(name) ? "door" : "field", attr, text, literal === true ? name : literal);
          continue;
        }
        if (!init) continue;
        if (ts.isStringLiteral(init)) {
          if (name === "name") add("field", attr, `name = ${literalOf(init)}`, literalOf(init));
          else if (DOOR_PROPS.has(name)) add("door", attr, literalOf(init));
          continue;
        }
        if (!ts.isJsxExpression(init) || !init.expression) continue;
        const expr = init.expression;
        const handles = /^on[A-Z]/.test(name) || name === "action" || name === "formAction";
        const value = norm(codeOf(handles ? forwarded(expr) : expr));
        if (handles) add(contains(expr, isNavCall) ? "door" : "handler", attr, value);
        else if (DOOR_PROPS.has(name)) add("door", attr, value);
        else if (name === "name") add("field", attr, `name = { ${value} }`, value);
        else if (STYLE_PROPS.has(name) || I18N_TAGS.test(tag)) continue;
        else if (ts.isStringLiteral(expr) || ts.isNumericLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr) || expr.kind === ts.SyntaxKind.TrueKeyword || expr.kind === ts.SyntaxKind.FalseKeyword) continue;
        else if (value !== JSX_MARK && value !== T_MARK) addProp(attr, `${name} = { ${value} }`, value, name);
      }
    }
    /* A gate outside the markup's braces: `return canEdit ? <X /> : null`, `const extra = open && <Y />`. */
    if (
      (ts.isConditionalExpression(node) || (ts.isBinaryExpression(node) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind))) &&
      contains(node, isJsx) &&
      !((up) => up && (ts.isJsxExpression(up) || ts.isConditionalExpression(up) || ts.isBinaryExpression(up)))(outsideParens(node))
    )
      units.push({ kind: "condition", text: `${norm(codeOf(node))}`, line: lineAt(node.getStart(sf)), end: lineAt(node.getEnd()), pos: node.getStart(sf), endPos: node.getEnd(), core: conditionOf(node), shows: outerTags(node) });
    if (ts.isJsxExpression(node) && node.expression && node.parent && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
      const expr = node.expression;
      if (!isI18nCall(expr)) {
        const text = norm(codeOf(expr));
        let top = expr;
        while (ts.isParenthesizedExpression(top)) top = top.expression;
        const gated = ts.isConditionalExpression(top) || (ts.isBinaryExpression(top) && /&&|\|\||\?\?/.test(top.operatorToken.getText(sf)));
        /* A list or a render function is structure: what it renders gives units of its own, so a table that becomes cards loses
           nothing by drawing its rows another way. */
        if (!gated && (contains(expr, isJsx) || ts.isFunctionLike(top))) {
          /* nothing */
        } else if (gated) {
          const tags = outerTags(expr);
          units.push({ kind: "condition", text: `{ ${text} }`, line: lineAt(node.getStart(sf)), end: lineAt(node.getEnd()), pos: node.getStart(sf), endPos: node.getEnd(), core: conditionOf(expr), shows: tags });
        } else if (text !== T_MARK) add("shows", node, `{ ${text} }`, text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  const plain = units.splice(0);
  alpha = true;
  visit(sf);
  const renamed = units.splice(0);
  /* The second walk emits the same units in the same order; only their text differs. */
  return plain.map((unit, at) => ({ ...unit, alpha: renamed.length === plain.length ? renamed[at].text : unit.text }));
}

/* ------------------------------------------------------------------ 5. the check */

const unitKey = (unit) => `${unit.kind}\u0000${unit.text}`;
const PRESENCE_ONLY = new Set(["key", "copy"]);

/** The printed form of a unit: what a person reads, and what an exception's `unit` names. */
export const unitLabel = (unit) => (unit.kind === "condition" && unit.shows?.length ? `${unit.text}  (gates ${unit.shows.map((tag) => `<${tag}>`).join(", ")})` : unit.text);

/** Units of `before` that `after` no longer has, as a multiset (key and copy only by presence). */
export function missingUnits(before, after) {
  /* Two passes, so a loss is named by what it gated: a unit is matched to one that gates the same elements first, and to
     any with the same text only after that. */
  const exact = (unit) => `${unitKey(unit)}\u0000${(unit.shows ?? []).join(",")}`;
  const count = (list, keyOf) => {
    const map = new Map();
    for (const unit of list) map.set(keyOf(unit), (map.get(keyOf(unit)) ?? 0) + 1);
    return map;
  };
  const take = (map, key) => {
    const left = map.get(key) ?? 0;
    if (left > 0) map.set(key, left - 1);
    return left > 0;
  };
  const exactLeft = count(after, exact);
  const textLeft = count(after, unitKey);
  const open = [];
  for (const unit of before) {
    if (PRESENCE_ONLY.has(unit.kind)) {
      if (!textLeft.has(unitKey(unit))) open.push(unit);
      continue;
    }
    if (take(exactLeft, exact(unit))) take(textLeft, unitKey(unit));
    else open.push(unit);
  }
  const missing = [];
  for (const unit of open) {
    if (PRESENCE_ONLY.has(unit.kind)) {
      if (!missing.some((one) => unitKey(one) === unitKey(unit))) missing.push(unit);
      continue;
    }
    /* Every exact match is taken by now, so what is left of the same text may stand for this one. */
    if (take(textLeft, unitKey(unit))) continue;
    missing.push(unit);
  }
  /* A unit whose text changed only because a local name was renamed is still there: what is left of `after` is compared once
     more, each name standing for where its value comes from. */
  /* A gate written in the markup's braces or as a function's body is the same gate. */
  const alphaKey = (unit) => `${unit.kind}\u0000${unit.kind === "condition" ? (unit.alpha ?? unit.text).replace(/^\{ ([\s\S]*) \}$/, "$1") : (unit.alpha ?? unit.text)}`;
  const leftover = [];
  for (const [key, left] of textLeft) if (left > 0) leftover.push(...after.filter((one) => unitKey(one) === key).slice(-left));
  const alphaLeft = count(leftover, alphaKey);
  for (let at = missing.length - 1; at >= 0; at--)
    if (!PRESENCE_ONLY.has(missing[at].kind) && missing[at].alpha && take(alphaLeft, alphaKey(missing[at]))) missing.splice(at, 1);
  /* What sits inside a lost handler or gated block is the same loss said twice: the outer unit names it. Of several equal
     units, the ones inside a lost block are the ones counted as lost, so they are the ones it names. */
  const OUTER = ["handler", "condition", "door"];
  const outer = missing.filter((one) => OUTER.includes(one.kind));
  /* By position when both have one, so a loss beside a lost block on the same line is still named. */
  const within = (o, one) => (o.pos != null && one.pos != null ? o.pos <= one.pos && o.endPos >= one.endPos : o.line <= one.line && o.end >= one.end);
  const inside = (one) => outer.some((o) => o !== one && within(o, one));
  const chosen = [];
  for (const unit of missing) {
    if (PRESENCE_ONLY.has(unit.kind) || OUTER.includes(unit.kind) || chosen.some((one) => unitKey(one) === unitKey(unit))) continue;
    const lostHere = missing.filter((one) => unitKey(one) === unitKey(unit)).length;
    const candidates = before.filter((one) => unitKey(one) === unitKey(unit));
    chosen.push(...[...candidates.filter(inside), ...candidates.filter((one) => !inside(one))].slice(0, lostHere));
  }
  /* A lost gated block names everything in it but its keys and copy; a lost handler names the statements in it; a lost
     component names what it was given. */
  const listed = [...missing.filter((one) => PRESENCE_ONLY.has(one.kind) || OUTER.includes(one.kind)), ...chosen];
  const elements = listed.filter((one) => one.kind === "element" && one.pos != null);
  const coveredBy = (one) =>
    outer.some((o) => o !== one && within(o, one) && (o.kind === "condition" || ["logic", "door"].includes(one.kind))) ||
    (one.kind !== "element" && one.pos != null && elements.some((o) => within(o, one)));
  return listed
    .filter((one) => PRESENCE_ONLY.has(one.kind) || !coveredBy(one))
    .sort((a, b) => a.line - b.line || before.indexOf(a) - before.indexOf(b));
}

/**
 * DOES `file:line` HOLD THIS UNIT'S LOGIC? A unit of that file starting on the named line (or on the next lines, up to twice
 * the lines the unit had) has the same logic: the same statement, or the same condition, handler, value, door or key. A
 * line that only mentions a name the unit used is not enough (`!isAdmin` does not hold `isAdmin && …`). A file that is no
 * longer reached is held by a line that imports or renders it.
 */
export function locationHolds({ ts, root, unit, movedTo }) {
  const match = /^(.+):(\d+)$/.exec(String(movedTo ?? "").trim());
  if (!match) return { ok: false, why: `"movedTo" is not <file>:<line>` };
  const [, rel, lineText] = match;
  const text = readSafe(path.join(root, rel));
  if (text == null) return { ok: false, why: `${rel} does not exist` };
  const line = Number(lineText);
  const lines = text.split("\n");
  if (line < 1 || line > lines.length) return { ok: false, why: `${rel} has no line ${line}` };
  const last = line + Math.max(1, (unit.end ?? unit.line) - unit.line + 1) * 2 - 1;
  if (unit.kind === "reach") {
    /* Only an import that starts on the named line and resolves to the lost file holds it. */
    const from = lines.slice(0, line - 1).join("\n").length + (line > 1 ? 1 : 0);
    const target = unit.file ? path.join(root, unit.file) : null;
    const holds = [...text.matchAll(IMPORT_RE)].some((one) => one.index >= from && one.index < from + lines[line - 1].length + 1 && target && resolveSpecifier(one[1] ?? one[2], path.join(root, rel), root) === target);
    return holds ? { ok: true } : { ok: false, why: `${rel}:${line} does not import ${unit.file ?? unit.core}` };
  }
  /* A handler or a prop that names a function is held by one that calls or passes that same function. */
  const refers = (core, name) => {
    const tokens = String(core).split(" ");
    const want = String(name).split(" ");
    for (let at = 0; at + want.length <= tokens.length; at++) if (want.every((one, i) => tokens[at + i] === one) && tokens[at - 1] !== "." && tokens[at - 1] !== "?.") return true;
    return false;
  };
  const named = ["handler", "prop"].includes(unit.kind) && /^[\w$]+(?: (?:\.|\?\.) [\w$]+)*$/.test(String(unit.core));
  const same = (one) =>
    unit.kind === "logic"
      ? one.text === unit.text || (unit.alpha != null && one.alpha === unit.alpha)
      : (one.core === unit.core && (one.kind === unit.kind || unit.kind === "condition" || one.kind === "condition")) || (named && one.kind === unit.kind && refers(one.core, unit.core));
  const held = unitsOf(ts, text, rel).some((one) => one.line >= line && one.line < last && same(one));
  return held ? { ok: true } : { ok: false, why: `${rel}:${line} does not hold ${unit.kind === "logic" ? unit.text : unit.core}` };
}

/** The exceptions file beside the declaration: an array, or a problem saying why it is not one. */
export function loadExceptions(canvasDir) {
  const file = path.join(canvasDir, "project", EXCEPTIONS_FILE);
  if (!existsSync(file)) return { entries: [], problems: [] };
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (!Array.isArray(parsed)) return { entries: [], problems: [`project/${EXCEPTIONS_FILE} is not an array of exceptions`] };
    return { entries: parsed, problems: [] };
  } catch (error) {
    return { entries: [], problems: [`project/${EXCEPTIONS_FILE} does not parse: ${String(error.message).split("\n")[0]}`] };
  }
}

/**
 * THE PARITY OF ONE BASE: `{ checked, changed, units, failures, excused, refused, unused }`. `failures` are the units of the
 * base files that the working tree lost, each `{ file, line, kind, text, label }`; an accepted exception moves one to
 * `excused`; an exception that names no location, or one that does not hold the unit, is in `refused` and counts as a
 * failure too.
 */
/** What makes a file's absence or a component's removal a loss: these units, or a real-logic call. */
const BEHAVIOR = new Set(["handler", "condition", "door", "field", "opens"]);
/** Props that are behavior on any element: a field's value and state, and what is disabled, hidden or open. */
const PROP_BEHAVIOR = new Set(["value", "defaultValue", "checked", "defaultChecked", "disabled", "readOnly", "required", "hidden", "open", "selected", "multiple"]);

export function parityOf({ ts, root, record, exceptions = [] }) {
  const result = { exploration: record.exploration, commit: record.commit, checked: 0, changed: 0, units: 0, failures: [], excused: [], refused: [], unused: [] };
  const files = (record.files ?? []).filter(isCodeFile);
  result.checked = files.length;
  let changed = [];
  if (files.length > 0) {
    try {
      changed = git(root, ["diff", "--name-only", "--relative", record.commit, "--", ...files]).split("\n").filter(Boolean);
    } catch (error) {
      result.failures.push({ file: "", line: 0, kind: "base", text: `git cannot compare with the base commit ${String(record.commit).slice(0, 12)}`, label: `git cannot compare with the base commit ${String(record.commit).slice(0, 12)}` });
      return result;
    }
  }
  const changedSet = new Set(changed);
  result.changed = changed.length;
  const reachedNow = new Set(filesReachedFrom(record.entries ?? [], root));
  const baseText = (rel) => ((record.files ?? []).includes(rel) && changedSet.has(rel) ? fileAt(root, record.commit, rel) : null) ?? readSafe(path.join(root, rel));
  const behaviorCache = new Map();
  const holdsBehavior = (rel) => {
    if (!behaviorCache.has(rel)) {
      const text = baseText(rel);
      behaviorCache.set(rel, text != null && (logicIn(text, rel).length > 0 || unitsOf(ts, text, rel).some((one) => BEHAVIOR.has(one.kind))));
    }
    return behaviorCache.get(rel);
  };
  /* A rendered component counts when it is the project's own and its file does something: a package's component, or one that
     only draws, may be swapped in a redesign. One the file neither imports nor declares counts, because nothing says what it is. */
  const component = (rel, from, name) => {
    if (from == null) return true;
    const at = path.join(root, rel);
    const resolved = resolveSpecifier(from, at, root);
    if (!resolved) return specifierBase(from, at, root) !== null;
    const defined = (name && definingFile(root, resolved, name)) || resolved;
    const definedRel = path.relative(root, defined);
    return isCodeFile(definedRel) && holdsBehavior(definedRel);
  };
  /* Layout is free: a prop given to an element, or to a component that only draws, is how it looks, not what it does. A prop
     counts when its name is behavior, or when the component it is given to is one that does something. */
  const matters = (rel) => (unit) => {
    if (unit.kind === "element") return component(rel, unit.from, unit.name);
    if (unit.kind !== "prop" || !unit.of) return true;
    if (PROP_BEHAVIOR.has(unit.attr)) return true;
    if (unit.of.intrinsic || unit.of.local) return false;
    return component(rel, unit.of.from, unit.of.name);
  };
  for (const rel of files) {
    const now = readSafe(path.join(root, rel));
    if (now == null) {
      result.failures.push({ file: rel, line: 0, kind: "file", text: "deleted", label: "the file is gone" });
      continue;
    }
    if (!reachedNow.has(rel)) {
      const before = changedSet.has(rel) ? fileAt(root, record.commit, rel) : now;
      const logic = before == null ? [] : logicIn(before, rel);
      const held = before == null || logic.length > 0 ? [] : unitsOf(ts, before, rel).filter((one) => BEHAVIOR.has(one.kind));
      if (logic.length > 0 || held.length > 0) {
        const what = logic.length > 0 ? logic.slice(0, 2).map((one) => one.what) : held.slice(0, 2).map((one) => `${one.kind} ${unitLabel(one)}`);
        const line = (logic[0] ?? held[0]).line;
        const label = `no longer reached from today's screen "${record.original}", and it holds ${what.join(", ")}`;
        result.failures.push({ file: rel, line, end: line, kind: "reach", text: "reached", core: path.basename(rel).replace(/\.[^.]+$/, ""), label });
      }
    }
    if (!changedSet.has(rel)) continue;
    const before = fileAt(root, record.commit, rel);
    if (before == null) continue;
    const counts = matters(rel);
    const baseUnits = unitsOf(ts, before, rel).filter(counts);
    result.units += baseUnits.length;
    for (const unit of missingUnits(baseUnits, unitsOf(ts, now, rel).filter(counts))) result.failures.push({ file: rel, ...unit, label: unitLabel(unit) });
  }
  /* The exceptions: a move accepted only with a location that really holds the unit, a removal only with the reviewer's words. */
  const mine = exceptions.filter((one) => !one?.exploration || one.exploration === record.exploration);
  const used = new Set();
  for (const entry of mine) {
    /* A simple-mode record is read by `explorationMode`, not here. */
    if (entry && typeof entry === "object" && "mode" in entry && !("removed" in entry)) continue;
    if (entry && typeof entry === "object" && "removed" in entry) {
      const name = entryName(entry, entry.removed);
      if (!entry.file || !entry.kind || typeof entry.removed !== "string" || entry.removed === "") {
        result.refused.push(`a removal needs "file", "kind", "removed" and "said": ${JSON.stringify(entry)}`);
        continue;
      }
      if (typeof entry.said !== "string" || entry.said.trim() === "") {
        result.refused.push(`${name}: a removal carries no "said", so nothing shows the reviewer asked for it (record one with parity.mjs --remove <file:line> --said-file <a file holding their exact words>)`);
        continue;
      }
      const forged = recordProblem(entry);
      if (forged) {
        result.refused.push(`${name}: ${forged}`);
        continue;
      }
      const target = result.failures.find((one) => one.file === entry.file && one.kind === entry.kind && (one.label === entry.removed || one.text === entry.removed) && !used.has(one));
      if (!target) {
        result.unused.push(`${name}: removed on request, and no such loss now (safe to delete)`);
        continue;
      }
      used.add(target);
      result.excused.push({ ...target, said: entry.said });
      continue;
    }
    const name = entryName(entry, entry?.unit);
    if (!entry || typeof entry !== "object" || !entry.file || !entry.kind || !entry.unit) {
      result.refused.push(`an exception needs "file", "kind", "unit" and "movedTo": ${JSON.stringify(entry)}`);
      continue;
    }
    const target = result.failures.find((one) => one.file === entry.file && one.kind === entry.kind && (one.label === entry.unit || one.text === entry.unit) && !used.has(one));
    if (!entry.movedTo) {
      result.refused.push(`${name}: names no "movedTo" (<file>:<line>), so nothing shows where the logic went`);
      continue;
    }
    if (!target) {
      result.unused.push(`${name} -> ${entryText(entry.movedTo)}: no such loss now (safe to delete)`);
      continue;
    }
    const movedFile = String(entry.movedTo).trim().replace(/:\d+$/, "");
    if (!reachedNow.has(movedFile)) {
      result.refused.push(`${name}: ${entryText(movedFile)} is not reached from today's screen "${record.original}", so the logic there does not run on it`);
      continue;
    }
    const holds = locationHolds({ ts, root, unit: target, movedTo: entry.movedTo });
    if (!holds.ok) {
      result.refused.push(`${name}: ${holds.why}`);
      continue;
    }
    used.add(target);
    result.excused.push({ ...target, movedTo: entry.movedTo });
  }
  result.failures = result.failures.filter((one) => !used.has(one));
  return result;
}

/** The lines a report prints for one base, and its problem lines (for the preflight's list). */
export function parityLines(result) {
  const problems = [
    ...result.failures.map((one) => `${result.exploration}: ${one.file}${one.line ? `:${one.line}` : ""} lost ${one.kind} ${one.label}`),
    ...result.refused.map((line) => `${result.exploration}: exception refused, ${line}`),
  ];
  const summary =
    `parity of "${result.exploration}" against ${String(result.commit).slice(0, 12)}: ${result.checked} file(s) of today's screen, ${result.changed} changed, ` +
    `${result.units} unit(s) in the changed ones, ${result.failures.length} lost${result.excused.some((one) => one.movedTo) ? `, ${result.excused.filter((one) => one.movedTo).length} moved (exceptions)` : ""}${result.excused.some((one) => one.said) ? `, ${result.excused.filter((one) => one.said).length} removed on request` : ""}${result.refused.length > 0 ? `, ${result.refused.length} exception(s) refused` : ""}`;
  return { summary, problems, notes: result.unused.map((line) => `${result.exploration}: exception ${line}`) };
}

/** The entry an exception file needs for one loss, for the agent to fill `movedTo` and `why` in. */
export const exceptionTemplate = (failure, exploration) => ({ exploration, file: failure.file, kind: failure.kind, unit: failure.label, movedTo: "<file>:<line>", why: "" });

/**
 * THE BASES OF RETIRED EXPLORATIONS THAT CAN GO: a real-code exploration no longer declared keeps its base until its parity
 * passes, then the base is released. Returns `{ bases, released, kept, unchecked }`. Without TypeScript nothing can be checked,
 * so a retired base is released unchecked rather than kept forever.
 */
export function releaseRetired({ root, canvasDir, slug = "main", bases, ts = undefined }) {
  const out = { ...bases };
  const released = [];
  const kept = [];
  const retired = Object.entries(bases ?? {}).filter(([, record]) => record?.retired);
  if (retired.length === 0) return { bases: out, released, kept, unchecked: [] };
  const typescript = ts === undefined ? loadTypescript(root) : ts;
  if (!typescript) {
    for (const [id] of retired) delete out[id];
    return { bases: out, released, kept, unchecked: retired.map(([id]) => id) };
  }
  const { entries } = loadExceptions(canvasDir);
  for (const [id, record] of retired) {
    const result = parityOf({ ts: typescript, root, record, exceptions: entries });
    if (result.failures.length === 0 && result.refused.length === 0) {
      delete out[id];
      released.push(id);
    } else kept.push(id);
  }
  return { bases: out, released, kept, unchecked: [] };
}

/**
 * A REMOVAL THE REVIEWER ASKED FOR: one lost unit of one exploration's parity, named by its label, its text or `<file>:<line>`,
 * written to the exceptions file with the reviewer's exact words. `{ entry }` when written, `{ error }` otherwise: no words,
 * no such loss, or a name that matches more than one (then `file:line` tells them apart). Only the command calls this, and
 * only with words the reviewer said; the check accepts the entry for exactly that unit.
 */
export function recordRemoval({ ts, root, canvasDir, slug = "main", record, removed, said, at = new Date().toISOString() }) {
  if (typeof said !== "string" || said.trim() === "")
    return { error: "a removal needs the reviewer's exact words (--said-file <a file holding them>, or --said-from <the id of their comment>): a behavior taken out without the words that asked for it is a loss, not a decision" };
  const { entries, problems } = loadExceptions(canvasDir);
  if (problems.length > 0) return { error: problems[0] };
  const { failures } = parityOf({ ts, root, record, exceptions: entries });
  /* `<file>:<line>`, or `<file>:<line>#<n>` for the n-th loss starting on that line: a place, never the unit's code, so the
     command line carries no quotes, braces or `$` of the project's source. */
  const place = /^(.+):(\d+)(?:#(\d+))?$/.exec(String(removed ?? "").trim());
  let found = failures.filter((one) =>
    place ? one.file === place[1] && Number(place[2]) >= one.line && Number(place[2]) <= (one.end ?? one.line) : one.label === removed || one.text === removed,
  );
  if (place?.[3]) {
    const nth = failures.filter((one) => one.file === place[1] && one.line === Number(place[2]))[Number(place[3]) - 1];
    found = nth ? [nth] : [];
  }
  if (found.length === 0)
    return { error: `"${removed}" is no loss of "${record.exploration}" now; its losses: ${failures.map((one) => `${one.file}:${one.line} ${one.label}`).join("; ") || "none"}` };
  if (found.length > 1) {
    /* Losses that start on one line are told apart by their number on it. */
    const onLine = (one) => failures.filter((other) => other.file === one.file && other.line === one.line);
    return {
      error: `"${removed}" matches ${found.length} losses; name one: ${found.map((one) => `${one.file}:${one.line}${onLine(one).length > 1 ? `#${onLine(one).indexOf(one) + 1}` : ""} (${one.label})`).join(", ")}`,
    };
  }
  const [unit] = found;
  const entry = signRecord({ exploration: record.exploration, file: unit.file, kind: unit.kind, removed: unit.label, said, at });
  if (!entry) return { error: `this machine cannot keep the key the record is signed with (${secretFile()}), so nothing was written` };
  writeFileSync(path.join(canvasDir, "project", EXCEPTIONS_FILE), `${JSON.stringify([...entries, entry], null, 2)}\n`, "utf8");
  return { entry };
}

/**
 * SIMPLE MODE ON THE REVIEWER'S WORDS: an exploration over a screen that holds real logic, which the reviewer says needs no parity
 * check. `{ entry }` when written (signed, like a removal), `{ error }` without words.
 */
export function recordMode({ canvasDir, exploration, said, at = new Date().toISOString() }) {
  if (typeof said !== "string" || said.trim() === "")
    return { error: "simple mode over real code needs the reviewer's exact words (--said-file <a file holding them>, or --said-from <the id of their comment>)" };
  const { entries, problems } = loadExceptions(canvasDir);
  if (problems.length > 0) return { error: problems[0] };
  const entry = signRecord({ exploration, mode: "simple", said, at });
  if (!entry) return { error: `this machine cannot keep the key the record is signed with (${secretFile()}), so nothing was written` };
  mkdirSync(path.join(canvasDir, "project"), { recursive: true });
  writeFileSync(path.join(canvasDir, "project", EXCEPTIONS_FILE), `${JSON.stringify([...entries.filter((one) => !(one?.mode && one.exploration === exploration && !("removed" in one))), entry], null, 2)}\n`, "utf8");
  return { entry };
}

/* ------------------------------------------------------------------ the whole canvas, for the preflight and the round */

/** The manifest of one canvas's shots, or an empty one. */
export function readManifest(canvasDir, slug) {
  try {
    return JSON.parse(readFileSync(path.join(canvasDir, "shots", slug, "manifest.json"), "utf8"));
  } catch {
    return { shots: [] };
  }
}

/**
 * EVERYTHING REAL-CODE MODE SAYS ABOUT ONE CANVAS: `{ modes, lines, problems, notes }`. `modes` are the mode lines, one per
 * exploration; `problems` fail the preflight and the round (an option's own data calls, a lost unit, a refused exception);
 * `notes` do not. `decl` is the dumped declaration (`explorations` with `mode` and `original`, `screens` with `source`).
 */
export function realCodeReport({ root, canvasDir, slug, decl, ts = undefined }) {
  const out = { modes: [], lines: [], problems: [], notes: [] };
  const screens = decl.screens ?? [];
  const bases = readManifest(canvasDir, slug).bases ?? {};
  const toCheck = [];
  for (const exploration of decl.explorations ?? []) {
    const result = explorationMode({ root, exploration, screens, canvasDir });
    out.modes.push(modeLine(result));
    if (result.unread)
      out.problems.push(`options: ${exploration.id}: ${result.why}, so nothing can tell whether it is over real code: name today's screen and its files in \`source\`, or, when the reviewer says it is not, record their words: node design-canvas/parity.mjs --canvas ${commandArg(slug, "<slug>")} --exploration ${commandArg(exploration.id)} --mode simple --said-file <a file holding them>`);
    if (result.mode !== "real-code") continue;
    const original = screens.find((one) => one.id === exploration.original && one.view !== "exploration");
    const theirs = original ? originalFiles(root, original, optionEntries(exploration.id, screens)) : [];
    out.problems.push(...ownDataCalls({ root, explorationId: exploration.id, screens, originalFiles: theirs }).map((line) => `options: ${line}`));
    const record = bases[exploration.id];
    if (record?.commit) toCheck.push(record);
    else out.notes.push(`${exploration.id}: no base recorded yet, so parity has nothing to compare with; the first capture records the commit checked out then${headCommit(root) ? "" : " (this project is not a git repository, so it cannot)"}`);
  }
  /* A real-code exploration that left the declaration is still checked until a capture releases its base. */
  const declared = new Set((decl.explorations ?? []).map((one) => one.id));
  for (const [id, record] of Object.entries(bases)) if (!declared.has(id) && record?.mode === "real-code" && record.commit) toCheck.push({ ...record, exploration: id });
  if (toCheck.length === 0) return out;
  const typescript = ts === undefined ? loadTypescript(root) : ts;
  if (!typescript) {
    out.notes.push(NO_TYPESCRIPT);
    return out;
  }
  const { entries, problems } = loadExceptions(canvasDir);
  out.problems.push(...problems.map((line) => `parity: ${line}`));
  for (const record of toCheck) {
    const result = parityOf({ ts: typescript, root, record, exceptions: entries });
    const said = parityLines(result);
    out.lines.push(said.summary);
    out.problems.push(...said.problems.map((line) => `parity: ${line}`));
    out.notes.push(...said.notes);
    if (record.dirty?.length) out.notes.push(`${record.exploration}: ${record.dirty.length} file(s) had uncommitted changes when the base was recorded, and those lines are not part of it: ${record.dirty.slice(0, 4).join(", ")}`);
    if (result.failures.length > 0) {
      const template = result.failures.slice(0, 2).map((one) => JSON.stringify(exceptionTemplate(one, record.exploration)));
      out.notes.push(
        `${record.exploration}: put each lost unit back in its file. Only a unit that moved elsewhere gets an entry in design-canvas/project/${EXCEPTIONS_FILE}, naming where it is now, e.g. ${template.join(", ")}. ` +
          `A pull through the agent moves the base to the developers' newer commits by itself; for commits that arrived another way, move it by hand: node design-canvas/parity.mjs --canvas ${slug} --exploration ${commandArg(record.exploration, "<the exploration's id>")} --base <commit>`,
      );
    }
  }
  return out;
}

/* ------------------------------------------------------------------ the command */

const isMain = (() => {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (isMain) {
  const argv = process.argv.slice(2);
  const argOf = (name) => {
    const at = argv.indexOf(`--${name}`);
    return at === -1 ? undefined : argv[at + 1];
  };
  const ROOT = path.dirname(HERE);
  const slug = argOf("canvas") ?? "main";
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    console.error(`parity: refusing --canvas "${slug}": a canvas slug is lowercase letters, digits and dashes only`);
    process.exit(2);
  }
  const { screensFor } = await import("./dump-screens.mjs");
  let decl;
  try {
    decl = await screensFor(HERE, slug);
  } catch (error) {
    console.error(`parity: ${error.message}`);
    console.log("PARITY FAIL: the declaration could not be read");
    process.exit(2);
  }
  if (argOf("base")) {
    const id = argOf("exploration");
    const manifestFile = path.join(HERE, "shots", slug, "manifest.json");
    const manifest = readManifest(HERE, slug);
    const commit = resolveCommit(ROOT, argOf("base"));
    if (!id || !manifest.bases?.[id]) {
      console.error(`parity: --base needs --exploration <id> naming an exploration with a recorded base (${Object.keys(manifest.bases ?? {}).join(", ") || "none recorded"})`);
      process.exit(2);
    }
    if (!commit) {
      console.error(`parity: "${argOf("base")}" is no commit of this repository`);
      process.exit(2);
    }
    manifest.bases[id] = { ...manifest.bases[id], commit, files: filesAt(ROOT, manifest.bases[id], commit), movedAt: new Date().toISOString() };
    writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    console.log(`parity: the base of "${id}" is now ${commit.slice(0, 12)}`);
  }
  /* The reviewer's exact words, said in conversation and written to a file by the agent (`--said-file`, `-` for stdin), or the
     words of one of their canvas comments (`--said-from c12`), so free words never sit inside a shell command, where their
     quotes or `$(` would be run. `--said "<words>"` is still read, for older notes. */
  function saidWords() {
    let said = argOf("said");
    if (argOf("said-file") !== undefined) {
      try {
        said = readFileSync(argOf("said-file") === "-" ? 0 : argOf("said-file"), "utf8").trim();
      } catch (error) {
        console.error(`parity: --said-file ${argOf("said-file")} cannot be read (${error.code ?? error.message})`);
        process.exit(2);
      }
    }
    if (argOf("said-from") !== undefined) {
      const from = argOf("said-from");
      let comments = [];
      try {
        comments = JSON.parse(readFileSync(path.join(HERE, "comments", `${slug}.json`), "utf8")).comments ?? [];
      } catch {
        /* No review file: the comment is not found below. */
      }
      said = /^c\d+$/.test(String(from)) ? comments.find((one) => one.id === from)?.note : undefined;
      if (typeof said !== "string") {
        console.error(`parity: --said-from ${from} is no comment on canvas "${slug}"`);
        process.exit(2);
      }
    }
    return said;
  }
  if (argOf("mode") !== undefined) {
    const id = argOf("exploration");
    if (argOf("mode") !== "simple" || !id || !(decl.explorations ?? []).some((one) => one.id === id)) {
      console.error(`parity: --mode takes simple, with --exploration <id> naming an exploration of canvas "${slug}"`);
      process.exit(2);
    }
    const written = recordMode({ canvasDir: HERE, exploration: id, said: saidWords() });
    if (written.error) {
      console.error(`parity: ${written.error}`);
      process.exit(2);
    }
    console.log(`parity: exploration "${id}" is simple mode on the reviewer's words`);
  }
  if (argOf("remove") !== undefined) {
    const id = argOf("exploration");
    const record = readManifest(HERE, slug).bases?.[id];
    if (!id || !record?.commit) {
      console.error(`parity: --remove needs --exploration <id> naming an exploration with a recorded base`);
      process.exit(2);
    }
    const typescript = loadTypescript(ROOT);
    if (!typescript) {
      console.error(`parity: ${NO_TYPESCRIPT}`);
      process.exit(2);
    }
    const said = saidWords();
    const written = recordRemoval({ ts: typescript, root: ROOT, canvasDir: HERE, slug, record: { ...record, exploration: id }, removed: argOf("remove"), said });
    if (written.error) {
      console.error(`parity: ${written.error}`);
      process.exit(2);
    }
    console.log(`parity: "${written.entry.removed}" in ${written.entry.file} is recorded as removed on request, with the reviewer's words`);
  }
  const report = realCodeReport({ root: ROOT, canvasDir: HERE, slug, decl });
  /* Each line one line: text from the project's files (a unit's code, a path, an entry) can never start a line of its own, such as
     a verdict. */
  const say = (text) => console.log(oneLine(text));
  for (const line of report.modes) say(`mode: ${line}`);
  for (const line of report.lines) say(line);
  for (const line of report.problems) say(`  - ${line}`);
  if (report.notes.length > 0) {
    console.log("\nnotes:");
    for (const line of report.notes) say(`  - ${line}`);
  }
  console.log(`\n${report.problems.length === 0 ? "PARITY PASS" : `PARITY FAIL (${report.problems.length})`}`);
  process.exit(report.problems.length === 0 ? 0 : 1);
}
