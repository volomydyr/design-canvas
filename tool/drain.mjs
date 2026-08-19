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
 *
 * `--all` IS NOT A SHORTCUT FOR BEING DONE. It exists for the case where a round is genuinely finished, and it
 * prints every id it touches so the claim is auditable afterwards.
 *
 * DELETE WITH: the design-canvas/ folder.
 */
const argv = process.argv.slice(2);
const argOf = (name) => {
  const at = argv.indexOf(`--${name}`);
  return at === -1 ? null : argv[at + 1];
};
const has = (name) => argv.includes(`--${name}`);

const canvas = argOf("canvas") ?? "main";
const url = argOf("url") ?? "http://localhost:3000";
const endpoint = `${url}/api/design-canvas/comments?canvas=${encodeURIComponent(canvas)}`;

async function read() {
  const response = await fetch(endpoint);
  if (!response.ok) {
    console.error(
      `the comments route answered ${response.status} — is the dev server on ${url}?`,
    );
    process.exit(1);
  }
  const body = await response.json();
  return body.comments ?? [];
}

const comments = await read();
const open = comments.filter((one) => !one.consumedAt);

if (has("list") || (!has("all") && !argOf("ids"))) {
  console.log(`${comments.length} comment(s) on ${canvas}, ${open.length} not yet worked`);
  for (const one of open)
    console.log(
      `  ${one.id}  ${one.screenId ?? "(no screen)"}  ${(one.note ?? "").slice(0, 72).replace(/\s+/g, " ")}`,
    );
  if (!has("list"))
    console.log("\nnothing drained: name them with --ids c1,c2 or pass --all");
  process.exit(0);
}

const wanted = has("all")
  ? open.map((one) => one.id)
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
console.log(
  after.length === 0
    ? "nothing is waiting on this canvas now"
    : `still waiting: ${after.map((one) => one.id).join(", ")}`,
);
