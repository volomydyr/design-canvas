/**
 * design-canvas ADAPTER — the declaration, the only place screens are named. Plain data: it imports nothing but the core's types.
 * Every field is described in references/declaration.md; the rules that matter most:
 *
 *   `route`   a REAL route of this app, never a copy or a mock. A screen that has no URL is made reachable, not drawn.
 *   `state`   optional: a state named in `./states.ts`. A screen without one renders as it comes.
 *   `expect`  text that must be on the settled page, copied FROM the page, never from the label. `expectMissing` is the
 *             same claim inverted (the only oracle an empty state has); `expectSelector` is one for a state with no words.
 *   `note`    what the screen is for. The frame shows what it looks like.
 *   `kind`    the group in the Grouped Screens view. Every kind holds at least two screens.
 *   `source`  the route file, then the component that owns the surface. The oracle checks each path exists.
 *   `explain` instead of a route: a text frame for a step outside this app (a provider's sign-in page, an email).
 *
 * No two screens resolve to the same route and state: they would be one picture twice. Labels and notes use the product's
 * words, never the tool's.
 *
 * EDGES ARE THE FLOW, and every label is 12 to 24 characters. An action edge starts with a verb from the list in
 * copy-rules.mjs ("Presses Create account", quoting the real button) and names the pressed control in `origin` (its visible
 * text, or `css=` and a selector), or says why it cannot in `noOrigin`. A condition edge starts with "When" and carries
 * neither. No "Back" edges: an edge says what the frames cannot.
 *
 * Name the gaps here: surfaces that cannot be captured honestly, states with no URL, viewports not covered.
 */

import type { CanvasDeclaration, CanvasRegistry } from "../core/types";

export const CANVAS: CanvasDeclaration = {
  title: "Example Canvas",
  note: "Real pages of the app, connected the way people move between them",
  /* The width the app is authored at and the height of a real viewport: a frame is a viewport, never a printout. */
  viewport: { w: 1440, h: 900 },
  /* Four fifths of real size: big enough to judge type and spacing, small enough that a branch fits on a laptop. */
  frameScale: 0.8,
  flows: [
    /* Replace this example with the real screens. check-install.mjs fails while the flow id is still "example". */
    {
      id: "example",
      title: "Example flow",
      note: "Who is doing this journey and what they want done",
      screens: [
        {
          id: "example-a",
          label: "The first screen",
          note: "What this screen is for",
          route: "/",
          kind: "Example",
          source: ["app/page.tsx"],
          expect: ["a string that is really on this page"],
        },
        {
          id: "example-b",
          label: "The second screen",
          note: "What this screen is for",
          route: "/second",
          kind: "Example",
          source: ["app/second/page.tsx"],
          expect: ["a string that is really on this page"],
        },
      ],
      edges: [
        /* The capture measures `origin` on the live page; the flows view highlights it behind the press-origins toggle. */
        { from: "example-a", to: "example-b", label: "Presses Continue", origin: "Continue" },
      ],
    },
  ],
  /**
   * OPTIONAL: the Exploration tab, one question and the options that answer it, opened beside today's screen (`original`).
   * Delete the key and the tab is gone. The next round keeps only the liked options; the rest are deleted.
   */
  // explorations: [
  //   {
  //     id: "example-question",
  //     surface: "The first screen",
  //     title: "Where does the main action live?",
  //     note: "What the choice decides for everything built after it",
  //     round: 1,
  //     original: "example-a",
  //     screens: [ /* one per option, each a REAL route */ ],
  //   },
  // ],
};

/**
 * EVERY CANVAS THIS PROJECT HAS, keyed by the slug that addresses it (`/design-canvas/<slug>`) and namespaces its pictures and
 * its review. A slug is lowercase letters, digits and dashes, named after the feature. A canvas may live in its own file under
 * `project/canvases/` and be imported here, but this is where every canvas is named.
 */
export const CANVASES: CanvasRegistry = {
  main: CANVAS,
};
