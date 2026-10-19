#!/usr/bin/env node
/**
 * design-canvas — the declaration, straight from source.
 *
 *   node design-canvas/dump-screens.mjs --canvas <slug> > screens.json
 *
 * The capture reads its declaration through `screensFor` (below), in process, from `project/flows.ts`: no server is needed,
 * so a capture against a production build (where the declaration route 404s) reads the same screens a dev capture does. The
 * shape is the one `/api/design-canvas/shots?screens=1` serves (`core/shots-route.ts`), so the oracle and the capture agree.
 * The declaration imports nothing that runs, so bundling it never executes app code.
 *
 * `--dir <a design-canvas folder>` reads that folder's declaration instead of this file's own (the installer judges a
 * project's declaration by the new version's rules this way), and `--list` prints the slugs the declaration holds, as JSON.
 * Every screen that declares `variants` is expanded into one frame per variant (`declarations.mjs`).
 *
 * DELETE WITH: the design-canvas/ folder.
 */
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { declarationFor, loadDeclarations, slugsOf } from "./declarations.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/* `screenUrl` and `viewportFor` in core/ are the source of truth for these two rules; they are inlined because this script
   runs under bare node with no TypeScript in reach. */
const CANVAS_STATE_PARAM = "canvas";
/* Null for an explanation frame (no route on purpose). */
const screenUrl = (route, state) =>
  !route
    ? null
    : state
      ? `${route}${route.includes("?") ? "&" : "?"}${CANVAS_STATE_PARAM}=${encodeURIComponent(state)}`
      : route;

/** The served shape of one declaration (also how `recapture.mjs` reads the frames it judges). */
export function project(declaration) {
  /* Both views: an exploration's directions are real routes and are captured like a flow's screens. */
  const groups = [
    ...declaration.flows.map((flow) => ({ ...flow, view: "flow" })),
    ...(declaration.explorations ?? []).map((one) => ({ ...one, view: "exploration" })),
  ];
  const deviceViewportFor = (screen) => screen.viewport ?? declaration.devices?.[screen.device ?? "desktop"] ?? declaration.viewport;
  const list = (value) => (value ? (Array.isArray(value) ? value : [value]) : undefined);
  const screens = groups.flatMap((group) =>
    group.screens.map((screen) => ({
      ...screen,
      flowId: group.id,
      view: group.view,
      deviceViewport: deviceViewportFor(screen),
      /* A wireframe's url is absolute (its own server): the route's `wireframeUrl` rule. */
      url: screen.wireframe
        ? /^https?:\/\//.test(screen.wireframe)
          ? screen.wireframe
          : `${(declaration.wireframeBase ?? "").replace(/\/$/, "")}/${screen.wireframe.replace(/^\//, "")}`
        : screenUrl(screen.route, screen.state),
      wireframe: Boolean(screen.wireframe),
      expect: list(screen.expect),
      expectMissing: list(screen.expectMissing),
      network: screen.network ?? [],
      /* Origins live on edges; the capture measures them per screen, so they are gathered onto their source screen. */
      origins: (group.edges ?? [])
        .filter((edge) => edge.from === screen.id && edge.origin)
        .map((edge) => ({ to: edge.to, origin: edge.origin })),
    })),
  );
  return {
    title: declaration.title,
    note: declaration.note,
    kinds: declaration.kinds ?? null,
    groups: declaration.flows.map((flow) => ({
      id: flow.id,
      title: flow.title,
      note: flow.note,
      groupedOnly: flow.groupedOnly ?? false,
      edges: (flow.edges ?? []).map((edge) => ({
        from: edge.from,
        to: edge.to,
        label: edge.label ?? null,
        origin: edge.origin ?? null,
        noOrigin: edge.noOrigin ?? null,
      })),
    })),
    successors: declaration.successors ?? {},
    viewport: declaration.viewport,
    forbid: declaration.forbid ?? [],
    network: declaration.network ?? [],
    explorations: (declaration.explorations ?? []).map((one) => ({
      id: one.id,
      original: one.original ?? null,
      ...(one.mode ? { mode: one.mode } : {}),
      directions: one.screens.filter((screen) => !screen.under && !screen.suggests).length,
      screens: one.screens.map((screen) => ({
        id: screen.id,
        under: screen.under ?? null,
        suggests: screen.suggests ?? null,
        marks: screen.marks ?? [],
        stickyOn: screen.stickyOn ?? null,
        evidence: screen.evidence ?? [],
        ...(screen.redesigns === undefined ? {} : { redesigns: screen.redesigns }),
      })),
    })),
    screens,
  };
}

async function load(canvasDir) {
  try {
    return await loadDeclarations(canvasDir);
  } catch (error) {
    throw new Error(`could not read ${path.join(canvasDir, "project", "flows.ts")}: ${String(error?.message ?? error).split("\n")[0]}`);
  }
}

/**
 * One canvas's declaration in the served shape, read from `<canvasDir>/project/flows.ts`. Throws one sentence when the file
 * cannot be read or names no such canvas; `slug` may be left out when the project declares one canvas.
 */
export async function screensFor(canvasDir, slug) {
  const picked = declarationFor(await load(canvasDir), slug);
  if (picked.error) throw new Error(picked.error);
  return project(picked.declaration);
}

/* Run as a command (not imported). Compared through realpath: a temp folder can be reached through a symlink. */
const isMain = (() => {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (isMain) {
  const argOf = (name) => {
    const at = process.argv.indexOf(`--${name}`);
    return at >= 0 ? process.argv[at + 1] : undefined;
  };
  let loaded;
  try {
    loaded = await load(argOf("dir") ? path.resolve(argOf("dir")) : HERE);
  } catch (error) {
    console.error(`dump-screens: ${error.message}`);
    process.exit(1);
  }
  if (process.argv.includes("--list")) {
    process.stdout.write(`${JSON.stringify(slugsOf(loaded))}\n`);
    process.exit(0);
  }
  const picked = declarationFor(loaded, argOf("canvas"));
  if (picked.error) {
    console.error(picked.error);
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify(project(picked.declaration), null, 2)}\n`);
}
