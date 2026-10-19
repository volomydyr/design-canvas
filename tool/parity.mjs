#!/usr/bin/env node
/**
 * design-canvas — REAL-CODE MODE: an exploration over a screen that already works must not lose what it does.
 *
 *   node design-canvas/parity.mjs --canvas <slug>                                   check every real-code exploration
 *   node design-canvas/parity.mjs --canvas <slug> --exploration <id> --base <commit>   move one exploration's base
 *   node design-canvas/parity.mjs --canvas <slug> --exploration <id> --remove <unit or file:line> --said "<the reviewer's exact words>"
 *                                                                                    record a removal the reviewer asked for
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
 *                  markup, a prop bound to an expression, a handler, a form field's name, a door (where a link or a
 *                  navigation goes, a dialog or form that is rendered), a translation key and its default copy. Units are
 *                  compared as a multiset, so dropping one of two identical gated controls is still a loss, except keys and
 *                  copy, which only have to be present. A file that held logic and is no longer reached is a loss too.
 *   5. EXCEPTIONS  `design-canvas/project/parity-exceptions.json`: `[{ "file", "kind", "unit", "movedTo": "<file>:<line>",
 *                  "why" }]`. Only an entry whose `movedTo` really holds the unit's logic is accepted; one without a location,
 *                  or with one that does not hold it, is refused and fails the check.
 *                  A behavior removed on purpose is a removal entry, `{ "file", "kind", "removed", "said" }`, written only by
 *                  `--remove ... --said "<the reviewer's exact words>"`; it excuses exactly that unit, and one with no words is
 *                  refused. An agent never writes one on its own.
 *
 * The preflight and the round run this by themselves for every real-code exploration, and a failure fails the round. The
 * last line of the command is the verdict: `PARITY PASS` or `PARITY FAIL (<count>)`. Exit codes: 0 pass, 1 problems, 2 the
 * check could not start.
 *
 * DELETE WITH: the design-canvas/ folder.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { filesReachedFrom, IMPORT_RE, resolveSpecifier } from "./closure.mjs";
import { surfaceKind } from "./components.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const MODES = ["real-code", "simple"];
export const EXCEPTIONS_FILE = "parity-exceptions.json";

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
  { kind: "server", raw: true, re: /^\s*(["']use server["'])/gm },
  { kind: "server", raw: true, re: /\bexport\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|loader|action|getServerSideProps)\b/g },
  { kind: "server", raw: true, re: /\bexport\s+const\s+(GET|POST|PUT|PATCH|DELETE|loader|action)\s*=/g },
  { kind: "store", raw: false, re: /(?<![\w$.])(createStore|configureStore|createSlice|defineStore|useSelector|useDispatch|useAtom|useAtomValue|useSetAtom|useRecoilState|useRecoilValue)\s*[<(]/g },
  { kind: "store", raw: false, re: /(?<![\w$.])(use[A-Z][\w$]*(?:Store|Selector|Dispatch))\s*[<(]/g },
  {
    kind: "permission",
    raw: false,
    re: /(?<![\w$.])(can|cannot|hasPermissions?|hasRoles?|hasAccess|isAllowed|isAuthorized|checkPermissions?|authorize|getServerSession|use(?:[A-Z][\w$]*)?(?:Permissions?|Ability|Authorization|Roles?|Session|Auth))\s*\(/g,
  },
  { kind: "permission", raw: false, re: /\.((?:role|roles|permissions)\s*(?:===|!==|==|!=|\.includes\s*\())/g },
  { kind: "permission", raw: false, re: /\.(isAdmin|isOwner|isSuperuser)\b/g },
];

/** Every real-logic call in one file's text: `{ file, line, kind, raw, what }`, `what` being the call as written. */
export function logicIn(text, file) {
  const src = blankComments(text);
  const found = [];
  for (const rule of LOGIC_RULES)
    for (const match of src.matchAll(rule.re)) {
      /* `function useX(` defines a hook rather than calls one. */
      const defines = /function\s*\*?\s*$/.test(src.slice(Math.max(0, match.index - 16), match.index));
      found.push({ file, line: lineOf(src, match.index), kind: rule.kind, raw: rule.raw, what: match[1].replace(/\s+/g, " ").trim(), ...(defines ? { defines: true } : {}) });
    }
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
export function originalFiles(root, original, avoid = []) {
  const skip = new Set(avoid.map((rel) => path.join(root, rel)));
  const seen = new Set();
  const queue = (original?.source ?? []).map((rel) => path.join(root, rel)).filter((at) => existsSync(at) && !skip.has(at));
  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    if (!/\.(tsx?|jsx?|mjs)$/.test(file)) continue;
    const text = readSafe(file);
    if (text == null) continue;
    for (const match of text.matchAll(IMPORT_RE)) {
      const next = resolveSpecifier(match[1] ?? match[2], file, root);
      if (next && !seen.has(next) && !skip.has(next)) queue.push(next);
    }
  }
  return [...seen].map((at) => path.relative(root, at)).filter(isCodeFile).sort();
}

