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
 *                                       own folder, a push that carries canvas code is denied here, with one line per file: the
 *                                       only deny this hook ever prints for a Bash command.
 *   PostToolUse, Bash                   THE OVERLAY, after a git command: local lines that no longer fit the updated files, and the
 *                                       hand-off list taken out of the code at a push, as context for the agent to act on and show.
 *                                       THE PARITY BASES, after a pull, merge or rebase: an exploration's base moves to the pulled
 *                                       commit when that commit changed its files (`followRemote` in parity.mjs), one line each.
 *   PreToolUse, Write, Edit, MultiEdit  THE REUSE CHECKS (`checks.mjs`). A refused edit prints
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
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, realpathSync, statSync } from "node:fs";
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
  const { beforeAction, canvasCommandsIn, skillLoadedIn } = await import("./reminders.mjs");
  const command = input.tool_input?.command;
  if (typeof command !== "string" || canvasCommandsIn(command).length === 0) return null;
  return beforeAction(input, { skillLoaded: transcriptShowsSkill(input.transcript_path, skillLoadedIn) }) || null;
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

/* A git command that can bring the developers' commits into this checkout. */
const BRINGS_COMMITS = /\bgit\b[^|;&]*\b(?:pull|merge|rebase)\b/;

/**
 * The parity bases follow a pull (`followRemote` in parity.mjs): before the command the commit checked out is noted, after it
 * the bases whose files the pulled commits changed move to the pulled commit, one line each.
 */
async function followBases(input, event) {
  try {
    if (!BRINGS_COMMITS.test(String(input.tool_input?.command ?? ""))) return null;
    const { followRemote, rememberHead, takeHead } = await import("./parity.mjs");
    if (event === "PreToolUse") {
      rememberHead({ root: ROOT, canvasDir: CANVAS_DIR });
      return null;
    }
    const lines = await followRemote({ root: ROOT, canvasDir: CANVAS_DIR, before: takeHead(CANVAS_DIR) });
    return lines.length > 0 ? lines.join("\n") : null;
  } catch {
    return null;
  }
}

/** Bash, before and after: the reminders, the overlay and the parity bases, printed as one hook output. */
async function bash(input) {
  const event = input.hook_event_name === "PostToolUse" ? "PostToolUse" : "PreToolUse";
  const texts = [];
  if (event === "PreToolUse") texts.push(await remind(input));
  const found = await overlay(input);
  if (found.deny && event === "PreToolUse") {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, permissionDecision: "deny", permissionDecisionReason: found.deny } }));
    return;
  }
  texts.push(found.context ?? null);
  texts.push(await followBases(input, event));
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
  if (tool === "Write" || tool === "Edit" || tool === "MultiEdit") return (await checksOn()) ? checkEdit(input) : undefined;
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
