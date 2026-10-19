/**
 * Tests for `parity.mjs`, real-code mode: the mode an exploration is in, the refusal of an option that brings its own data
 * calls, the base a first capture records, and the parity check that compares today's screen at that base with the files
 * after the chosen option was folded in.
 *
 *   node --test tool/tests/parity.test.mjs
 *   CANVAS_TEST_PROJECT=/path/to/project node --test tool/tests/parity.test.mjs   (the parity tests read code with TypeScript)
 *
 * The mode and the option checks need nothing. The parity check reads code with the TypeScript compiler, which a project
 * carries and the skill does not: point CANVAS_TEST_PROJECT at a project that has it, or those tests are skipped by name.
 *
 * NOT INSTALLED into a project: the installer copies only the files it lists.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import {
  baseRecord,
  explorationMode,
  locationHolds,
  logicIn,
  modeLine,
  nextBases,
  ownDataCalls,
  parityLines,
  parityOf,
  realCodeReport,
  recordRemoval,
  releaseRetired,
  screenFiles,
  unitsOf,
} from "../parity.mjs";

const made = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** A throwaway project: `files` maps a relative path to its text. */
function project(files) {
  const root = mkdtempSync(path.join(tmpdir(), "canvas-parity-test-"));
  made.push(root);
  write(root, files);
  return root;
}
function write(root, files) {
  for (const [rel, text] of Object.entries(files)) {
    const at = path.join(root, rel);
    mkdirSync(path.dirname(at), { recursive: true });
    writeFileSync(at, text);
  }
}
const git = (root, ...args) => execFileSync("git", ["-c", "user.email=test@example.com", "-c", "user.name=Test", "-c", "commit.gpgsign=false", ...args], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
function committed(files) {
  const root = project(files);
  git(root, "init", "-q");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "base");
  return root;
}

const PROJECT = process.env.CANVAS_TEST_PROJECT;
const ts = (() => {
  if (!PROJECT) return null;
  try {
    return createRequire(path.join(PROJECT, "package.json"))("typescript");
  } catch {
    return null;
  }
})();
const withTs = (name, run) => (ts ? test(name, run) : test(name, { skip: "set CANVAS_TEST_PROJECT to a project that has typescript to run this test" }, run));

/* ------------------------------------------------------------------ the screens the tests explore */

const PROTOTYPE = {
  "app/trips/page.tsx": `import { TripList } from "@/components/trip-list";\nexport default function Page() { return <TripList />; }\n`,
  "components/trip-list.tsx": `import { useState } from "react";\nimport { TRIPS } from "@/lib/data";\n// no fetch( here: a comment is not code\nexport function TripList() {\n  const [open, setOpen] = useState(false);\n  return <ul>{TRIPS.map((trip) => <li key={trip.id} onClick={() => setOpen(!open)}>{trip.name}</li>)}</ul>;\n}\n`,
  "lib/data.ts": `export const TRIPS = [{ id: "a", name: "Lisbon" }];\n`,
};

const TEAM_PAGE = `import Link from "next/link";
import { useTeamQuery, useDeleteTeam } from "@/lib/hooks";
import { useMessages } from "@/lib/messages";
import { TeamMembers } from "./team-members";
import { DeleteButton, Panel } from "./parts";

export function TeamPage({ teamId }: { teamId: string }) {
  const { data: team, user } = useTeamQuery(teamId);
  const { mutate } = useDeleteTeam();
  const { t } = useMessages();
  const canEdit = user.role === "owner" || user.isAdmin;
  if (!team) return null;
  const onDelete = () => mutate(teamId);

  return (
    <Panel className="p-4">
      <h1>{team.name}</h1>
      <p>{t("team.members", "Members")}</p>
      {canEdit && <DeleteButton onClick={onDelete} label={t("team.delete")} />}
      {canEdit && <input type="hidden" name="teamId" value={teamId} />}
      <Link href="/teams">{t("team.back")}</Link>
      <TeamMembers teamId={teamId} />
    </Panel>
  );
}
`;
const TEAM = {
  "app/teams/[id]/page.tsx": `import { TeamPage } from "@/components/team-page";\nexport default function Page({ params }) { return <TeamPage teamId={params.id} />; }\n`,
  "components/team-page.tsx": TEAM_PAGE,
  "components/team-members.tsx": `import { useMembersQuery } from "@/lib/hooks";\nexport function TeamMembers({ teamId }) {\n  const { data } = useMembersQuery(teamId);\n  return <ul>{data?.map((one) => <li key={one.id}>{one.name}</li>)}</ul>;\n}\n`,
  "components/parts.tsx": `export const Panel = (props) => <section {...props} />;\nexport const DeleteButton = ({ onClick, label }) => <button onClick={onClick}>{label}</button>;\nexport const IconButton = ({ onClick, label }) => <button aria-label={label} onClick={onClick}>x</button>;\n`,
  "lib/hooks.ts": `import { useQuery, useMutation } from "@tanstack/react-query";\nexport const useTeamQuery = (id) => useQuery({ queryKey: ["team", id], queryFn: () => fetch("/api/teams/" + id).then((r) => r.json()) });\nexport const useMembersQuery = (id) => useQuery({ queryKey: ["members", id] });\nexport const useDeleteTeam = () => useMutation({ mutationFn: (id) => fetch("/api/teams/" + id, { method: "DELETE" }) });\nexport const useAuditQuery = (id) => useQuery({ queryKey: ["audit", id] });\n`,
  "lib/messages.ts": `export const useMessages = () => ({ t: (key, copy) => copy ?? key });\n`,
};

