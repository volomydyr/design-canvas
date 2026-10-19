/**
 * Tests for the design-system index (`components.mjs`): the walk, the variant props, the file's own description, the index
 * itself, the lookup an agent calls before writing UI, the cache, and the state report.
 *
 *   node --test tool/tests/components.test.mjs
 *
 * Everything runs in throwaway project folders, with the build-from registry INJECTED, so nothing here needs esbuild, a
 * browser, a network, a dev server or the framework.
 *
 * NOT INSTALLED into a project.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { buildIndex, commentBlocks, decisionsIn, describe as describeComponent, find, leadingDoc, loadIndex, lookalikes, readSystem, state, variantProps, walkComponentFiles, words } from "../components.mjs";

const made = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

const FILES = {
  /* The approved design: a page and the parts it draws. */
  "app/tasks/page.tsx": `import { RecordTable } from "@/components/tasks/record-table";\nimport { StatusPill } from "@/components/common/status-pill";\nexport default function Page() {\n  return (\n    <RecordTable>\n      <StatusPill tone="green" />\n    </RecordTable>\n  );\n}\n`,
  "components/tasks/record-table.tsx": `/**\n * The one records table: sortable headings, pinned columns.\n *\n * More prose nobody needs here.\n */\nexport function RecordTable({ children }) {\n  return <table>{children}</table>;\n}\n`,
  "components/common/status-pill.tsx": `// A status chip. Never carries a dot.\nimport { cva } from "class-variance-authority";\nexport const pill = cva("base", { variants: { tone: { green: "g", amber: "a" }, size: { sm: "s" } } });\nexport function StatusPill() {\n  return <span />;\n}\n`,
  /* Today's code: not reached by the approved design. */
  "components/ledger/ledger-grid.tsx": `export function LedgerGrid() {\n  return <div />;\n}\n`,
  "components/ledger/row-menu.tsx": `export const RowMenu = forwardRef<HTMLDivElement, { onSelect?: () => void }>((p, r) => <div ref={r} />);\n`,
  "components/common/icons.tsx": `export function EmptyListIcon() {\n  return <svg />;\n}\nexport function MenuIcon() {\n  return <svg />;\n}\nexport function RowIcon() {\n  return <svg />;\n}\nexport function TableIcon() {\n  return <svg />;\n}\nexport function StatusIcon() {\n  return <svg />;\n}\n`,
  /* Never a component: logic, and a file nothing can reach. */
  "lib/format.ts": `export const LOCALE = "en-US";\n`,
  "components/ledger/schema.tsx": `export const FormSchema = z.object({ a: 1 });\n`,
};

/* The build-from registry, as `registry.mjs` would have built it: the page and the two parts it reaches. */
const REGISTRY = {
  version: 2,
  buildFrom: ["tasks"],
  frames: { "tasks/list": { canvas: "tasks", label: "Tasks list" } },
  components: {
    "app/tasks/page.tsx": { exports: ["Page"], frames: ["tasks/list"] },
    "components/tasks/record-table.tsx": { exports: ["RecordTable"], frames: ["tasks/list"] },
    "components/common/status-pill.tsx": { exports: ["StatusPill"], frames: ["tasks/list"] },
  },
};

function makeProject(files = FILES) {
  const root = mkdtempSync(path.join(tmpdir(), "canvas-components-test-"));
  made.push(root);
  const canvasDir = path.join(root, "design-canvas");
  mkdirSync(path.join(canvasDir, "rounds"), { recursive: true });
  writeFileSync(path.join(canvasDir, "settings.json"), JSON.stringify({ buildFrom: ["tasks"] }));
  /* A file inside design-canvas/ and one inside node_modules: neither is ever part of a project's design system. */
  writeFileSync(path.join(canvasDir, "canvas-page.tsx"), `export function CanvasPage() {\n  return <div />;\n}\n`);
  mkdirSync(path.join(root, "node_modules", "pkg"), { recursive: true });
  writeFileSync(path.join(root, "node_modules", "pkg", "index.tsx"), `export function Packaged() {\n  return <div />;\n}\n`);
  for (const [rel, text] of Object.entries(files)) {
    const at = path.join(root, rel);
    mkdirSync(path.dirname(at), { recursive: true });
    writeFileSync(at, text);
  }
  return { root, canvasDir };
}

