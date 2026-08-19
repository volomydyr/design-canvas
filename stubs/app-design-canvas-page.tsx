/**
 * Route stub for the design-review canvas index, at `/design-canvas`. Next's router requires a file here;
 * everything the tool is lives in `design-canvas/` at the repo root, so it can be deleted in one move.
 *
 * THE ROUTE IS NAMED AFTER THE FOLDER, and both are named after the tool. It used to be `/dev/canvas` in a
 * `dev-canvas/` folder, which was two names for one thing and neither of them the tool's: "now that we use
 * the name design-canvas for the skill and put all its contents under this folder, I think we should also use
 * a proper URL." It is still dev-only — the page 404s under `NODE_ENV=production`.
 *
 * This page lists the project's canvases; each one lives at `/design-canvas/<slug>`, rendered by the sibling
 * `[canvas]/page.tsx`.
 *
 * Relative rather than through a path alias, so this works in a repo whose tsconfig does not have one.
 *
 * DELETE WITH: the `design-canvas/` folder.
 */
import { CanvasIndex } from "../../design-canvas/canvas-page";
import { CANVASES } from "../../design-canvas/project/flows";

export default function DesignCanvasIndexPage() {
  return <CanvasIndex canvases={CANVASES} />;
}
