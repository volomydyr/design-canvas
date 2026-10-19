/**
 * Tests for two changes that share one reader of the declaration (`declarations.mjs`):
 *
 *   VARIANTS. A screen may declare `variants: ["a", "b"]` (or a count) and the declaration expands into one frame per variant
 *   (`core/variants.ts`, which the core's own vitest suite holds). Here: the dump the capture and the preflight read carries
 *   the expanded frames, the lint names what points at the id that was expanded away, and the oracle's check that variants of
 *   one component are different pictures.
 *
 *   THE UPGRADE WARNING. `install-canvas.mjs` runs the NEW version's declaration checks over the declaration a project has
 *   today before it overwrites anything, lists every declaration the new version will fail as a warning, and installs (an upgrade once
 *   failed 33 existing edges without a word).
 *
 *   node --test tool/tests/variants-and-install.test.mjs
 *
 * Everything that bundles a declaration from source needs esbuild, which a project carries and the skill does not:
 *
 *   CANVAS_TEST_PROJECT=/path/to/project node --test tool/tests/variants-and-install.test.mjs
 *
 * NOT INSTALLED into a project: the installer copies only the files it lists.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

import { lintDeclaration, variantPictureProblems } from "../preflight-rules.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.join(HERE, "..", "..");
const TOOL = path.join(SKILL, "tool");
const PROJECT = process.env.CANVAS_TEST_PROJECT;
const made = [];
const scratch = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "canvas-variants-test-"));
  made.push(dir);
  return dir;
};
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});
const needsProject = (name, run) => (PROJECT ? test(name, run) : test(name, { skip: "set CANVAS_TEST_PROJECT to a project that has esbuild to run this test" }, run));

/* ------------------------------------------------------------------ the lint */

const frame = (id, extra = {}) => ({ id, flowId: "f", url: `/${id}`, ...extra });
const decl = (extra = {}) => ({
  screens: [frame("today"), frame("nav-a", { variantOf: "nav", variant: "a", url: "/nav?variant=a" }), frame("nav-b", { variantOf: "nav", variant: "b", url: "/nav?variant=b" })],
  groups: [{ id: "f", edges: [] }],
  explorations: [],
  kinds: [],
  ...extra,
});

test("variants frames are ordinary screens to the lint, and a declaration with them passes", () => {
  assert.deepEqual(lintDeclaration(decl()), []);
});

test("an arrow, an original, an `under` or a `redesigns` that names the id a variants screen expanded away is told to name a frame", () => {
  const problems = lintDeclaration(
    decl({
      groups: [{ id: "f", edges: [{ from: "today", to: "nav", label: "Opens the navigation" }] }],
      explorations: [{ id: "round", original: "nav", screens: [] }],
      screens: [
        frame("today", { redesigns: "nav" }),
        frame("nav-a", { variantOf: "nav", variant: "a", url: "/nav?variant=a" }),
        frame("nav-b", { variantOf: "nav", variant: "b", url: "/nav?variant=b", under: "nav" }),
      ],
    }),
  );
  assert.equal(problems.length, 4, problems.join("\n"));
  for (const line of problems) assert.match(line, /"nav", which declares variants and so is no frame itself: name one of its frames \(nav-a, nav-b\)/);
  assert.ok(problems.some((one) => one.includes("edge today → nav")));
  assert.ok(problems.some((one) => one.includes("exploration round: original")));
  assert.ok(problems.some((one) => one.includes("today: redesigns")));
  assert.ok(problems.some((one) => one.includes("nav-b: under")));
});

test("a frame name that collides with another screen says it is a frame of a variants screen", () => {
  const problems = lintDeclaration(decl({ screens: [...decl().screens, frame("nav-a", { url: "/elsewhere" })] }));
  assert.match(problems.join("\n"), /screen id "nav-a" is declared twice/);
});

