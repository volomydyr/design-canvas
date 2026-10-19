/**
 * design-canvas CORE — the browser half of persistence.
 *
 * Comments go to a JSON file in the repo through a dev-only route, so the agent that has to act on them
 * reads the repo and the designer copies nothing out of a browser. That handoff is the whole point of the
 * comment layer, and it is why the annotated picture travels with the note: the agent opens one file and
 * SEES the region being complained about.
 *
 * EVERY CALL NAMES ITS CANVAS. One project can hold several canvases, addressed as `/design-canvas/<slug>`,
 * and the slug is what keeps their shots and their reviews apart. It is the first argument of every function
 * here rather than a module-level variable, because a module-level one would be set by whichever canvas
 * mounted last — and two canvases open in two tabs is the normal way this gets used.
 */

import type {
  CanvasComment,
  CanvasCommentFile,
  CanvasShot,
  CanvasVerdict,
} from "./types";
import type { SystemManifest } from "./system";

export const CANVAS_COMMENTS_ENDPOINT = "/api/design-canvas/comments";
export const CANVAS_SHOTS_ENDPOINT = "/api/design-canvas/shots";

/** `?canvas=<slug>` on an endpoint, which is how both routes resolve which canvas is being asked about. */
function at(endpoint: string, canvas: string, extra?: string): string {
  const query = `canvas=${encodeURIComponent(canvas)}${extra ? `&${extra}` : ""}`;
  return `${endpoint}?${query}`;
}

/**
 * IS THIS PAGE DRIVEN BY A TOOL RATHER THAN READ BY THE REVIEWER? An automated browser says so (`navigator.webdriver`); an agent
 * driving a real browser through an extension does not, so its tools open the canvas with `?agent=1`, which this page load and
 * every in-page navigation after it remember. Such a page never reports the canvas open and never counts as the first visit.
 * PURE given its inputs, and exported for the tests.
 */
export function drivenByTool(
  nav: { webdriver?: boolean } | undefined = typeof navigator === "undefined" ? undefined : navigator,
  search: string = typeof location === "undefined" ? "" : location.search,
  store: { getItem(key: string): string | null; setItem(key: string, value: string): void } | undefined = (() => {
    try {
      return typeof sessionStorage === "undefined" ? undefined : sessionStorage;
    } catch {
      return undefined;
    }
  })(),
): boolean {
  if (nav?.webdriver) return true;
  try {
    if (new URLSearchParams(search).has("agent")) {
      store?.setItem("design-canvas-agent", "1");
      return true;
    }
    return store?.getItem("design-canvas-agent") === "1";
  } catch {
    return false;
  }
}

