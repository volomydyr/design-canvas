/**
 * design-canvas core: turns a declared graph into world positions on the canvas.
 *
 * It knows only nodes with sizes and edges between them, and positions are derived rather than hand-placed,
 * so adding a screen and its edge re-lays the diagram. A small layered (Sugiyama-style) layout in three passes:
 *
 *   Rank   each node sits one column right of the furthest node leading to it (longest path); edges that
 *          would close a cycle are left out of this pass.
 *   Row    a node sits nearest the middle of its parents, so the spine stays straight and branches fan out.
 *   Place  columns as wide as their widest frame, rows as tall as their tallest, plus room for edges and labels.
 */

import type {
  CanvasDeclaration,
  CanvasEdge,
  CanvasFlow,
  CanvasScreen,
} from "./types";
import { DEFAULT_DEVICE, viewportFor } from "./types";
import { remarkRoom } from "./remarks-layout";

/* ---------------------------------------------------------------- world metrics
   World units are canvas pixels: at zoom 1 one world unit is one screen pixel. */

/** Between a frame's right edge and the next column. Wide enough for an edge label to sit clear. */
const COLUMN_GAP = 380;

/**
 * Height of a frame's three-line caption above it; every vertical gap on the canvas is derived from it.
 * It must follow the caption type scale in canvas-frame.tsx.
 */
const CAPTION_SPACE = 90;
/** Height of the line under a frame. */
const FOOT_SPACE = 92;
/** Air between one row's foot and the next row's caption. */
const EDGE_LANE = 210;
/** Above a group: its own title, then air. */
const TITLE_SPACE = 300;
/** Vertical space between two groups, in world pixels: big enough that two diagrams never read as one. */
export const FLOW_GAP = 560;
/** Rows in the by-kind view, which has no edges and so needs only enough room to compare frames. */
const KIND_GAP = 150;
/** How far a suggestion hangs below the frame above it: the frame's own chrome, then a clear gap. */
const SUGGEST_DROP = 90;
/**
 * Estimated width of one heading character in world pixels, at `GROUP_SIZE` (132px, `canvas-view.tsx`) bold.
 * The layout runs before anything is drawn, so it cannot measure; rounded up so a heading never overruns its panel.
 */
const TITLE_CHAR_W = 62;

/** A panel is never narrower than its heading and link button; every layout that builds a group box calls this. */
function atLeastTitleWide(width: number, title: string): number {
  return Math.max(width, title.length * TITLE_CHAR_W + TITLE_LINK_GAP + TITLE_LINK_SIZE);
}

/**
 * The link button after every heading, in world pixels: the gap before it and its diameter. Exported because the
 * canvas draws it and this layout keeps room for it.
 */
export const TITLE_LINK_GAP = 36;
export const TITLE_LINK_SIZE = 96;

export type LaidOutNode = {
  screen: CanvasScreen;
  /** The flow or exploration this frame sits in, used as a React key and as the group recorded on a comment. */
  group: { id: string; title: string };
  /** World position of the frame's top-left corner. */
  x: number;
  y: number;
  w: number;
  h: number;
  rank: number;
  /** Exploration only: this option's spoken number, 1-based. Absent on the incumbent and on an option's later steps. */
  option?: number;
  /** Exploration only: the panel's first frame is today's design, drawn as reference. See `CanvasExploration.original`. */
  incumbent?: boolean;
  /**
   * Exploration only: the id of the screen this frame's switch flips to, its own `redesigns`. Absent on the
   * incumbent and on a frame that declared `redesigns: null` (nothing like it exists today), which draw no switch.
   */
  today?: string;
  /** Exploration only: a later step of an option's flow rather than an option of its own. See `CanvasScreen.under`. */
  supporting?: boolean;
  /** Exploration only: a suggestion drawn under the frame it proposes to change (`CanvasScreen.suggests`). Never numbered. */
  suggestion?: boolean;
  /** Flows only: this node is an explanation panel, not a picture. See `CanvasScreen.explain`. */
  explain?: boolean;
};

