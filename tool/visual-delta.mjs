/**
 * design-canvas — THE VISUAL CHANGE REPORT: after a capture, what each frame looks like now against what it looked like a
 * moment ago, in numbers, with the frames that moved somewhere nobody asked for flagged.
 *
 * WHY THIS EXISTS. A capture replaces pictures, and nothing said which ones had actually changed or by how much, so
 * frames could change without the reviewer knowing why. The capture is the one moment both pictures exist side by side, so it is the moment to
 * say so: per re-photographed frame, the percent of pixels that changed against the previous shot, and a FLAG on any frame
 * that changed outside the region somebody commented on (or, where nobody commented, at all).
 *
 * HOW IT READS. Both pictures are decoded and compared INSIDE the capture's own browser (Chromium decodes WebP; Node has no
 * decoder and this tool has no image dependency), so only the numbers cross back. A pixel counts as changed when its four
 * channels differ by more than a small tolerance in total, which ignores encoder noise and nothing a person would see. A
 * comment's rectangle is widened a little (a fix near a pin moves its neighbours) before anything is called "outside".
 *
 * A FLAG IS NOT A FAILURE. It is an unexpected change brought to the agent's attention before the reviewer meets it. The run
 * still exits by its own rules; the report is evidence, printed under the capture's own lines, and saved beside the
 * previous pictures so the contact sheet (`round.mjs`) can put before and after side by side.
 *
 * DELETE WITH: the design-canvas/ folder.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Percent of a frame that may change outside the commented region (or anywhere, where nothing is commented) before it is flagged. */
export const FLAG_PCT = 0.5;
/** Summed per-channel difference above which a pixel counts as changed. Well above encoder noise, well below a visible edit. */
export const PIXEL_TOLERANCE = 32;
/** How far a comment's rectangle is widened before a change beside it is called unrelated: a share of the frame, plus pixels. */
export const REGION_MARGIN = { share: 0.02, px: 12 };

/**
 * COMPARE TWO PICTURES, given as RGBA bytes of the SAME size (the caller pads the smaller one with transparent pixels, so
 * rows one has and the other lacks count as changed).
 *
 * SELF-CONTAINED ON PURPOSE: it is shipped into the capture's browser as source text (`compareRgba.toString()`), so it may
 * reference nothing outside its own body. The tests run the same function in Node.
 *
 * `regions` are pixel rectangles `{ x, y, w, h }`, already widened. Returns the counts, the box that holds every changed
 * pixel, and `focusY`: the row by which half of them are counted, from the top. It always holds a changed pixel, so a crop
 * centered on it shows a change even when the box spans the page (a change at the top and another at the bottom).
 */
export function compareRgba(a, b, w, h, regions, tolerance) {
  const mask = new Uint8Array(w * h);
  for (const r of regions) {
    const x0 = Math.max(0, Math.floor(r.x));
    const y0 = Math.max(0, Math.floor(r.y));
    const x1 = Math.min(w, Math.ceil(r.x + r.w));
    const y1 = Math.min(h, Math.ceil(r.y + r.h));
    for (let y = y0; y < y1; y += 1) mask.fill(1, y * w + x0, y * w + x1);
  }
  let changed = 0;
  let outside = 0;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  const perRow = new Uint32Array(h);
  for (let at = 0, i = 0; at < w * h; at += 1, i += 4) {
    const diff =
      Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) + Math.abs(a[i + 3] - b[i + 3]);
    if (diff <= tolerance) continue;
    changed += 1;
    if (mask[at] === 0) outside += 1;
    const x = at % w;
    const y = (at - x) / w;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    perRow[y] += 1;
  }
  let focusY = null;
  for (let y = 0, counted = 0; changed > 0 && y < h; y += 1) {
    counted += perRow[y];
    if (counted * 2 >= changed) {
      focusY = y;
      break;
    }
  }
  return {
    changed,
    outside,
    total: w * h,
    bbox: changed > 0 ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : null,
    focusY,
  };
}

/**
 * What a number of changed pixels means for a frame: its status, and whether it is worth the agent's attention.
 * Identical means no pixel past `PIXEL_TOLERANCE`: a real edit as small as a corner radius changes a few pixels, and
 * the changed-screens queue uses this same verdict, so the two never disagree.
 */
export function judge({ changedPct, outsidePct, hasComments, sizeChanged, flagPct = FLAG_PCT }) {
  if (changedPct === 0 && !sizeChanged) return { status: "identical", flag: null };
  if (hasComments) return { status: "changed", flag: outsidePct > flagPct ? "changed outside the commented region" : null };
  return { status: "changed", flag: changedPct > flagPct || sizeChanged ? "changed and nothing is commented here" : null };
}