const ORIGINAL = { id: "team", view: "flow", flowId: "teams", source: ["app/teams/[id]/page.tsx", "components/team-page.tsx"] };
const exploration = (extra = {}) => ({ id: "team layout", original: "team", ...extra });
const option = (id, source) => ({ id, view: "exploration", flowId: "team layout", source });

/* ------------------------------------------------------------------ 1. the mode */

test("a prototype screen over mock data is in simple mode, and the line says why", () => {
  const root = project(PROTOTYPE);
  const screens = [{ id: "trips", view: "flow", source: ["app/trips/page.tsx"] }];
  const result = explorationMode({ root, exploration: { id: "trip list", original: "trips" }, screens });
  assert.equal(result.mode, "simple");
  assert.equal(
    modeLine(result),
    `exploration "trip list": simple mode, because the files of today's screen "trips" make no data calls, server actions, store reads or permission checks. Options are built as usual`,
  );
});

test("a screen whose files fetch, mutate and check a role is in real-code mode, naming where", () => {
  const root = project(TEAM);
  const result = explorationMode({ root, exploration: exploration(), screens: [ORIGINAL] });
  assert.equal(result.mode, "real-code");
  assert.match(result.why, /useTeamQuery at components\/team-page\.tsx:8/);
  assert.match(result.why, /role === at components\/team-page\.tsx:11/);
  assert.match(modeLine(result), /^exploration "team layout": real-code mode, because .*\. Options are UI-only files over its hooks and handlers, the chosen one is folded into its files, and the parity check gates every round$/);
});

test("the declaration's mode wins over what the files say, either way", () => {
  const root = project(TEAM);
  assert.equal(explorationMode({ root, exploration: exploration({ mode: "simple" }), screens: [ORIGINAL] }).mode, "simple");
  const proto = project(PROTOTYPE);
  const forced = explorationMode({ root: proto, exploration: { id: "x", original: "trips", mode: "real-code" }, screens: [{ id: "trips", view: "flow", source: ["app/trips/page.tsx"] }] });
  assert.equal(forced.mode, "real-code");
  assert.equal(forced.why, `set in its declaration (mode: "real-code")`);
});

test("the rules read code, not comments, and know the common shapes", () => {
  const found = (text) => logicIn(text, "x.tsx").map((one) => `${one.kind}:${one.what}`);
  assert.deepEqual(found(`// fetch("/x")\n/* useQuery( */\nconst a = 1;`), []);
  assert.deepEqual(found(`"use server";\nexport async function save() {}`), ["server:\"use server\""]);
  assert.deepEqual(found(`export async function POST(req) {}`), ["server:POST"]);
  assert.deepEqual(found(`const s = useSelector((x) => x.a);`), ["store:useSelector"]);
  assert.deepEqual(found(`if (hasPermission(user, "edit")) {}`), ["permission:hasPermission"]);
  assert.deepEqual(found(`const { data } = useSWR("/api/a");`), ["data:useSWR"]);
  assert.deepEqual(found(`client.query({ query: Q })`), ["data:client.query"]);
});

/* ------------------------------------------------------------------ 2. options are UI only */

