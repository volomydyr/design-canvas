/**
 * design-canvas — WHICH FRAMES ARE NEW, decided from the pictures the canvas keeps and never from anybody's say-so.
 *
 * A frame is NEW when this canvas never held a picture of it: its id had no shot in the previous manifest, and it is not an
 * older frame under a new id. A frame that had a picture and got another one is CHANGED (UNCHANGED when the picture is byte for
 * byte the same). Changed is never new: a redesign of an existing screen is reviewed through its comments and its before and
 * after, not through the new-screens queue.
 *
 * A RENAME IS NOT NEW. Two facts tell one, and both are evidence rather than judgment:
 *   - the declaration's `successors` names the old id (`{ "old-id": "new-id" }`), the same entry that moves its comments
 *   - the new id's first picture is identical to the picture of exactly one id that left the declaration in the same capture
 * A rename that also changes the picture and is not named in `successors` cannot be told from a new frame, so it counts as new.
 *
 * WHAT WAITS FOR THE REVIEWER is one map in the review file, `waiting: { "<frame id>": "new" | "changed" }`, written only by
 * the capture from this classification (`nextWaiting`) and emptied per frame when the reviewer approves it. Nothing is queued
 * before the reviewer's first visit (`viewedAt` in the review file): marks collected while a canvas is being built are noise
 * to someone who has seen none of it, and the visit itself empties the map.
 *
 * PURE: no file, no browser. `capture.mjs` calls these functions after it writes the manifest; any other tool that recaptures can
 * call them the same way.
 *
 * DELETE WITH: the design-canvas/ folder.
 */

/** Where a chain of `successors` ends for `id`: the last id it points at, or null for a release or a circle. */
function resolveSuccessor(id, successors) {
  const visited = new Set([id]);
  let at = successors[id];
  while (typeof at === "string" && Object.hasOwn(successors, at)) {
    if (visited.has(at)) return null;
    visited.add(at);
    at = successors[at];
  }
  return typeof at === "string" ? at : null;
}

/**
 * Every rename `successors` declares, as `{ from, to }` pairs, chains followed to the id they end at.
 * `null` entries (comments released on purpose) and circles name no successor, so they rename nothing.
 */
export function declaredRenames(successors = {}) {
  return Object.keys(successors ?? {})
    .map((from) => ({ from, to: resolveSuccessor(from, successors) }))
    .filter((pair) => pair.to !== null && pair.to !== pair.from);
}

/**
 * COMPARE TWO MANIFESTS. `before` and `after` are lists of shots (`{ screenId, hash }`, as `shots/manifest.json` holds them; a
 * later entry for the same id wins). Returns the ids by what happened to them:
 *   new        a picture for an id the canvas never had one for, and no rename explains it
 *   changed    the id had a picture and now has a different one
 *   unchanged  the id had a picture and still has the same one
 *   renamed    `{ from, to, by }`: `to` arrived, `from` left, and `by` says which fact tied them ("successors" or "picture")
 *   deleted    the id had a picture and is gone, and is not the old name of a renamed frame
 */
