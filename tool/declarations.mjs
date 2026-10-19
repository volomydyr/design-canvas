/**
 * design-canvas — READING A PROJECT'S DECLARATION FROM SOURCE, once, for every tool that needs it.
 *
 * `dump-screens.mjs` (which the capture, the preflight, and the round all read the declaration through) and
 * `review-build.mjs` each bundled `project/flows.ts` with esbuild on their own, in the same words ("bundled exactly as
 * dump-screens.mjs does it"), and a third reader was about to be added: the installer, which has to read the declaration a
 * project has TODAY to say what an upgrade will break. Three copies of a loader is how the next change to it
 * (variants, which every reader must expand) reaches two of them. So there is one.
 *
 * WHAT IT DOES. Bundles `<canvasDir>/project/flows.ts` (types erase, per-canvas files under `project/canvases/` fold in, and
 * nothing runs that the app does), imports the result, finds the registry or the bare declaration in it, and EXPANDS every
 * variants screen through `core/variants.ts`, which is bundled the same way from this file's own checkout or install, so the
 * expansion a tool applies is the core's own function and not a second copy of its rules.
 *
 * `canvasDir` is the `design-canvas/` folder whose declaration is read; it defaults to the folder this file sits in. The
 * installer passes the PROJECT's folder while running the SKILL's copy of this file, which is how it judges the declaration
 * against the new version's rules before anything is overwritten. esbuild is found from `canvasDir` first (a project carries
 * it) and from this file second.
 *
 * DELETE WITH: the design-canvas/ folder.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const OWN = path.dirname(fileURLToPath(import.meta.url));

/** esbuild, from the project being read first and from this file second. */
function esbuildFor(canvasDir) {
  for (const from of [canvasDir, OWN]) {
    try {
      return createRequire(path.join(from, "resolve-esbuild.cjs"))("esbuild");
    } catch {
      /* Not installed along this path. */
    }
  }
  throw new Error("esbuild is not installed for this project (npm install it: the declaration is read from source with it)");
}


/** One TypeScript entry bundled bare and imported. The temp folder is removed before this returns. */
async function importBundle(esbuild, entry) {
  const js = esbuild.buildSync({
    entryPoints: [entry],
    bundle: true,
    format: "esm",
    target: "node18",
    platform: "neutral",
    write: false,
  }).outputFiles[0].text;
  const dir = mkdtempSync(path.join(tmpdir(), "canvas-declaration-"));
  try {
    const file = path.join(dir, "bundle.mjs");
    writeFileSync(file, js);
    return await import(pathToFileURL(file).href);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * One of the core's modules, bundled and imported, or null when this checkout or install has no such file. The core sits
 * next to this file once installed and one folder up in the skill's checkout. Tools reach the core's own functions this way
 * rather than keeping a second copy of their rules.
 */
export async function importCore(name, canvasDir = OWN) {
  const file = [path.join(OWN, "core", name), path.join(OWN, "..", "core", name)].find((one) => existsSync(one));
  return file ? importBundle(esbuildFor(canvasDir), file) : null;
}

/**
 * Everything the project's declaration file exports, and the core's expansion. Throws a sentence when the file cannot be read
 * (no esbuild, a syntax error): the callers turn it into their own one-line stop.
 */
export async function loadDeclarations(canvasDir = OWN) {
  const source = path.join(canvasDir, "project", "flows.ts");
  if (!existsSync(source)) throw new Error(`there is no declaration at ${source}`);
  const esbuild = esbuildFor(canvasDir);
  const mod = await importBundle(esbuild, source);
  const variants = await importCore("variants.ts", canvasDir);
  const expand = variants ? variants.expandVariants : (declaration) => declaration;
  /* The registry is read first and a bare declaration second, so a project not yet upgraded to `CANVASES` still loads. */
  const registry =
    Object.values(mod).find(
      (value) => value && typeof value === "object" && !Array.isArray(value.flows) && Object.values(value).some((one) => one && Array.isArray(one.flows)),
    ) ?? null;
  const bare = Object.values(mod).find((value) => value && typeof value === "object" && Array.isArray(value.flows)) ?? null;
  return { source, registry, bare, expand };
}

/** The slugs a project declares: the registry's keys, or `main` for a bare declaration, or none. */
export function slugsOf(loaded) {
  return loaded.registry ? Object.keys(loaded.registry) : loaded.bare ? ["main"] : [];
}

/**
 * One canvas's declaration, EXPANDED, chosen the way `dump-screens.mjs` always chose it: by slug when the project has several,
 * by being the only one when it does not. Returns `{ declaration }` or `{ error }` (one sentence, for the caller to print).
 */
export function declarationFor(loaded, wanted) {
  let declaration = null;
  if (loaded.registry) {
    const names = Object.keys(loaded.registry);
    if (wanted) {
      declaration = loaded.registry[wanted];
      if (!declaration) return { error: `No canvas called "${wanted}" in ${loaded.source}. This project has: ${names.join(", ")}.` };
    } else if (names.length === 1) declaration = loaded.registry[names[0]];
    else return { error: `${loaded.source} declares several canvases (${names.join(", ")}). Name one with --canvas <slug>.` };
  } else declaration = loaded.bare;
  if (!declaration) return { error: `No canvas declaration found in ${loaded.source}: expected a \`CANVASES\` record, or an export with a \`flows\` array.` };
  try {
    return { declaration: loaded.expand(declaration) };
  } catch (error) {
    return { error: String(error?.message ?? error).split("\n")[0] };
  }
}