test("variants of one component that were captured as the same picture are named, with the parameter to look at", () => {
  const screens = decl().screens;
  const same = variantPictureProblems(screens, [
    { screenId: "nav-a", hash: "h1" },
    { screenId: "nav-b", hash: "h1" },
    { screenId: "today", hash: "h1" },
  ]);
  assert.equal(same.length, 1);
  assert.match(same[0], /the variants "a" and "b" of "nav" were captured as the same picture: the page at \/nav does not show the variant that \?variant= names/);
  assert.deepEqual(variantPictureProblems(screens, [{ screenId: "nav-a", hash: "h1" }, { screenId: "nav-b", hash: "h2" }]), []);
  assert.deepEqual(variantPictureProblems(screens, [{ screenId: "nav-a", hash: "h1" }]), [], "a frame with no picture yet is the capture's to report");
});

/* ------------------------------------------------------------------ the dump */

/** A `design-canvas/` folder with the tools, the core's variants module and a declaration, and esbuild reachable from it. */
function canvasFolder(flows) {
  const root = scratch();
  const canvas = path.join(root, "design-canvas");
  mkdirSync(path.join(canvas, "project"), { recursive: true });
  mkdirSync(path.join(canvas, "core"), { recursive: true });
  for (const file of readdirSync(TOOL)) if (file.endsWith(".mjs")) copyFileSync(path.join(TOOL, file), path.join(canvas, file));
  copyFileSync(path.join(SKILL, "core", "variants.ts"), path.join(canvas, "core", "variants.ts"));
  writeFileSync(path.join(canvas, "project", "flows.ts"), flows);
  if (PROJECT) symlinkSync(path.join(PROJECT, "node_modules"), path.join(root, "node_modules"));
  return { root, canvas };
}

const FLOWS = `import type { CanvasDeclaration, CanvasRegistry } from "../core/types";
const base = { note: "Demo", viewport: { w: 1440, h: 900 }, frameScale: 0.8 };
export const LAB: CanvasDeclaration = {
  ...base,
  title: "Lab",
  flows: [{ id: "tour", title: "Tour", note: "A tour", edges: [], screens: [
    { id: "today", label: "Today", note: "Today", route: "/lab/today", kind: "Cards" },
    { id: "card", label: "Card", note: "One shape", route: "/lab/card", kind: "Cards", variants: ["chips", "tabs"], expect: "Shape {variant}" },
  ] }],
};
export const OTHER: CanvasDeclaration = { ...base, title: "Other", flows: [{ id: "o", title: "O", note: "O", edges: [], screens: [{ id: "x", label: "X", note: "X", route: "/x" }] }] };
export const CANVASES: CanvasRegistry = { lab: LAB, other: OTHER };
`;

needsProject("dump-screens expands variants, so the capture, the preflight and the round all see the frames the canvas draws", () => {
  const { canvas } = canvasFolder(FLOWS);
  const out = spawnSync(process.execPath, [path.join(canvas, "dump-screens.mjs"), "--canvas", "lab"], { cwd: path.dirname(canvas), encoding: "utf8" });
  assert.equal(out.status, 0, out.stderr);
  const dumped = JSON.parse(out.stdout);
  assert.deepEqual(
    dumped.screens.map((one) => [one.id, one.url, one.variantOf ?? null, one.label, one.expect ?? null]),
    [
      ["today", "/lab/today", null, "Today", null],
      ["card-chips", "/lab/card?variant=chips", "card", "Card Chips", ["Shape chips"]],
      ["card-tabs", "/lab/card?variant=tabs", "card", "Card Tabs", ["Shape tabs"]],
    ],
  );
});

needsProject("dump-screens --list names the canvases, and --dir reads another folder's declaration with this folder's rules", () => {
  const { canvas } = canvasFolder(FLOWS);
  const elsewhere = scratch();
  const list = spawnSync(process.execPath, [path.join(canvas, "dump-screens.mjs"), "--list"], { cwd: elsewhere, encoding: "utf8" });
  assert.deepEqual(JSON.parse(list.stdout), ["lab", "other"]);
  /* The skill's own copy (no core/ beside it) reading a project's folder: the installer's way of judging a declaration. */
  const viaDir = spawnSync(process.execPath, [path.join(TOOL, "dump-screens.mjs"), "--dir", canvas, "--canvas", "lab"], { cwd: path.dirname(canvas), encoding: "utf8" });
  assert.equal(viaDir.status, 0, viaDir.stderr);
  assert.equal(JSON.parse(viaDir.stdout).screens.length, 3, "expanded by the skill's own core/variants.ts");
});

