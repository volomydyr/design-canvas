"use client";

/**
 * design-canvas — the page. Three facts and nothing else: it is dev-only, it uses this project's
 * declarations, and the viewer draws them.
 *
 * Reached at `/design-canvas/<slug>` through the one-line stubs in `app/design-canvas/`. Never linked from app
 * navigation, and both hard-404 in production.
 *
 * ONE PROJECT, SEVERAL CANVASES, ADDRESSED BY URL. A project stopped being one canvas the moment a second
 * feature wanted one, and the separation is a URL segment rather than anything on screen. Owner:
 * _"if currently we have a URL called design canvas and it opens the online store canvas, what we could do is
 * to have design-canvas/storefront for the storefront stuff and design-canvas/checkout for the checkout
 * stuff… I'm not sure we need to introduce any new UI on the canvas yet."_ So there is no canvas switcher in
 * the toolbar: the address bar is the switcher.
 *
 * DELETE WITH: the design-canvas/ folder.
 */

import { notFound } from "next/navigation";

import { CanvasView } from "./core/canvas-view";
import { canvasHidden, type CanvasRegistry } from "./core/types";

/** One canvas, named by the URL segment. An unknown slug is a 404, never a redirect to a different canvas. */
export function CanvasPage({
  canvases,
  canvas,
}: {
  canvases: CanvasRegistry;
  canvas: string;
}) {
  if (canvasHidden()) notFound();
  const declaration = canvases[canvas];
  if (!declaration) notFound();
  /* THE WHOLE REGISTRY GOES DOWN, not just this canvas's declaration: the switcher in the top-left corner is a
     list of the project's canvases, and this component is the only place that already holds them. */
  return (
    <CanvasView declaration={declaration} canvas={canvas} canvases={canvases} />
  );
}

/**
 * `/design-canvas` itself, with no slug. A list of what this project has, in the tool's own dark surface so it
 * cannot be mistaken for a page of the app.
 *
 * DELIBERATELY NOT A REDIRECT, even when there is only one canvas. A redirect is invisible: the one-canvas
 * project silently teaches everybody the short URL, then a second canvas arrives and every bookmark, README
 * line and screenshot in the team's history points at a page that now has to choose for them. One list, always,
 * and it is one press.
 */
export function CanvasIndex({ canvases }: { canvases: CanvasRegistry }) {
  if (canvasHidden()) notFound();
  const names = Object.keys(canvases);
  return (
    <main className="min-h-screen bg-[hsl(180_10%_11%)] px-10 py-14 text-white">
      {/* Sentence case, like every other piece of text this tool draws. NEVER all caps: the owner's standing
          rule, and it applies to the canvas's own chrome as much as to a product's UI — differentiate with
          weight, size and colour instead. */}
      <h1 className="text-[0.9375rem] font-semibold text-white/55">
        Design canvas
      </h1>
      <ul className="mt-8 flex max-w-2xl flex-col gap-2">
        {names.map((name) => (
          <li key={name}>
            <a
              href={`/design-canvas/${name}`}
              className="flex flex-col gap-1 rounded-2xl bg-white/[0.04] px-6 py-5 transition-colors hover:bg-white/[0.08]"
            >
              <span className="text-[1.0625rem] font-semibold">
                {canvases[name].title}
              </span>
              <span className="text-[0.8125rem] text-white/55">
                {canvases[name].note}
              </span>
              <span className="mt-1 text-[0.75rem] text-white/35">
                /design-canvas/{name}
              </span>
            </a>
          </li>
        ))}
      </ul>
      {names.length === 0 ? (
        <p className="mt-8 max-w-2xl text-[0.875rem] leading-6 text-white/55">
          No canvases declared yet. Export a `CANVASES` record from
          design-canvas/project/flows.ts, then run node
          design-canvas/capture.mjs
        </p>
      ) : null}
    </main>
  );
}
