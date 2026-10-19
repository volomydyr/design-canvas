/**
 * Tests for the installer's side of the canvas's Claude Code hooks: the two entries it writes into the checkout's
 * `.claude/settings.local.json` on every install, the one question asked at install (`--checks yes|no`), where its answer is kept,
 * and what `check-install.mjs` does with it.
 *
 *   node --test tool/tests/install-checks.test.mjs
 *
 * WHAT IS PROVEN HERE:
 *   - Every install merges the same entries (PreToolUse for Bash and for the edit tools, PostToolUse, Stop, all `design-canvas/hook.mjs`), keeps every other key and hook
 *     of a file that is already there, and a second run adds nothing. An empty file, a whitespace-only file and a file with a
 *     byte-order mark are all read.
 *   - `--checks yes|no` (and `=yes`, `=no`) only records the answer, on the machine, never in the project: one JSON file
 *     ($CANVAS_ANSWERS_FILE here, so no test touches the real one), keyed by the git common dir, so every worktree of a repo
 *     shares it. Anything else, or two of them, is refused before the canvas is installed.
 *   - Git is asked, not trusted: whatever the answer, the ignore rule goes into the repository's exclude list when the file is not
 *     ignored, never into .gitignore, in a linked worktree and a subfolder project too (the same list the canvas's own lines go in).
 *   - A tracked file, a file that is not valid JSON and a `.claude` that is not a folder are left byte for byte alone, with one line;
 *     the install exits 1 only when the answer is yes.
 *   - `check-install.mjs` fails on the entries only when this machine's answer for the project is yes, and says nothing otherwise.
 *   - The hook's shell wrapper exits 0 whatever happens to the hook file, and still passes its stdout through.
 *
 * Every test builds throwaway projects in its own temp folder, with GIT_CONFIG_GLOBAL=/dev/null so this machine's global ignore
 * rules (Claude Code adds settings.local.json to one) cannot hide the cases. No project here has a declaration, so the installer's
 * declaration checks (which need esbuild) have nothing to read and these tests need no CANVAS_TEST_PROJECT.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.join(HERE, "..", "..");
const INSTALLER = path.join(SKILL, "scripts", "install-canvas.mjs");
const CHECKER = path.join(SKILL, "scripts", "check-install.mjs");

const ON = "Reuse checks: on for this project, with the background recapture beside them.";
const OFF = "Reuse checks: off for this project.";
const NOT_SET = "Reuse checks: not set for this project. Ask the reviewer once and run again with --checks yes or --checks no.";
const LOCAL = path.join(".claude", "settings.local.json");
const MARK = "design-canvas/hook.mjs";

const made = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** One scratch folder per test: the projects live under it, and so does that test's own answers file. */
function scratch() {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "canvas-install-checks-")));
  made.push(dir);
  return { dir, answers: path.join(dir, "answers.json") };
}

/* GIT_CONFIG_GLOBAL=/dev/null drops the global git config, but git ALSO reads a default global ignore file, `$XDG_CONFIG_HOME/git/ignore`
   (`~/.config/git/ignore`), without any config naming it. That is where a machine keeps `.claude/settings.local.json`, so XDG_CONFIG_HOME
   points into the test's own folder as well. */
const envFor = (answers) => ({
  ...process.env,
  CANVAS_ANSWERS_FILE: answers,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  XDG_CONFIG_HOME: path.join(path.dirname(answers), "xdg-config-home"),
});

