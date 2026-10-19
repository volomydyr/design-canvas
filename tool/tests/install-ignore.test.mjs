/**
 * Tests for how the installer and `check-install.mjs` treat the scratch of a canvas SHARED through git (comments, the saved session,
 * share pages, rounds): git is ASKED whether it ignores each path, through any source, and the `.gitignore` text is not trusted.
 *
 *   - A project that keeps canvas files local through its own exclude list (so canvas mechanics never travel to
 *     the team) has its `.gitignore` left byte for byte alone, and one line names what git does not ignore yet and the file to add it to.
 *   - A plain project gets the lines appended, only the ones git still misses, and not twice.
 *   - `check-install.mjs` passes the ignore claim for paths git ignores through an exclude list or a global file, and names the one
 *     that is missing otherwise.
 *   - What a teammate needs to see the same canvas (the core, the declaration, the pictures and manifests, the Design System tab's
 *     pictures, the routes) fails the check when a `.gitignore` hides it, and is a note when the exclude list keeps it local; what
 *     is not committed yet is a note.
 *   - Outside a git checkout both do what they always did, by reading the file.
 *
 *   node --test tool/tests/install-ignore.test.mjs
 *
 * Every test builds throwaway projects in its own temp folder, with the machine's global git config and global ignore file kept out
 * of it (see `envFor`), so nothing on the machine that runs the tests can hide a case. No project here has a declaration, so the
 * installer's declaration checks (which need esbuild) have nothing to read and no CANVAS_TEST_PROJECT is needed.
 *
 * NOT INSTALLED into a project: the installer copies only the files it lists.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.join(HERE, "..", "..");
const INSTALLER = path.join(SKILL, "scripts", "install-canvas.mjs");
const CHECKER = path.join(SKILL, "scripts", "check-install.mjs");

/** The five lines the installer maintains, as a project that keeps canvas files local writes them into its exclude list. */
const ALL_LINES = [
  "design-canvas/comments/",
  "design-canvas/comments.json",
  "design-canvas/auth-state.json",
  "design-canvas/review/*/",
  "design-canvas/rounds/",
];

const made = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** One scratch folder per test: the projects live under it, and so does that test's own answers file. */
function scratch() {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "canvas-install-ignore-")));
  made.push(dir);
  return { dir, answers: path.join(dir, "answers.json") };
}

/* GIT_CONFIG_GLOBAL=/dev/null drops the global git config, and XDG_CONFIG_HOME points the default global ignore file
   (`~/.config/git/ignore`) into the test's own folder, so this machine's ignore rules cannot cover a case. */
const envFor = (answers) => ({
  ...process.env,
  CANVAS_ANSWERS_FILE: answers,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  XDG_CONFIG_HOME: path.join(path.dirname(answers), "xdg-config-home"),
});

