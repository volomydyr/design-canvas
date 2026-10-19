/**
 * design-canvas — THE IMPORT WALK, shared by everything that has to know which project files a screen is made of.
 *
 * It lived inside `capture.mjs`, where it decides a frame's STAMP (what the picture was made from, so a changed-only run
 * recaptures what moved and nothing else). The reuse checks need the very same answer for a different question: which
 * components does the design new work builds from actually draw? Two walkers that resolve imports slightly differently would
 * mean a stamp that says "unchanged" while the checks say "this file is part of the design", so there is one walk, here, and
 * both read it.
 *
 * Every stamp on a manifest was computed by these rules, so changing one restamps every frame and marks every comment stale:
 *
 *   - `./` and `../` are relative to the importing file; a specifier that matches the project's tsconfig (or jsconfig) `paths`
 *     resolves where they say, against `baseUrl` when it is set; anything else is a package and is skipped, because
 *     `node_modules` cannot change without a lockfile change. A project with no `paths` gets `@/*` as the project root.
 *   - the extensions are tried in the order below, and then `index` files inside a folder;
 *   - a `.css` file is LISTED (editing it changes a picture) but never parsed;
 *   - a specifier that cannot be resolved is IGNORED, never guessed at. The failure mode has to be "recaptured something it
 *     did not need to", never "skipped something it should have taken".
 *
 * Deliberately NOT done, because it would change stamps: side-effect imports (`import "./x"`), which the pattern below does not
 * match.
 *
 * DELETE WITH: the design-canvas/ folder.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

export const IMPORT_RE = /(?:import|export)[\s\S]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;
export const EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".mjs", ".css"];

/** A tsconfig's text as JSON: tsconfig allows comments and trailing commas. */
const parseJsonc = (text) =>
  JSON.parse(
    text
      .replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (match) => (match.startsWith('"') ? match : ""))
      .replace(/,(\s*[}\]])/g, "$1"),
  );

/**
 * The `paths` of one config file, following a relative `extends` chain: `{ paths, base }`, where `base` is what the targets are
 * relative to (`baseUrl` when set, else the folder of the file that declared `paths`), or null when none declares them.
 */
function pathsOf(file, depth = 0) {
  let config;
  try {
    config = parseJsonc(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
  const dir = path.dirname(file);
  const options = config?.compilerOptions ?? {};
  const parentFile = typeof config?.extends === "string" && config.extends.startsWith(".") ? path.resolve(dir, config.extends) : null;
  const parent = parentFile && depth < 8 ? pathsOf(existsSync(parentFile) ? parentFile : `${parentFile}.json`, depth + 1) : null;
  const baseUrl = typeof options.baseUrl === "string" ? path.resolve(dir, options.baseUrl) : null;
  if (options.paths && typeof options.paths === "object") return { paths: options.paths, base: baseUrl ?? dir };
  if (parent && baseUrl) return { paths: parent.paths, base: baseUrl };
  return parent;
}

/**
 * The project's import aliases, longest prefix first: `{ prefix, suffix, star, targets }` per `paths` entry, each target an absolute
 * path with its `*` left in. Read from `tsconfig.json`, else `jsconfig.json`, at the project root, once per root. A project that
 * declares no `paths` gets `@/*` as the project root.
 */
const ALIASES = new Map();
export function aliasesOf(root) {
  if (ALIASES.has(root)) return ALIASES.get(root);
  const file = ["tsconfig.json", "jsconfig.json"].map((name) => path.join(root, name)).find((one) => existsSync(one));
  const found = (file && pathsOf(file)) || { paths: { "@/*": ["./*"] }, base: root };
  const aliases = Object.entries(found.paths)
    .filter(([, targets]) => Array.isArray(targets))
    .map(([pattern, targets]) => {
      const star = pattern.indexOf("*");
      return {
        prefix: star < 0 ? pattern : pattern.slice(0, star),
        suffix: star < 0 ? "" : pattern.slice(star + 1),
        star: star >= 0,
        targets: targets.filter((one) => typeof one === "string").map((one) => path.resolve(found.base, one)),
      };
    })
    .sort((a, b) => b.prefix.length - a.prefix.length);
  ALIASES.set(root, aliases);
  return aliases;
}

/** Every path a specifier may point at before any extension is tried, in the bundler's order. Empty for a package. */
function specifierBases(spec, fromFile, root) {
  if (spec.startsWith("./") || spec.startsWith("../")) return [path.resolve(path.dirname(fromFile), spec)];
  for (const alias of aliasesOf(root)) {
    const matches = alias.star
      ? spec.startsWith(alias.prefix) && spec.endsWith(alias.suffix) && spec.length >= alias.prefix.length + alias.suffix.length
      : spec === alias.prefix;
    if (!matches) continue;
    const middle = alias.star ? spec.slice(alias.prefix.length, spec.length - alias.suffix.length) : "";
    return alias.targets.map((target) => path.normalize(target.replace("*", middle)));
  }
  return [];
}

/** The path a project-relative specifier points at before any extension is tried (its first candidate), or null for a package. */
export const specifierBase = (spec, fromFile, root) => specifierBases(spec, fromFile, root)[0] ?? null;

/** Resolve one specifier against the project, the way the bundler would. Null when it is a package or cannot be resolved. */
export function resolveSpecifier(spec, fromFile, root) {
  for (const base of specifierBases(spec, fromFile, root)) {
    if (existsSync(base) && !statSync(base).isDirectory()) return base;
    for (const ext of EXTENSIONS) if (existsSync(base + ext)) return base + ext;
    for (const ext of EXTENSIONS) if (existsSync(path.join(base, "index" + ext))) return path.join(base, "index" + ext);
  }
  return null;
}

/** Every project file reachable from these entry files, entries included. Repo-relative, sorted. */
export function filesReachedFrom(entries, root) {
  const seen = new Set();
  const queue = [];
  for (const file of entries) {
    const at = path.join(root, file);
    if (existsSync(at)) queue.push(at);
  }
  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    if (!/\.(tsx?|jsx?|mjs)$/.test(file)) continue;
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const match of text.matchAll(IMPORT_RE)) {
      const spec = match[1] ?? match[2];
      if (!spec) continue;
      const next = resolveSpecifier(spec, file, root);
      if (next && !seen.has(next)) queue.push(next);
    }
  }
  return [...seen].map((at) => path.relative(root, at)).sort();
}

/* ------------------------------------------------------------------ the caches built from the walk (the registry, the index) */

/** Modification time of a file or folder in milliseconds, or null when it does not exist. */
export function mtimeOf(at) {
  try {
    return statSync(at).mtimeMs;
  } catch {
    return null;
  }
}

/** Does every recorded modification time (`{ <project-relative path>: <mtime> }`, one map or several) still hold? */
export const timesHold = (root, ...maps) =>
  maps.every((map) => map && typeof map === "object" && Object.entries(map).every(([rel, mtime]) => mtimeOf(path.join(root, rel)) === mtime));

/**
 * A JSON cache: the cached value when `fresh(cached)` says it still holds, otherwise `build()`, written back when it can be. A
 * cache that is missing or does not parse is built again, and one that cannot be written (a read-only checkout) is not an error.
 */
export async function cached(file, fresh, build) {
  try {
    const value = JSON.parse(readFileSync(file, "utf8"));
    if (fresh(value)) return value;
  } catch {
    /* No cache, or one that does not parse: build. */
  }
  const built = await build();
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(built));
  } catch {
    /* Read-only checkout: fine, the next call builds again. */
  }
  return built;
}
