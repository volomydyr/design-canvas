#!/usr/bin/env node
/**
 * design-canvas — THE CANVAS'S CLAUDE CODE HOOKS, one file for both events it is wired to.
 *
 * Installed at `<project>/design-canvas/hook.mjs`; the project root is the folder above this file's own folder. Claude Code runs
 * it with the event on stdin as JSON, and it does one of three things:
 *
 *   PreToolUse, Bash                    THE REMINDERS. When the command runs a canvas command (capture, capture-run, round,
 *                                       check-canvas, or a hand-written PATCH of the comments route), it prints
 *                                       {"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"..."}} with the
 *                                       rules for that command (`reminders.mjs`), and one more line when the end of the session's
 *                                       transcript shows no load of the skill. It never denies, asks or changes the command.
 *                                       THE OVERLAY (`overlay.mjs`), when the command runs git: files that gained local lines are
 *                                       registered with the filter before git reads them. Where the project's git hooks live in its
 *                                       own folder, a push that carries canvas code is denied here, with one line per file.
 *                                       THE PARITY RECORDS EARLY WARNING: a command that writes the parity exceptions file, or
 *                                       writes mode: "simple" into the declaration, is denied with one line (`parityGuard`); the
 *                                       control is the check in parity.mjs. These are the only denies this hook prints for Bash.
 *   PostToolUse, Bash                   THE OVERLAY, after a git command: local lines that no longer fit the updated files, and the
 *                                       hand-off list taken out of the code at a push, as context for the agent to act on and show.
 *                                       THE PARITY BASES, after any git command, and before a canvas command that runs the parity
 *                                       check: an exploration's base moves to the developers' newest commit when commits fetched
 *                                       from a remote changed its files since the base, however they arrived (a pull through the
 *                                       agent, a terminal or an editor, a merge finished with git commit, a reset). One line each.
 *   PostToolUse, Write, Edit, MultiEdit THE OVERLAY: the edited file is registered and re-staged when only its local lines changed,
 *                                       so git does not call it modified and a pull from a terminal right after it goes through.
 *   PreToolUse, Write, Edit, MultiEdit  THE PARITY RECORDS EARLY WARNING, always: an edit that adds a removal or simple-mode
 *                                       entry not recorded by parity.mjs, or a mode: "simple" line to the declaration, is denied
 *                                       with one line. The control is the check in parity.mjs, which refuses such an entry.
 *                                       THE REUSE CHECKS (`checks.mjs`). A refused edit prints
 *                                       {"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny",...}}
 *                                       and the agent reads the reason and edits again; an allowed one prints nothing.
 *   Stop                                THE RECAPTURE. Runs `recapture.mjs --hook`: when the turn changed what the pictures are
 *                                       made of, the canvases open now recapture in the background, and one line
 *                                       ({"systemMessage": ...}) says how many frames on other canvases are out of date.
 *
 * The reuse checks and the recapture change what happens to an agent's work, so they run only when THIS machine's answer for the
 * project is yes (`checks-answer.mjs`, recorded by `install-canvas.mjs --checks yes|no`); the reminders judge nothing and always
 * run. A changed answer applies to the next event. The checks also say nothing until `design-canvas/settings.json` names a design
 * to build from (`buildFrom`).
 *
 * IT FAILS OPEN, ALWAYS. Anything that goes wrong (garbage on stdin, a typo in settings.json, a registry that cannot be built, git
 * missing, a file of the canvas that is missing or broken) ends in exit 0 with nothing on stdout. Exit code 2 is never used: in a
 * PreToolUse hook it BLOCKS the action, so a broken check would stop all work in the project. That is why only `node:` modules are
 * imported at the top: a static import of a canvas file that is missing would fail before any handler exists. Everything else is
 * loaded with `await import(...)` inside the `try`.
 *
 * THE CHECKS' LOG. Every refusal and every reason an agent gives is appended to `design-canvas/rounds/checks-log.jsonl`, one JSON
 * line each: { at, tool, file, check, outcome, name, reason, mode }. `CANVAS_CHECKS_MODE=log` logs without ever denying (replays and
 * shadow runs). When the settings are invalid, a `buildFrom` slug is not a canvas, or the registry cannot be built, the edit is still
 * allowed and one line { at, tool, file, check: "settings" | "registry", outcome: "error", reason } goes in the log, at most one per
 * minute, so a typo does not turn the checks off without anyone knowing.
 *
 * DELETE WITH: the design-canvas/ folder.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CANVAS_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(CANVAS_DIR);
const LOG_FILE = path.join(CANVAS_DIR, "rounds", "checks-log.jsonl");

/** The last `bytes` of a file as text, or null when it cannot be read. Only the end is read, however long the file is. */
function tailOf(file, bytes) {
  try {
    const size = statSync(file).size;
    const length = Math.min(size, bytes);
    const buffer = Buffer.alloc(length);
    const fd = openSync(file, "r");
    try {
      readSync(fd, buffer, 0, length, size - length);
    } finally {
      closeSync(fd);
    }
    return buffer.toString("utf8");
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ the reminders */

/**
 * Does the end of the transcript show the skill being loaded? Only the last megabyte is read, so a long session costs the same as
 * a short one: a load further back than that is likely out of the agent's context anyway, and gets the reminder. No transcript
 * says nothing about the skill rather than guess.
 */
const TRANSCRIPT_TAIL = 1024 * 1024;
function transcriptShowsSkill(file, skillLoadedIn) {
  if (typeof file !== "string" || file === "") return true;
  const tail = tailOf(file, TRANSCRIPT_TAIL);
  return tail === null ? true : skillLoadedIn(tail);
}

async function remind(input) {
  try {
    const { beforeAction, canvasCommandsIn, skillLoadedIn } = await import("./reminders.mjs");
    const command = input.tool_input?.command;
    if (typeof command !== "string" || canvasCommandsIn(command).length === 0) return null;
    return beforeAction(input, { skillLoaded: transcriptShowsSkill(input.transcript_path, skillLoadedIn) }) || null;
  } catch {
    /* A missing or broken reminders file never stops the overlay's push check below. */
    return null;
  }
}

/* ------------------------------------------------------------------ the overlay */

/** The overlay's answer for a git command, `{ context, deny }`. Its failures say nothing, like every branch here. */
async function overlay(input) {
  try {
    const { agentHook } = await import("./overlay.mjs");
    process.chdir(ROOT);
    return agentHook(input);
  } catch {
    return {};
  }
}

/* ------------------------------------------------------------------ the parity bases */

const gitLines = (args) => {
  const run = spawnSync("git", ["-C", ROOT, ...args], { encoding: "utf8", maxBuffer: 1 << 28 });
  return run.status === 0 ? run.stdout.split("\n").filter(Boolean) : null;
};
const revs = (args) => gitLines(["rev-list", ...args]) ?? [];

/**
 * The values a fetch, a pull or a clone wrote into the remote-tracking refs' logs: what the remote had when this clone last asked it.
 * A push writes there too, and is left out, so the designer's own pushed commits are not taken for the developers'. Null when the refs
 * keep no log (then every remote-tracking commit counts).
 */
function fetchedTips() {
  const tips = new Set();
  let logged = false;
  for (const ref of gitLines(["for-each-ref", "--format=%(refname)", "refs/remotes"]) ?? []) {
    for (const line of gitLines(["log", "-g", "--format=%H%x09%gs", ref, "--"]) ?? []) {
      logged = true;
      const [sha, subject = ""] = line.split("\t");
      if (/^(?:fetch|pull|clone)\b/.test(subject)) tips.add(sha);
    }
  }
  return logged ? [...tips] : null;
}

/**
 * THE BASES FOLLOW THE DEVELOPERS, however their commits arrived. For each exploration's base: the commits checked out now that the
 * base does not have and that a fetch brought (this clone's own commits, pushed or not, are not among them until the developers build
 * on them). When any
 * of them changed the files the base lists, the base moves to the newest of them, so parity compares the option with the developers'
 * version of those files and never asks for what they removed. Manifests are written under each canvas's capture lock; a canvas whose
 * capture is running gets the command to move it by hand. Returns one line per base.
 */
async function followBases() {
  const { filesAt, headCommit, readManifest } = await import("./parity.mjs");
  const head = headCommit(ROOT);
  if (!head) return [];
  let slugs = [];
  try {
    slugs = readdirSync(path.join(CANVAS_DIR, "shots"), { withFileTypes: true }).filter((one) => one.isDirectory() && !one.name.startsWith("_")).map((one) => one.name);
  } catch {
    return [];
  }
  const fetched = fetchedTips();
  const theirsSince = new Map();
  const theirs = (base) => {
    if (!theirsSince.has(base)) theirsSince.set(base, new Set(fetched === null ? revs(["--remotes", "--not", base]) : fetched.length > 0 ? revs([...fetched, "--not", base]) : []));
    return theirsSince.get(base);
  };
  const lines = [];
  const { lockHolder, takeLock } = await import("./recapture.mjs");
  for (const slug of slugs) {
    const manifest = readManifest(CANVAS_DIR, slug);
    const moves = [];
    for (const [id, record] of Object.entries(manifest.bases ?? {})) {
      const files = record?.files ?? [];
      if (typeof record?.commit !== "string" || files.length === 0 || record.commit === head) continue;
      const brought = theirs(record.commit);
      if (brought.size === 0) continue;
      const changed = files.filter((rel) => revs([head, "--not", record.commit, "--", rel]).some((sha) => brought.has(sha)));
      if (changed.length === 0) continue;
      const tip = revs(["--topo-order", head, "--not", record.commit]).find((sha) => brought.has(sha));
      if (tip) moves.push({ id, tip, changed });
    }
    if (moves.length === 0) continue;
    const lock = path.join(CANVAS_DIR, "rounds", slug, "capture.lock");
    if (!takeLock(lock)) {
      for (const one of moves)
        lines.push(
          `design-canvas: the developers' commits changed files of exploration ${shown(one.id)} on ${named(slug)}, and its base did not move because a capture of ${named(slug)} is running (pid ${Number(lockHolder(lock)) || "unknown"}): ` +
            (PLAIN.test(slug) && PLAIN.test(one.id) ? `node design-canvas/parity.mjs --canvas ${slug} --exploration ${one.id} --base ${one.tip.slice(0, 12)}` : `move it with parity.mjs --base ${one.tip.slice(0, 12)} once the capture ends`),
        );
      continue;
    }
    try {
      const fresh = readManifest(CANVAS_DIR, slug);
      for (const one of moves) {
        const record = fresh.bases?.[one.id];
        if (!record) continue;
        fresh.bases[one.id] = { ...record, commit: one.tip, files: filesAt(ROOT, record, one.tip), movedAt: new Date().toISOString() };
        lines.push(`design-canvas: the base of exploration ${shown(one.id)} on ${named(slug)} moved to ${one.tip.slice(0, 12)}, the pulled commit, because it changed ${one.changed.slice(0, 2).map(named).join(", ")}${one.changed.length > 2 ? ` and ${one.changed.length - 2} more` : ""}`);
      }
      writeFileSync(path.join(CANVAS_DIR, "shots", slug, "manifest.json"), `${JSON.stringify(fresh, null, 2)}\n`, "utf8");
    } finally {
      rmSync(lock, { force: true });
    }
  }
  return lines;
}

/* Only a plain name (letters, digits, dash, underscore) is ever put into a command line the hook prints. Any other name from a
   manifest or a path is shown as quoted data. */
const PLAIN = /^[A-Za-z0-9_-]+$/;
const shown = (text) => JSON.stringify(String(text).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ").slice(0, 200));
const named = (text) => (/^[\w./@[\]-]+$/.test(String(text)) ? String(text) : shown(text));

/* A canvas command that runs the parity check: the bases are brought up to date before it. */
const RUNS_PARITY = /design-canvas\/(?:parity|round|preflight|capture|capture-run|check-canvas)\.mjs\b/;

/** Does this command line run git? Asked of the overlay's parser, which reads the subcommand; a plain word match when it is missing. */
async function runsGit(command) {
  try {
    const { gitCommands } = await import("./overlay.mjs");
    return gitCommands(command).length > 0;
  } catch {
    return /\bgit\b/.test(command);
  }
}

/** The bases' lines for this Bash event, or null. Like every branch here, a failure says nothing. */
async function basesFor(input, event) {
  try {
    const command = String(input.tool_input?.command ?? "");
    const due = event === "PostToolUse" ? await runsGit(command) : RUNS_PARITY.test(command);
    if (!due) return null;
    const lines = await followBases();
    return lines.length > 0 ? lines.join("\n") : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ the parity records guard */

const EXCEPTIONS = "design-canvas/project/parity-exceptions.json";
const MODE_REFUSED =
  'design-canvas: refused, mode: "simple" turns the parity check off for an exploration, and it needs the reviewer\'s words: record them with node design-canvas/parity.mjs --canvas <slug> --exploration <id> --mode simple --said-file <a file holding them>';
const WRITTEN_BY_TOOL =
  "design-canvas: refused, removal and simple-mode entries in design-canvas/project/parity-exceptions.json are written only by node design-canvas/parity.mjs (--remove <file:line> or --mode simple, with --said-file or --said-from), which records the reviewer's words";

/** The tool's records an exceptions file's text holds, or null when the text is not a list. */
function recordsIn(text, isToolRecord) {
  try {
    const list = JSON.parse(text);
    return Array.isArray(list) ? list.filter(isToolRecord) : null;
  } catch {
    return null;
  }
}

/** The file after a Write, Edit or MultiEdit, or null when it cannot be told. */
function afterEdit(tool, params, before) {
  const apply = (text, edit) => {
    if (typeof edit?.old_string !== "string" || typeof edit?.new_string !== "string") return null;
    if (edit.old_string === "") return text === "" ? edit.new_string : null;
    if (!text.includes(edit.old_string)) return null;
    return edit.replace_all ? text.split(edit.old_string).join(edit.new_string) : text.replace(edit.old_string, () => edit.new_string);
  };
  if (tool === "Write") return typeof params.content === "string" ? params.content : null;
  if (tool === "Edit") return apply(before, params);
  if (!Array.isArray(params.edits)) return null;
  let text = before;
  for (const edit of params.edits) {
    text = apply(text, edit);
    if (text === null) return null;
  }
  return text;
}

/** Is the file system under the project case-insensitive (the same folder under another case)? */
function caseInsensitive() {
  try {
    const flipped = ROOT.replace(/[A-Za-z]/g, (ch) => (ch === ch.toLowerCase() ? ch.toUpperCase() : ch.toLowerCase()));
    return flipped !== ROOT && existsSync(flipped) && statSync(flipped).ino === statSync(ROOT).ino;
  } catch {
    return false;
  }
}

/** A path inside the project, as git would name it: links resolved, its true case, and folded where the file system ignores case. */
function projectPath(file) {
  const resolve = (at) => {
    try {
      return realpathSync.native(at);
    } catch {
      const parent = path.dirname(at);
      return parent === at ? at : path.join(resolve(parent), path.basename(at));
    }
  };
  const rel = path.relative(resolve(ROOT), resolve(path.resolve(file))).split(path.sep).join("/");
  return caseInsensitive() ? rel.toLowerCase() : rel;
}

/**
 * AN EARLY WARNING, NOT THE CONTROL. Threat model: only the local agent edits these files through this hook, and it has the
 * machine's shell, so no refusal here can bind it; the refusal catches a mistaken hand edit early, and the check in parity.mjs
 * refuses and names any entry it did not record, however it was written. A removal entry or a simple-mode record counts only when parity.mjs wrote it (its `sig`,
 * checked by `recordProblem` in parity.mjs, which this imports so both judge an entry the same way): a hand edit by any route is
 * refused by the check itself. This only says so earlier, before an edit or a shell command that would write one by hand, so the
 * agent does not build on it. A shell command is read by its words, which no filter reads completely. Anything that goes wrong
 * allows the action.
 */
async function parityGuard(input) {
  try {
    const { isToolRecord, recordProblem, simpleModeLines } = await import("./parity.mjs");
    const params = input.tool_input ?? {};
    if (input.tool_name === "Bash") {
      const command = String(params.command ?? "");
      const writes = /(?:^|[^0-9&>])>{1,2}(?!\s*\/dev\/null)|\btee\b|\b(?:sed|perl)\b[^|;&]*\s-i|\b(?:cp|mv|truncate|dd|install|ln)\b|\b(?:node|python3?|ruby|perl|deno|bun|awk)\b/;
      const parityCommand = /design-canvas\/parity\.mjs\b/.test(command);
      if (!parityCommand && /parity-exceptions\.json/i.test(command) && writes.test(command)) return WRITTEN_BY_TOOL;
      if (!parityCommand && /design-canvas\/project\//i.test(command) && simpleModeLines(command) > 0 && writes.test(command)) return MODE_REFUSED;
      return null;
    }
    if (typeof params.file_path !== "string") return null;
    const rel = projectPath(params.file_path);
    const folded = caseInsensitive() ? (text) => text.toLowerCase() : (text) => text;
    if (!rel.startsWith(folded("design-canvas/project/"))) return null;
    const full = path.resolve(params.file_path);
    const before = existsSync(full) ? readFileSync(full, "utf8") : "";
    const after = afterEdit(input.tool_name, params, before);
    if (after === null) return null;
    if (rel === folded(EXCEPTIONS)) {
      const had = new Set((recordsIn(before, isToolRecord) ?? []).map((one) => JSON.stringify(one)));
      const added = (recordsIn(after, isToolRecord) ?? []).filter((one) => !had.has(JSON.stringify(one)));
      const bad = added.map(recordProblem).find(Boolean);
      return bad ? `${WRITTEN_BY_TOOL}: ${bad}` : null;
    }
    return simpleModeLines(after) > simpleModeLines(before) ? MODE_REFUSED : null;
  } catch {
    return null;
  }
}

const deny = (event, reason) => process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, permissionDecision: "deny", permissionDecisionReason: reason } }));

/** Bash, before and after: the reminders, the overlay and the parity bases, printed as one hook output. */
async function bash(input) {
  const event = input.hook_event_name === "PostToolUse" ? "PostToolUse" : "PreToolUse";
  const texts = [];
  const refused = event === "PreToolUse" ? await parityGuard(input) : null;
  if (refused) return void deny(event, refused);
  if (event === "PreToolUse") texts.push(await remind(input));
  const found = await overlay(input);
  if (found.deny && event === "PreToolUse") {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, permissionDecision: "deny", permissionDecisionReason: found.deny } }));
    return;
  }
  texts.push(found.context ?? null);
  texts.push(await basesFor(input, event));
  const text = texts.filter(Boolean).join("\n\n");
  if (text) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } }));
}