const git = (cwd, answers, ...args) =>
  execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args], {
    cwd,
    env: envFor(answers),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

/** A project folder with a package.json (the installer's one requirement); a git checkout unless `git: false`. */
function project(s, name = "repo", { git: asGit = true } = {}) {
  const repo = path.join(s.dir, name);
  mkdirSync(repo, { recursive: true });
  writeFileSync(path.join(repo, "package.json"), "{}\n");
  if (asGit) git(repo, s.answers, "init", "-q");
  return repo;
}

const install = (s, repo, ...flags) =>
  spawnSync(process.execPath, [INSTALLER, "--target", repo, ...flags], { cwd: repo, env: envFor(s.answers), encoding: "utf8" });
const checkInstall = (s, repo) => spawnSync(process.execPath, [CHECKER, "--target", repo], { cwd: repo, env: envFor(s.answers), encoding: "utf8" });

const localFile = (repo) => path.join(repo, LOCAL);
const readLocal = (repo) => JSON.parse(readFileSync(localFile(repo), "utf8"));
const writeLocal = (repo, text) => {
  mkdirSync(path.dirname(localFile(repo)), { recursive: true });
  writeFileSync(localFile(repo), text);
};
/** The canvas's entries for one event (the hooks that run design-canvas/hook.mjs). */
const entriesOf = (settings, event) =>
  (settings.hooks?.[event] ?? []).filter((entry) => (entry.hooks ?? []).some((hook) => String(hook.command).includes(MARK)));
/* PreToolUse has two entries (Bash, given a minute for a long push scan, and the edit tools, ten seconds); Stop has one. */
const both = (settings) => [entriesOf(settings, "PreToolUse").length, entriesOf(settings, "Stop").length];
const readAnswers = (s) => (existsSync(s.answers) ? JSON.parse(readFileSync(s.answers, "utf8")) : {});
const ignored = (s, repo) => spawnSync("git", ["-C", repo, "check-ignore", "-q", LOCAL.split(path.sep).join("/")], { env: envFor(s.answers) }).status === 0;
const excludeFile = (repo) => path.join(repo, ".git", "info", "exclude");

/* ------------------------------------------------------------------ the entries */

test("--checks yes records true, and the two entries are merged into an existing settings.local.json, keeping every other key and hook", () => {
  const s = scratch();
  const repo = project(s);
  const before = {
    permissions: { allow: ["Bash(ls)"], deny: [] },
    env: { KEPT: "1" },
    hooks: {
      PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo unrelated" }] }],
      PostToolUse: [{ matcher: "Edit", hooks: [{ type: "command", command: "echo after" }] }],
    },
  };
  writeLocal(repo, JSON.stringify(before));
  const out = install(s, repo, "--checks", "yes");
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.ok(out.stdout.includes(ON), out.stdout);
  const after = readLocal(repo);
  assert.deepEqual(after.permissions, before.permissions);
  assert.deepEqual(after.env, before.env);
  assert.deepEqual(after.hooks.PostToolUse[0], before.hooks.PostToolUse[0], "the unrelated after-hook is first and unchanged");
  assert.equal(entriesOf(after, "PostToolUse").length, 1, "and the canvas's own after-hook for git commands is beside it");
  assert.deepEqual(after.hooks.PreToolUse[0], before.hooks.PreToolUse[0], "the unrelated hook is first and unchanged");
  assert.deepEqual(both(after), [2, 1]);
  assert.deepEqual(entriesOf(after, "PreToolUse").map((entry) => [entry.matcher, entry.hooks[0].timeout]), [["Bash", 60], ["Write|Edit|MultiEdit", 10]]);
  assert.deepEqual(entriesOf(after, "PostToolUse").map((entry) => entry.matcher), ["Bash|Write|Edit|MultiEdit"], "after a git command and after an edit");
  assert.ok(existsSync(path.join(repo, "design-canvas", "hook.mjs")) && existsSync(path.join(repo, "design-canvas", "recapture.mjs")), "the hook files are shipped");
  assert.deepEqual(both(readLocal((install(s, repo, "--checks", "yes"), repo))), [2, 1], "a second run adds nothing");
  const key = path.join(repo, ".git");
  assert.equal(readAnswers(s)[key]?.checksHook, true, JSON.stringify(readAnswers(s)));
  assert.ok(!Number.isNaN(Date.parse(readAnswers(s)[key].at)), "the answer carries an ISO time");
});

test("the installer never writes design-canvas/settings.json, whatever the answer", () => {
  const s = scratch();
  for (const flag of ["yes", "no"]) {
    const repo = project(s, `repo-${flag}`);
    const out = install(s, repo, `--checks=${flag}`);
    assert.equal(out.status, 0, out.stdout + out.stderr);
    assert.ok(!existsSync(path.join(repo, "design-canvas", "settings.json")), `--checks=${flag} wrote settings.json`);
  }
});

test("a second yes adds no duplicate entry and no duplicate exclude rule, and leaves the file as it was", () => {
  const s = scratch();
  const repo = project(s);
  assert.equal(install(s, repo, "--checks", "yes").status, 0);
  const first = readFileSync(localFile(repo), "utf8");
  const exclude = readFileSync(excludeFile(repo), "utf8");
  const again = install(s, repo, "--checks", "yes");
  assert.equal(again.status, 0, again.stdout + again.stderr);
  assert.equal(readFileSync(localFile(repo), "utf8"), first, "the second run changed nothing in the local file");
  assert.equal(readFileSync(excludeFile(repo), "utf8"), exclude, "the exclude list is unchanged by the second run");
  assert.equal(Object.keys(readAnswers(s)).length, 1);
});

test("whatever the answer, the exclude rule is written when git does not ignore the file, and .gitignore is not touched for it", () => {
  const s = scratch();
  const repo = project(s);
  writeFileSync(path.join(repo, ".gitignore"), "node_modules/\n");
  const gitignore = readFileSync(path.join(repo, ".gitignore"), "utf8");
  assert.equal(ignored(s, repo), false, "precondition: nothing ignores the local settings file yet");
  const out = install(s, repo);
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.equal(ignored(s, repo), true, "git now ignores the file");
  const lines = readFileSync(excludeFile(repo), "utf8").split("\n").filter((line) => line.trim() === ".claude/settings.local.json");
  assert.equal(lines.length, 1, "the rule is in the exclude list exactly once");
  assert.equal(readFileSync(path.join(repo, ".gitignore"), "utf8"), gitignore, ".gitignore is byte for byte what it was");
  assert.match(out.stdout, /\.git\/info\/exclude/);
  assert.deepEqual(both(readLocal(repo)), [2, 1], "and the entries are in, without a yes");
  assert.equal(install(s, repo, "--checks", "yes").status, 0);
  assert.equal(readFileSync(excludeFile(repo), "utf8").split("\n").filter((line) => line.trim() === ".claude/settings.local.json").length, 1, "once");
});

test("--checks=yes is the same as --checks yes, and any other --checks argument, or two of them, is refused before anything is written", () => {
  const s = scratch();
  const viaEquals = project(s, "equals");
  const ok = install(s, viaEquals, "--checks=yes");
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.ok(ok.stdout.includes(ON));
  for (const bad of [["--checks=maybe"], ["--checks", "maybe"], ["--checks"], ["--checksyes"]]) {
    const repo = project(s, `bad-${bad.join("-").replace(/[^\w]/g, "")}`);
    const out = install(s, repo, ...bad);
    assert.equal(out.status, 1, `${bad.join(" ")}: ${out.stdout}${out.stderr}`);
    assert.match(out.stderr, /--checks takes yes or no/);
    assert.ok(!existsSync(path.join(repo, "design-canvas")), `${bad.join(" ")} wrote the canvas`);
  }
  for (const args of [["--checks", "yes", "--checks", "no"], ["--checks=yes", "--checks=no"], ["--checks", "yes", "--checks=yes"]]) {
    const repo = project(s, `two-${args.join("").replace(/[^\w]/g, "")}`);
    const out = install(s, repo, ...args);
    assert.equal(out.status, 1, `${args.join(" ")}: ${out.stdout}${out.stderr}`);
    assert.match(out.stderr, /--checks was given more than once/);
    assert.ok(!existsSync(path.join(repo, "design-canvas")) && !existsSync(path.join(repo, ".claude")), `${args.join(" ")} wrote something`);
  }
  assert.equal(Object.keys(readAnswers(s)).length, 1, "only the valid yes was recorded");
});

test("an empty, a whitespace-only and a BOM-prefixed settings.local.json are read, not refused", () => {
  const s = scratch();
  for (const [name, text, expectedKeys] of [
    ["empty", "", []],
    ["blank", "  \n\t\n", []],
    ["bom", `﻿${JSON.stringify({ permissions: { allow: ["Bash(ls)"] } })}`, ["permissions"]],
  ]) {
    const repo = project(s, name);
    writeLocal(repo, text);
    const out = install(s, repo, "--checks", "yes");
    assert.equal(out.status, 0, `${name}: ${out.stdout}${out.stderr}`);
    const settings = readLocal(repo);
    assert.deepEqual(both(settings), [2, 1], name);
    for (const key of expectedKeys) assert.ok(key in settings, `${name} kept ${key}`);
  }
});

test("a file that is not valid JSON, a tracked file and a .claude that is not a folder are left alone with one line, and exit 1 only on a yes", () => {
  const s = scratch();
  const broken = project(s, "broken");
  writeLocal(broken, "{ not json");
  const out = install(s, broken, "--checks", "yes");
  assert.equal(out.status, 1);
  assert.equal(readFileSync(localFile(broken), "utf8"), "{ not json");
  assert.match(out.stdout, /Canvas hooks: not added\. \.claude\/settings\.local\.json was left untouched because it is not valid JSON/);
  assert.ok(!out.stdout.includes(ON), "the success line is not printed next to a failure");

  const tracked = project(s, "tracked");
  const original = `${JSON.stringify({ permissions: { allow: ["Bash(ls)"] } }, null, 2)}\n`;
  writeLocal(tracked, original);
  git(tracked, s.answers, "add", "-f", "--", ".claude/settings.local.json");
  const refused = install(s, tracked, "--checks", "yes");
  assert.equal(refused.status, 1, refused.stdout + refused.stderr);
  assert.match(refused.stdout, /Canvas hooks: not added\. \.claude\/settings\.local\.json is tracked by git, so the hooks cannot be added privately/);
  assert.equal(readFileSync(localFile(tracked), "utf8"), original, "the tracked file is byte for byte untouched");
  assert.ok(!readFileSync(excludeFile(tracked), "utf8").includes("settings.local.json"), "no exclude rule was written");
  assert.equal(install(s, tracked).status, 1, "a recorded yes does not slip the entries into a tracked file on a run with no flag either");
  assert.equal(readFileSync(localFile(tracked), "utf8"), original);
  assert.equal(install(s, tracked, "--checks", "no").status, 0, "with a no, the same refusal is a line and not a failure");

  const file = project(s, "file");
  writeFileSync(path.join(file, ".claude"), "not a folder\n");
  const stopped = install(s, file, "--checks", "yes");
  assert.equal(stopped.status, 1, stopped.stdout + stopped.stderr);
  assert.match(stopped.stdout, /Canvas hooks: not added\. \.claude exists in .* but is not a folder, so \.claude\/settings\.local\.json cannot be created/);
  assert.equal(readFileSync(path.join(file, ".claude"), "utf8"), "not a folder\n", ".claude is untouched");
  assert.ok(!readFileSync(excludeFile(file), "utf8").includes("settings.local.json"), "no exclude rule was written for the settings file");
});

/* ------------------------------------------------------------------ the answer */

for (const form of [["--checks", "no"], ["--checks=no"]]) {
  test(`${form.join(" ")} records false and keeps the entries, which the reminders use whatever the answer`, () => {
    const s = scratch();
    const repo = project(s);
    writeLocal(repo, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "echo stop" }] }] } }));
    assert.equal(install(s, repo, "--checks", "yes").status, 0);
    const entries = readFileSync(localFile(repo), "utf8");
    const out = install(s, repo, ...form);
    assert.equal(out.status, 0, out.stdout + out.stderr);
    assert.ok(out.stdout.split("\n").includes(OFF), out.stdout);
    assert.equal(readFileSync(localFile(repo), "utf8"), entries, "the entries stay as they were");
    assert.equal(readLocal(repo).hooks.Stop[0].hooks[0].command, "echo stop", "an unrelated Stop hook stays first");
    assert.equal(readAnswers(s)[path.join(repo, ".git")]?.checksHook, false);
    const quiet = install(s, repo);
    assert.equal(quiet.status, 0, quiet.stdout + quiet.stderr);
    assert.doesNotMatch(quiet.stdout, /Reuse checks/, "a later run with no flag says nothing about it");
  });
}

