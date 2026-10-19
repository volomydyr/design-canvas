#!/usr/bin/env node
/**
 * design-canvas: KEEP THE PICTURES THE REVIEWER LOOKS AT CURRENT, WITHOUT ANYONE REMEMBERING TO RECAPTURE.
 *
 *   node design-canvas/recapture.mjs [--canvas <slug>]   recapture the out-of-date frames now (every canvas, or one); by hand
 *   node design-canvas/recapture.mjs --plan              say which frames are out of date, per canvas, and why; capture nothing
 *   node design-canvas/recapture.mjs --hook              the Claude Code Stop hook: decide, start the background run, return
 *   node design-canvas/recapture.mjs --focus             the background run for the canvases open now (`round.mjs` starts it)
 *   node design-canvas/recapture.mjs --opened <slug>     the canvas page was just opened: refresh that canvas (the route starts it)
 *
 * WHICH FRAMES ARE OUT OF DATE. A frame is out of date when a file its picture was made from changed since the picture was taken,
 * when its own declaration changed, or when it has no picture yet. "Made from" is the stamp `capture.mjs` writes on every shot:
 * the content hash of every file in the frame's import closure (`closure.mjs`), its pinned state's file and the global style
 * inputs. This file re-hashes the files a stamp lists and compares, so it reads exactly what the capture recorded.
 *
 * WHEN AND WHAT IS RECAPTURED. Recapturing every out-of-date frame after every turn photographs canvases nobody is looking at
 * and keeps the laptop busy for minutes after a one-line change. So a recapture happens at moments, and takes the frames in focus:
 *
 *   - the end of an agent turn in which the frames' inputs changed (`--hook`; a turn that changed nothing they are made of starts
 *     nothing, and edits inside a turn trigger nothing, because only the end of a turn is a hook event);
 *   - a review round (`round.mjs` captures the frames it names, then starts `--focus` for the canvases open now);
 *   - a request by hand (the plain command).
 *
 * In focus at a turn's end or after a round: the frames of every canvas a reviewer has open right now (`openCanvases`, from the
 * reports the canvas page sends while its tab is visible), the frames on screen first, then the rest of that canvas. Every other
 * canvas stays out of date quietly, and the hook says how many frames that is in one line. A canvas refreshes as it is opened
 * (`--opened`, started by the comments route), its frames on screen first, and the pictures land in the Changed Screens queue
 * like any other capture. A set larger than `LARGE_SET` frames runs `FEW_LANES` at a time, so the machine stays usable.
 *
 * WHAT IT RUNS. One `capture.mjs --canvas <slug> --first <ids on screen>` per canvas in focus that has an out-of-date frame or a
 * picture of a frame that left the declaration. The capture takes the canvas's lock, selects by the same stamps itself and leaves
 * every other picture byte for byte as it was, so a round and a refresh of one canvas never write beside each other.
 *
 * WHEN IT DOES NOTHING. No dev server answering at the project's `appUrl` (design-canvas/settings.json), no settings, a
 * declaration that cannot be read, or this machine's answer to the install question is not yes (`--hook`, `--focus` and
 * `--opened`): one line in the log and the frames stay out of date, which a later moment, a manual capture and `check-canvas.mjs`
 * all still see. Nothing is lost by skipping.
 *
 * THE LOG is `design-canvas/rounds/recapture-log.txt` (scratch, gitignored with the rest of `rounds/`): what was found, and the
 * capture's own output.
 *
 * DELETE WITH: the design-canvas/ folder.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** How long the tree has to stay quiet (no other turn ending) before the background run looks. The tests shorten it with
 *  `CANVAS_RECAPTURE_QUIET_MS`; it is not a setting. */
export const QUIET_MS = 8000;

/** The hash a stamp records for one file: the same 16 hex characters `capture.mjs` writes, and "missing" for a file that is gone. */
export function fileStamp(root, rel) {
  const at = path.join(root, rel);
  return existsSync(at) ? createHash("sha256").update(readFileSync(at)).digest("hex").slice(0, 16) : "missing";
}

/**
 * THE HASH A STAMP RECORDS FOR A SCREEN'S DECLARATION (`stamp.decl`): everything about the screen that decides what the picture
 * contains, with the canvas-wide network rules. `label`, `note` and `kind` are left out: renaming a tile does not change the page
 * under it. An empty or default value counts as absent, so a declaration in the served route's shape (which fills defaults)
 * stamps the same as one read from the file. `capture.mjs` writes it and this file compares it, so the two cannot disagree.
 */