export type LaidOutEdge = CanvasEdge & {
  /** The whole path, built by the router. An edge knows its own shape; the view only draws it. */
  d: string;
  /** Where the label goes. On a straight hop that is the middle of the curve; on a long one, the middle of
   *  the lane it travels along, which is the only part of it with room for a chip. */
  mx: number;
  my: number;
  /** True when it could not go straight across and had to travel round. */
  longWay: boolean;
  /**
   * The interaction-origin ring in world coordinates: the capture's picture-pixel rectangle mapped onto the frame.
   * Set only when the capture measured it, so an unmeasured origin draws nothing rather than a guess.
   */
  originBox?: Box;
  /** The path re-anchored to start at the ring's border, drawn instead of `d` when the mode is on. */
  dOrigin?: string;
  /** Where the label goes while the highlights mode is on, computed on the re-anchored path so it stays on its line. */
  mxOrigin?: number;
  myOrigin?: number;
};

export type LaidOutGroup = {
  id: string;
  title: string;
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
  /** Declaration faults found while laying out. Only the tests read them; the canvas does not show them. */
  problems: string[];
};

/**
 * The size a screen's frame takes on the canvas, in world units. Taken from the capture when there is one, since
 * a long page is captured whole and is several viewports tall; the declared viewport is the fallback.
 */
export function frameSize(
  screen: CanvasScreen,
  declaration: CanvasDeclaration,
  captured?: (id: string) => { w: number; h: number } | undefined,
): { w: number; h: number } {
  /* An explanation frame is a text panel with no capture, so it takes the panel's fixed size. */
  if (screen.explain)
    return (screen.explainKind ?? "").startsWith("canvas:")
      ? { ...BOUNDARY_SIZE }
      : { ...EXPLAIN_SIZE };
  const shot = captured?.(screen.id);
  const view = shot ?? viewportFor(screen, declaration);
  return {
    w: Math.round(view.w * declaration.frameScale),
    h: Math.round(view.h * declaration.frameScale),
  };
}

/**
 * The fixed size of an explanation panel, in world units: room for a step name and a few sentences, and
 * narrower than any screen frame so a flow reads as screens with notes between them.
 */
export const EXPLAIN_SIZE = { w: 460, h: 280 };

/** A boundary card is taller than the other explanation panels because it also carries the Open Canvas button. */
export const BOUNDARY_SIZE = { w: 460, h: 360 };

/**
 * How wide a phone frame's caption and foot may be, in world units. The chrome keeps the desktop type scale and
 * controls and may overhang the narrow picture; the layout reserves that width here, in the function the frame
 * reads, so the two cannot disagree.
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

/** One interaction-origin rectangle as the capture measured it, in picture pixels. See `CanvasEdge.origin`. */
export type CapturedOrigin = {
  to: string;
  origin: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

/** How the layout is told what was captured. Absent for a project with nothing captured yet. `origins`
 *  rides along so the flow view can place the interaction-origin rings in world coordinates. */
export type CapturedSizes = (
  id: string,
) => { w: number; h: number; origins?: CapturedOrigin[] } | undefined;

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
  /* Longest path, relaxed until nothing moves; a DAG never needs more passes than it has nodes. */
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
     desktop ones neither overlaps its neighbor nor leaves a hole. */
  const columnWidth = new Map<number, number>();
  const rowHeight = new Map<number, number>();
  for (const screen of flow.screens) {
    const size = sizes.get(screen.id)!;
    const column = rank.get(screen.id) ?? 0;
    const line = row.get(screen.id) ?? 0;
    /* The chrome's width, not the picture's: a phone frame's name and controls are wider than its picture. */
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
      ...(screen.explain ? { explain: true } : {}),
    };
  });
}

/* --------------------------------------------------------------------- edges */

/** How far apart two edges joining the same pair of frames are pulled, so both are visible. */
const PARALLEL_SPREAD = 46;
/** How far under the bottom row the first bypass lane runs. */
const LANE_OFFSET = 150;
/** And how far apart two lanes are. */
const LANE_PITCH = 90;

