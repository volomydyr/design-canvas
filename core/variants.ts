/**
 * design-canvas CORE — VARIANTS OF ONE COMPONENT, declared once and expanded into one frame each.
 *
 * WHY THIS EXISTS. Comparing four, five or six variants of one component means one in-app route that reads `?variant=` and one
 * frame per value. An agent hand-built that URL switch three times in one session (4, 5 and 6 variants), declaring every frame
 * by hand with a route, an id, a label and a claim each, and keeping them in step by hand when a variant was added. The
 * declaration can say it once:
 *
 *   { id: "filter", label: "Filter Bar", note: "...", route: "/lab/filter", variants: ["chips", "tabs", "menu"] }
 *   { id: "filter", label: "Filter Bar", note: "...", route: "/lab/filter", variants: 4 }          // 1, 2, 3, 4
 *
 * and the declaration EXPANDS, in place, into one real screen per variant, each a route of the app like any other:
 *
 *   id       `filter-chips`, `filter-tabs`, `filter-menu` (or `filter-1` to `filter-4`)
 *   route    `/lab/filter?variant=chips`
 *   label    `Filter Bar Chips` (Title Case, so it obeys the copy rules an author would have written by hand)
 *   kind, note, source, state, steps, expect and everything else: inherited from the declaration that named the variants
 *
 * Because each variant is an ordinary screen after the expansion, it is captured, stamped, claimed, commented on and opened
 * exactly like one, and the frames sit together in whichever group the declaration was in: the exploration's panel (side by side,
 * numbered), a flow, or the grouped screens' section. Every consumer reads the EXPANDED declaration (the route, the viewer, the
 * dump the capture and the preflight read, the share page), through this one function, so none of them can disagree about what
 * a variants screen means.
 *
 * `{variant}` IN A CLAIM: `expect`, `expectMissing` and `expectSelector` may contain it, and each frame gets its own variant's
 * name there, so one declaration can prove every frame shows ITS variant (`expect: ["Variant {variant}"]`).
 *
 * WHAT IT REFUSES, all named in one line: a count under two or over `MAX_VARIANTS`, a name that is not a lowercase URL-safe word,
 * a duplicate, a screen with no route of the app (a wireframe, an explanation, a still), a route that already carries
 * `?variant=`, and a `twin` (one twin cannot answer several frames). Everything else the declaration says is a screen's own
 * business and is checked by the rules that check every screen.
 *
 * NOTHING HERE IMPORTS FROM THE PROJECT, and the only import is a type: this file is bundled bare by the tools that read the
 * declaration from source (`dump-screens.mjs`), which run under plain node.
 */
import type { CanvasDeclaration, CanvasScreen } from "./types";

/** The query key a variant travels on. The app's own component route reads it; the core only appends it. */
export const CANVAS_VARIANT_PARAM = "variant";

/** The most variants one screen may declare: past it the comparison is a wall, and a typo in a count would photograph hundreds. */
export const MAX_VARIANTS = 12;

/** A variant name is a URL value and a piece of a screen id at once: lowercase letters, digits and dashes. */
const VARIANT_NAME = /^[a-z0-9][a-z0-9-]*$/;

/**
 * The variant names a screen declares, in order: the list as written, or `"1"` to `"N"` for a count. Throws one sentence naming
 * the screen and what is wrong. `id` is only for that sentence.
 */
export function variantNames(spec: unknown, id: string): string[] {
  if (typeof spec === "number") {
    if (!Number.isInteger(spec) || spec < 2 || spec > MAX_VARIANTS)
      throw new Error(`screen "${id}": variants as a count must be a whole number from 2 to ${MAX_VARIANTS}, got ${spec}`);
    return Array.from({ length: spec }, (_, at) => String(at + 1));
  }
  if (!Array.isArray(spec))
    throw new Error(`screen "${id}": variants must be a list of names or a count, like ["a", "b", "c"] or 4`);
  if (spec.length < 2 || spec.length > MAX_VARIANTS)
    throw new Error(`screen "${id}": variants must hold from 2 to ${MAX_VARIANTS} names (one variant is just a screen), got ${spec.length}`);
  const seen = new Set<string>();
  for (const name of spec) {
    if (typeof name !== "string" || !VARIANT_NAME.test(name))
      throw new Error(`screen "${id}": the variant ${JSON.stringify(name)} is not a lowercase word of letters, digits and dashes (it is part of the frame's id and of its URL)`);
    if (seen.has(name)) throw new Error(`screen "${id}": the variant "${name}" is listed twice`);
    seen.add(name);
  }
  return [...spec];
}

