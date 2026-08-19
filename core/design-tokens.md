# The canvas's own palette, written out

Every value the canvas draws itself with is a literal in `core/`, never a token of the project it is
installed in. This file is the record of what those literals are and where they came from, so that a
future reader can tell a deliberate value from a stray one.

The reason is the whole point of the tool. Owner:

> "I really like the design of the canvas, I think it can be reused as is for any projects."

and, on why it is this restrained in the first place:

> "if you try to make it look colorful, fancy... it will make me biased. I won't understand where is the
> real design."

A canvas that inherits the host project's brand competes with the frames it holds, and it stops being
the same instrument from one project to the next. So none of these are configurable.

| Where                                     | Literal                                                                                                                                 | What it is                                                                                                                                          |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| The stage                                 | `hsl(192 12% 13%)`                                                                                                                      | Dark grey, deliberately not near-black: a captured screen can be light or dark and both have to read as sitting **on** something.                   |
| Tooltip panel                             | `hsl(192 12% 18%)`                                                                                                                      | The stage's own hue, five points lighter: a tooltip floats OVER the frames, so it is raised rather than sunken.                                      |
| Chrome — toolbar, note box, handoff panel | `hsl(180 15% 5.5%)`                                                                                                                     | Near-black, one step below the stage, so the controls sit under the frames rather than beside them.                                                 |
| New-screen edge and its bar                | `hsl(206 92% 66% / 0.95)` on the frame, `hsl(206 58% 36%)` on the bar                                                                    | The one blue in the tool. A screen the reviewer has never seen takes the frame's own hairline in it, and the bar turns the same hue while stepping through them — so "designs I have not seen" and "comments I have to approve" are told apart by colour before either is read. Green stays the review colour. |
| Annotations — outline, pin, failure chip  | `hsl(0 84.2% 60.2%)` on `hsl(210 40% 98%)`                                                                                              | The only red anywhere near this tool. An annotation has to be findable on any design, which is the opposite requirement to the canvas's own chrome. |
| The outline burned into the handoff PNG   | `#e11d48`                                                                                                                               | Drawn in a `<canvas>` rather than in CSS, so it is written where it is used, in `canvas-frame.tsx`.                                                 |
| Frame edge                                | `0 0 0 3px hsl(0 0% 100% / 0.14)` plus a wide soft shadow                                                                               | A hairline drawn as a **shadow, never a border** — see the trap list.                                                                               |
| Type steps                                | `0.625rem`, `0.75rem`, `0.8125rem` for screen-sized chrome; 23 / 26 / 28 / 42 / 132 **world** pixels for everything drawn on the canvas | Screen-sized text is a control; world-sized text is part of the drawing and scales with the frames.                                                 |
| Motion                                    | `220ms`, `cubic-bezier(0.22, 1, 0.36, 1)`                                                                                               | One duration and one curve for every state change in the chrome.                                                                                    |
| Font                                      | `Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`                                            | Named on the canvas root rather than inherited, so a host app's body font cannot change the type scale under it.                                    |
| Layers                                    | `50` for the note box, `60` for the toolbar                                                                                             | Written as `z-[50]` / `z-[60]` rather than as named layers the host project may not have.                                                           |

These began as tokens in the project the canvas was built in
(`--pm-viewer-surface`, `--brand-onyx-core`, `--destructive`, `text-caption`, `shadow-custom-2`,
`duration-state`, `ease-ios-out`, `z-dropdown`, `z-sticky`). Resolving them to their values is the one
change that makes the folder portable: a second project has none of those names, and a canvas built
against missing tokens renders as an unstyled wireframe — which is a failure the owner has already
rejected once, in those words.

**Tailwind still has to see this folder.** The values are literals, but they are still Tailwind
arbitrary-value classes, and Tailwind only generates the classes it finds by scanning its `content`
globs. A `design-canvas/` folder that is not in those globs loses every class the host app does not
already use. That trap has its own entry in `references/traps.md`, and `check-install.mjs` fails on it.
