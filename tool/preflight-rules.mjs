/**
 * design-canvas — THE PREFLIGHT'S RULES, as pure functions over the declaration a dump produced, so they run in
 * milliseconds and are tested without a browser. `preflight.mjs` reads the file, calls these, and prints.
 *
 * WHY THE PREFLIGHT EXISTS. Every refusal below used to cost a capture and an oracle run to learn, and each of those is
 * minutes: notes over the word cap, a frame that duplicates an existing picture, an arrow between sections
 * the canvas cannot draw, frames nested deeper than `under` supports (found only after a long capture), a claim in a
 * different case than the shipped copy, a section whose id equals a screen's. All of it is knowable from the declaration,
 * the shipped copy and the source, which is why all of it is decided here, before a browser exists.
 *
 * WHAT IT DOES NOT DECIDE: whether a claim is TRUE of a page (that is the capture, and `--live`), and whether the design is
 * good (that is a person).
 *
 * DELETE WITH: the design-canvas/ folder.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { filesReachedFrom, IMPORT_RE, resolveSpecifier } from "./closure.mjs";
import { surfaceKind } from "./components.mjs";
import { checkCanvasCopy, checkEdgeLabel, EDGE_VERBS } from "./copy-rules.mjs";
import { networkKey, networkSignature, parseNetwork } from "./network.mjs";
import { stripComments } from "./registry.mjs";
import { describeSteps, parseSteps } from "./steps.mjs";

/* ------------------------------------------------------------------ the declaration */

/**
 * THE FIVE RULES THE FRAMES OBEY, plus the copy's and the edge labels':
 *   1. NO TWO FRAMES ARE THE SAME PICTURE (same device, address, steps and network rules), and no screen id is declared twice.
 *   2. `under` GOES ONE LEVEL: a step sits under an OPTION of its own panel, never under another step.
 *   3. A SECTION ID IS NEVER A SCREEN ID: flows, explorations and declared kinds share the id space the tools resolve in.
 *   4. AN ARROW STAYS IN ITS FLOW: both ends are screens of the flow that draws it.
 *   5. A VARIANTS SCREEN IS NAMED BY ITS FRAMES: nothing points at the id that was expanded away (an arrow, `under`, `redesigns`).
 */
export function lintDeclaration(decl) {
  const problems = [];
  const screens = decl.screens ?? [];
  /* The variants screens the dump already expanded, by the id they were declared under: `{ filter: ["filter-a", "filter-b"] }`. */
  const variantBases = new Map();
  for (const screen of screens) if (screen.variantOf) variantBases.set(screen.variantOf, [...(variantBases.get(screen.variantOf) ?? []), screen.id]);

  /* 1. Duplicate pictures, and duplicate ids. */
  const byPicture = new Map();
  const byId = new Map();
  for (const screen of screens) {
    if (byId.has(screen.id))
      problems.push(
        `screen id "${screen.id}" is declared twice: an id names one frame, and a comment is pinned by it` +
          (screen.variantOf ? ` (it is the frame "${screen.variant}" of the variants screen "${screen.variantOf}": rename one of them)` : ""),
      );
    byId.set(screen.id, screen);
    if (!screen.url) continue;
    const pressed = screen.steps?.length ? ` after ${describeSteps(screen.steps)}` : "";
    /* WHAT THE PAGE'S DATA DOES IS PART OF THE PICTURE: a loading, an empty and a failed list share their route, and a list answered
       with nothing and one answered with a row are two pictures of one rule, which the key tells apart by what each says. */
    const data = networkSignature(screen.network);
    const answered = data ? ` with ${data}` : "";
    const key = `${screen.device ?? "desktop"} ${screen.url}${pressed} ${networkKey(screen.network)}`;
    const seen = byPicture.get(key);
    if (seen) problems.push(`${screen.id} and ${seen} are both ${screen.url}${pressed}${answered}, so they are one picture twice`);
    else byPicture.set(key, screen.id);
  }

  /* 2. `under`, one level. */
  for (const exploration of decl.explorations ?? []) {
    const inPanel = new Map((exploration.screens ?? []).map((screen) => [screen.id, screen]));
    for (const screen of exploration.screens ?? []) {
      if (!screen.under || screen.suggests) continue;
      const parent = inPanel.get(screen.under);
      if (!parent) {
        problems.push(`exploration ${exploration.id}: "${screen.id}" sits under "${screen.under}", which is not a frame of that panel`);
        continue;
      }
      if (parent.suggests) {
        problems.push(`exploration ${exploration.id}: "${screen.id}" sits under "${screen.under}", which is not an option in that panel`);
        continue;
      }
      if (parent.under && !parent.suggests)
        problems.push(
          `exploration ${exploration.id}: "${screen.id}" sits under "${screen.under}", which itself sits under "${parent.under}": ` +
            `\`under\` goes one level, so put "${screen.id}" under "${rootOption(inPanel, screen.under)}" (the frames nested deeper draw nowhere)`,
        );
    }
  }

  /* 3. Section ids against screen ids. */
  const sections = [
    ...(decl.groups ?? []).map((one) => ["flow", one.id]),
    ...(decl.explorations ?? []).map((one) => ["exploration", one.id]),
    ...(decl.kinds ?? []).map((one) => ["section", one.id]),
  ];
  for (const [kind, id] of sections)
    if (byId.has(id)) problems.push(`the ${kind} id "${id}" is also a screen id: ids are resolved across flows, explorations and screens, so rename one of them`);

  /* 4. Arrows across groups, and arrows to nothing. */
  for (const group of decl.groups ?? []) {
    for (const edge of group.edges ?? []) {
      const where = `flow "${group.id}": edge ${edge.from} → ${edge.to}`;
      for (const end of [edge.from, edge.to]) {
        const screen = byId.get(end);
        if (!screen && variantBases.has(end)) continue;
        if (!screen) problems.push(`${where} names "${end}", which is no screen on this canvas`);
        else if (screen.flowId !== group.id)
          problems.push(`${where} crosses groups: "${end}" belongs to "${screen.flowId}", and an arrow is drawn inside one flow (the canvas cannot draw it across sections)`);
      }
      for (const problem of checkEdgeLabel(edge.label)) problems.push(`${where}: ${problem}`);
    }
  }

  /* 5. Nothing points at a variants screen's own id: it is gone, and its frames are what exist. */
  if (variantBases.size > 0) {
    const says = (base) => {
      const frames = variantBases.get(base);
      return `"${base}", which declares variants and so is no frame itself: name one of its frames (${frames.slice(0, 4).join(", ")}${frames.length > 4 ? ", ..." : ""})`;
    };
    const check = (where, ref) => {
      if (typeof ref === "string" && variantBases.has(ref) && !byId.has(ref)) problems.push(`${where} names ${says(ref)}`);
    };
    for (const group of decl.groups ?? [])
      for (const edge of group.edges ?? []) {
        check(`flow "${group.id}": edge ${edge.from} → ${edge.to}`, edge.from);
        check(`flow "${group.id}": edge ${edge.from} → ${edge.to}`, edge.to);
      }
    for (const exploration of decl.explorations ?? []) check(`exploration ${exploration.id}: original`, exploration.original);
    for (const screen of screens)
      for (const field of ["under", "suggests", "redesigns", "twin"]) check(`${screen.id}: ${field}`, screen[field]);
  }
  return problems;
}

