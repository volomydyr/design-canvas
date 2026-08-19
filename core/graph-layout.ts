/**
 * design-canvas CORE — turning a declared graph into positions on an infinite canvas.
 *
 * Nothing here knows what a screen IS. It takes nodes with sizes and edges between them and returns
 * world coordinates, so the same layout serves this app's flows and any other repo's.
 *
 * WHY A LAYOUT AND NOT HAND-PLACED FRAMES. A diagram whose positions are written by hand goes stale the
 * first time a screen is added, and a stale diagram is worse than none: it draws a journey the product
 * no longer has. So the declaration says only what connects to what, and the picture is derived. Adding
 * a screen and its edge is one entry; the diagram re-lays itself around it.
 *
 * The algorithm is a small layered (Sugiyama-style) layout, in three passes:
 *
 *   RANK   every node gets a column: one further right than the furthest thing that leads to it
 *          (longest path). An edge that would close a cycle is left out of this pass, since a flow with a
 *          loop in it is not a DAG.
 *   ROW    within a column, a node sits as close as it can to the middle of whatever leads to it, and
 *          takes the nearest free row when that is taken. This is what makes a branch read as a branch:
 *          the spine stays straight and the things that leave it fan out above and below.
 *   PLACE  columns are as wide as their widest frame, rows as tall as their tallest, plus a gap big
 *          enough to draw an edge and its label in without either touching a frame.
 */

import type {
  CanvasDeclaration,
  CanvasEdge,
  CanvasFlow,
  CanvasScreen,
} from "./types";
import { DEFAULT_DEVICE, viewportFor } from "./types";

/* ---------------------------------------------------------------- world metrics
   World units are canvas pixels: at zoom 1 one world unit is one screen pixel. These are geometry, not
   style — the colours, type sizes and radii of everything drawn in this space come from the app's
   tokens in the components that render it. */

/** Between a frame's right edge and the next column. Wide enough for an edge label to sit clear. */
const COLUMN_GAP = 380;

/**
 * WHAT A FRAME'S CAPTION OCCUPIES ABOVE IT, and every vertical gap on the canvas is derived from it.
 *
 * A caption is three lines — name, what it is for, where it lives — and the frame it belongs to has to leave
 * room for all three. Guessing a row gap instead of deriving it is how the group titles ended up printed on
 * top of the first row's captions: two numbers that had to agree, in two files, with nothing keeping them
 * honest. Change the type scale in canvas-frame.tsx and this is the one number that follows it.
 */
const CAPTION_SPACE = 90;
/** And what the developer's line under a frame occupies. */
const FOOT_SPACE = 92;
/** Air between one row's foot and the next row's caption. */
const EDGE_LANE = 210;
/** Above a group: its own title, then air. */
const TITLE_SPACE = 300;
/** Between one flow and the next. Big enough that two diagrams never read as one. */
/**
 * The vertical space between two sections, in world pixels.
 *
 * EXPORTED because the exploration heading has to clear it by more than a section clears its neighbour — the
 * owner, on a heading that sat 430 above the first section: _"it's way too close to the first section. It has to
 * be vertically more far away than the distance between the sections themselves."_ Reading it from here rather
 * than copying the number is what stops the two drifting the next time either is tuned.
 */
export const FLOW_GAP = 560;
/** Rows in the by-kind view, which has no edges and so needs only enough room to compare frames. */
const KIND_GAP = 150;
/**
 * ROUGHLY HOW WIDE ONE CHARACTER OF A PANEL HEADING IS, in world pixels.
 *
 * The heading is set at `GROUP_SIZE` (132px, `canvas-view.tsx`) in the bold display face, and this layout has no
 * DOM to measure with — it runs before anything is drawn. Measured off a rendered panel: 51 characters spanned
 * about 3060 world px, so ~0.46 of the font size per character. Rounded UP, because a panel slightly wider than
 * its heading is invisible while a panel narrower than its heading is the bug this fixes: with one frame in a
 * section the title ran clean out of the panel and across the stage — the owner: *"you can see here when the
 * name is longer than the available section because of just a few screenshots… it does not fit, which makes it
 * look weird. The section can grow if the name is longer than the contents of the screenshots."*
 */
