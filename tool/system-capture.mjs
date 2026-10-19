#!/usr/bin/env node
/**
 * design-canvas — photograph the design system.
 *
 *   node design-canvas/system-capture.mjs [--only button,input] [--url <address>]
 *
 * The address, the saved session and the browser come from design-canvas/settings.json, like every other tool (no default port).
 *
 * Every cell of every component set `design-canvas/project/system.tsx` declares, rendered alone on the specimen page
 * (`/design-canvas/system/<set>`) and shot at 2x into `design-canvas/shots/_system/<set>/`. A `manifest.json` beside the
 * pictures is what the Design System tab draws from: the sets, their rows and columns, and each picture's size.
 *
 * EACH PICTURE IS TAKEN WHEN TWO SHOTS AGREE (`stableShot`, as in the screen capture), so a part that animates in is shot at rest.
 *
 * HOVER, FOCUS AND PRESS ARE FORCED, NOT PERFORMED. The browser's devtools protocol sets the pseudo-class on the part's
 * first element (`CSS.forcePseudoState`), so no pointer moves, no cell disturbs another, and the picture is the CSS the
 * product ships. A part whose hover lives on a child rather than its root is a specimen to write differently, not a
 * reason to move a mouse.
 *
 * `--only` reshoots the named sets and keeps the others' pictures. Read only: every write request is refused, as in
 * every other browser this tool opens.
 *
 * DELETE WITH: the design-canvas/ folder.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { closeBrowser, hideDevOverlay, launchBrowser, openContext, requireStorageState, stableShot } from "./browser-guards.mjs";
import { loadSettings, requireAppUrl } from "./project-settings.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "shots", "_system");

const argOf = (name) => {
  const at = process.argv.indexOf(`--${name}`);
  if (at > -1) return process.argv[at + 1];
  const eq = process.argv.find((one) => one.startsWith(`--${name}=`));
  return eq ? eq.slice(name.length + 3) : undefined;
};

const settings = loadSettings(HERE, "system-capture");
const base = (argOf("url") ?? requireAppUrl(settings, "system-capture")).replace(/\/$/, "");
const only = (argOf("only") ?? "").split(",").map((one) => one.trim()).filter(Boolean);
/* A named session file that is missing stops the run with the fix, as in the capture. */
const storageState = settings.storageState ?? undefined;
requireStorageState("system-capture", storageState, base);