export function declStamp(screen, declaration) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        screen.url,
        screen.state ?? null,
        screen.expect ?? null,
        screen.expectMissing?.length ? screen.expectMissing : null,
        screen.expectSelector ?? null,
        screen.focus ?? null,
        screen.viewport ?? null,
        /* "desktop" is the core's default device. */
        screen.device && screen.device !== "desktop" ? screen.device : null,
        screen.deviceViewport ?? null,
        screen.origins?.length ? screen.origins : null,
        screen.oneViewport || null,
        /* Appended only when present, so a screen without them keeps the stamp it always had. `writes` is left out of the
           canvas-wide list: blocking saves changes no picture. */
        ...(screen.steps?.length ? [screen.steps] : []),
        ...(screen.network?.length ? [screen.network] : []),
        ...((declaration?.network ?? []).some((rule) => !("writes" in rule)) ? [(declaration.network ?? []).filter((rule) => !("writes" in rule))] : []),
      ]),
    )
    .digest("hex")
    .slice(0, 16);
}

/**
 * THE EDITED FILES, MAPPED TO THE FRAMES THEY ARE PART OF.
 *
 *   frames   the canvas's declared frames: { id, frozen?, explain? }
 *   shots    the manifest's shots: { screenId, stamp: { sources: { <repo-relative file>: <hash> } } }
 *   hashOf   (rel) => the file's hash now; `fileStamp` bound to the project root, a stub in tests
 *   declOf   (frame) => its `declStamp` now; left out, a declaration is not compared
 *
 * Returns { stale: [{ id, files, why }], edited: [<file>] }. `why` is "edited" (with the files), "declaration" (its own
 * declaration changed, and no file) or "no picture". A frozen frame
 * is history and is never listed, an explanation frame has no picture to take, and a shot taken before stamps existed has nothing
 * to compare, so it is left to a full capture. Each file is hashed once however many frames list it.
 */
export function staleFrames({ frames, shots, hashOf, declOf }) {
  const shotOf = new Map((shots ?? []).map((shot) => [shot.screenId, shot]));
  const now = new Map();
  const hash = (rel) => {
    if (!now.has(rel)) now.set(rel, hashOf(rel));
    return now.get(rel);
  };
  const edited = new Set();
  const stale = [];
  for (const frame of frames) {
    if (frame.explain || frame.frozen) continue;
    const shot = shotOf.get(frame.id);
    if (!shot) {
      stale.push({ id: frame.id, files: [], why: "no picture" });
      continue;
    }
    const sources = shot.stamp?.sources;
    if (!sources) continue;
    const files = Object.entries(sources)
      /* A wireframe's stamp is its served HTML, not a file in this tree; the capture re-reads it on every run. */
      .filter(([rel, was]) => !rel.startsWith("wireframe:") && hash(rel) !== was)
      .map(([rel]) => rel)
      .sort();
    const declChanged = Boolean(declOf) && declOf(frame) !== shot.stamp.decl;
    if (files.length === 0 && !declChanged) continue;
    for (const rel of files) edited.add(rel);
    stale.push({ id: frame.id, files, why: files.length > 0 ? "edited" : "declaration" });
  }
  return { stale, edited: [...edited].sort() };
}

/**
 * A FINGERPRINT OF EVERYTHING THE PICTURES ARE MADE OF, NOW: every frame's declaration and the current hash of every file its
 * stamp lists, and which pictures exist. Two turns with the same fingerprint changed nothing any picture shows, so the second one
 * starts no recapture. `hashOf` and `declOf` as for `staleFrames`.
 */
export function inputsDigest({ frames, shots, hashOf, declOf }) {
  const hash = createHash("sha256");
  const shotOf = new Map((shots ?? []).map((shot) => [shot.screenId, shot]));
  for (const frame of [...frames].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    hash.update(`${frame.id}\0${declOf ? declOf(frame) : ""}\0`);
    const sources = shotOf.get(frame.id)?.stamp?.sources ?? {};
    for (const rel of Object.keys(sources).sort()) hash.update(`${rel}=${rel.startsWith("wireframe:") ? sources[rel] : hashOf(rel)}\0`);
  }
  for (const id of [...shotOf.keys()].sort()) hash.update(`shot:${id}\0`);
  return hash.digest("hex").slice(0, 16);
}

