/**
 * THE DESIGN SYSTEM TAB: what a project declares, what a capture writes, and where everything sits on the surface.
 *
 * A designer sees the design system as a visual canvas of components and their states, types and groups, the way a
 * Figma design system file shows them, to drag, scroll and zoom: visual, not text. Clean pictures (each variant rendered
 * alone with neutral content), the design system layer only (shared components and patterns, not every file), organized
 * by atomic level.
 *
 * So a project declares COMPONENT SETS, the way a Figma file holds component sets: a component, its level, and one or more
 * blocks, each a grid of rows (usually variants) by columns (usually states). `design-canvas/project/system.tsx` holds them
 * and renders each cell; `system-capture.mjs` photographs every cell alone; this file lays the pictures out.
 *
 * WHAT IS NOT HERE: anything the agent reads. When to use a part, the decisions behind it and the reuse check are text for
 * the agent behind `components.mjs`. This tab is the part a person looks at, and it carries pictures and their labels.
 *
 * Pure: no React, no DOM, so the layout is tested without a browser.
 */
import type { ReactNode } from "react";

/** The atomic levels, in reading order. A level with no set is not drawn. */
export const SYSTEM_LEVELS = ["foundations", "atoms", "molecules", "organisms"] as const;
export type SystemLevel = (typeof SYSTEM_LEVELS)[number];
export const SYSTEM_LEVEL_TITLE: Record<SystemLevel, string> = {
  foundations: "Foundations",
  atoms: "Atoms",
  molecules: "Molecules",
  organisms: "Organisms",
};

/**
 * A state the capture forces on the part rather than one the props can express. Hover, keyboard focus and press are CSS
 * pseudo-classes, so the capture sets them through the browser's own devtools protocol on the part's first element: no
 * pointer is moved, every cell is independent, and the result is the CSS the product really ships. The state lands on the
 * element marked `data-system-state`, else the first focusable element inside the part (so a search field's input, not
 * its wrapper), else the part's first element.
 */
export type SystemForced = "hover" | "focus" | "active";

export type SystemRow = {
  id: string;
  label: string;
  /** Drawn on a dark ground, for a part that is only ever used on one (an inverse button). */
  dark?: boolean;
};
export type SystemColumn = { id: string; label: string; force?: SystemForced };

export type SystemBlock = {
  id: string;
  /** What this grid varies, e.g. "Variants and states", "Sizes". */
  title: string;
  rows: SystemRow[];
  columns: SystemColumn[];
  /** The part in one cell. `null` means the combination does not exist, and the grid leaves the cell empty. */
  render: (row: string, column: string) => ReactNode | null;
  /**
   * A part that draws outside its cell (a dialog, a sheet, a menu, a popover: Radix portals them to the body). Each cell
   * then renders alone on its own page, and the capture photographs the element `shoot` matches (the last visible one),
   * on a white ground with the page mask hidden: the overlay itself, the way a design file shows it.
   */
  overlay?: { shoot: string };
};

export type SystemSet = {
  id: string;
  name: string;
  level: SystemLevel;
  /**
   * The section the set is drawn in, named by what the parts do: "Actions", "Fields", "Selection". Each group is its own
   * section, the same panel a group of screens is on the other tabs, never everything under one section. Sections follow the atomic order of their sets' level.
   */
  group: string;
  /** The file the part lives in, shown under its name so an agent and a developer land on the same file. */
  source: string;
  blocks: SystemBlock[];
};

export type SystemDeclaration = { sets: SystemSet[] };

/** An id is a slug: it names files on disk and keys in the manifest. */
export const SYSTEM_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function systemCellKey(block: string, row: string, column: string): string {
  return `${block}/${row}/${column}`;
}