const TITLE_CHAR_W = 62;

/**
 * A PANEL IS NEVER NARROWER THAN ITS OWN NAME, in any of the three views.
 *
 * This guard existed and was applied in exactly one place, the exploration layout, so the same bug came straight
 * back the first time a flow held one narrow frame: a phone group titled "Share menu and Customize Page" with a
 * single 312px frame in it, and the heading running clean off the panel and across the stage. The owner, twice
 * now: *"The section can never be smaller than the name. And I think we already handled it in the skill but I'm
 * not sure how it happened here."*
 *
 * So it is a function, and every layout that builds a group box calls it. A panel slightly wider than its heading
 * is invisible; a panel narrower than its heading is the bug.
 */
function atLeastTitleWide(width: number, title: string): number {
  return Math.max(width, title.length * TITLE_CHAR_W);
}

export type LaidOutNode = {
  screen: CanvasScreen;
  /**
   * The flow or exploration this frame sits in. It was the `CanvasFlow` itself, and became a pair of
   * strings when a frame could belong to an exploration instead — which has no edges and is not a journey.
   * Only the id and the title were ever read off it: a React key, and the group recorded on a comment.
   */
  group: { id: string; title: string };
  /** World position of the frame's top-left corner. */
  x: number;
  y: number;
  w: number;
  h: number;
  rank: number;
  row: number;
  /** Exploration only: a frame drawn UNDER a direction rather than being one. See `CanvasScreen.under`. */
  supporting?: boolean;
};

export type LaidOutEdge = CanvasEdge & {
  /** Resolved endpoints in world coordinates, already offset for edges that share a pair. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** The whole path, built by the router. An edge knows its own shape; the view only draws it. */
  d: string;
  /** Where the label goes. On a straight hop that is the middle of the curve; on a long one, the middle of
   *  the lane it travels along, which is the only part of it with room for a chip. */
  mx: number;
  my: number;
  /** True when it could not go straight across and had to travel round. */
  longWay: boolean;
};

export type LaidOutGroup = {
  id: string;
  title: string;
  note: string;
  nodes: LaidOutNode[];
  edges: LaidOutEdge[];
  /** The group's own bounding box, title space included. What "zoom to this flow" zooms to. */
  box: Box;
};

export type Box = { x: number; y: number; w: number; h: number };

export type Layout = {
  groups: LaidOutGroup[];
  /** Everything, so the canvas can fit the whole thing in one press. */
  box: Box;
  /** Declared edges whose ends do not resolve. Reported on the canvas rather than silently dropped. */
  problems: string[];
};

/**
 * The size a screen's frame takes on the canvas, in world units.
 *
 * MEASURED FROM THE CAPTURE when there is one. A long page is captured whole, so its picture is several
 * viewports tall, and a layout that assumed one viewport would reserve a quarter of the room its own frames
 * need and overlap everything below them. The declaration's viewport is only the fallback for a screen that has
 * never been captured.
 */
export function frameSize(
  screen: CanvasScreen,
  declaration: CanvasDeclaration,
  captured?: (id: string) => { w: number; h: number } | undefined,
): { w: number; h: number } {
  const shot = captured?.(screen.id);
  const view = shot ?? viewportFor(screen, declaration);
  return {
    w: Math.round(view.w * declaration.frameScale),
    h: Math.round(view.h * declaration.frameScale),
  };
}

/**
 * HOW WIDE A PHONE FRAME'S CAPTION AND FOOT ARE ALLOWED TO BE, in world units.
 *
 * A phone frame is about 312 world pixels wide, and everything a frame carries around it was designed against a
 * desktop's 1152: the name at 42, the line under it, the Open pill, the source chips, and in an exploration the
 * two verdicts. At 312 all of that stacks into a column of wrapped fragments. The owner named the problem
 * exactly: *"the structure of the mobile screenshot has to be slightly rethinked because it won't be able to
 * cover everything that the desktop screenshot currently does … So we need to think how to adapt it on the
 * canvas so that we don't lose any functionality and we don't make it look weird or very different from the
 * desktop one, but at the same time we make it fit properly."*
 *
 * NOTHING IS DROPPED AND NOTHING SHRINKS. The chrome keeps its type scale and its controls, and is simply
 * allowed to be wider than the picture it belongs to — which is space a tall narrow frame has going spare
 * anyway. The layout reserves it here, in the same function the frame reads, so the two cannot disagree; a
 * caption that overhung a column it was not measured into is how frames end up printed over each other.
 */
