/**
 * Tests for the agent reminders: the words (`reminders.mjs`), the Claude Code hook that says them before a canvas command
 * (the Bash branch of `hook.mjs`), and the installer's entries for that hook.
 *
 *   node --test tool/tests/reminders.test.mjs
 *
 * WHAT IS PROVEN HERE:
 *   - Only a command that RUNS a canvas command is recognized: capture, capture-run, round, check-canvas, and a hand-written PATCH
 *     of the comments route. Reading those files, other canvas tools and ordinary commands say nothing.
 *   - The hook prints one PreToolUse `additionalContext` (never a decision) for a canvas command, nothing for anything else, and
 *     exit 0 with nothing on stdout for garbage. The skill line appears only when the end of the transcript shows no load, only
 *     that end is read however long the transcript is, and the reminders themselves never count as a load.
 *   - A capture's `next:` lines name the pictures to open, the comments left unconsumed with the drain command, and the oracle
 *     once; a run that wrote nothing prints none.
 *   - The installer merges the hook's two entries once, keeps other hooks, replaces an older install's reminder entry, and skips
 *     them with one line (exit 0) when git tracks the file or does not ignore it.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

import { afterCapture, afterRound, afterTurn, beforeAction, canvasCommandsIn, skillLoadedIn, slugIn, undrainedIn } from "../reminders.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.join(HERE, "..", "..");
const HOOK = path.join(SKILL, "tool", "hook.mjs");
const INSTALLER = path.join(SKILL, "scripts", "install-canvas.mjs");
const MARK = "design-canvas/hook.mjs";

const made = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});
const scratch = () => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "canvas-reminders-")));
  made.push(dir);
  return dir;
};
const bash = (command, extra = {}) => ({ tool_name: "Bash", tool_input: { command }, ...extra });

/* ------------------------------------------------------------------ the words */

test("only commands that run a canvas command are recognized", () => {
  assert.deepEqual(canvasCommandsIn("node design-canvas/capture.mjs --canvas library --only a,b 2>&1 | tail -8"), ["capture"]);
  assert.deepEqual(canvasCommandsIn("CANVAS_LANES=2 node ./design-canvas/capture-run.mjs --canvas main"), ["capture-run"]);
  assert.deepEqual(canvasCommandsIn("cd /x && node /x/design-canvas/round.mjs --canvas s --only a --drain c1"), ["round"]);
  assert.deepEqual(
    canvasCommandsIn("node design-canvas/capture.mjs --canvas s && node design-canvas/check-canvas.mjs --canvas s"),
    ["capture", "check-canvas"],
  );
  assert.deepEqual(
    canvasCommandsIn(`curl -s -X PATCH "http://localhost:3000/api/design-canvas/comments?canvas=s" -d '{"id":"c1","consumed":true}'`),
    ["comment-patch"],
  );
  for (const quiet of [
    "grep -n changed design-canvas/capture.mjs",
    "sed -n 1,40p design-canvas/round.mjs",
    "node design-canvas/drain.mjs --canvas s --ids c1",
    "node design-canvas/dump-screens.mjs --canvas s",
    "curl -s http://localhost:3000/api/design-canvas/comments?canvas=s",
    "npm test",
  ])
    assert.deepEqual(canvasCommandsIn(quiet), [], quiet);
});

test("the slug comes from --canvas or the route's canvas parameter, with a placeholder when there is none", () => {
  assert.equal(slugIn("node design-canvas/capture.mjs --canvas library"), "library");
  assert.equal(slugIn("node design-canvas/capture.mjs --canvas=tasks"), "tasks");
  assert.equal(slugIn("node design-canvas/capture.mjs"), "<slug>");
  assert.equal(slugIn(`curl -X PATCH "http://localhost:3000/api/design-canvas/comments?canvas=trips" -d '{}'`), "trips");
});

