/**
 * Tests for `tool/hook.mjs` as Claude Code runs it: the event on stdin, the answer on stdout.
 *
 *   node --test tool/tests/hook.test.mjs
 *
 * WHAT IS PROVEN HERE:
 *   - A missing reminders file never turns the push check off where only the hook guards the push.
 *   - After an agent edits a local line, the file is re-staged, so git does not call it modified and a pull from a terminal goes through.
 *   - An exploration's base follows the developers' commits however they arrived: a pull from a terminal, seen at the next git command
 *     or before the parity check runs; a merge that stopped on a conflict and was finished with git commit. The designer's own
 *     commits, pushed, never move it.
 *
 * Every repository is built in its own temp folder with the machine's global git config kept out of it: a bare remote, a
 * developer's clone, and a designer's clone with the canvas's tools in design-canvas/ and the overlay installed.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const TOOL = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const made = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});
const ENV = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" };
const git = (cwd, ...args) => execFileSync("git", ["-c", "commit.gpgsign=false", ...args], { cwd, env: ENV, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const tryGit = (cwd, ...args) => spawnSync("git", ["-c", "commit.gpgsign=false", ...args], { cwd, env: ENV, encoding: "utf8" });
const write = (repo, file, text) => {
  mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
  writeFileSync(path.join(repo, file), text);
};
const read = (repo, file) => readFileSync(path.join(repo, file), "utf8");

/** Remote, developer, and a designer whose canvas holds the tools and one real-code base at the clone's commit. */
function setup({ hooksPath = false } = {}) {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "canvas-hook-")));
  made.push(dir);
  git(dir, "init", "-q", "--bare", "-b", "main", "remote.git");
  const dev = path.join(dir, "developer");
  write(dev, "app/tasks/page.tsx", "export default function Page() {\n  return null;\n}\n");
  write(dev, "lib/data.ts", "export const trips = [];\nexport const count = 0;\n");
  git(dev, "init", "-q", "-b", "main");
  git(dev, "add", "-A");
  git(dev, "commit", "-qm", "project");
  git(dev, "remote", "add", "origin", "../remote.git");
  git(dev, "push", "-q", "-u", "origin", "main");
  git(dir, "clone", "-q", "remote.git", "designer");
  const des = path.join(dir, "designer");
  if (hooksPath) git(des, "config", "core.hooksPath", ".githooks");
  const canvasDir = path.join(des, "design-canvas");
  for (const name of readdirSync(TOOL).filter((one) => one.endsWith(".mjs"))) write(canvasDir, name, read(TOOL, name));
  write(des, ".git/info/exclude", "/design-canvas/\n");
  const installed = spawnSync(process.execPath, ["design-canvas/overlay.mjs", "install"], { cwd: des, env: ENV, encoding: "utf8" });
  assert.equal(installed.status, 0, installed.stderr);
  const base = git(des, "rev-parse", "HEAD");
  write(canvasDir, "shots/one/manifest.json", JSON.stringify({ shots: [], bases: { tasks: { exploration: "tasks", mode: "real-code", original: "tasks-today", commit: base, files: ["app/tasks/page.tsx"] } } }));
  return { dev, des, canvasDir, base };
}
const hook = (repo, event) => {
  const out = spawnSync(process.execPath, [path.join(repo, "design-canvas", "hook.mjs")], { cwd: repo, env: ENV, encoding: "utf8", input: JSON.stringify(event) });
  assert.equal(out.status, 0, out.stderr);
  return out.stdout === "" ? {} : JSON.parse(out.stdout).hookSpecificOutput;
};
const bash = (repo, event, command) => hook(repo, { hook_event_name: event, tool_name: "Bash", tool_input: { command } });
const baseOf = (canvasDir) => JSON.parse(read(canvasDir, "shots/one/manifest.json")).bases.tasks.commit;
/** The developer changes the original's file and pushes; returns the pushed commit. */
const developerChanges = (dev, text = "export default function Page() {\n  return 1;\n}\n") => {
  write(dev, "app/tasks/page.tsx", text);
  git(dev, "commit", "-qam", "change the page");
  git(dev, "push", "-q");
  return git(dev, "rev-parse", "HEAD");
};

test("a missing reminders file never turns off the push check where only the hook guards the push", () => {
  const { des } = setup({ hooksPath: true });
  write(des, "lib/data.ts", `import { CanvasStatePin } from "../design-canvas/project/canvas-state-pin";\n${read(des, "lib/data.ts")}`);
  git(des, "commit", "-qam", "slipped");
  rmSync(path.join(des, "design-canvas", "reminders.mjs"));
  const out = bash(des, "PreToolUse", "git push origin main");
  assert.equal(out.permissionDecision, "deny");
  assert.match(out.permissionDecisionReason, /push stopped, "lib\/data\.ts:1"/);
});

