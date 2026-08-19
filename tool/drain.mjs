#!/usr/bin/env node
/**
 * design-canvas — MARK COMMENTS AS WORKED, in one command instead of one fetch each.
 *
 * A round ends with the agent telling the canvas which comments it has acted on, so the review bar can offer them
 * back for approval. That is a `PATCH { id, consumed: true }` per comment, and it was being done by hand: a
 * throwaway script per batch, a list of ids typed out, and the round trip read back to check. Fourteen comments is
 * fourteen chances to miss one — which happened twice in one session, and each time the owner saw work he had
 * already given still sitting in the queue: *"why do my comments still are not marked as updated?"*
 *
 * It is entirely mechanical, so it costs tokens for no reason. Hence a script.
 *
 *   node design-canvas/drain.mjs --canvas checkout --ids c40,c41,c46
 *   node design-canvas/drain.mjs --canvas checkout --all            # every unconsumed comment
 *   node design-canvas/drain.mjs --canvas checkout --list           # what is open, and nothing else
 *   node design-canvas/drain.mjs --canvas checkout --orphans        # only the ones with no screen left
 *
 * `--url` DEFAULTS TO PORT 3000 ON PURPOSE, because this is shared with people whose projects run there. A
 * project on another port should carry it in its own npm script, the way `canvas:check` already does; the
 * installer writes one.
 *
 * `--all` IS NOT A SHORTCUT FOR BEING DONE. It exists for the case where a round is genuinely finished, and it
 * prints every id it touches so the claim is auditable afterwards.
 *
 * DELETE WITH: the design-canvas/ folder.
 */
import { readFileSync } from "node:fs";

const argv = process.argv.slice(2);
const argOf = (name) => {
  const at = argv.indexOf(`--${name}`);
  return at === -1 ? null : argv[at + 1];
};
const has = (name) => argv.includes(`--${name}`);

const canvas = argOf("canvas") ?? "main";
const url = argOf("url") ?? "http://localhost:3000";
const endpoint = `${url}/api/design-canvas/comments?canvas=${encodeURIComponent(canvas)}`;

/**
 * THE PORT THIS PROJECT ACTUALLY RUNS ON, read out of its own dev script, and only ever used to write a better
 * error.
 *
 * The default stays 3000 deliberately — this tool is shared, and most projects are there. But a project on
 * another port fails with a bare ECONNREFUSED, which is what happened here: the drain of a finished round died
 * on port 3000 while the app was on 3040, and the port was recorded only in `package.json`. So the failure now
 * reads the script and hands back the command that would have worked, instead of leaving it to be guessed.
 */
function portFromPackage() {
  try {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    for (const script of Object.values(pkg.scripts ?? {})) {
      const found = /--port[= ](\d{2,5})/.exec(String(script));
      if (found) return found[1];
    }
  } catch {
    /* No package.json, or not JSON. The plain error below is all there is to say. */
  }
  return null;
}

function cannotReach(detail) {
  console.error(`the comments route ${detail} at ${url}`);
  const port = portFromPackage();
  if (port && !url.includes(`:${port}`))
    console.error(
      `this project's own scripts use port ${port}. Try:\n  node design-canvas/drain.mjs --canvas ${canvas} --url http://localhost:${port} ${argv.slice(argv.indexOf("--canvas") + 2).join(" ")}`.trimEnd(),
    );
  else console.error("is the dev server running?");
  process.exit(1);
}

async function read() {
  let response;
  try {
    response = await fetch(endpoint);
  } catch {
    cannotReach("could not be reached");
    return [];
  }
  if (!response.ok) {
    cannotReach(`answered ${response.status}`);
    return [];
  }
  const body = await response.json();
  return body.comments ?? [];
}

/**
 * WHICH SCREENS THIS CANVAS STILL DECLARES, so an orphan can be told apart from work.
 *
 * A comment outlives the screen it was left on: an exploration is decided and deleted, and its verdicts stay in
 * the file with nothing to open. That is deliberate — an unread note travels whether or not its frame survived,
 * or a round quietly loses words — but this script was reporting them as `still waiting` with no explanation,
 * round after round, so the pile never reached zero and nobody could tell what was left to do. Measured on this
 * project: nine verdicts on a deleted domain exploration, listed as waiting after every drain.
 *
 * A canvas with no screens endpoint (an older install) simply gets no orphan reporting rather than an error.
 */
async function declaredScreens() {
  try {
    const response = await fetch(
      `${url}/api/design-canvas/shots?canvas=${encodeURIComponent(canvas)}&screens=1`,
    );
    if (!response.ok) return null;
    const body = await response.json();
    const ids = (body.screens ?? []).map((one) => one.id);
    return ids.length > 0 ? new Set(ids) : null;
  } catch {
    return null;
  }
}

const comments = await read();
const declared = await declaredScreens();
const isOrphan = (one) => declared !== null && !declared.has(one.screenId);
const open = comments.filter((one) => !one.consumedAt);
const orphans = open.filter(isOrphan);

if (has("list") || (!has("all") && !has("orphans") && !argOf("ids"))) {
  console.log(`${comments.length} comment(s) on ${canvas}, ${open.length} not yet worked`);
  for (const one of open)
    console.log(
      `  ${one.id}${isOrphan(one) ? " [no screen]" : "          "}  ${one.screenId ?? "(no screen)"}  ${(one.note ?? "").slice(0, 72).replace(/\s+/g, " ")}`,
    );
  if (orphans.length > 0)
    console.log(
      `\n${orphans.length} of them point at screens this canvas no longer declares, so there is nothing to open:\n` +
        `  read the note, decide whether it still applies, and drain it either way — \`--orphans\` does exactly those.`,
    );
  if (!has("list"))
    console.log("\nnothing drained: name them with --ids c1,c2 or pass --all");
  process.exit(0);
}

const wanted = has("all")
  ? open.map((one) => one.id)
  : has("orphans")
  ? orphans.map((one) => one.id)
  : String(argOf("ids") ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);

if (wanted.length === 0) {
  console.log("no ids given, nothing to do");
  process.exit(0);
}

/* An id that is not in the file at all is a typo, and drowning it in a list of successes is how a comment gets
   quietly left behind. */
const known = new Set(comments.map((one) => one.id));
const unknown = wanted.filter((id) => !known.has(id));
const already = wanted.filter((id) =>
  comments.some((one) => one.id === id && one.consumedAt),
);

let drained = 0;
for (const id of wanted) {
  if (!known.has(id)) continue;
  const response = await fetch(endpoint, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, consumed: true }),
  });
  if (response.ok) drained += 1;
  else console.error(`  ${id}: the route answered ${response.status}`);
}

const after = (await read()).filter((one) => !one.consumedAt);
console.log(
  `drained ${drained} of ${wanted.length}: ${wanted.filter((id) => known.has(id)).join(", ") || "none"}`,
);
if (already.length > 0)
  console.log(`already worked before this run: ${already.join(", ")}`);
if (unknown.length > 0) {
  console.error(`NOT IN THE FILE: ${unknown.join(", ")}`);
  process.exitCode = 1;
}
const leftOrphans = after.filter(isOrphan);
console.log(
  after.length === 0
    ? "nothing is waiting on this canvas now"
    : `still waiting: ${after.map((one) => one.id).join(", ")}`,
);
if (leftOrphans.length > 0)
  console.log(
    `  ${leftOrphans.length} of those (${leftOrphans.map((one) => one.id).join(", ")}) have no screen on this ` +
      `canvas any more — they are not work you missed. \`--orphans\` clears them once you have read them.`,
  );