/**
 * THE VARIANTS OF ONE COMPONENT MUST LOOK DIFFERENT, checked against the pictures the capture took. A variants screen expands
 * into frames that differ only in `?variant=`, so if the app's route ignores the parameter, or reads it under another name, every
 * frame comes out the same picture and all of the usual checks pass: the address differs, the claims are met, the capture is
 * stable. Two frames of one variants screen with the same picture hash are that failure, named with the parameter to look at.
 * `screens` is the served declaration's list, `shots` the manifest's.
 */
export function variantPictureProblems(screens, shots) {
  /* "a", "a and b", "a, b and c". */
  const named = (names) => (names.length < 3 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);
  const shotOf = new Map((shots ?? []).map((shot) => [shot.screenId, shot]));
  const byBase = new Map();
  for (const screen of screens ?? []) {
    if (!screen.variantOf || !shotOf.get(screen.id)?.hash) continue;
    byBase.set(screen.variantOf, [...(byBase.get(screen.variantOf) ?? []), screen]);
  }
  const problems = [];
  for (const [base, frames] of byBase) {
    const byHash = new Map();
    for (const frame of frames) byHash.set(shotOf.get(frame.id).hash, [...(byHash.get(shotOf.get(frame.id).hash) ?? []), frame]);
    for (const same of byHash.values())
      if (same.length > 1)
        problems.push(
          `the variants ${named(same.map((one) => `"${one.variant}"`))} of "${base}" were captured as the same picture: the page at ${same[0].url.split("?")[0]} ` +
            `does not show the variant that ?variant= names (it is ignored, or read under another name), so the frames compare nothing`,
        );
  }
  return problems;
}

/* ------------------------------------------------------------------ the switch to today's screen */

/** Each exploration frame's declared `redesigns`, by id: a screen id, or null. A frame that says nothing is left out. */
function declaredToday(explorations) {
  const links = new Map();
  for (const exploration of explorations ?? [])
    for (const screen of exploration.screens ?? []) if (screen.redesigns !== undefined) links.set(screen.id, screen.redesigns);
  return links;
}

/**
 * WHAT THE MANIFEST REMEMBERS ABOUT EACH FRAME'S SWITCH: the last screen of today's app it flipped to. Written by the capture onto
 * every exploration frame's entry, and kept when the declaration later says null or nothing, so a link that existed is not lost by a
 * regenerated declaration or a rewritten round. A frame that replaces a removed one (`successors`) takes over the removed frame's
 * link. Returns the shots with `today` set where there is one.
 */
export function recordToday({ shots, previous, explorations, successors }) {
  const links = declaredToday(explorations);
  const before = new Map((previous ?? []).map((shot) => [shot.screenId, shot.today]));
  const inherited = new Map();
  for (const [gone, next] of Object.entries(successors ?? {})) if (next && before.get(gone)) inherited.set(next, before.get(gone));
  const frames = new Set((explorations ?? []).flatMap((one) => (one.screens ?? []).map((screen) => screen.id)));
  return (shots ?? []).map((shot) => {
    if (!frames.has(shot.screenId)) return shot;
    const declared = links.get(shot.screenId);
    const today = typeof declared === "string" ? declared : before.get(shot.screenId) || inherited.get(shot.screenId);
    return today ? { ...shot, today } : shot;
  });
}