/** Every problem with a declaration, in words. The specimen page and the capture both refuse to work past one. */
export function systemProblems(declaration: SystemDeclaration): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const set of declaration.sets) {
    if (!SYSTEM_ID.test(set.id)) problems.push(`set "${set.id}": an id is lowercase letters, digits and dashes`);
    if (seen.has(set.id)) problems.push(`set "${set.id}" is declared twice`);
    seen.add(set.id);
    if (!set.group?.trim()) problems.push(`set "${set.id}": name the section it belongs in (group)`);
    if (!(SYSTEM_LEVELS as readonly string[]).includes(set.level))
      problems.push(`set "${set.id}": level "${set.level}" is not one of ${SYSTEM_LEVELS.join(", ")}`);
    const blocks = new Set<string>();
    for (const block of set.blocks) {
      if (!SYSTEM_ID.test(block.id)) problems.push(`${set.id}/${block.id}: a block id is a slug`);
      if (blocks.has(block.id)) problems.push(`${set.id}/${block.id} is declared twice`);
      blocks.add(block.id);
      for (const axis of [block.rows, block.columns]) {
        const ids = new Set<string>();
        for (const one of axis) {
          if (!SYSTEM_ID.test(one.id)) problems.push(`${set.id}/${block.id}: "${one.id}" is not a slug`);
          if (ids.has(one.id)) problems.push(`${set.id}/${block.id}: "${one.id}" is declared twice`);
          ids.add(one.id);
        }
      }
    }
  }
  return problems;
}

/** What the capture writes beside the pictures: the declaration without its render functions, plus each picture's size. */
export type SystemShot = { w: number; h: number; hash: string };
export type SystemManifestBlock = {
  id: string;
  title: string;
  overlay?: { shoot: string };
  rows: SystemRow[];
  columns: { id: string; label: string }[];
  cells: Record<string, SystemShot>;
};
export type SystemManifestSet = {
  id: string;
  name: string;
  level: SystemLevel;
  group: string;
  source: string;
  blocks: SystemManifestBlock[];
};
export type SystemManifest = { builtAt: string; sets: SystemManifestSet[] };

/* ---------------------------------------------------------------------------------------------------------------------
 * THE LAYOUT. World units are CSS pixels of the part itself, so at 100% a button is its real size and the 2x pictures
 * stay sharp to 200%. Fit never magnifies, so a small system opens at true size.
 * ------------------------------------------------------------------------------------------------------------------- */

export type Box = { x: number; y: number; w: number; h: number };

export type SystemLaidCell = { key: string; box: Box; shot: SystemShot; dark: boolean };
export type SystemLaidLabel = { text: string; box: Box; align: "left" | "center" };
export type SystemLaidBlock = {
  id: string;
  title: string;
  titleBox: Box;
  columns: SystemLaidLabel[];
  rows: SystemLaidLabel[];
  cells: SystemLaidCell[];
  /** Empty grid spots: a combination the part does not have. Drawn faintly, so the grid still reads as a grid. */
  gaps: Box[];
};
export type SystemLaidSet = {
  id: string;
  name: string;
  source: string;
  /** The card the set sits on, like a frame on the other tabs. Its title sits above it. */
  card: Box;
  titleBox: Box;
  blocks: SystemLaidBlock[];
};
/** One section on the surface: a group of sets, under its name. */
export type SystemLaidSection = { id: string; title: string; titleBox: Box; panel: Box; sets: SystemLaidSet[] };
/** A level is the bigger section the related sections sit in: Foundations, Atoms, Molecules, Organisms. */
export type SystemLaidLevel = { level: SystemLevel; title: string; titleBox: Box; panel: Box };
export type SystemLayout = { levels: SystemLaidLevel[]; sections: SystemLaidSection[]; box: Box };

export const SYSTEM_METRICS = {
  /**
   * NAMES READ AT FIT, the way a group's name does on the other tabs (132px over 1440px frames): at 56px they were 8px
   * on screen.
   */
  levelTitle: 200,
  levelTitleGap: 80,
  levelPad: 120,
  levelGap: 240,
  sectionTitle: 120,
  sectionTitleGap: 56,
  /** The panel around a section, the same panel a group is on the other tabs. */
  panelPad: 72,
  sectionGap: 120,
  /** A set's name above its card, and its source path under the name. */
  setTitle: 22,
  setSource: 13,
  setHeader: 58,
  setGap: 96,
  /** Wrap sets onto a new line past this width. */
  rowWidth: 2600,
  cardPad: 40,
  blockTitle: 15,
  blockTitleGap: 20,
  blockGap: 48,
  /** Column headers above the grid and row labels left of it. */
  label: 12,
  headerHeight: 28,
  rowLabelWidth: 150,
  /** Space between grid cells, so each picture reads as one specimen. */
  cellGap: 8,
} as const;