/** The entry files of an exploration's options. */
const optionEntries = (explorationId, screens) => optionScreens(explorationId, screens).flatMap((one) => one.source ?? []);

/**
 * THE MODE OF ONE EXPLORATION: `{ id, mode, forced, original, reasons, why }`. `exploration` is the dumped one (with `mode`
 * and `original`), `screens` every dumped screen of the canvas. The `mode` field wins; otherwise the original's files decide.
 */
export function explorationMode({ root, exploration, screens }) {
  const id = exploration.id;
  const originalId = exploration.original ?? null;
  const original = (screens ?? []).find((one) => one.id === originalId && one.view !== "exploration") ?? (screens ?? []).find((one) => one.id === originalId);
  if (MODES.includes(exploration.mode)) return { id, mode: exploration.mode, forced: true, original: originalId, reasons: [], why: `set in its declaration (mode: "${exploration.mode}")` };
  if (!original) return { id, mode: "simple", forced: false, original: originalId, reasons: [], why: originalId ? `its original "${originalId}" is no screen on this canvas` : "it names no original screen" };
  if (!(original.source ?? []).length) return { id, mode: "simple", forced: false, original: originalId, reasons: [], why: `today's screen "${originalId}" lists no \`source\` files to read` };
  /* The screen's own files first: they are what the line names. */
  const own = (original.source ?? []).filter(isCodeFile);
  const reasons = logicInFiles(root, [...own, ...originalFiles(root, original, optionEntries(id, screens)).filter((rel) => !own.includes(rel))]);
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
    why: `the files of today's screen "${originalId}" hold real logic (${shown.map((one) => `${one.what} at ${one.file}:${one.line}`).join("; ")}${reasons.length > shown.length ? `, ${reasons.length} in all` : ""})`,
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
    for (const rel of screenFiles(root, option)) {
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
  return { exploration: explorationId, mode, original, entries: [...(entries ?? [])], commit, recordedAt: at, files: reached.filter((rel) => tracked.has(rel)), ...(dirty.length > 0 ? { dirty } : {}) };
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
export async function followRemote({ root, canvasDir, before }) {
  const head = headCommit(root);
  if (!before || !head || head === before) return [];
  const onRemote = new Set(revs(root, ["--remotes", "--not", before]));
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
        lines.push(`design-canvas: the pull changed files of exploration "${one.id}" on ${slug}, and its base did not move because a capture of ${slug} is running (pid ${lockHolder(lock) ?? "unknown"}): node design-canvas/parity.mjs --canvas ${slug} --exploration ${one.id} --base ${tip.slice(0, 12)}`);
      continue;
    }
    try {
      const fresh = readManifest(canvasDir, slug);
      for (const one of moves) {
        if (!fresh.bases?.[one.id]) continue;
        const files = (one.record.files ?? []).filter((rel) => revs(root, [head, "--not", before, "--", rel]).some((sha) => broughtSet.has(sha)));
        fresh.bases[one.id] = { ...fresh.bases[one.id], commit: tip, movedAt: new Date().toISOString() };
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

/** TypeScript, from the project first and from this file second. Null when neither has it. */
export function loadTypescript(root) {
  for (const from of [root, HERE]) {
    try {
      return createRequire(path.join(from, "package.json"))("typescript");
    } catch {
      /* Not installed along this path. */
    }
  }
  return null;
}

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

/**
 * THE UNITS OF ONE FILE: `{ kind, text, line, end, core }`. `text` is the unit as compared and printed; `core` is the part an
 * exception's location has to hold (the condition of a gated element, a handler's expression, a key).
 */
export function unitsOf(ts, source, file) {
  const kindOf = /\.(tsx|jsx)$/.test(file) ? ts.ScriptKind.TSX : /\.(js|mjs)$/.test(file) ? ts.ScriptKind.JSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kindOf);
  const units = [];
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
  /** The node's code with markup and translation calls cut out (each is its own unit). */
  const codeOf = (node) => {
    const start = node.getStart(sf);
    let text = sf.text.slice(start, node.getEnd());
    const cuts = [];
    const visit = (n) => {
      if (isJsx(n)) return cuts.push([n.getStart(sf) - start, n.getEnd() - start, JSX_MARK]);
      if (isI18nCall(n)) return cuts.push([n.getStart(sf) - start, n.getEnd() - start, T_MARK]);
      ts.forEachChild(n, visit);
    };
    if (isJsx(node)) return JSX_MARK;
    if (isI18nCall(node)) return T_MARK;
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
    units.push({ kind, text, line: lineAt(node.getStart(sf)), end: lineAt(node.getEnd()), core });
  };
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
    if (ts.isImportDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) return;

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
      if (opensName(tag)) add("opens", node, `<${tag}>`, tag);
      for (const attr of node.attributes.properties) {
        if (ts.isJsxSpreadAttribute(attr)) {
          add("prop", attr, `{ ... ${norm(codeOf(attr.expression))} }`, norm(codeOf(attr.expression)));
          continue;
        }
        const name = attr.name.getText(sf);
        const init = attr.initializer;
        if (!init) continue;
        if (ts.isStringLiteral(init)) {
          if (name === "name") add("field", attr, `name = ${literalOf(init)}`, literalOf(init));
          else if (DOOR_PROPS.has(name)) add("door", attr, literalOf(init));
          continue;
        }
        if (!ts.isJsxExpression(init) || !init.expression) continue;
        const expr = init.expression;
        const value = norm(codeOf(expr));
        if (/^on[A-Z]/.test(name) || name === "action" || name === "formAction") add(contains(expr, isNavCall) ? "door" : "handler", attr, value);
        else if (DOOR_PROPS.has(name)) add("door", attr, value);
        else if (name === "name") add("field", attr, `name = { ${value} }`, value);
        else if (STYLE_PROPS.has(name) || I18N_TAGS.test(tag)) continue;
        else if (ts.isStringLiteral(expr) || ts.isNumericLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr) || expr.kind === ts.SyntaxKind.TrueKeyword || expr.kind === ts.SyntaxKind.FalseKeyword) continue;
        else if (value !== JSX_MARK && value !== T_MARK) add("prop", attr, `${name} = { ${value} }`, value);
      }
    }
    /* A gate outside the markup's braces: `return canEdit ? <X /> : null`, `const extra = open && <Y />`. */
    if (
      (ts.isConditionalExpression(node) || (ts.isBinaryExpression(node) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind))) &&
      contains(node, isJsx) &&
      !((up) => up && (ts.isJsxExpression(up) || ts.isConditionalExpression(up) || ts.isBinaryExpression(up)))(outsideParens(node))
    )
      units.push({ kind: "condition", text: `${norm(codeOf(node))}`, line: lineAt(node.getStart(sf)), end: lineAt(node.getEnd()), core: conditionOf(node), shows: outerTags(node) });
    if (ts.isJsxExpression(node) && node.expression && node.parent && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
      const expr = node.expression;
      if (!isI18nCall(expr)) {
        const text = norm(codeOf(expr));
        const gated = contains(expr, isJsx) || ts.isConditionalExpression(expr) || (ts.isBinaryExpression(expr) && /&&|\|\||\?\?/.test(expr.operatorToken.getText(sf)));
        if (gated) {
          const tags = outerTags(expr);
          units.push({ kind: "condition", text: `{ ${text} }`, line: lineAt(node.getStart(sf)), end: lineAt(node.getEnd()), core: conditionOf(expr), shows: tags });
        } else if (text !== T_MARK) add("shows", node, `{ ${text} }`, text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return units;
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
  /* What sits inside a lost handler or gated block is the same loss said twice: the outer unit names it. Of several equal
     units, the ones inside a lost block are the ones counted as lost, so they are the ones it names. */
  const OUTER = ["handler", "condition", "door"];
  const outer = missing.filter((one) => OUTER.includes(one.kind));
  const inside = (one) => outer.some((o) => o !== one && o.line <= one.line && o.end >= one.end);
  const chosen = [];
  for (const unit of missing) {
    if (PRESENCE_ONLY.has(unit.kind) || OUTER.includes(unit.kind) || chosen.some((one) => unitKey(one) === unitKey(unit))) continue;
    const lostHere = missing.filter((one) => unitKey(one) === unitKey(unit)).length;
    const candidates = before.filter((one) => unitKey(one) === unitKey(unit));
    chosen.push(...[...candidates.filter(inside), ...candidates.filter((one) => !inside(one))].slice(0, lostHere));
  }
  /* A lost gated block names everything in it but its keys and copy; a lost handler names the statements in it. */
  const coveredBy = (one) => outer.some((o) => o !== one && o.line <= one.line && o.end >= one.end && (o.kind === "condition" || ["logic", "door"].includes(one.kind)));
  return [...missing.filter((one) => PRESENCE_ONLY.has(one.kind) || OUTER.includes(one.kind)), ...chosen]
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
  if (unit.kind === "reach") return lines.slice(line - 1, last).join("\n").includes(String(unit.core)) ? { ok: true } : { ok: false, why: `${rel}:${line} neither imports nor renders ${unit.core}` };
  const same = (one) => (unit.kind === "logic" ? one.text === unit.text : one.core === unit.core && (one.kind === unit.kind || unit.kind === "condition" || one.kind === "condition"));
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
  for (const rel of files) {
    const now = readSafe(path.join(root, rel));
    if (now == null) {
      result.failures.push({ file: rel, line: 0, kind: "file", text: "deleted", label: "the file is gone" });
      continue;
    }
    if (!reachedNow.has(rel)) {
      const before = changedSet.has(rel) ? fileAt(root, record.commit, rel) : now;
      const logic = before == null ? [] : logicIn(before, rel);
      if (logic.length > 0) {
        const label = `no longer reached from today's screen "${record.original}", and it holds ${logic.slice(0, 2).map((one) => one.what).join(", ")}`;
        result.failures.push({ file: rel, line: logic[0].line, end: logic[0].line, kind: "reach", text: "reached", core: path.basename(rel).replace(/\.[^.]+$/, ""), label });
      }
    }
    if (!changedSet.has(rel)) continue;
    const before = fileAt(root, record.commit, rel);
    if (before == null) continue;
    const baseUnits = unitsOf(ts, before, rel);
    result.units += baseUnits.length;
    for (const unit of missingUnits(baseUnits, unitsOf(ts, now, rel))) result.failures.push({ file: rel, ...unit, label: unitLabel(unit) });
  }
  /* The exceptions: a move accepted only with a location that really holds the unit, a removal only with the reviewer's words. */
  const mine = exceptions.filter((one) => !one?.exploration || one.exploration === record.exploration);
  const used = new Set();
  for (const entry of mine) {
    if (entry && typeof entry === "object" && "removed" in entry) {
      const name = `${entry.file ?? "?"} ${entry.kind ?? "?"} ${entry.removed ?? "?"}`;
      if (!entry.file || !entry.kind || typeof entry.removed !== "string" || entry.removed === "") {
        result.refused.push(`a removal needs "file", "kind", "removed" and "said": ${JSON.stringify(entry)}`);
        continue;
      }
      if (typeof entry.said !== "string" || entry.said.trim() === "") {
        result.refused.push(`${name}: a removal carries no "said", so nothing shows the reviewer asked for it (record one with parity.mjs --remove ... --said "<the reviewer's exact words>")`);
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
    const name = `${entry?.file ?? "?"} ${entry?.kind ?? "?"} ${entry?.unit ?? "?"}`;
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
      result.unused.push(`${name} -> ${entry.movedTo}: no such loss now (safe to delete)`);
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
 * passes, then the base is released. Returns `{ bases, released, kept }`; a base whose check cannot run (no TypeScript) stays.
 */
export function releaseRetired({ root, canvasDir, bases, ts = undefined }) {
  const out = { ...bases };
  const released = [];
  const kept = [];
  const retired = Object.entries(bases ?? {}).filter(([, record]) => record?.retired);
  if (retired.length === 0) return { bases: out, released, kept };
  const typescript = ts === undefined ? loadTypescript(root) : ts;
  if (!typescript) return { bases: out, released, kept: retired.map(([id]) => id) };
  const { entries } = loadExceptions(canvasDir);
  for (const [id, record] of retired) {
    const result = parityOf({ ts: typescript, root, record, exceptions: entries });
    if (result.failures.length === 0 && result.refused.length === 0) {
      delete out[id];
      released.push(id);
    } else kept.push(id);
  }
  return { bases: out, released, kept };
}

/**
 * A REMOVAL THE REVIEWER ASKED FOR: one lost unit of one exploration's parity, named by its label, its text or `<file>:<line>`,
 * written to the exceptions file with the reviewer's exact words. `{ entry }` when written, `{ error }` otherwise: no words,
 * no such loss, or a name that matches more than one (then `file:line` tells them apart). Only the command calls this, and
 * only with words the reviewer said; the check accepts the entry for exactly that unit.
 */
export function recordRemoval({ ts, root, canvasDir, record, removed, said, at = new Date().toISOString() }) {
  if (typeof said !== "string" || said.trim() === "")
    return { error: 'a removal needs --said "<the reviewer\'s exact words>": a behavior taken out without the words that asked for it is a loss, not a decision' };
  const { entries, problems } = loadExceptions(canvasDir);
  if (problems.length > 0) return { error: problems[0] };
  const { failures } = parityOf({ ts, root, record, exceptions: entries });
  const place = /^(.+):(\d+)$/.exec(String(removed ?? "").trim());
  const found = failures.filter((one) =>
    place ? one.file === place[1] && Number(place[2]) >= one.line && Number(place[2]) <= (one.end ?? one.line) : one.label === removed || one.text === removed,
  );
  if (found.length === 0)
    return { error: `"${removed}" is no loss of "${record.exploration}" now; its losses: ${failures.map((one) => `${one.file}:${one.line} ${one.label}`).join("; ") || "none"}` };
  if (found.length > 1) return { error: `"${removed}" matches ${found.length} losses; name one as <file>:<line>: ${found.map((one) => `${one.file}:${one.line}`).join(", ")}` };
  const [unit] = found;
  const entry = { exploration: record.exploration, file: unit.file, kind: unit.kind, removed: unit.label, said, at };
  writeFileSync(path.join(canvasDir, "project", EXCEPTIONS_FILE), `${JSON.stringify([...entries, entry], null, 2)}\n`, "utf8");
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
    const result = explorationMode({ root, exploration, screens });
    out.modes.push(modeLine(result));
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
    out.problems.push("parity: the typescript package is not installed in this project, and the parity check reads code with it (install it as a dev dependency)");
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
          `A pull through the agent moves the base to the developers' newer commits by itself; for commits that arrived another way, move it by hand: node design-canvas/parity.mjs --canvas ${slug} --exploration ${record.exploration} --base <commit>`,
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
    manifest.bases[id] = { ...manifest.bases[id], commit, movedAt: new Date().toISOString() };
    writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    console.log(`parity: the base of "${id}" is now ${commit.slice(0, 12)}`);
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
      console.error("parity: the typescript package is not installed in this project, and the parity check reads code with it");
      process.exit(2);
    }
    const written = recordRemoval({ ts: typescript, root: ROOT, canvasDir: HERE, record: { ...record, exploration: id }, removed: argOf("remove"), said: argOf("said") });
    if (written.error) {
      console.error(`parity: ${written.error}`);
      process.exit(2);
    }
    console.log(`parity: "${written.entry.removed}" in ${written.entry.file} is recorded as removed on request, with the reviewer's words`);
  }
  const report = realCodeReport({ root: ROOT, canvasDir: HERE, slug, decl });
  for (const line of report.modes) console.log(`mode: ${line}`);
  for (const line of report.lines) console.log(line);
  for (const line of report.problems) console.log(`  - ${line}`);
  if (report.notes.length > 0) {
    console.log("\nnotes:");
    for (const line of report.notes) console.log(`  - ${line}`);
  }
  console.log(`\n${report.problems.length === 0 ? "PARITY PASS" : `PARITY FAIL (${report.problems.length})`}`);
  process.exit(report.problems.length === 0 ? 0 : 1);
}