needsProject("dump-screens names a variants screen it cannot expand in one line, and stops", () => {
  const { canvas } = canvasFolder(FLOWS.replace('variants: ["chips", "tabs"]', 'variants: ["solo"]'));
  const out = spawnSync(process.execPath, [path.join(canvas, "dump-screens.mjs"), "--canvas", "lab"], { cwd: path.dirname(canvas), encoding: "utf8" });
  assert.equal(out.status, 1);
  assert.match(out.stderr.trim(), /^1 screen\(s\) declare variants that cannot expand: screen "card": variants must hold from 2 to 12 names/);
  assert.equal(out.stderr.trim().split("\n").length, 1);
});

/* ------------------------------------------------------------------ the upgrade warning */

const BAD = `import type { CanvasDeclaration, CanvasRegistry } from "../core/types";
export const PLANNER: CanvasDeclaration = {
  title: "Planner", note: "A planner", viewport: { w: 1440, h: 900 }, frameScale: 0.8,
  flows: [{ id: "f", title: "Flow", note: "A flow", screens: [
    { id: "a", label: "A", note: "A", route: "/a", kind: "K" },
    { id: "b", label: "B", note: "B", route: "/b", kind: "K" },
  ], edges: [
    { from: "a", to: "b", label: "Goes to it" },
    { from: "b", to: "a", label: "Flips back" },
  ] }],
};
export const CANVASES: CanvasRegistry = { planner: PLANNER };
`;
const GOOD = BAD.replace('label: "Goes to it"', 'label: "Opens the second", noOrigin: "plain"').replace('label: "Flips back"', 'label: "Opens the first", noOrigin: "plain"');

/** A target project: a package.json, esbuild reachable, and a declaration already in `design-canvas/project/`. */
function target(flows, { installedRules } = {}) {
  const root = scratch();
  writeFileSync(path.join(root, "package.json"), "{}\n");
  symlinkSync(path.join(PROJECT, "node_modules"), path.join(root, "node_modules"));
  if (flows !== null) {
    mkdirSync(path.join(root, "design-canvas", "project"), { recursive: true });
    writeFileSync(path.join(root, "design-canvas", "project", "flows.ts"), flows);
  }
  if (installedRules) {
    /* The rules this project has installed: the skill's own (with everything they import, as a real install has), or a lenient
       older set that accepts whatever the declaration says. */
    if (installedRules === "same") {
      for (const file of readdirSync(TOOL)) if (file.endsWith(".mjs")) copyFileSync(path.join(TOOL, file), path.join(root, "design-canvas", file));
    } else {
      writeFileSync(path.join(root, "design-canvas", "preflight-rules.mjs"), "export const lintCopy = () => [];\nexport const lintDeclaration = () => [];\nexport const lintSteps = () => [];\n");
    }
  }
  return root;
}
const install = (root, ...flags) => spawnSync(process.execPath, [path.join(SKILL, "scripts", "install-canvas.mjs"), "--target", root, ...flags], { encoding: "utf8", cwd: root });

needsProject("an upgrade that will fail the declaration lists every failure as a warning and installs", () => {
  const root = target(BAD, { installedRules: "lenient" });
  const out = install(root);
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /Warning: the new version's declaration checks fail 4 thing\(s\) in this project's declaration that the installed version accepts/);
  assert.match(out.stdout, /planner\n\s+- flow "f": edge a → b: "Goes to it" does not start with an action or "When"/);
  assert.match(out.stdout, /edge b → a: "Flips back"/);
  assert.match(out.stdout, /Installing anyway/);
  assert.ok(existsSync(path.join(root, "design-canvas", "core", "variants.ts")));
  assert.ok(existsSync(path.join(root, "design-canvas", "browser-lifecycle.mjs")));
});

