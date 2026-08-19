/**
 * design-canvas CORE — serving the captured screens, and telling the capture script what to capture.
 *
 * DEV ONLY, 404 in production, like every other seam this tool has.
 *
 * Three answers on one route, because they are three views of the same thing:
 *
 *   ?screens=1   the declaration, resolved to real addresses and claims. The capture script reads THIS
 *                rather than parsing the declaration file, so the pictures can never be of a different set
 *                of screens than the canvas draws.
 *   ?id=<screen> the picture, with a long cache. Safe because the canvas asks for it with the shot's own
 *                content hash in the query, so a recapture is a different address.
 *   (nothing)    the manifest: what was captured, when, and what was proved about each one.
 *
 * Every one of them takes `?canvas=<slug>` as well, because a project can hold several canvases. The slug
 * namespaces the pictures on disk — `design-canvas/shots/<slug>/` — so two canvases cannot photograph over
 * each other's frames.
 *
 * The pictures live in `design-canvas/shots/`, beside the tool, so the whole thing is still one folder to
 * delete. They are never served from `public/`, which would put build output in the app's own static tree.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";

import {
  allScreens,
  canvasHidden,
  CANVAS_STATE_PARAM,
  type CanvasDeclaration,
  type CanvasRegistry,
  type CanvasShotManifest,
  DEFAULT_DEVICE,
  viewportFor,
} from "./types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SHOTS = path.join(process.cwd(), "design-canvas", "shots");

/** The address a screen is captured at: its route, plus the state flag when it pins one. */
export function screenUrl(route: string, state?: string): string {
  if (!state) return route;
  const separator = route.includes("?") ? "&" : "?";
  return `${route}${separator}${CANVAS_STATE_PARAM}=${encodeURIComponent(state)}`;
}

/**
 * One canvas or several, from the same argument.
 *
 * A single declaration is still accepted because the route stub in every project installed before canvases
 * were named passes exactly that, and the stubs are never overwritten by a re-install. An upgrade that
 * silently 500s every existing canvas would be a worse tool than one that reads both shapes.
 */
function registryOf(
  declarations: CanvasDeclaration | CanvasRegistry,
): CanvasRegistry {
  return "flows" in declarations
    ? { main: declarations as CanvasDeclaration }
    : (declarations as CanvasRegistry);
}

/**
 * Which canvas is being asked about. Named explicitly, or inferred when a project has only one — which keeps
 * every single-canvas URL and every existing script call working untouched. With several, a missing slug is
 * an error that lists them rather than a guess: guessing would serve one canvas's pictures under another
 * canvas's name, and the pictures all look plausible.
 */
function resolve(
  registry: CanvasRegistry,
  slug: string | null,
): { slug: string; declaration: CanvasDeclaration } | { error: string } {
  const names = Object.keys(registry);
  if (!slug) {
    if (names.length === 1)
      return { slug: names[0], declaration: registry[names[0]] };
    return {
      error: `This project has several canvases (${names.join(", ")}). Name one with ?canvas=<slug>.`,
    };
  }
  const declaration = registry[slug];
  if (!declaration)
    return {
      error: `No canvas called "${slug}". This project has: ${names.join(", ")}.`,
    };
  return { slug, declaration };
}

/**
 * Where a canvas's pictures are. The namespaced folder, falling back to the flat one so a canvas captured
 * before slugs existed keeps rendering until the next capture moves it.
 */
async function shotsDir(slug: string): Promise<string> {
  const namespaced = path.join(SHOTS, slug);
  try {
    await fs.access(path.join(namespaced, "manifest.json"));
    return namespaced;
  } catch {
    return SHOTS;
  }
}

async function manifest(slug: string): Promise<CanvasShotManifest | null> {
  try {
    return JSON.parse(
      await fs.readFile(path.join(await shotsDir(slug), "manifest.json"), "utf8"),
    );
  } catch {
    return null;
  }
}

/**
 * The route handler, given this project's canvases. They are passed IN rather than imported, so nothing in
 * `core/` knows which app it is looking at.
 */
