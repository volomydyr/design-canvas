/**
 * design-canvas ADAPTER — the declaration. THE ONLY PLACE SCREENS ARE NAMED.
 *
 * Plain data. It imports nothing but the core's types, so this file is the whole of what has to change
 * when the app does. Adding a screen to the canvas is one entry here, plus the edge that says how a
 * person reaches it.
 *
 * Rules this file follows, and the reasons, because they are what keep the canvas honest:
 *
 *   `route`   is a REAL route in this app. Never a copy, never a mock, never a simplified stand-in. The
 *             canvas is a viewer: if a screen is not reachable at a URL, the work is to make it
 *             reachable, not to draw something that resembles it.
 *   `state`   is optional. It names a state in `./states.ts`; a screen without one renders as it comes,
 *             and a project with no `states.ts` at all still gets a complete canvas.
 *   `expect`  is text that must be in the settled page, one string or a list of them, all of which have
 *             to be there. It is the oracle for "this frame shows what its label claims" — two labels
 *             resolving to the same screen is the failure it catches. It is looked for in the frame's own
 *             document AND in every same-origin frame inside it, because a frame is everything rendered
 *             in it. Choose the string FROM THE PAGE, never from the label: pages title-case, truncate
 *             and abbreviate, and a claim written from the label is a claim about what you assumed.
 *   `expectMissing` is the same claim inverted, and it is the ONLY oracle an empty state has. Every
 *             positive string on a page with nothing in it is equally true of the same page full — the
 *             business name is on both — so `expect` cannot separate them and the tile can photograph the
 *             wrong state and pass. What separates them is what the page does NOT say.
 *   `expectSelector` is the same claim for a state with no words in it — a filled cover is a picture, and
 *             which step a dialog is on is an attribute.
 *   `note`    says what the screen is FOR, not what it looks like. The frame shows what it looks like.
 *   `kind`    groups it in the Grouped screens view, where near-identical states sit side by side. EVERY
 *             kind must hold at least two screens: a heading over one frame is not a group, and
 *             `check-canvas.mjs` fails on it.
 *   `source`  is the one or two files the screen is built from — its route file, then the component that
 *             owns the surface. Once a frame is a picture, "where does this live" is a question the
 *             picture cannot answer. The oracle asserts every path still exists.
 *   `edges`   is the flow. See below: this is the part that carries the meaning.
 *
 * TWO RULES THAT ARE NOT FIELDS, and both were learned from a designer reading a finished canvas:
 *
 *   NO TWO SCREENS MAY RESOLVE TO THE SAME ROUTE AND STATE. They photograph identically, and a reader has
 *   no way to know the repetition was deliberate: they hunt for the difference, do not find it, and stop
 *   trusting the canvas. Drawing a surface twice "so the variants can be compared" is the tempting version
 *   of this mistake and it did not survive its first review. One frame, one tile. `check-canvas.mjs` fails
 *   on a collision.
 *
 *   EVERY LABEL AND NOTE USES THE PRODUCT'S WORDS, NEVER THE TOOL'S. They are read by a designer, not by
 *   the agent that wrote them. A canvas shipped with four tiles saying "slot" — the internal name for a box
 *   the product's UI never called that once — and the verdict was "the language is just really weird. Like
 *   what does the slot mean? We never used such words anywhere."
 *
 * HOW AN EDGE IS LABELLED, and `check-canvas.mjs` enforces this rather than trusting it. "Keep it short"
 * is not a rule, and on the build this came from it produced labels like `a piece` — a noun sitting
 * between two screens, explaining nothing about how a person got from one to the other. The owner:
 *
 *   "what does 'a piece' mean between two screenshots? usually, as I already mentioned, these connectors
 *   are about actions done on the previous screen that lead to the next screen. it can't be just a noun
 *   or some random word(s). also, you still need to follow the consistent amount of charachters for all
 *   such flows"
 *
 *   AN ACTION EDGE says what the person DID on the screen the arrow leaves. It starts with a verb in the
 *   present tense from the closed list in `check-canvas.mjs`: Presses, Opens, Answers, Finishes, Chooses,
 *   Picks, Adds, Makes, Searches, Waits. Where the surface has a real button, the verb quotes it:
 *   "Presses Set up my store". Nothing here invents product copy.
 *
 *   A CONDITION EDGE says what was TRUE, has no press behind it, and starts with "When": "When no pieces
 *   exist", "When no collections". These are the branches, and they are the interesting part.
 *
 *   EVERY LABEL IS BETWEEN 12 AND 24 CHARACTERS, across the whole canvas and not merely within one flow,
 *   so thirty chips read as one system rather than as thirty separate decisions.
 *
 *   THERE IS NO "BACK". Return edges were drawn once and deleted, not restyled: 52 edges became 33. A
 *   Back button and a breadcrumb are things every developer already expects. An edge earns its place by
 *   saying something that cannot be guessed from the frames themselves, and left-to-right order already
 *   says "and then this one".
 *
 * WHAT THE EDGES ARE FOR. A user flow is a branching diagram, not a sequence. The owner, rejecting the
 * first build: "a user flow is not a linear thing. The whole point of the user flow is to show all the
 * possible branches of the flow that the user is going through. Otherwise, you're not building anything
 * really helpful for me." So every edge is a real move a person can make, and the ones that leave the
 * happy path — a skip, a close, an empty store — are the ones worth drawing.
 *
 * SAY WHAT IS MISSING, HERE, IN THIS FILE. A canvas that pretends to be complete is worse than one that
 * says what it misses. Surfaces that cannot be captured honestly (a camera page inside a frame shows the
 * camera blocked, which is a state no user is ever in), states with no URL flag of their own, and
 * viewports not covered all belong in this header as named gaps rather than as silence.
 */

