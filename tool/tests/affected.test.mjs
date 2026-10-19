/**
 * Tests for `affected.mjs`: which other frames a comment on one frame reaches, through the files they share.
 *
 *   node --test tool/tests/affected.test.mjs
 *
 * A small graph on disk, walked by the real import walk: a shell every frame draws, two pages with two states each, a row
 * component two of the pages share, a badge three pages share, and a second canvas that draws the badge too.
 *
 * NOT INSTALLED into a project.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { alsoAffected, CAP, closuresOf, filesUsedFrom, formatAffected, framesOf, linesForComments, shellByCanvas, shellFiles } from "../affected.mjs";

const made = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function project(files) {
  const root = mkdtempSync(path.join(tmpdir(), "canvas-affected-test-"));
  made.push(root);
  for (const [rel, text] of Object.entries(files)) {
    const at = path.join(root, rel);
    mkdirSync(path.dirname(at), { recursive: true });
    writeFileSync(at, text);
  }
  return root;
}

const component = (name, imports = []) =>
  `${imports.map((spec, i) => `import { X${i} } from "${spec}";`).join("\n")}\nexport function ${name}() {\n  return <div>${name}</div>;\n}\n`;

const FILES = {
  "components/shell.tsx": component("Shell"),
  "components/badge.tsx": component("StatusBadge"),
  "components/row.tsx": component("ItemRow", ["@/components/badge"]),
  "app/list/page.tsx": component("ListPage", ["@/components/shell", "@/components/row"]),
  "app/detail/page.tsx": component("DetailPage", ["@/components/shell", "@/components/row"]),
  "app/report/page.tsx": component("ReportPage", ["@/components/shell", "@/components/badge"]),
  "app/settings/page.tsx": component("SettingsPage", ["@/components/shell"]),
  "app/help/page.tsx": component("HelpPage", ["@/components/shell"]),
  "app/phone/page.tsx": component("PhonePage", ["@/components/badge"]),
  /* The canvas's own pin adapter is reached by every pinned frame; it must never connect frames. */
  "design-canvas/project/canvas-state-pin.tsx": component("Pin"),
};

const MAIN = {
  flows: [
    {
      id: "items",
      screens: [
        { id: "list", route: "/list", label: "List", source: ["app/list/page.tsx", "design-canvas/project/canvas-state-pin.tsx"] },
        { id: "list-empty", route: "/list?empty=1", label: "List, empty", source: ["app/list/page.tsx"] },
        { id: "detail", route: "/detail", label: "Detail", source: ["app/detail/page.tsx"] },
        { id: "report", route: "/report", label: "Report", source: ["app/report/page.tsx"] },
        { id: "settings", route: "/settings", label: "Settings", source: ["app/settings/page.tsx", "design-canvas/project/canvas-state-pin.tsx"] },
        { id: "settings-saved", route: "/settings?saved=1", label: "Settings, saved", source: ["app/settings/page.tsx"] },
        { id: "help", route: "/help", label: "Help", source: ["app/help/page.tsx"] },
        { id: "about", route: "/list", label: "About", explain: true, source: ["app/list/page.tsx"] },
        { id: "old", route: "/list", label: "Old", still: true, source: ["app/list/page.tsx"] },
      ],
    },
  ],
  explorations: [{ id: "q", screens: [{ id: "detail-option", route: "/detail?design=b", label: "Detail option", source: ["app/detail/page.tsx"] }] }],
};
const PHONE = { flows: [{ id: "p", screens: [{ id: "home", route: "/phone", label: "Home", source: ["app/phone/page.tsx"] }] }] };

function graph() {
  const root = project(FILES);
  const frames = [...framesOf("main", MAIN), ...framesOf("phone", PHONE)];
  const closures = closuresOf(frames, root);
  return { root, frames, closures, shell: shellFiles(frames, closures) };
}

test("frames are the screens drawn from code, on every tab, with explanations and stills left out", () => {
  const { frames } = graph();
  assert.deepEqual(
    frames.map((frame) => frame.key),
    ["main/list", "main/list-empty", "main/detail", "main/report", "main/settings", "main/settings-saved", "main/help", "main/detail-option", "phone/home"],
  );
});

test("the canvas's own folder never joins a closure", () => {
  const { closures } = graph();
  assert.ok(![...closures.get("main/list")].some((file) => file.startsWith("design-canvas/")));
});

test("a file on three quarters of a canvas's frames is shell level; the shared parts below it are not", () => {
  const { shell } = graph();
  assert.deepEqual([...shell], ["components/shell.tsx"]);
});

test("a comment on the list names its other state first, then the row, then the badge, with the shell said once", () => {
  const { frames, closures, shell } = graph();
  const result = alsoAffected({ target: "main/list", frames, closures, shell });
  assert.deepEqual(result.samePage, ["main/list-empty"]);
  assert.deepEqual(
    result.groups.map((group) => [group.files, group.frames]),
    [
      [["components/row.tsx"], ["main/detail", "main/detail-option"]],
      [["components/badge.tsx"], ["main/detail", "main/report", "main/detail-option", "phone/home"]],
    ],
  );
  assert.deepEqual(result.shell, { files: ["components/shell.tsx"], frames: 7, of: 8 });
});