/**
 * One canvas's plan: { slug, stale, edited, removed, digest }. Each canvas is judged by its own frames: a declaration edit puts
 * out of date only the frames whose own declaration changed (`declStamp`, read from the served shape the capture reads), and
 * `removed` is the pictures of frames the declaration no longer has, which a capture prunes (and moves their comments to a
 * successor). `only` limits the plan to one canvas.
 */
async function planCanvases(canvasDir, only = null) {
  const root = path.dirname(canvasDir);
  const { declarationFor, loadDeclarations, slugsOf } = await import("./declarations.mjs");
  const { project } = await import("./dump-screens.mjs");
  const loaded = await loadDeclarations(canvasDir);
  const hashes = new Map();
  const hashOf = (rel) => {
    if (!hashes.has(rel)) hashes.set(rel, fileStamp(root, rel));
    return hashes.get(rel);
  };
  return slugsOf(loaded)
    .filter((slug) => !only || slug === only)
    .map((slug) => {
      const picked = declarationFor(loaded, slug);
      if (picked.error) return { slug, error: picked.error, stale: [], edited: [], removed: [], digest: "error" };
      const declaration = project(picked.declaration);
      let shots = [];
      try {
        shots = JSON.parse(readFileSync(path.join(canvasDir, "shots", slug, "manifest.json"), "utf8")).shots ?? [];
      } catch {
        /* Never captured: every frame has no picture, which the plan says. */
      }
      const declOf = (frame) => declStamp(frame, declaration);
      const frames = declaration.screens;
      const { stale, edited } = staleFrames({ frames, shots, hashOf, declOf });
      const declared = new Set(frames.map((one) => one.id));
      const removed = shots.map((shot) => shot.screenId).filter((id) => !declared.has(id));
      return { slug, stale, edited, removed, digest: inputsDigest({ frames, shots, hashOf, declOf }) };
    });
}

const why = (one) => (one.why === "edited" ? one.files.join(", ") : one.why === "declaration" ? "its declaration" : "no picture");
const describe = (plan, open) => {
  const parts = [];
  if (plan.stale.length > 0) parts.push(`${plan.stale.length} frame(s) out of date: ${plan.stale.map((one) => `${one.id} (${why(one)})`).join(", ")}`);
  if (plan.removed.length > 0) parts.push(`${plan.removed.length} picture(s) of frames the declaration no longer has: ${plan.removed.join(", ")}`);
  return `${plan.slug}${open ? " (open)" : ""}: ${parts.length > 0 ? parts.join("; ") : "up to date"}`;
};
const due = (plan) => !plan.error && (plan.stale.length > 0 || plan.removed.length > 0);

/* ------------------------------------------------------------------ the canvases open now */

/**
 * How long a canvas page's report that it is open counts. The page sends one while its tab is visible: on opening, when what is on
 * screen changes, and once a minute; a hidden tab sends that it is gone. A report older than this is a tab that closed without
 * saying so. The comments route judges "just opened" by the same span.
 */
export const VIEWING_TTL_MS = 2 * 60 * 1000;
export const viewingFile = (canvasDir) => path.join(canvasDir, "rounds", "viewing.json");

/**
 * The canvases a reviewer has open right now: Map slug => { visible: [frame ids on screen, newest report first], tabs: [...] }.
 * Every fresh report counts, so two open tabs (two canvases, or one canvas twice) are both in focus. Unreadable means none.
 */
export function openCanvases(canvasDir, now = Date.now()) {
  let viewers = {};
  try {
    viewers = JSON.parse(readFileSync(viewingFile(canvasDir), "utf8")).viewers ?? {};
  } catch {
    return new Map();
  }
  const fresh = Object.values(viewers)
    .filter((one) => one && typeof one.canvas === "string" && now - Date.parse(one.at) < VIEWING_TTL_MS)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const open = new Map();
  for (const one of fresh) {
    const entry = open.get(one.canvas) ?? { visible: [], tabs: [] };
    for (const id of Array.isArray(one.visible) ? one.visible : []) if (typeof id === "string" && !entry.visible.includes(id)) entry.visible.push(id);
    if (typeof one.tab === "string" && !entry.tabs.includes(one.tab)) entry.tabs.push(one.tab);
    open.set(one.canvas, entry);
  }
  return open;
}

