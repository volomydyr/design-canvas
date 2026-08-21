"use client";

/**
 * design-canvas CORE — the interaction-origin rings, drawn.
 *
 * WHERE ON THE FRAME THE MOVE STARTS. An edge says a person went from this screen to that one and what
 * they did; what it cannot say on its own is WHERE on the screen that press lives. For a simple flow the
 * answer is obvious. For a dense order sheet with fifteen dialogs behind one toolbar it is not, and the
 * owner asked for exactly this: per outgoing edge, highlight where on the source frame the user acted.
 *
 * Each ring is the rectangle the CAPTURE measured for a declared `CanvasEdge.origin` — never an estimate —
 * mapped into world coordinates by the layout (`LaidOutEdge.originBox`). The ring carries a numbered chip,
 * and the same number sits on the edge's label pill, so a frame with several regions still pairs each
 * region with its move at a glance. Hovering a ring lights its edge; hovering the edge's pill lights the
 * ring; the coupling state lives in the view, which owns hover for both layers.
 *
 * THE WHOLE LAYER IS BEHIND A TOGGLE THAT RESTS OFF. Several tinted rings per frame is a lot of ink, and
 * on a simple flow it reads as overload — the owner's own words when he asked for the mode. It exists for
 * the flows where it earns its ink, and it is one press away there.
 *
 * It lives INSIDE the world container, in the same coordinate space as the frames, for the same reason the
 * edges do: one transform, so a ring can never detach from its control at any pan or zoom.
 */

import { originKeyOf } from "./canvas-edges";
import type { LaidOutGroup } from "./graph-layout";

/** The same accent the anchored edges and the boundary chrome use: one voice for one feature. */
const ORIGIN_ACCENT = "hsl(187 65% 55%)";
/** In world pixels, matching the edge labels: the chip is canvas furniture. */
const CHIP_SIZE = 30;

export function CanvasOriginLayer({
  groups,
  hoveredOrigin = null,
  onHoverOrigin,
}: {
  groups: LaidOutGroup[];
  hoveredOrigin?: string | null;
  onHoverOrigin?: (key: string | null) => void;
}) {
  return (
    <>
      {groups.flatMap((group) =>
        group.edges.map((edge, index) => {
          if (!edge.originBox || edge.originIndex === undefined) return null;
          const key = originKeyOf(group.id, edge);
          const lit = hoveredOrigin === key;
          const box = edge.originBox;
          return (
            <div
              key={`origin-${group.id}-${edge.from}-${edge.to}-${index}`}
              className="absolute rounded-[6px]"
              style={{
                left: box.x,
                top: box.y,
                width: box.w,
                height: box.h,
                border: `2px solid ${ORIGIN_ACCENT}`,
                background: lit ? "hsl(187 65% 55% / 0.18)" : "transparent",
                boxShadow: lit ? `0 0 0 3px hsl(187 65% 55% / 0.35)` : "none",
              }}
              data-canvas-origin={`${edge.from}->${edge.to}`}
              /* The manifest's own picture-pixel rectangle, so the oracle can hold the drawn ring against
                 the measurement without re-deriving the world transform. */
              data-canvas-origin-spec={edge.origin}
              onMouseEnter={() => onHoverOrigin?.(key)}
              onMouseLeave={() => onHoverOrigin?.(null)}
            >
              {/* The pairing number, top-right and outside the ring so it never covers the control. */}
              <span
                className="absolute flex items-center justify-center rounded-full font-bold"
                style={{
                  top: -CHIP_SIZE / 2,
                  right: -CHIP_SIZE / 2,
                  width: CHIP_SIZE,
                  height: CHIP_SIZE,
                  fontSize: CHIP_SIZE * 0.6,
                  background: ORIGIN_ACCENT,
                  color: "hsl(192 30% 10%)",
                }}
              >
                {edge.originIndex}
              </span>
            </div>
          );
        }),
      )}
    </>
  );
}
