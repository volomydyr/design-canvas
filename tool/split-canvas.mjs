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
 * The owner's ruling the first time this came up: a comment belongs to a screen, so it travels with it. *"History
 * follows the screen."* The new canvas opens with its own past intact.
 *
 * WHAT IT DOES, in one pass:
 *   1. asks the TARGET canvas which screens it declares (from the running app, never from a parsed file)
 *   2. takes every comment in the SOURCE review whose screen the target now owns
 *   3. writes them into the target's review with fresh ids, in the order they were written
 *   4. moves each one's annotated PNG into the target's folder, renamed to its new id
 *   5. removes them from the source review, leaving everything else exactly as it was
 *
 * It never invents a comment and never edits one: `note`, `history`, `kind`, `consumedAt`, `shotHash` and the rest
 * are carried verbatim. Only the id and the image path change, because both are namespaced by canvas.
 *
 *   node design-canvas/split-canvas.mjs --from online-store --to custom-domain
 *   node design-canvas/split-canvas.mjs --from online-store --to custom-domain --dry
 *
 * RUN IT AFTER THE DECLARATION IS SPLIT AND BEFORE THE RECAPTURE. The target has to declare the screens already or
 * there is nothing to match against; the pictures can arrive afterwards.
 *
 * `--url` defaults to port 3000, like every other script here. A project on another port carries it in its own npm
 * script, the way `canvas:check` already does.
 *
 * DELETE WITH: the design-canvas/ folder.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const argOf = (name) => {
  const at = argv.indexOf(`--${name}`);
  return at === -1 ? null : argv[at + 1];
};
const dry = argv.includes("--dry");
const from = argOf("from");
const to = argOf("to");
const url = argOf("url") ?? "http://localhost:3000";

if (!from || !to) {
  console.error(
    "design-canvas: --from <slug> and --to <slug> are both required.\n" +
      "  node design-canvas/split-canvas.mjs --from online-store --to custom-domain",
  );
  process.exit(1);
}

const DIR = path.join(process.cwd(), "design-canvas");

/** A canvas's review, whichever layout it is in: namespaced first, then the flat file that predates namespacing. */
function reviewOf(slug) {
  const namespaced = {
    json: path.join(DIR, "comments", `${slug}.json`),
    images: path.join(DIR, "comments", slug),
    rel: `design-canvas/comments/${slug}`,
  };
  if (existsSync(namespaced.json)) return namespaced;
  const flat = path.join(DIR, "comments.json");
  if (existsSync(flat)) {
    const raw = JSON.parse(readFileSync(flat, "utf8"));
    /* The flat file belongs to whichever canvas claimed it (see `CanvasCommentFile.canvas`). Another canvas's claim
       means this one simply has no review yet, which is not an error. */
    if (!raw.canvas || raw.canvas === slug)
      return {
        json: flat,
        images: path.join(DIR, "comments"),
        rel: "design-canvas/comments",
      };
  }
  return namespaced;
}

const read = (file) =>
  existsSync(file)
    ? JSON.parse(readFileSync(file, "utf8"))
    : { contract: "", updatedAt: "", comments: [] };

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
const source = reviewOf(from);
const destination = reviewOf(to);
const sourceFile = read(source.json);
const destinationFile = read(destination.json);

const moving = (sourceFile.comments ?? []).filter((one) =>
  owns.has(one.screenId),
);
const staying = (sourceFile.comments ?? []).filter(
  (one) => !owns.has(one.screenId),
);

if (moving.length === 0) {
  console.log(
    `design-canvas: nothing to move. No comment in ${path.relative(process.cwd(), source.json)} sits on a screen ` +
      `"${to}" declares.`,
  );
  process.exit(0);
}

/* Ids are per review and are what the reviewer says out loud ("c4"), so they are reassigned by position in the
   destination rather than carried across — two reviews would otherwise both hold a c12. */
let next =
  1 +
  (destinationFile.comments ?? []).reduce((high, one) => {
    const number = Number.parseInt(String(one.id).replace(/^c/, ""), 10);
    return Number.isFinite(number) && number > high ? number : high;
  }, 0);

const moved = moving.map((one) => {
  const id = `c${next++}`;
  return {
    ...one,
    id,
    image: one.image ? `${destination.rel}/${id}.png` : one.image,
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

if (dry) process.exit(0);

if (!existsSync(destination.images))
  mkdirSync(destination.images, { recursive: true });
for (const [at, one] of moving.entries()) {
  if (!one.image) continue;
  const was = path.join(process.cwd(), one.image);
  const now = path.join(process.cwd(), moved[at].image);
  if (existsSync(was) && was !== now) renameSync(was, now);
}

const stamp = new Date().toISOString();
writeFileSync(
  destination.json,
  `${JSON.stringify(
    {
      ...destinationFile,
      contract: destinationFile.contract || sourceFile.contract,
      updatedAt: stamp,
      comments: [...(destinationFile.comments ?? []), ...moved],
      /* `seen` is per canvas and is about SCREENS, so the ones that moved take their seen-ness with them. */
      ...(sourceFile.seen
        ? {
            seen: [
              ...new Set([
                ...(destinationFile.seen ?? []),
                ...sourceFile.seen.filter((id) => owns.has(id)),
              ]),
            ],
          }
        : {}),
    },
    null,
    2,
  )}\n`,
  "utf8",
);

writeFileSync(
  source.json,
  `${JSON.stringify(
    {
      ...sourceFile,
      updatedAt: stamp,
      comments: staying,
      ...(sourceFile.seen
        ? { seen: sourceFile.seen.filter((id) => !owns.has(id)) }
        : {}),
    },
    null,
    2,
  )}\n`,
  "utf8",
);

console.log(
  `design-canvas: wrote ${path.relative(process.cwd(), destination.json)} and ` +
    `${path.relative(process.cwd(), source.json)}. Recapture "${to}" next, so its frames exist.`,
);
