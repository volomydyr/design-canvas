/**
 * One reading of a line for every path of the overlay (`lineKind` in tool/overlay.mjs). The same crafted inputs go through the filter,
 * the pre-commit backstop, the push scan, the hand-off collection and the install check, and they must agree: what the filter keeps
 * local the backstop keeps local too, nothing carrying either token reaches a push unrefused, a begin with no end stops the commit on
 * both paths, and only real hand-off lines are collected.
 *
 *   node --test tool/tests/overlay-parser.test.mjs
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const OVERLAY = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "overlay.mjs");
const { forbiddenIn, lineKind, splitLines, strip } = await import(OVERLAY);

const made = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});
const ENV = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" };
const git = (cwd, ...args) => execFileSync("git", ["-c", "commit.gpgsign=false", ...args], { cwd, env: ENV, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const run = (cwd, args) => spawnSync(args[0], args.slice(1), { cwd, env: ENV, encoding: "utf8" });
const write = (repo, file, text) => {
  mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
  writeFileSync(path.join(repo, file), text);
};
const call = (repo, name, args = []) =>
  JSON.parse(run(repo, [process.execPath, "--input-type=module", "-e", `import { ${name} } from ${JSON.stringify(OVERLAY)}; process.stdout.write(JSON.stringify(${name}(...${JSON.stringify(args)})));`]).stdout);

const TOKENS = /design-canvas:(?:local|handoff)/;
const LF = [
  ["a slash comment", "a();\nb(); // design-canvas:local\nc();\n"],
  ["a JSX comment", "<A />\n<B /> {/* design-canvas:local */}\n"],
  ["a hash comment", "x = 1\ny = 2 # design-canvas:local\n"],
  ["an HTML comment", "<p>a</p>\n<p>b</p> <!-- design-canvas:local -->\n"],
  ["a block comment with trailing spaces", "a();\nb(); /* design-canvas:local */   \n"],
  ["a marker followed by words", "a();\nb(); // design-canvas:local, for review\n"],
  ["a marker inside a string", 'const s = "design-canvas:local";\nconst t = 1;\n'],
  ["a markdown-style comment", "a\n[//]: # (design-canvas:local)\n"],
  ["a begin mentioned mid-line", "a(); // design-canvas:local begin of the list\nb\n"],
  ["a nested begin", "a\n// design-canvas:local begin\n// design-canvas:local begin\nx\n// design-canvas:local end\n// design-canvas:local end\nb\n"],
  ["a stray end", "a\n// design-canvas:local end\nb\n"],
  ["an unclosed begin", "a\n// design-canvas:local begin\nb\n"],
  ["hand-off lines in odd syntax", "a\n  * design-canvas:handoff: wire it, because static\nb(); // design-canvas:handoff not a hand-off line\n"],
];
const CASES = [...LF, ...LF.map(([name, text]) => [`${name}, CRLF`, text.replace(/\n/g, "\r\n")])];

test("pure: every line the filter keeps local is a marker line, and every line carrying a token is refused by the push scan", () => {
  for (const [name, text] of CASES) {
    const { overlay, lines } = strip(text);
    lines.forEach((line, at) => {
      if (TOKENS.test(line)) assert.ok(forbiddenIn("app/[id]/page.tsx", line), `${name}: line ${at + 1} would be pushed: ${JSON.stringify(line)}`);
      if (overlay[at] && lineKind(line) === null) {
        /* A plain line is kept local only inside a block. */
        assert.ok(lines.slice(0, at).some((one) => lineKind(one) === "begin"), `${name}: line ${at + 1} kept local outside a block`);
      }
    });
    for (const line of splitLines(text)) if (lineKind(line) === "mention") assert.equal(overlay[lines.indexOf(line)], false, `${name}: a mention is ordinary text`);
  }
});

