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
  type CanvasDeclaration,
  type CanvasRegistry,
  type CanvasShotManifest,
  DEFAULT_DEVICE,
  screenUrl,
  viewportFor,
} from "./types";
import { SYSTEM_ID, type SystemManifest } from "./system";
import { expandVariants } from "./variants";

/* Kept for route stubs written by earlier installs, which re-export these two. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SHOTS = path.join(process.cwd(), "design-canvas", "shots");
/** Other systems' screenshots a canvas shows beside its frames, one folder per canvas like the shots. */
const EVIDENCE = path.join(process.cwd(), "design-canvas", "evidence");
/** The design system tab's pictures and manifest. `_system` cannot be a canvas slug, so it never collides with one. */
const SYSTEM_SHOTS = path.join(process.cwd(), "design-canvas", "shots", "_system");

/* The capture address lives in types.ts, beside the Open button's, so the browser side can import it. */
export { screenUrl };

/**
 * The address a lo-fi WIREFRAME is captured at: absolute as declared, or its path joined onto the canvas's
 * `wireframeBase`. Always absolute on the way out, because the capture prefixes its own app base onto every
 * other screen's url and must not onto this one — the wireframe is served by a different process on purpose
 * (`CanvasScreen.wireframe`).
 */
export function wireframeUrl(wireframe: string, base?: string): string {
  if (/^https?:\/\//.test(wireframe)) return wireframe;
  const root = (base ?? "").replace(/\/$/, "");
  return `${root}/${wireframe.replace(/^\//, "")}`;
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
  let chosen: string;
  if (!slug) {
    if (names.length !== 1)
      return {
        error: `This project has several canvases (${names.join(", ")}). Name one with ?canvas=<slug>.`,
      };
    chosen = names[0];
  } else {
    if (!registry[slug])
      return {
        error: `No canvas called "${slug}". This project has: ${names.join(", ")}.`,
      };
    chosen = slug;
  }
  /* EVERY CONSUMER READS THE EXPANDED DECLARATION: a screen that declares `variants` is one frame per variant from here on, so
     the screens this route serves (which the capture and the oracle read) are the frames the canvas draws. A declaration
     whose variants cannot expand is an error that says so, not a 500. */
  try {
    return { slug: chosen, declaration: expandVariants(registry[chosen]) };
  } catch (error) {
    return { error: String((error as Error).message) };
  }
}

/** What `?screens=1` serves for an optional screen field the declaration leaves out. */
const SCREEN_DEFAULTS = {
  kind: null,
  soloKind: false,
  variantOf: null,
  variant: null,
  sticky: null,
  marks: [],
  evidence: [],
  explain: null,
  expectSelector: null,
  steps: [],
  brokenImages: false,
  sparse: false,
  animated: false,
  oneViewport: false,
  frozen: false,
  viewport: null,
  twin: null,
  source: [],
};

/** A claim field as a list: the capture treats both claim fields as lists. */
const toList = (value: string | string[] | undefined): string[] =>
  value ? (Array.isArray(value) ? value : [value]) : [];

async function manifest(slug: string): Promise<CanvasShotManifest | null> {
  try {
    return JSON.parse(
      await fs.readFile(path.join(SHOTS, slug, "manifest.json"), "utf8"),
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

      /**
       * THE DESIGN SYSTEM TAB: the manifest `system-capture.mjs` wrote, and its pictures. Like every other file here, no
       * path is built from the query: a picture is served only when the manifest names its set and its cell.
       */
      const systemSet = params.get("system");
      if (systemSet) {
        let manifest: SystemManifest | null = null;
        try {
          manifest = JSON.parse(await fs.readFile(path.join(SYSTEM_SHOTS, "manifest.json"), "utf8"));
        } catch {
          manifest = null;
        }
        if (systemSet === "1") return NextResponse.json(manifest ?? { missing: true });
        const cell = params.get("cell") ?? "";
        const known = manifest?.sets
          .find((set) => set.id === systemSet)
          ?.blocks.some((block) => cell in block.cells);
        if (!known || !SYSTEM_ID.test(systemSet)) return new NextResponse("Not found", { status: 404 });
        try {
          const bytes = await fs.readFile(path.join(SYSTEM_SHOTS, systemSet, `${cell.replace(/\//g, "--")}.png`));
          return new NextResponse(new Uint8Array(bytes), {
            headers: { "content-type": "image/png", "cache-control": "public, max-age=31536000, immutable" },
          });
        } catch {
          return new NextResponse("Not captured", { status: 404 });
        }
      }

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
            /* Whether this flow is a comparison set (drawn in the grouped view only). Served so the
               oracle's user-flow rule knows which groups claim to be journeys at all. */
            groupedOnly: flow.groupedOnly ?? false,
            /* The flow's own edges, so the oracle can judge each flow AS a flow: a "flow" whose every
               edge is a condition is a state chain wearing a flow's clothes — see the action-edge rule. */
            edges: flow.edges.map((edge) => ({
              from: edge.from,
              to: edge.to,
              label: edge.label ?? null,
              /* Both halves of the origin-completeness rule travel to the oracle: which press edges
                 declared where their press lives, and which declared why they cannot. */
              origin: edge.origin ?? null,
              noOrigin: edge.noOrigin ?? null,
            })),
          })),
          viewport: declaration.viewport,
          /* The declared sections travel with the screens, because the oracle checks one against the other. */
          kinds: declaration.kinds ?? null,
          /* The open questions, each naming the screen it departs from. Served so the oracle can enforce
             the original-first rule: every panel opens with today's design. */
          explorations: (declaration.explorations ?? []).map((one) => ({
            id: one.id,
            original: one.original ?? null,
            directions: one.screens.filter((screen) => !screen.under && !screen.suggests).length,
            /* Each screen's `under`, so the oracle can hold every step to an option in the SAME panel —
               the layout reports the orphan as a problem; the oracle makes it a failure. `suggests` and `marks`
               for the same reason: a suggestion must hang under a frame of its own panel, a highlight inside it. */
            screens: one.screens.map((screen) => ({
              id: screen.id,
              under: screen.under ?? null,
              suggests: screen.suggests ?? null,
              marks: screen.marks ?? [],
              stickyOn: screen.stickyOn ?? null,
              evidence: screen.evidence ?? [],
              /* What today's screen of the SAME state is, or null for nothing today. Left OUT of the JSON when
                 the declaration never said (undefined), which is what the oracle refuses — the projection trap
                 held this check silent for one whole run. */
              ...(screen.redesigns === undefined ? {} : { redesigns: screen.redesigns }),
            })),
          })),
          /* Canvas-wide forbidden text (overlay tripwire) — served, or the capture never hears of it. */
          forbid: declaration.forbid ?? [],
          /* What the capture does to the page's data on every frame (`CanvasDeclaration.network`, where `writes: "abort"` lives).
             Served, or the oracle's Open pass photographs a page whose saves are not aborted and never hears of a canvas-wide rule:
             the projection trap, once more. */
          network: declaration.network ?? [],
          /* Where a removed frame's comments go (`CanvasDeclaration.successors`). Served, or the capture cannot
             move them and the oracle cannot tell a homeless pin from one that has a place to land. */
          successors: declaration.successors ?? {},
          /* Both views: an exploration's directions are captured exactly like a flow's screens, or the
             comparison the whole tab exists for has nothing in its frames. */
          /**
           * EVERY DECLARED FIELD IS SERVED, because the capture and the oracle read their screens from here: a field copied
           * one by one is a field a new declaration option can be missing from, and then the capture never hears of it. Only
           * defaults (`SCREEN_DEFAULTS`) and what is computed or normalized are set here. Both views are served: an
           * exploration's directions are captured exactly like a flow's screens.
           */
          screens: allScreens(declaration).map(({ screen, view, groupId }) => ({
            ...SCREEN_DEFAULTS,
            ...Object.fromEntries(Object.entries(screen).filter(([, value]) => value !== undefined)),
            view,
            /* The group the frame is drawn in, so a comment moved to a successor frame is filed under it. */
            flowId: groupId,
            /* Null for an explanation frame (nothing to capture); absolute for a wireframe, which another process serves. */
            url: screen.wireframe
              ? wireframeUrl(screen.wireframe, declaration.wireframeBase)
              : screenUrl(screen.route, screen.state),
            wireframe: Boolean(screen.wireframe),
            still: Boolean(screen.still),
            explainKind: screen.explain ? (screen.explainKind ?? "outside") : null,
            expect: toList(screen.expect),
            expectMissing: toList(screen.expectMissing),
            network: screen.network ?? [],
            device: screen.device ?? DEFAULT_DEVICE,
            /* What the screen's device is photographed at, resolved, so the capture needs no `devices` map. */
            deviceViewport: viewportFor(screen, declaration),
            /* The declared origins of this screen's outgoing edges, which the capture measures. */
            origins: declaration.flows.flatMap((flow) =>
              flow.edges
                .filter((edge) => edge.from === screen.id && edge.origin)
                .map((edge) => ({ to: edge.to, origin: edge.origin! })),
            ),
          })),
        });
      }

      /**
       * AN EVIDENCE SCREENSHOT (`CanvasScreen.evidence`), from `design-canvas/evidence/<slug>/`. Like a shot, no
       * path is built from the query: the file has to be one a screen of this canvas names, so the route cannot be
       * walked out of its folder.
       */
      const evidenceFile = params.get("evidence");
      if (evidenceFile) {
        const named = allScreens(declaration).some(({ screen }) =>
          (screen.evidence ?? []).some((one) => one.file === evidenceFile),
        );
        if (!named || evidenceFile.includes("/") || evidenceFile.includes("\\"))
          return new NextResponse("Not found", { status: 404 });
        try {
          const bytes = await fs.readFile(path.join(EVIDENCE, slug, evidenceFile));
          const type = evidenceFile.endsWith(".png")
            ? "image/png"
            : evidenceFile.endsWith(".webp")
              ? "image/webp"
              : "image/jpeg";
          return new NextResponse(new Uint8Array(bytes), {
            headers: { "content-type": type, "cache-control": "no-cache" },
          });
        } catch {
          return new NextResponse("Not found", { status: 404 });
        }
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

      /* `size=small` is the quarter-scale copy the capture writes beside the picture. A shot without one is
         served full size under the same address, which is still the right picture. */
      const dir = path.join(SHOTS, slug);
      const small =
        params.get("size") === "small"
          ? await fs.readFile(path.join(dir, "small", `${id}.webp`)).catch(() => null)
          : null;
      try {
        const bytes = small ?? (await fs.readFile(path.join(dir, `${id}.webp`)));
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