/**
 * No edge may cross a frame. An edge between neighboring columns goes straight across the gap; one that skips
 * columns (a trip list straight to a trip page) takes the long way: down out of its frame, along its own lane under
 * the columns it spans, and up into the target. `check-canvas.mjs` fails any path that enters a frame not its own.
 */
function routeEdges(
  flow: CanvasFlow,
  nodes: LaidOutNode[],
  problems: string[],
  captured?: CapturedSizes,
): { edges: LaidOutEdge[]; deepest: number } {
  const at = new Map(nodes.map((node) => [node.screen.id, node]));

  /**
   * The interaction-origin ring for one edge in world coordinates: the captured picture-pixel rectangle scaled by
   * `node.w / shot.w`. Matched on target and spec, so two controls opening the same target each find their own.
   */
  const originBoxOf = (edge: CanvasEdge): Box | undefined => {
    if (!edge.origin) return undefined;
    const node = at.get(edge.from);
    const shot = captured?.(edge.from);
    const measured = shot?.origins?.find(
      (one) => one.to === edge.to && one.origin === edge.origin,
    );
    if (!node || !shot || !measured || shot.w <= 0) return undefined;
    /**
     * Clamped into the frame, and dropped when it does not intersect it, so a ring never floats beside its frame
     * (an older manifest can still carry an out-of-picture rectangle). A dropped ring keeps the ordinary anchor.
     */
    const scale = node.w / shot.w;
    const box = {
      x: node.x + measured.x * scale,
      y: node.y + measured.y * scale,
      w: measured.w * scale,
      h: measured.h * scale,
    };
    if (
      box.x >= node.x + node.w ||
      box.y >= node.y + node.h ||
      box.x + box.w <= node.x ||
      box.y + box.h <= node.y
    )
      return undefined;
    box.x = Math.max(box.x, node.x);
    box.y = Math.max(box.y, node.y);
    box.w = Math.min(box.w, node.x + node.w - box.x);
    box.h = Math.min(box.h, node.y + node.h - box.y);
    return box;
  };
  /* Edges sharing a pair are spread apart, since drawn on top of each other one would hide the other. */
  const pairIndex = new Map<string, number>();
  const pairCount = new Map<string, number>();
  for (const edge of flow.edges) {
    const key = `${edge.from}->${edge.to}`;
    pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
  }

  const out: LaidOutEdge[] = [];
  /* One candidate list per edge, in `out` order: every spot a label may sit, all of them on the edge's
     own path. First entry is the preferred midpoint; the rest walk outward either side of it. */
  const labelTracks: Array<{
    main: Array<[number, number]>;
    origin?: Array<[number, number]>;
  }> = [];
  /** A curve straight across the gap, and the spots on it where its label may sit (the middle first). */
  const curve = (x1: number, y1: number, x2: number, y2: number) => {
    const reach = Math.max(120, (x2 - x1) * 0.5);
    const [c1x, c2x] = [x1 + reach, x2 - reach];
    const at = (t: number): [number, number] => {
      const u = 1 - t;
      return [
        u * u * u * x1 + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x2,
        u * u * u * y1 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y2,
      ];
    };
    return {
      d: `M ${x1} ${y1} C ${c1x} ${y1}, ${c2x} ${y2}, ${x2} ${y2}`,
      track: [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74, 0.18, 0.82].map(at),
    };
  };
  /** The long way: down, along the lane, up into the target; its label spots sit on the lane. */
  const BEND = 90;
  const lane = (x1: number, y1: number, x2: number, y2: number, laneY: number) => {
    const lo = Math.min(x1, x2) + BEND + 60;
    const hi = Math.max(x1, x2) - BEND - 60;
    const mid = (x1 + x2) / 2;
    return {
      d:
        `M ${x1} ${y1} C ${x1} ${y1 + BEND}, ${x1} ${laneY - BEND}, ${x1 + Math.sign(x2 - x1) * BEND} ${laneY} ` +
        `L ${x2 - Math.sign(x2 - x1) * BEND} ${laneY} ` +
        `C ${x2} ${laneY}, ${x2} ${laneY - BEND}, ${x2} ${y2}`,
      track: [0, 260, -260, 520, -520, 780, -780, 1040, -1040]
        .map((step) => Math.min(Math.max(mid + step, lo), hi))
        .filter((x, index, all) => all.indexOf(x) === index)
        .map((x) => [x, laneY] as [number, number]),
    };
  };
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

    /* The highlight, when this edge declares an origin the capture measured. */
    const originBox = originBoxOf(edge);

    /* With a measured origin the path also gets a variant that starts at the ring's border (straight: its right
       edge; the long way: its bottom), drawn while the highlights mode is on. */
    let main;
    let fromOrigin;
    if (straight) {
      const x2 = to.x;
      const y2 = to.y + to.h / 2 + offset;
      main = curve(from.x + from.w, from.y + from.h / 2 + offset, x2, y2);
      if (originBox) fromOrigin = curve(originBox.x + originBox.w, originBox.y + originBox.h / 2, x2, y2);
    } else {
      /* A lane of its own, as shallow as the bypass allows: it only has to clear the columns it spans. One lane per
         bypass at the same depth, so two cannot sit on top of each other. */
      const lowRank = Math.min(from.rank, to.rank);
      const highRank = Math.max(from.rank, to.rank);
      const spanBottom = Math.max(
        ...nodes
          .filter((node) => node.rank >= lowRank && node.rank <= highRank)
          .map((node) => node.y + node.h),
      );
      const atDepth = laneAtDepth.get(spanBottom) ?? 0;
      laneAtDepth.set(spanBottom, atDepth + 1);
      const laneY = spanBottom + LANE_OFFSET + atDepth * LANE_PITCH;
      deepest = Math.max(deepest, laneY);
      const x2 = to.x + to.w / 2 + offset;
      const y2 = to.y + to.h;
      main = lane(from.x + from.w / 2 + offset, from.y + from.h, x2, y2, laneY);
      if (originBox) fromOrigin = lane(originBox.x + originBox.w / 2, originBox.y + originBox.h, x2, y2, laneY);
    }
    const [mx, my] = main.track[0];
    out.push({
      ...edge,
      d: main.d,
      mx,
      my,
      longWay: !straight,
      ...(originBox ? { originBox, dOrigin: fromOrigin?.d } : {}),
    });
    labelTracks.push({ main: main.track, origin: fromOrigin?.track });
  }
  /**
   * No two label pills overlap, and a pill never leaves its line: it slides along its own path to the first clear
   * spot. Resolved once for the resting canvas (mx, my) and once for the highlights mode (mxOrigin, myOrigin), whose
   * paths differ. Sizes are estimated, since nothing is drawn yet.
   */
  const LABEL_CHAR_W = 15;
  const LABEL_H = 46;
  const resolve = (
    positionOf: (index: number) => Array<[number, number]>,
    write: (edge: LaidOutEdge, x: number, y: number) => void,
  ) => {
    const placed: Box[] = [];
    out.forEach((edge, index) => {
      if (!edge.label) return;
      const w = edge.label.length * LABEL_CHAR_W + 28;
      const rectAt = (x: number, y: number): Box => ({
        x: x - w / 2,
        y: y - LABEL_H / 2,
        w,
        h: LABEL_H,
      });
      const collides = (rect: Box) =>
        placed.some(
          (other) =>
            rect.x < other.x + other.w &&
            rect.x + rect.w > other.x &&
            rect.y < other.y + other.h &&
            rect.y + rect.h > other.y,
        );
      const candidates = positionOf(index);
      let pick = candidates[0];
      for (const candidate of candidates) {
        if (!collides(rectAt(candidate[0], candidate[1]))) {
          pick = candidate;
          break;
        }
      }
      write(edge, pick[0], pick[1]);
      placed.push(rectAt(pick[0], pick[1]));
    });
  };
  resolve(
    (index) => labelTracks[index]?.main ?? [[out[index].mx, out[index].my]],
    (edge, x, y) => {
      edge.mx = x;
      edge.my = y;
    },
  );
  resolve(
    (index) => {
      const track = labelTracks[index];
      if (!track) return [[out[index].mx, out[index].my]];
      return track.origin ?? track.main;
    },
    (edge, x, y) => {
      edge.mxOrigin = x;
      edge.myOrigin = y;
    },
  );

  return { edges: out, deepest };
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
  /* The foot line under the bottom row belongs to the group, and so does the deepest bypass lane below it. */
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

