#!/usr/bin/env node
/**
 * design-canvas — WHAT THE REVIEWER DECIDED ABOUT EACH OPTION, and whether the canvas knows it.
 *
 * THE FAILURE THIS EXISTS FOR. A verdict is a comment: liking or disliking an option writes a record into
 * `design-canvas/comments/<canvas>.json`, and everything downstream — the hand-off prompt, the next round,
 * what gets refined and what gets dropped — is generated from that file. Which is correct right up until the
 * reviewer says it out loud instead of clicking it. Then the file holds no verdict, the generator reads no
 * verdict, and it does what an empty set implies: it resurrected an option the reviewer had dropped and
 * dropped the one he had asked for by name. From the outside that looks like the tool ignoring him.
 *
 * The reviewer is not the problem. Saying "keep 2, kill 4" in a sentence is faster than clicking, and the
 * canvas cannot hear it. So the gap is closed on this side: before a round is generated, every option must
 * have a RECORDED verdict, and a verdict given in conversation is recorded here with the reviewer's own
 * words attached, so the file and the conversation cannot disagree.
 *
 *   node design-canvas/verdicts.mjs list   --canvas <slug>
 *   node design-canvas/verdicts.mjs check  --canvas <slug>
 *   node design-canvas/verdicts.mjs record --canvas <slug> --screen <id> --value like|dislike \
 *                                          --said "<his exact words>"
 *
 * `check` exits 1 when any option on the exploration has no verdict, and names them. Run it before
 * generating a round; a round built on an unknown verdict is a guess presented as a decision.
 *
 * `record` is for a verdict given in conversation. It writes the same shape the canvas button writes, so it
 * drains, counts and replaces identically — plus the quote, because a decision without his words is the
 * paraphrase this whole tool exists to avoid.
 *
 * DELETE WITH: the design-canvas/ folder.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const argv = process.argv.slice(2);
const mode = argv[0];
const argOf = (name) => {
  const at = argv.indexOf(`--${name}`);
  return at === -1 ? undefined : argv[at + 1];
};

const canvas = argOf("canvas") ?? "main";
if (!/^[a-z0-9][a-z0-9-]*$/.test(canvas)) {
  console.error(`refusing --canvas "${canvas}" — a canvas slug is lowercase letters, digits and dashes only.`);
  process.exit(1);
}

/* The same two layouts the route serves: namespaced since slugs existed, flat for a single-canvas install. */
const candidates = [
  `design-canvas/comments/${canvas}.json`,
  ...(canvas === "main" ? ["design-canvas/comments.json"] : []),
];
const file = candidates.find((one) => existsSync(one));
if (!file) {
  console.error(`no review file for canvas "${canvas}" — looked for:`);
  for (const one of candidates) console.error(`  ${one}`);
  console.error("nothing has been reviewed here yet, so there are no verdicts to read.");
  process.exit(1);
}

const data = JSON.parse(readFileSync(file, "utf8"));
const comments = data.comments ?? [];
const verdictOf = (screenId) =>
  comments.find((one) => one.screenId === screenId && (one.kind === "like" || one.kind === "dislike"));

/**
 * WHICH SCREENS ARE OPTIONS. Read from the served declaration when it is there, so this tool does not carry a
 * second idea of what an exploration is. `--screens` accepts the same dump the capture uses, for a project
 * whose declaration lives somewhere this cannot guess.
 */
function options() {
  const dump = argOf("screens");
  if (dump && existsSync(dump)) {
    const parsed = JSON.parse(readFileSync(dump, "utf8"));
    const screens = parsed.screens ?? parsed;
    return screens.filter((one) => one.exploration || one.round).map((one) => one.id);
  }
  /* Fall back to what the reviewer has actually touched: any screen already carrying a verdict, plus any the
     caller names. Enough for `record`; `check` says so rather than pretending it knows the full list. */
  return [...new Set(comments.map((one) => one.screenId))];
}

if (mode === "list" || mode === "check") {
  const ids = options();
  const missing = ids.filter((id) => !verdictOf(id));
  for (const id of ids) {
    const verdict = verdictOf(id);
    const said = verdict?.note ? ` — ${verdict.note.split("\n")[0].slice(0, 80)}` : "";
    console.log(`  ${verdict ? verdict.kind.padEnd(7) : "none".padEnd(7)} ${id}${said}`);
  }
  if (!argOf("screens")) {
    console.log(
      "\nnote: no --screens dump given, so this lists only screens the reviewer has already touched.\n" +
        "For the full option list pass --screens <dump-screens output>.",
    );
  }
  if (mode === "check" && missing.length > 0) {
    console.error(
      `\n${missing.length} option(s) have no recorded verdict: ${missing.join(", ")}\n` +
        "A round generated now would be built on an assumption. If he decided in conversation, record it:\n" +
        `  node design-canvas/verdicts.mjs record --canvas ${canvas} --screen <id> --value like|dislike --said "<his words>"`,
    );
    process.exit(1);
  }
  process.exit(0);
}

if (mode === "record") {
  const screenId = argOf("screen");
  const value = argOf("value");
  const said = argOf("said");
  if (!screenId || (value !== "like" && value !== "dislike")) {
    console.error('record needs --screen <id> and --value like|dislike, plus --said "<his words>".');
    process.exit(1);
  }
  if (!said) {
    console.error(
      "record needs --said: a verdict recorded without the words it came from is a paraphrase, and this\n" +
        "tool exists because a paraphrased decision already cost a round.",
    );
    process.exit(1);
  }

  const existing = verdictOf(screenId);
  const shape = comments.find((one) => one.screenId === screenId);
  const now = new Date().toISOString();
  /* One verdict per screen: replaced, never appended — the same rule the canvas button follows. */
  const rest = comments.filter((one) => one !== existing);
  rest.push({
    id: existing?.id ?? `v${Date.now().toString(36)}`,
    flowId: existing?.flowId ?? shape?.flowId ?? "",
    screenId,
    kind: value,
    label: existing?.label ?? shape?.label ?? screenId,
    route: existing?.route ?? shape?.route ?? "",
    state: existing?.state ?? shape?.state ?? null,
    region: existing?.region ?? shape?.region ?? { x: 0, y: 0, w: 1, h: 1 },
    image: existing?.image ?? shape?.image ?? "",
    /* His words, verbatim, and marked as spoken rather than clicked so nobody later reads it as a click. */
    note: `${said}\n\n(recorded from conversation, not clicked on the canvas)`,
    createdAt: existing?.createdAt ?? now,
    editedAt: existing ? now : undefined,
  });

  writeFileSync(file, `${JSON.stringify({ ...data, comments: rest, updatedAt: now }, null, 1)}\n`, "utf8");
  console.log(`  ${value} recorded on ${screenId} in ${file}`);
  console.log("  it drains, counts and replaces exactly like a clicked one");
  process.exit(0);
}

console.error(readFileSync(new URL(import.meta.url), "utf8").split("*/")[0]);
process.exit(2);
