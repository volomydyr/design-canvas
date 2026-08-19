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

export const CANVAS_COMMENTS_ENDPOINT = "/api/design-canvas/comments";
export const CANVAS_SHOTS_ENDPOINT = "/api/design-canvas/shots";

/** `?canvas=<slug>` on an endpoint, which is how both routes resolve which canvas is being asked about. */
function at(endpoint: string, canvas: string, extra?: string): string {
  const query = `canvas=${encodeURIComponent(canvas)}${extra ? `&${extra}` : ""}`;
  return `${endpoint}?${query}`;
}

/**
 * The comments, and the path they were read from.
 *
 * The path travels because the hand-off prompt has to name the file an agent should open, and which file that is
 * depends on the install: see `CanvasCommentFile.file`.
 */
export async function loadComments(canvas: string): Promise<{
  comments: CanvasComment[];
  file: string;
  /** Undefined means the key has never been written — see `CanvasCommentFile.seen` on why that is seeded. */
  seen: string[] | undefined;
}> {
  const fallback = `design-canvas/comments/${canvas}.json`;
  const response = await fetch(at(CANVAS_COMMENTS_ENDPOINT, canvas), {
    cache: "no-store",
  });
  if (!response.ok) return { comments: [], file: fallback, seen: [] };
  const body = (await response.json()) as CanvasCommentFile;
  return {
    comments: body.comments ?? [],
    file: body.file ?? fallback,
    seen: body.seen,
  };
}

/** Record screens as seen, which is what stops them being new. Returns the file's new `seen` list. */
export async function markSeen(
  canvas: string,
  ids: string[],
): Promise<string[]> {
  if (ids.length === 0) return [];
  const response = await fetch(at(CANVAS_COMMENTS_ENDPOINT, canvas), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ seen: ids }),
  });
  if (!response.ok) throw new Error(`Could not save (${response.status})`);
  const body = (await response.json()) as CanvasCommentFile;
  return body.seen ?? [];
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
): Promise<CanvasComment[]> {
  const response = await fetch(at(CANVAS_COMMENTS_ENDPOINT, canvas), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, note, image, reopen: true }),
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