test("an option that brings its own data call is refused, naming the file and the call", () => {
  const root = project({
    ...TEAM,
    "explorations/team-a.tsx": `import { useTeamQuery } from "@/lib/hooks";\nexport function A({ teamId }) {\n  const { data } = useTeamQuery(teamId);\n  return <div>{data?.name}</div>;\n}\n`,
    "explorations/team-b.tsx": `export function B({ teamId }) {\n  const r = fetch("/api/teams/" + teamId);\n  return <div />;\n}\n`,
    "explorations/team-c.tsx": `import { useAuditQuery } from "@/lib/hooks";\nexport function C({ teamId }) {\n  const { data } = useAuditQuery(teamId);\n  return <div />;\n}\n`,
  });
  const screens = [ORIGINAL, option("x-a", ["explorations/team-a.tsx"]), option("x-b", ["explorations/team-b.tsx"]), option("x-c", ["explorations/team-c.tsx"]), option("x-d", [])];
  const problems = ownDataCalls({ root, explorationId: "team layout", screens, originalFiles: screenFiles(root, ORIGINAL) });
  assert.deepEqual(problems, [
    "x-b: explorations/team-b.tsx:2 makes its own data call fetch, which today's screen does not make: an option in real-code mode imports the original's hooks, handlers and data and only draws",
    "x-c: explorations/team-c.tsx:3 makes its own data call useAuditQuery, which today's screen does not make: an option in real-code mode imports the original's hooks, handlers and data and only draws",
    "x-d: names no `source`, so nothing can show it reuses the original's data: list the option's file",
  ]);
});

test("a raw client call in an option is refused even when the original's files make the same kind of call", () => {
  const root = project({ ...TEAM, "explorations/team-e.tsx": `import { useQuery } from "@tanstack/react-query";\nexport function E() {\n  const q = useQuery({ queryKey: ["team"] });\n  return null;\n}\n` });
  const problems = ownDataCalls({ root, explorationId: "team layout", screens: [ORIGINAL, option("x-e", ["explorations/team-e.tsx"])], originalFiles: screenFiles(root, ORIGINAL) });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^x-e: explorations\/team-e\.tsx:3 makes its own data call useQuery/);
});

/* ------------------------------------------------------------------ 3. the base */

test("the first capture records the commit and the original's files; later ones keep it; a retired real-code base stays", () => {
  const root = committed(TEAM);
  const head = git(root, "rev-parse", "HEAD").trim();
  const screens = [ORIGINAL];
  const first = nextBases({ root, previous: undefined, explorations: [exploration()], screens });
  assert.equal(first["team layout"].commit, head);
  assert.equal(first["team layout"].mode, "real-code");
  assert.deepEqual(first["team layout"].files, ["app/teams/[id]/page.tsx", "components/parts.tsx", "components/team-members.tsx", "components/team-page.tsx", "lib/hooks.ts", "lib/messages.ts"]);
  const kept = nextBases({ root, previous: { "team layout": { ...first["team layout"], commit: "abc" } }, explorations: [exploration()], screens });
  assert.equal(kept["team layout"].commit, "abc");
  const retired = nextBases({ root, previous: first, explorations: [], screens });
  assert.equal(retired["team layout"].retired, true);
  const simple = nextBases({ root, previous: { other: { ...first["team layout"], mode: "simple" } }, explorations: [], screens });
  assert.deepEqual(simple, {});
});

test("outside git there is no base, and the report says so instead of checking", () => {
  const root = project(TEAM);
  assert.equal(baseRecord({ root, explorationId: "x", mode: "real-code", original: "team", entries: ORIGINAL.source }), null);
  const canvasDir = path.join(root, "design-canvas");
  mkdirSync(canvasDir, { recursive: true });
  const report = realCodeReport({ root, canvasDir, slug: "main", decl: { explorations: [exploration()], screens: [ORIGINAL] }, ts: null });
  assert.equal(report.problems.length, 0);
  assert.match(report.notes[0], /no base recorded yet.*not a git repository/);
});

/* ------------------------------------------------------------------ 4. the parity check */

/** Today's screen committed, its base recorded, then the fold-in written over it. */
function folded(text, extra = {}) {
  const root = committed(TEAM);
  const record = baseRecord({ root, explorationId: "team layout", mode: "real-code", original: "team", entries: ORIGINAL.source });
  write(root, { "components/team-page.tsx": text, ...extra });
  return { root, record };
}
/** The chosen option, folded in: new markup and styling, every piece of logic kept. */
const RESTYLED = TEAM_PAGE.replace(`import { DeleteButton, Panel } from "./parts";`, `import { IconButton as DeleteButton, Panel } from "./parts";`)
  .replace(`<Panel className="p-4">`, `<Panel className="grid gap-6 p-8">\n      <header className="flex items-center justify-between">`)
  .replace(`<h1>{team.name}</h1>`, `<h1 className="text-lg font-semibold">{team.name}</h1>\n      </header>`)
  .replace(`{canEdit && <DeleteButton onClick={onDelete} label={t("team.delete")} />}`, `{canEdit && (\n        <DeleteButton onClick={onDelete} label={t("team.delete")} />\n      )}`);