test("with no flag and no answer the install prints the exact line and installs", () => {
  const s = scratch();
  const repo = project(s);
  const out = install(s, repo);
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.ok(out.stdout.split("\n").includes(NOT_SET), out.stdout);
  assert.ok(existsSync(path.join(repo, "design-canvas", "core")), "the canvas was installed");
  assert.deepEqual(readAnswers(s), {});
});

test("an answer that cannot be recorded says so, and exits 1", (t) => {
  const s = scratch();
  const repo = project(s);
  /* The answers file's parent folder is a regular file, so the folder can never be made: the write is certain to fail. */
  const blocker = path.join(s.dir, "not-a-folder");
  writeFileSync(blocker, "x");
  const out = spawnSync(process.execPath, [INSTALLER, "--target", repo, "--checks", "yes"], {
    cwd: repo,
    env: { ...envFor(s.answers), CANVAS_ANSWERS_FILE: path.join(blocker, "sub", "answers.json") },
    encoding: "utf8",
  });
  assert.equal(out.status, 1, out.stdout + out.stderr);
  assert.match(out.stdout, /Reuse checks: the answer was not recorded/);
  assert.ok(!out.stdout.includes(ON), "no success line");
  if (typeof process.getuid === "function" && process.getuid() === 0) return t.skip("root can write a read-only file");
  /* A recorded yes that can be read but not rewritten: the no is not recorded, and the yes stands. */
  assert.equal(install(s, repo, "--checks", "yes").status, 0);
  chmodSync(s.answers, 0o444);
  const no = install(s, repo, "--checks", "no");
  assert.equal(no.status, 1, no.stdout + no.stderr);
  assert.match(no.stdout, /Reuse checks: the answer was not recorded/);
  assert.equal(readAnswers(s)[path.join(repo, ".git")]?.checksHook, true, "the yes is still the recorded answer");
});