test("in a repository: the filter and the backstop keep the same lines, unclosed blocks stop both, and nothing with a token is pushed unrefused", () => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "canvas-overlay-parser-")));
  made.push(dir);
  git(dir, "init", "-q", "--bare", "-b", "main", "remote.git");
  const repo = path.join(dir, "designer");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  write(repo, "README", "x\n");
  CASES.forEach((_, at) => {
    write(repo, `app/[id]/case-${at}.tsx`, "a\n");
    write(repo, `lib/case-${at}.ts`, "a\n");
  });
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "files");
  git(repo, "remote", "add", "origin", "../remote.git");
  git(repo, "push", "-q", "-u", "origin", "main");
  write(repo, "design-canvas/overlay.mjs", readFileSync(OVERLAY, "utf8"));
  write(repo, ".git/info/exclude", "/design-canvas/\n");
  assert.equal(run(repo, [process.execPath, "design-canvas/overlay.mjs", "install"]).status, 0);

  const cases = CASES.map(([name, text], at) => ({ name, text, viaFilter: `app/[id]/case-${at}.tsx`, viaBackstop: `lib/case-${at}.ts`, ...strip(text) }));
  /* An unclosed begin, on each path: the commit is stopped. */
  for (const one of cases.filter((each) => each.unclosed)) {
    write(repo, one.viaFilter, one.text);
    call(repo, "sync");
    git(repo, "add", "--", one.viaFilter);
    assert.notEqual(run(repo, ["git", "commit", "-qm", "filter"]).status, 0, `${one.name}: the filter path commits an unclosed block`);
    git(repo, "reset", "-q", "--", one.viaFilter);
    write(repo, one.viaFilter, "a\n");
    write(repo, one.viaBackstop, one.text);
    git(repo, "add", "--", one.viaBackstop);
    assert.notEqual(run(repo, ["git", "commit", "-qm", "backstop"]).status, 0, `${one.name}: the backstop path commits an unclosed block`);
    git(repo, "reset", "-q", "--", one.viaBackstop);
    write(repo, one.viaBackstop, "a\n");
  }
  const rest = cases.filter((each) => !each.unclosed);
  /* The filter path: the agent hook registers the files before git reads them. */
  for (const one of rest) write(repo, one.viaFilter, one.text);
  call(repo, "sync");
  git(repo, "add", "--", ...rest.map((one) => one.viaFilter));
  const filtered = run(repo, ["git", "commit", "-qm", "filter"]);
  assert.equal(filtered.status, 0, filtered.stderr);
  /* The backstop path: the files are staged before anything registers them. */
  for (const one of rest) write(repo, one.viaBackstop, one.text);
  git(repo, "add", "--", ...rest.map((one) => one.viaBackstop));
  const backstopped = run(repo, ["git", "commit", "-qm", "backstop"]);
  assert.equal(backstopped.status, 0, backstopped.stderr);
  for (const one of rest) {
    assert.equal(git(repo, "show", `HEAD~1:${one.viaFilter}`), one.keep, `${one.name}: the filter path committed something else`);
    assert.equal(git(repo, "show", `HEAD:${one.viaBackstop}`), one.keep, `${one.name}: the backstop path committed something else`);
  }
  /* Whatever reached the commits, the push scan refuses every file with a token line in it, and only those. */
  const flagged = call(repo, "pushScan", [git(repo, "rev-list", "-2", "HEAD").trim().split("\n")]).problems.map((one) => one.file).sort();
  const expected = rest.filter((one) => splitLines(one.keep).some((line) => TOKENS.test(line))).flatMap((one) => [one.viaFilter, one.viaBackstop]).sort();
  assert.ok(expected.length > 0);
  assert.deepEqual(flagged, expected);

  /* The install check names the same mention lines before they are committed. */
  write(repo, "lib/pending.ts", "a\nb(); // design-canvas:local, for review\n");
  git(repo, "add", "lib/pending.ts");
  git(repo, "commit", "-qm", "pending", "--no-verify");
  write(repo, "lib/pending.ts", "a\nb(); // design-canvas:local, for review\nc(); // design-canvas:local and more\n");
  const failures = call(repo, "overlayProblems").failures;
  assert.ok(failures.some((one) => one.includes('"lib/pending.ts:3"') && one.includes("does not end its line")), failures.join("\n"));

  /* The hand-off collection takes only real hand-off lines, and the push the remote never received is refused. */
  const taken = call(repo, "takeHandoffs").map((one) => one.text);
  assert.deepEqual([...new Set(taken)], ["wire it, because static"]);
  const pushed = run(repo, ["git", "push", "origin", "main"]);
  assert.notEqual(pushed.status, 0, "commits with mention lines are refused");
  assert.doesNotMatch(execFileSync("git", ["--git-dir", path.join(dir, "remote.git"), "log", "--all", "-p", "--format="], { env: ENV, encoding: "utf8" }), TOKENS);
});
