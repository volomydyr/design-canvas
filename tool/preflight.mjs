#!/usr/bin/env node
/**
 * design-canvas — THE PREFLIGHT: everything about a declaration that can be known in seconds, before a capture.
 *
 *   node design-canvas/preflight.mjs --canvas <slug>                 the static checks, from the declaration FILE
 *   node design-canvas/preflight.mjs --canvas <slug> --live --only a,b   also open those frames on the served app
 *
 * WHY IT EXISTS. The capture and the oracle prove a canvas TRUE, and they take minutes: a capture of the frames that
 * changed, then an oracle that opens every page. Most of what they refuse was knowable from the declaration alone, and each
 * refusal cost a whole round to learn: copy that broke a rule, a frame that was the same picture as another, `under`
 * nested one level too deep, an arrow across two sections, a claim spelled "Saved Changes" while the app ships "Saved
 * changes.", a comment left pinned to a frame the declaration dropped. This runs all of them first, reading the file and
 * the shipped copy, with no dev server and no browser.
 *
 * WHAT IT CHECKS, each one named in the output:
 *   copy         the copy rules over every label, note and edge label (`copy-rules.mjs`), as the oracle holds them
 *   declaration  duplicate pictures and ids, `under` deeper than one level, a section id equal to a screen id, an arrow
 *                across groups or to nothing, a pinned `state` the states file does not have
 *   steps        every screen's click steps parse: an unknown step type is refused here, as it throws in the capture
 *   network      every screen's network rules, and the canvas-wide list, parse: an unknown rule, an operation named twice, a
 *                `writes` on a screen, an `answer` with nothing to answer
 *   comments     a frame dropped with comments still pinned to it and no `successors` entry, which would refuse the capture
 *   coverage     a NOTE: the dialogs, sheets, menus and addresses the declared screens' files reach that no frame shows
 *   options      in real-code mode (`parity.mjs`), an option whose own files make data calls the original's do not
 *   parity       in real-code mode, everything today's screen did at the exploration's first capture that its files lost
 *   claims       every `expect` string against the locale files and the source the app ships, and against what the last
 *                capture proved. A claim that differs from a shipped string only in case is a NOTE that names the `--live`
 *                command to decide it (a page may render the text transformed by CSS, which no file can show); one found
 *                nowhere is a note too, because it may be data
 *   live         with `--live`: the named frames opened on the served app, their network rules put on the page and their steps
 *                pressed, their claims read (in seconds, without photographing), and a deep link whose parameter the app strips
 *                flagged as a DEAD SEED
 *
 * Before the checks, one `mode:` line per exploration names its mode (real-code or simple) and why, for the agent to say.
 *
 * THE LAST LINE IS THE VERDICT, as the oracle's is: `PREFLIGHT PASS`, or `PREFLIGHT FAIL (<count>): <kind> <n>, ...`.
 * Exit codes: 0 pass, 1 problems, 2 the run could not start. `round.mjs` runs this first and stops on a failure.
 *
 * DELETE WITH: the design-canvas/ folder.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checkLoginRedirect, clickDismissals, closeBrowser, die, guardCrashes, launchBrowser, loadDismissals, openContext, requireStorageState, seedDismissals } from "./browser-guards.mjs";
import { commentsFileFor, declaredFrames, planPins, planSummary, refusalFailures, remedyLine } from "./comment-integrity.mjs";
import { applyNetwork, hasNetwork, mergeNetwork } from "./network.mjs";
import { filesReachedFrom } from "./closure.mjs";
import { declarationFor, loadDeclarations, slugsOf } from "./declarations.mjs";
import { realCodeReport } from "./parity.mjs";
import { checkLocaleFiles, claimFindings, collectClaims, coverageGaps, coverageNote, detectLocales, lintAll, loadProjectTexts, unknownStateProblems } from "./preflight-rules.mjs";
import { loadSettings, runSettings } from "./project-settings.mjs";
import { readSurfaceText, runSteps } from "./steps.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const argv = process.argv.slice(2);
const argOf = (name) => {
  const at = argv.indexOf(`--${name}`);
  return at === -1 ? undefined : argv[at + 1];
};
const has = (name) => argv.includes(`--${name}`);

const started = Date.now();
const seconds = () => `${((Date.now() - started) / 1000).toFixed(1)}s`;

const canvasSlug = argOf("canvas") ?? "main";
if (!/^[a-z0-9][a-z0-9-]*$/.test(canvasSlug)) die("preflight", `refusing --canvas "${canvasSlug}": a canvas slug is lowercase letters, digits and dashes only`);

const settings = loadSettings(HERE, "preflight");
const { appUrl, storageState, browserChannel, loginRoute } = runSettings(argv, settings);
const base = appUrl ?? "";
const only = (argOf("only") ?? "").split(",").map((one) => one.trim()).filter(Boolean);

/** Problems by kind, in the order the output prints them. */
const KINDS = ["copy", "declaration", "steps", "network", "comments", "options", "parity", "claims", "live"];
const problems = Object.fromEntries(KINDS.map((kind) => [kind, []]));
const notes = [];
const modes = [];
const ran = new Set();