test("a project that is not a git checkout needs no ignore rule: the entries go in, and the answer is keyed by its own path", () => {
  const s = scratch();
  const repo = project(s, "plain", { git: false });
  const out = install(s, repo, "--checks", "yes");
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.ok(out.stdout.includes(ON));
  assert.deepEqual(both(readLocal(repo)), [2, 1]);
  assert.equal(readAnswers(s)[repo]?.checksHook, true, JSON.stringify(readAnswers(s)));
});

/* ------------------------------------------------------------------ worktrees and subfolders */

test("a new linked worktree gets the entries on a run with no flag, because the answer is shared by the repo", () => {
  const s = scratch();
  const main = project(s, "main");
  assert.equal(install(s, main, "--checks", "yes").status, 0);
  git(main, s.answers, "add", "package.json");
  git(main, s.answers, "commit", "-q", "-m", "init");
  const wt = path.join(s.dir, "wt");
  git(main, s.answers, "worktree", "add", "-q", wt, "-b", "feature");
  assert.ok(!existsSync(localFile(wt)), "a new worktree has no local settings file");
  const out = install(s, wt);
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.ok(out.stdout.split("\n").includes(ON), out.stdout);
  assert.deepEqual(both(readLocal(wt)), [2, 1], "the worktree has the entries now");
  assert.deepEqual(Object.keys(readAnswers(s)), [path.join(main, ".git")], "one answer for the repo, not one per worktree");
});

