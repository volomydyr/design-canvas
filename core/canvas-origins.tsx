"use client";

/**
 * design-canvas core: the interaction-origin highlights. Per outgoing edge, a ring on the source frame shows
 * where the press lives: the rectangle the capture measured for `CanvasEdge.origin` (`LaidOutEdge.originBox`),
 * never an estimate. With the mode on, the edge starts at the ring (`dOrigin`) in the same accent.
 *
 * The layer rests off, since several rings per frame is a lot of ink. It sits inside the world container like
 * the edges, so a ring never detaches from its control at any pan or zoom.
 */

import { ORIGIN_ACCENT } from "./canvas-edges";
import type { LaidOutGroup } from "./graph-layout";

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