/** The verdict, as the last line, for every exit including a crash. */
function finalLine(reason) {
  const counts = KINDS.filter((kind) => problems[kind].length > 0).map((kind) => `${kind} ${problems[kind].length}`);
  const total = KINDS.reduce((sum, kind) => sum + problems[kind].length, 0);
  if (reason) return `PREFLIGHT FAIL: ${reason}${total > 0 ? ` (${total} problem(s) before it: ${counts.join(", ")})` : ""}`;
  return total === 0 ? "PREFLIGHT PASS" : `PREFLIGHT FAIL (${total}): ${counts.join(", ")}`;
}
guardCrashes({ who: "preflight", storageState, tail: (reason, print = console.log) => print(finalLine(reason)) });

/* ------------------------------------------------------------------ 1. the declaration, from the file */

const dump = spawnSync(process.execPath, [path.join(HERE, "dump-screens.mjs"), "--canvas", canvasSlug], {
  cwd: ROOT,
  encoding: "utf8",
  maxBuffer: 256 * 1024 * 1024,
});
if (dump.status !== 0) {
  const why = String(dump.stderr || dump.stdout || "no output").trim().split("\n")[0];
  die("preflight", `could not read the declaration: ${why}`);
}
let decl;
try {
  decl = JSON.parse(dump.stdout);
} catch {
  die("preflight", "dump-screens.mjs printed something that is not JSON");
}
const screens = decl.screens ?? [];

/* ------------------------------------------------------------------ 2. the static checks */

{
  let shots = [];
  try {
    shots = JSON.parse(readFileSync(path.join(HERE, "shots", canvasSlug, "manifest.json"), "utf8")).shots ?? [];
  } catch {
    /* Nothing captured yet, so no frame has a switch to lose. */
  }
  const lint = lintAll(decl, { shots, evidenceDir: path.join(HERE, "evidence", canvasSlug), root: ROOT });
  for (const kind of ["copy", "declaration", "steps", "network"]) {
    problems[kind].push(...lint[kind]);
    ran.add(kind);
  }
  if (lint.without.length > 0)
    notes.push(
      `${lint.without.length} exploration frame(s) draw no switch to today's screen, each declaring that today's app has nothing like it (redesigns: null): ` +
        `${lint.without.slice(0, 12).join(", ")}${lint.without.length > 12 ? `, and ${lint.without.length - 12} more` : ""}`,
    );
}
/* Every pinned state against the states file, and the canvas files it imports (a large one splits its states across files). */
{
  const statesRel = path.relative(ROOT, path.join(HERE, "project", "states.ts")).split(path.sep).join("/");
  const canvasRel = path.relative(ROOT, HERE).split(path.sep).join("/");
  const files = filesReachedFrom([statesRel], ROOT).filter((rel) => rel.startsWith(`${canvasRel}/project/`));
  const texts = files.length === 0 ? null : files.map((rel) => readFileSync(path.join(ROOT, rel), "utf8"));
  problems.declaration.push(...unknownStateProblems(screens, texts));
}
/* COVERAGE: the dialogs, sheets, menus and addresses the declared screens reach that no frame on any canvas shows. A note. */
{
  const declared = { routes: [], sources: [] };
  const add = (list) => {
    for (const screen of list ?? []) {
      if (screen.route) declared.routes.push(screen.route);
      declared.sources.push(...(screen.source ?? []));
    }
  };
  try {
    const loaded = await loadDeclarations(HERE);
    for (const slug of slugsOf(loaded)) {
      const { declaration } = declarationFor(loaded, slug);
      for (const group of [...(declaration?.flows ?? []), ...(declaration?.explorations ?? [])]) add(group.screens);
    }
  } catch {
    /* The other canvases could not be read: this canvas alone decides what is declared. */
  }
  add(screens);
  const note = coverageNote(coverageGaps({ root: ROOT, screens, declared }));
  if (note) notes.push(note);
}
/* REAL-CODE MODE: each exploration's mode, an option's own data calls, and the parity of what today's screen did. */
let parityDetail = "no real-code exploration";
{
  const report = realCodeReport({ root: ROOT, canvasDir: HERE, slug: canvasSlug, decl });
  modes.push(...report.modes);
  for (const line of report.problems) (line.startsWith("options: ") ? problems.options : problems.parity).push(line.replace(/^(options|parity): /, ""));
  notes.push(...report.notes);
  if (report.lines.length > 0) parityDetail = report.lines.join("; ");
  else if (report.modes.some((line) => line.includes(": real-code mode"))) parityDetail = "nothing to compare with until the first capture records a base";
  ran.add("options");
  ran.add("parity");
}
const stepFrames = screens.filter((screen) => screen.steps?.length).length;
const networkFrames = screens.filter((screen) => screen.network?.length).length;

