/**
 * design-canvas — COMMENT INTEGRITY: a frame leaves the declaration, and what was pinned to it goes somewhere or the run
 * stops.
 *
 * WHY THIS EXISTS. A comment is pinned to a frame, and a frame that is removed or promoted takes its pins' only place to
 * be seen with it: the canvas draws no pin without a picture, the review bar cannot walk to one, and the capture used to
 * sweep the answered ones for good. A promotion that removes the frames an exploration's options sat on leaves most of
 * their comments with nowhere to show, and the reviewer sees only the few that remain.
 *
 * THE RULE, in three lines:
 *   1. A LIVE NOTE (not a like or a dislike) on a frame that is no longer declared FOLLOWS ITS SUCCESSOR, the frame the
 *      declaration names in `successors` (core/types.ts). The pin keeps its rectangle, its words and its thread.
 *   2. With no successor, the run is REFUSED, and the refusal names the frame and the comment ids. Unread notes and
 *      answered notes alike, because an answered note is waiting for the reviewer's Approve and has nowhere to get it.
 *   3. `successors: { "gone-frame": null }` RELEASES the answered notes on purpose. It never releases an unread one: that
 *      is feedback nobody has read, and it has to be drained (read) before anything decides its fate.
 *
 * Verdicts are not notes. A like or a dislike belongs to the option it judged and is spent with it: that is the existing,
 * deliberate rule (trap 25), and this module leaves it alone.
 *
 * This file is PURE: it plans, and says what it found. `capture.mjs` applies a plan (it already owns the comments file
 * and its history), the oracle and the preflight only read one.
 *
 * DELETE WITH: the design-canvas/ folder.
 */
import { existsSync } from "node:fs";
import path from "node:path";

/** A live note: anything that is not a verdict. Absent `kind` is a note, as it has always been. */
const isNote = (comment) => !comment.kind || comment.kind === "note";

/** The route and the pinned state out of a declared screen's address, the way the comment records them. */
export function routeAndState(url) {
  if (!url) return { route: undefined, state: null };
  try {
    const parsed = new URL(url, "http://x");
    const state = parsed.searchParams.get("canvas");
    parsed.searchParams.delete("canvas");
    return { route: `${parsed.pathname}${parsed.search}`, state };
  } catch {
    return { route: url, state: null };
  }
}

/**
 * WHAT TO DO WITH THE COMMENTS OF THE FRAMES THAT LEFT.
 *
 * `declared` maps a frame id to what is known of it (`{ flowId, label, url }`); every frame the canvas declares is in it,
 * explanation frames included. `successors` is the declaration's record, or nothing.
 */
export function planPins({ comments, declared, successors }) {
  const table = successors ?? {};
  const moves = [];
  const released = [];
  const verdicts = [];
  const refused = new Map();
  const problems = [];
  const reported = new Set();

  /** Where a missing frame's comments end up: a declared frame, `null` (released), or undefined (nowhere). */
  const resolve = (frame) => {
    const seen = new Set();
    let at = frame;
    while (!declared.has(at)) {
      if (seen.has(at)) {
        if (!reported.has(frame)) problems.push(`successors: "${frame}" leads round in a circle (${[...seen].join(" → ")} → ${at})`);
        reported.add(frame);
        return undefined;
      }
      seen.add(at);
      if (!Object.prototype.hasOwnProperty.call(table, at)) return at === frame ? undefined : { dead: at };
      const next = table[at];
      if (next === null) return null;
      if (typeof next !== "string" || !next) {
        if (!reported.has(frame)) problems.push(`successors: "${at}" must name a frame or be null`);
        reported.add(frame);
        return undefined;
      }
      at = next;
    }
    return at;
  };

  for (const comment of comments ?? []) {
    if (declared.has(comment.screenId)) continue;
    if (!isNote(comment)) {
      verdicts.push({ id: comment.id, from: comment.screenId });
      continue;
    }
    const state = comment.consumedAt ? "answered" : "unread";
    const target = resolve(comment.screenId);
    if (typeof target === "string") {
      moves.push({ id: comment.id, from: comment.screenId, to: target, state });
    } else if (target === null && state === "answered") {
      released.push({ id: comment.id, from: comment.screenId });
    } else {
      /* Nowhere to go, or a release that may not apply to an unread note, or a chain ending at a frame that is gone too. */
      const entry = refused.get(comment.screenId) ?? { frame: comment.screenId, unread: [], answered: [], released: false, dead: null };
      entry[state === "unread" ? "unread" : "answered"].push(comment.id);
      if (target === null) entry.released = true;
      if (target && typeof target === "object") {
        entry.dead = target.dead;
        if (!reported.has(comment.screenId)) problems.push(`successors: "${comment.screenId}" leads to "${target.dead}", which is not a declared frame and has no successor of its own`);
        reported.add(comment.screenId);
      }
      refused.set(comment.screenId, entry);
    }
  }
  return { moves, released, verdicts, refused: [...refused.values()], problems };
}