const lost = (result) => result.failures.map((one) => `${one.kind} ${one.label}`);

withTs("a fold-in that only changes markup and styling passes", () => {
  const { root, record } = folded(RESTYLED);
  const result = parityOf({ ts, root, record });
  assert.deepEqual(lost(result), []);
  assert.equal(result.changed, 1);
  assert.ok(result.units > 15, `${result.units} units`);
});

withTs("a dropped condition fails, and passes once it is back", () => {
  const { root, record } = folded(RESTYLED.replace("  if (!team) return null;\n", ""));
  assert.deepEqual(lost(parityOf({ ts, root, record })), ["logic if ( ! team )"]);
  write(root, { "components/team-page.tsx": RESTYLED });
  assert.deepEqual(lost(parityOf({ ts, root, record })), []);
});

withTs("a dropped permission-gated control fails, even beside another control gated the same way", () => {
  const { root, record } = folded(RESTYLED.replace(`{canEdit && (\n        <DeleteButton onClick={onDelete} label={t("team.delete")} />\n      )}`, ""));
  assert.deepEqual(lost(parityOf({ ts, root, record })), ["condition { canEdit && <…> }  (gates <DeleteButton>)", "key \"team.delete\""]);
  write(root, { "components/team-page.tsx": RESTYLED });
  assert.deepEqual(lost(parityOf({ ts, root, record })), []);
});

withTs("an ungated control fails: the condition is the logic", () => {
  const { root, record } = folded(RESTYLED.replace(`{canEdit && (\n        <DeleteButton onClick={onDelete} label={t("team.delete")} />\n      )}`, `<DeleteButton onClick={onDelete} label={t("team.delete")} />`));
  assert.deepEqual(lost(parityOf({ ts, root, record })), ["condition { canEdit && <…> }  (gates <DeleteButton>)"]);
});

withTs("a dropped translation key and changed default copy fail", () => {
  const { root, record } = folded(RESTYLED.replace(`<Link href="/teams">{t("team.back")}</Link>`, `<Link href="/teams">Back</Link>`).replace(`t("team.members", "Members")`, `t("team.members", "People")`));
  assert.deepEqual(lost(parityOf({ ts, root, record })), ['copy "Members"', 'key "team.back"']);
});

withTs("a changed door fails, and a hidden field is held by its name", () => {
  const { root, record } = folded(RESTYLED.replace(`href="/teams"`, `href="/teams/all"`).replace(`name="teamId"`, `name="team"`));
  assert.deepEqual(lost(parityOf({ ts, root, record })), ['field name = "teamId"', 'door "/teams"']);
});

withTs("a file of today's screen that holds logic and is no longer reached fails", () => {
  const { root, record } = folded(RESTYLED.replace(`import { TeamMembers } from "./team-members";\n`, "").replace(`      <TeamMembers teamId={teamId} />\n`, ""));
  const result = parityOf({ ts, root, record });
  assert.deepEqual(lost(result), [`reach no longer reached from today's screen "team", and it holds useMembersQuery`, "prop teamId = { teamId }"]);
  assert.equal(result.failures[0].file, "components/team-members.tsx");
});

