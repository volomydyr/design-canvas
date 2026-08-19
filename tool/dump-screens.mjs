#!/usr/bin/env node
/**
 * design-canvas — the declaration, straight from source.
 *
 *   node design-canvas/dump-screens.mjs > screens.json
 *
 * WHY THIS EXISTS. `capture.mjs` normally reads the declaration from the running app
 * (`/api/design-canvas/shots?screens=1`), so the pictures can never be of a different set of screens than the
 * canvas draws. That route is dev-only and 404s under `NODE_ENV=production` — and captures have to be taken
 * against a production build, because `next dev` compiles each route inside the capture's own load budget and
 * makes the run a lottery.
 *
 * The first way round that was to dump the JSON from a dev server and pass it with `--screens-file`. That
 * works exactly once: the snapshot goes stale the moment the declaration is edited, and a stale snapshot fails
 * in the most confusing way available — the capture reports a claim the declaration no longer makes. It cost
 * one debugging round in the project this came from.
 *
 * So the declaration is read from the FILE, every time, with no server involved at all. `flows.ts` is plain
 * data that imports nothing but a type, which is the property the declaration was given on purpose, and that
 * is what makes this a five-line transpile rather than a parser.
 *
 * DELETE WITH: the design-canvas/ folder.
 */
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { transformSync } from "esbuild";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const source = path.join(HERE, "project", "flows.ts");

/* Types are erased and the one `import type` goes with them, so nothing has to be resolved. */
const js = transformSync(readFileSync(source, "utf8"), {
  loader: "ts",
  format: "esm",
  target: "node18",
}).code;

const dir = mkdtempSync(path.join(tmpdir(), "canvas-screens-"));
const file = path.join(dir, "flows.mjs");
writeFileSync(file, js);

const mod = await import(`file://${file}`);

/**
 * WHICH CANVAS. A project can hold several, keyed by the slug that addresses them, so the dump has to be told
 * which one — `--canvas <slug>` — unless there is only one to choose from.
 *
 * The registry is read first and a bare declaration second, so a project that has not been upgraded to
 * `CANVASES` still dumps exactly as it did before.
 */
const argOf = (name) => {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : undefined;
};

const registry = Object.values(mod).find(
  (value) =>
    value &&
    typeof value === "object" &&
    !Array.isArray(value.flows) &&
    Object.values(value).some((one) => one && Array.isArray(one.flows)),
);
const bare = Object.values(mod).find(
  (value) => value && typeof value === "object" && Array.isArray(value.flows),
);

const wanted = argOf("canvas");
let declaration = null;
if (registry) {
  const names = Object.keys(registry);
  if (wanted) {
    declaration = registry[wanted];
    if (!declaration) {
      console.error(
        `No canvas called "${wanted}" in ${source}. This project has: ${names.join(", ")}.`,
      );
      process.exit(1);
    }
  } else if (names.length === 1) {
    declaration = registry[names[0]];
  } else {
    console.error(
      `${source} declares several canvases (${names.join(", ")}). Name one with --canvas <slug>.`,
    );
    process.exit(1);
  }
} else {
  declaration = bare;
}

if (!declaration) {
  console.error(
    `No canvas declaration found in ${source} — expected a \`CANVASES\` record, or an export with a \`flows\` array.`,
  );
  process.exit(1);
}

/**
 * THE SAME SHAPE THE ROUTE RETURNS, so `--screens-file` and the route are interchangeable — and the field
 * that matters is `url`, not `route`. `capture.mjs` navigates to `screen.url`, which is the route with the
 * pinned state appended as `?canvas=<id>`; a dump that only carried `route` sent it to
 * "http://localhost:3055undefined". `screenUrl` in `core/shots-route.ts` is the one that composes it, and
 * this is deliberately the same three lines rather than an import, because that module is TypeScript in the
 * app's path alias and this script must run with no build step.
 */
const CANVAS_STATE_PARAM = "canvas";
const screenUrl = (route, state) =>
  state
    ? `${route}${route.includes("?") ? "&" : "?"}${CANVAS_STATE_PARAM}=${encodeURIComponent(state)}`
    : route;

/* Both views. An exploration's directions are real routes and are captured exactly like a flow's screens; a
   dump that skipped them would leave the third tab drawing empty frames. */
const groups = [
  ...declaration.flows.map((flow) => ({ ...flow, view: "flow" })),
  ...(declaration.explorations ?? []).map((one) => ({
    ...one,
    view: "exploration",
  })),
];

/**
 * THE VIEWPORT A SCREEN'S DEVICE IS PHOTOGRAPHED AT, resolved here as well as in the route.
 *
 * There are two ways the capture learns what to photograph: the screens endpoint when it runs against a dev
 * server, and THIS FILE when it runs against a production build — which is how `capture-run.mjs` always runs it.
 * `...screen` carried `device` and `twin` for free and this one field was computed rather than declared, so a
 * phone screen went through a production capture at the desktop viewport and came out 1440 wide, identical to
 * its desktop twin. Measured on the first phone frame ever declared.
 *
 * `viewportFor` in core/types.ts is the source of truth for this rule; these three lines are it, inlined,
 * because this script runs under bare node with no TypeScript in reach.
 */
const deviceViewportFor = (screen) =>
  screen.viewport ??
  declaration.devices?.[screen.device ?? "desktop"] ??
  declaration.viewport;

const screens = groups.flatMap((group) =>
  group.screens.map((screen) => ({
    ...screen,
    flowId: group.id,
    view: group.view,
    deviceViewport: deviceViewportFor(screen),
    url: screenUrl(screen.route, screen.state),
    /* Normalised the way the route normalises it: capture treats both claim fields as lists. */
    expect: screen.expect
      ? Array.isArray(screen.expect)
        ? screen.expect
        : [screen.expect]
      : undefined,
    expectMissing: screen.expectMissing
      ? Array.isArray(screen.expectMissing)
        ? screen.expectMissing
        : [screen.expectMissing]
      : undefined,
  })),
);
process.stdout.write(
  `${JSON.stringify({ viewport: declaration.viewport, screens }, null, 2)}\n`,
);