export const PHONE_CHROME_W = 700;

/** The horizontal room a screen occupies: its picture, or its chrome when the chrome is wider. */
export function chromeWidth(
  screen: CanvasScreen,
  declaration: CanvasDeclaration,
  captured?: (id: string) => { w: number; h: number } | undefined,
): number {
  const frame = frameSize(screen, declaration, captured).w;
  return (screen.device ?? DEFAULT_DEVICE) === "phone"
    ? Math.max(frame, PHONE_CHROME_W)
    : frame;
}

/** How the layout is told what was captured. Absent for a project with nothing captured yet. */
export type CapturedSizes = (
  id: string,
) => { w: number; h: number } | undefined;

/* ------------------------------------------------------------------- ranking */

/**
 * Which edges may be counted when ranking: everything except the ones declared `back`, minus any that
 * would close a cycle. Found by a depth-first walk — an edge into a node already on the current path is
 * a cycle-closer, and treating it as forward would make the ranks never settle.
 */
function forwardEdges(flow: CanvasFlow, ids: Set<string>): CanvasEdge[] {
  const candidates = flow.edges.filter(
    (edge) => ids.has(edge.from) && ids.has(edge.to),
  );
  const out = new Map<string, CanvasEdge[]>();
  for (const edge of candidates)
    out.set(edge.from, [...(out.get(edge.from) ?? []), edge]);

  const kept: CanvasEdge[] = [];
  const state = new Map<string, "open" | "done">();
  const walk = (id: string) => {
    state.set(id, "open");
    for (const edge of out.get(id) ?? []) {
      if (state.get(edge.to) === "open") continue; // closes a cycle: not a step forward
      kept.push(edge);
      if (!state.has(edge.to)) walk(edge.to);
    }
    state.set(id, "done");
  };
  for (const screen of flow.screens) if (!state.has(screen.id)) walk(screen.id);
  return kept;
}

/** One column further right than the furthest thing that leads here. */
function rankNodes(
  flow: CanvasFlow,
  forward: CanvasEdge[],
): Map<string, number> {
  const rank = new Map<string, number>(
    flow.screens.map((screen) => [screen.id, 0]),
  );
  /* Longest path, relaxed until nothing moves. Bounded by the node count, because a DAG cannot need
     more passes than it has nodes. */
  for (let pass = 0; pass < flow.screens.length + 1; pass += 1) {
    let moved = false;
    for (const edge of forward) {
      const next = (rank.get(edge.from) ?? 0) + 1;
      if (next > (rank.get(edge.to) ?? 0)) {
        rank.set(edge.to, next);
        moved = true;
      }
    }
    if (!moved) break;
  }
  return rank;
}

/**
 * A row for every node: as near as possible to the middle of whatever leads to it, and the nearest free
 * row when that one is taken. Walked in column order so a node's parents are always placed first.
 */