/** The route with `?variant=<name>` added, after whatever query the route already has. */
export function variantRoute(route: string, name: string): string {
  return `${route}${route.includes("?") ? "&" : "?"}${CANVAS_VARIANT_PARAM}=${encodeURIComponent(name)}`;
}

/** `chips` to `Chips`, `two-row` to `Two Row`, `3` to `3`: the piece of a label that says which variant this frame is. */
function labelPiece(name: string): string {
  return name
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

const fill = (text: string, name: string) => text.split("{variant}").join(name);

/** One declaration of variants, as the screens it stands for. */
function expandScreen(screen: CanvasScreen): CanvasScreen[] {
  const id = screen.id;
  const names = variantNames(screen.variants, id);
  if (!screen.route || screen.wireframe || screen.explain)
    throw new Error(`screen "${id}": variants need a route of the app (a wireframe, a still or an explanation frame has nothing to pass ?${CANVAS_VARIANT_PARAM}= to)`);
  if (new RegExp(`[?&]${CANVAS_VARIANT_PARAM}=`).test(screen.route))
    throw new Error(`screen "${id}": its route already carries ?${CANVAS_VARIANT_PARAM}=, and the variants add it: drop it from the route`);
  if (screen.twin)
    throw new Error(`screen "${id}": a variants screen cannot declare a twin (one twin cannot answer ${names.length} frames): declare the twin on the frame it belongs to`);
  /* The declaration that named the variants is not itself a frame: every field but `variants` is inherited by each of them. */
  const rest: CanvasScreen = { ...screen };
  delete rest.variants;
  return names.map((name) => {
    const claim = (value: string | string[] | undefined) =>
      value === undefined ? undefined : Array.isArray(value) ? value.map((one) => fill(one, name)) : fill(value, name);
    return {
      ...rest,
      id: `${id}-${name}`,
      label: `${screen.label} ${labelPiece(name)}`,
      route: variantRoute(screen.route as string, name),
      ...(screen.expect === undefined ? {} : { expect: claim(screen.expect) }),
      ...(screen.expectMissing === undefined ? {} : { expectMissing: claim(screen.expectMissing) }),
      ...(screen.expectSelector === undefined ? {} : { expectSelector: fill(screen.expectSelector, name) }),
      variantOf: id,
      variant: name,
    };
  });
}

/**
 * THE DECLARATION WITH EVERY VARIANTS SCREEN EXPANDED, in place, inside whichever flow or exploration held it. A declaration
 * with no `variants` anywhere comes back as the SAME object, so a caller that memoizes on it is not disturbed. One that throws
 * throws one sentence listing every screen it could not expand.
 */
export function expandVariants(declaration: CanvasDeclaration): CanvasDeclaration {
  const groups = [...declaration.flows, ...(declaration.explorations ?? [])];
  if (!groups.some((group) => group.screens.some((screen) => screen.variants !== undefined))) return declaration;
  const problems: string[] = [];
  const expandAll = (screens: CanvasScreen[]): CanvasScreen[] =>
    screens.flatMap((screen) => {
      if (screen.variants === undefined) return [screen];
      try {
        return expandScreen(screen);
      } catch (error) {
        problems.push(String((error as Error).message));
        return [screen];
      }
    });
  const flows = declaration.flows.map((flow) => ({ ...flow, screens: expandAll(flow.screens) }));
  const explorations = declaration.explorations?.map((one) => ({ ...one, screens: expandAll(one.screens) }));
  if (problems.length > 0) throw new Error(`${problems.length} screen(s) declare variants that cannot expand: ${problems.join("; ")}`);
  return { ...declaration, flows, ...(explorations ? { explorations } : {}) };
}