/* Comments: what the declaration would leave homeless, decided by the same planner the capture refuses with. */
const commentsFile = commentsFileFor(HERE, canvasSlug);
let commentCount = 0;
if (commentsFile) {
  try {
    const file = JSON.parse(readFileSync(commentsFile, "utf8"));
    commentCount = (file.comments ?? []).length;
    const frames = declaredFrames(screens);
    const plan = planPins({ comments: file.comments ?? [], declared: frames, successors: decl.successors });
    const said = refusalFailures(plan);
    problems.comments.push(...said.map((line, at) => (at === 0 && remedyLine(plan) ? `${line}\n      ${remedyLine(plan).replace(/\n/g, "\n      ")}` : line)));
    const moving = planSummary(plan);
    if (moving) notes.push(`the capture will move comments: ${moving.replace(/\n/g, "; ")}`);
    const used = new Set((file.comments ?? []).map((one) => one.screenId));
    const idle = Object.keys(decl.successors ?? {}).filter((frame) => !used.has(frame));
    if (idle.length > 0) notes.push(`successors with no comment left to move (safe to delete): ${idle.join(", ")}`);
    const returned = Object.keys(decl.successors ?? {}).filter((frame) => frames.has(frame));
    if (returned.length > 0) notes.push(`successors naming frames that are declared again (the entry does nothing): ${returned.join(", ")}`);
  } catch (error) {
    problems.comments.push(`could not read ${path.relative(ROOT, commentsFile)}: ${String(error.message).split("\n")[0]}`);
  }
}
ran.add("comments");

/* Claims against the copy the app ships. */
let claimsSummary = "skipped (--no-claims)";
if (!has("no-claims")) {
  const named = (argOf("locale") ? argOf("locale").split(",") : []).map((one) => path.resolve(ROOT, one.trim())).filter(Boolean);
  const wanted = named.length > 0 ? named : settings.locales.length > 0 ? settings.locales : detectLocales(ROOT);
  const { present, missing } = checkLocaleFiles(wanted);
  for (const file of missing) problems.claims.push(`the locale file ${path.relative(ROOT, file)} does not exist`);
  const texts = loadProjectTexts(ROOT, present);
  const claims = collectClaims(screens);
  /* What the last capture already PROVED on the page, frame by frame: the page said it, so no file needs to. */
  const proven = new Set();
  try {
    const manifest = JSON.parse(readFileSync(path.join(HERE, "shots", canvasSlug, "manifest.json"), "utf8"));
    for (const shot of manifest.shots ?? []) for (const one of shot.claims ?? []) if (one.met) proven.add(`${shot.screenId}\u0000${one.claim}`);
  } catch {
    /* Nothing captured yet: every claim is judged against the files alone. */
  }
  const found = claimFindings({ claims, locale: texts.locale, source: texts.source, proven });
  if (found.drift.length > 0) {
    const shown = found.drift.slice(0, 8).map((one) => `${one.screen}: claims "${one.claim}", the app ships "${one.shipped}"`);
    notes.push(
      `${found.drift.length} claim(s) differ from a shipped string only in case or punctuation, so the capture will miss them unless the page renders the text transformed (CSS text-transform): ` +
        shown.join("; ") +
        (found.drift.length > shown.length ? `; and ${found.drift.length - shown.length} more` : "") +
        `. \`--live --only ${[...new Set(found.drift.map((one) => one.screen))].slice(0, 6).join(",")}\` reads the page and decides`,
    );
  }
  if (found.unknown.length > 0) {
    const shown = found.unknown.slice(0, 10).map((one) => `${one.screen}: "${one.claim}"`);
    notes.push(
      `${found.unknown.length} claim(s) appear nowhere in the locale files or the source (data the app fetches, or copy that moved): ` +
        shown.join("; ") +
        (found.unknown.length > shown.length ? `; and ${found.unknown.length - shown.length} more` : ""),
    );
  }
  claimsSummary = `${claims.length} claim(s): ${found.found} found in ${present.length} locale file(s), ${texts.sourceFiles} source file(s) or the last capture${found.drift.length > 0 ? `, ${found.drift.length} differ in case` : ""}`;
  if (present.length === 0) notes.push(`no locale file was found, so claims are judged against source text only: name them once in design-canvas/settings.json ("locales": ["messages/en.json"])`);
}
ran.add("claims");