test("files with exactly the same frames are one group", () => {
  const root = project({
    ...FILES,
    "components/row.tsx": component("ItemRow", ["@/components/badge", "@/components/row-menu"]),
    "components/row-menu.tsx": component("RowMenu"),
  });
  const frames = framesOf("main", MAIN);
  const closures = closuresOf(frames, root);
  const result = alsoAffected({ target: "main/list", frames, closures });
  assert.deepEqual(result.groups[0].files, ["components/row-menu.tsx", "components/row.tsx"]);
});

test("a frame that shares only the shell gets one line and nothing else", () => {
  const { root, frames, closures, shell } = graph();
  const result = alsoAffected({ target: "main/help", frames, closures, shell });
  assert.deepEqual(result.samePage, []);
  assert.deepEqual(result.groups, []);
  const lines = formatAffected(result, { canvas: "main", root });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /shell level, not listed: Shell \(components\/shell\.tsx\) is on 7 of the other 8 frames/);
});

test("the printed lines name components, keep this canvas's ids bare and prefix the other canvas's", () => {
  const { root, frames, closures, shell } = graph();
  const lines = formatAffected(alsoAffected({ target: "main/list", frames, closures, shell }), {
    canvas: "main",
    root,
    system: { "components/badge.tsx": [{ name: "Badge" }] },
  });
  assert.deepEqual(lines, [
    "  the same page: list-empty",
    "  uses the same ItemRow (components/row.tsx): 2 frames, detail, detail-option",
    "  uses the same StatusBadge (components/badge.tsx), on the Design System tab as Badge: 4 frames, detail, report, detail-option, phone/home",
    "  shell level, not listed: Shell (components/shell.tsx) is on 7 of the other 8 frames",
  ]);
});

test("another canvas's frames carry their canvas, and an unknown frame says nothing can be derived", () => {
  const { root, frames, closures } = graph();
  const lines = formatAffected(alsoAffected({ target: "phone/home", frames, closures, shell: new Set() }), { canvas: "phone", root });
  assert.deepEqual(lines, ["  uses the same StatusBadge (components/badge.tsx): 5 frames, main/list, main/list-empty, main/detail, main/report, main/detail-option"]);
  assert.equal(alsoAffected({ target: "main/gone", frames, closures }), null);
  assert.match(formatAffected(null, { canvas: "main", root })[0], /nothing can be derived/);
});

test("the list is capped, and the rest is counted in one line", () => {
  const files = { "app/hub/page.tsx": "" };
  const imports = [];
  const screens = [{ id: "hub", label: "Hub", source: ["app/hub/page.tsx"] }];
  for (let i = 0; i < CAP + 2; i += 1) {
    files[`components/part-${i}.tsx`] = component(`Part${i}`);
    files[`app/p${i}/page.tsx`] = component(`P${i}`, [`@/components/part-${i}`]);
    imports.push(`@/components/part-${i}`);
    screens.push({ id: `p${i}`, label: `P${i}`, source: [`app/p${i}/page.tsx`] });
  }
  files["app/hub/page.tsx"] = component("Hub", imports);
  const root = project(files);
  const frames = framesOf("main", { flows: [{ id: "f", screens }] });
  const closures = closuresOf(frames, root);
  const result = alsoAffected({ target: "main/hub", frames, closures });
  assert.equal(result.groups.length, CAP + 2);
  const lines = formatAffected(result, { canvas: "main", root });
  assert.equal(lines.length, CAP + 1);
  assert.equal(lines.at(-1), "  2 more shared file group(s), reaching 2 frame(s): node design-canvas/affected.mjs --canvas main --all lists them");
  assert.equal(formatAffected(result, { canvas: "main", root, all: true }).length, CAP + 2);
  /* Under a comment (drain.mjs --list prints these lines too) the advice is the exact affected.mjs command for that comment,
     never a bare --all, which drain.mjs reads as "consume every comment". */
  const graph = { root, frames, closures, shell: undefined };
  const forComment = linesForComments([{ id: "c4", screenId: "hub" }], { canvas: "main", graph }).get("c4");
  assert.equal(forComment.at(-1), "  2 more shared file group(s), reaching 2 frame(s): node design-canvas/affected.mjs --canvas main --ids c4 --all lists them");
  const forScreen = linesForComments([{ id: "hub", screenId: "hub" }], { canvas: "main", graph, screen: true }).get("hub");
  assert.match(forScreen.at(-1), /affected\.mjs --canvas main --screen hub --all lists them$/);
  for (const line of [...forComment, ...forScreen]) assert.doesNotMatch(line, /: --all/);
});