/** This page's id in the reports that a canvas is open, one per page load, so two tabs count as two viewers. */
const VIEWER =
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `viewer-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

/**
 * Tell the dev server this canvas is open and visible, with the tab, the device and the frames on screen, or, with `null`, that
 * this page no longer shows it. The recapture photographs open canvases first and refreshes one as it opens. A page driven by a
 * tool (`drivenByTool`: an agent checking its work, the oracle) is not a reviewer and never reports. A failed report is dropped: the next
 * one, or the two-minute expiry, corrects it.
 */
export async function reportViewing(
  canvas: string,
  seen: { tab: string; device: string; visible: string[] } | null,
): Promise<void> {
  if (drivenByTool()) return;
  try {
    await fetch(at(CANVAS_COMMENTS_ENDPOINT, canvas), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ viewing: seen ? { viewer: VIEWER, ...seen } : { viewer: VIEWER, gone: true } }),
      keepalive: true,
    });
  } catch {
    /* Dropped: see above. */
  }
}

/**
 * The frames on screen, in reading order (top to bottom, then left to right). `view` is the surface's transform (screen =
 * world * z + x), `width` and `height` the window's size. PURE, and exported for the tests.
 */
export function framesOnScreen(
  nodes: { screen: { id: string }; x: number; y: number; w: number; h: number }[],
  view: { x: number; y: number; z: number },
  width: number,
  height: number,
): string[] {
  if (!(view.z > 0)) return [];
  const left = -view.x / view.z;
  const top = -view.y / view.z;
  const right = left + width / view.z;
  const bottom = top + height / view.z;
  return nodes
    .filter((node) => node.x < right && node.x + node.w > left && node.y < bottom && node.y + node.h > top)
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((node) => node.screen.id)
    .filter((id, index, all) => all.indexOf(id) === index);
}

/** The screens waiting for the reviewer, by frame id (`CanvasCommentFile.waiting`). */
export type Waiting = Record<string, "new" | "changed">;

/**
 * A canvas's comments and its waiting screens. A failed read is an empty review. `unvisited` is true only when the file was
 * read and records no visit (`viewedAt`), so a failed read never counts as a first visit.
 */
export async function loadComments(canvas: string): Promise<{
  comments: CanvasComment[];
  waiting: Waiting;
  unvisited: boolean;
}> {
  const response = await fetch(at(CANVAS_COMMENTS_ENDPOINT, canvas), {
    cache: "no-store",
  });
  if (!response.ok) return { comments: [], waiting: {}, unvisited: false };
  const body = (await response.json()) as CanvasCommentFile;
  return { comments: body.comments ?? [], waiting: body.waiting ?? {}, unvisited: !body.viewedAt };
}

/** The canvases this page load has already reported a visit to. */
const reportedVisits = new Set<string>();

/**
 * Record the reviewer's first visit: the route sets `viewedAt` once and empties the waiting queue. Returns the queue as the
 * file now holds it, or null when the write was refused (a published canvas) or failed, which changes nothing on screen.
 * Sent at most once per canvas per page load: a review file removed while the page stays open (the oracle clears its probe
 * key at the end of a run) is not written again by a later look.
 */
export async function markViewed(canvas: string): Promise<Waiting | null> {
  /* An automated browser or an agent's tools (an agent checking its work, the oracle) is not the reviewer, so it never counts as
     the visit. */
  if (drivenByTool()) return null;
  if (reportedVisits.has(canvas)) return null;
  reportedVisits.add(canvas);
  try {
    const response = await fetch(at(CANVAS_COMMENTS_ENDPOINT, canvas), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ viewed: true }),
    });
    if (!response.ok) return null;
    return ((await response.json()) as CanvasCommentFile).waiting ?? {};
  } catch {
    return null;
  }
}

/** Approve screens, new or changed: they leave the waiting queue. Returns the queue as the file now holds it. */
export async function markReviewed(canvas: string, ids: string[]): Promise<Waiting> {
  const response = await fetch(at(CANVAS_COMMENTS_ENDPOINT, canvas), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reviewed: ids }),
  });
  if (!response.ok) throw new Error(`Could not save (${response.status})`);
  return ((await response.json()) as CanvasCommentFile).waiting ?? {};
}

/** Read the verdicts back out of the comments. Derived, never a second list — see `CanvasCommentKind`. */
export function verdictsIn(comments: CanvasComment[]): CanvasVerdict[] {
  return comments
    .filter((one) => one.kind === "like" || one.kind === "dislike")
    .map((one) => ({
      screenId: one.screenId,
      value: one.kind as "like" | "dislike",
    }));
}

/**
 * Keep an option, drop it, or clear the verdict with `null`.
 *
 * WHAT THE SERVER NEEDS FROM THE CANVAS, and why the caller passes it. A verdict is written as a comment, and a
 * comment in this file reads on its own without the declaration beside it — the label, the route and the pinned
 * state are denormalised into it. Only the canvas knows those, so they travel with the press. `image` is the
 * screen's already-captured shot rather than a freshly drawn one: the region is the whole frame, so there is no
 * outline to draw, and re-encoding a PNG on every press is exactly what made the button feel slow.
 *
 * Returns the whole file, so one answer settles both the comments and the verdicts read out of them.
 */
export async function setVerdict(
  canvas: string,
  verdict: {
    screenId: string;
    value: "like" | "dislike" | null;
    flowId?: string;
    label?: string;
    route?: string;
    state?: string | null;
    image?: string;
  },
): Promise<CanvasCommentFile> {
  const response = await fetch(at(CANVAS_COMMENTS_ENDPOINT, canvas), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ verdict }),
  });
  if (!response.ok)
    throw new Error(`Could not save the verdict (${response.status})`);
  return (await response.json()) as CanvasCommentFile;
}

/** What was captured, and what was proved about each capture. The canvas cannot draw a frame without it. */
export async function loadShots(canvas: string): Promise<CanvasShot[]> {
  const response = await fetch(at(CANVAS_SHOTS_ENDPOINT, canvas), {
    cache: "no-store",
  });
  if (!response.ok) return [];
  const manifest = (await response.json()) as { shots?: CanvasShot[] };
  return manifest.shots ?? [];
}

/** The explorations the capture found in real-code mode (`bases` in the manifest), by id: their Hand Off folds the winner in. */
export async function loadRealCode(canvas: string): Promise<string[]> {
  try {
    const response = await fetch(at(CANVAS_SHOTS_ENDPOINT, canvas), { cache: "no-store" });
    if (!response.ok) return [];
    const manifest = (await response.json()) as { bases?: Record<string, { mode?: string; retired?: boolean }> };
    return Object.entries(manifest.bases ?? {})
      .filter(([, base]) => base.mode === "real-code" && !base.retired)
      .map(([id]) => id);
  } catch {
    return [];
  }
}

/** The design system tab's manifest, or null when nothing has been photographed (or the request failed). */
export async function loadSystem(canvas: string): Promise<SystemManifest | null> {
  try {
    const response = await fetch(at(CANVAS_SHOTS_ENDPOINT, canvas, "system=1"), { cache: "no-store" });
    if (!response.ok) return null;
    const read = (await response.json()) as SystemManifest | { missing: true };
    return "sets" in read && read.sets.length > 0 ? read : null;
  } catch {
    return null;
  }
}

/** One picture of the design system tab. The hash makes a reshot cell a new URL rather than new bytes at an old one. */
export function systemShotUrl(canvas: string, set: string, cell: string, hash: string): string {
  return at(CANVAS_SHOTS_ENDPOINT, canvas, `system=${encodeURIComponent(set)}&cell=${encodeURIComponent(cell)}&v=${hash}`);
}

/** The id, the timestamps and the annotated file are the server's business. */
export type NewComment = {
  screenId: string;
  region: CanvasComment["region"];
  note: string;
  /** The captured shot with this comment's outline drawn on it, as a PNG data URL. */
  image: string;
  shotHash: string;
  /** Filled in by the canvas from the declaration, so the file reads without it. */
  flowId?: string;
  label?: string;
  route?: string;
  state?: string | null;
};

/**
 * Which frame a saved comment is drawn on, when the same screen is drawn once per group. The frame of the group
 * it was drawn in when that group is on the canvas; else the first frame that carries the screen, so a comment
 * never goes homeless: one made on the grouped view (its `flowId` is a flow, not an exploration) still shows
 * on the exploration tab, on the incumbent's first copy, and one made before groups were recorded (no
 * `flowId`) behaves the same. Drawn on every copy, a comment is duplicated once per group; drawn on none, the
 * review bar counts a comment that leads nowhere.
 */
export function homeFrameOf<T extends { screenId: string; groupId: string }>(
  comment: { screenId: string; flowId?: string },
  frames: T[],
): T | undefined {
  const same = frames.filter((frame) => frame.screenId === comment.screenId);
  return (
    same.find((frame) => Boolean(comment.flowId) && frame.groupId === comment.flowId) ??
    same[0]
  );
}

/** Whether a saved comment belongs on THIS frame: the frame is its home among `frames`. */
export function belongsOnFrame<T extends { screenId: string; groupId: string }>(
  comment: { screenId: string; flowId?: string },
  frame: T,
  frames: T[],
): boolean {
  const home = homeFrameOf(comment, frames);
  return home != null && home.screenId === frame.screenId && home.groupId === frame.groupId;
}

export async function saveComment(
  canvas: string,
  comment: NewComment,
): Promise<CanvasComment[]> {
  const response = await fetch(at(CANVAS_COMMENTS_ENDPOINT, canvas), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(comment),
  });
  if (!response.ok)
    throw new Error(`Could not save the comment (${response.status})`);
  const file = (await response.json()) as CanvasCommentFile;
  return file.comments ?? [];
}

/** Everything, records and pictures. What the handoff panel offers once the work has been handed over. */
export async function clearComments(canvas: string): Promise<CanvasComment[]> {
  const response = await fetch(at(CANVAS_COMMENTS_ENDPOINT, canvas, "all=1"), {
    method: "DELETE",
  });
  if (!response.ok)
    throw new Error(`Could not clear the comments (${response.status})`);
  const file = (await response.json()) as CanvasCommentFile;
  return file.comments ?? [];
}

/**
 * Rewrite a comment's words in place. Everything else about it — the region, the annotated picture, the shot
 * it was drawn on — is deliberately untouched: the sentence was wrong, not the place.
 */
export async function editComment(
  canvas: string,
  id: string,
  note: string,
): Promise<CanvasComment[]> {
  const response = await fetch(at(CANVAS_COMMENTS_ENDPOINT, canvas), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, note }),
  });
  if (!response.ok)
    throw new Error(`Could not save the edit (${response.status})`);
  const file = (await response.json()) as CanvasCommentFile;
  return file.comments ?? [];
}

/**
 * Dismiss with another round of feedback. The comment stays ONE comment on one rectangle: the new words
 * replace the old, the old join `history`, and it goes back to being unconsumed — which is what puts it in
 * the agent's queue again and out of the reviewer's. The picture is redrawn from the current screenshot,
 * because that is the one the reviewer is objecting to.
 */
export async function addFeedback(
  canvas: string,
  id: string,
  note: string,
  image: string,
  shotHash: string,
): Promise<CanvasComment[]> {
  const response = await fetch(at(CANVAS_COMMENTS_ENDPOINT, canvas), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, note, image, shotHash, reopen: true }),
  });
  if (!response.ok)
    throw new Error(`Could not send the feedback (${response.status})`);
  const file = (await response.json()) as CanvasCommentFile;
  return file.comments ?? [];
}

export async function deleteComment(
  canvas: string,
  id: string,
): Promise<CanvasComment[]> {
  return deleteComments(canvas, [id]);
}

/**
 * ONE REQUEST FOR THE WHOLE BATCH, which is what Approve All needs.
 *
 * It used to call `deleteComment` once per comment inside a `Promise.all`. Every one of those requests
 * rewrites the entire records file, so they all read the same list and the last write won: one approval
 * stuck and the rest came back, and the next comment was numbered as though nothing had been approved.
 * Sending the ids together makes it a single read-modify-write, so there is nothing to race.
 */
export async function deleteComments(
  canvas: string,
  ids: string[],
): Promise<CanvasComment[]> {
  if (ids.length === 0) return (await loadComments(canvas)).comments;
  const response = await fetch(
    at(CANVAS_COMMENTS_ENDPOINT, canvas, `ids=${ids.map(encodeURIComponent).join(",")}`),
    { method: "DELETE" },
  );
  if (!response.ok)
    throw new Error(
      `Could not delete ${ids.length === 1 ? "the comment" : "the comments"} (${response.status})`,
    );
  const file = (await response.json()) as CanvasCommentFile;
  return file.comments ?? [];
}

/**
 * A NOTE THE REVIEWER REOPENED WITH NEW FEEDBACK AFTER AN AGENT WORKED IT, and that no agent has worked since.
 *
 * Read from the record, no field of its own. A dismissal with new feedback appends to `history` (its `at` is the moment
 * of the dismissal) and clears `consumedAt`, so the note is "reopened" while that dismissal is later than the last
 * `consumedAt`, and stops being so the moment an agent consumes it again. A plain edit of the words (`editedAt`) is not
 * a reopening and does not count. ISO timestamps compare as strings.
 */
export function reopenedAfterWork(
  comment: Pick<CanvasComment, "consumedAt" | "history">,
): boolean {
  const consumed = comment.consumedAt ?? null;
  const history = comment.history ?? [];
  const reopened = history.length > 0 ? history[history.length - 1].at : null;
  return Boolean(reopened && (!consumed || consumed < reopened));
}

/**
 * THE COMMENTS WAITING FOR THE REVIEWER ON THE TAB IN VIEW: worked notes whose home frame is among `frames`,
 * the frames that tab draws. A note drawn on another tab, and every note on a tab with no frames (the design
 * system), is not counted here, because the review bar on this tab cannot walk to it.
 */
export function reviewQueueOn<T extends { screenId: string; groupId: string }>(
  comments: CanvasComment[],
  frames: T[],
): CanvasComment[] {
  return comments.filter((comment) => reviewable(comment) && homeFrameOf(comment, frames) !== undefined);
}

/**
 * A NOTE IS THE REVIEWER'S TO CLOSE once the agent has marked it worked (`consumedAt`), whether or not the recapture changed
 * the picture and whether or not it was answered: the agent has handed it back. Its pin offers Approve and Dismiss, and the
 * comments queue counts it; one predicate for both, so the count and the pin always agree. Until then it is the agent's
 * instruction: Edit and Delete. A verdict is never a note to close.
 */
export const reviewable = (comment: CanvasComment) => Boolean(comment.consumedAt) && (!comment.kind || comment.kind === "note");

/**
 * WHAT WAITS FOR THE REVIEWER ON ONE CANVAS, by kind. `frames` is every frame the canvas draws (`screenId`, `groupId`),
 * `shots` its manifest by id, `waiting` the review file's queue, `comments` its records. A waiting frame counts only when
 * it is declared and has a picture. Frames keep the declaration's order.
 *   fresh     the new-screens queue
 *   changed   the changed-screens queue
 *   comments  worked notes whose home frame the canvas draws (the comments queue)
 */
export function waitingOn<T extends { screenId: string; groupId: string }>({
  frames,
  shots,
  waiting,
  comments,
}: {
  frames: T[];
  shots: Record<string, unknown> | null;
  waiting: Waiting;
  comments: CanvasComment[];
}): { fresh: string[]; changed: string[]; comments: number } {
  const pictured = [...new Set(frames.map((one) => one.screenId))].filter((id) => Boolean(shots?.[id]));
  return {
    fresh: pictured.filter((id) => waiting[id] === "new"),
    changed: pictured.filter((id) => waiting[id] === "changed"),
    comments: reviewQueueOn(comments, frames).length,
  };
}