/* ------------------------------------------------------------------ the reuse checks */

/**
 * A path with its symlinks resolved, even when the file itself does not exist yet (a Write that creates it): the nearest existing
 * folder is resolved and the rest is put back. Node resolves this file's own location through symlinks (on macOS `/tmp` and `/var`
 * are links), while Claude Code reports the path the agent typed, so the two are compared resolved.
 */
function realPath(at) {
  try {
    return realpathSync(at);
  } catch {
    const parent = path.dirname(at);
    return parent === at ? at : path.join(realPath(parent), path.basename(at));
  }
}

/** Is this project-relative file untracked by git? Only an exit status of 1 says so; any other outcome says nothing. */
function isUntracked(rel) {
  return spawnSync("git", ["-C", ROOT, "ls-files", "--error-unmatch", "--", rel], { stdio: "ignore" }).status === 1;
}

/** One line in the log. A log that cannot be written never stops the check. */
function logLine(entry) {
  try {
    mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n");
  } catch {
    /* Not logged: carry on. */
  }
}

/** Was an error line logged in the last minute? Only the end of the log is read, which is where a minute of lines is. */
function loggedErrorRecently() {
  for (const line of (tailOf(LOG_FILE, 32768) ?? "").split("\n")) {
    try {
      const one = JSON.parse(line);
      if (one?.outcome === "error" && Date.now() - Date.parse(one.at) < 60_000) return true;
    } catch {
      /* A partial first line, or a blank one. */
    }
  }
  return false;
}