/**
 * A comment's rectangle as pixels of the picture it is about, widened by the margin.
 *
 * SELF-CONTAINED like `compareRgba` (the margin is an argument, not a constant), because the browser runs it too.
 */
export function regionRect(region, w, h, margin) {
  const mx = margin.share * w + margin.px;
  const my = margin.share * h + margin.px;
  return {
    x: (Number(region.xPct) / 100) * w - mx,
    y: (Number(region.yPct) / 100) * h - my,
    w: (Number(region.wPct) / 100) * w + 2 * mx,
    h: (Number(region.hPct) / 100) * h + 2 * my,
  };
}

/** Our own two functions, handed to the capture's browser as a script. No data is ever spliced into it. */
const PAGE_SCRIPT = `${compareRgba.toString()}\n${regionRect.toString()}\nwindow.__canvasDelta = { compareRgba, regionRect };`;

/** The decode-and-compare, run INSIDE the browser against the functions `PAGE_SCRIPT` put there. */
async function measure(page, args) {
  return page.evaluate(async ({ before, after, regions, tolerance, margin }) => {
    const load = async (b64) => createImageBitmap(await (await fetch(`data:image/webp;base64,${b64}`)).blob());
    const pixels = (bitmap, w, h) => {
      const canvas = new OffscreenCanvas(w, h);
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(bitmap, 0, 0);
      return context.getImageData(0, 0, w, h).data;
    };
    const a = await load(before);
    const b = await load(after);
    const w = Math.max(a.width, b.width);
    const h = Math.max(a.height, b.height);
    const { compareRgba: compare, regionRect: rect } = window.__canvasDelta;
    /* Mapped onto the NEW picture's size: that is what the pin is drawn against from now on. */
    const rects = regions.map((region) => rect(region, b.width, b.height, margin));
    const result = compare(pixels(a, w, h), pixels(b, w, h), w, h, rects, tolerance);
    return { ...result, before: { w: a.width, h: a.height }, after: { w: b.width, h: b.height } };
  }, args);
}

/** Two decimals, and never "0.00%" for something that did change. */
const pct = (value) => (value > 0 && value < 0.01 ? "<0.01%" : `${value.toFixed(2)}%`);

/** The short hash a report records of a picture it was given, so a later attempt can tell its own "before" is this "after". */
export const pictureHash = (bytes) => createHash("sha256").update(bytes).digest("hex").slice(0, 16);

/**
 * THE TRUE ORIGINALS OF A RETRIED ROUND. A round that failed and is run again would compare each frame with the picture its own
 * first attempt wrote, so the reviewer's "before" would already be the new design. With `keepOriginals`, the report in `outDir`
 * from the earlier attempt is the record: a frame whose current picture is exactly what that attempt wrote (`afterHash`) is
 * compared with that attempt's own "before" (its saved file, nothing for a frame that was new, the same picture for one that was
 * identical). A picture that changed in between (another capture) breaks the chain and is compared as it is.
 *
 * Returns `{ earlier, originalOf(id, before) }`: `originalOf` gives the picture to compare against and whether it came from the
 * earlier attempt.
 */
export function originalsIn(outDir) {
  let earlier = new Map();
  try {
    earlier = new Map((JSON.parse(readFileSync(path.join(outDir, "delta.json"), "utf8")).frames ?? []).map((frame) => [frame.id, frame]));
  } catch {
    /* No earlier attempt in this folder. */
  }
  const originalOf = (id, before) => {
    const prior = earlier.get(id);
    if (!prior || !before || !prior.afterHash || prior.afterHash !== pictureHash(before)) return { before, carried: false };
    if (prior.status === "new") return { before: null, carried: true };
    const file = prior.beforeFile ? path.join(outDir, prior.beforeFile) : null;
    if (file && existsSync(file)) return { before: readFileSync(file), carried: true };
    return { before, carried: true };
  };
  return { earlier, originalOf };
}

/**
 * THE REPORT. `inputs` maps a screen id to `{ before, after, size }` (WebP bytes; `before` is null for a frame that was never
 * captured; `size` is the picture's `{ w, h }`). `comments` are the canvas's comments, for the regions. Writes `delta.json` and the previous pictures of the
 * frames that changed into `outDir`, prints one line per frame and a summary, and returns the frames. `keepOriginals` (a round's
 * own folder) compares with the true originals of an earlier failed attempt and keeps that attempt's other frames on record.
 */
