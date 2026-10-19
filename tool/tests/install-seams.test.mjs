/**
 * Tests for the seams the installer and `check-install.mjs` read outside the canvas's folder: where the routes go and what they
 * export, a project without Tailwind, and a project that cannot load Playwright.
 *
 *   node --test tool/tests/install-seams.test.mjs
 *
 * Every project here is a throwaway folder with a package.json and, where a case needs one, a stand-in package under node_modules
 * (a package.json only). The stylesheet test needs CANVAS_TEST_PROJECT pointing at a project with the same Tailwind 3 that built
 * `tool/canvas.css`; without one it is skipped.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

import { buildCanvasCss, CANVAS_CSS } from "../../scripts/build-canvas-css.mjs";

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const INSTALLER = path.join(SKILL, "scripts", "install-canvas.mjs");
const CHECKER = path.join(SKILL, "scripts", "check-install.mjs");

const made = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** A throwaway project: `files` maps a relative path to its text; `package.json` defaults to `{}`. */
function project(files = {}) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "canvas-seams-")));
  made.push(root);
  for (const [rel, text] of Object.entries({ "package.json": "{}\n", ...files })) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), text);
  }
  return root;
}
const env = (root) => ({ ...process.env, CANVAS_ANSWERS_FILE: path.join(root, ".answers.json"), GIT_CONFIG_GLOBAL: "/dev/null" });
const install = (root) => spawnSync(process.execPath, [INSTALLER, "--target", root], { cwd: root, env: env(root), encoding: "utf8" });
const check = (root) => spawnSync(process.execPath, [CHECKER, "--target", root], { cwd: root, env: env(root), encoding: "utf8" });
const read = (root, rel) => readFileSync(path.join(root, rel), "utf8");
/** A stand-in installed package: only its package.json. */
const fakePackage = (root, name, version) => {
  mkdirSync(path.join(root, "node_modules", name), { recursive: true });
  writeFileSync(path.join(root, "node_modules", name, "package.json"), JSON.stringify({ name, version }));
};
const TAILWIND = `{ "devDependencies": { "tailwindcss": "^3.4.0" } }\n`;

/* ------------------------------------------------------------------ the routes */

test("the endpoint stubs write runtime and dynamic themselves, with the core's values, and re-export only the handlers", () => {
  for (const [stub, core] of [
    ["app-api-canvas-comments-route.ts", "comments-route.ts"],
    ["app-api-canvas-shots-route.ts", "shots-route.ts"],
  ]) {
    const text = readFileSync(path.join(SKILL, "stubs", stub), "utf8");
    assert.doesNotMatch(text, /export\s*\{[^}]*\b(?:dynamic|runtime)\b[^}]*\}\s*from/, `${stub} re-exports route config`);
    const coreText = readFileSync(path.join(SKILL, "core", core), "utf8");
    for (const name of ["runtime", "dynamic"]) {
      const value = (source) => source.match(new RegExp(`^export const ${name} = ("[^"]+");$`, "m"))?.[1];
      assert.ok(value(text), `${stub} writes ${name}`);
      assert.equal(value(text), value(coreText), `${stub} and core/${core} agree on ${name}`);
    }
  }
});

test("check-install fails an endpoint that re-exports its config on Next 16, and only notes it on an older Next", () => {
  const root = project({ "package.json": TAILWIND });
  assert.equal(install(root).status, 0);
  writeFileSync(
    path.join(root, "app/api/design-canvas/shots/route.ts"),
    `export { dynamic, runtime } from "../../../../design-canvas/core/shots-route";\nexport const GET = () => null;\n`,
  );
  const line = /app\/api\/design-canvas\/shots\/route\.ts re-exports dynamic and runtime, which Next 16 refuses/;
  fakePackage(root, "next", "16.3.4");
  const failing = check(root).stdout;
  assert.match(failing.slice(failing.indexOf("FAILURE")), line);
  fakePackage(root, "next", "14.2.18");
  const noted = check(root).stdout;
  assert.match(noted.slice(0, noted.indexOf("FAILURE")), line);
  assert.doesNotMatch(noted.slice(noted.indexOf("FAILURE")), line);
  assert.doesNotMatch(check(root).stdout, /comments\/route\.ts re-exports/, "the shipped comments stub passes");
});