/** Record that a check could not run, at most once a minute. The edit itself is always allowed. */
function logCheckError(check, reason, tool, file) {
  if (loggedErrorRecently()) return;
  logLine({ at: new Date().toISOString(), tool, file, check, outcome: "error", reason });
}

async function checkEdit(input) {
  const tool = input.tool_name;
  const params = input.tool_input ?? {};
  if (typeof params.file_path !== "string") return;

  const root = realPath(ROOT);
  const abs = realPath(path.resolve(params.file_path));
  const rel = path.relative(root, abs).split(path.sep).join("/");
  /* Outside the project only when the way there goes UP: a folder that is merely named "..foo" is inside. */
  if (rel === "" || rel === ".." || rel.startsWith("../") || path.isAbsolute(rel)) return;

  const { applyEdit, judgeEdit } = await import("./checks.mjs");
  const { readSettingsSafe } = await import("./project-settings.mjs");
  const { loadRegistry } = await import("./registry.mjs");

  const { settings, error } = readSettingsSafe(CANVAS_DIR);
  if (error) {
    logCheckError("settings", error, tool, rel);
    return;
  }
  if (!settings || settings.buildFrom.length === 0) return;

  const existed = existsSync(abs);
  let before = "";
  if (existed) {
    try {
      before = readFileSync(abs, "utf8");
    } catch {
      return;
    }
  }

  let after;
  let written;
  if (tool === "Write") {
    if (typeof params.content !== "string") return;
    after = params.content;
    written = [params.content];
  } else if (tool === "Edit") {
    after = applyEdit(before, params, !existed);
    written = [params.new_string];
  } else {
    if (!Array.isArray(params.edits)) return;
    after = before;
    let creating = !existed;
    for (const edit of params.edits) {
      after = applyEdit(after, edit, creating);
      creating = false;
      if (after === null) return;
    }
    written = params.edits.map((edit) => edit.new_string);
  }
  if (typeof after !== "string") return;

  let registry;
  try {
    registry = await loadRegistry({ root: ROOT, canvasDir: CANVAS_DIR, settings });
  } catch (failure) {
    logCheckError("registry", String(failure?.message ?? failure).split(/\r?\n/)[0], tool, rel);
    return;
  }
  if (!registry) return;

  const verdict = judgeEdit({ root: ROOT, rel, existed, before, after, written: written.filter((one) => typeof one === "string"), registry, settings, isUntracked });
  if (!verdict.design) return;

  const mode = process.env.CANVAS_CHECKS_MODE === "log" ? "log" : "block";
  const at = new Date().toISOString();
  for (const one of verdict.refused) logLine({ at, tool, file: rel, check: one.check, outcome: "refused", name: one.name, mode });
  for (const one of verdict.given) logLine({ at, tool, file: rel, check: one.check, outcome: "reason-given", name: one.name, reason: one.reason, mode });

  if (verdict.message && mode === "block")
    process.stdout.write(
      JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: verdict.message } }),
    );
}