/** The flow view: every flow as its own diagram, stacked down the canvas with room between them. */
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
    const routed = routeEdges(flow, nodes, problems, captured);
    const edges = routed.edges;
    const box = boxOf(nodes, originY, routed.deepest, flow.title);
    groups.push({
      id: flow.id,
      title: flow.title,
      nodes,
      edges,
      box,
    });
    originY = box.y + box.h + FLOW_GAP;
  }

  return { groups, box: totalBox(groups), problems };
}

/**
 * The by-kind view: the same frames regrouped by what they are, one row per kind, no edges. Side by side,
 * near-identical states show the inconsistencies that flow order scatters.
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
      /* An edge case belongs to its journey, not to a shelf of peers. See `flowOnly` in types.ts. */
      if (screen.flowOnly) continue;
      /* An explanation panel narrates a step in a journey; there is nothing to compare it with. */
      if (screen.explain) continue;
      const kind = screen.kind ?? "Other";
      byKind.set(kind, [...(byKind.get(kind) ?? []), { screen, flow }]);
    }
  }

  /**
   * Groups keep declaration order (a kind takes its place from the first flow it appears in), so they follow the
   * journeys. A kind needs two screens: `check-canvas.mjs` fails a kind of one unless it is claimed `soloKind`.
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
      };
      x += Math.max(size.w, chromeWidth(screen, declaration, captured)) + KIND_GAP;
      tallest = Math.max(tallest, size.h);
      return node;
    });
    groups.push({
      id: `kind-${kind}`,
      title: kind,
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
 * The exploration view: one titled panel per question, options at full size side by side, or one row per option
 * when an option is several screens. No edges: options are alternatives, and an arrow would say one leads to
 * another. Each round is its own entry, so panels stack in declaration order and earlier rounds stay visible.
 */
