/**
 * design-canvas CORE — WHERE THE REMARKS BESIDE A FRAME GO: its sticky note and its evidence tiles.
 *
 * Both hang in the room to the frame's RIGHT, never over it and never between frames of their own:
 * every note, diagram and visual sits around the frame it belongs to. The note is on top (it says why), the real screenshots under it (they show who does it that way).
 *
 * One pure function, because two places have to agree on it without talking to each other: the layout
 * (`graph-layout.ts`) reserves exactly this much room beside a column, and the frame (`canvas-frame.tsx`) draws the
 * tiles exactly there. Nothing is measured in the browser, so the canvas is laid out before any picture has loaded.
 * Every number is world units, the same units as the frame's own width and height.
 */
import type { CanvasEvidence, CanvasScreen } from "./types";

/** The gap between a frame's right edge and anything hung beside it. */
export const REMARK_OFFSET = 44;
/** The sticky note's width, and the type it is set in (canvas-frame draws it with these). */
export const STICKY_W = 400;
export const STICKY_FONT = 32;
export const STICKY_LINE = 40;
export const STICKY_PAD_Y = 56;
/** How far below the frame's top the note starts. */
export const STICKY_TOP = 20;
/** One evidence tile's width, and the tallest a tile may be (a phone screenshot is narrowed to fit, not cropped). */
export const TILE_W = 540;
export const TILE_MAX_H = 600;
/** The system's name, set above each tile. */
export const TILE_LABEL = 44;
export const TILE_GAP = 40;
/** Clear space after the last column of remarks, before the next frame's column. */
const ROOM_MARGIN = 60;

export type RemarkTile = { x: number; y: number; w: number; h: number; evidence: CanvasEvidence };

/**
 * HOW TALL THE STICKY NOTE WILL BE, estimated rather than measured. Words are wrapped at a generous average glyph
 * width, so the estimate errs tall: a tile placed under an estimate that is too short would sit on the note.
 */
export function stickyHeight(text: string | undefined): number {
  if (!text) return 0;
  const perLine = Math.floor((STICKY_W - 56) / (STICKY_FONT * 0.54));
  let lines = 1;
  let used = 0;
  for (const word of text.split(/\s+/)) {
    const need = used === 0 ? word.length : used + 1 + word.length;
    if (need > perLine && used > 0) {
      lines += 1;
      used = word.length;
    } else used = need;
  }
  return lines * STICKY_LINE + STICKY_PAD_Y;
}

/**
 * The tiles of one frame, placed. They fill columns top to bottom within the frame's own height: the first column
 * starts under the note, the next ones at the frame's top. A tile too tall for what is left of an EMPTY column is
 * shrunk to fit rather than pushed out, so nothing ever hangs below the frame into the next suggestion's space.
 */
export function remarkTiles(screen: Pick<CanvasScreen, "sticky" | "evidence">, frameW: number, frameH: number): RemarkTile[] {
  const tiles: RemarkTile[] = [];
  const firstTop = screen.sticky ? STICKY_TOP + stickyHeight(screen.sticky) + 48 : 0;
  /* Each column is as wide as its widest tile, so a narrow phone screenshot does not leave a hole beside it. */
  let columnX = frameW + REMARK_OFFSET;
  let columnW = 0;
  let y = firstTop;
  let inColumn = 0;
  for (const evidence of screen.evidence ?? []) {
    let w = TILE_W;
    let h = Math.round((TILE_W * evidence.h) / Math.max(1, evidence.w));
    if (h > TILE_MAX_H) {
      w = Math.round((w * TILE_MAX_H) / h);
      h = TILE_MAX_H;
    }
    if (inColumn > 0 && y + TILE_LABEL + h > frameH) {
      columnX += columnW + TILE_GAP;
      columnW = 0;
      y = 0;
      inColumn = 0;
    }
    const room = frameH - y - TILE_LABEL;
    if (h > room && room > 80) {
      w = Math.round((w * room) / h);
      h = room;
    }
    tiles.push({ x: columnX, y: y + TILE_LABEL, w, h, evidence });
    columnW = Math.max(columnW, w, inColumn === 0 && columnX === frameW + REMARK_OFFSET && screen.sticky ? STICKY_W : 0);
    y += TILE_LABEL + h + TILE_GAP;
    inColumn += 1;
  }
  return tiles;
}

/** How much room the frame's remarks take to its right: nothing when it has none. */
export function remarkRoom(screen: Pick<CanvasScreen, "sticky" | "evidence">, frameW: number, frameH: number): number {
  const tiles = remarkTiles(screen, frameW, frameH);
  const tileRight = tiles.reduce((most, tile) => Math.max(most, tile.x + tile.w - frameW), 0);
  const stickyRight = screen.sticky ? REMARK_OFFSET + STICKY_W : 0;
  const right = Math.max(tileRight, stickyRight);
  return right > 0 ? right + ROOM_MARGIN : 0;
}
