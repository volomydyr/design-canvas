#!/usr/bin/env node
/**
 * design-canvas — MARK COMMENTS AS WORKED, in one command.
 *
 * A round ends with the agent telling the canvas which comments it has acted on, so the review bar can offer them back for
 * approval. This sends that as one request and reads the result back, so no id is missed or typed twice.
 *
 *   node design-canvas/drain.mjs --canvas trips --list              # every open comment in full: its kind (note, like,
 *                                                                  # dislike), its whole note, the earlier rounds of a
 *                                                                  # reopened one, and the other frames a fix reaches
 *   node design-canvas/drain.mjs --canvas trips --ids c40,c41,c46
 *   node design-canvas/drain.mjs --canvas trips --all               # every unconsumed comment
 *   node design-canvas/drain.mjs --canvas trips --ids c32 --answer-file answer.txt
 *                                                                  # a comment that asked something: the answer, read
 *                                                                  # from a file (or `-` for stdin), lands in the record
 *                                                                  # and is drawn under the pin. Words go through a file,
 *                                                                  # never inside a command line, where quotes and `$(`
 *                                                                  # in them would be run by the shell. `--answer "<text>"`
 *                                                                  # still works for plain words.
 *   node design-canvas/drain.mjs --canvas trips --orphans           # only the ones with no screen left
 *
 * THE ADDRESS COMES FROM `design-canvas/settings.json`; there is no default port, and `--url` overrides it for one run.
 *
 * `--all` IS NOT A SHORTCUT FOR BEING DONE. It exists for a round that is genuinely finished, and it prints every id it
 * touches so the claim can be checked afterwards.
 *
 * DELETE WITH: the design-canvas/ folder.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadSettings, requireAppUrl } from "./project-settings.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const argOf = (name) => {
  const at = argv.indexOf(`--${name}`);
  return at === -1 ? null : argv[at + 1];
};
const has = (name) => argv.includes(`--${name}`);

const canvas = argOf("canvas") ?? "main";
const settings = loadSettings(HERE, "drain");
const url = (argOf("url") ?? requireAppUrl(settings, "drain")).replace(/\/+$/, "");
const endpoint = `${url}/api/design-canvas/comments?canvas=${encodeURIComponent(canvas)}`;

function cannotReach(detail) {
  console.error(`the comments route ${detail} at ${url}`);
  console.error(`is the dev server running, and is "appUrl" in design-canvas/settings.json the address it answers at?`);
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
 * round after round, so the pile never reached zero and nobody could tell what was left to do.
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

/**
 * THE OTHER FRAMES EACH OPEN NOTE REACHES (`affected.mjs`), printed under it, so the list an agent works from already says
 * which frames share the commented frame's files. Read from the declaration on disk; a declaration that cannot be read
 * costs this one line and never the list.
 */
async function affectedLines(notes) {
  if (notes.length === 0) return new Map();
  try {
    const { linesForComments, loadGraph } = await import("./affected.mjs");
    return linesForComments(notes, { canvas, graph: await loadGraph(HERE) });
  } catch (error) {
    console.log(`  (no also-affected lines: ${String(error?.message ?? error).split("\n")[0]})`);
    return new Map();
  }
}

/**
 * ONE COMMENT AS THE AGENT HAS TO READ IT: what kind it is (a note, or a like or dislike of an option), the whole note with its
 * own line breaks, and, for a comment the reviewer sent back, every earlier round of words with the answer it got, oldest
 * first. A list cut to one line hid the half of a long note that said what to do, and a reopened note's earlier rounds, which
 * say what was already tried.
 */