function layoutBlock(block: SystemManifestBlock, x: number, y: number): { laid: SystemLaidBlock; w: number; h: number } {
  const M = SYSTEM_METRICS;
  const colW = block.columns.map((column) =>
    Math.max(
      72,
      ...block.rows.map((row) => block.cells[systemCellKey(block.id, row.id, column.id)]?.w ?? 0),
    ),
  );
  const rowH = block.rows.map((row) =>
    Math.max(
      40,
      ...block.columns.map((column) => block.cells[systemCellKey(block.id, row.id, column.id)]?.h ?? 0),
    ),
  );
  const titleBox = { x, y, w: 600, h: M.blockTitle * 1.4 };
  const gridX = x + M.rowLabelWidth;
  const gridY = y + titleBox.h + M.blockTitleGap + M.headerHeight;
  const columns: SystemLaidLabel[] = [];
  let cx = gridX;
  block.columns.forEach((column, i) => {
    columns.push({ text: column.label, box: { x: cx, y: gridY - M.headerHeight, w: colW[i], h: M.headerHeight }, align: "center" });
    cx += colW[i] + M.cellGap;
  });
  const rows: SystemLaidLabel[] = [];
  const cells: SystemLaidCell[] = [];
  const gaps: Box[] = [];
  let cy = gridY;
  block.rows.forEach((row, r) => {
    rows.push({ text: row.label, box: { x, y: cy, w: M.rowLabelWidth - 16, h: rowH[r] }, align: "left" });
    let px = gridX;
    block.columns.forEach((column, c) => {
      const key = systemCellKey(block.id, row.id, column.id);
      const shot = block.cells[key];
      if (shot) {
        /* Centred in its grid spot, so a narrow state lines up with the wide one above it. */
        cells.push({
          key,
          shot,
          dark: Boolean(row.dark),
          box: { x: px + (colW[c] - shot.w) / 2, y: cy + (rowH[r] - shot.h) / 2, w: shot.w, h: shot.h },
        });
      } else {
        gaps.push({ x: px, y: cy, w: colW[c], h: rowH[r] });
      }
      px += colW[c] + M.cellGap;
    });
    cy += rowH[r] + M.cellGap;
  });
  const w = M.rowLabelWidth + colW.reduce((a, b) => a + b, 0) + M.cellGap * Math.max(0, colW.length - 1);
  const h = cy - M.cellGap - y;
  return { laid: { id: block.id, title: block.title, titleBox, columns, rows, cells, gaps }, w: Math.max(w, titleBox.w), h };
}

function layoutSet(set: SystemManifestSet, x: number, y: number): { laid: SystemLaidSet; w: number; h: number } {
  const M = SYSTEM_METRICS;
  const cardY = y + M.setHeader;
  let by = cardY + M.cardPad;
  let inner = 0;
  const blocks: SystemLaidBlock[] = [];
  set.blocks.forEach((block, i) => {
    if (i > 0) by += M.blockGap;
    const { laid, w, h } = layoutBlock(block, x + M.cardPad, by);
    blocks.push(laid);
    inner = Math.max(inner, w);
    by += h;
  });
  const card = { x, y: cardY, w: inner + M.cardPad * 2, h: by + M.cardPad - cardY };
  return {
    laid: { id: set.id, name: set.name, source: set.source, card, titleBox: { x, y, w: card.w, h: M.setHeader }, blocks },
    w: card.w,
    h: card.y + card.h - y,
  };
}

