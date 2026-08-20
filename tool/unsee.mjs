#!/usr/bin/env node
/**
 * design-canvas — PUT SCREENS BACK IN THE NEW QUEUE, which is what retiring an exploration owes the reviewer.
 *
 * WHY THIS EXISTS. The new-screens queue is driven by `seen` in the review file: an id in that list is old, an id
 * missing from it is new. The API only ever ADDS to `seen` — a union, so a stray reload cannot un-see anything by
 * accident — and that is right for every case except one: the moment an approved exploration is promoted into the
 * two permanent views.
 *
 * THE OWNER'S REASON, which is the whole point of the script: *"when I approve the designs from the exploration
 * and you move them to the other two tabs, it is actually important to mark them as the new screens because it is
 * very typical that in the exploration you show only, let's say the most important parts of the design but when
 * you connect it to the user flow so it consists of many more screens that are related to the thing that we
 * approved and picked to use as our design."*
 *
 * So promotion is never one frame changing tabs. It is one approved idea fanning out across every state that
 * carries it: some brand new ids, which flag by themselves, and some screens that ALREADY existed and whose
 * design just changed. Those second ones sit in `seen` already, so without this they arrive silently and the
 * reviewer never walks them. That is exactly what happened on the custom-domain retirement, where the winner
 * landed on two existing states and neither was offered.
 *
 *   node design-canvas/unsee.mjs --canvas custom-domain --ids domain-answering,domain-securing
 *   node design-canvas/unsee.mjs --canvas custom-domain --list     # what `seen` currently holds
 *
 * IT EDITS THE REVIEW FILE DIRECTLY rather than going through the route, because the route's `seen` handler is a
 * union by design and widening it to accept removals would make an accidental un-see reachable from the browser.
 * A deliberate, named, command-line act is the right shape for the one case that needs it. The file is local and
 * gitignored, and the canvas re-reads it on load, so there is nothing to race with but the reviewer's own tab.
 *
 * DELETE WITH: the design-canvas/ folder.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const argv = process.argv.slice(2);
const argOf = (name) => {
  const at = argv.indexOf(`--${name}`);
  return at === -1 ? null : argv[at + 1];
};
const has = (name) => argv.includes(`--${name}`);

const canvas = argOf("canvas") ?? "main";

/* BOTH LAYOUTS, the same two `pathsFor` serves in the route: a namespaced file for a canvas installed since slugs
   existed, and the flat one a single-canvas install still carries. */
const candidates = [
  `design-canvas/comments/${canvas}.json`,
  ...(canvas === "main" ? ["design-canvas/comments.json"] : []),
];
const file = candidates.find((one) => existsSync(one));

if (!file) {
  console.error(`no review file for canvas "${canvas}" — looked for:`);
  for (const one of candidates) console.error(`  ${one}`);
  console.error("nothing has been reviewed here yet, so no screen is marked seen and every one is already new.");
  process.exit(1);
}

const body = JSON.parse(readFileSync(file, "utf8"));
const seen = Array.isArray(body.seen) ? body.seen : [];

if (has("list")) {
  console.log(`${seen.length} screen(s) marked seen on ${canvas}:`);
  for (const id of seen) console.log(`  ${id}`);
  process.exit(0);
}

const ids = (argOf("ids") ?? "")
  .split(",")
  .map((one) => one.trim())
  .filter(Boolean);

if (ids.length === 0) {
  console.error("nothing to do: pass --ids a,b,c (or --list to see what is marked seen)");
  process.exit(1);
}

/* SAY WHICH IDS WERE NOT THERE rather than reporting a success that removed nothing. An id absent from `seen` is
   either already new or misspelt, and the second is the mistake worth catching. */
const removed = ids.filter((id) => seen.includes(id));
const missing = ids.filter((id) => !seen.includes(id));

body.seen = seen.filter((id) => !ids.includes(id));
/* `updatedAt` is what the canvas and the checker read to know the file moved. */
body.updatedAt = new Date().toISOString();
writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`);

console.log(`${file}: ${removed.length} of ${ids.length} put back in the new queue`);
if (removed.length > 0) console.log(`  new again: ${removed.join(", ")}`);
if (missing.length > 0) {
  console.log(`  not in seen, so already new (or misspelt): ${missing.join(", ")}`);
}
console.log(`${body.seen.length} screen(s) still marked seen`);