withTs("an exception without a location is refused; one whose location does not hold the unit is refused; a real one excuses it", () => {
  const moved = `export function TeamDanger({ canEdit, onDelete, t, DeleteButton }) {\n  return canEdit ? (\n    <DeleteButton onClick={onDelete} label={t("team.delete")} />\n  ) : null;\n}\n`;
  const { root, record } = folded(RESTYLED.replace(`{canEdit && (\n        <DeleteButton onClick={onDelete} label={t("team.delete")} />\n      )}`, `<TeamDanger canEdit={canEdit} onDelete={onDelete} t={t} DeleteButton={DeleteButton} />`), { "components/team-danger.tsx": moved });
  const before = parityOf({ ts, root, record });
  assert.deepEqual(lost(before), ["condition { canEdit && <…> }  (gates <DeleteButton>)", 'key "team.delete"']);
  const entry = (unit, kind, movedTo) => ({ exploration: "team layout", file: "components/team-page.tsx", kind, unit, ...(movedTo ? { movedTo } : {}), why: "the danger zone is its own part" });
  const condition = "{ canEdit && <…> }  (gates <DeleteButton>)";
  const result = parityOf({ ts, root, record, exceptions: [entry(condition, "condition"), entry('"team.delete"', "key", "components/team-danger.tsx:1"), entry("onDelete", "handler", "components/team-danger.tsx:3")] });
  assert.deepEqual(result.refused, [
    `components/team-page.tsx condition ${condition}: names no "movedTo" (<file>:<line>), so nothing shows where the logic went`,
    'components/team-page.tsx key "team.delete": components/team-danger.tsx:1 does not hold "team.delete"',
  ]);
  assert.deepEqual(result.unused, ["components/team-page.tsx handler onDelete -> components/team-danger.tsx:3: no such loss now (safe to delete)"]);
  assert.deepEqual(lost(result), lost(before));
  const fixed = parityOf({ ts, root, record, exceptions: [entry(condition, "condition", "components/team-danger.tsx:2"), entry('"team.delete"', "key", "components/team-danger.tsx:3")] });
  assert.deepEqual(fixed.refused, []);
  assert.deepEqual(lost(fixed), []);
  assert.deepEqual(fixed.excused.map((one) => `${one.kind} ${one.movedTo}`), ["condition components/team-danger.tsx:2", "key components/team-danger.tsx:3"]);
});

withTs("a removal with the reviewer's words excuses exactly that unit; one with no words is refused, and the recorder refuses to write without them", () => {
  const gate = `{canEdit && (\n        <DeleteButton onClick={onDelete} label={t("team.delete")} />\n      )}`;
  const { root, record } = folded(RESTYLED.replace(gate, ""));
  const condition = "{ canEdit && <…> }  (gates <DeleteButton>)";
  assert.deepEqual(lost(parityOf({ ts, root, record })), [`condition ${condition}`, 'key "team.delete"']);
  const removal = (extra) => ({ exploration: "team layout", file: "components/team-page.tsx", kind: "condition", removed: condition, ...extra });
  const words = "Drop the delete button from this page, nobody deletes a team here";
  const accepted = parityOf({ ts, root, record, exceptions: [removal({ said: words })] });
  assert.deepEqual(lost(accepted), ['key "team.delete"'], "only the unit the entry names is excused");
  assert.deepEqual(accepted.excused.map((one) => [one.kind, one.said]), [["condition", words]]);
  assert.match(parityLines(accepted).summary, /1 lost, 1 removed on request$/);
  for (const said of [undefined, "", "   "]) {
    const refused = parityOf({ ts, root, record, exceptions: [removal(said === undefined ? {} : { said })] });
    assert.equal(refused.refused.length, 1, `said: ${JSON.stringify(said)}`);
    assert.match(refused.refused[0], /a removal carries no "said"/);
    assert.deepEqual(lost(refused), lost(parityOf({ ts, root, record })));
  }

  /* The recorder: no words, no write; a name matching nothing is refused; then exactly one entry, with the words. */
  const canvasDir = path.join(root, "design-canvas");
  mkdirSync(path.join(canvasDir, "project"), { recursive: true });
  const file = path.join(canvasDir, "project", "parity-exceptions.json");
  assert.match(recordRemoval({ ts, root, canvasDir, record, removed: condition, said: "" }).error, /needs --said/);
  assert.match(recordRemoval({ ts, root, canvasDir, record, removed: "no such unit", said: words }).error, /is no loss of "team layout" now/);
  assert.throws(() => readFileSync(file), "nothing written");
  const line = parityOf({ ts, root, record }).failures.find((one) => one.kind === "condition").line;
  assert.match(recordRemoval({ ts, root, canvasDir, record, removed: `components/team-page.tsx:${line}`, said: words }).error, /matches 2 losses/, "the gate and its key share a line");
  const written = recordRemoval({ ts, root, canvasDir, record, removed: condition, said: words, at: "2026-10-19T00:00:00.000Z" });
  assert.deepEqual(written.entry, { exploration: "team layout", file: "components/team-page.tsx", kind: "condition", removed: condition, said: words, at: "2026-10-19T00:00:00.000Z" });
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), [written.entry]);
  assert.deepEqual(lost(parityOf({ ts, root, record, exceptions: JSON.parse(readFileSync(file, "utf8")) })), ['key "team.delete"']);
});