test("beforeAction gives the rules for the command, once per text, and the skill line only when it was not loaded", () => {
  assert.equal(beforeAction({ tool_name: "Edit", tool_input: { file_path: "x" } }), null);
  assert.equal(beforeAction(bash("ls -la")), null);
  const capture = beforeAction(bash("node design-canvas/capture.mjs --canvas library --only a"));
  assert.match(capture, /--only <ids>/);
  assert.match(capture, /drain\.mjs --canvas library/);
  assert.match(capture, /check-canvas\.mjs once/);
  assert.doesNotMatch(capture, /not been loaded/);
  const both = beforeAction(bash("node design-canvas/capture-run.mjs --canvas s; node design-canvas/capture.mjs --canvas s"));
  assert.equal(both.split("\n").length, 1, "capture and capture-run share one text");
  const oracle = beforeAction(bash("node design-canvas/check-canvas.mjs --canvas s"), { skillLoaded: false });
  const lines = oracle.split("\n");
  assert.equal(lines.length, 2);
  assert.match(lines[0], /design-canvas skill has not been loaded/);
  assert.match(lines[1], /once per round/);
});

test("a load is recognized in each form, and the reminders themselves never count as one", () => {
  assert.ok(skillLoadedIn(`{"type":"text","text":"Base directory for this skill: /Users/x/.claude/skills/design-canvas\\n\\n# Design canvas"}`));
  assert.ok(skillLoadedIn("Base directory for this skill: /p/plugins/cache/kit/skills/design-canvas"));
  assert.ok(skillLoadedIn(`{"input":{"file_path":"/Users/x/.claude/skills/design-canvas/SKILL.md"}}`));
  assert.ok(!skillLoadedIn("Base directory for this skill: /Users/x/.claude/skills/design-canvas-extra"), "another skill");
  assert.ok(
    !skillLoadedIn(`{"text":"Base directory for this skill: /Users/x/.claude/skills/other\\n\\nSee /x/design-canvas for more"}`),
    "another skill whose text mentions the canvas",
  );
  assert.ok(
    !skillLoadedIn(`{"name":"Skill","input":{"skill":"design-canvas"}} {"type":"tool_result","content":"Unknown skill: design-canvas"}`),
    "a call that failed is not a load",
  );
  const all = ["capture", "round", "check-canvas"]
    .map((one) => beforeAction(bash(`node design-canvas/${one}.mjs --canvas s`), { skillLoaded: false }))
    .join("\n");
  assert.ok(!skillLoadedIn(JSON.stringify(all)), "a reminder in the transcript is not a load");
  assert.ok(!skillLoadedIn(readFileSync(path.join(SKILL, "stubs", "agents-block.md"), "utf8")), "nor is the agent file's block");
});

test("a capture's next lines: pictures, unconsumed comments with the drain command, and the oracle once", () => {
  assert.deepEqual(afterCapture({ slug: "s", files: [], undrained: ["c1"] }), [], "nothing captured, nothing to say");
  const files = ["a", "b", "c", "d", "e", "f"].map((one) => `design-canvas/shots/s/${one}.webp`);
  const lines = afterCapture({ slug: "s", files, undrained: ["c4", "c7"] });
  assert.equal(lines.length, 3);
  assert.ok(lines.every((line) => line.startsWith("next: ")));
  assert.match(lines[0], /open the 6 picture\(s\) this capture wrote.*a\.webp.*d\.webp and 2 more$/);
  assert.match(lines[1], /^next: c4, c7 sit on a frame whose picture changed.*drain\.mjs --canvas s --ids c4,c7/);
  assert.match(lines[2], /check-canvas\.mjs --canvas s$/);
  assert.equal(afterCapture({ slug: "s", files, oracle: false }).length, 1, "no unconsumed comments, no oracle line");
  assert.match(afterCapture({ slug: "s", files, undrained: ["c9"] })[1], /^next: c9 sits on a frame whose picture changed and is not consumed; if you worked it:/);
  assert.deepEqual(afterRound({ sheet: null }), []);
  assert.match(afterRound({ sheet: "design-canvas/rounds/s/x/sheet.png" })[0], /^next: open design-canvas\/rounds\/s\/x\/sheet\.png/);
});

