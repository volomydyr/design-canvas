# The canvas's own palette, written out

Every value the canvas draws itself with is a literal in `core/`, never a token of the project it is
installed in. This file is the record of what those literals are and where they came from, so that a
future reader can tell a deliberate value from a stray one.

The canvas is reused as is in every project, and it is restrained on purpose: a colorful or decorated canvas
biases the reviewer and hides where the real design is. A canvas that inherits the host project's brand competes with the frames it holds, and it stops being
the same instrument from one project to the next. So none of these are configurable.

| Where                                     | Literal                                                                                                                                 | What it is                                                                                                                                          |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| The stage                                 | `hsl(192 12% 13%)`                                                                                                                      | Dark grey, deliberately not near-black: a captured screen can be light or dark and both have to read as sitting **on** something.                   |
| Tooltip panel                             | `hsl(192 12% 18%)`                                                                                                                      | The stage's own hue, five points lighter: a tooltip floats OVER the frames, so it is raised rather than sunken.                                      |
| Chrome — toolbar, note box, handoff panel | `hsl(180 15% 5.5%)`                                                                                                                     | Near-black, one step below the stage, so the controls sit under the frames rather than beside them.                                                 |
| New-screen edge and its bar                | `hsl(206 92% 66% / 0.95)` on the frame, `hsl(206 58% 36%)` on the bar                                                                    | The one blue in the tool. A screen the reviewer has never seen takes the frame's own hairline in it, and the bar turns the same hue while stepping through them, so unseen designs and comments to approve are told apart by color before either is read. Green stays the review colour. |
| Changed-screen edge and its bar | `hsl(0 0% 100% / 0.95)` outside a gap of the stage's `hsl(192 12% 13%)` on the frame, 2 + 2 screen pixels at any zoom; the chrome `hsl(180 15% 5.5%)` on the bar | No new hue: the hairline's white and the canvas ground, so it reads on light and dark screenshots and at fit zoom, and the toolbar's own surface for its bar. A seen frame whose picture changed since. |
| Annotations — outline, pin, failure chip  | `hsl(0 84.2% 60.2%)` on `hsl(210 40% 98%)`                                                                                              | The only red anywhere near this tool. An annotation has to be findable on any design, which is the opposite requirement to the canvas's own chrome. |
| The outline burned into the handoff PNG   | `#e11d48`                                                                                                                               | Drawn in a `<canvas>` rather than in CSS, so it is written where it is used, in `canvas-frame.tsx`.                                                 |
| Frame edge                                | `0 0 0 3px hsl(0 0% 100% / 0.14)` plus a wide soft shadow                                                                               | A hairline drawn as a **shadow, never a border** — see the trap list.                                                                               |
| Type steps                                | `0.625rem`, `0.75rem`, `0.8125rem` for screen-sized chrome; 23 / 26 / 28 / 42 / 132 **world** pixels for everything drawn on the canvas | Screen-sized text is a control; world-sized text is part of the drawing and scales with the frames.                                                 |
| Motion                                    | `220ms`, `cubic-bezier(0.22, 1, 0.36, 1)`                                                                                               | One duration and one curve for every state change in the chrome.                                                                                    |
| Font                                      | `Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`                                            | Named on the canvas root rather than inherited, so a host app's body font cannot change the type scale under it.                                    |
| Layers                                    | `50` for the note box, `60` for the toolbar                                                                                             | Written as `z-[50]` / `z-[60]` rather than as named layers the host project may not have.                                                           |

Every value is a literal, so the folder works in any project: a project has none of a design system's
token names by default, and a canvas built against missing tokens renders as an unstyled wireframe.

**The classes need Tailwind or the prebuilt stylesheet.** The values are literals, but they are still
Tailwind arbitrary-value classes. In a Tailwind project, Tailwind only generates the classes it finds by
scanning its `content` globs, so a `design-canvas/` folder outside those globs loses every class the host app
does not already use (its own entry in `references/traps.md`; `check-install.mjs` fails on it). A project
without Tailwind uses the prebuilt `tool/canvas.css` instead.
