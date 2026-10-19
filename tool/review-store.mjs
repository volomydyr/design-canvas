/**
 * design-canvas — WHAT THE TWO SHARE-PAGE TOOLS (review-build.mjs, review-comments.mjs) HOLD IN COMMON: a name that
 * is safe to put in a path, and a snapshot of the team's comments that outlives the page they were written on.
 *
 * WHY A SNAPSHOT. The team's comments live in ONE place: `review.json` on a claude.ai page that other people write
 * to and that can be deleted or overwritten, and a deleted page takes the only copy of every comment with it.
 * So every time a tool sees the live file it keeps what it saw, in the project:
 *
 *   design-canvas/review/<slug>/snapshots/<UTC time>-<source>.json      every distinct version, byte for byte
 *   design-canvas/review/<slug>/review.json                              the newest one: what a first publish carries
 *
 * A snapshot is written only when no earlier snapshot has the same bytes, so a run that sees nothing new adds nothing.
 * Nothing here deletes a snapshot. The folder is gitignored with the rest of `review/<slug>/`, which is why it
 * belongs to the project checkout and not to the repository.
 *
 * WHY A NAME CHECK. `review.json` is written by whoever the page is shared with, so every field of it is input from a
 * stranger. A comment id or frame id that reaches `path.join` is a path the stranger chose. `plainName` is the
 * whitelist (letters, digits, dash, underscore), the same shape verdicts.mjs already demands of a slug.
 *
 * DELETE WITH: the design-canvas/ folder.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/** A plain name: letters, digits, dash, underscore. No dot, no slash, no space, nothing a path could be made of. */
export const PLAIN_NAME = /^[A-Za-z0-9_-]{1,120}$/;
export const plainName = (value) => typeof value === "string" && PLAIN_NAME.test(value);

/** A box on a frame, in percent of it: four finite numbers. Anything else would crash the picture drawing. */
export const validRegion = (region) =>
  Boolean(region) && typeof region === "object" && ["x", "y", "w", "h"].every((key) => Number.isFinite(region[key]));

/**
 * Split a review's comments into the ones that may be used and the ones refused, each refusal with its reason. A
 * record is refused as a whole: its id and its frame both end up in paths, and a box that is not four numbers ends
 * a run half way through somebody's list.
 */
export function vetComments(comments) {
  const usable = [];
  const refused = [];
  for (const comment of comments) {
    const why = !comment || typeof comment !== "object"
      ? "it is not a record"
      : !plainName(comment.id)
        ? `its id ${JSON.stringify(String(comment.id).slice(0, 40))} is not a plain name (letters, digits, dash, underscore)`
        : !plainName(comment.frame)
          ? `its frame ${JSON.stringify(String(comment.frame).slice(0, 40))} is not a plain name (letters, digits, dash, underscore)`
          : !validRegion(comment.region)
            ? "its box is not four numbers"
            : null;
    if (why) refused.push({ id: comment?.id, why });
    else usable.push(comment);
  }
  return { usable, refused };
}

/** Said loudly, naming the record and the reason. */
export function sayRefused(who, refused) {
  for (const one of refused)
    console.error(`${who}: REFUSED a record${one.id === undefined ? "" : ` (${JSON.stringify(String(one.id).slice(0, 40))})`}: ${one.why}. It is left alone on the page and not used here.`);
}

/** A path made of a base and a name, proven to stay inside the base. The name check already makes this true; this is the belt. */
export function inside(base, ...parts) {
  const target = path.resolve(base, ...parts);
  const root = path.resolve(base);
  if (target !== root && !target.startsWith(root + path.sep)) throw new Error(`refusing a path outside ${root}`);
  return target;
}

/* ------------------------------------------------------------------ what changed between two copies */

/** Key order must not make two identical records look different. */
const canonical = (value) =>
  JSON.stringify(value, (_key, inner) =>
    inner && typeof inner === "object" && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => a.localeCompare(b)))
      : inner,
  );

/** Which comments (by id) were added, removed or edited going from `before` to `after`. */
export function describeChange(before, after) {
  const was = new Map((before?.comments ?? []).map((comment) => [String(comment?.id), canonical(comment)]));
  const now = new Map((after?.comments ?? []).map((comment) => [String(comment?.id), canonical(comment)]));
  return {
    added: [...now.keys()].filter((id) => !was.has(id)),
    removed: [...was.keys()].filter((id) => !now.has(id)),
    edited: [...now.keys()].filter((id) => was.has(id) && was.get(id) !== now.get(id)),
  };
}