test("after an agent edits a local line, git does not call the file modified, and a pull from a terminal goes through", () => {
  const { dev, des } = setup();
  write(des, "lib/data.ts", `${read(des, "lib/data.ts")}export const pinned = "a"; // design-canvas:local\n`);
  bash(des, "PreToolUse", "git status");
  assert.equal(git(des, "status", "--porcelain"), "");
  write(des, "lib/data.ts", read(des, "lib/data.ts").replace('pinned = "a"', 'pinned = "a longer value"'));
  hook(des, { hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: path.join(des, "lib/data.ts") } });
  assert.equal(git(des, "status", "--porcelain"), "", "only the local line changed");
  write(dev, "lib/data.ts", `export const first = 1;\n${read(dev, "lib/data.ts")}`);
  git(dev, "commit", "-qam", "first");
  git(dev, "push", "-q");
  const pulled = tryGit(des, "pull", "--no-rebase", "origin", "main");
  assert.equal(pulled.status, 0, pulled.stderr);
  assert.equal(read(des, "lib/data.ts"), 'export const first = 1;\nexport const trips = [];\nexport const count = 0;\nexport const pinned = "a longer value"; // design-canvas:local\n');
});

test("a pull from a terminal: the next git command through the agent moves the base to the developers' commit", () => {
  const { dev, des, canvasDir } = setup();
  const tip = developerChanges(dev);
  git(des, "pull", "-q", "origin", "main");
  const said = bash(des, "PostToolUse", "git status");
  assert.match(said.additionalContext, new RegExp(`base of exploration "tasks" on one moved to ${tip.slice(0, 12)}`));
  assert.equal(baseOf(canvasDir), tip);
  assert.deepEqual(bash(des, "PostToolUse", "git status"), {}, "said once");
});

test("a pull from a terminal: the base moves before a canvas command that runs the parity check", () => {
  const { dev, des, canvasDir } = setup();
  const tip = developerChanges(dev);
  git(des, "pull", "-q", "origin", "main");
  const said = bash(des, "PreToolUse", "node design-canvas/parity.mjs --canvas one");
  assert.match(said.additionalContext, /base of exploration "tasks" on one moved/);
  assert.equal(baseOf(canvasDir), tip);
});

test("a merge that stopped on a conflict and was finished with git commit moves the base", () => {
  const { dev, des, canvasDir, base } = setup();
  write(des, "app/tasks/page.tsx", "export default function Page() {\n  return 'mine';\n}\n");
  git(des, "commit", "-qam", "mine");
  const tip = developerChanges(dev);
  bash(des, "PreToolUse", "git pull --no-rebase origin main");
  assert.notEqual(tryGit(des, "pull", "--no-rebase", "origin", "main").status, 0, "the pull stops on the conflict");
  bash(des, "PostToolUse", "git pull --no-rebase origin main");
  write(des, "app/tasks/page.tsx", "export default function Page() {\n  return 1;\n}\n");
  git(des, "add", "app/tasks/page.tsx");
  bash(des, "PreToolUse", "git commit --no-edit");
  git(des, "commit", "-q", "--no-edit");
  assert.equal(baseOf(canvasDir), base, "not moved before the merge is committed");
  const said = bash(des, "PostToolUse", "git commit --no-edit");
  assert.equal(baseOf(canvasDir), tip, said.additionalContext);
});

test("the designer's own commits, pushed, never move a base", () => {
  const { des, canvasDir, base } = setup();
  write(des, "app/tasks/page.tsx", "export default function Page() {\n  return 'folded';\n}\n");
  git(des, "commit", "-qam", "fold in");
  git(des, "push", "-q", "origin", "main");
  git(des, "pull", "-q", "origin", "main");
  assert.deepEqual(bash(des, "PostToolUse", "git push origin main"), {});
  assert.equal(baseOf(canvasDir), base);
});

/* ------------------------------------------------------------------ names in printed commands, and the parity records guard */

