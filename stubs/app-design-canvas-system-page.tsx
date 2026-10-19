"use client";
/**
 * Route stub for the design system's specimen page, at `/design-canvas/system/<set>`. Next's router requires a file
 * here; the page itself lives in `design-canvas/core/system-specimen.tsx`, and the sets in
 * `design-canvas/project/system.tsx`. Nobody reviews this page: `system-capture.mjs` photographs it.
 *
 * A CLIENT PAGE, because each set renders its cells with functions, and functions do not cross from server to client.
 *
 * DELETE WITH: the `design-canvas/` folder.
 */
import { SystemSpecimen } from "../../../../design-canvas/core/system-specimen";
import { SYSTEM } from "../../../../design-canvas/project/system";

export default function DesignCanvasSystemPage() {
  return <SystemSpecimen system={SYSTEM} />;
}