export function classifyFrames({ before = [], after = [], successors = {} } = {}) {
  const was = new Map(before.map((shot) => [shot.screenId, shot.hash]));
  const now = new Map(after.map((shot) => [shot.screenId, shot.hash]));
  const departed = [...was.keys()].filter((id) => !now.has(id));
  const arrived = [...now.keys()].filter((id) => !was.has(id));

  const renamed = [];
  const claimed = new Set();
  /* The declaration first: it is the explicit fact, and it holds even when the picture changed with the rename. */
  for (const { from, to } of declaredRenames(successors)) {
    if (!arrived.includes(to) || !departed.includes(from) || claimed.has(from)) continue;
    if (renamed.some((pair) => pair.to === to)) continue;
    renamed.push({ from, to, by: "successors" });
    claimed.add(from);
  }
  /* Then the picture, only where it names one frame each way: two identical empty states leaving at once prove nothing. */
  for (const to of arrived) {
    if (renamed.some((pair) => pair.to === to)) continue;
    const hash = now.get(to);
    if (!hash) continue;
    const sources = departed.filter((id) => !claimed.has(id) && was.get(id) === hash);
    const twins = arrived.filter((id) => now.get(id) === hash);
    if (sources.length !== 1 || twins.length !== 1) continue;
    renamed.push({ from: sources[0], to, by: "picture" });
    claimed.add(sources[0]);
  }

  const renamedTo = new Set(renamed.map((pair) => pair.to));
  return {
    new: arrived.filter((id) => !renamedTo.has(id)),
    changed: [...now.keys()].filter((id) => was.has(id) && was.get(id) !== now.get(id)),
    unchanged: [...now.keys()].filter((id) => was.has(id) && was.get(id) === now.get(id)),
    renamed,
    deleted: departed.filter((id) => !claimed.has(id)),
  };
}

/**
 * THE WAITING MAP AFTER A CAPTURE. `frames` is this capture's `classifyFrames` result over the `before` and `after` manifests,
 * `declared` the ids the canvas declares now. A rename moves its entry to the new id; a renamed frame that was not waiting
 * waits as changed when its picture changed, and a declared rename (`successors`) whose new id arrives in a later capture is
 * treated the same way. A new frame waits as new. A changed frame waits as changed unless it already waits as new. Entries
 * for frames no longer declared are dropped, except an old id that `successors` still names, whose entry its successor takes
 * when it arrives. Returns the same object when nothing changed, and always before the first visit (`viewed` false).
 * `identical` holds the ids whose new picture the change report (`visual-delta.mjs`) measured as identical to the one it
 * replaced: their bytes differ but no pixel does, so they do not wait as changed, and the queue agrees with the report.
 */
export function nextWaiting({ waiting, frames, before = [], after = [], declared, successors = {}, identical = new Set(), viewed }) {
  if (!viewed) return waiting;
  const was = new Map(before.map((shot) => [shot.screenId, shot.hash]));
  const now = new Map(after.map((shot) => [shot.screenId, shot.hash]));
  const next = { ...(waiting ?? {}) };
  const renamedTo = new Set();
  const renames = [...frames.renamed, ...declaredRenames(successors).filter((pair) => frames.new.includes(pair.to))];
  for (const { from, to } of renames) {
    if (renamedTo.has(to)) continue;
    renamedTo.add(to);
    const redrawn = was.has(from) && was.get(from) !== now.get(to) && !identical.has(to);
    const mark = next[from] ?? (redrawn ? "changed" : undefined);
    delete next[from];
    if (mark) next[to] = mark;
  }
  for (const id of frames.new) if (!renamedTo.has(id)) next[id] = "new";
  for (const id of frames.changed) if (!identical.has(id)) next[id] ??= "changed";
  for (const id of Object.keys(next)) if (!declared.has(id) && !Object.hasOwn(successors ?? {}, id)) delete next[id];
  const same = (a, b) => Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((id) => a[id] === b[id]);
  return same(next, waiting ?? {}) ? waiting : next;
}

/**
 * One line for a capture's output: what the run did to the canvas's frames, by kind. `identical` is the same set `nextWaiting`
 * takes: a frame whose bytes changed but no pixel did is not called changed, so the line, the queue and the change report agree.
 */
export function sayFrames(frames, identical = new Set()) {
  const part = (label, ids) => (ids.length > 0 ? `${ids.length} ${label} (${ids.join(", ")})` : null);
  const parts = [
    part("new", frames.new),
    part("changed", frames.changed.filter((id) => !identical.has(id))),
    part("renamed", frames.renamed.map((pair) => `${pair.from} -> ${pair.to}`)),
    part("removed", frames.deleted),
  ].filter(Boolean);
  return parts.length > 0 ? `frames: ${parts.join(", ")}` : "frames: nothing new, changed, renamed or removed";
}
