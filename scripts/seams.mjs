/**
 * design-canvas — what the installer and `check-install.mjs` both need to know about the project outside the canvas's folder, read
 * from the project's own files and never guessed.
 *
 * DELETE WITH: the design-canvas/ folder's installer.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};

/** The major version of the Next the project has installed, or 0 when it has none. */
export const nextMajor = (target) =>
  Number(String(readJson(path.join(target, "node_modules", "next", "package.json"))?.version ?? "0").split(".")[0]) || 0;

/** What to do about a root `app` that an older install wrote beside the project's `src/app` (`canvasOnlyRootApp`). */
export const STALE_ROOT_APP =
  "app/ holds only the canvas's routes, from an older install, beside the project's pages in src/app. While it exists Next serves " +
  "app/ and ignores src/app, so every page of the app is gone: delete the app/ folder (the routes are in src/app now)";

/** Can a file in `design-canvas/` load this package? The tools import from there, so this is the resolution they get. */
const resolvable = (target, name) => {
  try {
    createRequire(path.join(target, "design-canvas", "x.mjs")).resolve(`${name}/package.json`);
    return true;
  } catch (error) {
    /* Found, with an `exports` map that does not list its package.json. */
    return error?.code === "ERR_PACKAGE_PATH_NOT_EXPORTED";
  }
};

/** Does the project build Tailwind: its package.json names it (v3, or v4's PostCSS or Vite plugin), or it resolves from the canvas. */
export function usesTailwind(target) {
  const pkg = readJson(path.join(target, "package.json")) ?? {};
  const named = ["dependencies", "devDependencies"].some((key) =>
    ["tailwindcss", "@tailwindcss/postcss", "@tailwindcss/vite"].some((name) => pkg[key]?.[name] !== undefined),
  );
  return named || resolvable(target, "tailwindcss");
}

/** The stylesheet a project without Tailwind loads on the canvas pages (`tool/canvas.css`, installed beside the tools). */
export const CANVAS_CSS = "design-canvas/canvas.css";

/**
 * A canvas page stub with the import of that stylesheet added above its canvas import, at the same depth. The specimen page and the
 * endpoints are left as they are: the specimen renders the app's own components with the app's own CSS alone.
 */
export const withCanvasCss = (text) =>
  text.replace(/^import \{ Canvas\w+ \} from "((?:\.\.\/)+)design-canvas\/canvas-page";$/m, (line, up) => `import "${up}${CANVAS_CSS}";\n${line}`);

/**
 * The one command that adds Playwright, or null when the canvas's tools can already load it. A project with only `@playwright/test`
 * has it under pnpm's strict layout without `playwright` itself, so the same version is named, which keeps one browser build. A
 * local canvas (`local`) gets it beside the canvas, in `design-canvas/` (its own package.json, kept out of git with the folder), so
 * the team's package.json and lockfile never change; a shared canvas adds it to the project with its package manager.
 */
export function playwrightCommand(target, { local = false } = {}) {
  if (resolvable(target, "playwright")) return null;
  let spec = "playwright";
  try {
    const test = readJson(createRequire(path.join(target, "package.json")).resolve("@playwright/test/package.json"));
    if (test?.version) spec = `playwright@${test.version}`;
  } catch {
    /* No @playwright/test either: the latest. */
  }
  return addCommand(target, spec, local);
}

/** The one command that adds esbuild, which every tool that reads `project/flows.ts` needs, or null when it already loads. */
export const esbuildCommand = (target, { local = false } = {}) => (resolvable(target, "esbuild") ? null : addCommand(target, "esbuild", local));

/** The command that adds a package where the tools load it from: beside a local canvas, or to the project with its package manager. */
function addCommand(target, spec, local) {
  if (local) return `npm install --prefix design-canvas ${spec}`;
  const has = (file) => existsSync(path.join(target, file));
  if (has("pnpm-lock.yaml")) return `pnpm add -D ${spec}`;
  if (has("yarn.lock")) return `yarn add -D ${spec}`;
  if (has("bun.lock") || has("bun.lockb")) return `bun add -d ${spec}`;
  return `npm install -D ${spec}`;
}

/**
 * THE SEAMS THE INSTALLER WRITES INTO THE PROJECT'S OWN FILES, each as a marked overlay line (`tool/overlay.mjs`), so they live in
 * this working copy for the life of the project and no commit ever carries them:
 *
 *   the root layout    the pin component's import, and `<CanvasStatePin />` as the first child of `<body>`
 *   the next config    `distDir: process.env.CANVAS_BUILD_DIR || ".next"`, the capture's own build folder
 *   tsconfig.json      `".next-canvas/types/**\/*.ts"` as the first entry of `include`, so a capture build never rewrites the file
 *
 * Each is an added line only, never an edited one: a file without its marked lines is exactly the team's file. When a file has no
 * place for a line of its own (a body tag that holds its children on the same line, a config wrapped in a function call, an include
 * list on one line), nothing is written there and `todo` says what to add, marked, by hand. A seam that is already there is not
 * written again. An older install's unmarked canvas lines in these files are marked in place when that is safe: a line the committed
 * version does not have, that is the seam line itself or a comment about the canvas (`markOlder`). Any other unmarked canvas line is
 * named in `manual`, for the agent to mark or remove. Returns `{ written, marked, manual, todo }`, `marked` and `manual` as
 * `{ file, line, text }`.
 */