function rowNodes(
  flow: CanvasFlow,
  forward: CanvasEdge[],
  rank: Map<string, number>,
): Map<string, number> {
  const incoming = new Map<string, string[]>();
  for (const edge of forward)
    incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge.from]);

  const row = new Map<string, number>();
  const takenPerRank = new Map<number, Set<number>>();
  const ordered = [...flow.screens].sort(
    (a, b) =>
      (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0) ||
      flow.screens.indexOf(a) - flow.screens.indexOf(b),
  );

  for (const screen of ordered) {
    const column = rank.get(screen.id) ?? 0;
    const taken = takenPerRank.get(column) ?? new Set<number>();
    const parents = (incoming.get(screen.id) ?? [])
      .map((id) => row.get(id))
      .filter((value): value is number => value !== undefined);
    const wanted =
      parents.length > 0
        ? Math.round(
            parents.reduce((sum, value) => sum + value, 0) / parents.length,
          )
        : 0;
    /* Nearest free row to the one it wants, searched outwards — below, above, below — so a branch lands
       beside its parent rather than at the bottom of the column. Rows may go negative: a branch above
       the spine is as ordinary as one below it, and the columns are laid out from the rows that exist. */
    let chosen = wanted;
    for (let step = 0; taken.has(chosen); step += 1) {
      chosen =
        wanted + (step % 2 === 0 ? step / 2 + 1 : -(Math.floor(step / 2) + 1));
    }
    taken.add(chosen);
    takenPerRank.set(column, taken);
    row.set(screen.id, chosen);
  }
  return row;
}

/* ------------------------------------------------------------------- placing */

function placeNodes(
  flow: CanvasFlow,
  declaration: CanvasDeclaration,
  captured: CapturedSizes | undefined,
  rank: Map<string, number>,
  row: Map<string, number>,
  originY: number,
  /** How much room a frame's caption needs above it. Zero in a flow, which draws no titles. */
  captionSpace: number,
): LaidOutNode[] {
  const sizes = new Map(
    flow.screens.map((screen) => [
      screen.id,
      frameSize(screen, declaration, captured),
    ]),
  );

  /* Columns are as wide as their widest frame and rows as tall as their tallest, so a phone frame among
     desktop ones neither overlaps its neighbour nor leaves a hole. */
  const columnWidth = new Map<number, number>();
  const rowHeight = new Map<number, number>();
  for (const screen of flow.screens) {
    const size = sizes.get(screen.id)!;
    const column = rank.get(screen.id) ?? 0;
    const line = row.get(screen.id) ?? 0;
    /* The CHROME's width, not the picture's: a phone frame is narrower than the name and the controls it
       carries, and a column measured on the picture alone would have them printed over its neighbour. */
    columnWidth.set(
      column,
      Math.max(columnWidth.get(column) ?? 0, chromeWidth(screen, declaration, captured)),
    );
    rowHeight.set(line, Math.max(rowHeight.get(line) ?? 0, size.h));
  }

  const columnX = new Map<number, number>();
  let x = 0;
  for (const column of [...columnWidth.keys()].sort((a, b) => a - b)) {
    columnX.set(column, x);
    x += columnWidth.get(column)! + COLUMN_GAP;
  }
  const rowY = new Map<number, number>();
  let y = originY + TITLE_SPACE + captionSpace;
  for (const line of [...rowHeight.keys()].sort((a, b) => a - b)) {
    rowY.set(line, y);
    y += rowHeight.get(line)! + FOOT_SPACE + captionSpace + EDGE_LANE;
  }

  return flow.screens.map((screen) => {
    const size = sizes.get(screen.id)!;
    const column = rank.get(screen.id) ?? 0;
    const line = row.get(screen.id) ?? 0;
    return {
      screen,
      group: { id: flow.id, title: flow.title },
      x: columnX.get(column)!,
      /* Centred in its row, so a shorter frame in a tall row still reads as being on that line. */
      y: rowY.get(line)! + (rowHeight.get(line)! - size.h) / 2,
      w: size.w,
      h: size.h,
      rank: column,
      row: line,
    };
  });
}

/* --------------------------------------------------------------------- edges */

/** How far apart two edges joining the SAME pair of frames are pulled, so both are visible. */
const PARALLEL_SPREAD = 46;
/** How far under the bottom row the first bypass lane runs. */
const LANE_OFFSET = 150;
/** And how far apart two lanes are. */
const LANE_PITCH = 90;