export function layoutExplorations(
  declaration: CanvasDeclaration,
  captured?: CapturedSizes,
): Layout {
  const groups: LaidOutGroup[] = [];
  const problems: string[] = [];
  let originY = 0;

  for (const exploration of declaration.explorations ?? []) {
    /**
     * Two shapes, picked by the options' screen count. One screen each: one row, options side by side. More: one row
     * per option, its steps (`CanvasScreen.under`) left to right, so options compare down and a journey reads across.
     */
    const mains = exploration.screens.filter((screen) => !screen.under && !screen.suggests);
    const stepsOf = (id: string) =>
      exploration.screens.filter((screen) => screen.under === id && !screen.suggests);
    for (const screen of exploration.screens)
      if (screen.under && !screen.suggests && !mains.some((main) => main.id === screen.under))
        problems.push(
          `exploration ${exploration.id}: "${screen.id}" sits under "${screen.under}", which is not an option in it`,
        );
    /**
     * A suggestion (`suggests`) hangs below the frame it changes, in that frame's column and its own color. A panel
     * with suggestions always takes the rows shape, and each row grows by its tallest stack of suggestions.
     */
    const placedIds = new Set([
      ...exploration.screens.filter((screen) => !screen.suggests).map((screen) => screen.id),
      /* Today's frame takes hanging frames too, which then read before every option. */
      ...(exploration.original ? [exploration.original] : []),
    ]);
    /* The suggestions that start a row of their own under a frame, and each one's steps (`under` another
       suggestion of the same frame), which run to its right so a multi-screen suggestion reads as one row. */
    const suggestionsOf = (id: string) =>
      exploration.screens.filter((screen) => screen.suggests === id && !screen.under);
    const suggestionStepsOf = (parentId: string, leadId: string) =>
      exploration.screens.filter((screen) => screen.suggests === parentId && screen.under === leadId);
    const suggestionRow = (parentId: string, lead: CanvasScreen) => [lead, ...suggestionStepsOf(parentId, lead.id)];
    for (const screen of exploration.screens) {
      if (screen.suggests && !placedIds.has(screen.suggests))
        problems.push(
          `exploration ${exploration.id}: "${screen.id}" suggests a change to "${screen.suggests}", which is not a frame of that panel`,
        );
      if (
        screen.suggests &&
        screen.under &&
        !exploration.screens.some((one) => one.id === screen.under && one.suggests === screen.suggests && !one.under)
      )
        problems.push(
          `exploration ${exploration.id}: "${screen.id}" sits under "${screen.under}", which is not a suggestion for the same frame`,
        );
    }
    /* One frame's width in a row: the frame, its chrome, and its remarks' room. */
    const slotW = (one: CanvasScreen) => {
      const own = frameSize(one, declaration, captured);
      return Math.max(own.w, chromeWidth(one, declaration, captured)) + remarkRoom(one, own.w, own.h);
    };
    const rowW = (parentId: string, lead: CanvasScreen) =>
      suggestionRow(parentId, lead).reduce((sum, one, i) => sum + slotW(one) + (i ? KIND_GAP : 0), 0);

    /**
     * `original` names today's design, a screen the permanent views already draw: the unnumbered reference the
     * options are judged against. It reuses that screen's shot, so nothing is captured twice.
     */
    const originalScreen = exploration.original
      ? declaration.flows
          .flatMap((flow) => flow.screens)
          .find((screen) => screen.id === exploration.original)
      : undefined;
    if (exploration.original && !originalScreen)
      problems.push(
        `exploration ${exploration.id}: original "${exploration.original}" is not a screen the flows declare`,
      );
    if (!exploration.original)
      problems.push(
        `exploration ${exploration.id}: no original, and every panel opens with today's design as its first frame`,
      );
    /**
     * `redesigns` points an option's switch at the dialog or tab it redesigns rather than the whole page; like
     * `original`, it must be a screen the permanent views draw.
     */
    const permanentIds = new Set(
      declaration.flows.flatMap((flow) => flow.screens).map((screen) => screen.id),
    );
    for (const screen of exploration.screens) {
      if (screen.redesigns === undefined)
        problems.push(
          `exploration ${exploration.id}: "${screen.id}" does not say what it redesigns: name today's screen of the same state, or null when nothing like it exists today`,
        );
      else if (screen.redesigns !== null && !permanentIds.has(screen.redesigns))
        problems.push(
          `exploration ${exploration.id}: "${screen.id}" redesigns "${screen.redesigns}", which is not a screen the flows declare`,
        );
    }
    /* No fallback to the panel's page, which would put the same picture under every frame. */
    const todayOf = (screen: CanvasScreen) => screen.redesigns ?? undefined;

    const top = originY + TITLE_SPACE + CAPTION_SPACE;
    const nodes: LaidOutNode[] = [];
    const rows: { screens: CanvasScreen[]; incumbent: boolean }[] = [
      /* Today's frame gets a row only when something hangs under it, since every option's switch already shows
         today's state. `original` stays required because the switch and the oracle read it. */
      ...(originalScreen && exploration.screens.some((screen) => screen.suggests === originalScreen.id)
        ? [{ screens: [originalScreen], incumbent: true }]
        : []),
      ...mains.map((main) => ({
        screens: [main, ...stepsOf(main.id)],
        incumbent: false,
      })),
    ];
    const multiScreen =
      rows.some((row) => row.screens.length > 1) ||
      exploration.screens.some((screen) => screen.suggests);
    let optionNumber = 0;
    let panelW = 0;
    let panelH = 0;

    if (!multiScreen) {
      let x = 0;
      rows.forEach(({ screens: rowScreens, incumbent }, index) => {
        const screen = rowScreens[0];
        const size = frameSize(screen, declaration, captured);
        nodes.push({
          screen,
          group: { id: exploration.id, title: exploration.title },
          x,
          y: top,
          w: size.w,
          h: size.h,
          rank: index,
          /* Only options are numbered; a panel of pages (`pages`) numbers nothing. */
          option: incumbent || exploration.pages ? undefined : ++optionNumber,
          incumbent: incumbent || undefined,
          today: incumbent ? undefined : todayOf(screen),
        });
        x += Math.max(size.w, chromeWidth(screen, declaration, captured)) + remarkRoom(screen, size.w, size.h) + KIND_GAP;
        panelH = Math.max(panelH, size.h);
      });
      panelW = Math.max(0, x - KIND_GAP);
    } else {
      /* Rows shape: the incumbent's row first and alone, then one row per option in step order. */
      let y = top;
      rows.forEach(({ screens: rowScreens, incumbent }, rowIndex) => {
        let x = 0;
        let rowH = 0;
        const number = incumbent || exploration.pages ? undefined : ++optionNumber;
        const placed: LaidOutNode[] = [];
        rowScreens.forEach((screen, step) => {
          const size = frameSize(screen, declaration, captured);
          const hanging = suggestionsOf(screen.id);
          /* The widest of the frame and every suggestion under it, each with its remarks' room (remarks-layout.ts). */
          const columnW = Math.max(
            Math.max(size.w, chromeWidth(screen, declaration, captured)) + remarkRoom(screen, size.w, size.h),
            ...hanging.map((one) => rowW(screen.id, one)),
          );
          placed.push({
            screen,
            group: { id: exploration.id, title: exploration.title },
            x,
            y,
            w: size.w,
            h: size.h,
            rank: rowIndex,
            /* The number and the verdict live on the row's first frame only: the frames after it are the option's steps. */
            option: step === 0 ? number : undefined,
            incumbent: (step === 0 && incumbent) || undefined,
            supporting: step > 0 || undefined,
            today: incumbent ? undefined : todayOf(screen),
          });
          x += columnW + KIND_GAP;
          rowH = Math.max(rowH, size.h);
        });
        nodes.push(...placed);
        /* Each suggestion stack hangs right under its own frame, not under the row's tallest, so it reads as attached. */
        let rowBottom = y + rowH;
        for (const parent of placed) {
          let sy = parent.y + parent.h + FOOT_SPACE + SUGGEST_DROP + CAPTION_SPACE;
          for (const lead of suggestionsOf(parent.screen.id)) {
            let sx = parent.x;
            let tallest = 0;
            for (const one of suggestionRow(parent.screen.id, lead)) {
              const size = frameSize(one, declaration, captured);
              nodes.push({
                screen: one,
                group: { id: exploration.id, title: exploration.title },
                x: sx,
                y: sy,
                w: size.w,
                h: size.h,
                rank: rowIndex,
                supporting: true,
                suggestion: true,
                today: todayOf(one),
              });
              sx += slotW(one) + KIND_GAP;
              tallest = Math.max(tallest, size.h);
            }
            rowBottom = Math.max(rowBottom, sy + tallest);
            sy += tallest + FOOT_SPACE + SUGGEST_DROP + CAPTION_SPACE;
          }
        }
        panelW = Math.max(panelW, x - KIND_GAP);
        y = rowBottom + FOOT_SPACE + CAPTION_SPACE;
      });
      panelH = y - FOOT_SPACE - CAPTION_SPACE - top;
    }

    groups.push({
      id: `explore-${exploration.id}`,
      /* The heading names the surface the exploration is about. */
      title: exploration.surface,
      nodes,
      edges: [],
      box: {
        x: 0,
        y: originY,
        /* The wider of the two: the frames inside, or the heading over them. */
        w: atLeastTitleWide(panelW, exploration.surface),
        h: top + panelH + FOOT_SPACE - originY,
      },
    });
    originY = top + panelH + FOOT_SPACE + FLOW_GAP;
  }

  return { groups, box: totalBox(groups), problems };
}
