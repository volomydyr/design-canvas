/**
 * design-canvas — THE CONTACT SHEET: the frames a round re-photographed, before beside after, on one page.
 *
 * WHY IT EXISTS. Looking at what a round changed otherwise means building a sheet by hand. The numbers of `visual-delta.mjs` say
 * WHERE to look; this is the looking, built from the same report, in the same command as the capture, so it is never
 * skipped because it was a chore.
 *
 * WHAT IT DRAWS. One row per frame that changed or is new: the picture it replaced, the picture it is now, and the box
 * that holds every changed pixel drawn in red on the new one. A frame taller than a window is cropped to the part that
 * changed (the crop is named in the row; a change box taller than the window is cropped where most of its pixels are), because a 4,000 pixel page shrunk to fit shows nothing. A flagged frame carries a
 * red edge and the reason. Frames that came out identical are listed in one line and not drawn: there is nothing to see.
 *
 * It writes `contact-sheet.html` and `contact-sheet.png` beside the report, under `design-canvas/rounds/<slug>/`, which is
 * a scratch folder the installer gitignores: the durable record of a round is git and the comments history.
 *
 * DELETE WITH: the design-canvas/ folder.
 */
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";

import { withBrowser } from "./browser-lifecycle.mjs";

/** The width each picture is drawn at, and the tallest a row may be before the picture is cropped around its change. */
export const CELL_W = 560;
export const CAP_H = 760;

