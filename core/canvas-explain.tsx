"use client";

/**
 * AN EXPLANATION PANEL IN A FLOW: the node a journey passes through when the canvas cannot photograph it.
 *
 * A buyer pays on Stripe's hosted page, a step happens on a phone, a document arrives by email — the flow
 * cannot photograph any of it, and skipping the beat makes the product read as if it skips a step. The owner,
 * deciding the mechanism: *"the screen that it might show won't really be a screenshot, But it could be just
 * an explanation of what will happen here on this step of the user flow."*
 *
 * THREE KINDS, THREE CHROMES (`CanvasScreen.explainKind`). One dark panel was carrying three different
 * truths, and the owner stopped it: *"if you use the same approach for both, it will start to be
 * confusing."* So:
 *
 * - OUTSIDE (default): a third party's surface. Neutral dashed ring on the dark panel, "Outside this app".
 *   Its design is not ours; a faithful-looking stand-in is banned ("Never draw a screen this product does
 *   not own").
 * - PRODUCT: part of this product's flow but not capturable from this repo (another repository, an email,
 *   the mobile app). Same dashed language — still not a picture — but tinted toward the canvas accent and
 *   footed "In this product, not capturable from here", so a reader knows this step is ours and will be
 *   designed, just not photographable from where the canvas stands.
 * - CANVAS BOUNDARY (`canvas:<slug>`): the step continues in ANOTHER CANVAS of this project. Solid tinted
 *   ring — the step is real, captured, just filed elsewhere — footed "Continues in the … canvas" with an
 *   "Open canvas" link. This is how canvases interconnect without duplicating each other's screens.
 *
 * WHY THIS IS A SIBLING OF `CanvasFrame` AND NOT A BRANCH INSIDE IT. The frame component is thirteen hundred
 * lines that all exist to serve a picture: the shot, its claims, the Open button, the annotation layer. An
 * explanation has none of those, so sharing the component would mean a file where half the code is guarded
 * against the other half. The two also must never converge visually.
 *
 * Every kind carries `data-canvas-explain`, never `data-canvas-screen` — the oracle counts pictures by the
 * latter, and none of these is a picture. The kind rides `data-canvas-explain-kind` so the oracle can hold
 * the rendered chrome against the declaration.
 */

import { EXPLAIN_SIZE } from "./graph-layout";
import type { CanvasScreen } from "./types";

/** Matches the frame chrome's type scale: the name at caption size, the body a step down. */
const TITLE_SIZE = 28;
const BODY_SIZE = 23;

/** The neutral dashed ring: same weight family as `FRAME_EDGE`, drawn as a border because a shadow cannot dash. */
const EDGE_OUTSIDE = "hsl(0 0% 100% / 0.28)";
/** The in-product tint: the canvas accent family, still dashed — ours, but still not a picture. */
const EDGE_PRODUCT = "hsl(187 65% 55% / 0.55)";
/** The boundary ring: solid, same tint — the step is real and captured, just filed in another canvas. */
const EDGE_BOUNDARY = "hsl(187 65% 55% / 0.7)";

/** "canvas:orders" → "orders"; anything else → null. Unknown values fall back to the outside chrome. */
function boundarySlug(kind: string | undefined): string | null {
  if (!kind || !kind.startsWith("canvas:")) return null;
  const slug = kind.slice("canvas:".length).trim();
  return slug.length > 0 ? slug : null;
}

/** "commerce-settings" → "Commerce Settings", for the footer line. */
function slugTitle(slug: string): string {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

export function CanvasExplain({ screen }: { screen: CanvasScreen }) {
  const kind = screen.explainKind ?? "outside";
  const slug = boundarySlug(kind);
  const inProduct = kind === "product";

  const border = slug
    ? `2px solid ${EDGE_BOUNDARY}`
    : `2px dashed ${inProduct ? EDGE_PRODUCT : EDGE_OUTSIDE}`;
  const background = slug
    ? "hsl(190 22% 15%)"
    : inProduct
      ? "hsl(190 18% 15%)"
      : "hsl(192 12% 17%)";

  return (
    <figure
      data-canvas-explain={screen.id}
      data-canvas-explain-kind={slug ? "canvas" : inProduct ? "product" : "outside"}
      className="relative m-0 flex flex-col gap-4 rounded-[14px] px-7 py-6"
      style={{
        width: EXPLAIN_SIZE.w,
        height: EXPLAIN_SIZE.h,
        border,
        background,
      }}
    >
      <figcaption
        className="font-semibold text-white/80"
        style={{ fontSize: TITLE_SIZE, lineHeight: 1.25 }}
      >
        {screen.label}
      </figcaption>
      <p
        className="m-0 overflow-hidden text-white/55"
        style={{ fontSize: BODY_SIZE, lineHeight: 1.45 }}
      >
        {screen.explain}
      </p>
      {slug ? (
        <span
          className="mt-auto flex items-baseline justify-between gap-4"
          style={{ fontSize: BODY_SIZE - 4 }}
        >
          <span style={{ color: "hsl(187 55% 62% / 0.85)" }}>
            Continues in the {slugTitle(slug)} canvas
          </span>
          {/* Live interconnection: the served canvas route. A missing target simply 404s until it exists. */}
          <a
            href={`/design-canvas/${slug}`}
            className="shrink-0 font-semibold underline underline-offset-4"
            style={{ color: "hsl(187 65% 68%)" }}
          >
            Open canvas
          </a>
        </span>
      ) : (
        <span
          className="mt-auto"
          style={{
            fontSize: BODY_SIZE - 4,
            color: inProduct ? "hsl(187 45% 60% / 0.75)" : "hsl(0 0% 100% / 0.35)",
          }}
        >
          {inProduct ? "In this product, not capturable from here" : "Outside this app"}
        </span>
      )}
    </figure>
  );
}