export function layoutSystem(manifest: SystemManifest | null): SystemLayout {
  const M = SYSTEM_METRICS;
  /* Sections in the order the declaration names them, each in the level of its earliest set. */
  const order = new Map<string, { rank: number; first: number; sets: SystemManifestSet[] }>();
  (manifest?.sets ?? []).forEach((set, i) => {
    const rank = SYSTEM_LEVELS.indexOf(set.level);
    const known = order.get(set.group);
    if (known) {
      known.sets.push(set);
      known.rank = Math.min(known.rank, rank);
    } else order.set(set.group, { rank, first: i, sets: [set] });
  });
  /**
   * RELATED SECTIONS SIT IN A BIGGER SECTION, the atomic level. Levels stand side by side, each a column: one column of seventeen
   * sections could not fit any window, and the surface stops zooming out at 10%. Inside a level every section is the same
   * width, so the column reads as one thing rather than a ragged stack.
   */
  const levels: SystemLaidLevel[] = [];
  const sections: SystemLaidSection[] = [];
  let x = 0;
  let bottom = 0;
  SYSTEM_LEVELS.forEach((level, rank) => {
    const mine = [...order.entries()].filter(([, one]) => one.rank === rank).sort((a, b) => a[1].first - b[1].first);
    if (mine.length === 0) return;
    /* First pass: lay each section out to learn its width; the level's inner width is the widest. */
    const drafts = mine.map(([title, { sets }]) => {
      let sx = 0;
      let lineH = 0;
      let widest = 0;
      let sy = 0;
      const placed: { set: SystemManifestSet; dx: number; dy: number }[] = [];
      for (const set of sets) {
        const trial = layoutSet(set, 0, 0);
        if (sx > 0 && sx + trial.w > M.rowWidth) {
          sx = 0;
          sy += lineH + M.setGap;
          lineH = 0;
        }
        placed.push({ set, dx: sx, dy: sy });
        sx += trial.w + M.setGap;
        lineH = Math.max(lineH, trial.h);
        widest = Math.max(widest, sx - M.setGap);
      }
      return { title, placed, w: widest, h: sy + lineH };
    });
    const inner = Math.max(...drafts.map((one) => one.w), 1400);
    const levelTop = 0;
    const levelTitleBox = { x, y: levelTop, w: inner, h: M.levelTitle * 1.1 };
    let y = levelTop + levelTitleBox.h + M.levelTitleGap + M.panelPad;
    for (const draft of drafts) {
      const top = y;
      const titleBox = { x, y, w: inner, h: M.sectionTitle * 1.1 };
      const setsTop = y + titleBox.h + M.sectionTitleGap;
      const sets = draft.placed.map(({ set, dx, dy }) => layoutSet(set, x + dx, setsTop + dy).laid);
      const sectionBottom = setsTop + draft.h;
      sections.push({
        id: draft.title,
        title: draft.title,
        titleBox,
        panel: { x: x - M.panelPad, y: top - M.panelPad, w: inner + M.panelPad * 2, h: sectionBottom - top + M.panelPad * 2 },
        sets,
      });
      y = sectionBottom + M.panelPad * 2 + M.sectionGap;
    }
    const levelBottom = y - M.sectionGap - M.panelPad + M.levelPad;
    const panel = {
      x: x - M.panelPad - M.levelPad,
      y: levelTop - M.levelPad,
      w: inner + (M.panelPad + M.levelPad) * 2,
      h: levelBottom - levelTop + M.levelPad,
    };
    levels.push({ level, title: SYSTEM_LEVEL_TITLE[level], titleBox: levelTitleBox, panel });
    bottom = Math.max(bottom, panel.y + panel.h);
    x += inner + (M.panelPad + M.levelPad) * 2 + M.levelGap;
  });
  if (levels.length === 0) return { levels, sections, box: { x: 0, y: 0, w: 0, h: 0 } };
  const left = levels[0].panel.x;
  const top = levels[0].panel.y;
  const right = Math.max(...levels.map((one) => one.panel.x + one.panel.w));
  return { levels, sections, box: { x: left, y: top, w: right - left, h: bottom - top } };
}
