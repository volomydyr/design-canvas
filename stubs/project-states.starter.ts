"use client";

/**
 * design-canvas ADAPTER — the named states, and the ONLY file that touches this project's stores or data.
 *
 * OPTIONAL. State pinning is inherently per-project: another repo puts its state somewhere else, or has
 * none worth pinning. The core never asks whether this file exists — it only appends `?canvas=<id>` when
 * a screen declares a state, and a screen with no state renders its route untouched. Delete this file
 * and `canvas-state-pin.tsx` and the canvas still works.
 *
 * WHY IT RUNS AT MODULE SCOPE rather than in an effect. The states have to be in place before the app's
 * own components mount. A page that reads a store ONCE into `useState` on mount, or memoises a selector
 * with an empty dependency list, is exactly the "a mount effect quietly undoes what you seeded" trap:
 * the frame renders the default while the declaration claims a special case, and nothing about the
 * picture says so. Applying in an effect loses that race. This applies as the module is evaluated in the
 * frame, which is before React renders.
 *
 * WRITE DOWN THE FACTS THIS RELIES ON, each one verified in the code rather than assumed — which stores
 * persist and therefore have to be skipped or overridden, which are plain in-memory stores and therefore
 * free, and which data comes from a module-level array that needs a dev-only setter. On the project this
 * came from, those three sentences were the difference between states that pinned and states that
 * silently did not.
 *
 * DELETE WITH: the design-canvas/ folder, along with any dev-only setter it calls in app code.
 */

import { CANVAS_STATE_PARAM } from "../core/types";

/** Every state the declaration may name. An unknown id is reported, never silently ignored. */
const STATES: Record<string, () => void> = {
  /**
   * REPLACE. One entry per named state, each with a comment saying what a person would have had to do
   * to be in it — a state nobody can reach is a state the canvas should not be drawing.
   */
};

/** The state this document was asked to show, or null when it is not a canvas frame. */
export function canvasStateId(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(CANVAS_STATE_PARAM);
}

let applied: string | null = null;

/**
 * Apply the pinned state. Idempotent, and silent on a page that is not in the canvas. Returns what it
 * did so the caller can say so out loud rather than guessing.
 */
export function applyCanvasState(): { state: string | null; known: boolean } {
  const id = canvasStateId();
  if (!id) return { state: null, known: true };
  if (applied === id) return { state: id, known: true };
  const apply = STATES[id];
  if (!apply) {
    /* A declared state with no implementation would otherwise render the default and lie about it. */
    console.error(
      `[design-canvas] Unknown pinned state "${id}". The frame is showing the default.`,
    );
    return { state: id, known: false };
  }
  apply();
  applied = id;
  return { state: id, known: true };
}

/* Applied on import, which is the earliest moment available inside the frame. The component in
   `./canvas-state-pin.tsx` calls it again on its first render, because a client-side navigation changes
   the query without re-evaluating this module. */
applyCanvasState();
