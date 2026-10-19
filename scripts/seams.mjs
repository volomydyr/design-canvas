/**
 * design-canvas — what the installer and `check-install.mjs` both need to know about the project outside the canvas's folder, read
 * from the project's own files and never guessed.
 *
 * DELETE WITH: the design-canvas/ folder's installer.
 */
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
 * The one command that adds Playwright to the project, or null when the canvas's tools can already load it. A project with only
 * `@playwright/test` has it under pnpm's strict layout without `playwright` itself, so the same version is named, which keeps one
 * browser build.
 */
export function playwrightCommand(target) {
  if (resolvable(target, "playwright")) return null;
  let spec = "playwright";
  try {
    const test = readJson(createRequire(path.join(target, "package.json")).resolve("@playwright/test/package.json"));
    if (test?.version) spec = `playwright@${test.version}`;
  } catch {
    /* No @playwright/test either: the latest. */
  }
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
 * list on one line), nothing is written there and `todo` says what to add, marked, by hand. A seam that is already there, marked or
 * not, is left as it is. Returns `{ written, todo }`.
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

/** The next config with the build folder line added as the config object's first key, or null when there is no plain object. */
export function withBuildDir(text) {
  const lines = linesOf(text);
  const open = lines.findIndex((line) =>
    /^(?:(?:export\s+)?(?:const|let|var)\s+\w+(?:\s*:\s*[\w.]+)?\s*=|module\.exports\s*=|export\s+default)\s*\{\s*$/.test(line),
  );
  if (open < 0) return null;
  lines.splice(open + 1, 0, `${indentOf(lines[open + 1], "  ")}distDir: process.env.CANVAS_BUILD_DIR || ".next", // ${LOCAL_MARK}`);
  return lines.join("\n");
}

/** tsconfig.json with the capture build's types first in `include`, or null when the list is not one entry per line. */
export function withCanvasTypes(text) {
  const lines = linesOf(text);
  const open = lines.findIndex((line) => /^\s*"include"\s*:\s*\[\s*$/.test(line));
  if (open < 0 || /^\s*\]/.test(lines[open + 1] ?? "]")) return null;
  lines.splice(open + 1, 0, `${indentOf(lines[open + 1], "    ")}".next-canvas/types/**/*.ts", // ${LOCAL_MARK}`);
  return lines.join("\n");
}

export function writeSeams(target, app) {
  const written = [];
  const todo = [];
  const find = (names) => names.map((name) => path.join(target, name)).find((file) => existsSync(file));
  const apply = (file, already, add, missing) => {
    if (!file) return;
    const text = readFileSync(file, "utf8");
    if (already.test(text)) return;
    const next = add(text);
    const rel = path.relative(target, file).split(path.sep).join("/");
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
  if (nextMajor(target) === 0 && !find(["next.config.mjs", "next.config.js", "next.config.ts", "next.config.cjs"])) return { written, todo };
  apply(
    find(["next.config.mjs", "next.config.js", "next.config.ts", "next.config.cjs"]),
    /CANVAS_BUILD_DIR/,
    (text) => (/\bdistDir\b/.test(text) ? null : withBuildDir(text)),
    `make the build folder come from the environment, distDir: process.env.CANVAS_BUILD_DIR || ".next", on a line of its own ending in ` +
      `// ${LOCAL_MARK}. Without it a capture build overwrites .next and stops the dev server`,
  );
  apply(
    find(["tsconfig.json"]),
    /\.next-canvas\/types/,
    withCanvasTypes,
    `add ".next-canvas/types/**/*.ts" to include, on a line of its own ending in // ${LOCAL_MARK}, so a capture build never rewrites the file`,
  );
  return { written, todo };
}
