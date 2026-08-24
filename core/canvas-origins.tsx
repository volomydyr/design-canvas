"use client";

/**
 * design-canvas CORE — the interaction-origin highlights, drawn.
 *
 * WHERE ON THE FRAME THE MOVE STARTS. An edge says a person went from this screen to that one and what
 * they did; what it cannot say on its own is WHERE on the screen that press lives. For a simple flow the
 * answer is obvious. For a dense order sheet with fifteen dialogs behind one toolbar it is not, and the
 * owner asked for exactly this: per outgoing edge, highlight where on the source frame the user acted.
 *
 * Each highlight is the rectangle the CAPTURE measured for a declared `CanvasEdge.origin` — never an
 * estimate — mapped into world coordinates by the layout (`LaidOutEdge.originBox`). With the mode on,
 * the edge itself is re-anchored to start AT the highlight (`dOrigin`) and drawn in the same accent, so
 * one orange line runs from the pressed control to the screen it opens. That connection IS the pairing:
 * no numbers (they overcomplicated the canvas — retired on the owner's feedback), no hover choreography
 * (redundant — same feedback), just a vivid ring where the press lands.
 *
 * ORANGE on purpose: blue is the review queue, green is the answered pin, red is a failure. A fourth job
 * gets a fourth color, or the reader cross-wires meanings.
 *
 * THE WHOLE LAYER IS BEHIND A TOGGLE THAT RESTS OFF. Several rings per frame is a lot of ink, and on a
 * simple flow it reads as overload — the owner's own words when he asked for the mode.
 *
 * It lives INSIDE the world container, in the same coordinate space as the frames, for the same reason
 * the edges do: one transform, so a highlight can never detach from its control at any pan or zoom.
 */

import type { LaidOutGroup } from "./graph-layout";

/** The same accent the anchored edges use: one voice for one feature. */
const ORIGIN_ACCENT = "hsl(28 95% 55%)";

export function CanvasOriginLayer({ groups }: { groups: LaidOutGroup[] }) {
  return (
    <>
      {groups.flatMap((group) =>
        group.edges.map((edge, index) => {
          if (!edge.originBox) return null;
          const box = edge.originBox;
          return (
            <div
              key={`origin-${group.id}-${edge.from}-${edge.to}-${index}`}
              className="pointer-events-none absolute rounded-[6px]"
              style={{
                left: box.x,
                top: box.y,
                width: box.w,
                height: box.h,
                border: `3px solid ${ORIGIN_ACCENT}`,
                background: "hsl(28 95% 55% / 0.16)",
              }}
              data-canvas-origin={`${edge.from}->${edge.to}`}
              data-canvas-origin-spec={edge.origin}
            />
          );
        }),
      )}
    </>
  );
}