test("in an unignored linked worktree the rule goes in the repository's exclude list, beside the canvas's lines, and the entries go in", () => {
  const s = scratch();
  const main = project(s, "main");
  git(main, s.answers, "add", "package.json");
  git(main, s.answers, "commit", "-q", "-m", "init");
  const wt = path.join(s.dir, "wt");
  git(main, s.answers, "worktree", "add", "-q", wt, "-b", "feature");
  const out = install(s, wt);
  assert.equal(out.status, 0, out.stdout + out.stderr);
  const after = readFileSync(excludeFile(main), "utf8");
  assert.ok(after.split("\n").includes(".claude/settings.local.json"), "the rule is in the repository's list, the one git reads");
  assert.ok(after.includes("/design-canvas/\n"), "beside the canvas's own lines");
  assert.equal(ignored(s, wt), true);
  assert.deepEqual(both(readLocal(wt)), [2, 1]);
  assert.equal(git(wt, s.answers, "status", "--short").includes(".claude"), false, "git sees no new .claude path");
});

test("a project in a subfolder of a repo gets the rule anchored at its folder in the repository's exclude list", () => {
  const s = scratch();
  const top = path.join(s.dir, "top");
  mkdirSync(top, { recursive: true });
  git(top, s.answers, "init", "-q");
  const sub = path.join(top, "web");
  mkdirSync(sub, { recursive: true });
  writeFileSync(path.join(sub, "package.json"), "{}\n");
  const out = install(s, sub, "--checks", "yes");
  assert.equal(out.status, 0, out.stdout + out.stderr);
  const after = readFileSync(excludeFile(top), "utf8");
  assert.ok(after.split("\n").includes("web/.claude/settings.local.json"), after);
  assert.ok(after.includes("/web/design-canvas/\n"), "the canvas lines are anchored at the project's folder");
  assert.equal(ignored(s, sub), true);
  assert.deepEqual(both(readLocal(sub)), [2, 1]);
});

/* ------------------------------------------------------------------ check-install */

