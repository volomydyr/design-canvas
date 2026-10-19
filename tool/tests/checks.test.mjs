/**
 * Tests for the reuse checks: the registry (`registry.mjs`), the verdicts (`checks.mjs`) and the hook's edit branch (`hook.mjs`).
 *
 *   node --test tool/tests/checks.test.mjs
 *
 * Everything runs in throwaway project folders. The declarations are injected, so nothing here needs esbuild, a browser, a
 * network or the framework. The hook is run as the real process Claude Code would start, with the edit on stdin, so what is
 * asserted is what an agent would see: the exact refusal text, silence, exit code 0, and the log lines.
 *
 * NOT INSTALLED into a project.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

import { addedItems, applyEdit, closestParts, importItems, isDesignWork, judgeEdit, matchesDesignFiles, parseReasons } from "../checks.mjs";
import { writeAnswer } from "../checks-answer.mjs";
import { filesReachedFrom } from "../closure.mjs";
import { readSettingsSafe } from "../project-settings.mjs";
import { REGISTRY_VERSION, buildRegistry, componentExports, exportedComponents, loadRegistry, stripComments } from "../registry.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOL = path.join(HERE, "..");
const made = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ the fixture project */

const jsx = (name, body = "") => `export function ${name}() {\n  return <div>${body || name}</div>;\n}\n`;

const FILES = {
  /* The design to build from: the Tasks list page and what it draws. */
  "app/tasks/page.tsx": `import { RecordTable } from "@/components/tasks/record-table";\nimport { TaskButton } from "@/components/tasks/ui-button";\nexport default function Page() {\n  return <RecordTable />;\n}\n`,
  "components/tasks/record-table.tsx": `import { StatusPill } from "@/components/tasks/status-pill";\n${jsx("RecordTable")}`,
  "components/tasks/status-pill.tsx": jsx("StatusPill"),
  "components/tasks/ui-button.tsx": `import { Button } from "@/components/ui/button";\nexport function TaskButton() {\n  return <Button>go</Button>;\n}\n`,
  "components/tasks/helpers.ts": `export const TASK_LIMIT = 5;\nexport function nothing() {}\n`,
  /* Today's code, not part of the design. */
  "components/ui/button.tsx": jsx("Button"),
  "components/library/region-breakdown.tsx": `export type Breakdown = { id: string };\n${jsx("RegionBreakdown")}`,
  "components/library/library-table.tsx": `export default function LibraryTable() {\n  return <table />;\n}\n`,
  "lib/format.ts": `export function formatDate(n: number) {\n  return String(n);\n}\nexport const LOCALE = "en-US";\n`,
  "hooks/use-library.ts": `export function useLibrary() {\n  return [];\n}\n`,
  /* The hi-fi file under work, and an ordinary today's file. */
  "app/library/hifi.tsx": `import { RecordTable } from "@/components/tasks/record-table";\nexport default function Hifi() {\n  return <RecordTable />;\n}\n`,
  "components/library/plain.tsx": jsx("Plain"),
};

const SETTINGS = {
  buildFrom: ["tasks"],
  designFiles: ["app/library/"],
};

const DECLARATIONS = [
  {
    slug: "tasks",
    declaration: {
      flows: [
        {
          id: "main",
          title: "Main",
          screens: [
            { id: "list", label: "Tasks list", source: ["app/tasks/page.tsx"] },
            { id: "explainer", label: "What happens", explain: "Text", source: ["components/library/library-table.tsx"] },
            { id: "ref", label: "Reference", reference: true, source: ["components/library/library-table.tsx"] },
            { id: "still", label: "Still", still: true, source: ["components/library/library-table.tsx"] },
            { id: "wire", label: "Wireframe", wireframe: "x.html", source: ["components/library/library-table.tsx"] },
          ],
        },
      ],
      explorations: [{ id: "e", title: "E", screens: [{ id: "opt", label: "Option", source: ["components/library/library-table.tsx"] }] }],
    },
  },
];

/**
 * Every module in `tool/`, which is what a fixture project installs.
 *
 * It used to be a list of the eight the hook imports, and a module added later
 * (`browser-guards.mjs` began importing `network.mjs`) was outside it: the hook then failed to import, its own guard
 * turned that into exit 0 with nothing printed, and EVERY hook test here read as "the edit was allowed". The hook is
 * silent by design when it cannot decide, so a missing module can never announce itself; the fixture therefore installs
 * what a real install does, and this class of failure is gone rather than fixed once.
 */
function toolModules() {
  return readdirSync(TOOL)
    .filter((name) => name.endsWith(".mjs"))
    .sort();
}

function git(root, ...args) {
  const run = spawnSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args], { cwd: root, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
}

/** A project on disk with the tools installed flat into design-canvas/, the registry cached, and the files committed. */
async function makeProject({ settings = SETTINGS, rawSettings = null, files = FILES, commit = true, declarations = DECLARATIONS } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "canvas-checks-test-"));
  made.push(root);
  const canvasDir = path.join(root, "design-canvas");
  mkdirSync(canvasDir, { recursive: true });
  for (const name of toolModules()) copyFileSync(path.join(TOOL, name), path.join(canvasDir, name));
  writeFileSync(path.join(canvasDir, "settings.json"), rawSettings ?? JSON.stringify(settings));
  for (const [rel, text] of Object.entries(files)) {
    const at = path.join(root, rel);
    mkdirSync(path.dirname(at), { recursive: true });
    writeFileSync(at, text);
  }
  /* The registry is cached the way the hook's own loadRegistry would, so the hook never needs esbuild. */
  const built = await buildRegistry({ root, canvasDir, settings: { buildFrom: settings.buildFrom ?? [] }, declarations });
  mkdirSync(path.join(canvasDir, "rounds"), { recursive: true });
  writeFileSync(path.join(canvasDir, "rounds", "registry.json"), JSON.stringify(built));
  git(root, "init", "-q");
  /* This machine's yes to the reuse checks, which the hook reads before it judges an edit. */
  answer(root, true);
  if (commit) {
    git(root, "add", "-A", "--", ".", ":!design-canvas");
    git(root, "commit", "-q", "-m", "fixture");
  }
  return { root, canvasDir };
}

/** Each project's answers file, inside its own .git so it goes with it. */
const answersFile = (root) => path.join(root, ".git", "canvas-answers.json");
/** Record this machine's answer for a project, as `install-canvas.mjs --checks` does. */
function answer(root, value) {
  const saved = process.env.CANVAS_ANSWERS_FILE;
  process.env.CANVAS_ANSWERS_FILE = answersFile(root);
  try {
    assert.ok(writeAnswer(root, value).ok);
  } finally {
    if (saved === undefined) delete process.env.CANVAS_ANSWERS_FILE;
    else process.env.CANVAS_ANSWERS_FILE = saved;
  }
}

/** Run the hook as Claude Code would. Returns what it printed, its exit status, and the parsed log. */
function runHook(project, payload, { env = {}, stdin = null } = {}) {
  const run = spawnSync(process.execPath, [path.join(project.canvasDir, "hook.mjs")], {
    input: stdin ?? JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, CANVAS_CHECKS_MODE: "", CANVAS_ANSWERS_FILE: answersFile(project.root), ...env },
  });
  const logFile = path.join(project.canvasDir, "rounds", "checks-log.jsonl");
  const log = existsSync(logFile)
    ? readFileSync(logFile, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
    : [];
  return { stdout: run.stdout, status: run.status, stderr: run.stderr, log, denied: run.stdout ? JSON.parse(run.stdout).hookSpecificOutput : null };
}

const edit = (project, rel, old_string, new_string, extra = {}) => ({
  tool_name: "Edit",
  tool_input: { file_path: path.join(project.root, rel), old_string, new_string, ...extra },
});
const write = (project, rel, content) => ({ tool_name: "Write", tool_input: { file_path: path.join(project.root, rel), content } });

const HIFI = "app/library/hifi.tsx";
const HIFI_FIRST_LINE = `import { RecordTable } from "@/components/tasks/record-table";\n`;

/* ------------------------------------------------------------------ registry */

test("registry: frames are the real built screens of the flows, explorations and the other kinds never count", async () => {
  const { root, canvasDir } = await makeProject();
  const registry = await buildRegistry({ root, canvasDir, settings: SETTINGS, declarations: DECLARATIONS });
  assert.deepEqual(Object.keys(registry.frames), ["tasks/list"]);
  assert.deepEqual(registry.frames["tasks/list"], { canvas: "tasks", label: "Tasks list" });
  assert.deepEqual(registry.buildFrom, ["tasks"]);
  /* The version is bumped whenever the detection changes, so an older cache is rebuilt rather than trusted. */
  assert.equal(registry.version, REGISTRY_VERSION);
});

test("registry: components are the JSX files with a capitalized export in the frames' closure, each with its frames", async () => {
  const { root, canvasDir } = await makeProject();
  const registry = await buildRegistry({ root, canvasDir, settings: SETTINGS, declarations: DECLARATIONS });
  assert.deepEqual(Object.keys(registry.components).sort(), [
    "app/tasks/page.tsx",
    "components/tasks/record-table.tsx",
    "components/tasks/status-pill.tsx",
    "components/tasks/ui-button.tsx",
    "components/ui/button.tsx",
  ]);
  assert.deepEqual(registry.components["components/tasks/record-table.tsx"], { exports: ["RecordTable"], frames: ["tasks/list"] });
  /* A non-JSX helper and a file nothing in the frames reaches are not components. */
  assert.equal(registry.components["components/tasks/helpers.ts"], undefined);
  assert.equal(registry.components["components/library/plain.tsx"], undefined);
});

test("registry: its closure is exactly the capture's walk, and every closure file and declaration file has a modification time", async () => {
  const { root, canvasDir } = await makeProject();
  const registry = await buildRegistry({ root, canvasDir, settings: SETTINGS, declarations: DECLARATIONS });
  for (const file of filesReachedFrom(["app/tasks/page.tsx"], root)) assert.equal(typeof registry.files[file], "number", file);
  assert.ok("design-canvas/settings.json" in registry.files);
  assert.ok("design-canvas/project/flows.ts" in registry.files);
});

test("registry: the cache is used while nothing changed and rebuilt when a file it was built from changes", async () => {
  const { root, canvasDir } = await makeProject();
  const cachePath = path.join(root, "cache.json");
  /* builtAt has millisecond resolution and a build of this fixture is faster than that, so each ask waits a tick. */
  const ask = async (settings = { buildFrom: ["tasks"] }) => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    return loadRegistry({ root, canvasDir, settings, cachePath, declarations: DECLARATIONS });
  };
  const first = await ask();
  assert.ok(existsSync(cachePath), "a cold load writes the cache");
  const warm = await ask();
  assert.equal(warm.builtAt, first.builtAt, "nothing changed: the cache answers");

  /* A file in a frame's closure changes: rebuilt. */
  const later = new Date(Date.now() + 60_000);
  utimesSync(path.join(root, "components/tasks/status-pill.tsx"), later, later);
  const rebuilt = await ask();
  assert.notEqual(rebuilt.builtAt, first.builtAt);
  assert.equal((await ask()).builtAt, rebuilt.builtAt, "and that rebuild is cached in turn");

  /* A new component joins a frame: the next load sees it. */
  writeFileSync(path.join(root, "components/tasks/status-pill.tsx"), `import { Extra } from "@/components/tasks/extra";\n${jsx("StatusPill")}`);
  writeFileSync(path.join(root, "components/tasks/extra.tsx"), jsx("Extra"));
  const grown = await ask();
  assert.ok(grown.components["components/tasks/extra.tsx"]);

  /* A different list of canvases is a different registry. */
  const other = await ask({ buildFrom: ["tasks", "calendar"] }).catch((error) => error);
  assert.notEqual(other?.builtAt, grown.builtAt);

  /* A stale or foreign cache version is never trusted. */
  writeFileSync(cachePath, JSON.stringify({ ...grown, version: 0, builtAt: "old" }));
  assert.notEqual((await ask()).builtAt, "old");
});