/** Above this many frames a background capture runs `FEW_LANES` at a time, so the rest of the machine stays responsive. */
export const LARGE_SET = 10;
export const FEW_LANES = 2;
/** The lanes for a capture of `count` frames: undefined is the capture's own default. `CANVAS_LANES` always wins. */
export const lanesFor = (count, env = process.env) => (env.CANVAS_LANES ? undefined : count > LARGE_SET ? FEW_LANES : undefined);

/** The frames to photograph first: the ones on screen that are out of date, in the order the page reported them. */
export const firstFrames = (plan, visible = []) => {
  const stale = new Set(plan.stale.map((one) => one.id));
  return visible.filter((id) => stale.has(id));
};

/**
 * Does the app answer? Any HTTP response counts; a refused connection or a timeout does not. The wait is long because a dev
 * server compiles a route on its first request, and this runs in the background, where waiting costs nobody anything.
 */
async function answers(url) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(30_000), redirect: "manual" });
    return true;
  } catch {
    return false;
  }
}

/** The settings' app address when a capture can run against it, or null with the reason said. */
async function reachableApp(canvasDir, say) {
  const { readSettingsSafe } = await import("./project-settings.mjs");
  const { settings, error } = readSettingsSafe(canvasDir);
  if (error || !settings?.appUrl) {
    say(error ? `settings.json: ${error}` : `no "appUrl" in design-canvas/settings.json, so nothing was captured`);
    return null;
  }
  if (!(await answers(settings.appUrl))) {
    say(`nothing answers at ${settings.appUrl}, so nothing was captured; the next moment tries again`);
    return null;
  }
  return settings.appUrl;
}

/** One canvas's capture, its frames on screen first. Returns the exit status. */
function captureCanvas(canvasDir, plan, visible, say) {
  const first = firstFrames(plan, visible);
  const lanes = lanesFor(plan.stale.length);
  say(`capturing ${plan.slug}: ${plan.stale.length} frame(s)${first.length > 0 ? `, ${first.length} on screen first` : ""}${lanes ? `, ${lanes} at a time` : ""}`);
  const run = spawnSync(
    process.execPath,
    [path.join(canvasDir, "capture.mjs"), "--canvas", plan.slug, ...(first.length > 0 ? ["--first", first.join(",")] : []), ...(lanes ? ["--lanes", String(lanes)] : [])],
    { cwd: path.dirname(canvasDir), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  say(`${(run.stdout ?? "").trim()}\n${(run.stderr ?? "").trim()}`.trim());
  say(`capture of ${plan.slug} exited ${run.status}`);
  return run.status;
}

/**
 * Capture the canvases `pick` keeps. `pick(plan, open)` says whether a canvas with work is captured now; the rest stay out of
 * date. Returns { captured, failed, left }: the canvases a capture ran for, whether anything stopped the work, and the frames
 * left out of date per canvas ([{ slug, count }]).
 */
async function recaptureWhere(canvasDir, say, { only = null, pick = () => true } = {}) {
  let plans;
  try {
    plans = await planCanvases(canvasDir, only);
  } catch (error) {
    say(`the declaration could not be read: ${String(error?.message ?? error).split("\n")[0]}`);
    return { captured: 0, failed: true, left: [] };
  }
  if (only && plans.length === 0) {
    say(`"${only}" is no canvas of this project`);
    return { captured: 0, failed: true, left: [] };
  }
  const open = openCanvases(canvasDir);
  for (const plan of plans) say(plan.error ? `${plan.slug}: ${plan.error}` : describe(plan, open.has(plan.slug)));
  const now = plans.filter((plan) => due(plan) && pick(plan, open));
  const left = plans.filter((plan) => due(plan) && !now.includes(plan) && plan.stale.length > 0).map((plan) => ({ slug: plan.slug, count: plan.stale.length }));
  if (left.length > 0) say(`left out of date until opened: ${left.map((one) => `${one.slug} ${one.count}`).join(", ")}`);
  if (now.length === 0) return { captured: 0, failed: plans.some((plan) => plan.error), left };
  if (!(await reachableApp(canvasDir, say))) return { captured: 0, failed: true, left };
  let failed = false;
  for (const plan of now) if (captureCanvas(canvasDir, plan, open.get(plan.slug)?.visible ?? [], say) !== 0) failed = true;
  return { captured: now.length, failed, left };
}

/**
 * REFRESH ONE CANVAS BEFORE IT IS SHARED (`review-build.mjs`): its out-of-date frames are captured now, open or not. Returns
 * { refreshed, left }: how many frames were out of date, and the ids still out of date afterwards (none when the refresh
 * worked), so the caller decides what may be shared.
 */
export async function refreshCanvas(canvasDir, slug, say = () => {}) {
  const ids = async () => {
    try {
      const [plan] = await planCanvases(canvasDir, slug);
      return plan && !plan.error ? plan.stale.map((one) => one.id) : [];
    } catch {
      return [];
    }
  };
  const was = await ids();
  if (was.length === 0) return { refreshed: 0, left: [] };
  await recaptureWhere(canvasDir, say, { only: slug });
  const left = await ids();
  return { refreshed: was.length - left.length, left };
}

/* ------------------------------------------------------------------ the background run */

const roundsDir = (canvasDir) => path.join(canvasDir, "rounds");
const lockFile = (canvasDir) => path.join(roundsDir(canvasDir), "recapture.lock");
const againFile = (canvasDir) => path.join(roundsDir(canvasDir), "recapture.again");
/** The fingerprint of the inputs at the end of the last turn that started a run (`inputsDigest`, per canvas). */
const inputsFile = (canvasDir) => path.join(roundsDir(canvasDir), "recapture-inputs.json");
export const logFile = (canvasDir) => path.join(roundsDir(canvasDir), "recapture-log.txt");
const logLine = (canvasDir) => (line) => {
  if (line) appendFileSync(logFile(canvasDir), `[${new Date().toISOString()}] ${line}\n`);
};

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/**
 * Take a lock file. False when a live process holds it; a lock left by a process that died is taken over. Shared with
 * `capture.mjs`, which holds one per canvas while it reads and writes that canvas's manifest.
 */
export function takeLock(file) {
  mkdirSync(path.dirname(file), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      writeFileSync(file, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }), { flag: "wx" });
      return true;
    } catch {
      let holder = null;
      try {
        holder = JSON.parse(readFileSync(file, "utf8"));
      } catch {
        /* Unreadable: treated as abandoned. */
      }
      if (holder?.pid && alive(holder.pid)) return false;
      rmSync(file, { force: true });
    }
  }
  return false;
}