/* ------------------------------------------------------------------ the dispatch */

/** This machine's yes to the reuse checks, which also turns on the recapture. */
async function checksOn() {
  const { readAnswer } = await import("./checks-answer.mjs");
  return readAnswer(ROOT)?.checksHook === true;
}

async function run() {
  let input;
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return;
  }
  const tool = input?.tool_name;
  if (tool === "Bash") return bash(input);
  if (tool === "Write" || tool === "Edit" || tool === "MultiEdit") {
    /* After an edit, the overlay alone, whatever the checks answer: it prints nothing. Before one, the reuse checks when they are on. */
    if (input.hook_event_name === "PostToolUse") return void (await overlay(input));
    const refused = await parityGuard(input);
    if (refused) return void deny("PreToolUse", refused);
    return (await checksOn()) ? checkEdit(input) : undefined;
  }
  /* The recapture decides and starts its own background run, then returns; its capture output goes to its log. The one thing
     passed on is its line for the person at the screen, and only as the JSON it printed. */
  if (input?.hook_event_name === "Stop" && (await checksOn())) {
    const run = spawnSync(process.execPath, [path.join(CANVAS_DIR, "recapture.mjs"), "--hook"], { input: "", encoding: "utf8", stdio: ["pipe", "pipe", "ignore"], timeout: 8_000 });
    const said = (run.stdout ?? "").trim();
    try {
      if (said && typeof JSON.parse(said).systemMessage === "string") process.stdout.write(said);
    } catch {
      /* Anything else is not passed on. */
    }
  }
}

/* Whatever happens, the process ends with exit code 0 and, unless one of the outputs above was printed, nothing on stdout. */
process.on("uncaughtException", () => process.exit(0));
process.on("unhandledRejection", () => process.exit(0));
run()
  .catch(() => {})
  .finally(() => {
    process.exitCode = 0;
  });