needsProject("what the installed version already fails is listed and does not block, because the upgrade did not cause it", () => {
  const root = target(BAD, { installedRules: "same" });
  const out = install(root);
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /4 thing\(s\) in the declaration already fail the installed version's checks, so this upgrade did not cause them/);
  /* Never followed by a line that says every canvas passes. */
  assert.doesNotMatch(out.stdout, /pass the new version's rules/);
  assert.match(out.stdout, /declaration checks: the new version's rules add nothing to the list above/);
  assert.ok(existsSync(path.join(root, "design-canvas", "core", "variants.ts")));
});

needsProject("with no installed rules to compare against, everything the new ones fail counts as new", () => {
  const root = target(BAD);
  const out = install(root);
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /Warning[^\n]*fail[\s\S]*Goes to it/);
});

needsProject("a variants screen the new core cannot expand is one of the things an upgrade warns about", () => {
  const root = target(GOOD.replace('{ id: "b", label: "B", note: "B", route: "/b", kind: "K" }', '{ id: "b", label: "B", note: "B", route: "/b", kind: "K", variants: ["only"] }'), { installedRules: "lenient" });
  const out = install(root);
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /planner\n\s+- 1 screen\(s\) declare variants that cannot expand: screen "b"/);
});

needsProject("a declaration that passes installs without a question, and the receipt says so; a fresh project has nothing to check", () => {
  const passing = install(target(GOOD, { installedRules: "same" }));
  assert.equal(passing.status, 0, passing.stderr);
  assert.match(passing.stdout, /declaration checks: 1 canvas\(es\) pass the new version's rules/);
  const fresh = target(null);
  const out = install(fresh);
  assert.equal(out.status, 0, out.stderr);
  assert.doesNotMatch(out.stdout, /declaration checks/);
  assert.ok(existsSync(path.join(fresh, "design-canvas", "live-pass.mjs")));
});

needsProject("the design system's lines for agents land in the project's own agent file, once, and a retired tool goes", () => {
  /* No agent file: none is created, the block is printed with where it belongs, and check-install notes it without failing on it. */
  const fresh = target(null);
  mkdirSync(path.join(fresh, "design-canvas", "core", "__tests__"), { recursive: true });
  writeFileSync(path.join(fresh, "design-canvas", "system-knowledge.mjs"), "// retired\n");
  writeFileSync(path.join(fresh, "design-canvas", "adopt.mjs"), "// retired\n");
  writeFileSync(path.join(fresh, "design-canvas", "core", "__tests__", "old.test.ts"), "// shipped once\n");
  const out = install(fresh);
  assert.equal(out.status, 0);
  const block = readFileSync(path.join(SKILL, "stubs", "agents-block.md"), "utf8").trim();
  assert.ok(!existsSync(path.join(fresh, "CLAUDE.md")) && !existsSync(path.join(fresh, "AGENTS.md")), "no agent file is created");
  assert.match(out.stdout, /Agent lines: this project has no CLAUDE\.md or AGENTS\.md, so none was written/);
  assert.ok(out.stdout.includes(block), "the lines are printed to copy");
  const checked = spawnSync(process.execPath, [path.join(SKILL, "scripts", "check-install.mjs"), "--target", fresh], { encoding: "utf8" });
  assert.match(checked.stdout, /notes:[\s\S]*neither CLAUDE\.md nor AGENTS\.md carries the design system lines/);
  assert.doesNotMatch(checked.stdout.split("FAILURE")[1] ?? "", /design system lines/, "a missing block is never a failure");
  assert.ok(!existsSync(path.join(fresh, "design-canvas", "system-knowledge.mjs")), "a tool the skill no longer ships is removed");
  assert.ok(!existsSync(path.join(fresh, "design-canvas", "adopt.mjs")), "the hand-run first-delivery step included");
  assert.ok(!existsSync(path.join(fresh, "design-canvas", "core", "__tests__")), "and so is a copy of the core's own tests");
  /* The project's own AGENTS.md, with its own words: the block goes there, after them, and a second install changes nothing. */
  const own = target(null);
  writeFileSync(path.join(own, "AGENTS.md"), "# Our rules\n\nUse tabs.\n");
  install(own);
  install(own);
  const text = readFileSync(path.join(own, "AGENTS.md"), "utf8");
  assert.ok(text.startsWith("# Our rules\n\nUse tabs.\n"), "the project's own lines are kept");
  assert.equal(text.split("<!-- design-canvas:agents").length, 2, "one block, however many installs");
  assert.ok(!existsSync(path.join(own, "CLAUDE.md")), "no second agent file");
  assert.match(text, /<!-- design-canvas:local begin -->\n\n<!-- design-canvas:agents/, "a local block: no commit carries it");
  /* The block stays on this machine by design, so an agent file git ignores is nothing to say. */
  const checkOwn = () => spawnSync(process.execPath, [path.join(SKILL, "scripts", "check-install.mjs"), "--target", own], { encoding: "utf8" }).stdout;
  execFileSync("git", ["init", "-q", own]);
  writeFileSync(path.join(own, ".gitignore"), "AGENTS.md\n");
  assert.doesNotMatch(checkOwn(), /git ignores AGENTS\.md/);
});

test("every module a shipped tool imports is a file in tool/, which the installer copies whole, so an install is never half done", () => {
  const missing = [];
  for (const file of readdirSync(TOOL)) {
    if (!file.endsWith(".mjs")) continue;
    for (const match of readFileSync(path.join(TOOL, file), "utf8").matchAll(/^\s*(?:import|export)\s[^"']*["']\.\/([\w.-]+\.mjs)["']/gm))
      if (!existsSync(path.join(TOOL, match[1]))) missing.push(`${file} imports ${match[1]}`);
  }
  assert.deepEqual(missing, []);
  assert.ok(execFileSync("node", ["--check", path.join(SKILL, "scripts", "install-canvas.mjs")]) !== null);
});

needsProject("the shipped starter declaration passes the version's own checks: the install's declaration checks and the preflight", () => {
  const root = target(readFileSync(path.join(SKILL, "stubs", "project-flows.starter.ts"), "utf8"), { installedRules: "lenient" });
  const out = install(root, "--checks", "no");
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /declaration checks: 1 canvas\(es\) pass the new version's rules/);
  /* The pages the starter names exist in this project; a missing one is named by the preflight. */
  for (const page of ["app/page.tsx", "app/second/page.tsx"]) {
    mkdirSync(path.dirname(path.join(root, page)), { recursive: true });
    writeFileSync(path.join(root, page), "export default function Page() { return null; }\n");
  }
  const preflight = spawnSync(process.execPath, [path.join(root, "design-canvas", "preflight.mjs"), "--canvas", "main"], { cwd: root, encoding: "utf8" });
  assert.match(preflight.stdout, /PREFLIGHT PASS\s*$/, preflight.stdout + preflight.stderr);
  rmSync(path.join(root, "app", "second", "page.tsx"));
  const missing = spawnSync(process.execPath, [path.join(root, "design-canvas", "preflight.mjs"), "--canvas", "main"], { cwd: root, encoding: "utf8" });
  assert.match(missing.stdout, /names the file app\/second\/page\.tsx and there is no such file/, missing.stdout + missing.stderr);
  assert.match(missing.stdout, /PREFLIGHT FAIL/);
  /* And it is still recognized as the starter, so check-install says to replace it. */
  const checked = spawnSync(process.execPath, [path.join(SKILL, "scripts", "check-install.mjs"), "--target", root], { cwd: root, encoding: "utf8" });
  assert.match(checked.stdout, /project\/flows\.ts is still the starter/);
});