withTs("a location is checked for the unit's own logic, not for a line that only names it", () => {
  const root = project({ "a.tsx": `const x = 1;\nconst A = () => <div>{canEdit && <B />}</div>;\nconst C = () => <div>{!canEdit && <D />}</div>;\n` });
  const unit = { kind: "condition", text: "{ canEdit && <…> }", core: "canEdit", line: 1, end: 1 };
  assert.deepEqual(locationHolds({ ts, root, unit, movedTo: "a.tsx:2" }), { ok: true });
  assert.equal(locationHolds({ ts, root, unit, movedTo: "a.tsx:1" }).ok, false);
  assert.deepEqual(locationHolds({ ts, root, unit, movedTo: "a.tsx:3" }), { ok: false, why: "a.tsx:3 does not hold canEdit" });
  assert.match(locationHolds({ ts, root, unit, movedTo: "a.tsx" }).why, /not <file>:<line>/);
  assert.match(locationHolds({ ts, root, unit, movedTo: "b.tsx:1" }).why, /does not exist/);
});

withTs("i18n calls of other shapes give keys and copy: formatMessage, <Trans>, message objects", () => {
  const units = unitsOf(
    ts,
    `const m = defineMessages({ save: { id: "app.save", defaultMessage: "Save" } });\nconst a = intl.formatMessage({ id: "app.title", defaultMessage: "Title" });\nconst b = formatMessage(labels.members);\nconst c = <Trans i18nKey="app.hello">Hello</Trans>;\nconst d = <Trans>Plain words</Trans>;\nconst e = <FormattedMessage id="app.bye" defaultMessage="Bye" />;\n`,
    "m.tsx",
  )
    .filter((one) => one.kind === "key" || one.kind === "copy")
    .map((one) => `${one.kind} ${one.text}`);
  assert.deepEqual(units, ['key "app.save"', 'copy "Save"', 'key "app.title"', 'copy "Title"', "key labels . members", 'key "app.hello"', 'copy "Plain words"', 'key "app.bye"', 'copy "Bye"']);
});

withTs("a retired real-code base is released once its parity passes, and kept while it fails", () => {
  const { root, record } = folded(RESTYLED);
  const canvasDir = path.join(root, "design-canvas");
  mkdirSync(path.join(canvasDir, "project"), { recursive: true });
  assert.deepEqual(releaseRetired({ root, canvasDir, bases: { a: { ...record, retired: true } }, ts }).released, ["a"]);
  const gone = realCodeReport({ root, canvasDir, slug: "main", decl: { explorations: [], screens: [] }, ts });
  assert.equal(gone.lines.length, 0, "no base on record yet");
  write(root, { "components/team-page.tsx": RESTYLED.replace(`href="/teams"`, `href="/x"`) });
  const kept = releaseRetired({ root, canvasDir, bases: { a: { ...record, retired: true } }, ts });
  assert.deepEqual(kept.released, []);
  assert.deepEqual(kept.kept, ["a"]);
  assert.ok(kept.bases.a);
  /* Retired in the declaration before any capture marked it: the report still checks it. */
  write(root, { "design-canvas/shots/main/manifest.json": JSON.stringify({ shots: [], bases: { a: record } }) });
  const report = realCodeReport({ root, canvasDir, slug: "main", decl: { explorations: [], screens: [] }, ts });
  assert.deepEqual(report.problems, ['parity: a: components/team-page.tsx:21 lost door "/teams"']);
});