/**
 * NO EDGE MAY EVER CROSS A FRAME. That is the rule, and it is enforced by geometry rather than by choosing
 * declarations that happen to look alright.
 *
 * A frame only ever occupies its own column, so an edge between NEIGHBOURING columns can always be drawn
 * straight across the gap between them: there is nothing in a gap to cross. The problem is an edge that spans
 * two columns or more — `a set page → a piece page` skips the column holding the category, collection and search
 * pages — and drawn as one curve it goes straight over whatever is in between. That is the overlap.
 *
 * So an edge that cannot go straight across takes THE LONG WAY: down out of the bottom of its frame, along a
 * clear lane under the whole diagram, and up into the bottom of the frame it lands on. Each long edge gets its
 * own lane, so two of them cannot sit on top of each other either. It reads like a bypass, which is what it is,
 * and `check-canvas.mjs` samples every path and fails if any point of it lands inside a frame it does not
 * belong to.
 */
function routeEdges(
  flow: CanvasFlow,
  nodes: LaidOutNode[],
  problems: string[],
): { edges: LaidOutEdge[]; lanes: number; deepest: number } {
  const at = new Map(nodes.map((node) => [node.screen.id, node]));
  const bottom =
    nodes.length > 0 ? Math.max(...nodes.map((node) => node.y + node.h)) : 0;

  /* Edges sharing a pair are spread apart: two different answers that land on the same screen are two
     different edges, and drawing them on top of each other hides one. */
  const pairIndex = new Map<string, number>();
  const pairCount = new Map<string, number>();
  for (const edge of flow.edges) {
    const key = `${edge.from}->${edge.to}`;
    pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
  }

  const out: LaidOutEdge[] = [];
  let lanes = 0;
  /* How far the deepest bypass reaches, so the group's box ends under it rather than under a guess. */
  let deepest = 0;
  const laneAtDepth = new Map<number, number>();

  for (const edge of flow.edges) {
    const from = at.get(edge.from);
    const to = at.get(edge.to);
    if (!from || !to) {
      problems.push(
        `${flow.id}: edge ${edge.from} → ${edge.to} names a screen this flow does not have`,
      );
      continue;
    }
    const key = `${edge.from}->${edge.to}`;
    const index = pairIndex.get(key) ?? 0;
    pairIndex.set(key, index + 1);
    const count = pairCount.get(key) ?? 1;
    /* Centred spread: one edge sits on the line, two straddle it, three put one on it. */
    const offset = (index - (count - 1) / 2) * PARALLEL_SPREAD;

    const straight = to.rank - from.rank === 1;

    if (straight) {
      const x1 = from.x + from.w;
      const y1 = from.y + from.h / 2 + offset;
      const x2 = to.x;
      const y2 = to.y + to.h / 2 + offset;
      const reach = Math.max(120, (x2 - x1) * 0.5);
      const c1x = x1 + reach;
      const c2x = x2 - reach;
      out.push({
        ...edge,
        x1,
        y1,
        x2,
        y2,
        d: `M ${x1} ${y1} C ${c1x} ${y1}, ${c2x} ${y2}, ${x2} ${y2}`,
        ...midpoint(x1, y1, c1x, y1, c2x, y2, x2, y2),
        longWay: false,
      });
      continue;
    }

    /**
     * The long way round, in a lane of its own, AS SHALLOW AS THE BYPASS ALLOWS.
     *
     * The lane used to sit under the WHOLE diagram (`bottom`, the lowest frame anywhere in the flow), which is
     * far deeper than any bypass needs: in the domain flow, one edge skipping a single column on the spine dived
     * past four branch frames stacked below it and back up, and the empty band it opened under the diagram was
     * most of the group's height — the owner, of exactly that: *"where does this big
     * empty spacing come from in the canvas?"*
     *
     * A bypass can only ever cross frames in the columns it PASSES OVER, its own two included, so it only has to
     * clear those. Frames in any other column are nowhere near the lane: the horizontal run spans exactly the
     * columns between the two ends. So the depth is measured over that span, and a spine-to-spine bypass now runs
     * just under the spine. `check-canvas.mjs` samples every path against every frame, so if this were ever too
     * shallow the oracle fails rather than the picture quietly overlapping.
     */
    const lowRank = Math.min(from.rank, to.rank);
    const highRank = Math.max(from.rank, to.rank);
    const spanBottom = Math.max(
      ...nodes
        .filter((node) => node.rank >= lowRank && node.rank <= highRank)
        .map((node) => node.y + node.h),
    );
    /* One lane per bypass at the same depth, so two of them cannot sit on top of each other; bypasses at
       different depths are already apart. */
    const atDepth = laneAtDepth.get(spanBottom) ?? 0;
    laneAtDepth.set(spanBottom, atDepth + 1);
    const lane = spanBottom + LANE_OFFSET + atDepth * LANE_PITCH;
    deepest = Math.max(deepest, lane);
    lanes += 1;
    const x1 = from.x + from.w / 2 + offset;
    const y1 = from.y + from.h;
    const x2 = to.x + to.w / 2 + offset;
    const y2 = to.y + to.h;
    const bend = 90;
    out.push({
      ...edge,
      x1,
      y1,
      x2,
      y2,
      d:
        `M ${x1} ${y1} C ${x1} ${y1 + bend}, ${x1} ${lane - bend}, ${x1 + Math.sign(x2 - x1) * bend} ${lane} ` +
        `L ${x2 - Math.sign(x2 - x1) * bend} ${lane} ` +
        `C ${x2} ${lane}, ${x2} ${lane - bend}, ${x2} ${y2}`,
      /* On the lane itself, which is the only stretch with room for a chip. */
      mx: (x1 + x2) / 2,
      my: lane,
      longWay: true,
    });
  }
  return { edges: out, lanes, deepest };
}