test("undrained means a stale note that is not consumed", () => {
  const ids = undrainedIn([
    { id: "c1", stale: true },
    { id: "c2", stale: true, kind: "note" },
    { id: "c3", stale: true, consumedAt: "2026-01-01T00:00:00Z" },
    { id: "c4", stale: false },
    { id: "c5", stale: true, kind: "verdict" },
    { id: "c6", stale: true, kind: "like" },
    { id: "c7", stale: true, kind: "dislike" },
  ]);
  assert.deepEqual(ids, ["c1", "c2"]);
  assert.deepEqual(undrainedIn(undefined), []);
});

test("the capture, the round and the oracle's drain gate share one list, so none of them asks to drain a verdict", () => {
  /* Draining a verdict deletes it: every tool that names comments to drain must read them through `undrainedIn`. */
  for (const tool of ["capture.mjs", "round.mjs", "check-canvas.mjs"]) {
    const source = readFileSync(path.join(SKILL, "tool", tool), "utf8");
    assert.match(source, /undrainedIn\(/, `${tool} reads the drain list through undrainedIn`);
    assert.doesNotMatch(source, /stale === true && !\w+\.consumedAt/, `${tool} keeps no list of its own`);
  }
});

/* ------------------------------------------------------------------ the hook, as Claude Code runs it */

const runHook = (stdin) => spawnSync(process.execPath, [HOOK], { input: stdin, encoding: "utf8" });

test("the hook adds context for a canvas command and prints nothing for anything else", () => {
  const dir = scratch();
  const transcript = path.join(dir, "session.jsonl");
  writeFileSync(transcript, `{"type":"user","message":{"content":"recapture the library canvas"}}\n`);
  const out = runHook(JSON.stringify(bash("node design-canvas/capture.mjs --canvas library --only a", { transcript_path: transcript })));
  assert.equal(out.status, 0);
  const json = JSON.parse(out.stdout);
  assert.equal(json.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.equal(json.hookSpecificOutput.permissionDecision, undefined, "never a decision");
  assert.match(json.hookSpecificOutput.additionalContext, /^The design-canvas skill has not been loaded/);
  assert.match(json.hookSpecificOutput.additionalContext, /--canvas library/);

  for (const input of [bash("git status", { transcript_path: transcript }), { tool_name: "Write", tool_input: { file_path: "a", content: "" } }]) {
    const quiet = runHook(JSON.stringify(input));
    assert.equal(quiet.status, 0);
    assert.equal(quiet.stdout, "");
  }
  const garbage = runHook("not json");
  assert.equal(garbage.status, 0);
  assert.equal(garbage.stdout, "");
});

test("the hook reads only the end of the transcript, and says nothing about the skill without a transcript", () => {
  const dir = scratch();
  const transcript = path.join(dir, "long.jsonl");
  const load = "Base directory for this skill: /Users/x/.claude/skills/design-canvas\\n";
  const round = (input) => JSON.parse(runHook(JSON.stringify(input)).stdout).hookSpecificOutput.additionalContext;
  /* A load in the last megabyte is seen. */
  writeFileSync(transcript, `${"x".repeat(3 * 1024 * 1024)}${load}\n${"y".repeat(1000)}\n`);
  assert.doesNotMatch(round(bash("node design-canvas/round.mjs --canvas s", { transcript_path: transcript })), /not been loaded/);
  /* One further back than that is not, so the agent is reminded, and a long transcript costs no more than a short one. */
  writeFileSync(transcript, `${load}\n${"y".repeat(2 * 1024 * 1024)}\n`);
  const started = Date.now();
  const far = round(bash("node design-canvas/round.mjs --canvas s", { transcript_path: transcript }));
  assert.match(far, /^The design-canvas skill has not been loaded/);
  assert.match(far, /Canvas round/);
  assert.ok(Date.now() - started < 5000);
  const none = round(bash("node design-canvas/round.mjs --canvas s"));
  assert.doesNotMatch(none, /not been loaded/);
});

/* ------------------------------------------------------------------ the installer's entry */

const envFor = (dir) => ({
  ...process.env,
  CANVAS_ANSWERS_FILE: path.join(dir, "answers.json"),
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  XDG_CONFIG_HOME: path.join(dir, "xdg"),
});
function repoIn(dir, { ignore = true } = {}) {
  const repo = path.join(dir, "repo");
  mkdirSync(repo, { recursive: true });
  writeFileSync(path.join(repo, "package.json"), "{}\n");
  execFileSync("git", ["init", "-q"], { cwd: repo, env: envFor(dir) });
  if (ignore) writeFileSync(path.join(repo, ".git", "info", "exclude"), ".claude/settings.local.json\n");
  return repo;
}
const install = (dir, repo) =>
  spawnSync(process.execPath, [INSTALLER, "--target", repo], { cwd: repo, env: envFor(dir), encoding: "utf8" });
const hookEntries = (repo, event) =>
  (JSON.parse(readFileSync(path.join(repo, ".claude", "settings.local.json"), "utf8")).hooks?.[event] ?? []).filter((entry) =>
    (entry.hooks ?? []).some((hook) => String(hook.command).includes(MARK)),
  );

test("the installer merges the two hook entries once, beside the hooks already there, replaces an older reminder entry, and ships the files", () => {
  const dir = scratch();
  const repo = repoIn(dir);
  mkdirSync(path.join(repo, ".claude"));
  const older = { type: "command", command: "sh -c 'f=\"$d/design-canvas/reminder-hook.mjs\"; node \"$f\"'", timeout: 5 };
  writeFileSync(
    path.join(repo, ".claude", "settings.local.json"),
    JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo mine" }] }, { matcher: "Bash", hooks: [older] }] } }),
  );
  assert.equal(install(dir, repo).status, 0);
  assert.equal(install(dir, repo).status, 0);
  const entries = hookEntries(repo, "PreToolUse");
  assert.equal(entries.length, 1, "one entry however many installs");
  assert.equal(entries[0].matcher, "Bash|Write|Edit|MultiEdit");
  assert.equal(hookEntries(repo, "Stop").length, 1, "and one at the end of a turn");
  const all = JSON.parse(readFileSync(path.join(repo, ".claude", "settings.local.json"), "utf8")).hooks.PreToolUse;
  assert.equal(all.length, 2, "the older reminder entry is gone");
  assert.equal(all[0].hooks[0].command, "echo mine", "the project's own hook is kept, first");
  for (const file of ["reminders.mjs", "hook.mjs", "checks-answer.mjs"]) assert.ok(readFileSync(path.join(repo, "design-canvas", file), "utf8").length > 0);
});

test("a local settings file git does not ignore, or tracks, gets no entry and one line, and the install still exits 0", () => {
  const dir = scratch();
  const repo = repoIn(dir, { ignore: false });
  const out = install(dir, repo);
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /Canvas hooks: NOT added\. git does not ignore \.claude\/settings\.local\.json/);
  assert.equal(spawnSync("git", ["-C", repo, "status", "--short"], { encoding: "utf8", env: envFor(dir) }).stdout.includes(".claude"), false);

  const dir2 = scratch();
  const tracked = repoIn(dir2, { ignore: false });
  mkdirSync(path.join(tracked, ".claude"));
  writeFileSync(path.join(tracked, ".claude", "settings.local.json"), "{}\n");
  execFileSync("git", ["add", "-f", ".claude/settings.local.json"], { cwd: tracked, env: envFor(dir2) });
  const second = install(dir2, tracked);
  assert.equal(second.status, 0, second.stdout + second.stderr);
  assert.match(second.stdout, /Canvas hooks: NOT added\. \.claude\/settings\.local\.json is tracked by git/);
  assert.equal(readFileSync(path.join(tracked, ".claude", "settings.local.json"), "utf8"), "{}\n", "byte for byte as it was");
});

test("the end of a turn names the canvases not open that hold out-of-date frames, in one line, and says nothing otherwise", () => {
  assert.equal(afterTurn({ elsewhere: [] }), null);
  assert.equal(afterTurn({ elsewhere: [{ slug: "tablet", count: 4 }, { slug: "phone", count: 3 }] }), "design-canvas: 7 frame(s) on canvases not open now are out of date (tablet 4, phone 3); each canvas refreshes when it is opened");
  assert.doesNotMatch(afterTurn({ elsewhere: [{ slug: "a", count: 1 }] }), /\.$|[\u2013\u2014]/, "short copy: no final period, no dashes");
});