/**
 * EVERY EXPLORATION FRAME SAYS WHICH OF TODAY'S SCREENS IT REDESIGNS, AND NEVER DROPS IT AGAIN.
 *
 * `redesigns` is a screen the permanent views draw, in the same state as the frame, or null when today's app has nothing like it.
 * null used to be accepted without a word, so a frame added later (a new round, a regenerated declaration, a state whose picture
 * was never taken) could declare it and the switch quietly stopped appearing. Three refusals and one report close that:
 *   - a frame that says nothing, or names a screen that is not one of today's;
 *   - a frame that flipped to today's screen when it was last captured (`today` in the manifest) and now declares null or nothing;
 *   - and, every run, the list of frames that draw no switch, so a wrong null is seen the day it is written.
 * `screens` is the declaration's list (with `view`), `shots` the manifest's. Returns `{ problems, without }`.
 */
export function todaySwitchProblems({ explorations, screens, shots }) {
  const problems = [];
  const without = [];
  const kind = new Map((screens ?? []).map((screen) => [screen.id, screen.view]));
  const remembered = new Map((shots ?? []).filter((shot) => shot.today).map((shot) => [shot.screenId, shot.today]));
  for (const exploration of explorations ?? [])
    for (const screen of exploration.screens ?? []) {
      const where = `exploration ${exploration.id}: "${screen.id}"`;
      const had = remembered.get(screen.id);
      if (typeof screen.redesigns !== "string" && had) {
        problems.push(
          `${where} switched to today's "${had}" when it was last captured and now declares ${screen.redesigns === null ? "redesigns: null" : "no redesigns"}: ` +
            `put redesigns: "${had}" back, or name today's screen of the same state. A frame today's app has nothing like is a new frame, with a new id`,
        );
        continue;
      }
      if (screen.redesigns === undefined) {
        problems.push(`${where} does not say what it redesigns: name today's screen of the same state, or null when today's app has nothing like it`);
        continue;
      }
      /* Every null frame is listed, a reference or suggestion hung under another frame included: none of them draws a switch. */
      if (screen.redesigns === null) {
        without.push(screen.id);
        continue;
      }
      if (!kind.has(screen.redesigns)) problems.push(`${where} redesigns "${screen.redesigns}", which is not a screen this canvas declares`);
      else if (kind.get(screen.redesigns) === "exploration")
        problems.push(`${where} redesigns "${screen.redesigns}", an exploration frame: today's screen comes from the permanent views`);
    }
  return { problems, without };
}

/** The option a step ultimately hangs from, following `under` up to the frame that has none. */
function rootOption(inPanel, id) {
  let at = id;
  for (let hops = 0; hops < 20; hops += 1) {
    const next = inPanel.get(at)?.under;
    if (!next) return at;
    at = next;
  }
  return at;
}

/** Every declared screen's steps, parsed: an unknown step type is a problem here, in seconds, and throws in the capture. */
export function lintSteps(screens) {
  const problems = [];
  for (const screen of screens ?? []) {
    try {
      parseSteps(screen.steps, screen.id);
    } catch (error) {
      problems.push(error.message);
    }
  }
  return problems;
}

/**
 * EVERY DECLARED NETWORK RULE, parsed: the canvas-wide list and each screen's own. An unknown rule, a rule for an operation twice, a
 * `writes` on a screen, an `answer` with nothing to answer is a problem here in seconds and stops the capture before any browser.
 * And rules on a frame that is not a page of the app (an explanation, a wireframe or a still: a file served elsewhere that asks for
 * no data) have nothing to act on, which is a mistake worth saying aloud rather than a rule that quietly does nothing.
 */
export function lintNetwork(screens, canvasNetwork) {
  const problems = [];
  try {
    parseNetwork(canvasNetwork, "the canvas", { canvas: true });
  } catch (error) {
    problems.push(error.message);
  }
  for (const screen of screens ?? []) {
    try {
      parseNetwork(screen.network, screen.id);
    } catch (error) {
      problems.push(error.message);
      continue;
    }
    if (screen.network?.length && (screen.explain || screen.wireframe || screen.still || !screen.url))
      problems.push(`${screen.id}: network rules on a frame that is not a page of the app (an explanation, a wireframe or a still) have nothing to act on: it asks for no data`);
  }
  return problems;
}

/** The copy rules, over the canvas's own words and every edge label: the rule set the oracle holds, run from the file. */
export function lintCopy(decl) {
  return checkCanvasCopy({ title: decl.title, note: decl.note, groups: decl.groups, screens: decl.screens, kinds: decl.kinds });
}

/**
 * THE REST OF WHAT A DECLARATION CAN GET WRONG ON ITS OWN, each knowable from the declaration (and, for evidence, the folder its
 * pictures live in), so the preflight learns it in seconds rather than the oracle after a capture:
 *   - every exploration opens with today's design: `original` names a screen of the permanent views;
 *   - a suggestion hangs under a frame of its own panel; a highlight and an evidence outline are fractions of their picture; a sticky
 *     note points at a highlight the frame has; an evidence picture is on disk (when `evidenceDir` is given) and carries its size;
 *   - an explanation frame has no route, no section, no claims and is not an exploration option, and every other screen has a route;
 *   - a screen is filed under a section the canvas declares, when it declares any;
 *   - a user flow is connected by actions, and every press edge says where its press lives (`origin`) or why it cannot (`noOrigin`),
 *     while a condition edge ("When ...") carries no origin;
 *   - every `source` file exists (when `root`, the project folder, is given): a typo would leave the stamp blind to the real file.
 */
