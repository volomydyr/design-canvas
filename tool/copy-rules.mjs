/**
 * design-canvas — THE COPY RULES, AS CODE.
 *
 * Every word a canvas draws is read by somebody who was not in the room: a teammate opening the index cold, a
 * developer looking for the state they have to build, the reviewer six weeks later. The tool had a rule for its
 * arrows and none for anything else, so the rest drifted into whatever the agent felt like writing that day. One
 * standard needs a mechanism that holds the agent and the people to it, and this is that mechanism.
 *
 * THE STANDARD IS ASD-STE100, Simplified Technical English, which exists for this exact job: text that has to be
 * unambiguous to a reader who is not fluent, not local, and not in the mood. Its full dictionary is not shipped
 * here. What is shipped is every part of it a machine can decide.
 *
 *   1. ONE IDEA PER SENTENCE, and a short one. A note is one sentence of twenty words or fewer.
 *   2. THE ACTIVE VOICE. "The provider adds the record", never "the record is added by the provider".
 *   3. ONE WORD, ONE MEANING. A photographed screen is a frame, always (see ONE_WORD). The product's own words for
 *      its people are the project's to choose, so they are not checked here. A synonym is a failure, not a style choice.
 *   4. NO INTENSIFIERS AND NO MARKETING. "simply", "powerful", "seamless", "really", "just" say nothing.
 *   5. A NAME IS A NAME. A canvas title is what you call it. The sentence about it is the note.
 *
 * Case, spelling variety and punctuation style are the project's own, so they are not checked here.
 *
 * WHAT THIS CANNOT CHECK: whether the words are TRUE, whether the note is worth reading, and whether a label
 * matches the frame above it. `check-canvas.mjs` covers the last of those by asserting what each captured page
 * contains. The first two are why a person reviews the canvas.
 *
 * DELETE WITH: the design-canvas/ folder.
 */

/** Words that carry no information. Each is a failure, with the shorter thing to do instead. */
const BANNED = {
  simply: "delete it",
  just: "delete it",
  easily: "delete it",
  really: "delete it",
  very: "delete it",
  quite: "delete it",
  actually: "delete it",
  basically: "delete it",
  obviously: "delete it",
  seamless: "say what happens",
  seamlessly: "say what happens",
  robust: "say what it survives",
  powerful: "say what it does",
  intuitive: "delete it",
  delightful: "delete it",
  beautiful: "delete it",
  magic: "say what happens",
  magical: "say what happens",
  leverage: 'write "use"',
  utilize: 'write "use"',
  various: "say how many",
  several: "say how many",
  stuff: "name it",
  etc: "finish the list or cut it",
};

/** Phrases ASD-STE100 replaces with one word. */
const WORDY = [
  ["in order to", "to"],
  ["prior to", "before"],
  ["subsequent to", "after"],
  ["in the event that", "if"],
  ["due to the fact that", "because"],
  ["at this point in time", "now"],
  ["is able to", "can"],
  ["are able to", "can"],
  ["has the ability to", "can"],
];

/** One word, one meaning: the words on the left are never used, the one on the right always is. */
const ONE_WORD = [
  [["screenshot", "screenshots", "thumbnail", "thumbnails"], "frame"],
];

/**
 * A passive with its agent named. Narrow on purpose: "is added by the provider" cannot be anything else, while a
 * bare "is captured" is often the only honest way to say it and is left alone.
 */
const PASSIVE = /\b(is|are|was|were|be|been|being)\s+\w+(ed|en)\s+by\b/i;

const words = (text) => text.trim().split(/\s+/).filter(Boolean);

/** Sentence ends: terminal punctuation followed by a space or the end. A decimal point is not an ending. */
const sentences = (text) =>
  text
    .replace(/\b\d+\.\d+\b/g, "0")
    .split(/[.!?](?:\s|$)/)
    .map((one) => one.trim())
    .filter(Boolean).length;

/**
 * The caps per slot. A NAME is a few words with no sentence punctuation, a LABEL is a short phrase over a frame, a
 * NOTE is one sentence under it, a FRAGMENT finishes a phrase somebody else started, and LONG is the description
 * on the index or over a group.
 */
const CAPS = {
  name: { words: 4, sentences: 1 },
  label: { words: 6, sentences: 1 },
  note: { words: 20, sentences: 1 },
  fragment: { words: 14, sentences: 1 },
  long: { words: 25, sentences: 2 },
  /* An explanation frame's body: a few sentences narrating a step outside the app. The one slot allowed a
     paragraph, capped so it still fits the fixed panel it is drawn in (EXPLAIN_SIZE in graph-layout.ts). */
  explain: { words: 45, sentences: 4 },
};

