/**
 * Route stub for the design-review canvas' comment file. Next's router requires a file here; the
 * handlers live in `design-canvas/core/comments-route.ts`, and 404 in production.
 *
 * DELETE WITH: the `design-canvas/` folder.
 */
export { DELETE, GET, PATCH, POST } from "../../../../design-canvas/core/comments-route";

/* Written here, not re-exported: Next reads a route's config from the route file itself, and Next 16 refuses a re-export. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
