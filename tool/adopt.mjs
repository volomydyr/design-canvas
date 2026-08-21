#!/usr/bin/env node
/**
 * design-canvas — ADOPT EVERY SCREEN AS SEEN, which is what a canvas's first delivery owes the reviewer.
 *
 * WHY THIS EXISTS. The new-screens queue marks ids missing from `seen`, and it is meaningful only against a
 * baseline: a screen is "new" because it arrived among screens that were already there. On a FIRST delivery
 * there is no baseline — every screen is new, so marking any of them is noise, and marking all of them is the
 * exploration-tab mistake in the permanent views. The owner's rule, verbatim: *"during the first capture ALL
 * THE SCREENS are new, so why would you mark them? you dont mark them the same way you dont on the exploration
 * tab (cause they are also all new there). you start marking them only afterwards when you genuinely create a
 * new screen/screens."*
 *
 * WHAT WENT WRONG WITHOUT IT. The view seeds `seen` with everything declared the first time the canvas page is
 * opened with no review file — but agents open that page too: every oracle run visits the canvas. So the
 * baseline froze at whatever the declaration held mid-build, and a screen redeclared afterwards arrived at
 * handover wearing a mark the reviewer never asked for, on a canvas they had not reviewed once.
 *
 * SO: run this as the LAST step of a canvas's first delivery, before handing over the URL. Every currently
 * declared screen is unioned into `seen`, the reviewer starts at zero marks, and from then on the queue means
 * what it says — screens genuinely added to a canvas that was already delivered.
 *
 *   node design-canvas/adopt.mjs --canvas orders
 *   node design-canvas/adopt.mjs --canvas orders --list     # what `seen` currently holds
 *
 * IT EDITS THE REVIEW FILE DIRECTLY, same as `unsee.mjs` and for the same reason: a deliberate, named,
 * command-line act, not something reachable from the browser. The declared ids come from `dump-screens.mjs`,
 * the same reading of the declaration the capture uses, so this can never adopt a different set of screens
 * than the canvas draws. Exploration frames and explanation panels are excluded exactly as the queue excludes
 * them.
 *
 * DELETE WITH: the design-canvas/ folder.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const argOf = (name) => {
  const at = argv.indexOf(`--${name}`);
  return at === -1 ? null : argv[at + 1];
};
const has = (name) => argv.includes(`--${name}`);

const canvas = argOf("canvas") ?? "main";

/* BOTH LAYOUTS, the same two `pathsFor` serves in the route: a namespaced file for a canvas installed since
   slugs existed, and the flat one a single-canvas install still carries. */
const candidates = [
  path.join(HERE, "comments", `${canvas}.json`),
  ...(canvas === "main" ? [path.join(HERE, "comments.json")] : []),
];
const file = candidates.find((one) => existsSync(one)) ?? candidates[0];
const parsed = existsSync(file)
  ? JSON.parse(readFileSync(file, "utf8"))
  : { comments: [] };
const seen = new Set(Array.isArray(parsed.seen) ? parsed.seen : []);

if (has("list")) {
  console.log([...seen].join("\n") || "(nothing seen yet)");
  process.exit(0);
}

/* The declaration, read the one honest way. `view` separates the permanent views from the exploration, and an
   explanation panel has no url — the queue counts neither, so neither is adopted. */
const dumped = spawnSync("node", [path.join(HERE, "dump-screens.mjs"), "--canvas", canvas], {
  encoding: "utf8",
});
if (dumped.status !== 0) {
  console.error(dumped.stderr || "could not read the declaration");
  process.exit(1);
}
const { screens } = JSON.parse(dumped.stdout);
const ids = screens
  .filter((one) => one.view !== "exploration" && one.url !== null)
  .map((one) => one.id);

const before = seen.size;
for (const id of ids) seen.add(id);
parsed.seen = [...seen];
mkdirSync(path.dirname(file), { recursive: true });
writeFileSync(file, `${JSON.stringify(parsed, null, 2)}\n`);
console.log(
  `${canvas}: adopted ${ids.length} screen(s), ${seen.size - before} newly seen — the reviewer starts at zero marks`,
);