export function lintStructure(decl, { evidenceDir, root } = {}) {
  const problems = [];
  const screens = decl.screens ?? [];
  if (root)
    for (const screen of screens)
      for (const file of screen.source ?? [])
        if (!existsSync(path.join(root, file))) problems.push(`${screen.id}: names the file ${file} and there is no such file`);
  const explorations = decl.explorations ?? [];
  for (const exploration of explorations) {
    if (!exploration.original) problems.push(`exploration ${exploration.id}: no \`original\`, and every panel opens with today's design as its first frame`);
    else {
      const originalScreen = screens.find((screen) => screen.id === exploration.original);
      if (!originalScreen) problems.push(`exploration ${exploration.id}: original "${exploration.original}" is not a screen this canvas declares`);
      else if (originalScreen.view === "exploration")
        problems.push(`exploration ${exploration.id}: original "${exploration.original}" is an exploration frame, and the reference comes from the permanent views`);
    }
    /* A SUGGESTION HANGS UNDER A FRAME OF ITS OWN PANEL, which is drawn there, or under the panel's Today frame (graph-layout.ts, the
       same rule); one naming a frame of another panel, or another suggestion, would hang nowhere the reviewer can find it. */
    const drawn = new Set([...(exploration.screens ?? []).filter((screen) => !screen.suggests).map((screen) => screen.id), ...(exploration.original ? [exploration.original] : [])]);
    for (const screen of exploration.screens ?? []) {
      if (screen.suggests && !drawn.has(screen.suggests))
        problems.push(`exploration ${exploration.id}: "${screen.id}" suggests a change to "${screen.suggests}", which is not a frame of that panel`);
      for (const mark of screen.marks ?? [])
        if (![mark.x, mark.y, mark.w, mark.h].every((v) => typeof v === "number" && v >= 0 && v <= 1))
          problems.push(`${screen.id}: a highlight is outside the frame, its x, y, w and h are fractions from 0 to 1`);
      if (screen.stickyOn !== null && screen.stickyOn !== undefined && !(screen.marks ?? [])[screen.stickyOn])
        problems.push(`${screen.id}: its sticky note points at highlight ${screen.stickyOn}, which it does not have`);
      /* A missing evidence file draws an empty tile beside a suggestion, which reads as "no evidence". */
      for (const one of screen.evidence ?? []) {
        if (!one.file || /[\\/]/.test(one.file) || (evidenceDir && !existsSync(path.join(evidenceDir, one.file))))
          problems.push(`${screen.id}: its evidence "${one.file}" is not in design-canvas/evidence/${path.basename(evidenceDir ?? "<slug>")}/`);
        if (!(one.w > 0 && one.h > 0)) problems.push(`${screen.id}: its evidence "${one.file}" needs its pixel size, w and h`);
        for (const box of one.marks ?? [])
          if (![box.x, box.y, box.w, box.h].every((v) => typeof v === "number" && v >= 0 && v <= 1) || box.x + box.w > 1.001 || box.y + box.h > 1.001)
            problems.push(`${screen.id}: a highlight on "${one.file}" is outside the picture, its x, y, w and h are fractions from 0 to 1`);
      }
    }
  }

  /* An explanation frame is a text panel in the flows: never captured, never grouped, never an option, and it proves nothing. */
  for (const screen of screens) {
    if (screen.explain) {
      if (screen.url) problems.push(`${screen.id}: carries both a route and an explanation. There is nothing to open at an explanation frame, so drop one of them`);
      if (screen.kind) problems.push(`${screen.id}: an explanation frame filed under "${screen.kind}", but it never appears in the grouped screens, so it takes no section`);
      if (screen.view === "exploration") problems.push(`${screen.id}: an explanation frame inside an exploration, and explanations narrate flows only`);
      if ((screen.expect ?? []).length > 0 || (screen.expectMissing ?? []).length > 0)
        problems.push(`${screen.id}: claims on an explanation frame, but nothing is captured there, so nothing can be proved`);
    } else if (!screen.url) problems.push(`${screen.id}: no route and no explanation. A screen is a picture of an address or an explanation of a step, never neither`);
  }

  /* A section that nearly exists draws a heading that looks deliberate and is wrong, so a canvas that names its sections holds
     every screen to them. Adding one stays possible and becomes deliberate: declare it, with a sentence. */
  if (Array.isArray(decl.kinds) && decl.kinds.length > 0) {
    const known = new Set(decl.kinds.map((one) => one.id));
    for (const screen of screens)
      if (screen.kind && !known.has(screen.kind))
        problems.push(
          `${screen.id}: filed under "${screen.kind}", which this canvas does not declare. ` +
            `Its sections are: ${decl.kinds.map((one) => `"${one.id}" (${one.whatBelongs})`).join("; ")}. ` +
            `Move the screen into one of them, or add the section to \`kinds\` on purpose.`,
        );
  }

  /* A chain of states joined by "When ..." is grouped screens, not a user flow: a flow that draws edges has at least one action. */
  const isAction = (edge) => {
    const first = (edge.label ?? "").split(" ")[0];
    return first !== "When" && EDGE_VERBS.includes(first);
  };
  for (const group of decl.groups ?? []) {
    if (group.groupedOnly || !(group.edges ?? []).length) continue;
    if (!group.edges.some(isAction)) problems.push(`flow "${group.id}" has no action edge, and a chain of states is grouped screens, not a user flow`);
    for (const edge of group.edges) {
      const where = `${group.id}: edge ${edge.from} → ${edge.to}`;
      if (isAction(edge) && !edge.origin && !edge.noOrigin)
        problems.push(`${where} ("${edge.label}") is a press with no origin and no stated reason: declare where the press lives, or why the picture cannot show it`);
      if (isAction(edge) && edge.origin && edge.noOrigin) problems.push(`${where} declares both origin and noOrigin, and it cannot both have a place and lack one`);
      if (!isAction(edge) && edge.origin) problems.push(`${where} ("${edge.label}") is a condition with an origin, but nothing was pressed, so nothing can be highlighted`);
    }
  }
  return problems;
}

