/**
 * design-canvas — WHICH FRAMES THE ORACLE'S LIVE OPEN PASS VISITS, decided by the tool and never by the reviewer.
 *
 * WHY IT EXISTS. The oracle opens every frame's Open destination on the served dev server and re-proves its claims there. On one
 * real canvas that meant every route of the app was compiled by the reviewer's own `next dev` on every round, and the dev
 * server's memory grew without limit. A dev server cannot be restarted under a reviewer (a restart breaks the hot reload
 * of the tab they are looking at), so the answer is to stop asking it for what nothing changed on.
 *
 * WHAT IS VISITED BY DEFAULT: the frames whose capture changed since they last passed a live visit. `capture.mjs` writes the
 * frames it re-photographed into `design-canvas/rounds/<slug>/live-unproven.json` (scratch, gitignored, like everything under
 * `rounds/`); the oracle reads it, visits exactly those frames, and takes a frame off the list only when its visit was clean.
 * So the list is "this round" when the round ran the check, and it is still right after a `--no-check` round: the frames that
 * round photographed stay on it until one round proves them. Frames the capture did not touch are not opened at all, and the
 * oracle says how many it left alone and which flag opens them.
 *
 *   --only a,b      visit exactly these frames, whether or not they changed
 *   --live-all      visit every frame (the old behavior, for the one case that stays legitimate: proving a whole canvas)
 *
 * A missing or unreadable list means nothing was photographed since the last proof, which is an answer and not an error: the
 * oracle still runs every other check, and says what it skipped.
 *
 * DELETE WITH: the design-canvas/ folder.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Where a canvas's unproven frames are kept: scratch, per canvas, under the rounds folder the installer gitignores. */
export const unprovenFile = (canvasDir, slug) => path.join(canvasDir, "rounds", slug, "live-unproven.json");

/** The frames waiting for a live visit. An absent, empty or unreadable file is an empty set. */
export function readUnproven(canvasDir, slug) {
  const file = unprovenFile(canvasDir, slug);
  if (!existsSync(file)) return new Set();
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return new Set((Array.isArray(parsed.frames) ? parsed.frames : []).filter((id) => typeof id === "string"));
  } catch {
    return new Set();
  }
}

/** Written whole and renamed into place, so a capture killed mid-write cannot leave half a list for the oracle to read. */
function write(canvasDir, slug, ids) {
  const file = unprovenFile(canvasDir, slug);
  mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(
    temp,
    `${JSON.stringify({ contract: "Frames captured since they last passed a live Open visit. Written by capture.mjs, emptied by check-canvas.mjs. Scratch.", frames: [...ids].sort() }, null, 2)}\n`,
    "utf8",
  );
  renameSync(temp, file);
}

/** The capture re-photographed these frames: their Open destinations are unproven until a live visit passes. */
export function markUnproven(canvasDir, slug, ids) {
  const now = readUnproven(canvasDir, slug);
  for (const id of ids) now.add(id);
  write(canvasDir, slug, now);
  return now;
}

/**
 * These frames passed a live visit. `declared` (every frame the declaration still names) also drops frames that left it, so the
 * list cannot grow for ever with ids nobody will visit again.
 */
export function markProven(canvasDir, slug, ids, { declared } = {}) {
  const now = readUnproven(canvasDir, slug);
  for (const id of ids) now.delete(id);
  if (declared) for (const id of [...now]) if (!declared.has(id)) now.delete(id);
  write(canvasDir, slug, now);
  return now;
}

/** A frame the live pass can open at all: it has a route of the app, and is not an explanation, preserved history or a wireframe. */
export const hasOpenDestination = (screen) => Boolean(screen.url) && !screen.explain && !screen.frozen && !screen.wireframe;

/**
 * WHICH FRAMES TO OPEN. `screens` is the served declaration's list; `only` the ids named with `--only` (empty when none); `all`
 * is `--live-all`; `unproven` the set read from disk. Returns the frames to visit in declared order, how many were left alone,
 * the ids `--only` named that are no screen (a failure), and the ones it named that have nothing to open (a note).
 */
export function chooseLive({ screens, only = [], all = false, unproven = new Set() }) {
  const eligible = screens.filter(hasOpenDestination);
  const ids = new Set(screens.map((screen) => screen.id));
  const unknown = only.filter((id) => !ids.has(id));
  const unopenable = only.filter((id) => ids.has(id) && !eligible.some((screen) => screen.id === id));
  let visit;
  let why;
  let mode;
  if (all) {
    mode = "all";
    visit = eligible;
    why = "every frame (--live-all)";
  } else if (only.length > 0) {
    mode = "only";
    visit = eligible.filter((screen) => only.includes(screen.id));
    why = "the frames --only names";
  } else {
    mode = "changed";
    visit = eligible.filter((screen) => unproven.has(screen.id));
    why = "the frames captured since their last live visit";
  }
  return { visit, left: eligible.length - visit.length, eligible: eligible.length, unknown, unopenable, why, mode };
}

/** The one line the oracle prints about it, so a skipped frame is said out loud and the flag that opens it is named. */
export function describeLive(choice) {
  const base = `${choice.visit.length} of ${choice.eligible} live Open destination(s) visited: ${choice.why}`;
  if (choice.left === 0) return base;
  return choice.mode === "changed"
    ? `${base}; ${choice.left} left alone, because nothing was captured on them since their last live visit (--live-all opens every frame)`
    : `${base}; ${choice.left} left alone (--live-all opens every frame)`;
}