test("an exploration id or a canvas name that is not plain never reaches a printed command; it is shown quoted", () => {
  const { dev, des, canvasDir, base } = setup();
  const sly = 'tasks"; rm -rf ~; echo "';
  write(canvasDir, "shots/one/manifest.json", JSON.stringify({ shots: [], bases: { [sly]: { exploration: sly, mode: "real-code", commit: base, files: ["app/tasks/page.tsx"] } } }));
  write(canvasDir, "rounds/one/capture.lock", JSON.stringify({ pid: process.pid }));
  developerChanges(dev);
  git(des, "pull", "-q", "origin", "main");
  const said = bash(des, "PostToolUse", "git status").additionalContext;
  assert.match(said, /did not move because a capture of one is running/);
  assert.doesNotMatch(said, /--exploration/, "no command carries the id");
  assert.ok(said.includes(JSON.stringify(sly)), said);
  rmSync(path.join(canvasDir, "rounds/one/capture.lock"));
  write(canvasDir, "shots/one/manifest.json", JSON.stringify({ shots: [], bases: { plain_id: { exploration: "plain_id", mode: "real-code", commit: base, files: ["app/tasks/page.tsx"] } } }));
  write(canvasDir, "rounds/one/capture.lock", JSON.stringify({ pid: process.pid }));
  assert.match(bash(des, "PostToolUse", "git status").additionalContext, /node design-canvas\/parity\.mjs --canvas one --exploration plain_id --base [0-9a-f]{12}$/);
});

test("the early warning: a hand-written removal or simple mode is refused before the edit or the shell command, also through a link or another case", () => {
  const { des } = setup();
  const file = path.join(des, "design-canvas/project/parity-exceptions.json");
  const moved = { file: "app/tasks/page.tsx", kind: "handler", unit: "onClick", movedTo: "app/tasks/list.tsx:3", why: "moved" };
  write(des, "design-canvas/project/parity-exceptions.json", `${JSON.stringify([moved], null, 2)}\n`);
  const removal = { file: "app/tasks/page.tsx", kind: "condition", removed: "isAdmin", said: "drop it" };
  const edit = (tool_name, tool_input) => hook(des, { hook_event_name: "PreToolUse", tool_name, tool_input });
  const refused = (out) => out.permissionDecision === "deny" && /written only by node design-canvas\/parity\.mjs/.test(out.permissionDecisionReason);
  assert.ok(refused(edit("Write", { file_path: file, content: JSON.stringify([moved, removal]) })), "a Write that adds a removal");
  symlinkSync(path.join(des, "design-canvas/project"), path.join(des, "linked"));
  assert.ok(refused(edit("Write", { file_path: path.join(des, "linked/parity-exceptions.json"), content: JSON.stringify([removal]) })), "through a link");
  if (existsSync(path.join(des, "DESIGN-CANVAS")))
    assert.ok(refused(edit("Write", { file_path: path.join(des, "DESIGN-CANVAS/Project/Parity-Exceptions.json"), content: JSON.stringify([removal]) })), "under another case");
  assert.ok(refused(edit("Edit", { file_path: file, old_string: "\n]", new_string: `,\n  ${JSON.stringify(removal)}\n]` })), "an Edit that adds one");
  assert.deepEqual(edit("Write", { file_path: file, content: JSON.stringify([moved, { ...moved, unit: "onSubmit" }]) }), {}, "an exception with a place passes");
  assert.ok(refused(bash(des, "PreToolUse", `echo '${JSON.stringify([removal])}' > design-canvas/project/parity-exceptions.json`)), "a shell redirect");
  assert.ok(refused(bash(des, "PreToolUse", "python3 -c 'open(\"design-canvas/project/parity-exceptions.json\",\"w\")'")), "a script");
  assert.equal(bash(des, "PreToolUse", "cat design-canvas/project/parity-exceptions.json").permissionDecision, undefined, "reading passes");
  write(des, "design-canvas/project/flows.ts", 'export const explorations = [{ id: "tasks", original: "tasks-today" }];\n');
  const flows = path.join(des, "design-canvas/project/flows.ts");
  const simple = edit("Edit", { file_path: flows, old_string: 'original: "tasks-today" }', new_string: 'original: "tasks-today", mode: "simple" }' });
  assert.equal(simple.permissionDecision, "deny");
  assert.match(simple.permissionDecisionReason, /it needs the reviewer's words: record them with node design-canvas\/parity\.mjs/);
  assert.equal(bash(des, "PreToolUse", `sed -i '' 's/original: "tasks-today"/original: "tasks-today", mode: "simple"/' design-canvas/project/flows.ts`).permissionDecision, "deny");
  assert.deepEqual(edit("Edit", { file_path: flows, old_string: '"tasks-today"', new_string: '"tasks-now"' }), {}, "another edit of the declaration passes");
  assert.deepEqual(edit("Edit", { file_path: path.join(des, "lib/data.ts"), old_string: "count = 0", new_string: 'mode: "simple"' }), {}, "outside the canvas's project folder nothing is judged");
});