/* ------------------------------------------------------------------ 3. the served app, opt-in */

if (has("live")) {
  if (!base) die("preflight", `--live needs the app's address: pass --url, or write "appUrl" in design-canvas/settings.json (this tool does not guess a port)`);
  requireStorageState("preflight", storageState, base);
  const { chromium } = await import("playwright");
  const targets = screens.filter((screen) => screen.url && !screen.explain && !screen.frozen && (only.length === 0 || only.includes(screen.id)));
  if (only.length > 0) for (const id of only) if (!screens.some((screen) => screen.id === id)) problems.live.push(`--only names "${id}", which is no screen on this canvas`);
  const browser = await launchBrowser(chromium, { who: "preflight", channel: browserChannel, storageState });
  /* A browser this run opens is closed however it ends: a `finally`, and behind it the lifecycle's exit hook, signal
     handlers and watchdog (`browser-lifecycle.mjs`). */
  try {
    /* A service worker answers from the worker and never reaches the route a frame's network rules are on: blocked when any asks. */
    const blockWorkers = hasNetwork(decl.network, undefined) || targets.some((screen) => hasNetwork(undefined, screen.network));
    const context = await openContext(browser, { viewport: { width: decl.viewport.w, height: decl.viewport.h }, deviceScaleFactor: 1, ...(blockWorkers ? { serviceWorkers: "block" } : {}) }, { who: "preflight", storageState });
    /* The capture's own mark, so a photograph-only shortcut in app code applies to the page this reads as it does to the shot. */
    await context.addInitScript(() => {
      window.__designCanvasCapture = true;
    });
    const dismissals = loadDismissals(HERE, canvasSlug, "preflight");
    await seedDismissals(context, dismissals.seeds);
    const addressOf = (screen) => (screen.wireframe ? screen.url : `${base}${screen.url}`);

    /* The first page, alone: a redirect to sign-in stops the run in seconds, as it does in the capture and the oracle. */
    if (targets[0] && !targets[0].wireframe) {
      const probe = await context.newPage();
      const first = addressOf(targets[0]);
      const reached = await probe.goto(first, { waitUntil: "domcontentloaded", timeout: 30_000 }).then(() => true, () => false);
      if (reached) await checkLoginRedirect(probe, first, { who: "preflight", storageState, appUrl: base, loginRoute });
      await probe.close();
    }

    const BUDGET_MS = 8_000;
    const visit = async (screen) => {
      const page = await context.newPage();
      const opened = Date.now();
      let control = null;
      try {
        const want = screen.viewport?.w && screen.viewport?.h ? screen.viewport : screen.deviceViewport?.w ? screen.deviceViewport : decl.viewport;
        await page.setViewportSize({ width: want.w, height: want.h });
        /* THE FRAME'S DATA, as the capture holds, fails or answers it (`network.mjs`): a loading or an empty frame's claims are
           read from a page that is loading or empty, or every one of them would fail on the real data. */
        control = await applyNetwork(page, mergeNetwork(decl.network, screen.network));
        const url = addressOf(screen);
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
        await page.waitForLoadState("load", { timeout: 10_000 }).catch(() => undefined);
        if (dismissals.clicks.length > 0) {
          await page.waitForTimeout(400);
          await clickDismissals(page, dismissals.clicks);
        }
        /* A DEAD SEED: the declared address carries a parameter and the app dropped it, so the frame is the list and not the
           record it names. By hand it takes minutes of timeouts to find; here it is one line, at once. */
        const asked = new URL(url, "http://x").searchParams;
        const landed = new URL(page.url()).searchParams;
        const lost = [...asked.keys()].filter((key) => key !== "canvas" && !landed.has(key));
        if (lost.length > 0) return [`${screen.id}: DEAD SEED. ${screen.url} lost ${lost.map((key) => `?${key}`).join(", ")} on the way (it landed on ${new URL(page.url()).pathname}${new URL(page.url()).search}), so the frame shows a page that is not the one it names`];
        if (screen.steps?.length) {
          try {
            await runSteps(page, screen.steps, { dismissals });
          } catch (error) {
            return [`${screen.id}: its steps do not run on the served app: ${error.message}`];
          }
        }
        /* The page's own data is in before its claims are read, as the capture waits for it (the quiet wait, capped, and free on a quiet page). */
        await control.tracker.quiet();
        const wanted = screen.expect ?? [];
        let text = await readSurfaceText(page);
        const limit = Date.now() + BUDGET_MS;
        while (Date.now() < limit && !(wanted.every((claim) => text.includes(claim)) && control.unmet().length === 0)) {
          await page.waitForTimeout(250);
          text = await readSurfaceText(page);
        }
        const out = [];
        for (const claim of wanted) if (!text.includes(claim)) out.push(`${screen.id}: the served page does not show "${claim}"${screen.steps?.length ? " after its steps" : ""}`);
        /* The same proof the capture makes: a rule of the frame's own that the page never asked for is a stale rule. */
        for (const rule of control.unmet()) out.push(`${screen.id}: the served page never asked for ${rule.op}${screen.steps?.length ? " (not even after its steps)" : ""}, so its rule "${rule.kind} ${rule.op}" matches nothing`);
        for (const nope of screen.expectMissing ?? []) if (text.includes(nope)) out.push(`${screen.id}: the served page shows "${nope}", which this frame says it does not`);
        if (out.length === 0) console.log(`  ok    ${screen.id.padEnd(28)} ${((Date.now() - opened) / 1000).toFixed(1)}s`);
        return out;
      } catch (error) {
        return [`${screen.id}: did not load: ${String(error.message).split("\n")[0]}`];
      } finally {
        /* A held request is aborted before its page closes, or the browser lets it through (see `dispose` in network.mjs). */
        await control?.dispose();
        await page.close().catch(() => undefined);
      }
    };
    console.log(`live: opening ${targets.length} frame(s) on ${base}, four at a time`);
    const queue = [...targets];
    await Promise.all(
      Array.from({ length: Math.min(4, queue.length) }, async () => {
        for (let next = queue.shift(); next; next = queue.shift()) {
          const found = await visit(next);
          for (const line of found) console.log(`  FAIL  ${line}`);
          problems.live.push(...found);
        }
      }),
    );
  } finally {
    await closeBrowser(browser);
  }
  ran.add("live");
}

