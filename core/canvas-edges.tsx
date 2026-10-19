"use client";

/**
 * design-canvas core: the edges between frames, each labeled with its press or condition; edges that leave
 * the happy path are dashed so the spine of the journey still reads.
 *
 * Drawn inside the world container, so one transform keeps every edge attached to its frames at any pan and
 * zoom. Labels are world-sized; only the stroke width comes through `--canvas-edge-width`, so it never thins to
 * nothing when zoomed out. One SVG per diagram, sized to it through a `viewBox`, paints faster than one for the canvas.
 */

import type { LaidOutEdge, LaidOutGroup } from "./graph-layout";

/** The dash pattern is in world units and scales with the stroke, so a dash never becomes a dot. */
const BRANCH_DASH = "9 7";
/** How far outside its own box a diagram's edges may reach: back edges arc below the bottom row. */
const OVERSHOOT = 420;
/** In world pixels, matching the frame captions: an edge label is canvas furniture, not screen furniture. */
const LABEL_SIZE = 26;
/** The interaction-origin accent: orange, because blue, green and red already mean the review queue, an answered pin and a failure. */
export const ORIGIN_ACCENT = "hsl(28 95% 55%)";

function toneOf(edge: LaidOutEdge): { opacity: number; dash?: string } {
  if (edge.kind === "branch" || edge.longWay)
    return { opacity: 0.66, dash: BRANCH_DASH };
  return { opacity: 0.8 };
}

export function CanvasEdgeLayer({
  groups,
  showOrigins = false,
}: {
  groups: LaidOutGroup[];
  /**
   * The interaction-origin mode, off by default: an edge whose origin the capture measured is drawn in the origin
   * accent from its highlight's border (`dOrigin`), so the line connects the highlight to the next screen.
   */
  showOrigins?: boolean;
}) {
  return (
    <>
      {groups.map((group) =>
        group.edges.length === 0 ? null : (
          <svg
            key={group.id}
            className="pointer-events-none absolute overflow-visible"
            style={{
              left: group.box.x,
              top: group.box.y,
              width: group.box.w + OVERSHOOT,
              height: group.box.h + OVERSHOOT,
            }}
            viewBox={`${group.box.x} ${group.box.y} ${group.box.w + OVERSHOOT} ${group.box.h + OVERSHOOT}`}
            aria-hidden
            data-canvas-zoom-vars=""
          >
            <defs>
              {/* Sized from the stroke width, which is itself capped, so the head keeps its proportion to
                  the line at every zoom instead of swelling when the canvas is pulled back. */}
              <marker
                id={`design-canvas-arrow-${group.id}`}
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="4"
                markerHeight="4"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill="hsl(0 0% 100% / 0.55)" />
              </marker>
            </defs>
            {group.edges.map((edge, index) => {
              const tone = toneOf(edge);
              const anchored = showOrigins && Boolean(edge.dOrigin);
              return (
                <path
                  key={`${edge.from}-${edge.to}-${index}`}
                  d={anchored ? edge.dOrigin : edge.d}
                  fill="none"
                  /* An anchored edge speaks the origin accent end to end, so the eye can follow one
                     orange line from the pressed control to the screen it opens. */
                  stroke={anchored ? ORIGIN_ACCENT : "hsl(0 0% 100% / 0.42)"}
                  strokeOpacity={anchored ? 0.9 : tone.opacity}
                  strokeDasharray={tone.dash}
                  strokeLinecap="round"
                  markerEnd={`url(#design-canvas-arrow-${group.id})`}
                  style={{ strokeWidth: "var(--canvas-edge-width, 2px)" }}
                  data-canvas-edge={`${edge.from}->${edge.to}`}
                  data-canvas-edge-kind={edge.kind ?? "step"}
                  data-canvas-edge-anchored={anchored ? "true" : undefined}
                />
              );
            })}
          </svg>
        ),
      )}

      {/* The labels are HTML rather than SVG text so each can be a padded pill centered on the curve's midpoint. */}
      {groups.flatMap((group) =>
        group.edges.map((edge, index) =>
          edge.label ? (
            <span
              key={`label-${group.id}-${edge.from}-${edge.to}-${index}`}
              /**
               * Opaque and dark like the canvas, for contrast on any ground: the stage's lifted surface with a hairline
               * and white text. A literal, not a project token, so the canvas looks the same in every project.
               */
              className="pointer-events-none absolute whitespace-nowrap rounded-full border border-white/[0.14] bg-[hsl(192_12%_13%)] font-medium text-white"
              style={{
                /* The mode's own label positions, so a pill stays on its re-anchored line. */
                left: showOrigins ? (edge.mxOrigin ?? edge.mx) : edge.mx,
                top: showOrigins ? (edge.myOrigin ?? edge.my) : edge.my,
                /* World-sized like every other text on the canvas, so it scales with the surface. */
                fontSize: LABEL_SIZE,
                lineHeight: 1.3,
                padding: "5px 12px",
                transform: "translate(-50%, -50%)",
              }}
              data-canvas-edge-label={`${edge.from}->${edge.to}`}
            >
              {edge.label}
            </span>
          ) : null,
        ),
      )}
    </>
  );
}