test("check-install fails when this machine's answer is yes and an entry is missing, and when git does not ignore the file", () => {
  const s = scratch();
  const repo = project(s);
  assert.equal(install(s, repo, "--checks", "yes").status, 0);
  const healthy = checkInstall(s, repo);
  assert.doesNotMatch(healthy.stdout, /reuse checks|hook entries/i, "with the entries in place and the file ignored it says nothing about them");

  writeLocal(repo, "{}\n");
  const missing = checkInstall(s, repo);
  assert.equal(missing.status, 1);
  assert.match(missing.stdout, /this machine's answer for this project is yes to the reuse checks, but \.claude\/settings\.local\.json has no PreToolUse entry for design-canvas\/hook\.mjs/);
  assert.match(missing.stdout, /has no Stop entry for design-canvas\/hook\.mjs/);

  assert.equal(install(s, repo).status, 0, "a run with no flag puts the entries back");
  writeFileSync(excludeFile(repo), "");
  const unignored = checkInstall(s, repo);
  assert.equal(unignored.status, 1);
  assert.match(unignored.stdout, /git does not ignore \.claude\/settings\.local\.json/);
});

test("check-install says nothing about the entries when there is no answer, or the answer is no, or the yes is another project's", () => {
  const s = scratch();
  const none = project(s, "none");
  assert.equal(install(s, none).status, 0);
  assert.doesNotMatch(checkInstall(s, none).stdout, /reuse checks|hook\.mjs|settings\.local/i);
  const no = project(s, "no");
  assert.equal(install(s, no, "--checks", "no").status, 0);
  assert.doesNotMatch(checkInstall(s, no).stdout, /reuse checks|hook\.mjs entry|settings\.local/i);
  const asked = project(s, "asked");
  assert.equal(install(s, asked, "--checks", "yes").status, 0);
  writeLocal(none, "{}\n");
  assert.doesNotMatch(checkInstall(s, none).stdout, /reuse checks/i);
});

/* ------------------------------------------------------------------ the wrapper */

/** Run the installed hook command the way Claude Code does: a shell, the project dir in the environment, a hook payload on stdin. */
function runWrapper(s, repo, { projectDir = repo } = {}) {
  const command = entriesOf(readLocal(repo), "PreToolUse")[0].hooks[0].command;
  return spawnSync("sh", ["-c", command], {
    cwd: repo,
    env: { ...envFor(s.answers), CLAUDE_PROJECT_DIR: projectDir },
    input: JSON.stringify({ tool_name: "Write", tool_input: { file_path: path.join(repo, "a.tsx"), content: "x" } }),
    encoding: "utf8",
  });
}

test("the wrapper exits 0 when the hook file is missing, and when it is broken, and says nothing on stderr", () => {
  const s = scratch();
  const repo = project(s);
  assert.equal(install(s, repo, "--checks", "yes").status, 0);
  const hookFile = path.join(repo, "design-canvas", "hook.mjs");

  /* A hook that really runs on the payload exits 0 as well. */
  const real = runWrapper(s, repo);
  assert.equal(real.status, 0, real.stderr);

  /* A hook with a missing import: node exits 1 before any handler of the hook's own exists. */
  writeFileSync(hookFile, 'import "./nothing-here.mjs";\nconsole.log("never");\n');
  const missingImport = runWrapper(s, repo);
  assert.equal(missingImport.status, 0);
  assert.equal(missingImport.stderr, "", "node's error noise is dropped");
  assert.equal(missingImport.stdout, "");

  /* A hook with a syntax error. */
  writeFileSync(hookFile, "const = ;\n");
  const syntax = runWrapper(s, repo);
  assert.equal(syntax.status, 0);
  assert.equal(syntax.stderr, "");

  /* No hook file at all (a checkout the canvas is not installed in), and a project dir that does not exist. */
  rmSync(hookFile);
  assert.equal(runWrapper(s, repo).status, 0);
  assert.equal(runWrapper(s, repo, { projectDir: path.join(s.dir, "does-not-exist") }).status, 0);
});

test("the wrapper still passes the hook's stdout through, and never lets its non-zero exit out", () => {
  const s = scratch();
  const repo = project(s);
  assert.equal(install(s, repo, "--checks", "yes").status, 0);
  writeFileSync(path.join(repo, "design-canvas", "hook.mjs"), 'process.stdout.write("refusal text");\nprocess.exit(3);\n');
  const out = runWrapper(s, repo);
  assert.equal(out.status, 0);
  assert.equal(out.stdout, "refusal text");
});

test("the wrapper ends in `node \"$f\" 2>/dev/null; exit 0`, with no exec", () => {
  const s = scratch();
  const repo = project(s);
  assert.equal(install(s, repo, "--checks", "yes").status, 0);
  const command = entriesOf(readLocal(repo), "PreToolUse")[0].hooks[0].command;
  assert.ok(command.includes('node "$f" 2>/dev/null; exit 0'), command);
  assert.ok(!command.includes("exec node"), command);
});