export async function reportVisualChange({ context, inputs, comments, outDir, canvasSlug, flagPct = FLAG_PCT, log = console.log, keepOriginals = false }) {
  if (inputs.size === 0) return [];
  const notes = (comments ?? []).filter((one) => !one.kind || one.kind === "note");
  const { earlier, originalOf } = keepOriginals ? originalsIn(outDir) : { earlier: new Map(), originalOf: (id, before) => ({ before, carried: false }) };
  /* ONLY WHAT THIS REPORT WRITES IS CLEARED, never the folder: `--delta-out` names a directory the caller owns. The originals of
     an earlier attempt stay. */
  for (const name of [...(keepOriginals ? [] : ["before"]), "delta.json", "contact-sheet.html", "contact-sheet.png"]) rmSync(path.join(outDir, name), { recursive: true, force: true });
  mkdirSync(path.join(outDir, "before"), { recursive: true });
  const frames = [];
  const page = await context.newPage();
  try {
    await page.goto("about:blank");
    await page.addScriptTag({ content: PAGE_SCRIPT });
    for (const [id, input] of inputs) {
      const { after, size } = input;
      const { before, carried } = originalOf(id, input.before);
      const afterHash = pictureHash(after);
      const pushFrame = (frame) => frames.push({ ...frame, afterHash, ...(carried ? { sinceFirstAttempt: true } : {}) });
      const here = notes.filter((one) => one.screenId === id);
      const commentIds = here.map((one) => one.id);
      if (!before) {
        pushFrame({ id, status: "new", flag: null, changedPct: null, outsidePct: null, bbox: null, after: size ?? null, commentIds });
        continue;
      }
      /* The same bytes are the same picture: nothing to decode. Most frames of a recapture come out byte for byte as they were. */
      if (before.equals(after)) {
        pushFrame({ id, status: "identical", flag: null, changedPct: 0, outsidePct: 0, bbox: null, before: size ?? null, after: size ?? null, commentIds });
        continue;
      }
      let measured = null;
      try {
        measured = await measure(page, {
          before: before.toString("base64"),
          after: after.toString("base64"),
          regions: here.map((one) => one.region).filter(Boolean),
          tolerance: PIXEL_TOLERANCE,
          margin: REGION_MARGIN,
        });
      } catch (error) {
        pushFrame({ id, status: "unreadable", flag: null, changedPct: null, outsidePct: null, bbox: null, after: size ?? null, commentIds, why: String(error?.message ?? error).split("\n")[0] });
        continue;
      }
      const changedPct = (measured.changed / measured.total) * 100;
      const outsidePct = (measured.outside / measured.total) * 100;
      const sizeChanged = measured.before.w !== measured.after.w || measured.before.h !== measured.after.h;
      const verdict = judge({ changedPct, outsidePct, hasComments: commentIds.length > 0, sizeChanged, flagPct });
      const frame = {
        id,
        ...verdict,
        changedPct,
        outsidePct,
        bbox: measured.bbox,
        focusY: measured.focusY,
        before: measured.before,
        after: measured.after,
        commentIds,
      };
      if (verdict.status === "changed") {
        writeFileSync(path.join(outDir, "before", `${id}.webp`), before);
        frame.beforeFile = `before/${id}.webp`;
      }
      pushFrame(frame);
    }
  } finally {
    await page.close().catch(() => undefined);
  }
  /* An earlier attempt's frames this one did not retake stay on the round's record (and on its contact sheet). */
  const retaken = new Set(frames.map((frame) => frame.id));
  const kept = [...earlier.values()].filter((frame) => !retaken.has(frame.id));

  writeFileSync(
    path.join(outDir, "delta.json"),
    `${JSON.stringify({ canvas: canvasSlug, createdAt: new Date().toISOString(), flagPct, frames: [...frames, ...kept] }, null, 2)}\n`,
    "utf8",
  );

  const carriedOver = frames.filter((frame) => frame.sinceFirstAttempt).length;
  log(`\nvisual change against the previous shot (flagged above ${flagPct}%):${carriedOver > 0 ? ` ${carriedOver} frame(s) against the pictures this round started from, before its first attempt` : ""}`);
  for (const frame of frames) {
    const name = frame.id.padEnd(28);
    if (frame.status === "new") log(`  ${name} new frame, nothing to compare`);
    else if (frame.status === "unreadable") log(`  ${name} could not compare: ${frame.why}`);
    else if (frame.status === "identical") log(`  ${name} identical`);
    else {
      const size =
        frame.before.w !== frame.after.w || frame.before.h !== frame.after.h
          ? `  size ${frame.before.w}x${frame.before.h} -> ${frame.after.w}x${frame.after.h}`
          : "";
      const where = frame.commentIds.length > 0 ? `${pct(frame.outsidePct)} outside the commented region (${frame.commentIds.join(", ")})` : "no comment on this frame";
      log(`  ${name} ${pct(frame.changedPct).padStart(7)} changed, ${where}${size}${frame.flag ? `   FLAG: ${frame.flag}` : ""}`);
    }
  }
  const flagged = frames.filter((frame) => frame.flag);
  log(
    `${frames.length} frame(s) re-photographed: ${frames.filter((f) => f.status === "identical").length} identical, ` +
      `${frames.filter((f) => f.status === "changed").length} changed, ${frames.filter((f) => f.status === "new").length} new` +
      (flagged.length > 0 ? `; ${flagged.length} FLAGGED for changing where nobody asked: ${flagged.map((f) => f.id).join(", ")}` : "; none changed where nobody asked") +
      (kept.length > 0 ? `; ${kept.length} more from this round's earlier attempt kept on its record` : ""),
  );
  return frames;
}