import type { CanvasDeclaration, CanvasRegistry } from "../core/types";

export const CANVAS: CanvasDeclaration = {
  title: "REPLACE ME — what this canvas covers",
  note: "Real pages, held still, connected the way the people who use them actually move between them. Nothing here is a mockup: every frame is the route named under it, running.",
  /* The width the app is authored at, and the height of a real viewport. A frame is a viewport, never a
     printout. */
  viewport: { w: 1440, h: 900 },
  /* Four fifths of real size: a 1440px page lands on the canvas at 1152px. Big enough to judge type,
     spacing and hierarchy; small enough that a branch of a flow fits on a laptop screen. */
  frameScale: 0.8,
  flows: [
    /**
     * DELETE THIS EXAMPLE AND DECLARE THE REAL SCREENS. Until then `check-canvas.mjs` fails, which is the
     * intended state of a half-written declaration: an empty canvas that says it is fine is the one
     * outcome this tool exists to prevent.
     */
    {
      id: "example",
      title: "Example flow",
      note: "What this journey is, in one line: who is doing it and what they are trying to get done.",
      screens: [
        {
          id: "example-a",
          label: "The first screen",
          note: "What this screen is FOR",
          route: "/",
          kind: "Example",
          source: ["app/page.tsx"],
          expect: ["a string that is really on this page"],
        },
        {
          id: "example-b",
          label: "The second screen",
          note: "What this screen is FOR",
          route: "/",
          kind: "Example",
          source: ["app/page.tsx"],
          expect: ["a string that is really on this page"],
        },
      ],
      edges: [
        { from: "example-a", to: "example-b", label: "Presses Continue" },
      ],
    },
  ],
  /**
   * OPTIONAL THIRD VIEW: one question, and the competing answers to it, side by side at full size. Delete this
   * key and the third tab disappears — an exploration is scaffolding, not part of the canvas, and it is meant
   * to be removed once the question is settled and the winner has moved into the flows above.
   *
   * Each screen is one DIRECTION, and its label is the direction's name, because that is what gets said out
   * loud when choosing between them. Two or more, or there is nothing to compare. A second round is a second
   * entry here rather than a nesting level, so the rejected options stay visible beside the refined ones.
   */
  // explorations: [
  //   {
  //     id: "example-question",
  //     title: "Where does the thing live?",
  //     note: "What the choice decides for everything built after it",
  //     round: "5 directions",
  //     screens: [ /* one per direction, each a REAL route */ ],
  //   },
  // ],
};

/**
 * EVERY CANVAS THIS PROJECT HAS, keyed by the slug that addresses it: `/design-canvas/<slug>`.
 *
 * One project is often one canvas, and then this is one entry. It stops being one the moment a second feature
 * wants its own — and the slug is the whole of the separation, because it also namespaces the shots on disk
 * and the comment file, so two canvases can never photograph over each other's frames or mix their reviews.
 *
 * A slug is lowercase letters, digits and dashes: it is a URL segment and a directory name at once. Name it
 * after the feature (`checkout`, `storefront`), never after the round of work.
 *
 * Each canvas MAY live in its own file under `project/` and be imported here — that keeps a large declaration
 * readable — but this is the one place a canvas is named, so this is where to look for the list.
 */
export const CANVASES: CanvasRegistry = {
  main: CANVAS,
};
