"use client";

/**
 * An explanation panel in a flow: the node a journey passes through when the canvas cannot photograph it.
 *
 * A third party's hosted page, a step on a phone, a message by email: the flow cannot photograph them, and
 * skipping the step would make the flow read as if it skips one. So the node explains what happens here.
 *
 * Each kind (`CanvasScreen.explainKind`) has its own chrome:
 * - outside (default): a third party's surface, on a dashed ring footed "Outside this app". A faithful-looking
 *   stand-in is never drawn, because its design is not this product's.
 * - product: this product's step, not capturable from this repo. Same dashed ring, footed differently.
 * - canvas boundary (`canvas:<slug>`): the step continues on another canvas. A white card, the dark panels'
 *   inverse, with one button that opens that canvas, so canvases link without duplicating screens.
 *
 * A sibling of `CanvasFrame`, not a branch in it: everything in the frame serves a picture, and this has none.
 *
 * Every kind carries `data-canvas-explain`, never `data-canvas-screen`, which the oracle counts pictures by; the
 * kind rides `data-canvas-explain-kind` so the oracle can check the chrome against the declaration.
 */

import { BOUNDARY_SIZE, EXPLAIN_SIZE } from "./graph-layout";
import type { CanvasScreen } from "./types";

/** Matches the frame chrome's type scale: the name at caption size, the body a step down. */
const TITLE_SIZE = 28;
const BODY_SIZE = 23;

/** The dashed ring both dashed kinds wear, drawn as a border because a shadow cannot dash. The footer text tells
 *  them apart. */
const EDGE_OUTSIDE = "hsl(0 0% 100% / 0.28)";

/** "canvas:trips" → "trips"; anything else → null. Unknown values fall back to the outside chrome. */
function boundarySlug(kind: string | undefined): string | null {
  if (!kind || !kind.startsWith("canvas:")) return null;
  const slug = kind.slice("canvas:".length).trim();
  return slug.length > 0 ? slug : null;
}

/** "account-settings" → "Account Settings", for the footer line. */
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

  /* The boundary card: white, no border (its lightness against the stage is enough), title, body and one button. */
  if (slug) {
    return (
      <figure
        data-canvas-explain={screen.id}
        data-canvas-explain-kind="canvas"
        className="relative m-0 flex flex-col gap-4 rounded-[14px] px-7 py-6"
        style={{
          width: BOUNDARY_SIZE.w,
          height: BOUNDARY_SIZE.h,
          background: "hsl(0 0% 97%)",
        }}
      >
        <figcaption
          className="font-semibold"
          style={{ fontSize: TITLE_SIZE, lineHeight: 1.25, color: "hsl(200 15% 12%)" }}
        >
          {screen.label}
        </figcaption>
        <p
          className="m-0 overflow-hidden"
          style={{ fontSize: BODY_SIZE, lineHeight: 1.45, color: "hsl(200 8% 38%)" }}
        >
          {screen.explain}
        </p>
        {/* `data-canvas-chrome`, or the pan handler captures the press and the link never fires. A missing
            canvas 404s until it exists. The background is a class so `:hover` can override it. */}
        <a
          href={`/design-canvas/${slug}`}
          title={`The ${slugTitle(slug)} canvas`}
          data-canvas-chrome=""
          className="mt-auto flex items-center justify-center self-start rounded-full bg-[hsl(200_15%_12%)] font-semibold text-white transition-colors hover:bg-[hsl(200_13%_26%)]"
          style={{
            fontSize: BODY_SIZE,
            padding: "14px 34px",
          }}
        >
          Open Canvas
        </a>
      </figure>
    );
  }

  return (
    <figure
      data-canvas-explain={screen.id}
      data-canvas-explain-kind={inProduct ? "product" : "outside"}
      className="relative m-0 flex flex-col gap-4 rounded-[14px] px-7 py-6"
      style={{
        width: EXPLAIN_SIZE.w,
        height: EXPLAIN_SIZE.h,
        border: `2px dashed ${EDGE_OUTSIDE}`,
        background: "hsl(192 12% 17%)",
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
      <span
        className="mt-auto"
        style={{
          fontSize: BODY_SIZE - 4,
          color: "hsl(0 0% 100% / 0.35)",
        }}
      >
        {inProduct ? "In this product, not capturable from here" : "Outside this app"}
      </span>
    </figure>
  );
}
