"use client";

/**
 * design-canvas CORE — the edges, drawn.
 *
 * THESE ARE THE CONTENT, NOT DECORATION. What a canvas of frames cannot tell you is how a person gets
 * from one of them to another, and which of those moves leave the path the product was designed around.
 * So every connection is a real drawn edge between two frames, with the press or the condition written on
 * it, and the ones that leave the happy path are dashed so the spine of the journey still reads at a
 * glance without hiding them.
 *
 * It lives INSIDE the world container, in the same coordinate space as the frames, which is what keeps an
 * edge attached to its frame at every pan and every zoom: there is one transform, so there is nothing to
 * keep in step. Labels are sized in world pixels like every other piece of text here, so they scale with the
 * canvas and never move. The single exception is the stroke width, which is geometry rather than text and
 * would otherwise thin to nothing when the canvas is pulled back: it comes through `--canvas-edge-width`.
 *
 * ONE SVG PER DIAGRAM, not one for the canvas. A single element spanning every flow is tens of thousands
 * of pixels across, and asking the browser to paint one of those was measurably slower than five that are
 * each the size of the diagram in them. The paths keep world coordinates either way, through a `viewBox`
 * that starts at the group's own corner.
 */

import type { LaidOutEdge, LaidOutGroup } from "./graph-layout";

/** The dash pattern is in world units and scales with the stroke, so a dash never becomes a dot. */
const BRANCH_DASH = "9 7";
/** How far outside its own box a diagram's edges may reach: back edges arc below the bottom row. */
const OVERSHOOT = 420;
/** In world pixels, matching the frame captions: an edge label is canvas furniture, not screen furniture. */
const LABEL_SIZE = 26;

function toneOf(edge: LaidOutEdge): { opacity: number; dash?: string } {
  if (edge.kind === "branch" || edge.longWay)
    return { opacity: 0.66, dash: BRANCH_DASH };
  return { opacity: 0.8 };
}

export function CanvasEdgeLayer({ groups }: { groups: LaidOutGroup[] }) {
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
              return (
                <path
                  key={`${edge.from}-${edge.to}-${index}`}
                  d={edge.d}
                  fill="none"
                  stroke="hsl(0 0% 100% / 0.42)"
                  strokeOpacity={tone.opacity}
                  strokeDasharray={tone.dash}
                  strokeLinecap="round"
                  markerEnd={`url(#design-canvas-arrow-${group.id})`}
                  style={{ strokeWidth: "var(--canvas-edge-width, 2px)" }}
                  data-canvas-edge={`${edge.from}->${edge.to}`}
                  data-canvas-edge-kind={edge.kind ?? "step"}
                />
              );
            })}
          </svg>
        ),
      )}

      {/* The labels are HTML rather than SVG text so they use the app's own type and border tokens, and
          they sit on the curve's midpoint rather than beside it. */}
      {groups.flatMap((group) =>
        group.edges.map((edge, index) =>
          edge.label ? (
            <span
              key={`label-${group.id}-${edge.from}-${edge.to}-${index}`}
              /**
               * SOLID, AND DARK LIKE THE CANVAS. Two instructions from the owner, in order: "change the
               * opacity of the user flow connector badges to be 100% to improve the color contrast", then
               * "the connector badges should be in style of the canvas (dark instead of white)".
               *
               * They were `bg-white/[0.14]` with `white/90` text, so the stage came through the chip and the
               * label sat on a washed, semi-transparent ground — readable one at a time, muddy across a whole
               * flow, and a different colour over a frame than over open stage. A white chip fixed the
               * contrast and broke the surface: the canvas is a dark tool and a row of white pills reads as
               * UI dropped on top of it rather than as part of it.
               *
               * So: the stage's own lifted surface at FULL opacity, with a hairline to separate it from the
               * stage behind it, and white text. The value is the stage colour from `design-tokens.md`, one
               * of the two greys this whole tool is drawn in.
               */
              className="pointer-events-none absolute whitespace-nowrap rounded-full border border-white/[0.14] bg-[hsl(192_12%_13%)] font-medium text-white"
              style={{
                left: edge.mx,
                top: edge.my,
                /* World-sized, like every other piece of text on the canvas: it scales with the surface and
                   never moves. Only the centring transform is left. */
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