test("a root app holding only the canvas's routes beside src/app gets the routes in src/app and the line to delete it", () => {
  const leftover = project({
    "src/app/layout.tsx": "export default function Layout({ children }) {\n  return children;\n}\n",
    "app/design-canvas/page.tsx": "old\n",
    "app/api/design-canvas/comments/route.ts": "old\n",
  });
  const result = install(leftover);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(existsSync(path.join(leftover, "src/app/design-canvas/[canvas]/page.tsx")));
  assert.match(result.stdout, /Routes: app\/ holds only the canvas's routes, from an older install/);
  assert.match(check(leftover).stdout, /- app\/ holds only the canvas's routes[^\n]*delete the app\/ folder/);

  /* A root app with pages of its own is the project's App Router: the routes go there and nothing is said. */
  const own = project({ "src/app/layout.tsx": "x\n", "app/page.tsx": "export default function Page() { return null; }\n" });
  const ownResult = install(own);
  assert.ok(existsSync(path.join(own, "app/design-canvas/page.tsx")));
  assert.doesNotMatch(ownResult.stdout, /Routes:/);
  assert.doesNotMatch(check(own).stdout, /holds only the canvas's routes/);
});

/* ------------------------------------------------------------------ no Tailwind */

test("the two canvas pages import the prebuilt stylesheet at their own depth, and check-install accepts it", () => {
  for (const [files, app] of [
    [{}, "app"],
    [{ "src/app/layout.tsx": "x\n" }, "src/app"],
  ]) {
    const root = project(files);
    const result = install(root);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /The canvas pages import design-canvas\/canvas\.css, the canvas's classes prebuilt, so no Tailwind config needs the canvas folder/);
    const up = app === "app" ? "../.." : "../../..";
    assert.match(read(root, `${app}/design-canvas/page.tsx`), new RegExp(`^import "${up}/design-canvas/canvas\\.css";\\nimport \\{ CanvasIndex \\}`, "m"));
    assert.match(read(root, `${app}/design-canvas/[canvas]/page.tsx`), new RegExp(`^import "${up}/../design-canvas/canvas\\.css";\\nimport \\{ CanvasPage \\}`, "m"));
    assert.doesNotMatch(read(root, `${app}/design-canvas/system/[set]/page.tsx`), /canvas\.css/, "the specimen page renders with the app's CSS alone");
    assert.equal(read(root, "design-canvas/canvas.css"), readFileSync(CANVAS_CSS, "utf8"));
    const checked = check(root).stdout;
    assert.doesNotMatch(checked, /Tailwind|canvas renders unstyled|stylesheet/);

    writeFileSync(path.join(root, `${app}/design-canvas/[canvas]/page.tsx`), read(root, `${app}/design-canvas/[canvas]/page.tsx`).replace(/^import "[^"]+canvas\.css";\n/m, ""));
    assert.match(
      check(root).stdout,
      new RegExp(`- ${app}/design-canvas/\\[canvas\\]/page\\.tsx does not import the canvas's stylesheet[^\\n]*add import "${up}/../design-canvas/canvas\\.css"; as its first import`),
    );
  }
});

test("with Tailwind the pages still import the prebuilt stylesheet, no content glob is asked for, and an older page styled by a glob passes", () => {
  const root = project({ "package.json": TAILWIND, "tailwind.config.js": "module.exports = { content: ['./app/**/*.tsx'] };\n" });
  const result = install(root);
  assert.doesNotMatch(result.stdout, /TAILWIND\. Add/);
  assert.match(read(root, "app/design-canvas/page.tsx"), /^import "\.\.\/\.\.\/design-canvas\/canvas\.css";$/m);
  assert.doesNotMatch(check(root).stdout, /content globs|canvas renders unstyled/);
  /* A page from an older install, without the import: fine while the Tailwind config scans the canvas folder, a failure otherwise. */
  const page = path.join(root, "app/design-canvas/page.tsx");
  writeFileSync(page, read(root, "app/design-canvas/page.tsx").replace(/^import "[^"]+canvas\.css";\n/m, ""));
  assert.match(check(root).stdout, /app\/design-canvas\/page\.tsx does not import the canvas's stylesheet, so the canvas renders unstyled/);
  writeFileSync(path.join(root, "tailwind.config.js"), "module.exports = { content: ['./app/**/*.tsx', './design-canvas/**/*.{ts,tsx}'] };\n");
  assert.doesNotMatch(check(root).stdout, /does not import the canvas's stylesheet/);
  /* A reinstall adds the import to the older page itself. */
  assert.match(install(root).stdout, /wrote {2}app\/design-canvas\/page\.tsx \(the canvas's stylesheet import\)/);
  assert.match(read(root, "app/design-canvas/page.tsx"), /^import "\.\.\/\.\.\/design-canvas\/canvas\.css";$/m);
});

test("the shipped stylesheet is what the build makes of today's classes", async (t) => {
  const project = process.env.CANVAS_TEST_PROJECT;
  const shippedWith = readFileSync(CANVAS_CSS, "utf8").match(/built with tailwindcss (\S+)/)?.[1];
  let installed;
  try {
    installed = JSON.parse(readFileSync(path.join(project ?? "", "node_modules", "tailwindcss", "package.json"), "utf8")).version;
  } catch {
    installed = undefined;
  }
  if (installed !== shippedWith) {
    t.skip(`needs CANVAS_TEST_PROJECT with tailwindcss ${shippedWith} (has ${installed ?? "none"})`);
    return;
  }
  assert.equal(await buildCanvasCss(project), readFileSync(CANVAS_CSS, "utf8"), "rebuild it: node scripts/build-canvas-css.mjs --with <project>");
});

/* ------------------------------------------------------------------ Playwright */

test("a project that cannot load playwright is told the one command, with its package manager and its @playwright/test version", () => {
  const pnpm = project({ "pnpm-lock.yaml": "lockfileVersion: '9.0'\n" });
  fakePackage(pnpm, "@playwright/test", "1.63.0");
  const installed = install(pnpm);
  assert.match(installed.stdout, /Playwright: the capture needs it[^\n]*\n\n  pnpm add -D playwright@1\.63\.0\n/);
  assert.match(check(pnpm).stdout, /- playwright does not load from design-canvas\/, and every capture needs it: run pnpm add -D playwright@1\.63\.0/);

  const npm = project();
  install(npm);
  assert.match(check(npm).stdout, /run npm install -D playwright$/m);

  fakePackage(pnpm, "playwright", "1.63.0");
  assert.doesNotMatch(install(pnpm).stdout, /Playwright:/);
  assert.doesNotMatch(check(pnpm).stdout, /playwright does not load/);
});