export const LOCAL_MARK = "design-canvas:local";

const linesOf = (text) => text.split("\n");
const indentOf = (line, fallback) => /^\s*/.exec(line ?? "")?.[0] || fallback;
const posixRelative = (from, to) => {
  const rel = path.relative(from, to).split(path.sep).join("/");
  return rel.startsWith(".") ? rel : `./${rel}`;
};

/** The layout with the pin's two lines added, or null when the body tag has no line of its own to add beside. */
export function withPin(text, importPath) {
  const lines = linesOf(text);
  const body = lines.findIndex((line) => /^\s*<body\b[^<]*>\s*$/.test(line) && !/\/>\s*$/.test(line));
  if (body < 0) return null;
  const childIndent = indentOf(lines[body + 1], `${indentOf(lines[body], "")}  `);
  lines.splice(body + 1, 0, `${childIndent}<CanvasStatePin /> {/* ${LOCAL_MARK} */}`);
  /* After the last import, a multi-line one included (its last line is `} from "..."`); at the top after any directive otherwise. */
  let at = -1;
  lines.forEach((line, index) => {
    if (/^(?:import\s.*|\}\s*from\s.*)["'];?\s*$/.test(line)) at = index;
  });
  if (at < 0) while (/^\s*["']use \w+["'];?\s*$/.test(lines[at + 1] ?? "")) at += 1;
  lines.splice(at + 1, 0, `import { CanvasStatePin } from "${importPath}"; // ${LOCAL_MARK}`);
  return lines.join("\n");
}

/**
 * The line that opens the object the next config exports: `export default {` or `module.exports = {`, or the `const <name> = {` of
 * the name it exports. A file that exports nothing it can read (a config wrapped in a function call) has none: -1. A file with no
 * export line at all is read as before, its first plain object.
 */
function exportedObjectAt(lines) {
  const literal = lines.findIndex((line) => /^(?:module\.exports\s*=|export\s+default)\s*\{\s*$/.test(line));
  if (literal >= 0) return literal;
  const named = lines.map((line) => /^\s*(?:export\s+default|module\.exports\s*=)\s*(\w+)\s*;?\s*$/.exec(line)?.[1]).find(Boolean);
  const declares = (name) => new RegExp(`^(?:export\\s+)?(?:const|let|var)\\s+${name}(?:\\s*:\\s*[\\w.]+)?\\s*=\\s*\\{\\s*$`);
  if (named) return lines.findIndex((line) => declares(named).test(line));
  if (lines.some((line) => /^\s*(?:export\s+default\b|module\.exports\b)/.test(line))) return -1;
  return lines.findIndex((line) => declares("\\w+").test(line));
}

/** The next config with the build folder line added as the exported config object's first key, or null when there is no plain object. */
export function withBuildDir(text) {
  const lines = linesOf(text);
  const open = exportedObjectAt(lines);
  if (open < 0) return null;
  lines.splice(open + 1, 0, `${indentOf(lines[open + 1], "  ")}distDir: process.env.CANVAS_BUILD_DIR || ".next", // ${LOCAL_MARK}`);
  return lines.join("\n");
}

/**
 * Does the build folder line sit inside the object the config exports? false when it sits elsewhere (an earlier object), null when
 * that cannot be read (a wrapped config, no such line). Braces are counted per line, which a config of plain keys allows.
 */
export function buildDirInExport(text) {
  const lines = linesOf(text);
  const at = lines.findIndex((line) => /\bCANVAS_BUILD_DIR\b/.test(line));
  const open = exportedObjectAt(lines);
  if (at < 0 || open < 0) return null;
  if (at < open) return false;
  let depth = 0;
  for (let index = open; index < lines.length; index += 1) {
    depth += (lines[index].match(/\{/g) ?? []).length - (lines[index].match(/\}/g) ?? []).length;
    if (index === at) return depth >= 1;
    if (depth <= 0) return false;
  }
  return false;
}

/** tsconfig.json with the capture build's types first in `include`, or null when the list is not one entry per line. */
export function withCanvasTypes(text) {
  const lines = linesOf(text);
  const open = lines.findIndex((line) => /^\s*"include"\s*:\s*\[\s*$/.test(line));
  if (open < 0 || /^\s*\]/.test(lines[open + 1] ?? "]")) return null;
  lines.splice(open + 1, 0, `${indentOf(lines[open + 1], "    ")}".next-canvas/types/**/*.ts", // ${LOCAL_MARK}`);
  return lines.join("\n");
}

/* What makes a line in a seam file the canvas's. */
const CANVAS_LINE = /design-canvas|CanvasStatePin|canvasPinsAllowed|canvasStateId|CANVAS_BUILD_DIR|NEXT_PUBLIC_CANVAS_PINS|\.next-canvas/;
/* The seam lines the installer writes, without their marker, and a comment line of its own. */
const SEAM_SHAPES = [
  /^\s*import \{ CanvasStatePin \} from ["'][^"']+["'];?\s*$/,
  /^\s*<CanvasStatePin\s*\/>\s*$/,
  /^\s*distDir:\s*process\.env\.CANVAS_BUILD_DIR\s*\|\|\s*["'][^"']*["'],?\s*$/,
  /^\s*["']\.next-canvas\/types\/\*\*\/\*\.ts["'],?\s*$/,
  /^\s*(?:\/\/.*|\/\*.*\*\/\s*|\{\s*\/\*.*\*\/\s*\}\s*)$/,
];
const isMarked = (line) => line.includes(LOCAL_MARK);

/**
 * An older install's canvas lines in one seam file, marked where that is safe: unmarked, absent from the committed version (so
 * taking it out of commits changes nothing the team has), and the seam line itself or a one-line comment. Any other such line is
 * returned in `manual`. Returns `{ text, marked, manual }`.
 */
export function markOlder(text, committed, file) {
  const have = new Set(linesOf(committed ?? "").map((line) => line.trim()));
  const marked = [];
  const manual = [];
  const lines = linesOf(text).map((line, at) => {
    /* A line the committed version holds is the team's text, whatever it mentions. */
    if (!CANVAS_LINE.test(line) || isMarked(line) || have.has(line.trim())) return line;
    const one = { file, line: at + 1, text: line.trim() };
    if (!SEAM_SHAPES.some((shape) => shape.test(line))) {
      manual.push(one);
      return line;
    }
    marked.push(one);
    const jsx = /^\s*(?:<|\{\s*\/\*)/.test(line);
    return `${line.replace(/\s+$/, "")} ${jsx ? `{/* ${LOCAL_MARK} */}` : `// ${LOCAL_MARK}`}`;
  });
  return { text: lines.join("\n"), marked, manual };
}

/** The committed version of a file, or null (no git, no commit, a file it does not have). */
function committedText(target, rel) {
  const run = spawnSync("git", ["-C", target, "show", `HEAD:./${rel}`], { encoding: "utf8" });
  return run.status === 0 ? run.stdout : null;
}

export function writeSeams(target, app) {
  const written = [];
  const marked = [];
  const manual = [];
  const todo = [];
  const find = (names) => names.map((name) => path.join(target, name)).find((file) => existsSync(file));
  const apply = (file, already, add, missing) => {
    if (!file) return;
    const rel = path.relative(target, file).split(path.sep).join("/");
    let text = readFileSync(file, "utf8");
    const older = markOlder(text, committedText(target, rel), rel);
    if (older.marked.length > 0) {
      text = older.text;
      writeFileSync(file, text);
      marked.push(...older.marked);
    }
    manual.push(...older.manual);
    if (already.test(text)) return;
    const next = add(text);
    if (next === null) todo.push(`${rel}: ${missing}`);
    else {
      writeFileSync(file, next);
      written.push(rel);
    }
  };
  const layout = find(["tsx", "jsx", "js", "ts"].map((ext) => `${app}/layout.${ext}`));
  if (layout)
    apply(
      layout,
      /\bCanvasStatePin\b/,
      (text) => withPin(text, posixRelative(path.dirname(layout), path.join(target, "design-canvas", "project", "canvas-state-pin"))),
      `render <CanvasStatePin /> (from design-canvas/project/canvas-state-pin) as the first child of <body>, with its import, each line ` +
        `ending in {/* ${LOCAL_MARK} */} or // ${LOCAL_MARK}. The body tag holds its children on its own line, so first put them on a line ` +
        `of their own (a formatting change the team receives), then add the pin above them`,
    );
  if (nextMajor(target) === 0 && !find(["next.config.mjs", "next.config.js", "next.config.ts", "next.config.cjs"])) return { written, marked, manual, todo };
  apply(
    find(["next.config.mjs", "next.config.js", "next.config.ts", "next.config.cjs"]),
    /CANVAS_BUILD_DIR/,
    (text) => (/\bdistDir\b/.test(text) ? null : withBuildDir(text)),
    `make the build folder come from the environment, distDir: process.env.CANVAS_BUILD_DIR || ".next", on a line of its own inside the ` +
      `exported config, ending in // ${LOCAL_MARK}. Without it a capture build overwrites .next and stops the dev server`,
  );
  apply(
    find(["tsconfig.json"]),
    /\.next-canvas\/types/,
    withCanvasTypes,
    `add ".next-canvas/types/**/*.ts" to include, on a line of its own ending in // ${LOCAL_MARK}, so a capture build never rewrites the file`,
  );
  return { written, marked, manual, todo };
}
