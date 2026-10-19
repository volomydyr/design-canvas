#!/usr/bin/env node
/**
 * design-canvas: build `tool/canvas.css`, the canvas's own stylesheet, which every canvas page imports.
 *
 *   node <skill>/scripts/build-canvas-css.mjs --with <a project that has tailwindcss 3 and postcss installed>
 *
 * The core is styled with Tailwind classes, built once here with Tailwind's default theme and its base styles into this file, which
 * the two canvas page stubs import in every project, with or without Tailwind (the installer adds the import). Run it after any change to a class in core/ or tool/*.tsx; the
 * tool suite fails while the shipped file is out of date.
 *
 * DELETE WITH: the design-canvas/ folder's installer.
 */
import { readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const CANVAS_CSS = path.join(SKILL, "tool", "canvas.css");

/** The files whose classes the stylesheet holds: what a Tailwind project's `./design-canvas/**` glob reaches of the shipped files. */
const sources = () =>
  [
    ...readdirSync(path.join(SKILL, "core")).filter((name) => /\.tsx?$/.test(name)).map((name) => path.join(SKILL, "core", name)),
    ...readdirSync(path.join(SKILL, "tool")).filter((name) => name.endsWith(".tsx")).map((name) => path.join(SKILL, "tool", name)),
  ].sort();

/** The stylesheet's text, built with the Tailwind 3 and PostCSS that `project` has installed. */
export async function buildCanvasCss(project) {
  const require = createRequire(path.join(project, "package.json"));
  const version = require("tailwindcss/package.json").version;
  if (!version.startsWith("3.")) throw new Error(`tailwindcss ${version} in ${project}: the stylesheet is built with Tailwind 3`);
  const tailwind = require("tailwindcss");
  const postcss = (await import(pathToFileURL(require.resolve("postcss")).href)).default;
  const config = { content: sources(), theme: { extend: {} }, plugins: [] };
  const built = await postcss([tailwind(config)]).process("@tailwind base;\n@tailwind components;\n@tailwind utilities;\n", { from: undefined });
  return (
    `/* The design canvas's styles for a project without Tailwind: the classes the canvas uses, built with tailwindcss ${version}\n` +
    `   by scripts/build-canvas-css.mjs. Imported by the canvas pages only. Generated: do not edit.\n` +
    `   DELETE WITH: the design-canvas/ folder. */\n${built.css.trim()}\n`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const at = process.argv.indexOf("--with");
  if (at < 0 || !process.argv[at + 1]) {
    console.error("build-canvas-css: pass --with <a project that has tailwindcss 3 and postcss installed>");
    process.exit(1);
  }
  writeFileSync(CANVAS_CSS, await buildCanvasCss(path.resolve(process.argv[at + 1])));
  console.log(`wrote ${path.relative(process.cwd(), CANVAS_CSS)}`);
}