/**
 * EVERY STATIC RULE IN ONE CALL: the preflight runs it on the declaration file and the oracle on the served declaration, so the two
 * hold a canvas to the same rules from one source. `shots` is the last capture's manifest list (for the switches to today's screen),
 * `evidenceDir` the folder the evidence pictures must be in, `root` the project folder the `source` paths are relative to. Returns the
 * problems by kind, and `without`: the exploration frames that draw no switch to today's screen (a note, not a problem).
 */
export function lintAll(decl, { shots = [], evidenceDir, root } = {}) {
  const today = todaySwitchProblems({ explorations: decl.explorations, screens: decl.screens, shots });
  return {
    copy: lintCopy(decl),
    declaration: [...lintDeclaration(decl), ...today.problems, ...lintStructure(decl, { evidenceDir, root })],
    steps: lintSteps(decl.screens),
    network: lintNetwork(decl.screens, decl.network),
    without: today.without,
  };
}

/* ------------------------------------------------------------------ the pinned states, against the states file */

/**
 * THE STATE NAMES A STATES FILE CAN ANSWER TO, read from its text (and the canvas files it imports): every quoted string and
 * every plain object key is a name, and a template literal that builds names (`` `failed-${kind}` ``) stands for every name that
 * starts with its fixed part. Reading the text, not running it, keeps this a file check; a name it cannot see is reported, and
 * the capture is the final word (it fails a frame whose state the page says it does not have).
 */