export const isUnchanged = (change) => change.added.length + change.removed.length + change.edited.length === 0;

/** "2 new (p5, p6), 1 removed (p2)": the sentence the tools print when the live page moved. */
export function sayChange(change) {
  const part = (label, ids) => (ids.length > 0 ? `${ids.length} ${label} (${ids.slice(0, 8).join(", ")}${ids.length > 8 ? ", …" : ""})` : null);
  return [part("new", change.added), part("removed", change.removed), part("edited", change.edited)].filter(Boolean).join(", ");
}

/* ------------------------------------------------------------------ the snapshots */

const sha = (text) => createHash("sha256").update(text).digest("hex");
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");

/** The newest snapshot file in `review/<slug>/snapshots/`, or null. Names start with a UTC time, so the order is the name's. */
export function newestSnapshot(outDir) {
  const dir = path.join(outDir, "snapshots");
  if (!existsSync(dir)) return null;
  const names = readdirSync(dir).filter((name) => name.endsWith(".json")).sort();
  return names.length > 0 ? path.join(dir, names.at(-1)) : null;
}

/**
 * KEEP WHAT WAS SEEN. `text` is the review.json exactly as it arrived; `source` says where it came from (live, answered,
 * built-from-live), which is the only thing the file name adds to the time. Returns the path it wrote, or the path of
 * the newest snapshot when the bytes were the same as it.
 */
export function snapshotReview(outDir, text, source) {
  const newest = newestSnapshot(outDir);
  const dir = path.join(outDir, "snapshots");
  /* ANY snapshot with these exact bytes is the same version, not only the newest: a live copy that comes back after
     an answer was written is not news, and a log that alternated between the two would bury the real changes. */
  if (existsSync(dir)) {
    const digest = sha(text);
    for (const name of readdirSync(dir).filter((one) => one.endsWith(".json")).sort().reverse()) {
      const file = path.join(dir, name);
      if (sha(readFileSync(file, "utf8")) === digest) return { file, wrote: false, previous: newest };
    }
  }
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${stamp()}-${source}.json`);
  writeFileSync(file, text);
  return { file, wrote: true, previous: newest };
}

/**
 * COMPARE THE LIVE COPY WITH THE LAST ONE THE PROJECT HOLDS, say so, and keep the live one. The warning is the
 * important half: a removed comment means its author deleted it, or the page was replaced by a publish built on an
 * older file, or the page was deleted and re-made. Every one of those is worth hearing about
 * before the next publish, and none of them is visible from the page alone.
 */
export function takeLive({ who, outDir, liveText, source, relativeTo }) {
  const live = JSON.parse(liveText);
  const previousFile = newestSnapshot(outDir);
  const previous = previousFile ? JSON.parse(readFileSync(previousFile, "utf8")) : null;
  const saved = snapshotReview(outDir, liveText, source);
  const rel = (file) => path.relative(relativeTo, file);
  if (!previous) {
    console.log(`${who}: first snapshot of the team's comments: ${rel(saved.file)} (${live.comments?.length ?? 0} comment(s))`);
  } else {
    const change = describeChange(previous, live);
    if (isUnchanged(change)) console.log(`${who}: the live review.json is the same as the last snapshot (${rel(previousFile)})`);
    else {
      console.log(`${who}: the live review.json changed elsewhere since the last snapshot (${rel(previousFile)}): ${sayChange(change)}`);
      console.log(`${who}: kept as ${rel(saved.file)}`);
    }
    if (change.removed.length > 0)
      console.log(
        `${who}: WARNING ${change.removed.length} comment(s) the last snapshot held are NOT on the live page: ${change.removed.join(", ")}. ` +
          `Their authors deleted them, or the page was overwritten or re-made. They are still in ${rel(previousFile)}.`,
      );
  }
  /* The working copy is the newest state of the team's comments: a first publish of a re-made page carries it. */
  writeFileSync(path.join(outDir, "review.json"), liveText.endsWith("\n") ? liveText : `${liveText}\n`);
  return { live, saved, previous };
}