/* ------------------------------------------------------------------ the pieces */

test("the walk takes the project's component files and never the canvas, the dependencies or the tests", () => {
  const { root } = makeProject();
  mkdirSync(path.join(root, "components", "__tests__"), { recursive: true });
  writeFileSync(path.join(root, "components", "__tests__", "x.tsx"), `export function Spec() {\n  return <div />;\n}\n`);
  writeFileSync(path.join(root, "components", "ledger", "grid.test.tsx"), `export function Spec2() {\n  return <div />;\n}\n`);
  const { files, folders } = walkComponentFiles(root);
  assert.ok(files.includes("components/tasks/record-table.tsx"));
  assert.ok(files.includes("app/tasks/page.tsx"));
  for (const skipped of ["design-canvas/canvas-page.tsx", "node_modules/pkg/index.tsx", "components/__tests__/x.tsx", "components/ledger/grid.test.tsx"])
    assert.ok(!files.includes(skipped), `${skipped} must not be indexed`);
  /* A .ts file holds no component, so it is not a component file. */
  assert.ok(!files.includes("lib/format.ts"));
  /* The folders walked are recorded, because a NEW component file moves its folder's time and nothing else. */
  assert.ok(folders.includes("components/tasks"));
  assert.ok(!folders.includes("node_modules"));
});

test("variant props are read from every cva block, nested braces and function values included", () => {
  assert.deepEqual(variantProps(`const x = cva("b", { variants: { tone: { green: "g", amber: "a" }, size: { sm: "s", lg: "l" } } });`), {
    tone: ["green", "amber"],
    size: ["sm", "lg"],
  });
  /* A value that is an object, and a quoted key. */
  assert.deepEqual(variantProps(`cva("b", { variants: { "data-state": { open: { a: 1 }, shut: { b: 2 } } } })`), { "data-state": ["open", "shut"] });
  /* Two blocks in one file: both count. */
  const two = variantProps(`cva("a", { variants: { tone: { x: "1" } } });\ncva("b", { variants: { size: { y: "2" } } });`);
  assert.deepEqual(two, { tone: ["x"], size: ["y"] });
  /* No cva, and a cva with no variants: no props, and no crash. */
  assert.deepEqual(variantProps(`export function A() { return <a />; }`), {});
  assert.deepEqual(variantProps(`cva("b", { defaultVariants: {} })`), {});
  /* An unterminated block cannot hang the scan. */
  assert.deepEqual(variantProps(`cva("b", { variants: { tone: { green: "g"`), {});
});

test("a part written without cva gives its shapes through string literal unions, direct or through an alias", () => {
  assert.deepEqual(variantProps(`type ButtonVariant = "primary" | "secondary";\nexport function Button({ variant }: { variant?: ButtonVariant; size: "sm" | "md"; label: string; one: "only" }) {}`), {
    variant: ["primary", "secondary"],
    size: ["sm", "md"],
  });
});

test("a part's description is the file's own comment, or the one written above the export, and never an import's", () => {
  assert.equal(leadingDoc(`/**\n * The one records table: sortable headings.\n *\n * More prose.\n */\nexport function A() {}`), "The one records table: sortable headings.");
  assert.equal(leadingDoc(`"use client";\n/** A status chip. Never a dot. */\nexport function A() {}`), "A status chip.");
  assert.equal(leadingDoc(`// A row in a menu. Used everywhere.\n// second line\nimport x from "y";`), "A row in a menu.");
  /* The second place, and where most of it actually is: under the imports, right above the export. Reading only the
     top of the file found only a small share of the descriptions on a real project. */
  assert.equal(
    leadingDoc(`"use client";\nimport { forwardRef } from "react";\n\n/**\n * The app's one menu row: icon, label, trailing slot.\n */\nexport const MenuRow = forwardRef((p, r) => <a />);`),
    "The app's one menu row: icon, label, trailing slot.",
  );
  /* A comment about an import, or about a local that is not exported, is still nobody's description. */
  assert.equal(leadingDoc(`import x from "y";\n/* about the import */\nconst a = 1;\n`), null);
  assert.equal(leadingDoc(`export function A() {}`), null);
  /* A description with no full stop is taken whole, and a very long one is cut. */
  assert.equal(leadingDoc(`/** Just a label */\nexport function A() {}`), "Just a label");
  assert.ok(leadingDoc(`/** ${"word ".repeat(80)} */\nexport function A() {}`).endsWith("..."));
});