/** The process holding a lock file, or null. */
export function lockHolder(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8")).pid ?? null;
  } catch {
    return null;
  }
}

/**
 * The background run for the canvases open now. A turn that ended while another run holds the lock leaves the `again` mark and
 * stops; the holder sees the mark, waits for quiet again and looks again, so the last turn of a batch is never missed. The open
 * canvases are read after the wait, so a canvas opened meanwhile is in focus too.
 */
async function worker(canvasDir) {
  const say = logLine(canvasDir);
  writeFileSync(againFile(canvasDir), "");
  /* The outer loop closes the gap between the holder's last look at the mark and its release of the lock. */
  while (existsSync(againFile(canvasDir))) {
    if (!takeLock(lockFile(canvasDir))) return;
    try {
      while (existsSync(againFile(canvasDir))) {
        /* Wait for quiet: every turn that ends meanwhile leaves the mark again, and the wait starts over. */
        do {
          rmSync(againFile(canvasDir), { force: true });
          await new Promise((resolve) => setTimeout(resolve, Number(process.env.CANVAS_RECAPTURE_QUIET_MS ?? QUIET_MS)));
        } while (existsSync(againFile(canvasDir)));
        await recaptureWhere(canvasDir, say, { pick: (plan, open) => open.has(plan.slug) });
      }
    } finally {
      rmSync(lockFile(canvasDir), { force: true });
    }
  }
}

/** Start the background run detached, its output in the log, so it outlives the process that asked for it. */
function startWorker(canvasDir, args = ["--worker"]) {
  mkdirSync(roundsDir(canvasDir), { recursive: true });
  const out = openSync(logFile(canvasDir), "a");
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), ...args], {
    cwd: path.dirname(canvasDir),
    detached: true,
    stdio: ["ignore", out, out],
  });
  child.unref();
  closeSync(out);
}

/** This machine's yes to the install question, which is what turns the background recapture on. */
async function answeredYes(canvasDir) {
  try {
    const { readAnswer } = await import("./checks-answer.mjs");
    return readAnswer(path.dirname(canvasDir))?.checksHook === true;
  } catch {
    return false;
  }
}

