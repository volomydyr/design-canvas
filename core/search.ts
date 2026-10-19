/**
 * design-canvas CORE: finding a frame by name across every canvas in the project.
 *
 * Pure functions over the registry the page already passes down, so the matching and the ranking are tested
 * without a browser and the search needs no index on disk. Every canvas, every tab and every device is one list:
 * a phone frame on another canvas is found the same way as a desktop frame on this one.
 */

import {
  type CanvasDeclaration,
  type CanvasDevice,
  type CanvasRegistry,
  type CanvasScreen,
  DEFAULT_DEVICE,
} from "./types";
import { expandVariants } from "./variants";

/** The tabs that draw frames. The design system tab has none, so nothing on it can be found. */
export type SearchView = "kinds" | "flows" | "explore";

/** One place a frame is drawn: which canvas, which tab, which device, and under which section heading. */
export type SearchEntry = {
  canvas: string;
  canvasTitle: string;
  screenId: string;
  /** The flow or exploration the frame belongs to, which tells two drawings of one screen apart. */
  groupId: string;
  view: SearchView;
  device: CanvasDevice;
  label: string;
  state: string;
  /** The heading the frame sits under on that tab: its kind, its flow, or its exploration's surface. */
  section: string;
  note: string;
};

/** A canvas whose variants cannot expand is searched as declared, the same fallback the switcher uses. */
const expanded = (declaration: CanvasDeclaration) => {
  try {
    return expandVariants(declaration);
  } catch {
    return declaration;
  }
};

/**
 * Every place a frame is drawn, in declaration order. A flow screen is drawn on two tabs, so it has two entries:
 * the grouped one first, because that is the tab a canvas opens on, then the flow one.
 */
export function searchEntries(registry: CanvasRegistry): SearchEntry[] {
  const entries: SearchEntry[] = [];
  for (const [canvas, authored] of Object.entries(registry)) {
    const declaration = expanded(authored);
    const base = (screen: CanvasScreen, groupId: string) => ({
      canvas,
      canvasTitle: declaration.title,
      screenId: screen.id,
      groupId,
      device: screen.device ?? DEFAULT_DEVICE,
      label: screen.label,
      state: screen.state ?? "",
      note: screen.note ?? "",
    });
    for (const flow of declaration.flows) {
      for (const screen of flow.screens) {
        /* An explanation panel is text about a step, not a screen, and has nothing to land on. */
        if (screen.explain) continue;
        if (!screen.flowOnly)
          entries.push({ ...base(screen, flow.id), view: "kinds", section: screen.kind ?? "Other" });
        if (!flow.groupedOnly)
          entries.push({ ...base(screen, flow.id), view: "flows", section: flow.title });
      }
    }
    for (const exploration of declaration.explorations ?? [])
      for (const screen of exploration.screens)
        entries.push({ ...base(screen, exploration.id), view: "explore", section: exploration.surface });
  }
  return entries;
}

/** Lower case, accents folded, so "cafe" finds "Café". */
const fold = (text: string) =>
  text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** The fields a query is matched against, most telling first. Their order is their weight. */
const FIELDS = ["label", "state", "section", "note"] as const;

/**
 * How well one word matches one field: 4 the whole field, 3 its start, 2 the start of a word inside it,
 * 1 anywhere, 0 not at all. Words are split on anything that is not a letter or a digit, so "empty" finds the
 * state "trip-list-empty".
 */
export function matchQuality(field: string, word: string): number {
  const text = fold(field);
  if (!word || !text.includes(word)) return 0;
  if (text === word) return 4;
  if (text.startsWith(word)) return 3;
  for (let at = text.indexOf(word); at !== -1; at = text.indexOf(word, at + 1))
    if (!/[\p{L}\p{N}]/u.test(text[at - 1])) return 2;
  return 1;
}

/**
 * The score of one entry, or 0 when any word of the query is missing from all of its fields. The field outranks
 * the quality: a frame NAMED by the query comes before a frame whose section or caption merely mentions it.
 */
export function scoreEntry(entry: SearchEntry, query: string): number {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;
  let total = 0;
  for (const word of words) {
    let best = 0;
    FIELDS.forEach((field, rank) => {
      const quality = matchQuality(entry[field], word);
      if (quality > 0) best = Math.max(best, (FIELDS.length - rank) * 10 + quality);
    });
    if (best === 0) return 0;
    total += best;
  }
  return total;
}

/**
 * The frames matching a query, best first, one result per frame per canvas.
 *
 * A screen drawn on two tabs keeps its better-scoring drawing, so "booking" lands on the Booking flow rather than
 * on the kind the same screen is filed under; on a tie it keeps the tab the reviewer is on, so a search never
 * switches tabs without a reason. Equal scores put the open canvas first, then declaration order.
 */
export function searchScreens(
  entries: SearchEntry[],
  query: string,
  here: { canvas?: string; view?: string } = {},
  limit = 50,
): SearchEntry[] {
  const best = new Map<string, { entry: SearchEntry; score: number; order: number }>();
  entries.forEach((entry, order) => {
    const score = scoreEntry(entry, query);
    if (score === 0) return;
    const key = `${entry.canvas}\u0000${entry.screenId}`;
    const held = best.get(key);
    const better =
      !held ||
      score > held.score ||
      (score === held.score &&
        entry.canvas === here.canvas &&
        entry.view === here.view &&
        held.entry.view !== here.view);
    if (better) best.set(key, { entry, score, order: held ? Math.min(held.order, order) : order });
  });
  return [...best.values()]
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(b.entry.canvas === here.canvas) - Number(a.entry.canvas === here.canvas) ||
        a.order - b.order,
    )
    .slice(0, limit)
    .map((one) => one.entry);
}