export function shotsRoute(declarations: CanvasDeclaration | CanvasRegistry) {
  const registry = registryOf(declarations);
  return {
    GET: async (request: Request) => {
      /* Reading is what a deployed canvas is: see `canvasHidden`. */
      if (canvasHidden()) return new NextResponse("Not found", { status: 404 });
      const params = new URL(request.url).searchParams;

      const found = resolve(registry, params.get("canvas"));
      if ("error" in found)
        return NextResponse.json({ error: found.error }, { status: 400 });
      const { slug, declaration } = found;

      if (params.get("screens") === "1") {
        return NextResponse.json({
          canvas: slug,
          /* The canvas's own copy, so the copy checker can hold it to the same rules as everything else. */
          title: declaration.title,
          note: declaration.note,
          groups: declaration.flows.map((flow) => ({
            id: flow.id,
            title: flow.title,
            note: flow.note,
          })),
          viewport: declaration.viewport,
          /* The declared sections travel with the screens, because the oracle checks one against the other. */
          kinds: declaration.kinds ?? null,
          /* Both views: an exploration's directions are captured exactly like a flow's screens, or the
             comparison the whole tab exists for has nothing in its frames. */
          screens: allScreens(declaration).map(({ screen, view }) => ({
            id: screen.id,
            label: screen.label,
            view,
            /* Which section it was filed under. Served so the oracle can hold it against `kinds` above. */
            kind: screen.kind ?? null,
            /* The line under the frame. Served for the copy checker; nothing else downstream reads it. */
            note: screen.note,
            url: screenUrl(screen.route, screen.state),
            expect: screen.expect
              ? Array.isArray(screen.expect)
                ? screen.expect
                : [screen.expect]
              : [],
            expectMissing: screen.expectMissing
              ? Array.isArray(screen.expectMissing)
                ? screen.expectMissing
                : [screen.expectMissing]
              : [],
            expectSelector: screen.expectSelector ?? null,
            /**
             * A SCREEN'S OWN VIEWPORT, which this projection used to drop.
             *
             * `CanvasScreen.viewport` is the documented way to photograph one surface at a different size — a phone
             * among desktops, or a page that is simply longer than the shared height. The capture reads its screens
             * from this endpoint, so leaving the field out here meant the declaration could ask and nothing
             * downstream ever heard: two frames declared at 1240 and 1340 tall came back at 900. `null` when the
             * screen does not ask, so the capture falls back to the canvas-wide viewport above.
             */
            viewport: screen.viewport ?? null,
            /**
             * THE DEVICE, AND THE VIEWPORT THAT COMES WITH IT.
             *
             * The capture reads its screens from here, so a device declared and not served is a device the
             * capture never hears about — the same trap `viewport` fell into above, one field over. `viewport`
             * stays the screen's own override; `deviceViewport` is what its device is photographed at, already
             * resolved, so the capture does not need the declaration's `devices` map as well.
             */
            device: screen.device ?? DEFAULT_DEVICE,
            deviceViewport: viewportFor(screen, declaration),
            /* So the oracle can assert a twin resolves to a screen that exists. */
            twin: screen.twin ?? null,
            /* Served so the oracle can assert every one of them still exists on disk. */
            source: screen.source ?? [],
          })),
        });
      }

      const id = params.get("id");
      if (!id) {
        const file = await manifest(slug);
        return file
          ? NextResponse.json(file)
          : NextResponse.json(
              {
                error: `Nothing captured yet. Run: node design-canvas/capture.mjs --canvas ${slug}`,
              },
              { status: 404 },
            );
      }

      /* No path can be built from the query: the id has to be one this canvas actually names. */
      const known = allScreens(declaration).some(
        ({ screen }) => screen.id === id,
      );
      if (!known) return new NextResponse("Not found", { status: 404 });

      try {
        const bytes = await fs.readFile(
          path.join(await shotsDir(slug), `${id}.webp`),
        );
        return new NextResponse(new Uint8Array(bytes), {
          headers: {
            "content-type": "image/webp",
            /* Immutable is honest here: the canvas asks with the shot's content hash in the query, so a
               recaptured screen is a different URL rather than the same one with new bytes. */
            "cache-control": "public, max-age=31536000, immutable",
          },
        });
      } catch {
        return new NextResponse("Not captured", { status: 404 });
      }
    },
  };
}
