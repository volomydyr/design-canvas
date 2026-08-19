/**
 * design-canvas — THE COPY RULES, AS CODE.
 *
 * Every word a canvas draws is read by somebody who was not in the room: a teammate opening the index cold, a
 * developer looking for the state they have to build, the reviewer six weeks later. The tool had a rule for its
 * arrows and none for anything else, so the rest drifted into whatever the agent felt like writing that day, and
 * the owner asked for one standard plus a way to hold it: *"it has to be some kind of like a mechanism that helps
 * the AI agent really follow these rules as well as for us, since there is no such a mechanism now."*
 *
 * THE STANDARD IS ASD-STE100, Simplified Technical English, which exists for this exact job: text that has to be
 * unambiguous to a reader who is not fluent, not local, and not in the mood. Its full dictionary is not shipped
 * here. What is shipped is every part of it a machine can decide.
 *
 *   1. ONE IDEA PER SENTENCE, and a short one. A note is one sentence of twenty words or fewer.
 *   2. THE ACTIVE VOICE. "The provider adds the record", never "the record is added by the provider".
 *   3. ONE WORD, ONE MEANING. The people here are the jeweler and the customer, always those two words. A
 *      photographed screen is a frame. A synonym is a failure, not a style choice.
 *   4. NO INTENSIFIERS AND NO MARKETING. "simply", "powerful", "seamless", "really", "just" say nothing.
 *   5. A NAME IS A NAME. A canvas title is what you call it. The sentence about it is the note.
 *   5b. TITLE CASE ON EVERY NAME AND EVERY LABEL, sentence case on every note. The owner's rule, and the host
 *      project's: *"dont forget about Camel Case for labels that you also should follow."* Minor words stay lower
 *      unless they open or close the label, which is the only part of Title Case anybody disagrees about.
 *   5c. AMERICAN SPELLING, always, which is the host project's rule and one this canvas had been breaking.
 *   6. NO DASHES AS PUNCTUATION, which is the host project's rule too, and they read badly at small sizes.
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
  [["user", "users", "seller", "sellers", "merchant", "merchants"], "jeweler"],
  [
    ["buyer", "buyers", "shopper", "shoppers", "visitor", "visitors"],
    "customer",
  ],
  [["screenshot", "screenshots", "thumbnail", "thumbnails"], "frame"],
];

/** British spellings this tool had in it, with the American one to use. */
const BRITISH = {
  recognise: "recognize",
  recognised: "recognized",
  organise: "organize",
  organised: "organized",
  colour: "color",
  colours: "colors",
  favourite: "favorite",
  behaviour: "behavior",
  centre: "center",
  licence: "license",
  cancelled: "canceled",
  cancelling: "canceling",
  travelling: "traveling",
  labelled: "labeled",
  modelled: "modeled",
};

/**
 * The words Title Case leaves alone in the middle of a label. Articles, coordinating conjunctions and short
 * prepositions, which is the set every style guide agrees on. First and last word are always capitalized.
 */
const MINOR = new Set([
  "a",
  "an",
  "the",
  "and",
  "but",
  "or",
  "nor",
  "for",
  "so",
  "yet",
  "as",
  "at",
  "by",
  "in",
  "of",
  "off",
  "on",
  "per",
  "to",
  "up",
  "via",
  "with",
  "from",
  "into",
  "over",
  "than",
]);
/* Only articles, coordinating conjunctions and short prepositions stay lower. Verbs and negations do NOT: Title
   Case is "It Did Not Go Through", and a first pass that wrote "It Did not Go Through" was wrong about the rule
   rather than about the words. */

/** What a label should read as, so the check can print the answer rather than only the complaint. */
export function titleCase(text) {
  const parts = text.split(/(\s+)/);
  const wordAt = parts
    .map((part, at) => (/\S/.test(part) ? at : null))
    .filter((at) => at !== null);
  const first = wordAt[0];
  const last = wordAt[wordAt.length - 1];
  return parts
    .map((part, at) => {
      if (!/\S/.test(part)) return part;
      /* A word that is already shouting an acronym, a product name or an id keeps whatever case it arrived in:
         "DNS", "GemIQ", "https". Two capitals or a digit is enough to say "leave me alone". */
      if (/[A-Z].*[A-Z]|\d/.test(part)) return part;
      const bare = part.toLowerCase();
      const key = bare.replace(/[^a-z']/g, "");
      if (at !== first && at !== last && MINOR.has(key)) return bare;
      return bare.replace(/[a-z]/, (letter) => letter.toUpperCase());
    })
    .join("");
}

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

  if (/[—–]/.test(text)) say(`uses a dash as punctuation: "${text}"`);
  if (/;/.test(text))
    say(`uses a semicolon, which is two sentences: "${text}"`);
  if (
    (kind === "name" || kind === "label" || kind === "fragment") &&
    /\.$/.test(text)
  )
    say(`ends with a period and is not a sentence: "${text}"`);
  if (kind === "name" && /[,:]/.test(text))
    say(`is a sentence, not a name, so move the rest into the note: "${text}"`);

  if (kind === "name" || kind === "label") {
    const wanted = titleCase(text);
    if (wanted !== text) say(`is not Title Case, and should read "${wanted}"`);
  }

  const bare = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
  for (const word of new Set(words(bare))) {
    if (BANNED[word]) say(`says "${word}", so ${BANNED[word]}`);
    if (BRITISH[word])
      say(`spells "${word}" the British way, so write "${BRITISH[word]}"`);
    for (const [synonyms, preferred] of ONE_WORD)
      if (synonyms.includes(word))
        say(`says "${word}", and one word one meaning means "${preferred}"`);
  }
  for (const [phrase, shorter] of WORDY)
    if (bare.includes(phrase)) say(`says "${phrase}", so write "${shorter}"`);
  if (PASSIVE.test(text)) say(`is passive, so name who does it: "${text}"`);

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
    problems.push(
      ...checkCopyString(screen.note, {
        kind: "note",
        where: `${screen.id} note`,
      }),
    );
  }
  return problems;
}