const { chromium } = await import("playwright");
const browser = await launchBrowser(chromium, { who: "system-capture", channel: settings.browserChannel, storageState });
let failed = false;
try {
  const context = await openContext(
    browser,
    { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, storageState },
    { who: "system-capture", storageState, origin: base },
  );
  const page = await context.newPage();
  /* A specimen that throws never says it is ready; the error is the useful half of that timeout, so keep the last few. */
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error.message).split("\n")[0]));
  /* A DEV SERVER UNDER LOAD SOMETIMES FAILS TO SERVE A CHUNK ("Loading chunk app/layout failed"), and that page never
     starts. Reload it, up to three times, rather than wait four minutes on a page that is already dead. */
  const waitReady = async (what) => {
    for (let attempt = 1; ; attempt += 1) {
      const before = pageErrors.length;
      /* A healthy page is ready in a few seconds; a dead one never is, so the first wait is short and a reload follows. */
      const ready = await page.waitForSelector("[data-system-ready]", { state: "attached", timeout: attempt === 1 ? 20000 : 90000 }).then(() => true, () => false);
      if (ready) return hideDevOverlay(page);
      const fresh = pageErrors.slice(before);
      if (attempt >= 3)
        throw new Error(`${what} never became ready${pageErrors.length ? `: ${pageErrors.slice(-3).join(" | ")}` : ""}`);
      console.log(`  ${what}: not ready${fresh.length ? ` (${fresh[0]})` : ""}, reloading`);
      await page.reload({ waitUntil: "load", timeout: 240000 });
    }
  };

  /* A PART THAT MOVES (a number counting up, a spring) is shot when two shots agree, as the screen capture does: one shot would
     catch it mid-flight. A part that never stops is noted and kept as its last shot. */
  const still = async (what, clip) => {
    const { image, stable } = await stableShot(page, () => page.screenshot({ clip }));
    if (!stable) console.log(`  ${what}: never the same picture twice, still moving; its last shot is kept`);
    return image;
  };

  const describe = async (set) => {
    await page.goto(`${base}/design-canvas/system/${set}`, { waitUntil: "load", timeout: 240000 });
    /* A dev server compiling the page under load has taken longer than a minute. */
    await page.waitForSelector("#canvas-system", { state: "attached", timeout: 240000 });
    await waitReady(`/design-canvas/system/${set}`);
    return JSON.parse(await page.$eval("#canvas-system", (node) => node.textContent ?? "{}"));
  };

  const listed = await describe("_");
  if (listed.problems?.length) {
    console.error(`The design system declaration has problems, so nothing was shot:\n  ${listed.problems.join("\n  ")}`);
    process.exitCode = 1;
    failed = true;
  } else {
    const previous = (() => {
      try {
        return JSON.parse(fs.readFileSync(path.join(OUT, "manifest.json"), "utf8"));
      } catch {
        return { sets: [] };
      }
    })();
    const unknown = only.filter((id) => !listed.sets.some((set) => set.id === id));
    if (unknown.length) {
      console.error(`No set called ${unknown.join(", ")}. Declared: ${listed.sets.map((set) => set.id).join(", ")}`);
      process.exitCode = 1;
      failed = true;
    }
    const sets = [];
    const client = await context.newCDPSession(page);
    await client.send("DOM.enable");
    await client.send("CSS.enable");
    for (const declared of listed.sets) {
      if (failed) break;
      if (only.length && !only.includes(declared.id)) {
        /* Not reshot: its pictures and sizes carry over, under the declaration as it stands now. */
        const kept = previous.sets.find((set) => set.id === declared.id);
        if (kept) sets.push({ ...kept, name: declared.name, level: declared.level, group: declared.group, source: declared.source });
        continue;
      }
      const started = Date.now();
      const described = (await describe(declared.id)).sets.find((set) => set.id === declared.id);
      await page.waitForTimeout(300);
      const dir = path.join(OUT, declared.id);
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
      let { root } = await client.send("DOM.getDocument", { depth: 0 });
      /* An overlay block navigates away to shoot each cell alone; the next in-page block comes back first. */
      let awayFromSet = false;
      const blocks = [];
      let shot = 0;
      for (const block of described.blocks) {
        const cells = {};
        if (!block.overlay && awayFromSet) {
          await describe(declared.id);
          await page.waitForTimeout(300);
          ({ root } = await client.send("DOM.getDocument", { depth: 0 }));
          awayFromSet = false;
        }
        if (block.overlay) awayFromSet = true;
        for (const [key, force] of Object.entries(block.cells)) {
          const file = `${key.replace(/\//g, "--")}.png`;
          let bytes;
          let size;
          if (block.overlay) {
            /* AN OVERLAY IS SHOT ALONE: its cell on a page of its own, the mask and anything else covering the window
               hidden, and only the overlay itself in the picture. */
            await page.goto(`${base}/design-canvas/system/${declared.id}?cell=${encodeURIComponent(key)}`, { waitUntil: "load", timeout: 120000 });
            await waitReady(`${declared.id} ${key}`);
            if (!(await page.$(`[data-system-cell="${key}"]`))) continue; /* render returned null: the combination does not exist */
            /* An overlay mounts through a portal a beat after its cell: wait for it rather than for a fixed time. */
            await page.waitForSelector(block.overlay.shoot, { state: "visible", timeout: 30000 }).catch(() => null);
            await page.waitForTimeout(400);
            const clip = await page.evaluate((selector) => {
              const found = [...document.querySelectorAll(selector)].filter((el) => {
                const r = el.getBoundingClientRect();
                return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
              });
              const target = found[found.length - 1];
              if (!target) return null;
              for (const el of document.body.querySelectorAll("*")) {
                if (el.contains(target) || target.contains(el)) continue;
                const st = getComputedStyle(el);
                const r = el.getBoundingClientRect();
                if (st.position === "fixed" && r.width >= innerWidth * 0.9 && r.height >= innerHeight * 0.9) el.style.visibility = "hidden";
              }
              /* Nothing of the specimen page shows behind the overlay. */
              /* Except the cell that holds the overlay itself: a bar drawn in place (not portalled) lives inside it. */
              for (const cell of document.querySelectorAll("[data-system-cell]")) if (!cell.contains(target)) cell.style.visibility = "hidden";
              const r = target.getBoundingClientRect();
              const pad = 24;
              const x = Math.max(0, Math.ceil(r.left - pad));
              const y = Math.max(0, Math.ceil(r.top - pad));
              return { x, y, width: Math.min(innerWidth, Math.floor(r.right + pad)) - x, height: Math.min(innerHeight, Math.floor(r.bottom + pad)) - y };
            }, block.overlay.shoot);
            if (!clip) {
              console.error(`  ${declared.id} ${key}: nothing matched ${block.overlay.shoot}`);
              process.exitCode = 1;
              continue;
            }
            await page.waitForTimeout(150);
            bytes = await still(`${declared.id} ${key}`, clip);
            size = clip;
          } else {
            const cell = await page.$(`[data-system-cell="${key}"]`);
            if (!cell) continue; /* render returned null: the combination does not exist */
            let forcedOn = null;
            if (force) {
              /* WHERE A FORCED STATE LANDS: the element a specimen marks with `data-system-state`, else the first focusable
                 element inside the part (a search field's input, not its wrapper), else the part's first element. */
              const tryOne = async (selector) => (await client.send("DOM.querySelector", { nodeId: root.nodeId, selector })).nodeId;
              const inside = `[data-system-cell="${key}"] [data-system-target]`;
              const nodeId =
                (await tryOne(`${inside} [data-system-state]`)) ||
                (await tryOne(`${inside} :is(button, a[href], input, textarea, select, [tabindex]:not([tabindex="-1"]))`)) ||
                (await tryOne(`${inside} > *`));
              if (nodeId) {
                const classes = force === "focus" ? ["focus", "focus-visible"] : [force];
                await client.send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: classes });
                forcedOn = nodeId;
              }
            }
            /* WHOLE PIXELS INSIDE THE CELL. A part's width is often fractional, and an element shot rounds outward, so its
               edge carried a one-pixel sliver of the page behind it: a faint line between every column on the canvas. */
            await cell.scrollIntoViewIfNeeded();
            const raw = await cell.boundingBox();
            const left = Math.ceil(raw.x);
            const top = Math.ceil(raw.y);
            size = { x: left, y: top, width: Math.floor(raw.x + raw.width) - left, height: Math.floor(raw.y + raw.height) - top };
            bytes = await still(`${declared.id} ${key}`, size);
            if (forcedOn) await client.send("CSS.forcePseudoState", { nodeId: forcedOn, forcedPseudoClasses: [] });
          }
          fs.writeFileSync(path.join(dir, file), bytes);
          cells[key] = {
            w: Math.round(size.width),
            h: Math.round(size.height),
            hash: createHash("sha1").update(bytes).digest("hex").slice(0, 12),
          };
          shot += 1;
        }
        blocks.push({ id: block.id, title: block.title, ...(block.overlay ? { overlay: block.overlay } : {}), rows: block.rows, columns: block.columns.map(({ id, label }) => ({ id, label })), cells });
      }
      sets.push({ id: declared.id, name: declared.name, level: declared.level, group: declared.group, source: declared.source, blocks });
      console.log(`  ${declared.id}: ${shot} picture(s) in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    }
    if (!failed) {
      fs.mkdirSync(OUT, { recursive: true });
      fs.writeFileSync(path.join(OUT, "manifest.json"), `${JSON.stringify({ builtAt: new Date().toISOString(), sets }, null, 2)}\n`);
      console.log(`design system: ${sets.length} set(s) in design-canvas/shots/_system/manifest.json`);
    }
  }
} finally {
  await closeBrowser(browser);
}