/* ------------------------------------------------------------------ what an option no longer shows of today's screen */

/**
 * THE VISIBLE CONTROLS AND LABELS OF A PAGE, read by the capture beside its text and kept on the shot (`controls`): buttons, links,
 * tabs, menu items, fields and their labels, headings and column headers, each by its visible words (or its accessible name when
 * it has none), and every short line of the page's text with no digit in it (a card's label, a section's caption; a number, a
 * date or a sentence is data or prose, not a label). Self-contained: it runs in the page.
 */
export const CONTROLS = () => {
  const shown = (el) => {
    const box = el.getBoundingClientRect();
    if (box.width < 2 || box.height < 2) return false;
    const style = getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
  };
  const selector =
    'button,a[href],[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=switch],[role=radio],[role=combobox],' +
    "input:not([type=hidden]),select,textarea,label,h1,h2,h3,h4,h5,h6,th,[role=columnheader]";
  const out = [];
  for (const el of document.querySelectorAll(selector)) {
    if (!shown(el)) continue;
    let text = (el.innerText || "").replace(/\s+/g, " ").trim();
    if (!text) text = (el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.getAttribute("title") || "").replace(/\s+/g, " ").trim();
    if (text && text.length <= 80) out.push(text);
  }
  /* A line that holds a control's words is a row of controls run together (inline buttons), already listed one by one. */
  const named = [...new Set(out)];
  for (const line of (document.body?.innerText ?? "").split("\n")) {
    const text = line.replace(/\s+/g, " ").trim();
    if (text.length < 2 || text.length > 60 || !/\p{L}/u.test(text) || /\d/.test(text)) continue;
    if (!named.includes(text) && named.some((one) => text.includes(one))) continue;
    out.push(text);
  }
  return [...new Set(out)].slice(0, 400);
};

const sameWords = (text) => text.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * PER OPTION, WHAT TODAY'S SCREEN SHOWS THAT THE OPTION NO LONGER DOES: every exploration frame that declares `redesigns` against
 * that screen, compared by the controls and labels each picture recorded. `ids` limits it to the frames a run photographed (an
 * option frame, or the today's frame it redesigns). `removed` is null when either picture has no list on record yet.
 */
export function removedControls({ explorations, shots, ids = null }) {
  const byId = new Map((shots ?? []).map((shot) => [shot.screenId, shot]));
  const out = [];
  for (const exploration of explorations ?? []) {
    for (const screen of exploration.screens ?? []) {
      if (typeof screen.redesigns !== "string") continue;
      if (ids && !ids.has(screen.id) && !ids.has(screen.redesigns)) continue;
      const mine = byId.get(screen.id)?.controls;
      const today = byId.get(screen.redesigns)?.controls;
      const option = screen.under ?? screen.suggests ?? screen.id;
      if (!Array.isArray(mine) || !Array.isArray(today)) {
        out.push({ option, frame: screen.id, today: screen.redesigns, removed: null });
        continue;
      }
      const kept = new Set(mine.map(sameWords));
      out.push({ option, frame: screen.id, today: screen.redesigns, removed: today.filter((one) => !kept.has(sameWords(one))) });
    }
  }
  return out;
}

/** The list as printed, one line per option frame, or nothing when no option redesigns a screen. */
export function removedLines(list) {
  if (list.length === 0) return [];
  const lines = ["what each option no longer shows of today's screen (its controls and labels):"];
  for (const one of list) {
    const where = `  ${one.option}${one.frame === one.option ? "" : `, ${one.frame}`} against ${one.today}:`;
    if (one.removed === null) lines.push(`${where} not compared yet, a picture has no list of its controls (it is recorded at its next capture)`);
    else if (one.removed.length === 0) lines.push(`${where} nothing removed`);
    else lines.push(`${where} ${one.removed.map((text) => `"${text}"`).join(", ")}`);
  }
  return lines;
}