/** The point at t = 0.5 on a cubic, which is where a label belongs. */
function midpoint(
  x1: number,
  y1: number,
  c1x: number,
  c1y: number,
  c2x: number,
  c2y: number,
  x2: number,
  y2: number,
): { mx: number; my: number } {
  return {
    mx: (x1 + 3 * c1x + 3 * c2x + x2) / 8,
    my: (y1 + 3 * c1y + 3 * c2y + y2) / 8,
  };
}

/* --------------------------------------------------------------------- views */

function boxOf(
  nodes: LaidOutNode[],
  originY: number,
  deepestLane = 0,
  title = "",
): Box {
  if (nodes.length === 0) return { x: 0, y: originY, w: 0, h: TITLE_SPACE };
  const left = Math.min(...nodes.map((node) => node.x));
  const right = Math.max(...nodes.map((node) => node.x + node.w));
  const bottom = Math.max(...nodes.map((node) => node.y + node.h));
  /* The foot line under the bottom row belongs to the group, and so does any bypass lane that runs below it —
     measured from where the deepest one actually is, since a bypass between two columns of the spine no longer
     dives under the whole diagram to get there. */
  const foot = Math.max(bottom + FOOT_SPACE, deepestLane + LANE_PITCH);
  return {
    x: left,
    y: originY,
    w: atLeastTitleWide(right - left, title),
    h: foot - originY,
  };
}

function totalBox(groups: LaidOutGroup[]): Box {
  if (groups.length === 0) return { x: 0, y: 0, w: 1000, h: 1000 };
  const x = Math.min(...groups.map((group) => group.box.x));
  const y = Math.min(...groups.map((group) => group.box.y));
  const right = Math.max(...groups.map((group) => group.box.x + group.box.w));
  const bottom = Math.max(...groups.map((group) => group.box.y + group.box.h));
  return { x, y, w: right - x, h: bottom - y };
}

/** THE FLOW VIEW: every flow as its own diagram, stacked down the canvas with room between them. */
export function layoutFlows(
  declaration: CanvasDeclaration,
  captured?: CapturedSizes,
): Layout {
  const problems: string[] = [];
  const groups: LaidOutGroup[] = [];
  let originY = 0;

  for (const flow of declaration.flows) {
    /* Comparison sets are not journeys: see `groupedOnly` on CanvasFlow. */
    if (flow.groupedOnly) continue;
    const ids = new Set(flow.screens.map((screen) => screen.id));
    const forward = forwardEdges(flow, ids);
    const rank = rankNodes(flow, forward);
    const row = rowNodes(flow, forward, rank);
    /* No captions in a flow, so no room is kept for them: the arrows do the explaining. */
    const nodes = placeNodes(
      flow,
      declaration,
      captured,
      rank,
      row,
      originY,
      0,
    );
    const routed = routeEdges(flow, nodes, problems);
    const edges = routed.edges;
    const box = boxOf(nodes, originY, routed.deepest, flow.title);
    groups.push({
      id: flow.id,
      title: flow.title,
      note: flow.note,
      nodes,
      edges,
      box,
    });
    originY = box.y + box.h + FLOW_GAP;
  }

  return { groups, box: totalBox(groups), problems };
}

