/**
 * design-canvas — WHAT GIT IGNORES OF THE CANVAS'S SCRATCH, asked of git and never read off a file.
 *
 * WHY THIS EXISTS. The installer appended its ignore lines to the project's TRACKED `.gitignore`, and `check-install.mjs` read
 * only that file. A project that keeps canvas files local through its own exclude list (`.git/info/exclude`, or a global excludes
 * file, because canvas mechanics must not travel to the team) was written into against its wish, by the
 * installer, and then failed `.gitignore does not ignore design-canvas/comments/` for paths that git was in fact ignoring. Whether a
 * path is ignored is git's to say, from whichever source it reads: `git check-ignore` answers it, with the source file and the
 * pattern, and that answer is what both scripts use, so the installer and the check cannot disagree about it.
 *
 * THE QUESTION IS ASKED OF PATHS, NOT OF PATTERNS: a sample file under each ignored folder (`design-canvas/comments/x`,
 * `design-canvas/review/x/y`), because the lines the installer writes are patterns (`design-canvas/review/*` and a slash) and a
 * project may cover the same files with different ones. `--no-index` asks about the patterns alone, so a file somebody once
 * committed does not read as "not ignored". With `-v` git names the source of each answer, which is how the two kinds of project
 * are told apart: an ignore through a `.gitignore` is the tracked kind, anything else (the repository's exclude list, a global
 * file) is the kind that keeps canvas files local.
 *
 * NOT A GIT CHECKOUT: `askGit` says so and the callers do what they always did, by reading the lines of `.gitignore`.
 *
 * A LOCAL CANVAS, the default (`canvasMode`), is excluded whole through the repository's exclude list, so its scratch is ignored with
 * it and `.gitignore` is never written. The scratch lines below matter for a canvas that is shared through git.
 *
 * DELETE WITH: the design-canvas/ folder's installer.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * What the installer ignores, as the line it writes and a path that line must cover. `what` says in words what the path is, for the
 * failure that names it.
 */
export const IGNORE_RULES = [
  { line: "design-canvas/comments/", probe: "design-canvas/comments/x", what: "the reviewer's comments" },
  { line: "design-canvas/comments.json", probe: "design-canvas/comments.json", what: "the reviewer's comments file" },
  { line: "design-canvas/auth-state.json", probe: "design-canvas/auth-state.json", what: "the saved login session, which holds live tokens" },
  { line: "design-canvas/review/*/", probe: "design-canvas/review/x/y", what: "the share pages built for the team" },
  { line: "design-canvas/rounds/", probe: "design-canvas/rounds/x", what: "what a round leaves behind" },
];

/**
 * What a teammate needs to open the same canvas, as a path each, with the file types the tools really write (a project rule such as
 * `*.png` or `shots/` hides pictures as surely as a canvas line does). A local canvas (the default, `canvasMode`) keeps every one of
 * them out of git, and `check-install.mjs` fails one that git would take (`localProblems`). A shared canvas commits them: ignored
 * through a `.gitignore`, which every clone shares, it is a canvas that only the person who captured it can see, and the check fails;
 * ignored through the repository's exclude list or a global file, it is that checkout's choice, and the check says so.
 */
export const SHARED = [
  { probe: "design-canvas/core/canvas-view.tsx", what: "the canvas itself" },
  { probe: "design-canvas/project/flows.ts", what: "the declaration" },
  { probe: "design-canvas/shots/x/x.webp", what: "the captured screens" },
  { probe: "design-canvas/shots/x/manifest.json", what: "the capture manifest" },
  { probe: "design-canvas/shots/_system/x/x.png", what: "the Design System tab's pictures" },
  { probe: "design-canvas/evidence/x/x.png", what: "the evidence screenshots" },
  { probe: "design-canvas/settings.json", what: "the tools' settings" },
  { probe: "design-canvas/review/page.html", what: "the share page template" },
  { probe: "app/design-canvas/x/page.tsx", what: "the canvas routes" },
  { probe: "app/api/design-canvas/x/route.ts", what: "the canvas endpoints" },
];

/** The names in a folder, hidden ones left out. */
const namesIn = (dir) => readdirSync(dir).filter((name) => !name.startsWith("."));
/**
 * A root `app` that holds nothing but the canvas's own routes, beside a `src/app` that holds the project's pages: what an older
 * install wrote into a `src/app` project. Next serves the root `app` and ignores `src/app`, so the whole product disappears.
 */
