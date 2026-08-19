# What the target project has to be, and what changes in it

## What the core assumes

- **Next.js App Router.** `core/comments-route.ts` and `core/shots-route.ts` are Next route handlers
  (`next/server`), and `canvas-page.tsx` uses `next/navigation`. A Vite, Remix or Astro project needs those
  two endpoints rewritten against its own server — read/write a JSON file and a PNG, serve a WebP by id —
  which is real work, roughly 200 lines, and **must be said out loud rather than discovered halfway
  through**. Everything else in `core/` is plain React and DOM.
- **React 18+ and Tailwind.** The canvas's colours are literals (see `core/design-tokens.md`), but they are
  still Tailwind arbitrary-value classes, so Tailwind has to be present and has to scan `design-canvas/`.
- **Playwright**, for `capture.mjs` and `check-canvas.mjs`. Both are plain Node scripts with no other
  dependency.
- **The canvas is served from the app's own origin.** Not a preference: the annotated PNG is drawn from the
  shot in a `<canvas>`, and a cross-origin image would taint it.

## What the core is guaranteed not to touch

`check-install.mjs` proves both of these on every run:

- Nothing under `design-canvas/core/` imports anything except `react`, `next/*`, `lucide-react`, node builtins
  and its own relative siblings. No store, no data layer, no app component, no path alias, no utility.
- Every core file is byte for byte what the skill shipped. **The canvas has one appearance everywhere it is
  installed.** If a change to the core is genuinely an improvement, make it in the skill so every project
  gets it — never in one target.

## The seams outside the folder

Each carries `DELETE WITH: the design-canvas/ folder`. The install script writes the first three; the rest
differ per project and are yours to add.

1. `app/design-canvas/page.tsx` — the route stub.
2. `app/api/design-canvas/comments/route.ts` — the comment endpoint stub.
3. `app/api/design-canvas/shots/route.ts` — the pictures endpoint stub. This is where the declaration is wired
   in, so that nothing in `core/` knows which project it is looking at.
4. **The Tailwind content glob.** v3: `"./design-canvas/**/*.{ts,tsx}"`. v4: `@source "../design-canvas";` in the
   CSS entry. First, before styling anything — see trap 1.
5. **The chromeless-layout branch.** However this project decides a route renders without app chrome, put
   `/design-canvas` in it. Most apps already have such a passthrough for standalone surfaces (auth, camera,
   onboarding); use it rather than fighting the layout.
6. **One line in the root layout**, dev-only, rendering `<CanvasStatePin />` — only when some screen pins a
   state.
7. **Three `.gitignore` lines** for `comments/`, `comments.json` and `comments.json.*`. Not `shots/`: the
   captured screens are committed on purpose, so a fresh clone opens the canvas on real frames.
8. **The review-only URL flags** step 4 of the workflow adds to make states reachable. Concentrate them so
   they delete in one move, and comment each with what removes it. They are affordances rather than
   features: nothing in the app links them, and each only forces a state the surface already holds.
9. **Whatever the repo's own tooling needs to leave `design-canvas/` alone** — a linter override, a formatter
   ignore — because the folder is vendored and reformatting it breaks the byte-for-byte check that is the
   whole point of vendoring it. Then write every one of these into the README's project half, below the
   marker, as the list to undo when the folder goes. A seam nobody recorded is a seam nobody removes.

## Flags the scripts take, so nothing is hard-coded to one project

- `capture.mjs` and `check-canvas.mjs` default to `http://localhost:3000` and take `--url`.
- `check-canvas.mjs` takes `--shell-selector` for the no-app-shell assertion, which otherwise looks for
  `header, nav, aside, [data-app-shell]` **outside** the canvas surface — a project whose chrome is none of
  those names its own.
- `check-canvas.mjs` runs its comment round trip on the first declared screen, or on `--comment-on <id>`.
- `capture-run.mjs` takes `--build-cmd` and `--serve-cmd`, so a project that is not Next can still be built
  and served for a capture.

## The one thing a project may override

`--canvas-font`. Set it in the project's own CSS and the canvas uses that family instead of its own stack:

```css
/* DELETE WITH: the design-canvas/ folder. */
[data-canvas-surface] {
  --canvas-font: var(--font-inter), Inter, sans-serif;
}
```

It is the only override the core reads, and it exists because a project's Inter and the `Inter` a browser
finds are not always the same metrics — 124.84px against the shipped stack versus 132.73px against a
`next/font` Inter instance, for the same string at the same size, which is a visible shift in every caption.
Nothing else about the canvas is configurable, and adding a second hook is how this becomes a theme system.

## Deleting the whole thing

Delete `design-canvas/`, then every seam above. Nothing else in the app knows the tool exists — that is the
whole reason it lives in one root folder rather than being spread through `app/` and `components/`.
