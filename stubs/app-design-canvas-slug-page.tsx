/**
 * Route stub for ONE canvas, at `/design-canvas/<slug>`. Next's router requires a file here; the canvas
 * itself lives in `design-canvas/` at the repo root.
 *
 * The slug is the whole of the separation between a project's canvases: it addresses this page, and it
 * namespaces the shots and the comments so two canvases cannot photograph over each other's frames or mix
 * their reviews. An unknown slug 404s.
 *
 * A SERVER COMPONENT WRAPPING A CLIENT ONE, on purpose. `params` is a plain object in Next 14 and a promise in
 * Next 15; awaiting it is correct in both (awaiting a non-promise yields the value), and it keeps the version
 * difference in this one-line stub instead of inside the tool.
 *
 * DELETE WITH: the `design-canvas/` folder.
 */
import { CanvasPage } from "../../../design-canvas/canvas-page";
import { CANVASES } from "../../../design-canvas/project/flows";

export default async function DesignCanvasPage({
  params,
}: {
  params: { canvas: string } | Promise<{ canvas: string }>;
}) {
  const { canvas } = await params;
  return <CanvasPage canvases={CANVASES} canvas={canvas} />;
}