export const canvasOnlyRootApp = (target) => {
  const root = path.join(target, "app");
  if (!existsSync(path.join(target, "src", "app")) || !existsSync(root)) return false;
  const api = path.join(root, "api");
  return namesIn(root).every((name) => name === "design-canvas" || name === "api") && (!existsSync(api) || namesIn(api).every((name) => name === "design-canvas"));
};
/**
 * The project's App Router folder: `src/app` when the project keeps it there and has no root `app` of its own (Next ignores
 * `src/app` when a root `app` exists), else `app`. The route stubs go in it, and the paths below that name `app/` are read inside it.
 */
export const appDir = (target) =>
  existsSync(path.join(target, "src", "app")) && (!existsSync(path.join(target, "app")) || canvasOnlyRootApp(target)) ? "src/app" : "app";
/** A path written for a root `app/`, moved into the project's own App Router folder. */
const inApp = (target, rel) => rel.replace(/^app\//, `${appDir(target)}/`);

/** Where the canvas's files are, for the question of what this checkout has not committed. */
export const canvasPaths = (target) => ["design-canvas", "app/design-canvas", "app/api/design-canvas"].map((one) => inApp(target, one));

/**
 * Ask git whether it ignores each sample path, and through which file. Returns `{ git: false }` outside a git checkout (or when git
 * cannot answer), else `{ git: true, prefix, rules, shared }`: `rules` is `IGNORE_RULES` with `ignored` (true or false), `source`
 * (the file that ignores it, resolved, or null), `pattern` (the line that does it, as `<file>:<line>: <pattern>`) and
 * `viaGitignore` (true when that file is a `.gitignore`) added to each; `shared` is the same answer for `SHARED`; `prefix` is where
 * the target sits inside the repository (empty at its root), which an exclude pattern that has a slash in it needs, because such a
 * pattern is anchored at the top of the repository.
 */
export function askGit(target) {
  const run = (...args) => spawnSync("git", ["-C", target, ...args], { encoding: "utf8" });
  const inside = run("rev-parse", "--is-inside-work-tree");
  if (inside.status !== 0 || inside.stdout.trim() !== "true") return { git: false };
  const shared = SHARED.map((one) => ({ ...one, probe: inApp(target, one.probe) }));
  const probes = [...IGNORE_RULES.map((rule) => rule.probe), ...shared.map((one) => one.probe)];
  /* `-n` makes git print a line for the paths it does NOT ignore too (`::<tab>path`), so every probe has an answer. Exit 0 says some
     were ignored and 1 that none was; anything else is git unable to answer, which is "not a checkout" to the callers. */
  const asked = run("check-ignore", "-v", "-n", "--no-index", "--", ...probes);
  if (asked.status !== 0 && asked.status !== 1) return { git: false };
  const top = run("rev-parse", "--show-toplevel").stdout.trim() || target;
  const answers = new Map();
  for (const line of asked.stdout.split("\n")) {
    const tab = line.lastIndexOf("\t");
    if (tab < 0) continue;
    const found = /^(.*?):(\d+):(.*)$/.exec(line.slice(0, tab));
    /* A pattern that starts with `!` is git naming the rule that RE-INCLUDES the path: not ignored. */
    const ignored = Boolean(found) && !found[3].startsWith("!");
    const source = ignored ? (path.isAbsolute(found[1]) ? found[1] : path.resolve(top, found[1])) : null;
    answers.set(line.slice(tab + 1), {
      ignored,
      source,
      pattern: ignored ? `${found[1]}:${found[2]}: ${found[3]}` : null,
      viaGitignore: ignored && path.basename(source) === ".gitignore",
    });
  }
  const of = (probe) => answers.get(probe) ?? { ignored: false, source: null, pattern: null, viaGitignore: false };
  return {
    git: true,
    prefix: run("rev-parse", "--show-prefix").stdout.trim(),
    rules: IGNORE_RULES.map((rule) => ({ ...rule, ...of(rule.probe) })),
    shared: shared.map((one) => ({ ...one, ...of(one.probe) })),
  };
}

/**
 * WHETHER A TEAMMATE SEES THE CANVAS THIS CHECKOUT SEES, decided from `askGit`'s answers. Pure, for the tests.
 * A shared path ignored through a `.gitignore` is a failure, naming the line. Ignored through anything else, it is a note naming
 * the source: the project, or this machine, keeps it local on purpose, and the check respects that.
 */
export function sharingProblems(asked) {
  const failures = [];
  const notes = [];
  if (!asked.git) return { failures, notes };
  const ignored = asked.shared.filter((one) => one.ignored);
  for (const one of ignored.filter((one) => one.viaGitignore))
    failures.push(
      `git ignores ${asked.prefix}${one.probe} (${one.what}) through ${one.pattern}, so a teammate who clones or pulls does not get it ` +
        `and sees a different canvas: remove that line, or move it to the repository's exclude list to keep it local on purpose`,
    );
  const local = ignored.filter((one) => !one.viaGitignore);
  for (const source of [...new Set(local.map((one) => one.source))])
    notes.push(
      `kept local through ${source}: ${local.filter((one) => one.source === source).map((one) => one.what).join(", ")}. ` +
        "A teammate who clones the project does not get them",
    );
  return { failures, notes };
}

/** A local canvas: every path a teammate would need is kept out of git, or one failure names what git would take. */
export function localProblems(asked) {
  if (!asked.git) return [];
  return asked.shared
    .filter((one) => !one.ignored)
    .map(
      (one) =>
        `git does not ignore ${asked.prefix}${one.probe} (${one.what}), so it could be committed although this canvas stays on this machine: ` +
        "run install-canvas.mjs, which keeps the canvas in the repository's exclude list",
    );
}

/**
 * WHAT THIS CHECKOUT HAS NOT COMMITTED of the canvas: changed and new files git would commit, and files git is told to skip
 * (`update-index --skip-worktree` or `--assume-unchanged`), whose local version is never committed. Until they are committed and
 * pushed, a teammate sees the canvas as it was last committed, and an upgrade committed without its new files does not build for
 * them. `{ git: false }` outside a git checkout.
 */
export function uncommitted(target) {
  const run = (...args) => spawnSync("git", ["-C", target, ...args], { encoding: "utf8" });
  const inside = run("rev-parse", "--is-inside-work-tree");
  if (inside.status !== 0 || inside.stdout.trim() !== "true") return { git: false };
  const paths = canvasPaths(target);
  const status = run("status", "--porcelain", "--untracked-files=all", "--", ...paths);
  const listed = run("ls-files", "-v", "--", ...paths);
  if (status.status !== 0 || listed.status !== 0) return { git: false };
  const lines = status.stdout.split("\n").filter(Boolean);
  return {
    git: true,
    paths,
    added: lines.filter((line) => line.startsWith("??")).length,
    changed: lines.filter((line) => !line.startsWith("??")).length,
    /* `S` is skip-worktree, a lowercase letter assume-unchanged. */
    skipped: listed.stdout.split("\n").filter((line) => /^(S|[a-z]) /.test(line)).map((line) => line.slice(2)),
  };
}

/** The one note `uncommitted` turns into, or null when everything is committed. */
export function uncommittedNote(found) {
  if (!found.git) return null;
  const parts = [];
  if (found.changed > 0) parts.push(`${found.changed} changed`);
  if (found.added > 0) parts.push(`${found.added} new`);
  if (found.skipped.length > 0) parts.push(`${found.skipped.length} that git is told to skip (${found.skipped.slice(0, 3).join(", ")}${found.skipped.length > 3 ? ", ..." : ""})`);
  if (parts.length === 0) return null;
  return (
    `canvas files not committed: ${parts.join(", ")}. A teammate who pulls sees the canvas as last committed until they are ` +
    `committed and pushed together: git add ${found.paths.join(" ")}`
  );
}

/**
 * WHAT THE INSTALLER DOES ABOUT `.gitignore`, decided from git's answers:
 *   `covered`  git ignores every path already, through whatever: leave `.gitignore` alone, whatever its text says.
 *   `local`    some path is ignored through a source that is not a `.gitignore` (the repository's exclude list, a global file): the
 *              project keeps canvas files local, so `.gitignore` is NEVER touched; `missing` names the paths git does not ignore yet
 *              and `exclude` the file that already ignores the others, which is where to add them (the installer writes only inside
 *              `--target`, so it names the file and never edits one).
 *   `append`   the project ignores through `.gitignore`, or through nothing yet: append the lines git still misses, and only those
 *              the file does not already say (a line that is there and does not work is not made to work by saying it twice).
 *   `text`     not a git checkout: append the lines the file does not contain, as it always did.
 */
export function planIgnores(target, gitignoreText) {
  const asked = askGit(target);
  if (!asked.git) return { kind: "text", lines: IGNORE_RULES.map((rule) => rule.line).filter((line) => !gitignoreText.includes(line)) };
  const missing = asked.rules.filter((rule) => !rule.ignored);
  if (missing.length === 0) return { kind: "covered", lines: [] };
  const local = asked.rules.find((rule) => rule.ignored && !rule.viaGitignore);
  if (local)
    return {
      kind: "local",
      lines: [],
      exclude: local.source,
      missing: missing.map((rule) => ({ line: `${asked.prefix}${rule.line}`, probe: rule.probe })),
    };
  return { kind: "append", lines: missing.map((rule) => rule.line).filter((line) => !gitignoreText.includes(line)) };
}

/**
 * WHETHER THE CANVAS IS SHARED THROUGH GIT OR STAYS ON THIS MACHINE, which is the default: the developers' repository never receives
 * canvas files or pictures, and the team comments through the team page.
 *
 *   `shared`  the canvas folder is tracked already (an install from before the canvas stayed local keeps it so), or this repository
 *             opted in with `install-canvas.mjs --share`, recorded in its local git config (`design-canvas.shared`), never in a file
 *             a clone receives.
 *   `local`   every other git checkout: the canvas folder, its routes and the capture's build folder are in the repository's
 *             exclude list (`excludeCanvas`).
 *   `none`    not a git checkout.
 *
 * Returns `{ mode, why }`, `why` being "tracked" or "opted in" for a shared canvas.
 */
export function canvasMode(target) {
  const run = (...args) => spawnSync("git", ["-C", target, ...args], { encoding: "utf8" });
  const inside = run("rev-parse", "--is-inside-work-tree");
  if (inside.status !== 0 || inside.stdout.trim() !== "true") return { mode: "none", why: null };
  if (run("ls-files", "--", ...canvasPaths(target)).stdout.trim() !== "") return { mode: "shared", why: "tracked" };
  if (run("config", "--get", "design-canvas.shared").stdout.trim() === "true") return { mode: "shared", why: "opted in" };
  return { mode: "local", why: null };
}

/** Record the opt-in to sharing the canvas through git, in this repository's local config. */
export const optInToSharing = (target) => spawnSync("git", ["-C", target, "config", "--local", "design-canvas.shared", "true"]).status === 0;

const EXCLUDE_HEADER = "# design-canvas: the canvas stays on this machine (its installer keeps these lines)";

/** The exclude lines the installer keeps: the canvas folder and its routes (a local canvas only), and the capture's build folder. */
export function localLines(target) {
  const prefix = spawnSync("git", ["-C", target, "rev-parse", "--show-prefix"], { encoding: "utf8" }).stdout.trim();
  return { canvas: canvasPaths(target).map((one) => `/${prefix}${one}/`), build: `/${prefix}.next-canvas/` };
}

/**
 * Keep the canvas out of git through the repository's exclude list: the canvas folder and its routes for a local canvas, and the
 * capture's build folder always. For a shared canvas the installer's canvas lines are taken back out. The list is the repository's
 * own and never travels with a clone; in a linked worktree or a project in a folder of a repository it is the repository's list, and
 * the lines are anchored at the project. Returns `{ file, changed }`.
 */
export function excludeCanvas(target, shared) {
  const where = spawnSync("git", ["-C", target, "rev-parse", "--git-path", "info/exclude"], { encoding: "utf8" });
  const file = path.resolve(target, where.stdout.trim());
  const text = existsSync(file) ? readFileSync(file, "utf8") : "";
  const { canvas, build } = localLines(target);
  const wanted = shared ? [build] : [...canvas, build];
  const unwanted = shared ? canvas : [];
  const have = text.split("\n");
  const kept = have.filter((line) => !unwanted.includes(line));
  const missing = wanted.filter((line) => !kept.includes(line));
  if (missing.length === 0 && kept.length === have.length) return { file, changed: false };
  const base = kept.join("\n");
  const head = kept.includes(EXCLUDE_HEADER) || missing.length === 0 ? [] : [EXCLUDE_HEADER];
  const next = missing.length === 0 ? base : `${base}${base === "" || base.endsWith("\n") ? "" : "\n"}${[...head, ...missing].join("\n")}\n`;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, next);
  return { file, changed: true };
}
