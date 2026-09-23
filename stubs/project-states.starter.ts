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

/**
 * MAY A STATE BE PINNED IN THIS BUILD? Development always; a production build only when it opted in.
 *
 *   return process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_CANVAS_PINS === "1";
 *
 * Both halves are load-bearing and each was got wrong once, in opposite directions:
 *   - `NODE_ENV !== "production"` alone: captures run against a PRODUCTION build (dev compiles routes
 *     inside the capture's load budget and fails a different screen every run), and under that guard a
 *     build pinned NOTHING while every tile went on claiming its state.
 *   - `NEXT_PUBLIC_CANVAS_PINS === "1"` alone: a plain `npm run dev` pinned nothing either, so a teammate
 *     who checked the branch out and pressed Open landed on the resting page under every frame, with no
 *     error to say why. Owner, 2026-09-04, on being told the flag was needed: "it still sounds like
 *     overengineering. why can't open buttons just open what's needed without any pins?"
 *
 * `NEXT_PUBLIC_*` is inlined at BUILD time, so an ordinary production build compiles the second half to
 * `false` and the pins cannot be reached however the URL is crafted. Turning them on in production is a
 * deliberate act by somebody capturing or deploying a canvas, greppable in one place.
 *
 * EVERY READER OF A CANVAS URL PARAM IN APP CODE GOES THROUGH THIS FUNCTION. Never test the env variable
 * directly at a call site: twelve hand-written `=== "1"` checks in one project were the second failure.
 */
export function canvasPinsAllowed(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_CANVAS_PINS === "1";
}

/**
 * IS THIS PAGE BEING PHOTOGRAPHED? True only inside `capture.mjs`'s browser, which sets
 * `window.__designCanvasCapture` before any app code runs.
 *
 * A pin means "open this state"; this means "a frame is being taken of it". Keep them apart. A shortcut that
 * exists only to make a PICTURE sensible (a list painted with eight rows so a dialog frame is not captured down to
 * row fifty) goes behind BOTH, never behind the pin alone: the Open button carries the very same URL, and a list
 * that stops at eight for the person who pressed it reads as a broken product. Owner, 2026-09-14: "it's okay to
 * use such an approach just to capture a screen but it should never be like that when I open it through the open
 * button." Prefer the declaration's `oneViewport` over any shortcut at all: frame height belongs to the capture.
 */
export function canvasCapturing(): boolean {
  if (!canvasPinsAllowed() || typeof window === "undefined") return false;
  return (window as Window & { __designCanvasCapture?: boolean }).__designCanvasCapture === true;
}

/** The state this document was asked to show, or null when it is not a canvas frame. */
export function canvasStateId(): string | null {
  if (!canvasPinsAllowed()) return null;
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