const escapeHtml = (text) => String(text).replace(/[&<>"]/g, (one) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[one]);

/**
 * WHICH PART OF A PICTURE A ROW SHOWS. The picture is scaled to the cell's width; if that is taller than the cap, a window of
 * the cap's height is cut out, centered on the changed box when the box fits in it, else on `focusY` (the row by which half
 * the changed pixels are counted, so the window holds a change), and clamped to the picture. Pure, for the tests.
 */
export function cropWindow({ w, h, bbox, focusY, cellW = CELL_W, capH = CAP_H }) {
  const scale = cellW / w;
  const scaledH = h * scale;
  if (scaledH <= capH) return { scale, top: 0, height: Math.round(scaledH), cropped: false };
  const middle = !bbox ? 0 : bbox.h * scale > capH && Number.isFinite(focusY) ? focusY : bbox.y + bbox.h / 2;
  const centre = middle * scale;
  const top = Math.min(Math.max(0, centre - capH / 2), scaledH - capH);
  return { scale, top: Math.round(top), height: capH, cropped: true, fromPx: Math.round(top / scale), toPx: Math.round((top + capH) / scale) };
}

/** The page. `afterSrc` maps a frame to the path of its current picture, relative to where the page is written. */
export function sheetHtml({ title, canvas, frames, identical, afterSrc }) {
  const rows = frames
    .map((frame) => {
      const win = cropWindow({ w: frame.after?.w ?? CELL_W, h: frame.after?.h ?? CAP_H, bbox: frame.bbox, focusY: frame.focusY });
      const beforeWindow = frame.before ? cropWindow({ w: frame.before.w, h: frame.before.h, bbox: frame.bbox, focusY: frame.focusY }) : null;
      const box = frame.bbox
        ? `<div class="box" style="left:${Math.round(frame.bbox.x * win.scale)}px;top:${Math.round(frame.bbox.y * win.scale - win.top)}px;width:${Math.max(3, Math.round(frame.bbox.w * win.scale))}px;height:${Math.max(3, Math.round(frame.bbox.h * win.scale))}px"></div>`
        : "";
      const cell = (label, src, win, extra = "") =>
        `<figure><figcaption>${escapeHtml(label)}</figcaption><div class="pic" style="width:${CELL_W}px;height:${win.height}px"><img src="${escapeHtml(src)}" style="width:${CELL_W}px;margin-top:-${win.top}px" alt="${escapeHtml(label)}">${extra}</div></figure>`;
      const facts = [
        frame.status === "new" ? "New frame" : `${frame.changedPct < 0.01 ? "<0.01" : frame.changedPct.toFixed(2)}% changed`,
        frame.commentIds?.length ? `comments ${frame.commentIds.join(", ")}` : "no comment on this frame",
        win.cropped ? `showing ${win.fromPx} to ${win.toPx} px of ${frame.after.h}` : null,
        frame.before && (frame.before.w !== frame.after.w || frame.before.h !== frame.after.h) ? `size ${frame.before.w}x${frame.before.h} to ${frame.after.w}x${frame.after.h}` : null,
      ].filter(Boolean);
      return `<section class="${frame.flag ? "flagged" : ""}"><h2>${escapeHtml(frame.id)}</h2><p>${escapeHtml(facts.join(" · "))}${frame.flag ? ` <b>${escapeHtml(frame.flag)}</b>` : ""}</p><div class="pair">${
        beforeWindow ? cell("Before", frame.beforeSrc ?? `before/${frame.id}.webp`, beforeWindow) : ""
      }${cell("After", afterSrc(frame), win, box)}</div></section>`;
    })
    .join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
body{margin:0;padding:24px;background:#f3f3f1;color:#1a1a1a;font:14px/1.45 system-ui,sans-serif}
h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:0}p{margin:2px 0 10px;color:#555}b{color:#b3261e}
section{background:#fff;padding:14px 16px 18px;margin:0 0 16px;border-left:4px solid #d0d0cc}section.flagged{border-left-color:#b3261e}
.pair{display:flex;gap:16px;align-items:flex-start}figure{margin:0}figcaption{font-weight:600;margin:0 0 4px;color:#444}
.pic{position:relative;overflow:hidden;outline:1px solid #ccc;background:#fafafa}.pic img{display:block}
.box{position:absolute;border:2px solid #d92d20;background:rgba(217,45,32,.08);box-sizing:border-box}
.quiet{color:#666}</style></head><body><h1>${escapeHtml(title)}</h1><p>${escapeHtml(canvas)}</p>${rows || '<p class="quiet">Nothing changed in this round.</p>'}${
    identical.length > 0 ? `<p class="quiet">Identical to the previous shot, not drawn: ${escapeHtml(identical.join(", "))}</p>` : ""
  }</body></html>`;
}

/**
 * BUILD THE SHEET from a delta report directory. `shotsDir` is where the current pictures live. Returns the paths written,
 * or null when there was nothing to draw. `chromium` is playwright's, passed in because this file imports nothing that needs
 * the project's node_modules.
 */
export async function buildContactSheet({ chromium, launchOptions, deltaDir, delta, shotsDir, canvas, title }) {
  const frames = (delta.frames ?? []).filter((frame) => frame.status === "changed" || frame.status === "new");
  const identical = (delta.frames ?? []).filter((frame) => frame.status === "identical").map((frame) => frame.id);
  if (frames.length === 0 && identical.length === 0) return null;
  const html = sheetHtml({
    title,
    canvas,
    frames: frames.map((frame) => ({ ...frame, beforeSrc: frame.beforeFile })),
    identical,
    afterSrc: (frame) => path.relative(deltaDir, path.join(shotsDir, `${frame.id}.webp`)).split(path.sep).join("/"),
  });
  const htmlFile = path.join(deltaDir, "contact-sheet.html");
  const pngFile = path.join(deltaDir, "contact-sheet.png");
  writeFileSync(htmlFile, html, "utf8");
  /* A two-minute ceiling, and closed in a finally whatever happens: this is the one browser a round opens that nobody looks at. */
  await withBrowser(
    chromium,
    launchOptions ?? {},
    async (browser) => {
      const page = await browser.newPage({ viewport: { width: CELL_W * 2 + 120, height: 900 } });
      await page.goto(`file://${htmlFile}`);
      await page.waitForFunction(() => [...document.images].every((image) => image.complete), null, { timeout: 15_000 }).catch(() => undefined);
      await page.screenshot({ path: pngFile, fullPage: true });
    },
    { who: "contact-sheet", timeoutMs: 120_000 },
  );
  const missing = frames.filter((frame) => !existsSync(path.join(shotsDir, `${frame.id}.webp`))).map((frame) => frame.id);
  return { htmlFile, pngFile, drawn: frames.length, identical: identical.length, missing };
}