/* ------------------------------------------------------------------ the index */

test("the index is every component file, each marked approved or today's, with its uses and a golden example", () => {
  const { root } = makeProject();
  const index = buildIndex({ root, registry: REGISTRY });

  assert.equal(index.counts.files, 6, "six component files: the page, two approved parts, two today's, the icons");
  assert.equal(index.counts.approved, 3);
  assert.equal(index.counts.today, 3);

  const table = index.components["components/tasks/record-table.tsx"];
  assert.deepEqual(table.exports, ["RecordTable"]);
  assert.equal(table.approved, true);
  assert.deepEqual(table.frames, ["tasks/list"]);
  assert.equal(table.doc, "The one records table: sortable headings, pinned columns.");
  assert.equal(table.folder, "components/tasks");
  assert.equal(table.importers, 1);
  assert.deepEqual(table.importedBy, ["app/tasks/page.tsx"]);
  /* The example is a real call site, from the approved design, with its line. */
  assert.equal(table.example.file, "app/tasks/page.tsx");
  assert.equal(table.example.approved, true);
  assert.equal(table.example.name, "RecordTable");
  assert.match(table.example.text, /<RecordTable>/);

  /* Variant props come from the cva block beside the component. */
  assert.deepEqual(index.components["components/common/status-pill.tsx"].props, { tone: ["green", "amber"], size: ["sm"] });

  /* Today's code is indexed just the same, and marked. */
  const grid = index.components["components/ledger/ledger-grid.tsx"];
  assert.equal(grid.approved, false);
  assert.deepEqual(grid.frames, []);
  assert.equal(grid.importers, 0);

  /* A wrapper with type arguments holding a function type is a component (the detector fix). */
  assert.deepEqual(index.components["components/ledger/row-menu.tsx"].exports, ["RowMenu"]);

  /* Logic is never a component, and a .ts file is never a component file. */
  assert.ok(!("components/ledger/schema.tsx" in index.components));
  assert.ok(!("lib/format.ts" in index.components));
});

test("with no design named to build from, the index is still the whole system and nothing is approved", () => {
  const { root } = makeProject();
  const index = buildIndex({ root, registry: null });
  assert.equal(index.counts.files, 6);
  assert.equal(index.counts.approved, 0);
  assert.equal(index.counts.today, 6);
  assert.deepEqual(index.buildFrom, []);
  /* An example can still be given, from wherever the part is actually used. */
  assert.equal(index.components["components/tasks/record-table.tsx"].example.approved, false);
});

/* ------------------------------------------------------------------ the lookup */

test("the lookup judges each name on its own, so a barrel of many exports never wins on one shared word", () => {
  const { root } = makeProject();
  const index = buildIndex({ root, registry: REGISTRY });
  /* icons.tsx exports MenuIcon, RowIcon, TableIcon, StatusIcon and EmptyListIcon: pooled together those five names
     share a word with almost any question, which is how a 340-export icon file topped every search before. */
  const table = find(index, "a records table with sortable headings");
  assert.equal(table[0].file, "components/tasks/record-table.tsx");
  assert.equal(table[0].matched, "RecordTable");
  const chip = find(index, "a status chip");
  assert.equal(chip[0].file, "components/common/status-pill.tsx");
  const icons = find(index, "a status chip").findIndex((one) => one.file === "components/common/icons.tsx");
  assert.ok(icons === -1 || icons > 0, "the icon barrel never leads");
});

test("the lookup prefers the approved design, reports what matched, and says nothing when nothing matches", () => {
  const { root } = makeProject();
  const index = buildIndex({ root, registry: REGISTRY });
  /* Both files hold a "menu"/"row" name; the approved design is the answer whenever it has one. */
  const menu = find(index, "a row menu");
  assert.ok(menu.length > 0);
  assert.equal(menu[0].matched, "RowMenu");

  /* A question that shares no word with anything is answered with nothing, which is the true answer. */
  assert.deepEqual(find(index, "one of a few exclusive choices"), []);
  assert.deepEqual(find(index, "something nothing here is called"), []);
  /* An empty question is not a search. */
  assert.deepEqual(find(index, ""), []);
  assert.deepEqual(words("a an the of"), []);

  /* `--approved` keeps today's code out entirely. */
  const onlyApproved = find(index, "a grid of ledger", { approvedOnly: true });
  assert.ok(onlyApproved.every((one) => one.approved));
});