withTs("the report for a canvas: the mode lines, an option's own data call and a lost unit are problems", () => {
  const { root, record } = folded(RESTYLED.replace(`href="/teams"`, `href="/x"`), { "explorations/a.tsx": `export const A = () => { fetch("/api"); return null; };\n` });
  const canvasDir = path.join(root, "design-canvas");
  write(root, { "design-canvas/shots/main/manifest.json": JSON.stringify({ shots: [], bases: { "team layout": record } }) });
  const report = realCodeReport({ root, canvasDir, slug: "main", decl: { explorations: [exploration()], screens: [ORIGINAL, option("x-a", ["explorations/a.tsx"])] }, ts });
  assert.equal(report.modes.length, 1);
  assert.match(report.modes[0], /real-code mode/);
  assert.deepEqual(report.problems, [
    "options: x-a: explorations/a.tsx:1 makes its own data call fetch, which today's screen does not make: an option in real-code mode imports the original's hooks, handlers and data and only draws",
    'parity: team layout: components/team-page.tsx:21 lost door "/teams"',
  ]);
  assert.match(report.lines[0], /^parity of "team layout" against [0-9a-f]{12}: 6 file\(s\) of today's screen, 1 changed/);
  assert.ok(JSON.parse(readFileSync(path.join(canvasDir, "shots", "main", "manifest.json"), "utf8")).bases);
});

test("a hook the original's files only define, through a folder of hooks, is not one they use", () => {
  const root = project({
    ...TEAM,
    "lib/hooks.ts": `${TEAM["lib/hooks.ts"]}export function useProfileQuery(id) { return useQuery({ queryKey: ["profile", id] }); }\n`,
    "explorations/team-f.tsx": `import { useProfileQuery, useTeamQuery } from "@/lib/hooks";\nexport function F({ teamId }) {\n  const team = useTeamQuery(teamId);\n  const profile = useProfileQuery(teamId);\n  return null;\n}\n`,
  });
  const problems = ownDataCalls({ root, explorationId: "team layout", screens: [ORIGINAL, option("x-f", ["explorations/team-f.tsx"])], originalFiles: screenFiles(root, ORIGINAL) });
  assert.deepEqual(problems.map((line) => line.split(" makes")[0]), ["x-f: explorations/team-f.tsx:4"]);
});

test("an option the original's own file switches to is still the option's, not the original's", () => {
  const seam = TEAM_PAGE.replace(`import { DeleteButton, Panel } from "./parts";`, `import { DeleteButton, Panel } from "./parts";\nimport { TeamA } from "@/explorations/team-a"; // design-canvas:local`);
  const root = committed({ ...TEAM, "components/team-page.tsx": seam, "explorations/team-a.tsx": `export function TeamA() {\n  const r = fetch("/api/x");\n  return null;\n}\n` });
  const screens = [ORIGINAL, option("x-a", ["explorations/team-a.tsx"])];
  const report = realCodeReport({ root, canvasDir: path.join(root, "design-canvas"), slug: "main", decl: { explorations: [exploration()], screens }, ts: null });
  assert.deepEqual(report.problems, ["options: x-a: explorations/team-a.tsx:2 makes its own data call fetch, which today's screen does not make: an option in real-code mode imports the original's hooks, handlers and data and only draws"]);
  const bases = nextBases({ root, explorations: [exploration()], screens });
  assert.ok(!bases["team layout"].files.includes("explorations/team-a.tsx"));
  assert.ok(bases["team layout"].files.includes("components/team-page.tsx"));
});

/* ------------------------------------------------------------------ the base follows a pull */

const TOOL_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" };
const gitIn = (cwd, ...args) => execFileSync("git", ["-c", "commit.gpgsign=false", ...args], { cwd, env: GIT_ENV, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const put = (root, rel, text) => {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), text);
};

/** A developer's repository behind a bare remote, and a designer's clone whose canvas recorded two bases at the clone's commit. */
function pulledPair() {
  const dir = mkdtempSync(path.join(tmpdir(), "canvas-parity-follow-"));
  made.push(dir);
  gitIn(dir, "init", "-q", "--bare", "-b", "main", "remote.git");
  const dev = path.join(dir, "developer");
  mkdirSync(dev);
  put(dev, "app/tasks/page.tsx", "export default function Page() { return null; }\n");
  put(dev, "lib/other.ts", "export const other = 1;\n");
  gitIn(dev, "init", "-q", "-b", "main");
  gitIn(dev, "add", "-A");
  gitIn(dev, "commit", "-qm", "project");
  gitIn(dev, "remote", "add", "origin", "../remote.git");
  gitIn(dev, "push", "-q", "-u", "origin", "main");
  gitIn(dir, "clone", "-q", "remote.git", "designer");
  const des = path.join(dir, "designer");
  const base = gitIn(des, "rev-parse", "HEAD");
  const canvasDir = path.join(des, "design-canvas");
  put(des, ".git/info/exclude", "/design-canvas/\n");
  const bases = {
    tasks: { exploration: "tasks", mode: "real-code", original: "tasks-today", commit: base, files: ["app/tasks/page.tsx"] },
    other: { exploration: "other", mode: "real-code", original: "other-today", commit: base, files: ["lib/missing.ts"] },
  };
  put(canvasDir, "shots/one/manifest.json", JSON.stringify({ shots: [], bases }));
  return { dev, des, canvasDir, base };
}
const basesOf = (canvasDir) => JSON.parse(readFileSync(path.join(canvasDir, "shots/one/manifest.json"), "utf8")).bases;

test("a pull that brings the developers' change to an original's file moves that base to the pulled commit, and only that one", async () => {
  const { followRemote, rememberHead, takeHead } = await import("../parity.mjs");
  const { dev, des, canvasDir, base } = pulledPair();
  /* The designer's own fold-in, not pushed: it never moves a base. */
  put(des, "app/tasks/page.tsx", "export default function Page() { return 'folded'; }\n");
  gitIn(des, "commit", "-qam", "fold in");
  put(dev, "app/tasks/page.tsx", "export default function Page() { const gate = true; return gate ? null : null; }\n");
  gitIn(dev, "commit", "-qam", "gate the page");
  put(dev, "README.md", "notes\n");
  gitIn(dev, "add", "-A");
  gitIn(dev, "commit", "-qm", "notes");
  gitIn(dev, "push", "-q");
  const tip = gitIn(dev, "rev-parse", "HEAD");
  rememberHead({ root: des, canvasDir });
  gitIn(des, "pull", "-q", "--no-rebase", "--no-edit", "-X", "theirs", "origin", "main");
  const lines = await followRemote({ root: des, canvasDir, before: takeHead(canvasDir) });
  assert.deepEqual(lines, [`design-canvas: the base of exploration "tasks" on one moved to ${tip.slice(0, 12)}, the pulled commit, because it changed app/tasks/page.tsx`]);
  const bases = basesOf(canvasDir);
  assert.equal(bases.tasks.commit, tip);
  assert.ok(bases.tasks.movedAt);
  assert.equal(bases.other.commit, base, "a base whose files the pull did not touch stays");
  /* Nothing new pulled, and the designer's own commits (pushed or not) move nothing. */
  put(des, "app/tasks/page.tsx", "export default function Page() { return 'again'; }\n");
  gitIn(des, "commit", "-qam", "more fold in");
  gitIn(des, "push", "-q", "origin", "main");
  rememberHead({ root: des, canvasDir });
  gitIn(des, "pull", "-q", "--no-rebase", "origin", "main");
  assert.deepEqual(await followRemote({ root: des, canvasDir, before: takeHead(canvasDir) }), []);
  assert.equal(basesOf(canvasDir).tasks.commit, tip);
});

test("a base is not moved under a running capture of its canvas: the line names the command instead", async () => {
  const { followRemote } = await import("../parity.mjs");
  const { dev, des, canvasDir, base } = pulledPair();
  put(dev, "app/tasks/page.tsx", "export default function Page() { return 1; }\n");
  gitIn(dev, "commit", "-qam", "change");
  gitIn(dev, "push", "-q");
  const before = gitIn(des, "rev-parse", "HEAD");
  gitIn(des, "pull", "-q", "origin", "main");
  put(canvasDir, "rounds/one/capture.lock", JSON.stringify({ pid: process.pid }));
  const lines = await followRemote({ root: des, canvasDir, before });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /did not move because a capture of one is running .*parity\.mjs --canvas one --exploration tasks --base [0-9a-f]{12}$/);
  assert.equal(basesOf(canvasDir).tasks.commit, base);
});