/**
 * THE BY-KIND VIEW: the same frames regrouped by what they ARE, one row per kind, no edges.
 *
 * Kept because it answers the opposite question to the flow view. Flow order scatters near-identical
 * states across the canvas and hides the inconsistencies between them; a row of every empty state side
 * by side is how the disagreements show.
 */
export function layoutKinds(
  declaration: CanvasDeclaration,
  captured?: CapturedSizes,
): Layout {
  const byKind = new Map<
    string,
    Array<{ screen: CanvasScreen; flow: CanvasFlow }>
  >();
  for (const flow of declaration.flows) {
    for (const screen of flow.screens) {
      const kind = screen.kind ?? "Other";
      byKind.set(kind, [...(byKind.get(kind) ?? []), { screen, flow }]);
    }
  }

  /**
   * A GROUP OF ONE IS NOT A GROUP, and neither is a bucket of leftovers. An earlier version swept every kind
   * with a single member into a group called "One of a kind", which is a heading over things that have nothing
   * to do with each other — a group in name only. The fix belongs in the declaration: every `kind` there has at
   * least two screens in it, and `check-canvas.mjs` fails if that ever stops being true.
   *
   * THE ORDER IS THE DECLARATION'S ORDER, deliberately. A kind takes its place from the first flow it appears
   * in, so the groups run in the same sequence as the journeys do — teaching before setup, setup before the
   * menu, the owner-facing surfaces before the customer-facing ones. Sorting by size or by name would scramble that into
   * something arbitrary, which is exactly how it read before.
   */
  const ordered = [...byKind.entries()];

  const groups: LaidOutGroup[] = [];
  let originY = 0;
  for (const [kind, items] of ordered) {
    let x = 0;
    const top = originY + TITLE_SPACE + CAPTION_SPACE;
    let tallest = 0;
    const nodes: LaidOutNode[] = items.map(({ screen, flow }, index) => {
      const size = frameSize(screen, declaration, captured);
      const node: LaidOutNode = {
        screen,
        group: { id: flow.id, title: flow.title },
        x,
        y: top,
        w: size.w,
        h: size.h,
        rank: index,
        row: 0,
      };
      x += Math.max(size.w, chromeWidth(screen, declaration, captured)) + KIND_GAP;
      tallest = Math.max(tallest, size.h);
      return node;
    });
    groups.push({
      id: `kind-${kind}`,
      title: kind,
      note: `${items.length} screens of the same kind, side by side`,
      nodes,
      edges: [],
      box: {
        x: 0,
        y: originY,
        w: atLeastTitleWide(Math.max(0, x - KIND_GAP), kind),
        h: top + tallest + FOOT_SPACE - originY,
      },
    });
    originY = top + tallest + FOOT_SPACE + FLOW_GAP;
  }

  return { groups, box: totalBox(groups), problems: [] };
}

/**
 * THE EXPLORATION VIEW: one panel per question, one frame per direction, side by side.
 *
 * Deliberately the same shape as `layoutKinds` — a titled panel holding a row of frames — because the job is
 * the same job. Options are judged by being next to each other at a size where they can actually be read,
 * which is what a row of full-size frames on a pannable surface is for, and what a grid of thumbnails is not.
 *
 * NO EDGES, EVER. Directions are alternatives: an arrow between two of them would say a person can move from
 * one to the other, and only one of them will ever exist. The panel says "these are answers to one
 * question"; nothing else needs saying.
 *
 * A ROUND IS AN ENTRY, NOT A NESTING LEVEL. Five directions is one exploration; three variants of whichever
 * won is a second exploration under it. That keeps the funnel legible as it narrows — the earlier round stays
 * on the canvas next to the later one, so what was rejected is still visible while the survivor is being
 * refined — and it costs no extra layout: the panels simply stack in declaration order.
 */
