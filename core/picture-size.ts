/**
 * design-canvas CORE: which picture a frame draws, the full capture or its quarter-scale copy, and whether a floating
 * panel hangs below or above what it belongs to (`hangsBelow`).
 *
 * Pure, so it can be tested without a browser, and so the canvas re-renders on a handful of zoom steps
 * rather than on every animation frame of a zoom.
 */

/**
 * The zoom rounded UP to a power of two. The canvas keeps this, not the zoom itself, so a zoom gesture
 * re-renders the frames only when it crosses one of these steps.
 */
export function zoomStep(zoom: number): number {
  return 2 ** Math.ceil(Math.log2(Math.max(zoom, 1e-3)));
}

/**
 * True when the small copy has at least as many pixels across as the frame takes up on screen at this zoom
 * step, so drawing it is never an upscale and the frame looks the same as with the full picture.
 */
export function drawsSmall(
  small: { w: number } | undefined,
  frameW: number,
  step: number,
  pixelRatio: number,
): boolean {
  if (!small || small.w <= 0) return false;
  return frameW * step * pixelRatio <= small.w;
}

/**
 * WHERE A FLOATING PANEL GOES, BELOW OR ABOVE WHAT IT HANGS FROM: below when it fits above `bottom` (the window's edge, or
 * the top of chrome that sits over the canvas), else above. Shared by the tooltip (`canvas-tooltip.tsx`) and the comment box on a frame
 * (`canvas-frame.tsx`), so both keep their controls on screen the same way. Screen pixels.
 */
export function hangsBelow({
  anchorBottom,
  height,
  gap,
  bottom,
}: {
  anchorBottom: number;
  height: number;
  gap: number;
  bottom: number;
}): boolean {
  return anchorBottom + gap + height <= bottom;
}