test("through the hook: a pull run by the agent moves the base and says so after the command", async () => {
  const { dev, des, canvasDir } = pulledPair();
  for (const name of readdirSync(TOOL_DIR).filter((one) => one.endsWith(".mjs"))) put(canvasDir, name, readFileSync(path.join(TOOL_DIR, name), "utf8"));
  put(dev, "app/tasks/page.tsx", "export default function Page() { return 2; }\n");
  gitIn(dev, "commit", "-qam", "change");
  gitIn(dev, "push", "-q");
  const tip = gitIn(dev, "rev-parse", "HEAD");
  const hook = (event) =>
    execFileSync(process.execPath, [path.join(canvasDir, "hook.mjs")], {
      cwd: des,
      env: GIT_ENV,
      encoding: "utf8",
      input: JSON.stringify({ hook_event_name: event, tool_name: "Bash", tool_input: { command: "git pull" } }),
    });
  assert.equal(hook("PreToolUse"), "");
  gitIn(des, "pull", "-q", "origin", "main");
  const said = JSON.parse(hook("PostToolUse"));
  assert.equal(said.hookSpecificOutput.hookEventName, "PostToolUse");
  assert.match(said.hookSpecificOutput.additionalContext, new RegExp(`base of exploration "tasks" on one moved to ${tip.slice(0, 12)}`));
  assert.equal(basesOf(canvasDir).tasks.commit, tip);
});