const git = (cwd, s, ...args) =>
  execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args], {
    cwd,
    env: envFor(s.answers),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

/** A project folder with a package.json (the installer's one requirement); a git checkout unless `git: false`. */
function project(s, name = "repo", { git: asGit = true } = {}) {
  const repo = path.join(s.dir, name);
  mkdirSync(repo, { recursive: true });
  writeFileSync(path.join(repo, "package.json"), "{}\n");
  if (asGit) git(repo, s, "init", "-q");
  return repo;
}

/* These tests are about a canvas shared through git (`--share`), where the scratch lines and the sharing checks apply; a local canvas,
   the default, is excluded whole (install-overlay.test.mjs). */
const install = (s, repo) => spawnSync(process.execPath, [INSTALLER, "--target", repo, "--share"], { cwd: repo, env: envFor(s.answers), encoding: "utf8" });
const checkInstall = (s, repo) => spawnSync(process.execPath, [CHECKER, "--target", repo], { cwd: repo, env: envFor(s.answers), encoding: "utf8" });
const excludeFile = (repo) => path.join(repo, ".git", "info", "exclude");
const writeExclude = (repo, lines) => {
  mkdirSync(path.dirname(excludeFile(repo)), { recursive: true });
  writeFileSync(excludeFile(repo), `${lines.join("\n")}\n`);
};
const gitignoreOf = (repo) => (existsSync(path.join(repo, ".gitignore")) ? readFileSync(path.join(repo, ".gitignore"), "utf8") : null);
const ignoredByGit = (s, repo, probe) => spawnSync("git", ["-C", repo, "check-ignore", "-q", "--no-index", probe], { env: envFor(s.answers) }).status === 0;
const ignoreLine = (out) => out.split("\n").find((line) => line.startsWith("Ignore rules:")) ?? null;

/* ------------------------------------------------------------------ the installer */

test("a project that keeps canvas files local, with every path covered by its exclude list, has no .gitignore written and nothing said", () => {
  const s = scratch();
  const repo = project(s);
  writeExclude(repo, ALL_LINES);
  const result = install(s, repo);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(gitignoreOf(repo), null, "no .gitignore was created: git already ignores everything");
  assert.equal(ignoreLine(result.stdout), null, "and nothing needs saying");
  assert.ok(!/wrote\s+\.gitignore/.test(result.stdout));
});

test("an existing tracked .gitignore is byte for byte what it was, in a project that keeps canvas files local", () => {
  const s = scratch();
  const repo = project(s);
  const original = "node_modules/\n.next/\n";
  writeFileSync(path.join(repo, ".gitignore"), original);
  writeExclude(repo, ALL_LINES);
  const result = install(s, repo);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(gitignoreOf(repo), original, "left alone, whatever its text lacks");
});

test("a project that keeps canvas files local and misses some paths is told which, in one line naming the exclude file, and .gitignore is never touched", () => {
  const s = scratch();
  const repo = project(s);
  const original = "node_modules/\n";
  writeFileSync(path.join(repo, ".gitignore"), original);
  /* Covered: the comments and the session. Not covered: the share pages and the rounds. */
  writeExclude(repo, ["design-canvas/comments/", "design-canvas/comments.json", "design-canvas/auth-state.json"]);
  const result = install(s, repo);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(gitignoreOf(repo), original, ".gitignore is never touched in such a project");
  const said = ignoreLine(result.stdout);
  assert.ok(said, `one line says what to do:\n${result.stdout}`);
  assert.match(said, new RegExp(`through ${excludeFile(repo).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`), "it names the exclude file that already ignores the others");
  assert.match(said, /git does not ignore design-canvas\/review\/x\/y, design-canvas\/rounds\/x yet: add design-canvas\/review\/\*\/, design-canvas\/rounds\/ to that file/);
  assert.equal(said.split("\n").length, 1, "one line");
  /* Adding the lines where it said is all it takes: git then ignores every path, and a second install has nothing to say. */
  writeExclude(repo, [...readFileSync(excludeFile(repo), "utf8").split("\n").filter(Boolean), "design-canvas/review/*/", "design-canvas/rounds/"]);
  for (const line of ALL_LINES) assert.ok(ignoredByGit(s, repo, line.replace("*", "x").replace(/\/$/, "/x")), `${line} is ignored now`);
  const again = install(s, repo);
  assert.equal(ignoreLine(again.stdout), null);
  assert.equal(gitignoreOf(repo), original);
});

test("a global excludes file counts as a source that keeps canvas files local: it is named, and .gitignore is not touched", () => {
  const s = scratch();
  const repo = project(s);
  const global = path.join(s.dir, "my-global-ignore");
  writeFileSync(global, "design-canvas/comments/\ndesign-canvas/comments.json\n");
  git(repo, s, "config", "core.excludesFile", global);
  const result = install(s, repo);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(gitignoreOf(repo), null, "no .gitignore was created");
  assert.match(ignoreLine(result.stdout) ?? "", new RegExp(`through ${global.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
});

test("a project in a folder of a repository is told the lines with the folder in front, because an exclude pattern with a slash is anchored at the top", () => {
  const s = scratch();
  const top = project(s, "mono");
  const sub = path.join(top, "web");
  mkdirSync(sub, { recursive: true });
  writeFileSync(path.join(sub, "package.json"), "{}\n");
  writeExclude(top, ["web/design-canvas/comments/", "web/design-canvas/comments.json"]);
  const result = install(s, sub);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(gitignoreOf(sub), null);
  const said = ignoreLine(result.stdout) ?? "";
  assert.match(said, /add web\/design-canvas\/auth-state\.json, web\/design-canvas\/review\/\*\/, web\/design-canvas\/rounds\/ to that file/);
});

test("a plain project gets the lines appended once, and a second install adds nothing", () => {
  const s = scratch();
  const repo = project(s);
  const first = install(s, repo);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /wrote\s+\.gitignore/);
  assert.equal(ignoreLine(first.stdout), null);
  const text = gitignoreOf(repo);
  for (const line of ALL_LINES) assert.equal(text.split("\n").filter((one) => one === line).length, 1, `${line} once`);
  for (const line of ALL_LINES) assert.ok(ignoredByGit(s, repo, line.replace("*", "x").replace(/\/$/, "/x")));
  const second = install(s, repo);
  assert.doesNotMatch(second.stdout, /wrote\s+\.gitignore/);
  assert.equal(gitignoreOf(repo), text, "byte for byte");
});

test("a project that already ignores some of it through .gitignore gets only the lines git still misses", () => {
  const s = scratch();
  const repo = project(s);
  writeFileSync(path.join(repo, ".gitignore"), "node_modules/\ndesign-canvas/comments/\ndesign-canvas/comments.json\n");
  const result = install(s, repo);
  assert.equal(result.status, 0, result.stderr);
  const text = gitignoreOf(repo);
  assert.equal(text.split("\n").filter((one) => one === "design-canvas/comments/").length, 1, "not said twice");
  for (const line of ["design-canvas/auth-state.json", "design-canvas/review/*/", "design-canvas/rounds/"]) assert.ok(text.includes(`${line}\n`), `${line} added`);
  assert.equal(ignoreLine(result.stdout), null, "a project that ignores through .gitignore is not told anything: its file is simply completed");
});

test("outside a git checkout the installer reads the file, as it always did", () => {
  const s = scratch();
  const folder = project(s, "plain", { git: false });
  const first = install(s, folder);
  assert.equal(first.status, 0, first.stderr);
  const text = gitignoreOf(folder);
  for (const line of ALL_LINES) assert.ok(text.includes(`${line}\n`), `${line} appended`);
  const second = install(s, folder);
  assert.equal(gitignoreOf(folder), text, "and nothing twice");
});

/* ------------------------------------------------------------------ check-install */

const ignoreFailures = (out) => out.split("\n").filter((line) => /does not ignore/.test(line));

test("check-install passes the ignore claim for paths git ignores through the exclude list, and names the one that is missing otherwise", () => {
  const s = scratch();
  const repo = project(s);
  writeExclude(repo, ALL_LINES);
  assert.equal(install(s, repo).status, 0);
  const covered = checkInstall(s, repo);
  assert.deepEqual(ignoreFailures(`${covered.stdout}${covered.stderr}`), [], "paths ignored through an exclude list are ignored");

  /* One path short: the comments directory. git no longer ignores design-canvas/comments/x, and that is named. */
  writeExclude(repo, ALL_LINES.filter((line) => line !== "design-canvas/comments/"));
  const short = checkInstall(s, repo);
  const failures = ignoreFailures(`${short.stdout}${short.stderr}`);
  assert.equal(failures.length, 1, `${short.stdout}${short.stderr}`);
  assert.match(failures[0], /git does not ignore design-canvas\/comments\/x \(the reviewer's comments\): add design-canvas\/comments\/ to \.gitignore/);
  assert.match(failures[0], /or to this repository's exclude list when the project keeps canvas files local/);
  assert.equal(short.status, 1);

  /* And the comments file and the saved session: every path of the claim is asked. */
  writeExclude(repo, []);
  const none = checkInstall(s, repo);
  assert.equal(ignoreFailures(`${none.stdout}${none.stderr}`).length, 3);
});

test("check-install passes for paths a global excludes file ignores, and for a plain project's own .gitignore", () => {
  const s = scratch();
  const viaGlobal = project(s, "global");
  const global = path.join(s.dir, "global-ignore");
  writeFileSync(global, "design-canvas/comments/\ndesign-canvas/comments.json\ndesign-canvas/auth-state.json\n");
  git(viaGlobal, s, "config", "core.excludesFile", global);
  install(s, viaGlobal);
  const one = checkInstall(s, viaGlobal);
  assert.deepEqual(ignoreFailures(`${one.stdout}${one.stderr}`), []);

  const plain = project(s, "plain");
  install(s, plain);
  const two = checkInstall(s, plain);
  assert.deepEqual(ignoreFailures(`${two.stdout}${two.stderr}`), []);
});

test("a project that ignores design-canvas/shots/ through .gitignore fails, and through its exclude list gets a note naming the file", () => {
  const s = scratch();
  const viaFile = project(s, "file");
  install(s, viaFile);
  writeFileSync(path.join(viaFile, ".gitignore"), `${gitignoreOf(viaFile)}design-canvas/shots/\n`);
  const failed = checkInstall(s, viaFile);
  assert.equal(failed.status, 1);
  assert.match(
    failed.stdout + failed.stderr,
    /git ignores design-canvas\/shots\/x\/x\.webp \(the captured screens\) through \.gitignore:\d+: design-canvas\/shots\/, so a teammate who clones or pulls does not get it/,
  );
  assert.match(failed.stdout + failed.stderr, /move it to the repository's exclude list to keep it local on purpose/);

  const viaExclude = project(s, "exclude");
  writeExclude(viaExclude, [...ALL_LINES, "design-canvas/shots/"]);
  install(s, viaExclude);
  const noted = checkInstall(s, viaExclude);
  assert.doesNotMatch(noted.stdout + noted.stderr, /git ignores/, "the exclude list is the project's choice, never a failure");
  assert.match(noted.stdout + noted.stderr, new RegExp(`kept local through ${excludeFile(viaExclude).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}: the captured screens, the capture manifest, the Design System tab's pictures`));

  const clean = project(s, "clean");
  install(s, clean);
  const none = checkInstall(s, clean);
  assert.doesNotMatch(none.stdout + none.stderr, /git ignores|kept local through/, "the installer's own lines never hide what a teammate needs");
});

test("a broad project rule that hides canvas pictures is caught by the file types the tools write", () => {
  const s = scratch();
  const repo = project(s);
  install(s, repo);
  writeFileSync(path.join(repo, ".gitignore"), `${gitignoreOf(repo)}*.png\n`);
  const result = checkInstall(s, repo);
  const out = result.stdout + result.stderr;
  assert.equal(result.status, 1);
  assert.match(out, /git ignores design-canvas\/shots\/_system\/x\/x\.png \(the Design System tab's pictures\) through \.gitignore:\d+: \*\.png/);
  assert.match(out, /git ignores design-canvas\/evidence\/x\/x\.png \(the evidence screenshots\)/);
  assert.doesNotMatch(out, /git ignores design-canvas\/shots\/x\/x\.webp/, "the webp screens are not covered by that rule");
});

test("check-install fails when the saved session is not ignored, because it holds live tokens", () => {
  const s = scratch();
  const repo = project(s);
  writeExclude(repo, ALL_LINES.filter((line) => line !== "design-canvas/auth-state.json"));
  install(s, repo);
  const result = checkInstall(s, repo);
  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /git does not ignore design-canvas\/auth-state\.json \(the saved login session, which holds live tokens\)/);
});

test("check-install says which canvas files are not committed: changed, new, and skipped by git", () => {
  const s = scratch();
  const repo = project(s);
  install(s, repo);
  const pending = (out) => out.split("\n").find((line) => line.includes("canvas files not committed")) ?? null;
  const first = checkInstall(s, repo);
  assert.match(pending(first.stdout + first.stderr) ?? "", /canvas files not committed: \d+ new\. A teammate who pulls sees the canvas as last committed/);

  git(repo, s, "add", "-A");
  git(repo, s, "commit", "-q", "-m", "canvas");
  const committed = checkInstall(s, repo);
  assert.equal(pending(committed.stdout + committed.stderr), null, "nothing to say once it is all committed");

  writeFileSync(path.join(repo, "design-canvas", "README.md"), `${readFileSync(path.join(repo, "design-canvas", "README.md"), "utf8")}\nedited\n`);
  mkdirSync(path.join(repo, "design-canvas", "shots", "main"), { recursive: true });
  writeFileSync(path.join(repo, "design-canvas", "shots", "main", "home.webp"), "x");
  /* The comments are ignored, so they are never reported as uncommitted. */
  mkdirSync(path.join(repo, "design-canvas", "comments"), { recursive: true });
  writeFileSync(path.join(repo, "design-canvas", "comments", "main.json"), "{}");
  git(repo, s, "update-index", "--skip-worktree", "design-canvas/project/flows.ts");
  const dirty = pending(checkInstall(s, repo).stdout) ?? "";
  assert.match(dirty, /canvas files not committed: 1 changed, 1 new, /, dirty);
  assert.match(dirty, /\b1 that git is told to skip \(design-canvas\/project\/flows\.ts\)/);
});

/* ------------------------------------------------------------------ the decision, as a pure function */

test("sharingProblems: a shared path ignored through .gitignore fails, through anything else is one note per source, and not ignored is silence", async () => {
  const { SHARED, sharingProblems } = await import(path.join(SKILL, "scripts", "ignore-rules.mjs"));
  const answer = (over) => ({
    git: true,
    prefix: "",
    rules: [],
    shared: SHARED.map((one) => ({ ...one, ignored: false, source: null, pattern: null, viaGitignore: false, ...(over[one.probe] ?? {}) })),
  });
  assert.deepEqual(sharingProblems(answer({})), { failures: [], notes: [] });
  assert.deepEqual(sharingProblems({ git: false }), { failures: [], notes: [] });

  const viaGitignore = { ignored: true, source: "/r/.gitignore", pattern: ".gitignore:4: *.png", viaGitignore: true };
  const one = sharingProblems(answer({ "design-canvas/shots/_system/x/x.png": viaGitignore }));
  assert.equal(one.failures.length, 1);
  assert.match(one.failures[0], /^git ignores design-canvas\/shots\/_system\/x\/x\.png \(the Design System tab's pictures\) through \.gitignore:4: \*\.png/);
  assert.deepEqual(one.notes, []);

  const local = (source) => ({ ignored: true, source, pattern: `${source}:1: x`, viaGitignore: false });
  const two = sharingProblems(
    answer({
      "design-canvas/shots/x/x.webp": local("/r/.git/info/exclude"),
      "design-canvas/shots/x/manifest.json": local("/r/.git/info/exclude"),
      "design-canvas/settings.json": local("/home/global-ignore"),
    }),
  );
  assert.deepEqual(two.failures, []);
  assert.deepEqual(two.notes, [
    "kept local through /r/.git/info/exclude: the captured screens, the capture manifest. A teammate who clones the project does not get them",
    "kept local through /home/global-ignore: the tools' settings. A teammate who clones the project does not get them",
  ]);

  /* A project in a folder of a repository is named with the folder in front. */
  const nested = sharingProblems({ ...answer({ "design-canvas/project/flows.ts": viaGitignore }), prefix: "web/" });
  assert.match(nested.failures[0], /^git ignores web\/design-canvas\/project\/flows\.ts \(the declaration\)/);
});

test("no line the installer writes covers a path a teammate needs", async () => {
  const { IGNORE_RULES, SHARED } = await import(path.join(SKILL, "scripts", "ignore-rules.mjs"));
  const s = scratch();
  const repo = project(s);
  writeFileSync(path.join(repo, ".gitignore"), `${IGNORE_RULES.map((rule) => rule.line).join("\n")}\n`);
  for (const one of SHARED) assert.equal(ignoredByGit(s, repo, one.probe), false, `${one.probe} stays committed`);
  for (const rule of IGNORE_RULES) assert.equal(ignoredByGit(s, repo, rule.probe), true, `${rule.probe} stays local`);
});

test("outside a git checkout check-install reads the file, as it always did", () => {
  const s = scratch();
  const folder = project(s, "plain", { git: false });
  install(s, folder);
  assert.deepEqual(ignoreFailures((([r]) => `${r.stdout}${r.stderr}`)([checkInstall(s, folder)])), []);
  writeFileSync(path.join(folder, ".gitignore"), "node_modules/\n");
  const failing = checkInstall(s, folder);
  assert.match(failing.stdout + failing.stderr, /\.gitignore does not ignore design-canvas\/comments\//);
});

test("the route stubs land in src/app when the project keeps its App Router there, one folder deeper, and in app byte for byte otherwise", async () => {
  const s = scratch();
  const { withCanvasCss } = await import(path.join(SKILL, "scripts", "seams.mjs"));
  /* The two canvas pages import the prebuilt stylesheet in every project, Tailwind or not; the other stubs are copied as they are. */
  const stub = (name) => {
    const text = readFileSync(path.join(SKILL, "stubs", name), "utf8");
    return /^app-design-canvas-(slug-)?page\.tsx$/.test(name) ? withCanvasCss(text) : text;
  };
  const tailwind = (repo) => writeFileSync(path.join(repo, "package.json"), `{ "devDependencies": { "tailwindcss": "^3.4.0" } }\n`);
  const rooted = project(s, "rooted");
  tailwind(rooted);
  install(s, rooted);
  assert.equal(readFileSync(path.join(rooted, "app/design-canvas/page.tsx"), "utf8"), stub("app-design-canvas-page.tsx"));
  assert.equal(readFileSync(path.join(rooted, "app/api/design-canvas/shots/route.ts"), "utf8"), stub("app-api-canvas-shots-route.ts"));

  const nested = project(s, "nested");
  tailwind(nested);
  mkdirSync(path.join(nested, "src", "app"), { recursive: true });
  writeFileSync(path.join(nested, "src", "app", "layout.tsx"), "export default function Layout({ children }) {\n  return children;\n}\n");
  const result = install(s, nested);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(path.join(nested, "app")), false, "no root app folder, which would hide every page in src/app");
  for (const [name, to] of [
    ["app-design-canvas-page.tsx", "src/app/design-canvas/page.tsx"],
    ["app-design-canvas-slug-page.tsx", "src/app/design-canvas/[canvas]/page.tsx"],
    ["app-design-canvas-system-page.tsx", "src/app/design-canvas/system/[set]/page.tsx"],
    ["app-api-canvas-comments-route.ts", "src/app/api/design-canvas/comments/route.ts"],
    ["app-api-canvas-shots-route.ts", "src/app/api/design-canvas/shots/route.ts"],
  ])
    assert.equal(readFileSync(path.join(nested, to), "utf8"), stub(name).replace(/(from |import )"\.\.\//g, '$1"../../'), to);
  assert.match(readFileSync(path.join(nested, "src/app/design-canvas/page.tsx"), "utf8"), /from "\.\.\/\.\.\/\.\.\/design-canvas\/canvas-page"/);
  const checked = checkInstall(s, nested);
  assert.doesNotMatch(checked.stdout, /page\.tsx is missing|route\.ts is missing/);
  rmSync(path.join(nested, "src/app/api/design-canvas/shots/route.ts"));
  assert.match(checkInstall(s, nested).stdout, /- src\/app\/api\/design-canvas\/shots\/route\.ts is missing/, "a missing stub is named where it belongs");
  assert.match(checked.stdout, /git add design-canvas src\/app\/design-canvas src\/app\/api\/design-canvas/);
});