test("registry: no buildFrom means no registry", async () => {
  const { root, canvasDir } = await makeProject();
  assert.equal(await loadRegistry({ root, canvasDir, settings: { buildFrom: [] } }), null);
  assert.equal(await loadRegistry({ root, canvasDir, settings: {} }), null);
});

/* ------------------------------------------------------------------ parts of the verdicts */

test("parseReasons: reuse-check in any case, a target, then ', because' or a dash, and at least three words", () => {
  const text = [
    "// reuse-check: RegionBreakdown, because the library page needs the per-region grid",
    "/* REUSE-CHECK: LibraryGrid — this is a one-off surface for the library */",
    "{/* reuse-check: Foo - the table has no sticky header yet */}",
    "// reuse-check: Bar -- no card does the job here",
    "// reuse-check: Baz, because too short",
    "// reuse-check: Qux, because nope",
    "// just a comment",
  ].join("\n");
  assert.deepEqual(parseReasons(text), [
    { target: "RegionBreakdown", reason: "the library page needs the per-region grid" },
    { target: "LibraryGrid", reason: "this is a one-off surface for the library" },
    { target: "Foo", reason: "the table has no sticky header yet" },
    { target: "Bar", reason: "no card does the job here" },
  ]);
});

test("closestParts: shared words, ties to the part on more frames, nothing when no word is shared", () => {
  const registry = {
    frames: { "a/1": { label: "One" }, "a/2": { label: "Two" } },
    components: {
      "components/record-table.tsx": { exports: ["RecordTable"], frames: ["a/1"] },
      "components/data-table.tsx": { exports: ["DataTable"], frames: ["a/1", "a/2"] },
      "components/record-card.tsx": { exports: ["RecordCard"], frames: ["a/1"] },
    },
  };
  assert.deepEqual(closestParts(["library", "table"], registry, 2).map((one) => one.name), ["DataTable", "RecordTable"]);
  assert.deepEqual(closestParts(["record", "table"], registry, 3).map((one) => one.name), ["RecordTable", "DataTable", "RecordCard"]);
  assert.deepEqual(closestParts(["breakdown"], registry, 2), []);
  assert.equal(closestParts("LibraryTable", registry, 1)[0].name, "DataTable");
  assert.equal(closestParts("LibraryTable", registry, 1)[0].label, "One");
});

test("designFiles: a trailing slash is a folder, a star a glob, anything else one file", () => {
  assert.equal(matchesDesignFiles("app/library/hifi.tsx", ["app/library/"]), true);
  assert.equal(matchesDesignFiles("app/libraries/hifi.tsx", ["app/library/"]), false);
  assert.equal(matchesDesignFiles("components/a/b.hifi.tsx", ["components/**/*.hifi.tsx"]), true);
  assert.equal(matchesDesignFiles("components/b.hifi.tsx", ["components/**/*.hifi.tsx"]), true);
  assert.equal(matchesDesignFiles("components/a/b/c.hifi.tsx", ["components/*/*.hifi.tsx"]), false);
  assert.equal(matchesDesignFiles("components/a/c.hifi.tsx", ["components/*/*.hifi.tsx"]), true);
  assert.equal(matchesDesignFiles("app/x.tsx", ["app/x.tsx"]), true);
  assert.equal(matchesDesignFiles("app/xtsx", ["app/x.tsx"]), false);
});

test("import items: only what the edit adds is judged, by name, so a name already imported is never judged again", () => {
  const before = `import { A } from "@/x";\nimport type { T } from "@/t";\n`;
  const after = `import { A, B } from "@/x";\nimport type { T } from "@/t";\nimport D, * as NS from "@/d";\n`;
  assert.deepEqual(importItems(before).map((one) => [one.specifier, one.imported, one.isType]), [["@/x", "A", false], ["@/t", "T", true]]);
  assert.deepEqual(addedItems(before, after).map((one) => [one.specifier, one.imported, one.local]), [["@/x", "B", "B"], ["@/d", "default", "D"], ["@/d", "*", "NS"]]);
  assert.equal(applyEdit("a b a", { old_string: "a", new_string: "X" }), "X b a");
  assert.equal(applyEdit("a b a", { old_string: "a", new_string: "X", replace_all: true }), "X b X");
  assert.equal(applyEdit("a b a", { old_string: "z", new_string: "X" }), null);
});

test("design work: never the canvas, tests, dependencies or non-JSX; yes for a new file, a closure file, designFiles, a marker", () => {
  const registry = { files: { "components/tasks/record-table.tsx": 1 } };
  const settings = { designFiles: ["app/library/"], designMarkers: ["hifi"] };
  const ask = (rel, extra = {}) => isDesignWork({ rel, text: "", existed: true, registry, settings, isUntracked: () => false, ...extra });
  assert.equal(ask("design-canvas/project/x.tsx", { existed: false }), false);
  assert.equal(ask("node_modules/a/b.tsx", { existed: false }), false);
  assert.equal(ask(".next/a.tsx", { existed: false }), false);
  assert.equal(ask("components/__tests__/a.tsx", { existed: false }), false);
  assert.equal(ask("components/a.test.tsx", { existed: false }), false);
  assert.equal(ask("components/a.spec.tsx", { existed: false }), false);
  assert.equal(ask("lib/a.ts", { existed: false }), false);
  assert.equal(ask("components/new.tsx", { existed: false }), true);
  assert.equal(ask("components/tasks/record-table.tsx"), true);
  assert.equal(ask("app/library/x.tsx"), true);
  assert.equal(ask("components/m.tsx", { text: "// this is hifi work" }), true);
  assert.equal(ask("components/m.tsx", { text: "// this is hifidelity" }), false);
  assert.equal(ask("components/untracked.tsx", { isUntracked: () => true }), true);
  assert.equal(ask("components/tracked.tsx"), false);
});

/* ------------------------------------------------------------------ the hook: imports */

test("hook: logic from today's code is allowed, and so are types", async () => {
  const project = await makeProject();
  for (const added of [
    `import { formatDate, LOCALE } from "@/lib/format";`,
    `import { useLibrary } from "@/hooks/use-library";`,
    `import type { Breakdown } from "@/components/library/region-breakdown";`,
    `import { type Breakdown } from "@/components/library/region-breakdown";`,
    `import { TASK_LIMIT } from "@/components/tasks/helpers";`,
  ]) {
    const result = runHook(project, edit(project, HIFI, HIFI_FIRST_LINE, HIFI_FIRST_LINE + added + "\n"));
    assert.equal(result.stdout, "", added);
    assert.equal(result.status, 0);
  }
});

test("hook: the reuse checks and the recapture run only on this machine's yes, and a no or no answer lets the same edit through", async () => {
  const project = await makeProject();
  const line = `import { RegionBreakdown } from "@/components/library/region-breakdown";\n`;
  const refusal = () => runHook(project, edit(project, HIFI, HIFI_FIRST_LINE, HIFI_FIRST_LINE + line));
  assert.ok(refusal().denied, "refused with a yes");
  answer(project.root, false);
  assert.equal(refusal().stdout, "", "allowed with a no");
  const stop = { hook_event_name: "Stop", session_id: "s" };
  const log = path.join(project.canvasDir, "rounds", "recapture-log.txt");
  assert.equal(runHook(project, stop).stdout, "");
  assert.ok(!existsSync(log), "and the end of a turn starts no recapture");
  answer(project.root, true);
  assert.equal(runHook(project, stop, { env: { CANVAS_RECAPTURE_QUIET_MS: "0" } }).stdout, "");
  assert.ok(existsSync(log), "with a yes, the end of a turn starts the background recapture");
  rmSync(answersFile(project.root));
  assert.equal(refusal().stdout, "", "allowed with no answer at all");
});

test("hook: today's component imported into a hi-fi file is refused with the exact message, and logged", async () => {
  const project = await makeProject();
  const line = `import { RegionBreakdown } from "@/components/library/region-breakdown";\n`;
  const result = runHook(project, edit(project, HIFI, HIFI_FIRST_LINE, HIFI_FIRST_LINE + line));
  assert.equal(result.status, 0);
  assert.equal(result.denied.hookEventName, "PreToolUse");
  assert.equal(result.denied.permissionDecision, "deny");
  assert.equal(
    result.denied.permissionDecisionReason,
    "Today's RegionBreakdown (components/library/region-breakdown.tsx) is not part of the design new work builds from. " +
      "The parts it builds from are listed by: node design-canvas/registry.mjs. " +
      "If none fits, add a comment in the file, reuse-check: RegionBreakdown, because <reason>, and edit again.",
  );
  assert.equal(result.log.length, 1);
  assert.deepEqual({ ...result.log[0], at: "x" }, { at: "x", tool: "Edit", file: HIFI, check: "import", outcome: "refused", name: "RegionBreakdown", mode: "block" });
  assert.ok(!Number.isNaN(Date.parse(result.log.at(-1).at)));
});

test("hook: the refusal names the closest parts when a word is shared, in the exact words", async () => {
  const project = await makeProject();
  const line = `import LibraryTable from "@/components/library/library-table";\n`;
  const result = runHook(project, edit(project, HIFI, HIFI_FIRST_LINE, HIFI_FIRST_LINE + line));
  assert.equal(
    result.denied.permissionDecisionReason,
    `Today's LibraryTable (components/library/library-table.tsx) is not part of the design new work builds from. ` +
      `Build it with RecordTable (on 1 frame, like "Tasks list"). ` +
      `If none fits, add a comment in the file, reuse-check: LibraryTable, because <reason>, and edit again.`,
  );
});

test("hook: the same import is allowed when the module is a component of the design to build from", async () => {
  const project = await makeProject();
  const result = runHook(project, edit(project, HIFI, HIFI_FIRST_LINE, HIFI_FIRST_LINE + `import { StatusPill } from "@/components/tasks/status-pill";\n`));
  assert.equal(result.stdout, "");
  assert.equal(result.log.length, 0);
});

test("hook: a module that is itself design work (untracked, new, or named by designFiles) is allowed", async () => {
  const project = await makeProject();
  writeFileSync(path.join(project.root, "components/library/fresh.tsx"), jsx("Fresh"));
  const untracked = runHook(project, edit(project, HIFI, HIFI_FIRST_LINE, HIFI_FIRST_LINE + `import { Fresh } from "@/components/library/fresh";\n`));
  assert.equal(untracked.stdout, "");
  /* A module inside a designFiles folder, tracked: also design work. */
  writeFileSync(path.join(project.root, "app/library/panel.tsx"), jsx("Panel"));
  const named = runHook(project, edit(project, HIFI, HIFI_FIRST_LINE, HIFI_FIRST_LINE + `import { Panel } from "./panel";\n`));
  assert.equal(named.stdout, "");
});

test("hook: an import the file already had is not judged again", async () => {
  const files = {
    ...FILES,
    "app/library/hifi.tsx": `import { RegionBreakdown } from "@/components/library/region-breakdown";\nexport default function Hifi() {\n  return <RegionBreakdown />;\n}\n`,
  };
  const project = await makeProject({ files });
  const result = runHook(project, edit(project, HIFI, "return <RegionBreakdown />;", "return <RegionBreakdown id=\"1\" />;"));
  assert.equal(result.stdout, "");
  /* Adding a second name to the existing statement judges only the new name (a type is allowed). */
  const more = runHook(project, edit(project, HIFI, `import { RegionBreakdown }`, `import { RegionBreakdown, type Breakdown }`));
  assert.equal(more.stdout, "");
});

test("hook: a reason that names the module lets the edit through and is logged as given; two words do not", async () => {
  const project = await makeProject();
  const line = `import { RegionBreakdown } from "@/components/library/region-breakdown";\n`;
  const good = runHook(
    project,
    edit(project, HIFI, HIFI_FIRST_LINE, HIFI_FIRST_LINE + `// reuse-check: RegionBreakdown, because no part of the design shows per-region items\n` + line),
  );
  assert.equal(good.stdout, "");
  assert.equal(good.log.length, 1);
  assert.equal(good.log[0].outcome, "reason-given");
  assert.equal(good.log[0].check, "import");
  assert.equal(good.log[0].name, "RegionBreakdown");
  assert.equal(good.log[0].reason, "no part of the design shows per-region items");

  const short = runHook(project, edit(project, HIFI, HIFI_FIRST_LINE, HIFI_FIRST_LINE + `// reuse-check: RegionBreakdown, because it fits\n` + line));
  assert.ok(short.denied);

  /* A reason about some other component does not lift this refusal. */
  const other = runHook(project, edit(project, HIFI, HIFI_FIRST_LINE, HIFI_FIRST_LINE + `// reuse-check: SomethingElse, because it is a different thing entirely\n` + line));
  assert.ok(other.denied);
  /* The older upper-case spelling counts, and the module path can be the target. */
  const upper = runHook(project, edit(project, HIFI, HIFI_FIRST_LINE, HIFI_FIRST_LINE + `// REUSE-CHECK: components/library/region-breakdown.tsx, because the design lacks it\n` + line));
  assert.equal(upper.stdout, "");
});

