/**
 * design-canvas — where the answer to the one install question is kept.
 *
 * The question is "stop agents from building new design out of parts the approved design does not use?". The answer says
 * whether THIS machine's reviewer wants the reuse-check hook, and it belongs to the reviewer and not to the project. So it is
 * not kept in `design-canvas/settings.json` (that file is committed, and nothing about the answer may be committed, or a
 * teammate or a CI run that never answered would be judged by somebody else's yes). It lives on the machine, outside every
 * repo, in one JSON file:
 *
 *   $CANVAS_ANSWERS_FILE            when that variable is set (the tests set it, so they never touch the real file)
 *   ~/.config/design-canvas/answers.json   otherwise
 *
 * THE KEY is the absolute path of the target's git common dir (`git rev-parse --path-format=absolute --git-common-dir`), so every
 * worktree of one repo shares one answer: a new worktree needs no new question. A target that is not a git checkout is keyed by
 * its own absolute path. The paths are resolved through the file system first, so `/var/...` and `/private/var/...` (the same
 * folder on a Mac) are one key.
 *
 * THE VALUE is `{ "checksHook": true | false, "at": "<ISO time>" }`.
 *
 * Recorded by `install-canvas.mjs`, and read by `hook.mjs` (the reuse checks and the recapture run only on a true answer) and by
 * `check-install.mjs` (which judges the local hook entries only when the answer is true).
 *
 * DELETE WITH: the design-canvas/ folder.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** The one answers file on this machine. */
export function answersFile() {
  const fromEnv = process.env.CANVAS_ANSWERS_FILE;
  return fromEnv ? path.resolve(fromEnv) : path.join(os.homedir(), ".config", "design-canvas", "answers.json");
}

/** `realpathSync` that survives a path that does not exist yet: the nearest folder that does is resolved and the rest re-attached. */
export function realish(p) {
  const absolute = path.resolve(p);
  const rest = [];
  let here = absolute;
  while (!existsSync(here) && path.dirname(here) !== here) {
    rest.unshift(path.basename(here));
    here = path.dirname(here);
  }
  try {
    return path.join(realpathSync(here), ...rest);
  } catch {
    return absolute;
  }
}

/** The key one project is filed under: its git common dir, or the target's own path when it is not a git checkout. */
export function answerKey(target) {
  const run = spawnSync("git", ["-C", target, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" });
  const common = run.status === 0 ? run.stdout.trim() : "";
  return realish(common !== "" ? common : target);
}

/** The file's JSON object: `{ value }` (empty when there is no file or it is blank) or `{ error }` when it cannot be used as one. */
function readStore(file) {
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
 * This machine's answer for the project: `{ checksHook, at }`, or `null` when there is none (never asked, the file is missing, or
 * the file cannot be read). A reader that finds a broken file says nothing: "no answer" is the safe reading, because it checks
 * and installs nothing.
 */
export function readAnswer(target) {
  const read = readStore(answersFile());
  if (read.error) return null;
  const entry = read.value[answerKey(target)];
  if (!entry || typeof entry !== "object" || typeof entry.checksHook !== "boolean") return null;
  return entry;
}

/**
 * Record the answer. Every other project's entry in the file is kept as it was. A file that exists and is not a JSON object is
 * somebody's work and is left untouched: `{ ok: false, error }` says why, and nothing is written.
 */
export function writeAnswer(target, checksHook) {
  const file = answersFile();
  const read = readStore(file);
  if (read.error) return { ok: false, error: `${file} was left untouched because ${read.error}` };
  const store = { ...read.value, [answerKey(target)]: { checksHook, at: new Date().toISOString() } };
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  } catch (error) {
    return { ok: false, error: `${file} could not be written (${error.message})` };
  }
  return { ok: true, file };
}