/**
 * The Stop hook. It compares the inputs' fingerprint with the one the last turn left: the same means this turn changed nothing a
 * picture is made of, and nothing starts. Otherwise it starts the background run for the open canvases and returns at once, and
 * prints one line for the person at the screen (`systemMessage`) when canvases that are not open now hold out-of-date frames.
 * It fails open: whatever goes wrong, it exits 0, and the reason is in the log.
 */
async function hook(canvasDir) {
  try {
    readFileSync(0);
  } catch {
    /* The hook's input is not needed: which frames are out of date is read from the files themselves. */
  }
  mkdirSync(roundsDir(canvasDir), { recursive: true });
  const say = logLine(canvasDir);
  let plans;
  try {
    plans = await planCanvases(canvasDir);
  } catch (error) {
    say(`the declaration could not be read: ${String(error?.message ?? error).split("\n")[0]}`);
    return;
  }
  const digest = Object.fromEntries(plans.map((plan) => [plan.slug, plan.digest]));
  let before = null;
  try {
    before = JSON.parse(readFileSync(inputsFile(canvasDir), "utf8"));
  } catch {
    /* The first turn: nothing to compare with, so it counts as a change. */
  }
  if (JSON.stringify(before) === JSON.stringify(digest)) return;
  writeFileSync(inputsFile(canvasDir), `${JSON.stringify(digest)}\n`);
  startWorker(canvasDir);
  const open = openCanvases(canvasDir);
  const elsewhere = plans.filter((plan) => !plan.error && !open.has(plan.slug) && plan.stale.length > 0).map((plan) => ({ slug: plan.slug, count: plan.stale.length }));
  const { afterTurn } = await import("./reminders.mjs");
  const line = afterTurn({ elsewhere });
  if (line) process.stdout.write(JSON.stringify({ systemMessage: line }));
}

/* ------------------------------------------------------------------ command line */

/* Run as a command only when this file is the one started (compared with symlinks resolved, so a linked checkout works). */
const started = (() => {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (started) {
  const args = process.argv.slice(2);
  const argOf = (name) => {
    const at = args.indexOf(`--${name}`);
    return at === -1 ? undefined : args[at + 1];
  };
  const stopped = (error) => {
    try {
      appendFileSync(logFile(HERE), `[${new Date().toISOString()}] stopped: ${String(error?.message ?? error).split("\n")[0]}\n`);
    } catch {
      /* Nowhere to say it. */
    }
  };
  if (args.includes("--hook")) {
    process.on("uncaughtException", () => process.exit(0));
    await hook(HERE).catch(stopped);
    process.exitCode = 0;
  } else if (args.includes("--worker")) {
    await worker(HERE).catch(stopped);
  } else if (args.includes("--focus")) {
    /* A round's moment: the open canvases, through the same background run as a turn's end. */
    if (await answeredYes(HERE)) startWorker(HERE);
  } else if (args.includes("--opened")) {
    const slug = argOf("opened");
    if (slug && /^[a-z0-9][a-z0-9-]*$/.test(slug)) {
      mkdirSync(roundsDir(HERE), { recursive: true });
      if (await answeredYes(HERE)) await recaptureWhere(HERE, logLine(HERE), { only: slug }).catch(stopped);
      else logLine(HERE)(`${slug} was opened; nothing refreshed, because this machine's answer to the install question is not yes`);
    }
  } else if (args.includes("--plan")) {
    try {
      const open = openCanvases(HERE);
      for (const plan of await planCanvases(HERE, argOf("canvas") ?? null)) console.log(plan.error ? `${plan.slug}: ${plan.error}` : describe(plan, open.has(plan.slug)));
    } catch (error) {
      console.error(`recapture: ${String(error?.message ?? error).split("\n")[0]}`);
      process.exit(1);
    }
  } else {
    /* By hand: every out-of-date frame now, open or not. The same lock as the background run, so the two never capture at once. */
    if (!takeLock(lockFile(HERE))) {
      console.error("recapture: a background run is capturing right now; its log is design-canvas/rounds/recapture-log.txt");
      process.exit(1);
    }
    try {
      const { captured, failed } = await recaptureWhere(HERE, (line) => console.log(line), { only: argOf("canvas") ?? null });
      if (captured === 0 && !failed) console.log("nothing to capture");
      if (failed) process.exitCode = 1;
    } finally {
      rmSync(lockFile(HERE), { force: true });
    }
  }
}