export function layoutExplorations(
  declaration: CanvasDeclaration,
  captured?: CapturedSizes,
): Layout {
  const groups: LaidOutGroup[] = [];
  const problems: string[] = [];
  let originY = 0;

  for (const exploration of declaration.explorations ?? []) {
    /* A PANEL OF ONE IS THE END OF THE FUNNEL, NOT A FAULT. This reported a problem for every narrowed round,
       which is the round the whole exercise exists to reach. The owner, on that last leg: *"it has to be the
       selection of what I like the most and the comments applied to what I like the most, so that I could
       iterate on it until it's really good and I completely approve it."* The oracle's twin of this rule went
       with it, and so did the verdict buttons on a lone option. */

    /**
     * ONE COLUMN PER DIRECTION: its main frame, then whatever supports it, stacked under it.
     *
     * A direction is what gets compared, and some directions need more than one picture to be understood — see
     * `CanvasScreen.under`. So the row is a row of COLUMNS: the mains line up along the top, where they can be
     * read against each other, and each column grows downwards on its own.
     */
    const mains = exploration.screens.filter((screen) => !screen.under);
    const supportersOf = (id: string) =>
      exploration.screens.filter((screen) => screen.under === id);
    for (const screen of exploration.screens)
      if (screen.under && !mains.some((main) => main.id === screen.under))
        problems.push(
          `exploration ${exploration.id}: "${screen.id}" sits under "${screen.under}", which is not a direction in it`,
        );

    let x = 0;
    const top = originY + TITLE_SPACE + CAPTION_SPACE;
    let tallest = 0;
    const nodes: LaidOutNode[] = [];
    mains.forEach((main, index) => {
      const size = frameSize(main, declaration, captured);
      nodes.push({
        screen: main,
        group: { id: exploration.id, title: exploration.title },
        x,
        y: top,
        w: size.w,
        h: size.h,
        rank: index,
        row: 0,
      });
      /* The column's own width is the widest thing in it, so the next direction never lands on this one. */
      let columnW = Math.max(size.w, chromeWidth(main, declaration, captured));
      let y = top + size.h + FOOT_SPACE + CAPTION_SPACE;
      supportersOf(main.id).forEach((support, depth) => {
        const supportSize = frameSize(support, declaration, captured);
        nodes.push({
          screen: support,
          group: { id: exploration.id, title: exploration.title },
          x,
          y,
          w: supportSize.w,
          h: supportSize.h,
          rank: index,
          row: depth + 1,
          supporting: true,
        });
        columnW = Math.max(
          columnW,
          supportSize.w,
          chromeWidth(support, declaration, captured),
        );
        y += supportSize.h + FOOT_SPACE + CAPTION_SPACE;
      });
      x += columnW + KIND_GAP;
      tallest = Math.max(tallest, y - FOOT_SPACE - CAPTION_SPACE - top);
    });

    groups.push({
      id: `explore-${exploration.id}`,
      /**
       * THE SURFACE IS THE HEADING, and the question is the line under it.
       *
       * It was the question alone, and a reviewer opening the canvas cold met "Where does a sync run live?"
       * above five pictures without being told what page they were looking at. Naming the screen first is what
       * makes the options judgeable: what is this, then which version of it.
       */
      title: exploration.surface,
      note: [exploration.round, exploration.title, exploration.note]
        .filter(Boolean)
        .join(" · "),
      nodes,
      edges: [],
      box: {
        x: 0,
        y: originY,
        /* The wider of the two: the frames inside, or the heading over them. */
        w: atLeastTitleWide(Math.max(0, x - KIND_GAP), exploration.surface),
        h: top + tallest + FOOT_SPACE - originY,
      },
    });
    originY = top + tallest + FOOT_SPACE + FLOW_GAP;
  }

  return { groups, box: totalBox(groups), problems };
}