test("what the lookup prints about one component carries the facts an agent needs", () => {
  const { root } = makeProject();
  const index = buildIndex({ root, registry: REGISTRY });
  const lines = describeComponent(index.components["components/common/status-pill.tsx"], "components/common/status-pill.tsx").join("\n");
  assert.match(lines, /StatusPill/);
  assert.match(lines, /the approved design draws this, on 1 frame\(s\)/);
  assert.match(lines, /A status chip\./);
  assert.match(lines, /props: tone=green\|amber/);
  assert.match(lines, /example \(approved\) app\/tasks\/page\.tsx:/);
  /* Today's code says so in the words the reuse check uses. */
  const today = describeComponent(index.components["components/ledger/ledger-grid.tsx"], "components/ledger/ledger-grid.tsx").join("\n");
  assert.match(today, /today's code: new design does not build from this/);
});

/* ------------------------------------------------------------------ the cache and the state report */

test("the index is cached, and a new component file rebuilds it", async () => {
  const { root, canvasDir } = makeProject();
  const cachePath = path.join(canvasDir, "rounds", "components.json");
  const settings = { buildFrom: ["tasks"] };
  const first = await loadIndex({ root, canvasDir, settings, cachePath, registry: REGISTRY });
  assert.equal(first.counts.files, 6);
  const again = await loadIndex({ root, canvasDir, settings, cachePath, registry: REGISTRY });
  assert.equal(again.builtAt, first.builtAt, "the cache is used while nothing has changed");

  /* A component added where nothing else changed: the folder's time moves, so the index is rebuilt. */
  writeFileSync(path.join(root, "components", "ledger", "fresh.tsx"), `export function Fresh() {\n  return <div />;\n}\n`);
  const third = await loadIndex({ root, canvasDir, settings, cachePath, registry: REGISTRY });
  assert.notEqual(third.builtAt, first.builtAt);
  assert.equal(third.counts.files, 7);
  assert.ok("components/ledger/fresh.tsx" in third.components);

  /* A different design to build from is a different answer, so a cache built for another is never used. */
  const other = await loadIndex({ root, canvasDir, settings, cachePath, registry: { ...REGISTRY, buildFrom: ["calendar"], components: {} } });
  assert.equal(other.counts.approved, 0);
});

test("the state report counts the system and names what a reviewer has to decide about", () => {
  const { root } = makeProject();
  const report = state(buildIndex({ root, registry: REGISTRY }));
  assert.equal(report.counts.files, 6);
  assert.equal(report.counts.unused, 4, "the icons, the grid, the row menu and the page itself are imported by nothing");
  assert.ok(report.busiest.length > 0);
  assert.equal(report.busiest[0].importers, 1);
  assert.ok(report.folders.some(([folder]) => folder === "components/ledger"));
  /* Two files exporting one name is where an agent picks the wrong one, so it is named. */
  const { root: root2 } = makeProject({ ...FILES, "components/legacy/status-pill.tsx": `export function StatusPill() {\n  return <span />;\n}\n` });
  const twice = state(buildIndex({ root: root2, registry: REGISTRY }));
  assert.equal(twice.twiceCount, 1);
  assert.equal(twice.twice[0][0], "StatusPill");
  assert.equal(twice.twice[0][1].length, 2);
});

/* ------------------------------------------------------------------ decisions, the tab's sets, look-alikes */

test("a decision is any comment with a date in it, read from the part's own file, newest first", () => {
  const text = [
    'const url = "https://example.com/2026-01-01"; // not a decision: no date in this comment',
    "// 2026-10-18, design review: never a second primary button in one footer",
    "// and it stays one line on desktop.",
    "export function Footer() {",
    "  /* 2026-09-02, design review: the ghost variant is for icon buttons only. */",
    "  return <p>Don't 2026-01-01</p>;",
    "}",
  ].join("\n");
  const found = decisionsIn(text);
  assert.equal(found.length, 2, "the string's date and the JSX text's date are not comments");
  assert.equal(found[0].at, "2026-10-18");
  assert.equal(found[0].line, 2);
  assert.match(found[0].text, /never a second primary button in one footer.*stays one line/, "consecutive // lines are one comment");
  assert.equal(found[1].at, "2026-09-02");
  assert.equal(found[1].line, 5);
  assert.equal(commentBlocks("/* a\n * b */\nconst x = 1; // c").length, 2);
});

test("a decision with no label after the date is read like one with a label", () => {
  const found = decisionsIn("// 2026-10-18: never a second primary button in one footer\nexport function Footer() {}\n");
  assert.equal(found.length, 1);
  assert.equal(found[0].at, "2026-10-18");
  assert.equal(found[0].text, "2026-10-18: never a second primary button in one footer");
});

test("the lookup prints a part's decisions first, and finds a part by the words of its decisions", () => {
  const { root } = makeProject({
    ...FILES,
    "components/common/status-pill.tsx": `// 2026-10-18, design review: a draft label is a status pill, never a hand-rolled badge\n${FILES["components/common/status-pill.tsx"]}`,
  });
  const index = buildIndex({ root, registry: REGISTRY });
  const entry = index.components["components/common/status-pill.tsx"];
  assert.equal(entry.decisions.length, 1);
  assert.equal(index.counts.withDecision, 1);
  const lines = describeComponent(entry, "components/common/status-pill.tsx").join("\n");
  assert.match(lines, /decided 2026-10-18 \(components\/common\/status-pill\.tsx:1\): 2026-10-18, design review: a draft label is a status pill/);
  assert.equal(find(index, "draft label")[0].file, "components/common/status-pill.tsx");
});

test("the tab's sets are read from the capture's manifest and lead the lookup", () => {
  const { root, canvasDir } = makeProject();
  assert.deepEqual(readSystem(canvasDir), {}, "nothing photographed: no sets, no error");
  mkdirSync(path.join(canvasDir, "shots", "_system"), { recursive: true });
  writeFileSync(
    path.join(canvasDir, "shots", "_system", "manifest.json"),
    JSON.stringify({ builtAt: "x", sets: [{ id: "row-menu", name: "Row menu", level: "molecules", group: "Menus", source: "components/ledger/row-menu.tsx", blocks: [{ id: "b", title: "Variants", rows: [{ id: "a", label: "Kebab" }], columns: [{ id: "d", label: "Default" }], cells: {} }] }] }),
  );
  const system = readSystem(canvasDir);
  assert.equal(system["components/ledger/row-menu.tsx"][0].id, "row-menu");
  const index = buildIndex({ root, registry: REGISTRY });
  assert.match(describeComponent(index.components["components/ledger/row-menu.tsx"], "components/ledger/row-menu.tsx", system).join("\n"), /on the Design System tab: Row menu \(set "row-menu"/);
  assert.equal(find(index, "a kebab menu", { system })[0].file, "components/ledger/row-menu.tsx", "the grid's labels are a designer's words");
});

test("look-alikes: parts doing one job, the shared one, the ones built without it, and the raw element", () => {
  const { root } = makeProject({
    "components/ui/button.tsx": `export function Button() {\n  return <button />;\n}\n`,
    "components/a/save-button.tsx": `import { Button } from "@/components/ui/button";\nexport function SaveButton() {\n  return <Button />;\n}\n`,
    "components/b/close-button.tsx": `export function CloseButton() {\n  return <button>x</button>;\n}\n`,
    "components/c/page.tsx": `import { Button } from "@/components/ui/button";\nexport function Page() {\n  return <div><Button /><Button /><button>raw</button><button /></div>;\n}\n`,
  });
  const index = buildIndex({ root, registry: null });
  const button = lookalikes(index).find((one) => one.kind === "button");
  assert.equal(button.files, 3);
  assert.equal(button.shared[0].name, "Button", "the one named for the job");
  assert.deepEqual(button.apart, ["CloseButton"], "SaveButton draws Button, so it is a composition, not a second button");
  assert.deepEqual(button.raw, { sites: 3, files: 2 }, "the shared Button drawing its own <button> is not counted");
});
