#!/usr/bin/env node
/**
 * design-canvas — MOVE A REVIEW'S NOTES WHEN ITS FRAMES MOVE TO ANOTHER CANVAS.
 *
 * A canvas outgrows itself and gets split: some of its flows become a second canvas with its own slug, its own
 * shots and its own review. The declaration is a text edit and the frames are one recapture — the COMMENTS are the
 * part that quietly gets lost, because they live in a per-canvas file keyed by screen id. Left alone they sit in
 * the old file pointing at screens the old canvas no longer declares, which is the homeless state: still counted,
 * still handed off, and no longer openable from the frame they are about.
 *
 * The rule: a comment belongs to a screen, so it travels with it, and history follows the screen. The new canvas
 * opens with its own past intact.
 *
 * WHAT IT DOES, in one pass:
 *   1. asks the TARGET canvas which screens it declares (from the running app, never from a parsed file)
 *   2. takes every comment in the SOURCE review whose screen the target now owns
 *   3. writes them into the target's review with fresh ids, in the order they were written
 *   4. moves each one's annotated PNG into the target's folder, renamed to its new id
 *   5. removes them from the source review, leaving everything else exactly as it was
 *
 * It never invents a comment and never edits one: `note`, `history`, `kind`, `consumedAt`, `shotHash` and the rest
 * are carried verbatim. Only the id and the image path change, because both are namespaced by canvas. The moved screens'
 * places in the waiting queue (new or changed) move with them.
 *
 *   node design-canvas/split-canvas.mjs --from trips --to settings
 *   node design-canvas/split-canvas.mjs --from trips --to settings --dry
 *
 * RUN IT AFTER THE DECLARATION IS SPLIT AND BEFORE THE RECAPTURE. The target has to declare the screens already or
 * there is nothing to match against; the pictures can arrive afterwards.
 *
 * THE ADDRESS COMES FROM `design-canvas/settings.json` (there is no default port), and `--url` overrides it for one run. The
 * folder it edits is the one this file sits in, so it works from any directory.
 *
 * DELETE WITH: the design-canvas/ folder.
 */
import { existsSync, mkdirSync, renameSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { commentPaths, readCommentFile, writeCommentFile } from "./core/comment-file.mjs";
import { loadSettings, requireAppUrl } from "./project-settings.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
const argOf = (name) => {
  const at = argv.indexOf(`--${name}`);
  return at === -1 ? null : argv[at + 1];
};
const dry = argv.includes("--dry");
const from = argOf("from");
const to = argOf("to");
const settings = loadSettings(HERE, "split-canvas");
/** The project root: the comments' image paths are recorded relative to it (`design-canvas/comments/<slug>/c1.png`). */
const ROOT = path.dirname(HERE);

if (!from || !to) {
  console.error(
    "design-canvas: --from <slug> and --to <slug> are both required.\n" +
      "  node design-canvas/split-canvas.mjs --from trips --to settings",
  );
  process.exit(1);
}

const DIR = HERE;
const url = argOf("url") ?? requireAppUrl(settings, "split-canvas");

const target = await fetch(
  `${url}/api/design-canvas/shots?canvas=${encodeURIComponent(to)}&screens=1`,
)
  .then((response) => (response.ok ? response.json() : null))
  .catch(() => null);

if (!target?.screens?.length) {
  console.error(
    `design-canvas: could not read the screens of "${to}" from ${url}. Is the dev server running, and is that\n` +
      "canvas in the declaration yet? It has to be declared before its comments can be moved.",
  );
  process.exit(1);
}

const owns = new Set(target.screens.map((screen) => screen.id));
const source = commentPaths(DIR, from);
const destination = commentPaths(DIR, to);
const sourceFile = await readCommentFile(source);
const destinationFile = await readCommentFile(destination);

const moving = (sourceFile.comments ?? []).filter((one) =>
  owns.has(one.screenId),
);
const staying = (sourceFile.comments ?? []).filter(
  (one) => !owns.has(one.screenId),
);

const waitingMoves = Object.keys(sourceFile.waiting ?? {}).filter((id) => owns.has(id));
if (moving.length === 0 && waitingMoves.length === 0) {
  console.log(
    `design-canvas: nothing to move. No comment or waiting screen in ${path.relative(ROOT, source.json)} sits on a screen ` +
      `"${to}" declares.`,
  );
  process.exit(0);
}

/* Ids are per review and are what the reviewer says out loud ("c4"), so they are reassigned by position in the
   destination rather than carried across — two reviews would otherwise both hold a c12. */
/* From the highest number either file has ever issued (`maxId`), so an approved id never names a second comment. The source
   keeps its own mark too, because the comments that leave it may be its highest. */
let next = 1 + (destinationFile.maxId ?? 0);

const moved = moving.map((one) => {
  const id = `c${next++}`;
  return {
    ...one,
    id,
    image: one.image ? `${destination.imagesRel}/${id}.png` : one.image,
    /* Where it came from, so a reader of the new file can find the round it belonged to. */
    movedFrom: `${from}:${one.id}`,
  };
});

console.log(
  `design-canvas: ${moving.length} comment(s) move from "${from}" to "${to}"` +
    (dry ? " (dry run)" : ""),
);
for (const [at, one] of moving.entries())
  console.log(
    `  ${one.id} → ${moved[at].id}  ${one.screenId}  ${JSON.stringify(String(one.note).slice(0, 60))}`,
  );
console.log(`  ${staying.length} stay on "${from}"`);
if (waitingMoves.length > 0) console.log(`  ${waitingMoves.length} waiting screen(s) move too: ${waitingMoves.join(", ")}`);

if (dry) process.exit(0);

if (!existsSync(destination.images))
  mkdirSync(destination.images, { recursive: true });
for (const [at, one] of moving.entries()) {
  if (!one.image) continue;
  const was = path.join(ROOT, one.image);
  const now = path.join(ROOT, moved[at].image);
  if (existsSync(was) && was !== now) renameSync(was, now);
}

/* Each screen's place in the waiting queue goes where the screen went. */
const waitingOf = (file, keep) => Object.fromEntries(Object.entries(file.waiting ?? {}).filter(([id]) => keep(id)));
await writeCommentFile(
  destination,
  {
    ...destinationFile,
    /* A canvas split off one the reviewer has opened is not a first delivery. */
    ...(!destinationFile.viewedAt && sourceFile.viewedAt ? { viewedAt: sourceFile.viewedAt } : {}),
    comments: [...destinationFile.comments, ...moved],
    waiting: { ...waitingOf(destinationFile, () => true), ...waitingOf(sourceFile, (id) => owns.has(id)) },
  },
  `split: ${moved.length} comment(s) and ${waitingMoves.length} waiting screen(s) arrived from ${from}`,
);
await writeCommentFile(
  source,
  { ...sourceFile, comments: staying, waiting: waitingOf(sourceFile, (id) => !owns.has(id)) },
  `split: ${moving.length} comment(s) and ${waitingMoves.length} waiting screen(s) moved to ${to}`,
);

console.log(
  `design-canvas: wrote ${path.relative(ROOT, destination.json)} and ` +
    `${path.relative(ROOT, source.json)}. Recapture "${to}" next, so its frames exist.`,
);