test("hook: several refused imports in one edit come back as one message listing each", async () => {
  const project = await makeProject();
  const lines =
    `import { RegionBreakdown } from "@/components/library/region-breakdown";\n` +
    `import LibraryTable from "@/components/library/library-table";\n`;
  const result = runHook(project, edit(project, HIFI, HIFI_FIRST_LINE, HIFI_FIRST_LINE + lines));
  const reason = result.denied.permissionDecisionReason;
  assert.match(reason, /Today's RegionBreakdown/);
  assert.match(reason, /Today's LibraryTable/);
  assert.equal(result.log.length, 2);
});

/* ------------------------------------------------------------------ the hook: a file that does not exist yet */

const NEW_FILE = "components/library/library-grid.tsx";
const NEW_BODY = `export function LibraryGrid() {\n  return <div>grid</div>;\n}\n`;

/* A new file is design work, so its imports are judged like any other; a new component with nothing to refuse is simply allowed. */
const NEW_BAD = `import { RegionBreakdown } from "@/components/library/region-breakdown";\n${NEW_BODY}`;

test("hook: a new file is judged by its imports only, and a new component with nothing to refuse is allowed", async () => {
  const project = await makeProject();
  assert.equal(runHook(project, write(project, NEW_FILE, NEW_BODY)).stdout, "");
  assert.equal(runHook(project, write(project, NEW_FILE, NEW_BODY)).log.length, 0);
  const refused = runHook(project, write(project, NEW_FILE, NEW_BAD));
  assert.match(refused.denied.permissionDecisionReason, /^Today's RegionBreakdown/);
  assert.deepEqual({ ...refused.log[0], at: "x" }, { at: "x", tool: "Write", file: NEW_FILE, check: "import", outcome: "refused", name: "RegionBreakdown", mode: "block" });
  const lifted = runHook(project, write(project, NEW_FILE, `// reuse-check: RegionBreakdown, because no part of the design shows per-region items\n${NEW_BAD}`));
  assert.equal(lifted.stdout, "");
  assert.equal(lifted.log.at(-1).check, "import");
});

/* ------------------------------------------------------------------ the hook: what is never judged */

test("hook: files that are not design work are never judged", async () => {
  const project = await makeProject();
  const bad = `import { RegionBreakdown } from "@/components/library/region-breakdown";\n`;
  /* An ordinary tracked file of today's code. */
  assert.equal(runHook(project, edit(project, "components/library/plain.tsx", jsx("Plain").slice(0, 10), jsx("Plain").slice(0, 10).replace("export", bad + "export"))).stdout, "");
  /* Tests, specs, a __tests__ folder. */
  for (const rel of ["components/x.test.tsx", "components/x.spec.tsx", "components/__tests__/x.tsx"])
    assert.equal(runHook(project, write(project, rel, bad + NEW_BODY)).stdout, "", rel);
  /* A file that is not .tsx or .jsx. */
  assert.equal(runHook(project, write(project, "lib/new.ts", bad)).stdout, "");
  assert.equal(runHook(project, write(project, "README.md", bad)).stdout, "");
});

test("hook: a file under design-canvas/ is never judged", async () => {
  const project = await makeProject();
  const bad = `import { RegionBreakdown } from "@/components/library/region-breakdown";\n`;
  const result = runHook(project, write(project, "design-canvas/project/canvas-state-pin.tsx", bad + NEW_BODY));
  assert.equal(result.stdout, "");
  assert.equal(result.status, 0);
  assert.equal(result.log.length, 0);
});

test("hook: a file outside the project, and other tools, are not judged", async () => {
  const project = await makeProject();
  const outside = runHook(project, { tool_name: "Write", tool_input: { file_path: "/elsewhere/a.tsx", content: NEW_BODY } });
  assert.equal(outside.stdout, "");
  const bash = runHook(project, { tool_name: "Bash", tool_input: { command: "ls" } });
  assert.equal(bash.stdout, "");
  const read = runHook(project, { tool_name: "Read", tool_input: { file_path: path.join(project.root, NEW_FILE) } });
  assert.equal(read.stdout, "");
});

test("hook: a project reached through a symlink is still the project, and a new file under it is still judged", async () => {
  const project = await makeProject();
  const holder = mkdtempSync(path.join(tmpdir(), "canvas-checks-link-"));
  made.push(holder);
  const link = path.join(holder, "linked");
  symlinkSync(project.root, link);
  const bad = `import { RegionBreakdown } from "@/components/library/region-breakdown";\n`;
  const viaLink = runHook(project, { tool_name: "Edit", tool_input: { file_path: path.join(link, HIFI), old_string: HIFI_FIRST_LINE, new_string: HIFI_FIRST_LINE + bad } });
  assert.ok(viaLink.denied, "an edit addressed through the link is judged");
  assert.equal(viaLink.log[0].file, HIFI, "and logged with the project-relative path");
  const created = runHook(project, { tool_name: "Write", tool_input: { file_path: path.join(link, NEW_FILE), content: NEW_BAD } });
  assert.ok(created.denied);
});

test("hook: a design marker makes a tracked file design work", async () => {
  const project = await makeProject({ settings: { ...SETTINGS, designMarkers: ["canvas-hifi"] } });
  const bad = `import { RegionBreakdown } from "@/components/library/region-breakdown";\n`;
  const marked = runHook(project, edit(project, "components/library/plain.tsx", "export function Plain", bad + "// canvas-hifi\nexport function Plain"));
  assert.ok(marked.denied);
});

/* ------------------------------------------------------------------ the hook: it fails open */

test("hook: garbage on stdin, a settings typo and an empty buildFrom all print nothing and exit 0", async () => {
  const project = await makeProject();
  for (const stdin of ["", "not json", "{", "null", "[]", JSON.stringify({ tool_name: "Write" }), JSON.stringify({ tool_name: "Write", tool_input: { file_path: 5 } })]) {
    const result = runHook(project, null, { stdin });
    assert.equal(result.stdout, "", JSON.stringify(stdin));
    assert.equal(result.status, 0, JSON.stringify(stdin));
  }

  const typo = await makeProject({ rawSettings: `{ "buildfrom": ["tasks"] }` });
  const typoResult = runHook(typo, write(typo, NEW_FILE, NEW_BAD));
  assert.equal(typoResult.stdout, "");
  assert.equal(typoResult.status, 0, "an unknown settings key must not exit 2, which would block every edit");
  const broken = await makeProject({ rawSettings: `{ not json` });
  const brokenResult = runHook(broken, write(broken, NEW_FILE, NEW_BAD));
  assert.equal(brokenResult.stdout, "");
  assert.equal(brokenResult.status, 0);
  const wrongType = await makeProject({ rawSettings: `{ "buildFrom": "tasks" }` });
  assert.equal(runHook(wrongType, write(wrongType, NEW_FILE, NEW_BAD)).status, 0);

  const empty = await makeProject({ settings: { buildFrom: [] } });
  const emptyResult = runHook(empty, write(empty, NEW_FILE, NEW_BAD));
  assert.equal(emptyResult.stdout, "");
  assert.equal(emptyResult.status, 0);
  assert.equal(emptyResult.log.length, 0);
  const none = await makeProject({ rawSettings: `{}` });
  assert.equal(runHook(none, write(none, NEW_FILE, NEW_BAD)).stdout, "");
});

test("hook: a registry that cannot be built (a canvas that is not declared) fails open", async () => {
  const project = await makeProject({ settings: { buildFrom: ["nope"], designFiles: ["app/library/"] } });
  rmSync(path.join(project.canvasDir, "rounds", "registry.json"));
  const result = runHook(project, write(project, NEW_FILE, NEW_BAD));
  assert.equal(result.stdout, "");
  assert.equal(result.status, 0);
});

test("settings: readSettingsSafe returns the problem as one line and never exits the process", async () => {
  const project = await makeProject({ rawSettings: `{ "designMarkers": "hifi" }` });
  const { settings, error } = readSettingsSafe(project.canvasDir);
  assert.equal(settings, null);
  assert.match(error, /"designMarkers" must be a list of words/);
  assert.equal(error.includes("\n"), false);
  for (const bad of [`{ "designMarkers": [""] }`, `{ "designFiles": [1] }`, `{ "buildFrom": ["has space"] }`]) {
    writeFileSync(path.join(project.canvasDir, "settings.json"), bad);
    assert.equal(readSettingsSafe(project.canvasDir).settings, null, bad);
  }
  writeFileSync(path.join(project.canvasDir, "settings.json"), JSON.stringify({ ...SETTINGS, designMarkers: ["hifi"] }));
  const ok = readSettingsSafe(project.canvasDir);
  assert.equal(ok.error, null);
  assert.deepEqual(ok.settings.buildFrom, ["tasks"]);
  writeFileSync(path.join(project.canvasDir, "settings.json"), "{}");
  const empty = readSettingsSafe(project.canvasDir).settings;
  assert.deepEqual([empty.buildFrom, empty.designFiles, empty.designMarkers], [[], [], []]);
});

test("settings: a settings file that still names the removed via rule is refused as an unknown key, like any typo", async () => {
  const project = await makeProject({ rawSettings: `{ "buildFrom": ["tasks"], "via": { "@/components/ui/button": "@/components/tasks/ui-button" } }` });
  const { settings, error } = readSettingsSafe(project.canvasDir);
  assert.equal(settings, null);
  assert.match(error, /unknown key "via"/);
  assert.equal(error.includes("designMarkers, via"), false, "and it is not in the list of keys either");
  assert.equal(error.includes("\n"), false);
});

test("settings (defect 12): checksHook is not a settings key any more, and is not in what the settings return", async () => {
  const project = await makeProject();
  /* The install answer lives in a file on the machine, so the committed file refuses it like any other unknown key. */
  writeFileSync(path.join(project.canvasDir, "settings.json"), JSON.stringify({ ...SETTINGS, checksHook: true }));
  const refused = readSettingsSafe(project.canvasDir);
  assert.equal(refused.settings, null);
  assert.match(refused.error, /unknown key "checksHook"/);
  assert.equal(refused.error.includes("checksHook, "), false, "and it is not in the list of keys either");
  writeFileSync(path.join(project.canvasDir, "settings.json"), JSON.stringify(SETTINGS));
  assert.equal(Object.hasOwn(readSettingsSafe(project.canvasDir).settings, "checksHook"), false);
  writeFileSync(path.join(project.canvasDir, "settings.json"), "{}");
  assert.equal(Object.hasOwn(readSettingsSafe(project.canvasDir).settings, "checksHook"), false);
});

/* ------------------------------------------------------------------ modes and payload shapes */

test("hook: CANVAS_CHECKS_MODE=log logs the refusal but never denies", async () => {
  const project = await makeProject();
  const line = `import { RegionBreakdown } from "@/components/library/region-breakdown";\n`;
  const result = runHook(project, edit(project, HIFI, HIFI_FIRST_LINE, HIFI_FIRST_LINE + line), { env: { CANVAS_CHECKS_MODE: "log" } });
  assert.equal(result.stdout, "");
  assert.equal(result.status, 0);
  assert.equal(result.log.length, 1);
  assert.equal(result.log[0].outcome, "refused");
  assert.equal(result.log[0].mode, "log");
  const fresh = runHook(project, write(project, NEW_FILE, NEW_BAD), { env: { CANVAS_CHECKS_MODE: "log" } });
  assert.equal(fresh.stdout, "");
  assert.equal(fresh.log.at(-1).check, "import");
});

test("hook: Edit and MultiEdit payloads are applied before judging (replace_all, and edits in order)", async () => {
  const project = await makeProject();
  const bad = `import { RegionBreakdown } from "@/components/library/region-breakdown";`;
  /* The second edit only makes the import appear because the first one made its anchor exist. */
  const multi = runHook(project, {
    tool_name: "MultiEdit",
    tool_input: {
      file_path: path.join(project.root, HIFI),
      edits: [
        { old_string: HIFI_FIRST_LINE, new_string: HIFI_FIRST_LINE + "// anchor-one\n" },
        { old_string: "// anchor-one", new_string: bad },
      ],
    },
  });
  assert.ok(multi.denied, "the second edit applies to the text the first one made");
  /* A MultiEdit whose reason sits in a different edit's new_string still counts: reasons are read from every new_string. */
  const withReason = runHook(project, {
    tool_name: "MultiEdit",
    tool_input: {
      file_path: path.join(project.root, HIFI),
      edits: [
        { old_string: HIFI_FIRST_LINE, new_string: HIFI_FIRST_LINE + bad + "\n" },
        { old_string: "export default function Hifi", new_string: "// reuse-check: RegionBreakdown, because the design has no such grid\nexport default function Hifi" },
      ],
    },
  });
  assert.equal(withReason.stdout, "");
  assert.equal(withReason.log.at(-1).outcome, "reason-given");
  /* An edit whose old text is not in the file cannot apply: the tool will refuse it itself, the hook stays silent. */
  const missing = runHook(project, edit(project, HIFI, "THIS TEXT IS NOT THERE", bad));
  assert.equal(missing.stdout, "");
  assert.equal(missing.status, 0);
  /* Edit with replace_all: every occurrence becomes the import, and the file is judged after. */
  const all = runHook(project, edit(project, HIFI, "<RecordTable />", `<RecordTable />;\n${bad}\n<X />`, { replace_all: true }));
  assert.ok(all.denied);
  /* A Write to an existing hi-fi file judges the whole new content. */
  const rewrite = runHook(project, write(project, HIFI, bad + "\nexport default function Hifi() {\n  return <div />;\n}\n"));
  assert.ok(rewrite.denied);
});

test("judgeEdit: with no registry nothing is judged, and the verdict can be asked for directly", async () => {
  const project = await makeProject();
  const registry = JSON.parse(readFileSync(path.join(project.canvasDir, "rounds", "registry.json"), "utf8"));
  const context = {
    root: project.root,
    rel: HIFI,
    existed: true,
    before: HIFI_FIRST_LINE,
    after: HIFI_FIRST_LINE + `import LibraryTable from "@/components/library/library-table";\n`,
    written: [`import LibraryTable from "@/components/library/library-table";\n`],
    registry,
    settings: SETTINGS,
    isUntracked: () => false,
  };
  assert.equal(judgeEdit({ ...context, registry: null }).message, null);
  const verdict = judgeEdit(context);
  assert.equal(verdict.design, true);
  assert.deepEqual(verdict.refused, [{ check: "import", name: "LibraryTable" }]);
});

/* ------------------------------------------------------------------ the developer's own: an exploration's original screen */

/** A second canvas whose exploration redesigns today's library page: the page and what it draws are the developer's own. */
const WITH_ORIGINAL = [
  ...DECLARATIONS,
  {
    slug: "library",
    declaration: {
      flows: [{ id: "today", title: "Today", screens: [{ id: "library-page", label: "Library page", source: ["app/library-page.tsx"] }] }],
      explorations: [{ id: "redo", title: "Redo", original: "library-page", screens: [{ id: "redo-a", label: "Option A", redesigns: "library-page", source: [HIFI] }] }],
    },
  },
];
const LIBRARY_PAGE = {
  ...FILES,
  "app/library-page.tsx": `import { RegionBreakdown } from "@/components/library/region-breakdown";\nexport default function LibraryPage() {\n  return <RegionBreakdown />;\n}\n`,
};

test("registry: the component files an exploration's original screen draws are recorded as the developer's own, on any canvas", async () => {
  const { root, canvasDir } = await makeProject({ files: LIBRARY_PAGE, declarations: WITH_ORIGINAL });
  const registry = await buildRegistry({ root, canvasDir, settings: SETTINGS, declarations: WITH_ORIGINAL });
  assert.deepEqual(registry.originals, ["app/library-page.tsx", "components/library/region-breakdown.tsx"]);
  assert.equal(registry.components["components/library/region-breakdown.tsx"], undefined, "the developer's own is not the design to build from");
  assert.deepEqual(Object.keys(registry.frames), ["tasks/list"], "only the build-from canvases give frames");
  assert.equal(typeof registry.files["app/library-page.tsx"], "number", "a change to the original screen rebuilds the registry");
  /* With no exploration there is nothing of the developer's own. */
  assert.deepEqual((await buildRegistry({ root, canvasDir, settings: SETTINGS, declarations: DECLARATIONS })).originals, []);
});

test("hook: a component the redesigned screen's original already draws is allowed; any other today's component is still refused", async () => {
  const project = await makeProject({ files: LIBRARY_PAGE, declarations: WITH_ORIGINAL });
  const kept = runHook(project, addToHifi(project, TODAY));
  assert.equal(kept.denied, null, `keeping the original's own component is allowed: ${kept.stdout}`);
  const other = runHook(project, addToHifi(project, `import { Plain } from "@/components/library/plain";\n`));
  assert.ok(other.denied, "a today's component the original does not draw is refused as before");
  assert.match(reasonOf(other), /Today's Plain \(components\/library\/plain\.tsx\) is not part of the design new work builds from/);
  assert.ok(other.log.some((one) => one.outcome === "refused" || one.refused), `the refusal is logged as before: ${JSON.stringify(other.log)}`);
  const reasoned = runHook(project, addToHifi(project, `import { Plain } from "@/components/library/plain";\n// reuse-check: Plain, because the empty state is the same\n`));
  assert.equal(reasoned.denied, null, "the written reason still lifts a refusal");
  /* Control: the same edit without the exploration is refused, so it is the original that allows it. */
  const plain = await makeProject();
  assert.ok(runHook(plain, addToHifi(plain, TODAY)).denied);
});

/* ================================================================== the fix round: defects 1 to 12 of the review */

const TODAY = `import { RegionBreakdown } from "@/components/library/region-breakdown";\n`;
/** An Edit of the hi-fi file that adds these lines after its first line. */
const addToHifi = (project, lines) => edit(project, HIFI, HIFI_FIRST_LINE, HIFI_FIRST_LINE + lines);
const reasonOf = (result) => result.denied?.permissionDecisionReason ?? "";

/* ------------------------------------------------------------------ 1: the hook never exits non-zero */

test("defect 1: a canvas file that is missing, or broken, ends the hook in exit 0 with nothing on stdout or stderr", async () => {
  const project = await makeProject();
  const payload = addToHifi(project, TODAY);
  assert.ok(runHook(project, payload).denied, "control: with every file in place the edit is refused");
  /* Every module the hook's own import graph reaches, `network.mjs` included since browser-guards began importing it. */
  for (const name of ["registry.mjs", "checks.mjs", "declarations.mjs", "browser-guards.mjs", "browser-lifecycle.mjs", "closure.mjs", "project-settings.mjs", "network.mjs"]) {
    const file = path.join(project.canvasDir, name);
    const original = readFileSync(file, "utf8");
    try {
      rmSync(file);
      const missing = runHook(project, payload);
      assert.equal(missing.status, 0, `${name} missing: exit status`);
      assert.equal(missing.stdout, "", `${name} missing: stdout`);
      assert.equal(missing.stderr, "", `${name} missing: stderr`);
      writeFileSync(file, "export const = ;;; {{{ this is not javascript");
      const broken = runHook(project, payload);
      assert.equal(broken.status, 0, `${name} broken: exit status`);
      assert.equal(broken.stdout, "", `${name} broken: stdout`);
      assert.equal(broken.stderr, "", `${name} broken: stderr`);
    } finally {
      writeFileSync(file, original);
    }
  }
  assert.ok(runHook(project, payload).denied, "and with the files back the check works again");
});

/* ------------------------------------------------------------------ 2: what is a component */

test("defect 2: a component is a function, an arrow, a function expression or a memo/forwardRef/lazy call; a constant is logic", () => {
  const text = [
    `export function Plain() { return <a />; }`,
    `export async function AsyncOne() { return <a />; }`,
    `export const Arrow = () => <a />;`,
    `export const ArrowBody = ({ a, b = fn() }: Props) => { return <a />; };`,
    `export const SingleParam = props => <a />;`,
    `export const AsyncArrow = async () => <a />;`,
    `export const Generic = <T,>(props: P<T>) => <a />;`,
    `export const Typed: React.FC<Props> = (props) => <a />;`,
    `export const TypedFn: (a: string) => JSX.Element = (a) => <a />;`,
    `export const ReturnType = (a: string): JSX.Element => <a />;`,
    `export const Expr = function () { return <a />; };`,
    `export const NamedExpr = function Inner() { return <a />; };`,
    `export const Memoed = memo(function Inner() { return <a />; });`,
    `export const Forwarded = forwardRef<HTMLDivElement, Props>((props, ref) => <a />);`,
    `export const Lazied = lazy(() => import("./x"));`,
    `export const ReactMemo = React.memo(Inner);`,
    `export const ReactForward = React.forwardRef((props, ref) => <a />);`,
    `export class Klass extends React.Component {}`,
    /* Not components. */
    `export const Spacing = "3rem";`,
    `export const FormSchema = z.object({ a: z.string() });`,
    `export const FormContext = createContext(null);`,
    `export const BarHeight = 3.25;`,
    `export const Config = { a: 1 };`,
    `export const Call = (1 + 2) * 3;`,
    `export const Typed2: Record<string, number> = { a: 1 };`,
    `export const ALL_CAPS = () => <a />;`,
    `export const useThing = () => 1;`,
    `export class ApiError extends Error {}`,
    `export function useHook() {}`,
  ].join("\n");
  assert.deepEqual(componentExports(text).named, [
    "Plain", "AsyncOne", "Klass", "Arrow", "ArrowBody", "SingleParam", "AsyncArrow", "Generic", "Typed", "TypedFn", "ReturnType", "Expr", "NamedExpr", "Memoed", "Forwarded", "Lazied", "ReactMemo", "ReactForward",
  ]);
  /* A comment never makes one. */
  assert.deepEqual(exportedComponents(`// export const Ghost = () => <a />;\n/* export function Shadow() {} */\n`), []);
});

test("defect 2: type arguments holding a function type still declare a component", () => {
  /* `<[^()]*>` could not cross a parenthesis, so a wrapper whose props type was written inline with any FUNCTION prop read
     as logic: the component was missing from the registry, never refused in design work and never suggested in another
     part's place. Real codebases declare many components through a wrapper with type arguments. */
  const found = componentExports(
    [
      `export const MenuRow = forwardRef<HTMLButtonElement, { label: string; onSelect?: () => void }>((p, r) => <a />);`,
      `export const Spread = React.forwardRef<\n  HTMLDivElement,\n  { onDone?: (value: string) => void }\n>((p, r) => <a />);`,
      `export const Memoed = React.memo<{ onX?: () => void }>((p) => <a />);`,
      `export const Lazied2 = lazy<{ onX?: () => void }>(() => import("./x"));`,
      `const Inner = (p) => <a />;`,
      `export const Watched = observer<{ onX?: () => void }>(Inner);`,
      /* Still logic: a call that is not a wrapper, whatever its type arguments hold. */
      `export const Total = sum<{ f?: () => void }>(items);`,
      `export const Shape = z.object<{ f?: () => void }>({ a: 1 });`,
    ].join("\n"),
  );
  assert.deepEqual(found.named.sort(), ["Lazied2", "Memoed", "MenuRow", "Spread", "Watched"]);
  /* An unterminated type argument list cannot hang the scan or invent a component. */
  assert.deepEqual(componentExports(`export const Broken = forwardRef<HTMLDivElement, { a: (`).named, []);
});

test("defect 2: export lists and default exports count only when the local declaration is a component", () => {
  const text = [
    `const Local = () => <a />;`,
    `const Limit = 5;`,
    `function Fn() { return <a />; }`,
    `export { Local, Limit, Fn as Renamed, Local as default };`,
  ].join("\n");
  const found = componentExports(text);
  assert.deepEqual(found.named.sort(), ["Local", "Renamed"]);
  assert.equal(found.defaultName, "Local");
  assert.equal(componentExports(`const Schema = z.object({});\nexport default Schema;\n`).defaultName, null);
  assert.equal(componentExports(`const Panel = () => <a />;\nexport default Panel;\n`).defaultName, "Panel");
  assert.equal(componentExports(`export default function Page() { return <a />; }\n`).defaultName, "Page");
  assert.equal(componentExports(`const Panel = () => <a />;\nexport default memo(Panel);\n`).defaultName, "Panel");
  assert.equal(componentExports(`export default function useThing() {}\n`).defaultName, null);
  /* A re-export from elsewhere is not a declaration in this file. */
  assert.deepEqual(componentExports(`export { Other } from "./other";\n`).named, []);
});

test("defect 2: a constant, a schema or a context from today's code is allowed, the components next to it are refused, and the registry omits them", async () => {
  const mixed =
    `import { z } from "zod";\nimport { createContext } from "react";\n` +
    `export const Spacing = "3rem";\nexport const FormSchema = z.object({ a: z.string() });\n` +
    `export const FormContext = createContext(null);\nexport const BarHeight = 3.25;\n` +
    `export function LibraryPanel() {\n  return <div />;\n}\nexport const LibraryChip = () => <i />;\n`;
  const files = {
    ...FILES,
    "components/library/mixed.tsx": mixed,
    "components/tasks/mixed.tsx": mixed.replace("LibraryPanel", "TaskPanel").replace("LibraryChip", "TaskChip"),
    "app/tasks/page.tsx": `import { TaskPanel } from "@/components/tasks/mixed";\n` + FILES["app/tasks/page.tsx"],
  };
  const project = await makeProject({ files });
  const registry = JSON.parse(readFileSync(path.join(project.canvasDir, "rounds", "registry.json"), "utf8"));
  assert.deepEqual(registry.components["components/tasks/mixed.tsx"].exports, ["TaskPanel", "TaskChip"]);
  const constants = TODAY.replace(/^.*$/m, `import { Spacing, FormSchema, FormContext, BarHeight } from "@/components/library/mixed";`);
  const allowed = runHook(project, addToHifi(project, constants));
  assert.equal(allowed.stdout, "", "logic is never refused");
  assert.equal(allowed.log.length, 0);
  const refused = runHook(project, addToHifi(project, `import { LibraryPanel, LibraryChip, FormSchema } from "@/components/library/mixed";\n`));
  assert.match(reasonOf(refused), /Today's LibraryPanel \(components\/library\/mixed\.tsx\)/);
  assert.match(reasonOf(refused), /Today's LibraryChip \(components\/library\/mixed\.tsx\)/);
  assert.doesNotMatch(reasonOf(refused), /FormSchema/);
  /* The same names, through the registry's own copy of the file, are allowed (it is part of the design). */
  const design = runHook(project, addToHifi(project, `import { TaskPanel, TaskChip, FormSchema } from "@/components/tasks/mixed";\n`));
  assert.equal(design.stdout, "");
});

/* ------------------------------------------------------------------ 3: barrels */

const BARREL_FILES = {
  "components/trash/index.ts": `export * from "./trash-grid-view";\nexport * from "./trash-consts";\n`,
  "components/trash/trash-grid-view.tsx": jsx("TrashGridView"),
  "components/trash/trash-consts.ts": `export const TRASH_LIMIT = 3;\nexport function useTrash() {\n  return [];\n}\n`,
  "components/kit/index.ts": `export { default as Panel } from "./panel";\nexport { Chip as KitChip } from "./chip";\nexport type { ChipProps } from "./chip";\nexport * as Everything from "./chip";\n`,
  "components/kit/panel.tsx": `export default function Panel() {\n  return <div />;\n}\n`,
  "components/kit/chip.tsx": `export type ChipProps = { a: string };\n${jsx("Chip")}`,
  "components/kit/bound.ts": `import { Chip } from "./chip";\nimport Panel from "./panel";\nexport { Chip, Panel as BoundPanel };\n`,
  "components/loop/a.ts": `export * from "./b";\n`,
  "components/loop/b.ts": `export * from "./a";\n`,
  "components/tasks/index.ts": `export * from "./status-pill";\n`,
  /* A chain of five re-exports ends in a component; a chain of six is not followed. */
  ...Object.fromEntries([0, 1, 2, 3, 4].map((i) => [`components/chain5/c${i}.ts`, `export * from "./c${i + 1}";\n`])),
  "components/chain5/c5.tsx": jsx("DeepFive"),
  ...Object.fromEntries([0, 1, 2, 3, 4, 5].map((i) => [`components/chain6/c${i}.ts`, `export * from "./c${i + 1}";\n`])),
  "components/chain6/c6.tsx": jsx("DeepSix"),
};

test("defect 3: an import through a barrel is judged by the file that really defines the name", async () => {
  const project = await makeProject({ files: { ...FILES, ...BARREL_FILES } });
  const trash = runHook(project, addToHifi(project, `import { TrashGridView } from "@/components/trash";\n`));
  assert.match(reasonOf(trash), /^Today's TrashGridView \(components\/trash\/trash-grid-view\.tsx\) is not part of the design new work builds from\./);
  assert.equal(trash.log[0].name, "TrashGridView");
  /* Logic and types through the same barrel are logic. */
  const logic = runHook(project, addToHifi(project, `import { TRASH_LIMIT, useTrash } from "@/components/trash";\nimport type { ChipProps } from "@/components/kit";\n`));
  assert.equal(logic.stdout, "");
  /* Renamed and default re-exports, and the import-then-export spelling. */
  assert.match(reasonOf(runHook(project, addToHifi(project, `import { Panel } from "@/components/kit";\n`))), /Today's Panel \(components\/kit\/panel\.tsx\)/);
  assert.match(reasonOf(runHook(project, addToHifi(project, `import { KitChip } from "@/components/kit";\n`))), /Today's KitChip \(components\/kit\/chip\.tsx\)/);
  assert.match(reasonOf(runHook(project, addToHifi(project, `import { Chip } from "@/components/kit/bound";\n`))), /Today's Chip \(components\/kit\/chip\.tsx\)/);
  assert.match(reasonOf(runHook(project, addToHifi(project, `import { BoundPanel } from "@/components/kit/bound";\n`))), /Today's BoundPanel \(components\/kit\/panel\.tsx\)/);
  /* The relative spelling of a folder import finds the same barrel. */
  assert.ok(runHook(project, addToHifi(project, `import { TrashGridView } from "../../components/trash";\n`)).denied);
  /* A barrel over a component that IS part of the design lets it through. */
  assert.equal(runHook(project, addToHifi(project, `import { StatusPill } from "@/components/tasks";\n`)).stdout, "");
  /* An unknown name, and a name only a namespace export carries, are not judged. */
  assert.equal(runHook(project, addToHifi(project, `import { Nothing } from "@/components/trash";\n`)).stdout, "");
  assert.equal(runHook(project, addToHifi(project, `import { Everything } from "@/components/kit";\n`)).stdout, "");
  /* A reason naming the component, or the barrel's path, lifts it. */
  const reason = `// reuse-check: TrashGridView, because the design has no trash grid at all\n`;
  assert.equal(runHook(project, addToHifi(project, reason + `import { TrashGridView } from "@/components/trash";\n`)).stdout, "");
  const byPath = `// reuse-check: @/components/trash, because the design has no trash grid at all\n`;
  assert.equal(runHook(project, addToHifi(project, byPath + `import { TrashGridView } from "@/components/trash";\n`)).stdout, "");
});

test("defect 3: re-exports are followed up to five levels, and a cycle of barrels ends instead of hanging", async () => {
  const project = await makeProject({ files: { ...FILES, ...BARREL_FILES } });
  assert.match(reasonOf(runHook(project, addToHifi(project, `import { DeepFive } from "@/components/chain5/c0";\n`))), /Today's DeepFive \(components\/chain5\/c5\.tsx\)/, "five hops are followed");
  assert.equal(runHook(project, addToHifi(project, `import { DeepSix } from "@/components/chain6/c0";\n`)).stdout, "", "six hops are not");
  const loop = runHook(project, addToHifi(project, `import { Ghost } from "@/components/loop/a";\n`));
  assert.equal(loop.status, 0);
  assert.equal(loop.stdout, "");
});

/* ------------------------------------------------------------------ 4: dynamic imports */

test("defect 4: dynamic imports are judged, whatever wraps them", async () => {
  const project = await makeProject({ files: { ...FILES, ...BARREL_FILES } });
  const dynamicLine = `const Panel = dynamic(() => import("@/components/library/region-breakdown"));\n`;
  const result = runHook(project, addToHifi(project, dynamicLine + `import { formatDate } from "@/lib/format";\n`));
  assert.match(reasonOf(result), /Today's RegionBreakdown \(components\/library\/region-breakdown\.tsx\)/);
  assert.equal(result.log[0].name, "RegionBreakdown");
  /* A default component through lazy(), and a bare import() with no wrapper at all. */
  assert.match(reasonOf(runHook(project, addToHifi(project, `const Table = lazy(() => import("@/components/library/library-table"));\n`))), /Today's LibraryTable \(components\/library\/library-table\.tsx\)/);
  assert.match(reasonOf(runHook(project, addToHifi(project, `async function go() {\n  await import('@/components/library/library-table');\n}\n`))), /Today's LibraryTable/);
  /* Through a barrel and with spaces inside the parentheses. */
  assert.match(reasonOf(runHook(project, addToHifi(project, `const K = lazy(() => import( "@/components/kit/panel" ));\n`))), /Today's Panel \(components\/kit\/panel\.tsx\)/);
  /* Logic, a package, a part of the design and a commented-out call are all allowed. */
  for (const line of [
    `const f = () => import("@/lib/format");\n`,
    `const z = () => import("zod");\n`,
    `const s = dynamic(() => import("@/components/tasks/status-pill"));\n`,
    `// const x = dynamic(() => import("@/components/library/library-table"));\n`,
  ])
    assert.equal(runHook(project, addToHifi(project, line)).stdout, "", line);
  /* A reason lifts it like any other, and is logged as given. */
  const lifted = runHook(project, addToHifi(project, `// reuse-check: RegionBreakdown, because no part of the design shows per-region items\n` + dynamicLine));
  assert.equal(lifted.stdout, "");
  assert.equal(lifted.log.at(-1).outcome, "reason-given");
});

/* ------------------------------------------------------------------ 5: suggestions skip icons */

test("defect 5: the suggestions skip icon parts and fall back to the registry line when only icons share a word", () => {
  const many = Array.from({ length: 102 }, (_, i) => `a/${i}`);
  const registry = {
    frames: { "a/1": { label: "One" } },
    components: {
      "components/ui/icons.tsx": { exports: ["LocationIcon", "SortIcon", "PlusIcon", "GridIcon"], frames: many },
      "components/common/icons.tsx": { exports: ["MediaThing"], frames: many },
      "components/ui/toggle.tsx": { exports: ["ToggleGroup", "ToggleIcon"], frames: ["a/1"] },
      "components/tasks/location-table.tsx": { exports: ["LocationTable"], frames: ["a/1"] },
    },
  };
  assert.deepEqual(closestParts(["item", "location", "breakdown"], registry, 2).map((one) => one.name), ["LocationTable"]);
  assert.deepEqual(closestParts("ToggleGroup", registry, 2).map((one) => one.name), ["ToggleGroup"]);
  assert.deepEqual(closestParts(["media", "thing"], registry, 2), [], "a file called icons.* is skipped whole");
  assert.deepEqual(closestParts(["add", "item", "card"], registry, 2), [], "nothing but icons shares a word: no suggestion");
  assert.deepEqual(closestParts(["grid", "view"], registry, 2), []);
});

test("defect 5: with only icons sharing a word, the refusal points at the registry listing", async () => {
  const project = await makeProject();
  const file = path.join(project.canvasDir, "rounds", "registry.json");
  const registry = JSON.parse(readFileSync(file, "utf8"));
  registry.components["components/ui/icons.tsx"] = { exports: ["LocationIcon", "SortIcon"], frames: ["tasks/list"] };
  writeFileSync(file, JSON.stringify(registry));
  const result = runHook(project, addToHifi(project, TODAY));
  assert.equal(
    reasonOf(result),
    "Today's RegionBreakdown (components/library/region-breakdown.tsx) is not part of the design new work builds from. " +
      "The parts it builds from are listed by: node design-canvas/registry.mjs. " +
      "If none fits, add a comment in the file, reuse-check: RegionBreakdown, because <reason>, and edit again.",
  );
});

/* ------------------------------------------------------------------ 6: a check that cannot run says so in the log */

test("defect 6: invalid settings still allow the edit, and leave one error line in the log, at most one a minute", async () => {
  const project = await makeProject({ rawSettings: JSON.stringify({ buildFrom: ["tasks"], flagPct: 150 }) });
  const first = runHook(project, write(project, NEW_FILE, NEW_BAD));
  assert.equal(first.stdout, "");
  assert.equal(first.status, 0);
  assert.equal(first.log.length, 1);
  assert.equal(first.log[0].check, "settings");
  assert.equal(first.log[0].outcome, "error");
  assert.match(first.log[0].reason, /flagPct/);
  assert.equal(first.log[0].reason.includes("\n"), false);
  assert.ok(!Number.isNaN(Date.parse(first.log[0].at)));
  /* A second edit within the minute adds nothing. */
  assert.equal(runHook(project, write(project, NEW_FILE, NEW_BAD)).log.length, 1);
  /* An error line older than a minute does not count: the next one is logged. */
  const logFile = path.join(project.canvasDir, "rounds", "checks-log.jsonl");
  writeFileSync(logFile, JSON.stringify({ at: new Date(Date.now() - 120_000).toISOString(), check: "settings", outcome: "error", reason: "old" }) + "\n");
  const later = runHook(project, write(project, NEW_FILE, NEW_BAD));
  assert.equal(later.log.length, 2);
  assert.equal(later.log[1].check, "settings");
  /* Other settings problems read the same way. */
  for (const bad of [{ appUrl: "localhost:3000" }, { port: 99999 }]) {
    const other = await makeProject({ rawSettings: JSON.stringify({ buildFrom: ["tasks"], ...bad }) });
    const result = runHook(other, write(other, NEW_FILE, NEW_BAD));
    assert.equal(result.stdout, "");
    assert.equal(result.status, 0);
    assert.deepEqual(result.log.map((one) => [one.check, one.outcome]), [["settings", "error"]], JSON.stringify(bad));
  }
});

test("defect 6: a registry that cannot be built (an unknown canvas) still allows the edit and logs one registry error line", async () => {
  const project = await makeProject({ settings: { buildFrom: ["ordres"], designFiles: ["app/library/"] } });
  rmSync(path.join(project.canvasDir, "rounds", "registry.json"));
  const result = runHook(project, write(project, NEW_FILE, NEW_BAD));
  assert.equal(result.stdout, "");
  assert.equal(result.status, 0);
  assert.equal(result.log.length, 1);
  assert.equal(result.log[0].check, "registry");
  assert.equal(result.log[0].outcome, "error");
  assert.equal(typeof result.log[0].reason, "string");
  assert.ok(result.log[0].reason.length > 0);
  assert.equal(result.log[0].reason.includes("\n"), false);
  assert.equal(runHook(project, write(project, NEW_FILE, NEW_BAD)).log.length, 1, "and again within the minute adds nothing");
});

/* ------------------------------------------------------------------ 7: reasons and comments */

test("defect 7: a reason line is read with CRLF line ends too", async () => {
  assert.deepEqual(parseReasons("// reuse-check: Foo, because this is the reason\r\n// reuse-check: Bar -- another fine reason\r\n"), [
    { target: "Foo", reason: "this is the reason" },
    { target: "Bar", reason: "another fine reason" },
  ]);
  const project = await makeProject();
  const crlf = `// reuse-check: RegionBreakdown, because no part of the design shows per-region items\r\n` + TODAY;
  const result = runHook(project, addToHifi(project, crlf));
  assert.equal(result.stdout, "");
  assert.equal(result.log.at(-1).outcome, "reason-given");
});

test("defect 7: comments are taken out before imports are read, and a comment inside the braces does not hide one", async () => {
  /* A `//` comment goes wherever it stands; a block comment goes at the start of a line and inside an import, not mid-line. */
  assert.equal(stripComments(`a // b\nc /* d */ e "x//y" 'p/*q' \`r//s\``), `a \nc /* d */ e "x//y" 'p/*q' \`r//s\``);
  assert.equal(stripComments(`a\n  /* d */ e\n/** doc\n * more */ f`), `a\n    e\n  f`);
  assert.deepEqual(importItems(`// was: import { Zed } from "z"\n/* import { Zod } from "zz" */\nimport A from "a" // import { Zip } from "zi"\n`).map((one) => [one.specifier, one.imported]), [["a", "default"]]);
  assert.deepEqual(importItems(`import {\n  // note about X\n  X,\n  /* and Y */ Y as Z,\n} from "./x";\n`).map((one) => [one.specifier, one.imported, one.local]), [["./x", "X", "X"], ["./x", "Y", "Z"]]);
  const project = await makeProject();
  for (const line of [
    `// was: import { RegionBreakdown } from "@/components/library/region-breakdown"\n`,
    `/* import { RegionBreakdown } from "@/components/library/region-breakdown" */\n`,
    `import { formatDate } from "@/lib/format"; // import { RegionBreakdown } from "@/components/library/region-breakdown"\n`,
  ])
    assert.equal(runHook(project, addToHifi(project, line)).stdout, "", line);
  const inBraces = `import {\n  // the grid\n  RegionBreakdown,\n} from "@/components/library/region-breakdown";\n`;
  assert.match(reasonOf(runHook(project, addToHifi(project, inBraces))), /Today's RegionBreakdown/);
});

/* ------------------------------------------------------------------ 8: an Edit that creates a file */

test("defect 8: an Edit or MultiEdit with an empty old_string on a file that does not exist is judged as a Write of the new text", async () => {
  const project = await makeProject();
  const viaEdit = runHook(project, { tool_name: "Edit", tool_input: { file_path: path.join(project.root, NEW_FILE), old_string: "", new_string: NEW_BAD } });
  assert.match(reasonOf(viaEdit), /^Today's RegionBreakdown/);
  assert.deepEqual({ ...viaEdit.log[0], at: "x" }, { at: "x", tool: "Edit", file: NEW_FILE, check: "import", outcome: "refused", name: "RegionBreakdown", mode: "block" });
  const viaMulti = runHook(project, { tool_name: "MultiEdit", tool_input: { file_path: path.join(project.root, NEW_FILE), edits: [{ old_string: "", new_string: NEW_BAD }] } });
  assert.match(reasonOf(viaMulti), /^Today's RegionBreakdown/);
  /* The text the first step wrote can be edited by the next step. */
  const chained = runHook(project, {
    tool_name: "MultiEdit",
    tool_input: { file_path: path.join(project.root, NEW_FILE), edits: [{ old_string: "", new_string: "export function LibraryGrid() {\n  return <div>grid</div>;\n}\n" }, { old_string: "export function", new_string: TODAY + "export function" }] },
  });
  assert.match(reasonOf(chained), /Today's RegionBreakdown/);
  /* A reason lifts the refusal. */
  const lifted = runHook(project, { tool_name: "Edit", tool_input: { file_path: path.join(project.root, NEW_FILE), old_string: "", new_string: `// reuse-check: RegionBreakdown, because no part of the design shows per-region items\n${NEW_BAD}` } });
  assert.equal(lifted.stdout, "");
  assert.equal(lifted.log.at(-1).outcome, "reason-given");
  /* A new file with no import to refuse is allowed. */
  assert.equal(runHook(project, { tool_name: "Edit", tool_input: { file_path: path.join(project.root, NEW_FILE), old_string: "", new_string: NEW_BODY } }).stdout, "");
  /* Where there is nothing to create, nothing to judge: an empty old_string on a file that exists, a real old_string on one that does not. */
  assert.equal(runHook(project, { tool_name: "Edit", tool_input: { file_path: path.join(project.root, HIFI), old_string: "", new_string: TODAY } }).stdout, "");
  assert.equal(runHook(project, { tool_name: "Edit", tool_input: { file_path: path.join(project.root, NEW_FILE), old_string: "nope", new_string: NEW_BODY } }).stdout, "");
  assert.equal(applyEdit("", { old_string: "", new_string: "x" }, true), "x");
  assert.equal(applyEdit("abc", { old_string: "", new_string: "x" }, false), null);
});

/* ------------------------------------------------------------------ 9: the registry notices a file that appears later */

test("defect 9: a file created where an unresolved import already pointed makes the registry rebuild, in an existing folder and in a new one", async () => {
  const files = {
    ...FILES,
    "app/tasks/page.tsx": `import { Late } from "@/components/tasks/late";\nimport { Thing } from "@/components/newer/thing";\n` + FILES["app/tasks/page.tsx"],
  };
  const { root, canvasDir } = await makeProject({ files });
  const cachePath = path.join(root, "cache.json");
  const ask = () => loadRegistry({ root, canvasDir, settings: { buildFrom: ["tasks"] }, cachePath, declarations: DECLARATIONS });
  const first = await ask();
  assert.equal(first.components["components/tasks/late.tsx"], undefined);
  assert.deepEqual(Object.keys(first.folders).sort(), ["components/newer", "components/tasks"].sort());
  assert.equal(first.folders["components/newer"], null, "a folder that does not exist yet is recorded as absent");
  assert.equal((await ask()).builtAt, first.builtAt, "nothing changed: the cache answers");

  writeFileSync(path.join(root, "components/tasks/late.tsx"), jsx("Late"));
  const soon = new Date(Date.now() + 60_000);
  utimesSync(path.join(root, "components/tasks"), soon, soon);
  const second = await ask();
  assert.ok(second.components["components/tasks/late.tsx"], "the new file in an existing folder is in the registry");
  assert.equal((await ask()).builtAt, second.builtAt, "and that rebuild is cached");

  mkdirSync(path.join(root, "components/newer"));
  writeFileSync(path.join(root, "components/newer/thing.tsx"), jsx("Thing"));
  const third = await ask();
  assert.ok(third.components["components/newer/thing.tsx"], "a file in a folder that did not exist is in the registry");

  /* A cache written before folders were recorded is never trusted. */
  const { folders, ...old } = third;
  writeFileSync(cachePath, JSON.stringify({ ...old, builtAt: "old" }));
  assert.notEqual((await ask()).builtAt, "old");
});

/* ------------------------------------------------------------------ 10: outside the project means going up */

test("defect 10: a folder merely named ..foo is inside the project, and a real way up is outside", async () => {
  const project = await makeProject();
  const inside = runHook(project, { tool_name: "Write", tool_input: { file_path: path.join(project.root, "..foo", "x.tsx"), content: NEW_BAD } });
  assert.match(reasonOf(inside), /^Today's RegionBreakdown/);
  assert.equal(inside.log[0].file, "..foo/x.tsx");
  const above = runHook(project, { tool_name: "Write", tool_input: { file_path: path.join(project.root, "..", "x.tsx"), content: NEW_BAD } });
  assert.equal(above.stdout, "");
  assert.equal(above.log.length, 1, "nothing was added to the log by the edit above the project (the one line is from the ..foo edit)");
  const root =runHook(project, { tool_name: "Write", tool_input: { file_path: project.root, content: NEW_BAD } });
  assert.equal(root.stdout, "");
});

/* ------------------------------------------------------------------ 11: spellings */

test("defect 11: designFiles entries starting with ./ are normalized, and imports with no spaces are read", async () => {
  assert.equal(matchesDesignFiles("app/library/x.tsx", ["./app/library/"]), true);
  assert.equal(matchesDesignFiles("app/x.tsx", ["./app/x.tsx"]), true);
  assert.equal(matchesDesignFiles("components/a/b.hifi.tsx", ["./components/**/*.hifi.tsx"]), true);
  assert.equal(matchesDesignFiles("app/libraries/x.tsx", ["./app/library/"]), false);
  const project = await makeProject({ settings: { ...SETTINGS, designFiles: ["./app/library/"] } });
  assert.match(reasonOf(runHook(project, addToHifi(project, TODAY))), /Today's RegionBreakdown/, "the ./ entry makes the hi-fi file design work");

  assert.deepEqual(importItems(`import{A,B as C}from"a";import D from'd';import*as NS from"n";export{E}from"e";import type{T}from"t";`).map((one) => [one.keyword, one.specifier, one.imported, one.local, one.isType]), [
    ["import", "a", "A", "A", false],
    ["import", "a", "B", "C", false],
    ["import", "d", "default", "D", false],
    ["import", "n", "*", "NS", false],
    ["export", "e", "E", "E", false],
    ["import", "t", "T", "T", true],
  ]);
  const compact = runHook(project, addToHifi(project, `import{RegionBreakdown}from"@/components/library/region-breakdown";\n`));
  assert.match(reasonOf(compact), /Today's RegionBreakdown/);
  /* The long whitespace run the review timed is read in linear time now. */
  const started = Date.now();
  importItems("import " + " ".repeat(20000));
  assert.ok(Date.now() - started < 300, `a long run of spaces took ${Date.now() - started} ms`);
});

/* ================================================================== the second fix round: four gaps of the second verifier */

/* ------------------------------------------------------------------ gap 1: a slash-star that is not a comment */

test("gap 1: a slash-star in a regex literal or in JSX text is not a comment, so the imports after it are still read", async () => {
  const TODAY_SPEC = "@/components/library/region-breakdown";
  const specifiers = (text) => importItems(text).map((one) => one.specifier);
  /* The text is kept whole, and the import after it is seen. */
  for (const before of [`const re = /[/*]/;\n`, `const re = /a\\/*b/;\n`, `const t = <p>a /* b</p>;\n`, `const re = /[/*]/; const s = "x";\n`]) {
    assert.equal(stripComments(before + TODAY), before + TODAY, before);
    assert.deepEqual(specifiers(before + TODAY), [TODAY_SPEC], before);
  }
  const project = await makeProject();
  for (const before of [`const re = /[/*]/;\n`, `const t = <p>a /* b</p>;\n`])
    assert.match(reasonOf(runHook(project, addToHifi(project, before + TODAY))), /Today's RegionBreakdown/, before);
  /* A block comment at the start of a line (after spaces, or behind another one) and one inside an import statement still go. */
  assert.deepEqual(specifiers(`  /* import { A } from "a" */\nimport B from "b";\n/* x */ /* import { C } from "c" */\n`), ["b"]);
  assert.equal(stripComments(`/* one */ /* two */ x`), `    x`);
  assert.deepEqual(importItems(`import /* c */ A /* d */, { /* e */ B } from /* f */ "m";\nexport { /* g */ H } from "h";\nexport * /* i */ as NS from "n";\n`).map((one) => [one.keyword, one.specifier, one.imported, one.local]), [
    ["import", "m", "B", "B"],
    ["import", "m", "default", "A"],
    ["export", "h", "H", "H"],
    ["export", "n", "*", "NS"],
  ]);
  /* A plain export list loses its comments too, and a clause that is no import or export-from leaves a slash-star alone. */
  assert.equal(stripComments(`export { A, /* x */ B };\nconst r = /[/*]/;`), `export { A,   B };\nconst r = /[/*]/;`);
  assert.equal(stripComments(`export const a = { b: 1 }; const re = /[/*]/;`), `export const a = { b: 1 }; const re = /[/*]/;`);
  assert.equal(stripComments(`import("x" /* y */);`), `import("x" /* y */);`);
  /* The documented cost: a block comment trailing code that talks about an import is read as that import (stricter, never looser). */
  assert.deepEqual(specifiers(`foo(); /* import { Z } from "z" */\n`), ["z"]);
  /* Linear on the shapes the review used to time. */
  for (const junk of ["/*".repeat(300000), "import {a".repeat(5000), "import ".repeat(20000), "export { a ".repeat(5000), "/".repeat(2000000)]) {
    const started = Date.now();
    stripComments(junk);
    assert.ok(Date.now() - started < 1500, `${junk.slice(0, 12)} took ${Date.now() - started} ms`);
  }
});

/* ------------------------------------------------------------------ gaps 2 and 3: dynamic imports and namespaces through a barrel */

const SECOND_ROUND_FILES = {
  ...BARREL_FILES,
  "components/logic-barrel/index.ts": `export * from "./fns";\n`,
  "components/logic-barrel/fns.ts": `export const FN_LIMIT = 2;\nexport function useFns() {\n  return [];\n}\n`,
  /* A barrel with a default export of its own: `export *` does not carry it, a namespace import does. */
  "components/withdefault/index.ts": `export { default } from "./main";\nexport * from "./extra";\n`,
  "components/withdefault/main.tsx": `export default function MainOne() {\n  return <div />;\n}\n`,
  "components/withdefault/extra.tsx": jsx("ExtraOne"),
};

test("gap 2: a dynamic import of a barrel with no default export is followed like a static one, and judged by what it re-exports", async () => {
  const project = await makeProject({ files: { ...FILES, ...SECOND_ROUND_FILES } });
  /* Through `export *`, bare, inside lazy() and with a then(): the component behind the barrel is named. */
  for (const line of [
    `const A = dynamic(() => import("@/components/trash"));\n`,
    `const A = lazy(() => import("@/components/trash").then((m) => ({ default: m.TrashGridView })));\n`,
    `async function go() {\n  return await import('../../components/trash');\n}\n`,
  ]) {
    const result = runHook(project, addToHifi(project, line));
    assert.match(reasonOf(result), /^Today's TrashGridView \(components\/trash\/trash-grid-view\.tsx\) is not part of the design new work builds from\./, line);
    assert.equal(result.log[0].name, "TrashGridView");
  }
  /* Through a renamed re-export (the name the barrel gives it), and five levels down. */
  assert.match(reasonOf(runHook(project, addToHifi(project, `const A = lazy(() => import("@/components/kit/bound"));\n`))), /Today's Chip \(components\/kit\/chip\.tsx\)/);
  assert.match(reasonOf(runHook(project, addToHifi(project, `const A = lazy(() => import("@/components/chain5/c0"));\n`))), /Today's DeepFive \(components\/chain5\/c5\.tsx\)/);
  /* A barrel of logic, a barrel over the design, six levels, a cycle and a package are all allowed. */
  for (const line of [
    `const f = () => import("@/components/logic-barrel");\n`,
    `const f = () => import("@/components/tasks");\n`,
    `const f = () => import("@/components/chain6/c0");\n`,
    `const f = () => import("@/components/loop/a");\n`,
  ]) {
    const result = runHook(project, addToHifi(project, line));
    assert.equal(result.stdout, "", line);
    assert.equal(result.status, 0);
  }
  /* A reason naming the barrel lifts it, and it is logged as given. */
  const lifted = runHook(project, addToHifi(project, `// reuse-check: @/components/trash, because the design has no trash grid at all\nconst A = lazy(() => import("@/components/trash"));\n`));
  assert.equal(lifted.stdout, "");
  assert.equal(lifted.log.at(-1).outcome, "reason-given");
});

test("gap 3: a namespace import of a barrel is judged as importing every component the barrel re-exports, and names each today's one", async () => {
  const project = await makeProject({ files: { ...FILES, ...SECOND_ROUND_FILES } });
  const asked = (line) => runHook(project, addToHifi(project, line));
  const trash = asked(`import * as Trash from "@/components/trash";\n`);
  assert.equal(trash.status, 0);
  assert.match(reasonOf(trash), /^Today's TrashGridView \(components\/trash\/trash-grid-view\.tsx\) is not part of the design new work builds from\./);
  assert.equal(trash.log[0].name, "TrashGridView");
  /* `export * as ns from` in the edited file is the same thing. */
  assert.match(reasonOf(asked(`export * as TrashKit from "@/components/trash";\n`)), /Today's TrashGridView/);
  /* A barrel of renames, defaults and a nested namespace: every today's component is named once, the logic is not. */
  const kit = reasonOf(asked(`import * as Kit from "@/components/kit";\n`));
  assert.match(kit, /Today's Panel \(components\/kit\/panel\.tsx\)/);
  assert.match(kit, /Today's Chip \(components\/kit\/chip\.tsx\)/);
  assert.equal(kit.split("\n").length, 2, kit);
  assert.doesNotMatch(kit, /ChipProps/);
  /* The barrel's own default export is part of the namespace, and a module reached through `export *` gives no default. */
  const withDefault = reasonOf(asked(`import * as W from "@/components/withdefault";\n`));
  assert.match(withDefault, /Today's MainOne \(components\/withdefault\/main\.tsx\)/);
  assert.match(withDefault, /Today's ExtraOne \(components\/withdefault\/extra\.tsx\)/);
  /* Straight at a module, a default component and a named one. */
  assert.match(reasonOf(asked(`import * as S from "@/components/library/library-table";\n`)), /Today's LibraryTable \(components\/library\/library-table\.tsx\)/);
  assert.match(reasonOf(asked(`import * as P from "@/components/library/region-breakdown";\n`)), /Today's RegionBreakdown/);
  /* Five levels are followed, six are not, a cycle ends. */
  assert.match(reasonOf(asked(`import * as D from "@/components/chain5/c0";\n`)), /Today's DeepFive \(components\/chain5\/c5\.tsx\)/);
  for (const line of [
    `import * as D from "@/components/chain6/c0";\n`,
    `import * as L from "@/components/loop/a";\n`,
    /* Logic, a barrel of logic, a barrel over a component of the design, the design itself, a type-only namespace, a package. */
    `import * as Fmt from "@/lib/format";\n`,
    `import * as Fns from "@/components/logic-barrel";\n`,
    `import * as Tasks from "@/components/tasks";\n`,
    `import * as Pill from "@/components/tasks/status-pill";\n`,
    `import type * as T from "@/components/trash";\n`,
    `import * as Z from "zod";\n`,
  ]) {
    const result = asked(line);
    assert.equal(result.stdout, "", line);
    assert.equal(result.status, 0);
  }
  /* A named import of the namespace export is still not judged (it names no component), as before. */
  assert.equal(asked(`import { Everything } from "@/components/kit";\n`).stdout, "");
  /* A reason naming the barrel, or one component, lifts what it names. */
  const byBarrel = asked(`// reuse-check: @/components/kit, because the design has no kit at all\nimport * as Kit from "@/components/kit";\n`);
  assert.equal(byBarrel.stdout, "");
  assert.equal(byBarrel.log.filter((one) => one.outcome === "reason-given").length, 2);
  const byOne = reasonOf(asked(`// reuse-check: Panel, because the design has no panel at all\nimport * as Kit from "@/components/kit";\n`));
  assert.doesNotMatch(byOne, /Today's Panel/);
  assert.match(byOne, /Today's Chip/);
});

/* ------------------------------------------------------------------ gap 4: a component made as an alias of another */

const TOGGLE_GROUP = `"use client"

import * as React from "react"
import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group"
import { type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { toggleVariants } from "@/components/ui/toggle"


const ToggleGroupContext = React.createContext<
  VariantProps<typeof toggleVariants>
>({
  size: "default",
  variant: "default",
})

function ToggleGroup({
  className,
  variant,
  size,
  children,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root> &
  VariantProps<typeof toggleVariants>) {
  return (
    <ToggleGroupPrimitive.Root
      data-slot="toggle-group"
      className={cn("group/toggle-group flex w-fit items-center rounded-md", className)}
      {...props}
    >
      <ToggleGroupContext.Provider value={{ variant, size }}>
        {children}
      </ToggleGroupContext.Provider>
    </ToggleGroupPrimitive.Root>
  )
}

function ToggleGroupItem({ className, children, variant, size, ...props }: React.ComponentProps<typeof ToggleGroupPrimitive.Item> & VariantProps<typeof toggleVariants>) {
  const context = React.useContext(ToggleGroupContext)
  return (
    <ToggleGroupPrimitive.Item data-slot="toggle-group-item" {...props}>
      {children}
    </ToggleGroupPrimitive.Item>
  )
}

export { ToggleGroup, ToggleGroupItem }
`;

test("gap 4: an alias is a component: a member expression ending in a capitalized name, a call handed a capitalized name, a styled template", () => {
  const text = [
    /* The file draws the namespaces and the components the aliases below point at, which is what makes them components. */
    `export function Marker() { return <i><DialogPrimitive.Root /><Radix.Tooltip.Provider /><Radix.Menu.Item /><Panel /><Button /></i>; }`,
    `export const Dialog = DialogPrimitive.Root;`,
    `export const Deep = Radix.Tooltip.Provider`,
    `export const Spaced = Radix . Menu . Item ;`,
    `export const Observed = observer(Panel);`,
    `export const Authed = withAuth(Panel);`,
    `export const Typed = observer<Props>(Panel, { a: 1 });`,
    `export const Wrapped = styled(Button);`,
    `export const Tagged = styled(Button)\`color: red;\`;`,
    `export const Div = styled.div\`color: red;\`;`,
    `export const Attrs = styled.div.attrs({ a: 1 })\`color: red;\`;`,
    `export const Generic = styled.span<{ a: string }>\`color: red;\`;`,
    `export const Mui = styled("div")(({ theme }) => ({}));`,
    `export const Twin = tw.div\`flex\`;`,
    /* Not aliases. */
    `export const Setting = Config.defaults;`,
    `export const Version = Package.VERSION;`,
    `export const Called = Radix.Root();`,
    `export const Chained = Radix.Root.displayName;`,
    `export const Sum = Radix.Root + 1;`,
    `export const Context = createContext(Panel);`,
    `export const Frozen = Object.freeze(Panel);`,
    `export const Shape = z.object(Base);`,
    `export const Hooked = useThing(Panel);`,
    `export const Lower = observer(panel);`,
    `export const Number5 = observer(5);`,
    `export const AllCaps = observer(PANEL);`,
  ].join("\n");
  assert.deepEqual(componentExports(text).named, ["Marker", "Dialog", "Deep", "Spaced", "Observed", "Authed", "Typed", "Wrapped", "Tagged", "Div", "Attrs", "Generic", "Mui", "Twin"]);
  /* A styled template counts only when the file draws JSX. */
  assert.deepEqual(componentExports("const Panel = () => null;\nexport const Div = styled.div`color: red;`;\nexport const Obs = observer(Panel);").named, ["Obs"]);
  /* A local alias exported in a list, as the shadcn dialog does it, and a default export that is an alias or a wrapper. */
  assert.deepEqual(componentExports(`const Dialog = DialogPrimitive.Root;\nconst Content = React.forwardRef<A, B>((p, r) => <DialogPrimitive.Content ref={r} />);\nconst NOTE = Radix.Thing;\nexport { Dialog, Content as DialogContent, NOTE };\n`).named, ["Dialog", "DialogContent"]);
  assert.equal(componentExports(`const Menu = Radix.Root;\nconst Use = () => <Radix.Root />;\nexport default Menu;\n`).defaultName, "Menu");
  assert.equal(componentExports(`const Panel = () => <i />;\nexport default observer(Panel);\n`).defaultName, "Panel");
  assert.equal(componentExports(`const Panel = () => <i />;\nexport default withAuth(Panel, { a: 1 });\n`).defaultName, "Panel");
  assert.equal(componentExports(`const Panel = () => <i />;\nexport default createStore(Panel);\n`).defaultName, null);
  assert.deepEqual(exportedComponents(`const Panel = () => <DialogPrimitive.Root />;\nexport const Dialog = DialogPrimitive.Root;\nexport default observer(Panel);\n`), ["Dialog", "Panel"]);
  /* ToggleGroup (a function declaration, exported in a list) is a component either way: the alias rules add nothing to it and take nothing away. */
  assert.deepEqual(componentExports(TOGGLE_GROUP), { named: ["ToggleGroup", "ToggleGroupItem"], defaultName: null });
  assert.deepEqual(exportedComponents(TOGGLE_GROUP), ["ToggleGroup", "ToggleGroupItem"]);
});

test("gap 4: aliases are in the registry, and an alias of today's code imported into design work is refused", async () => {
  const aliases = (suffix) =>
    `import * as DialogPrimitive from "@radix-ui/react-dialog";\nconst Spacer = () => <DialogPrimitive.Close />;\nexport const ${suffix}Dialog = DialogPrimitive.Root;\nexport const ${suffix}Authed = withAuth(Spacer);\nexport const ${suffix}Box = styled.div\`color: red;\`;\n`;
  const project = await makeProject({
    files: {
      ...FILES,
      "app/tasks/page.tsx": `import { RecordTable } from "@/components/tasks/record-table";\nimport { TaskDialog } from "@/components/tasks/aliases";\nexport default function Page() {\n  return <RecordTable />;\n}\n`,
      "components/tasks/aliases.tsx": aliases("Task"),
      "components/library/aliases.tsx": aliases("Library"),
      "components/library/toggle-group.tsx": TOGGLE_GROUP,
    },
  });
  const registry = JSON.parse(readFileSync(path.join(project.canvasDir, "rounds", "registry.json"), "utf8"));
  assert.deepEqual(registry.components["components/tasks/aliases.tsx"].exports, ["TaskDialog", "TaskAuthed", "TaskBox"]);
  /* The alias of the design's own file is allowed, today's is refused by name, and today's real ToggleGroup is still refused. */
  assert.equal(runHook(project, addToHifi(project, `import { TaskDialog, TaskBox } from "@/components/tasks/aliases";\n`)).stdout, "");
  const refused = reasonOf(runHook(project, addToHifi(project, `import { LibraryDialog, LibraryAuthed, LibraryBox } from "@/components/library/aliases";\n`)));
  for (const name of ["LibraryDialog", "LibraryAuthed", "LibraryBox"]) assert.match(refused, new RegExp(`Today's ${name} \\(components/library/aliases\\.tsx\\)`));
  assert.match(reasonOf(runHook(project, addToHifi(project, `import { ToggleGroup } from "@/components/library/toggle-group";\n`))), /Today's ToggleGroup \(components\/library\/toggle-group\.tsx\)/);
  assert.match(reasonOf(runHook(project, addToHifi(project, `import * as TG from "@/components/library/toggle-group";\n`))), /Today's ToggleGroupItem/);
  /* An alias that a file declares and does not export is never a component of its exports. */
  assert.deepEqual(exportedComponents(`const Hidden = Radix.Root;\nexport const Local = 1;\nexport function useIt() { return <i />; }\n`), []);
});

test("N2: logic constants in a file with JSX are never components, whether written one per line or as one declaration list", () => {
  const draws = `export function Screen() {\n  return <section><Header /></section>;\n}\n`;
  const lines = [
    `export const Theme = extendTheme(Base);`,
    `export const Palette = Tokens.Palette;`,
    `export const Status = Enums.Status;`,
    `export const Reducer = combine(Parts);`,
    `export const Config = makeConfig(Defaults);`,
    `export const Routes = defineRoutes(Config);`,
  ];
  assert.deepEqual(componentExports(`${draws}${lines.join("\n")}\n`).named, ["Screen"]);
  assert.deepEqual(componentExports(`${draws}export const Theme = extendTheme(Base), Palette = Tokens.Palette, Status = Enums.Status, Reducer = combine(Parts), Config = makeConfig(Defaults), Routes = defineRoutes(Config);\n`).named, ["Screen"]);
  /* The same names exported in a list after plain declarations, and as defaults. */
  assert.deepEqual(componentExports(`${draws}const Theme = extendTheme(Base);\nconst Palette = Tokens.Palette;\nconst Routes = defineRoutes(Config);\nexport { Theme, Palette, Routes };\n`).named, ["Screen"]);
  assert.equal(componentExports(`${draws}export default combine(Parts);\n`).defaultName, null);
  assert.deepEqual(exportedComponents(`${draws}${lines.join("\n")}\n`), ["Screen"]);
  /* A wrapped name that is only a constant of the file is no component either, and two constants wrapping each other end the walk. */
  assert.deepEqual(componentExports(`${draws}const Base = { a: 1 };\nexport const Theme = extendTheme(Base);\n`).named, ["Screen"]);
  assert.deepEqual(componentExports(`${draws}export const A = wrap(B);\nconst B = wrap(A);\n`).named, ["Screen"]);
  /* A tag of another object, or of a longer name, does not make the alias a component. */
  assert.deepEqual(componentExports(`const X = () => <Other.Root />;\nexport const Dialog = DialogPrimitive.Root;\n`).named, []);
  assert.deepEqual(componentExports(`const X = () => <PanelBig />;\nexport const Wrapped = observer(Panel);\n`).named, []);
  /* What still holds: an object drawn as a tag namespace, a wrapper of a same-file component, a wrapper of a component drawn as a tag, styled templates. */
  assert.deepEqual(componentExports(`const X = () => <Primitive.Root />;\nexport const Dialog = Primitive.Root;\n`).named, ["Dialog"]);
  assert.deepEqual(componentExports(`function Panel() { return <i />; }\nexport const Observed = observer(Panel);\nexport const Chain = withAuth(Observed);\n`).named, ["Observed", "Chain"]);
  for (const tag of ["<Panel />", "<Panel/>", "<Panel>x</Panel>", "<Panel\n  a=\"1\" />"]) {
    assert.deepEqual(componentExports(`const X = () => <b>${tag}</b>;\nexport const Observed = observer(Panel);\n`).named, ["Observed"], tag);
  }
  assert.deepEqual(componentExports("const X = () => <i />;\nexport const Box = styled.div`color: red;`;\nexport const Tw = tw.p`flex`;\n").named, ["Box", "Tw"]);
});

test("N1: a block or line comment inside a dynamic import call does not hide the import", () => {
  const specs = (text) => importItems(text).filter((one) => one.keyword === "import()").map((one) => one.specifier);
  assert.deepEqual(specs(`const T = lazy(() => import(/* webpackChunkName: "t" */ "@/components/trash"));`), ["@/components/trash"]);
  assert.deepEqual(specs(`const T = lazy(() => import("@/components/trash" /* x */));`), ["@/components/trash"]);
  assert.deepEqual(specs(`const T = lazy(() => import(/* a */ /* b */ '@/components/trash' /* c */ /* d */));`), ["@/components/trash"]);
  assert.deepEqual(specs(`const T = () => import(\n  // chunk name\n  "@/components/trash", // why\n);`), ["@/components/trash"]);
  /* Plain forms still read, and a call that names no string, or has code after the specifier, is still no import. */
  assert.deepEqual(specs(`import("a");import( 'b' )`), ["a", "b"]);
  assert.deepEqual(specs(`import(/* x */ name);import("a" + b);`), []);
  /* A commented-out call is still not read, and an unterminated comment does not run away. */
  assert.deepEqual(specs(`// import(/* x */ "gone")\nconst a = 1;`), []);
  const started = Date.now();
  for (const junk of ["import(/*".repeat(80000), "import(/* x */ ".repeat(80000)]) importItems(junk);
  assert.ok(Date.now() - started < 3000);
});

test("N1: the commented dynamic import of today's barrel is refused by the hook like the plain one", async () => {
  const project = await makeProject({ files: { ...FILES, ...SECOND_ROUND_FILES } });
  for (const line of [
    `const A = lazy(() => import(/* webpackChunkName: "t" */ "@/components/trash"));\n`,
    `const A = lazy(() => import("@/components/trash" /* x */));\n`,
  ]) {
    const result = runHook(project, addToHifi(project, line));
    assert.match(reasonOf(result), /^Today's TrashGridView \(components\/trash\/trash-grid-view\.tsx\) is not part of the design new work builds from\./, line);
  }
  /* Logic behind the same comment is still allowed. */
  assert.equal(runHook(project, addToHifi(project, `const f = () => import(/* webpackChunkName: "f" */ "@/lib/format");\n`)).stdout, "");
});