export function stateNames(texts) {
  const names = new Set();
  const prefixes = [];
  /* A name is a string where a state is named: a key (`"menu-open":`), the first of a pair (`["menu-open", apply]`), a case or a
     comparison. A string that is a value (`status: "Pending"`) is not one. */
  const named = (text, index, length) => {
    const before = text.slice(Math.max(0, index - 12), index);
    const after = text.slice(index + length, index + length + 4);
    return /^\s*:/.test(after) || (/\[\s*$/.test(before) && /^\s*(?:,|\]\s*:)/.test(after)) || /\bcase\s*$/.test(before) || /[!=]==?\s*$/.test(before) || /^\s*[!=]==?/.test(after);
  };
  for (const text of texts) {
    for (const match of text.matchAll(/(["'])((?:\\.|(?!\1)[^\\\n])*)\1/g)) if (named(text, match.index, match[0].length)) names.add(match[2]);
    for (const match of text.matchAll(/`([^`]*)`/g)) {
      if (!named(text, match.index, match[0].length)) continue;
      const at = match[1].indexOf("${");
      if (at === -1) names.add(match[1]);
      else if (at > 0) prefixes.push(match[1].slice(0, at));
    }
    for (const match of text.matchAll(/(?:^|[{,\s])([A-Za-z_$][\w$]*)\s*:/gm)) names.add(match[1]);
  }
  return { names, prefixes };
}

/**
 * Do the states files build their names in code from something read elsewhere (`[s.id, apply]`, `[key]: apply`, names imported
 * from outside the canvas's project folder)? Then the names cannot be read from the text, and the capture's own mark for an
 * unknown pin is the guard.
 */
export const statesBuiltInCode = (texts) =>
  (texts ?? []).some((text) => /\[\s*[A-Za-z_$][\w$.]*\s*,\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/.test(text) || /\[\s*[A-Za-z_$][\w$.]*\s*\]\s*:/.test(text));

/**
 * EVERY PINNED STATE EXISTS: a frame whose `state` the states file does not have renders the default under the state's name.
 * `statesTexts` is the states file's text plus the canvas files it imports, or null when the project has no states file.
 * Frozen history is exempt: its state is gone by definition, and its picture is never retaken.
 */
export function unknownStateProblems(screens, statesTexts) {
  return unknownStates(screens, statesTexts).problems;
}

/** The same check as problems and notes: a pin the text cannot vouch for, when the names are built in code, is a note. */
export function unknownStates(screens, statesTexts) {
  const pinned = (screens ?? []).filter((screen) => screen.state && !screen.frozen && !screen.explain && !screen.wireframe);
  if (pinned.length === 0) return { problems: [], notes: [] };
  if (statesTexts === null)
    return { problems: pinned.map((screen) => `${screen.id}: pins the state "${screen.state}" and this project has no design-canvas/project/states.ts`), notes: [] };
  const { names, prefixes } = stateNames(statesTexts);
  const unknown = pinned.filter((screen) => !names.has(screen.state) && !prefixes.some((prefix) => screen.state.startsWith(prefix)));
  if (unknown.length === 0) return { problems: [], notes: [] };
  if (statesBuiltInCode(statesTexts))
    return {
      problems: [],
      notes: [`design-canvas/project/states.ts builds its state names in code, so ${unknown.length} pinned state(s) could not be checked from its text (${unknown.slice(0, 4).map((screen) => `"${screen.state}"`).join(", ")}); the capture marks a pin the page does not have`],
    };
  return {
    problems: unknown.map((screen) => `${screen.id}: pins the state "${screen.state}", which design-canvas/project/states.ts does not have, so the frame would show the default: add the state, or name one that exists`),
    notes: [],
  };
}

/* ------------------------------------------------------------------ coverage: what the declared screens reach */

/** A surface rendered from more files than this is a shared part (the shell every dialog is built on), not one flow's surface. */
export const SHARED_SURFACE_FILES = 5;

/**
 * Links and navigations to an address inside the app: `href="/x"`, `href={"/x"}`, a router's or history's `push("/x")` and
 * `replace`, `navigate`, `redirect`, each also through one wrapping call (`push(withBase("/x"))`). Template parts stand for one
 * path segment. A string's own `replace("/", "")` is not a navigation, so `push` and `replace` need a router or history before them.
 */
const ROUTE_RES = [
  /\bhref\s*=\s*\{?\s*(?:[\w.]+\(\s*)?["'`](\/(?!\/)[^"'`?#\s]*)/g,
  /\b(?:\w*(?:router|history|navigation)\w*\.(?:push|replace)|navigate|redirect)\(\s*(?:[\w.]+\(\s*)?["'`](\/(?!\/)[^"'`?#\s]*)/gi,
];

/** An address as path segments, a `*` for any segment built in code. Null for what is not a page (an API, a file, a build asset). */
export function routePattern(raw) {
  const segments = String(raw)
    .split("?")[0]
    .split("/")
    .filter(Boolean)
    .map((segment) => (/\$\{|\[/.test(segment) ? "*" : segment));
  if (/^(api|_next|design-canvas)$/.test(segments[0] ?? "")) return null;
  if (/\.[a-z0-9]{2,5}$/i.test(segments.at(-1) ?? "")) return null;
  return segments;
}

/** Is the name nothing but its kind's word (`Dialog`, `DropdownMenu` is not)? */
const nameIsKindOnly = (name) => surfaceKind(name) !== null && !/[a-z0-9][A-Z]/.test(name);

/** Does a link pattern land on a declared address? Same length, each segment equal or built in code. */
const sameRoute = (link, declared) => link.length === declared.length && link.every((one, at) => one === "*" || declared[at] === "*" || one === declared[at]);

/** Where a component used in a file is defined: the file it is imported from (resolved), the file itself, or null (a package). */
function definitionOf(name, text, file, root) {
  for (const match of text.matchAll(IMPORT_RE)) {
    const spec = match[1] ?? match[2];
    if (!spec || !new RegExp(`(?<![\\w$])${name}(?![\\w$])`).test(match[0].slice(0, match[0].lastIndexOf(spec)))) continue;
    return resolveSpecifier(spec, file, root);
  }
  return new RegExp(`(?:function|const|let|class)\\s+${name}\\b`).test(text) ? file : null;
}

/**
 * WHAT THE DECLARED SCREENS REACH THAT NO FRAME SHOWS, read from files alone: across the import closure of every screen's `source`,
 *   - the dialogs, sheets and menus rendered there (a JSX tag whose name says so, by the name table in components.mjs, defined in
 *     a component file of the project) whose file no frame lists in its `source`. Left out: a package's primitive, a name that is
 *     only the kind (`Dialog`), a shell that takes its content as `children`, and a part rendered from more than
 *     `SHARED_SURFACE_FILES` files;
 *   - the addresses linked or navigated to that no frame's `route` lands on.
 * `screens` are this canvas's, `declared` every canvas's (`{ routes, sources }`, so a surface another canvas shows counts). A note,
 * never a failure: a declared flow can be complete without every dialog it opens.
 */
export function coverageGaps({ root, screens, declared }) {
  const entries = [...new Set((screens ?? []).filter((screen) => !screen.explain && !screen.wireframe).flatMap((screen) => screen.source ?? []))];
  const files = filesReachedFrom(entries, root).filter((rel) => /\.(tsx|jsx|ts|js)$/.test(rel) && !/(^|\/)(design-canvas|node_modules)\//.test(rel));
  const surfaces = new Map();
  const links = new Map();
  for (const rel of files) {
    const at = path.join(root, rel);
    let text;
    try {
      text = stripComments(readFileSync(at, "utf8"));
    } catch {
      continue;
    }
    for (const re of ROUTE_RES)
      for (const match of text.matchAll(re)) {
        const pattern = routePattern(match[1]);
        if (pattern && !links.has(`/${pattern.join("/")}`)) links.set(`/${pattern.join("/")}`, { pattern, from: rel });
      }
    for (const name of new Set([...text.matchAll(/<([A-Z][\w$]*)(?=[\s/>])/g)].map((match) => match[1]))) {
      const kind = surfaceKind(name);
      /* A name that is only its kind (`Dialog`, `Menu`) is the primitive itself, not one flow's surface. */
      if (!kind || nameIsKindOnly(name)) continue;
      const defined = definitionOf(name, text, at, root);
      /* Defined in a component file of the project; a package's primitive, an icon set or a re-export is not a surface of a flow. */
      if (!defined || !/\.(tsx|jsx)$/.test(defined)) continue;
      const file = path.relative(root, defined).split(path.sep).join("/");
      const key = `${file}#${name}`;
      if (!surfaces.has(key)) surfaces.set(key, { name, kind, file, renderers: new Set() });
      surfaces.get(key).renderers.add(rel);
    }
  }
  /* A shell takes its content as `children` (a dialog wrapper every dialog is built on): what it shows is decided by its caller. */
  const isShell = (one) => {
    try {
      const text = stripComments(readFileSync(path.join(root, one.file), "utf8"));
      return new RegExp(`(?:function\\s+${one.name}\\s*(?:<[^>]*>)?\\(|\\b${one.name}\\s*=\\s*(?:[\\w.]+\\()?\\s*\\()\\s*\\{[^}]*\\bchildren\\b`).test(text);
    } catch {
      return false;
    }
  };
  const sources = new Set(declared.sources);
  const routes = declared.routes.map((route) => routePattern(route) ?? []);
  return {
    surfaces: [...surfaces.values()]
      .filter((one) => one.renderers.size <= SHARED_SURFACE_FILES && !sources.has(one.file) && !isShell(one))
      .map(({ name, kind, file }) => ({ name, kind, file }))
      .sort((a, b) => a.file.localeCompare(b.file)),
    routes: [...links]
      .filter(([, one]) => !routes.some((route) => sameRoute(one.pattern, route)))
      .map(([route, one]) => ({ route, from: one.from }))
      .sort((a, b) => a.route.localeCompare(b.route)),
  };
}

/** The note for the preflight, or null when everything reached is on a canvas. Each list is capped, with the rest counted. */
export function coverageNote({ surfaces, routes }, cap = 10) {
  if (surfaces.length === 0 && routes.length === 0) return null;
  const list = (items, show) => items.slice(0, cap).map(show).join(", ") + (items.length > cap ? `, and ${items.length - cap} more` : "");
  const parts = [
    surfaces.length > 0 && list(surfaces, (one) => `${one.kind} ${one.name} (${one.file})`),
    routes.length > 0 && `${routes.length === 1 ? "route" : "routes"} ${list(routes, (one) => `${one.route} (linked from ${one.from})`)}`,
  ].filter(Boolean);
  return `Reachable but not on the canvas: ${parts.join("; ")}. Declare a frame for each one the work touches; a frame lists the surface's file in its \`source\``;
}

/* ------------------------------------------------------------------ the claims, against the shipped copy */

/**
 * Every `expect` claim of every screen of the APP, with the screen it belongs to. An explanation frame proves nothing, frozen
 * history is never captured again, and a wireframe or a still is not a page of the app: its claims are the words on a file
 * served elsewhere, so the app's locale files say nothing about them.
 */
export function collectClaims(screens) {
  const claims = [];
  for (const screen of screens ?? []) {
    if (screen.explain || screen.frozen || screen.wireframe) continue;
    const list = Array.isArray(screen.expect) ? screen.expect : screen.expect ? [screen.expect] : [];
    for (const claim of list) if (typeof claim === "string" && claim.trim()) claims.push({ screen: screen.id, claim });
  }
  return claims;
}

/** Every string value in a locale file, nested however the project nests it. */
export function flattenLocale(json) {
  const out = [];
  const walk = (value) => {
    if (typeof value === "string") out.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  walk(json);
  return out;
}

const PLACEHOLDER_SOURCE = String.raw`\{\{?[^{}]*\}?\}|%[sd]|\$\{[^}]*\}|<[a-z0-9]+>`;
/** One that TESTS (no `g`, so it keeps no state between calls) and one that SPLITS. */
const HAS_PLACEHOLDER = new RegExp(PLACEHOLDER_SOURCE, "i");
const SPLIT_PLACEHOLDER = new RegExp(PLACEHOLDER_SOURCE, "gi");

/**
 * DOES A TEMPLATE ("Saved {name}") PRODUCE THIS CLAIM? The literal parts must appear in order, each placeholder standing for
 * anything. Unanchored, because a claim is a piece of what the page says. A template with under four literal characters
 * matches everything and so matches nothing.
 */
export function templateMatches(template, claim) {
  const pattern = templatePattern(template);
  return pattern ? pattern.test(claim) : false;
}

/** A template as a regular expression, or null when it is not one worth matching: no placeholder, or too little of its own. */
function templatePattern(template) {
  if (!HAS_PLACEHOLDER.test(template)) return null;
  const parts = template.split(SPLIT_PLACEHOLDER);
  if (parts.join("").trim().length < 4) return null;
  try {
    return new RegExp(parts.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*?"), "s");
  } catch {
    return null;
  }
}

/** A string for comparing copy that differs only in case, spacing and closing punctuation. */
const loose = (text) => text.toLowerCase().replace(/\s+/g, " ").replace(/^[\s"'.,:;!?()-]+|[\s"'.,:;!?()-]+$/g, "");

/**
 * EVERY CLAIM AGAINST WHAT THE APP SHIPS. Three outcomes, and NONE of them fails a run on its own, because a static read
 * of a locale file cannot know what the page renders:
 *
 *   drift    no exact match anywhere, but a shipped string is the same words in another case or with other closing
 *            punctuation: the capture WILL miss it, unless the page renders the text transformed (`innerText` applies CSS
 *            `text-transform`, so "Save Changes" can be on a page whose locale says "Save changes"). The caller reports it
 *            and lets the LIVE check, which reads the page, decide.
 *   unknown  no match at all. The claim may be data (a name, a number, a seeded record).
 *   (found)  exact in a locale string, in a template a locale string fills, literally in the source, or PROVED by the last
 *            capture (`proven`, a set of `<screen>\u0000<claim>` the manifest recorded as met): the page itself said so.
 *
 * `locale` is the list of shipped strings, `source` the project's source text as one string. Drift is judged against the
 * locale strings only: a case-insensitive hit in source code matches variable names, and a preflight that called "Tasks" a
 * drift from `tasks` would be wrong every time.
 */
export function claimFindings({ claims, locale, source, proven = new Set() }) {
  const localeText = locale.join("\u0000");
  /* Compiled ONCE: a real locale has thousands of templates and a canvas hundreds of claims, and building the pair's
     regular expression inside the loop was most of the time a preflight took. */
  const templates = locale.map(templatePattern).filter(Boolean);
  const localeLoose = locale.map((one) => [one, loose(one)]);
  const drift = [];
  const unknown = [];
  let found = 0;
  /* The same claim on twenty frames is one question. */
  const answered = new Map();
  const answer = (claim) => {
    if (answered.has(claim)) return answered.get(claim);
    let result;
    if (localeText.includes(claim) || templates.some((pattern) => pattern.test(claim)) || source.includes(claim)) result = { found: true };
    else {
      const wanted = loose(claim);
      const words = wanted.split(" ").length;
      const near = localeLoose.find(([, text]) => text === wanted || (words >= 2 && wanted.length >= 8 && text.includes(wanted)));
      result = near ? { drift: near[0] } : { unknown: true };
    }
    answered.set(claim, result);
    return result;
  };
  const reportedUnknown = new Set();
  for (const { screen, claim } of claims) {
    if (proven.has(`${screen}\u0000${claim}`)) {
      found += 1;
      continue;
    }
    const result = answer(claim);
    if (result.found) found += 1;
    else if (result.drift) drift.push({ screen, claim, shipped: result.drift });
    else if (!reportedUnknown.has(claim)) {
      /* One note per unknown claim however many frames repeat it. A drift is per frame: each of them fails its capture. */
      reportedUnknown.add(claim);
      unknown.push({ screen, claim });
    }
  }
  return { drift, unknown, found };
}

/* ------------------------------------------------------------------ what the project ships */

const SKIP_DIRS = new Set(["node_modules", ".git", ".next", ".next-canvas", "dist", "build", "coverage", ".turbo", "design-canvas", ".vercel", ".expo", "ios", "android"]);
const TEXT_FILE = /\.(?:tsx?|jsx?|mjs|cjs|json|mdx?)$/i;
const MAX_FILE_BYTES = 600 * 1024;
const MAX_TOTAL_BYTES = 60 * 1024 * 1024;

/** Walk the project for files matching a test, skipping what is never shipped copy. Bounded in depth and in size. */
function walk(root, test, { depth = 8 } = {}) {
  const out = [];
  const visit = (dir, level) => {
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".next") || SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (level < depth) visit(full, level + 1);
      } else if (test(full, entry.name, dir)) out.push(full);
    }
  };
  visit(root, 0);
  return out;
}

/** Locale files the project ships, when none are named: `en.json`, `en-US.json`, or any JSON in a folder called `en`. */
export function detectLocales(root) {
  return walk(root, (full, name, dir) => /^en([-_][a-z]{2})?\.json$/i.test(name) || (name.endsWith(".json") && path.basename(dir) === "en"), { depth: 5 });
}

/**
 * THE PROJECT'S SHIPPED COPY: the locale strings, and the source as text. Returns what was read, so a run can say which
 * files it judged against. Unreadable and oversized files are skipped rather than failing a check of the copy.
 */
export function loadProjectTexts(root, localeFiles) {
  const locale = [];
  for (const file of localeFiles) {
    try {
      locale.push(...flattenLocale(JSON.parse(readFileSync(file, "utf8"))));
    } catch {
      /* A locale that does not parse is reported by the caller as a file it could not read. */
    }
  }
  const pieces = [];
  let total = 0;
  for (const file of walk(root, (full, name) => TEXT_FILE.test(name))) {
    let size = 0;
    try {
      size = statSync(file).size;
    } catch {
      continue;
    }
    if (size > MAX_FILE_BYTES || total + size > MAX_TOTAL_BYTES) continue;
    try {
      pieces.push(readFileSync(file, "utf8"));
      total += size;
    } catch {
      /* skipped */
    }
  }
  return { locale, source: pieces.join("\u0000"), sourceFiles: pieces.length };
}

/** Which of the named locale files exist, and which do not: a setting that points at nothing is a finding, not a silence. */
export function checkLocaleFiles(files) {
  return { present: files.filter((file) => existsSync(file)), missing: files.filter((file) => !existsSync(file)) };
}
