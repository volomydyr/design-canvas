/**
 * Route stub for the design-review canvas' captured screens. Next's router requires a file here; the
 * handler lives in `design-canvas/core/shots-route.ts` and 404s in production.
 *
 * The declarations are wired in HERE rather than imported by the handler, so nothing in `design-canvas/core/`
 * knows which project it is looking at. ALL of them are passed: the route resolves which canvas is being
 * asked about from `?canvas=<slug>`, and infers it when a project has only one.
 *
 * DELETE WITH: the `design-canvas/` folder.
 */
import { shotsRoute } from "../../../../design-canvas/core/shots-route";
import { CANVASES } from "../../../../design-canvas/project/flows";

export { dynamic, runtime } from "../../../../design-canvas/core/shots-route";

export const { GET } = shotsRoute(CANVASES);