function commentLines(one, { orphan }) {
  const kind = one.kind === "like" || one.kind === "dislike" ? one.kind : "note";
  const rounds = one.history ?? [];
  const head = [kind, rounds.length > 0 ? `reopened ${rounds.length === 1 ? "once" : `${rounds.length} times`}` : null, orphan ? "no screen" : null].filter(Boolean).join(", ");
  const day = (at) => (typeof at === "string" ? at.slice(0, 16).replace("T", " ") : "");
  const block = (text, indent) => String(text ?? "").trim().split(/\r?\n/).map((line) => `${indent}${line}`);
  const out = [`  ${one.id}  ${one.screenId ?? "(no screen)"}  [${head}]`, ...block(one.note || "(no words)", "      ")];
  if (rounds.length > 0) {
    out.push("      earlier rounds, oldest first:");
    rounds.forEach((round, at) => {
      out.push(`        ${at + 1}. sent back ${day(round.at)}`);
      out.push(...block(round.note, "           "));
      if (round.answer) out.push("           answered:", ...block(round.answer, "             "));
    });
  }
  if (one.answer?.text) out.push("      answered:", ...block(one.answer.text, "        "));
  return out;
}

const comments = await read();
const declared = await declaredScreens();
const isOrphan = (one) => declared !== null && !declared.has(one.screenId);
const open = comments.filter((one) => !one.consumedAt);
const orphans = open.filter(isOrphan);

if (has("list") || (!has("all") && !has("orphans") && !argOf("ids"))) {
  console.log(`${comments.length} comment(s) on ${canvas}, ${open.length} not yet worked`);
  const affected = await affectedLines(open.filter((one) => (!one.kind || one.kind === "note") && !isOrphan(one)));
  for (const one of open) {
    for (const line of commentLines(one, { orphan: isOrphan(one) })) console.log(line);
    const lines = affected.get(one.id) ?? [];
    if (lines.length > 0) console.log(`      also affected:\n${lines.map((line) => `      ${line}`).join("\n")}`);
  }
  if (orphans.length > 0)
    console.log(
      `\n${orphans.length} of them point at screens this canvas no longer declares, so there is nothing to open:\n` +
        `  read the note, decide whether it still applies, and drain it either way: \`--orphans\` does exactly those.`,
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

/**
 * AN ANSWER IS FOR ONE COMMENT. The reviewer reads it under that pin, so a text sent to several ids would be
 * the same sentence pinned to several different questions. The route refuses it too; refusing here says why.
 */
const answerFile = argOf("answer-file");
let answer = argOf("answer");
if (answerFile !== null) {
  try {
    answer = readFileSync(answerFile === "-" ? 0 : answerFile, "utf8");
  } catch (error) {
    console.error(`--answer-file: ${answerFile} cannot be read (${error.code ?? error.message})`);
    process.exit(1);
  }
}
if (answer !== null && answer.trim().length === 0) {
  console.error("--answer needs the words; an empty answer would be a consumed question with nothing under it");
  process.exit(1);
}
if (answer !== null && wanted.length !== 1) {
  console.error(`--answer goes with exactly one id (got ${wanted.length}); answer each question in its own run`);
  process.exit(1);
}

/* An id that is not in the file at all is a typo, and drowning it in a list of successes is how a comment gets
   quietly left behind. */
const known = new Set(comments.map((one) => one.id));
const unknown = wanted.filter((id) => !known.has(id));
const already = wanted.filter((id) =>
  comments.some((one) => one.id === id && one.consumedAt),
);

/* One request for the whole batch: the route applies it as one write, all or nothing. An answer goes with one id. */
const ids = wanted.filter((id) => known.has(id));
let drained = 0;
if (ids.length > 0) {
  const response = await fetch(endpoint, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(answer === null ? { ids, consumed: true } : { id: ids[0], consumed: true, answer: answer.trim() }),
  });
  if (response.ok) drained = ids.length;
  else console.error(`  ${ids.join(", ")}: the route answered ${response.status}`);
}

const after = (await read()).filter((one) => !one.consumedAt);
console.log(
  `${answer === null ? "drained" : "answered"} ${drained} of ${wanted.length}: ${ids.join(", ") || "none"}`,
);
if (already.length > 0)
  console.log(`already worked before this run: ${already.join(", ")}`);
if (unknown.length > 0) {
  console.error(`not in the file: ${unknown.join(", ")}`);
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
      `canvas any more, so they are not work you missed. \`--orphans\` clears them once you have read them.`,
  );