/** One string, held to the shape its slot allows. Returns a list of lines, each naming what to change. */
export function checkCopyString(text, { kind, where }) {
  const problems = [];
  const say = (what) => problems.push(`${where} ${what}`);
  if (typeof text !== "string" || text.trim().length === 0) {
    say("is empty, and every one of these has to say something");
    return problems;
  }
  const caps = CAPS[kind];
  const count = words(text).length;
  if (count > caps.words)
    say(`is ${count} words and the cap here is ${caps.words}: "${text}"`);
  const ends = sentences(text);
  if (ends > caps.sentences)
    say(
      `is ${ends} sentences and the cap here is ${caps.sentences}, one idea each: "${text}"`,
    );

  if (/;/.test(text))
    say(`uses a semicolon, which is two sentences: "${text}"`);
  if (kind === "name" && /[,:]/.test(text))
    say(`is a sentence, not a name, so move the rest into the note: "${text}"`);

  /* A QUOTATION IS SOMEBODY'S OWN WORDS, and it is kept verbatim: a note that quotes someone ("Requests are reviewed
     by the support team") is not the canvas's voice, so the filler, wordiness and passive checks read only the
     words outside the quotation marks. The caps above still count every word. */
  const own = text.replace(/"[^"]*"|“[^”]*”/g, " ");
  const bare = own.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
  for (const word of new Set(words(bare))) {
    if (BANNED[word]) say(`says "${word}", so ${BANNED[word]}`);
    for (const [synonyms, preferred] of ONE_WORD)
      if (synonyms.includes(word))
        say(`says "${word}", and one word one meaning means "${preferred}"`);
  }
  for (const [phrase, shorter] of WORDY)
    if (bare.includes(phrase)) say(`says "${phrase}", so write "${shorter}"`);
  if (PASSIVE.test(own)) say(`is passive, so name who does it: "${text}"`);

  return problems;
}

/**
 * A whole canvas's copy in one pass. Takes the payload the shots route serves at `?screens=1`, so it can never
 * check a different set of words than the canvas draws.
 */
export function checkCanvasCopy({ title, note, groups, screens, kinds }) {
  const problems = [];
  problems.push(
    ...checkCopyString(title, { kind: "name", where: "the canvas title" }),
  );
  problems.push(
    ...checkCopyString(note, { kind: "long", where: "the canvas note" }),
  );
  for (const group of groups ?? []) {
    problems.push(
      ...checkCopyString(group.title, {
        kind: "label",
        where: `group "${group.id}" title`,
      }),
    );
    problems.push(
      ...checkCopyString(group.note, {
        kind: "long",
        where: `group "${group.id}" note`,
      }),
    );
  }
  for (const one of kinds ?? [])
    problems.push(
      ...checkCopyString(one.whatBelongs, {
        kind: "fragment",
        where: `section "${one.id}"`,
      }),
    );
  for (const screen of screens ?? []) {
    problems.push(
      ...checkCopyString(screen.label, {
        kind: "label",
        where: `${screen.id} label`,
      }),
    );
    /* An explanation frame carries its whole body in `explain` — its panel draws no note, so
       requiring one would demand copy nothing ever renders. Captured screens keep the requirement. */
    if (!screen.explain)
      problems.push(
        ...checkCopyString(screen.note, {
          kind: "note",
          where: `${screen.id} note`,
        }),
      );
    if (screen.explain)
      problems.push(
        ...checkCopyString(screen.explain, {
          kind: "explain",
          where: `${screen.id} explanation`,
        }),
      );
    /* The remarks laid over a design are read at a glance or not at all, so they are held to the fragment's cap:
       a sticky is a few words, a highlight's label one or two. */
    if (screen.sticky)
      problems.push(...checkCopyString(screen.sticky, { kind: "fragment", where: `${screen.id} sticky note` }));
    for (const mark of screen.marks ?? [])
      if (mark.label)
        problems.push(...checkCopyString(mark.label, { kind: "name", where: `${screen.id} highlight` }));
    /* The one word drawn on an evidence tile is the system's name. Its source and caption are shown only when
       the picture is opened large, and they are the report's own words, so they are not held to a slot's cap. */
    for (const one of screen.evidence ?? [])
      problems.push(...checkCopyString(one.name, { kind: "name", where: `${screen.id} evidence "${one.file}"` }));
  }
  return problems;
}

/**
 * THE VERBS AN ACTION EDGE MAY START WITH, and "When" for a condition. One list, here, because the oracle and the preflight
 * both hold an edge label to it, and two copies of a closed list drift the first time somebody adds a verb to one.
 *
 * The last entries were added with the small-states rule: the beats between an empty form and a saved one are typing,
 * fixing and pressing, and a flow that carries "the state when I enter something" needs a label for it; and a hover is a
 * beat too, written device-neutral on purpose ("Points" reads for a mouse and for a finger).
 */
export const EDGE_VERBS = [
  "Presses",
  "Opens",
  "Answers",
  "Finishes",
  "Chooses",
  "Picks",
  "Adds",
  "Makes",
  "Searches",
  "Waits",
  "Types",
  "Fixes",
  "Points",
  "When",
];

/** What is wrong with one edge label, as sentences (empty when it is fine). Twelve to twenty-four characters, a verb from the list. */
export function checkEdgeLabel(label) {
  if (!label) return ["has no label, and every arrow has to say what happened"];
  const problems = [];
  const verb = label.split(" ")[0];
  if (!EDGE_VERBS.includes(verb)) problems.push(`"${label}" does not start with an action or "When"`);
  if (label.length < 12 || label.length > 24) problems.push(`"${label}" is ${label.length} characters, outside 12 to 24`);
  return problems;
}