test("a shared part named in two frames' source is a shared part, not the same page", () => {
  const root = project(FILES);
  const frames = framesOf("main", {
    flows: [
      {
        id: "f",
        screens: [
          { id: "home", route: "/", label: "Home", source: ["app/report/page.tsx", "components/badge.tsx"] },
          { id: "list", route: "/list", label: "List", source: ["app/list/page.tsx", "components/badge.tsx"] },
          { id: "list-b", route: "/list?b=1", label: "List b", source: ["app/list/page.tsx"] },
        ],
      },
    ],
  });
  const result = alsoAffected({ target: "main/home", frames, closures: closuresOf(frames, root) });
  assert.deepEqual(result.samePage, []);
  assert.deepEqual(result.groups.map((group) => [group.files, group.frames]), [[["components/badge.tsx", "components/shell.tsx"], ["main/list", "main/list-b"]]]);
});

test("a named import through a barrel ties a frame to the file that defines the name, not to everything the barrel re-exports", () => {
  const root = project({
    "components/hooks/index.ts": 'export * from "./use-api";\nexport { useBoard } from "./use-board";\n',
    "components/hooks/use-api.ts": "export function useApi() {\n  return null;\n}\n",
    "components/hooks/use-board.ts": 'import { Funnel } from "@/components/funnel";\nexport function useBoard() {\n  return Funnel;\n}\n',
    "components/funnel.tsx": 'import { ChangeLabel } from "@/components/change-label";\nexport function Funnel() {\n  return <ChangeLabel />;\n}\n',
    "components/change-label.tsx": component("ChangeLabel"),
    "components/metric.tsx": 'import { ChangeLabel } from "@/components/change-label";\nexport function Metric() {\n  return <ChangeLabel />;\n}\n',
    "app/profile/page.tsx": 'import { useApi } from "@/components/hooks";\nexport default function Profile() {\n  useApi();\n  return <div />;\n}\n',
    "app/board/page.tsx": 'import { useBoard } from "@/components/hooks";\nexport default function Board() {\n  useBoard();\n  return <div />;\n}\n',
    "app/stats/page.tsx": 'import { Metric } from "@/components/metric";\nexport default function Stats() {\n  return <Metric />;\n}\n',
    "app/kit/page.tsx": 'import * as Hooks from "@/components/hooks";\nexport default function Kit() {\n  Hooks.useApi();\n  return <div />;\n}\n',
  });
  assert.deepEqual(filesUsedFrom(["app/profile/page.tsx"], root), ["app/profile/page.tsx", "components/hooks/use-api.ts"]);
  assert.ok(filesUsedFrom(["app/board/page.tsx"], root).includes("components/change-label.tsx"), "a hook that really draws the label keeps it");
  assert.ok(filesUsedFrom(["app/kit/page.tsx"], root).includes("components/change-label.tsx"), "a namespace import takes the whole barrel");
  const screens = ["profile", "board", "stats", "kit"].map((id) => ({ id, route: `/${id}`, label: id, source: [`app/${id}/page.tsx`] }));
  const frames = framesOf("main", { flows: [{ id: "f", screens }] });
  const closures = closuresOf(frames, root);
  const result = alsoAffected({ target: "main/stats", frames, closures, shell: new Set() });
  const reached = result.groups.find((group) => group.files.includes("components/change-label.tsx"));
  assert.deepEqual(reached.frames, ["main/board", "main/kit"], "the label's real dependents, and not the frame that only imports useApi");
});

test("a file that is shell level on one canvas is an ordinary shared part on another, and its frames there are listed", () => {
  const files = { "components/pill.tsx": component("Pill"), "components/other.tsx": component("Other") };
  const screens = (slug, withPill) =>
    [0, 1, 2, 3].map((i) => {
      files[`app/${slug}${i}/page.tsx`] = component(`P${slug}${i}`, [withPill(i) ? "@/components/pill" : "@/components/other"]);
      return { id: `${slug}${i}`, route: `/${slug}${i}`, label: `${slug}${i}`, source: [`app/${slug}${i}/page.tsx`] };
    });
  const declA = { flows: [{ id: "f", screens: screens("a", () => true) }] };
  const declB = { flows: [{ id: "f", screens: screens("b", (i) => i === 0) }] };
  const root = project(files);
  const frames = [...framesOf("a", declA), ...framesOf("b", declB)];
  const closures = closuresOf(frames, root);
  const shell = shellByCanvas(frames, closures);
  assert.deepEqual([...shell.get("components/pill.tsx")], ["a"]);
  const result = alsoAffected({ target: "a/a0", frames, closures, shell });
  assert.deepEqual(result.groups.map((group) => [group.files, group.frames]), [[["components/pill.tsx"], ["b/b0"]]], "named where it is not shell level");
  assert.deepEqual(result.shell, { files: ["components/pill.tsx"], frames: 3, of: 7 }, "and said once where it is");
  /* A plain set still means shell level everywhere. */
  assert.deepEqual(alsoAffected({ target: "a/a0", frames, closures, shell: shellFiles(frames, closures) }).groups, []);
});