/** One sentence per refused frame, and one per bad successor entry: the frame, the ids, and nothing else. */
export function refusalFailures(plan) {
  const lines = [];
  for (const one of plan.refused) {
    const parts = [];
    if (one.unread.length > 0) parts.push(`unread: ${one.unread.join(", ")}`);
    if (one.answered.length > 0) parts.push(`answered, waiting for the reviewer's Approve: ${one.answered.join(", ")}`);
    lines.push(
      `frame "${one.frame}" is no longer declared and still carries ${one.unread.length + one.answered.length} comment(s) (${parts.join("; ")})` +
        (one.released && one.unread.length > 0 ? `. \`successors["${one.frame}"] = null\` releases ANSWERED notes only: drain the unread ones first` : ""),
    );
  }
  lines.push(...plan.problems);
  return lines;
}

/**
 * The two ways out, once, for whoever is reading a refusal. Empty when nothing is refused. `nothingMoved` adds the sentence a
 * run that stopped BEFORE touching anything owes (the capture and the preflight); the oracle, which reads a finished state, omits it.
 */
export function remedyLine(plan, { nothingMoved = true } = {}) {
  if (plan.refused.length === 0) return "";
  return (
    "Either keep the frame declared until the reviewer has approved its comments, or name where they go in the canvas declaration:\n" +
    `    successors: { ${plan.refused.map((one) => `"${one.frame}": "<the frame that replaces it>"`).join(", ")} }\n` +
    `  (\`null\` in place of a frame releases answered notes on purpose.)${nothingMoved ? " Nothing was captured, swept or moved." : ""}`
  );
}

/** Failures plus the remedy, as the lines a run prints. */
export function refusalLines(plan) {
  return [...refusalFailures(plan), ...(plan.refused.length > 0 ? [remedyLine(plan)] : [])];
}

/**
 * THE COMMENTS, AFTER THEIR FRAMES HAVE MOVED: every move applied, nothing else touched. The region, the words, the thread,
 * `consumedAt` and `stale` stay exactly as they were; what is denormalised from the screen (its group, label, route and
 * state) follows the successor, and `movedFrom` records where the pin sat, so a reader of the file can find the round it
 * belonged to.
 */
export function applyMoves(comments, moves, declared, hashOf = () => undefined) {
  const by = new Map(moves.map((move) => [move.id, move]));
  return comments.map((comment) => {
    const move = by.get(comment.id);
    if (!move) return comment;
    const target = declared.get(move.to) ?? {};
    const { route, state } = routeAndState(target.url);
    const { shotHash: drawnOn, ...rest } = comment;
    void drawnOn;
    /* `shotHash` says which picture the outline was drawn on, and it was drawn on the OLD frame's, which can never equal
       the successor's: kept, it would mark the comment stale on every recapture of the successor, changed or not. The
       successor's own current hash (when it has a picture) is what "stale" should be measured against from now on. */
    const hash = hashOf(move.to);
    return {
      ...rest,
      ...(typeof hash === "string" ? { shotHash: hash } : {}),
      screenId: move.to,
      ...(target.flowId ? { flowId: target.flowId } : {}),
      ...(target.label ? { label: target.label } : {}),
      ...(route !== undefined ? { route, state } : {}),
      movedFrom: comment.movedFrom ?? move.from,
    };
  });
}

/**
 * WHICH COMMENTS GO STALE IN A CAPTURE: only those on a screen this run photographed (`rephotographed`), measured against the
 * hash of the picture they were drawn or reopened on. A kept picture is the one the comment last saw, so a comment on a frame
 * the run did not photograph is never marked, whatever its hash. Without a recorded hash (an older comment, or a verdict) a
 * fresh photograph is enough. A comment moved this run onto a frame with no picture yet has nothing to compare and is left alone.
 * Returns the comments (changed ones are new objects) and how many were marked.
 */
export function markStale(comments, { byScreen, rephotographed, moved = new Set() }) {
  let flagged = 0;
  const marked = comments.map((comment) => {
    const shot = byScreen.get(comment.screenId);
    if (!shot || !rephotographed.has(comment.screenId)) return comment;
    if (moved.has(comment.id) && !comment.shotHash) return comment;
    if (comment.shotHash && comment.shotHash === shot.hash) return comment;
    flagged += 1;
    return { ...comment, stale: true };
  });
  return { comments: marked, flagged };
}

/** What the plan says, in one line, for a run's output. Empty when there is nothing to say. */
export function planSummary(plan) {
  const parts = [];
  if (plan.moves.length > 0) {
    const frames = [...new Set(plan.moves.map((move) => `${move.from} → ${move.to}`))];
    parts.push(`${plan.moves.length} comment(s) follow their frame (${frames.join("; ")}): ${plan.moves.map((move) => move.id).join(", ")}`);
  }
  if (plan.released.length > 0) parts.push(`${plan.released.length} answered comment(s) released on purpose with their frame: ${plan.released.map((one) => one.id).join(", ")}`);
  return parts.join("\n");
}

/** This canvas's review file (`comments/<slug>.json`), or null when there is none yet. */
export function commentsFileFor(canvasDir, slug) {
  const file = path.join(canvasDir, "comments", `${slug}.json`);
  return existsSync(file) ? file : null;
}

/** The declared frames as the planner wants them, from a dump or from the served declaration's `screens`. */
export function declaredFrames(screens) {
  return new Map((screens ?? []).map((screen) => [screen.id, { flowId: screen.flowId, label: screen.label, url: screen.url }]));
}
