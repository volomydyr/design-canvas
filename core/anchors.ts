/**
 * design-canvas CORE — the `#anchor` a link to one section ends in.
 *
 * Made from the section ids the declaration already has, so a link needs no new field. An id can hold spaces,
 * capitals or punctuation (a by-kind section's id is `kind-` plus the kind's own words), and a URL fragment would
 * escape those. So an anchor keeps ASCII letters and digits, lowercased, with single dashes between the runs. Those
 * are the only characters that survive every place a link is opened, the shared page's sandboxed frame included.
 *
 * Unique within one canvas, and stable: an id that is already a clean anchor keeps itself, and the others are
 * resolved in the order given, a clash taking `-2`, `-3`. The same declaration always yields the same anchors.
 *
 * Shared by the canvas and by `review-build.mjs`, which bundles this file the way it bundles `variants.ts`, so a section
 * has the same anchor on the canvas and on the team page.
 */
import { layoutExplorations, layoutFlows, layoutKinds } from "./graph-layout";
import type { CanvasDeclaration } from "./types";

/** What an id cleans up to. Accents fold to their base letter; an id with nothing usable left is `section`. */
export function anchorOf(id: string): string {
  const cleaned = id
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "section";
}

/** One anchor per id, in the same order, no two alike. A repeated id is a separate entry and gets its own. */
export function sectionAnchors(ids: readonly string[]): string[] {
  const out: string[] = new Array(ids.length);
  const taken = new Set<string>();
  ids.forEach((id, index) => {
    if (anchorOf(id) === id && !taken.has(id)) {
      out[index] = id;
      taken.add(id);
    }
  });
  ids.forEach((id, index) => {
    if (out[index] !== undefined) return;
    const base = anchorOf(id);
    let anchor = base;
    for (let n = 2; taken.has(anchor); n += 1) anchor = `${base}-${n}`;
    out[index] = anchor;
    taken.add(anchor);
  });
  return out;
}

/** The anchor a URL's hash names, or null: `#Empty%20state` and `#empty-state` both read as `empty-state`. */
export function anchorFromHash(hash: string): string | null {
  let raw = hash.replace(/^#/, "");
  try {
    raw = decodeURIComponent(raw);
  } catch {
    /* A malformed escape is read as written. */
  }
  return raw ? anchorOf(raw) : null;
}

/**
 * Every section's anchor across the three views, flows first and explorations last: explorations are temporary, and
 * removing one must not move another section's anchor. Laid out from the whole declaration, not one device's, so a
 * section has one anchor on every device it is drawn on. Group ids do not depend on captured sizes.
 */
export function canvasSectionAnchors(
  declaration: CanvasDeclaration,
): { view: "flows" | "kinds" | "explore"; group: string; anchor: string }[] {
  const entries = (
    [
      ["flows", layoutFlows(declaration)],
      ["kinds", layoutKinds(declaration)],
      ["explore", layoutExplorations(declaration)],
    ] as const
  ).flatMap(([view, laid]) => laid.groups.map((group) => ({ view, group: group.id })));
  const anchors = sectionAnchors(entries.map((one) => one.group));
  return entries.map((one, index) => ({ ...one, anchor: anchors[index] }));
}