/* ------------------------------------------------------------------ 4. the report */

const dots = (name) => `${name} ${".".repeat(Math.max(2, 14 - name.length))}`;
console.log(`\npreflight ${canvasSlug}: ${screens.length} frame(s), ${decl.groups?.length ?? 0} flow(s), ${decl.explorations?.length ?? 0} exploration(s), ${seconds()}`);
for (const line of modes) console.log(`mode: ${line}`);
const detail = {
  copy: `${screens.length} frame(s) and ${(decl.groups ?? []).reduce((sum, group) => sum + (group.edges?.length ?? 0), 0)} edge label(s)`,
  declaration: "pictures, ids, under, sections, arrows, switches to today, explanations, actions",
  steps: `${stepFrames} frame(s) press steps`,
  network: `${networkFrames} frame(s) hold, fail or answer data${(decl.network ?? []).some((rule) => "writes" in rule) ? ", every save aborted" : ""}`,
  comments: commentsFile ? `${commentCount} comment(s) on file` : "no comments file",
  options: modes.some((line) => line.includes(": real-code mode")) ? "every option draws over the original's data" : "no real-code exploration",
  parity: parityDetail,
  claims: claimsSummary,
  live: `${only.length > 0 ? only.length : "every"} frame(s)`,
};
for (const kind of KINDS) {
  if (!ran.has(kind)) continue;
  const list = problems[kind];
  console.log(`  ${dots(kind)} ${list.length === 0 ? `ok (${detail[kind]})` : `${list.length} problem(s)`}`);
  for (const line of list) console.log(`      - ${line}`);
}
if (notes.length > 0) {
  console.log("\nnotes:");
  for (const note of notes) console.log(`  - ${note}`);
}
console.log(`\n${finalLine()}`);
process.exit(KINDS.some((kind) => problems[kind].length > 0) ? 1 : 0);
