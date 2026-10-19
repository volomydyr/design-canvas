/**
 * design-canvas — THE FEW RULES AGENTS DRIFT FROM, SAID AT THE MOMENT OF THE ACTION.
 *
 * Instructions read at the start of a session fade after many tool calls, and the steps that get dropped are the ones that come
 * after a command succeeds: open the pictures, mark the worked comments consumed, run the oracle once, and load the skill
 * at all. Two channels reach an agent at the moment it acts, and this module is the one source of their words:
 *
 *   - `afterCapture` / `afterRound`: lines the canvas's own commands print LAST on success, prefixed `next:`. Every agent reads
 *     a command's output, whatever tool runs it, and most read only its tail, which is why these lines are the last ones.
 *   - `beforeAction`: the context `hook.mjs` adds when a Claude Code agent is about to run a canvas command, with the
 *     rules for THAT command, plus one line when the skill has not been loaded in the session.
 *   - `afterTurn`: the line the end of a turn shows when canvases nobody has open hold out-of-date frames.
 *
 * Nothing here judges or blocks anything. Pure functions, so the tests can call them directly.
 *
 * DELETE WITH: the design-canvas/ folder.
 */

const SCRIPT = /\bnode\s+(?:"[^"]*|'[^']*|\S*)design-canvas\/(capture|capture-run|round|check-canvas)\.mjs/g;
const COMMENT_PATCH = /\bcurl\b[^\n]*\/api\/design-canvas\/comments/;
const IS_PATCH = /(?:-X|--request)\s*['"]?PATCH\b/;
/* Evidence that the skill itself was read in a session: the line Claude Code puts at the top of a loaded skill (by the Skill tool or
   the slash command; a call that fails has no such line), or the skill's file read directly. The reminders below never contain
   either, so they cannot count as a load themselves. */
const SKILL_LOADED = /Base directory for this skill: [^"\\\n]*\/design-canvas(?![\w-])|design-canvas\/SKILL\.md/;

/** The canvas a command names with `--canvas <slug>`, `--canvas=<slug>` or a route's `?canvas=<slug>`, or a placeholder. */
export function slugIn(command) {
  const match = /(?:--canvas[ =]['"]?|[?&]canvas=)([a-z0-9][a-z0-9-]*)/.exec(command);
  return match ? match[1] : "<slug>";
}

/** Which canvas commands a shell command runs, in order, each once. */
export function canvasCommandsIn(command) {
  const found = [];
  for (const match of command.matchAll(SCRIPT)) if (!found.includes(match[1])) found.push(match[1]);
  if (COMMENT_PATCH.test(command) && IS_PATCH.test(command)) found.push("comment-patch");
  return found;
}

/** Does this transcript text show the skill being loaded? */
export const skillLoadedIn = (text) => SKILL_LOADED.test(text);

const RULES = {
  capture: (slug) =>
    `Canvas capture: name the frames whose picture should change (--only <ids>); with no list it recaptures what changed, --all ` +
    `recaptures everything and is only for proving a whole canvas. Before you report: open every changed picture and hold it ` +
    `against its label, mark the comments you worked consumed (node design-canvas/drain.mjs --canvas ${slug} --ids <ids>), then run ` +
    `check-canvas.mjs once. round.mjs --canvas ${slug} --only <ids> --drain <comment ids> does all of it in one command.`,
  round: () =>
    `Canvas round: --drain names the comments you worked, and a comment that asks something gets its answer in the record ` +
    `(drain.mjs --answer). After the round, open the contact sheet it prints, read every flagged frame, then report per comment id.`,
  "check-canvas": () =>
    `Canvas oracle: run it once per round, after the capture and the drain, not after each fix. Its last line is the verdict: ` +
    `read that line, not the green lines above it.`,
  "comment-patch": (slug) =>
    `Canvas comments: mark worked comments with node design-canvas/drain.mjs --canvas ${slug} --ids c1,c2, which names any id it ` +
    `cannot find; a comment that asks something gets its answer in the record with --answer.`,
};
RULES["capture-run"] = RULES.capture;

const SKILL_LINE =
  "The design-canvas skill has not been loaded in this session. Load it before more canvas work: its review round (step 8 of " +
  "the skill) and its traps decide how this command is used.";

/**
 * The context for a Claude Code PreToolUse input, or null when the action is not a canvas command.
 * `skillLoaded` is whether the session's transcript shows the skill being loaded.
 */
export function beforeAction(input, { skillLoaded = true } = {}) {
  if (input?.tool_name !== "Bash") return null;
  const command = input.tool_input?.command;
  if (typeof command !== "string") return null;
  const commands = canvasCommandsIn(command);
  if (commands.length === 0) return null;
  const slug = slugIn(command);
  /* capture and capture-run share one text: said once. */
  const texts = [...new Set(commands.map((one) => RULES[one](slug)))];
  return [...(skillLoaded ? [] : [SKILL_LINE]), ...texts].join("\n");
}

/** Up to `max` items, then how many more. */
const some = (items, max) => (items.length > max ? `${items.slice(0, max).join(", ")} and ${items.length - max} more` : items.join(", "));

/**
 * The `next:` lines a successful capture prints last.
 *   files      the pictures this run wrote, relative to the project (design-canvas/shots/<slug>/<file>)
 *   undrained  ids of comments whose frame picture changed (stale) and that are not marked consumed
 *   oracle     false when the caller runs the oracle itself
 */
export function afterCapture({ slug, files = [], undrained = [], oracle = true }) {
  if (files.length === 0) return [];
  const lines = [`next: open the ${files.length} picture(s) this capture wrote and hold each against its label before you report: ${some(files, 4)}`];
  const one = undrained.length === 1;
  if (undrained.length > 0)
    lines.push(
      `next: ${some(undrained, 8)} ${one ? "sits" : "sit"} on a frame whose picture changed and ${one ? "is" : "are"} not consumed; if you ` +
        `worked ${one ? "it" : "them"}: node design-canvas/drain.mjs --canvas ${slug} --ids ${undrained.join(",")} (add --answer for a question)`,
    );
  if (oracle) lines.push(`next: run the oracle once, after the drain: node design-canvas/check-canvas.mjs --canvas ${slug}`);
  return lines;
}

/** The `next:` line a round prints just above its verdict, when it built a contact sheet. */
export function afterRound({ sheet }) {
  return sheet ? [`next: open ${sheet} and read every flagged frame before you report, per comment id`] : [];
}

/** The notes a capture leaves waiting on the agent: stale (the picture under them changed) and not consumed. Verdicts never count. */
export const undrainedIn = (comments) =>
  (comments ?? []).filter((one) => (!one.kind || one.kind === "note") && one.stale === true && !one.consumedAt).map((one) => one.id);

/**
 * The one line the end of a turn shows when canvases that are not open hold out-of-date frames, or null. Those frames refresh
 * when their canvas is opened, so there is nothing to ask anyone. `elsewhere` is [{ slug, count }].
 */
export function afterTurn({ elsewhere = [] }) {
  const total = elsewhere.reduce((sum, one) => sum + one.count, 0);
  if (total === 0) return null;
  const list = elsewhere.map((one) => `${one.slug} ${one.count}`).join(", ");
  return `design-canvas: ${total} frame(s) on canvases not open now are out of date (${list}); each canvas refreshes when it is opened`;
}
