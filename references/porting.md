# What the target project has to be, and what changes in it

## What the core assumes

- **Next.js App Router.** `core/comments-route.ts` and `core/shots-route.ts` are Next route handlers (`next/server`), and
  `canvas-page.tsx` uses `next/navigation`. A Vite, Remix or Astro project needs those two endpoints rewritten against its
  own server (read and write a JSON file and a PNG, serve a WebP by id), which is real work, roughly 200 lines. Say so up
  front rather than discovering it halfway. Everything else in `core/` is plain React and DOM.
- **React 18 or later.** The canvas's colors are literals (see `core/design-tokens.md`), written as Tailwind arbitrary-value
  classes and shipped prebuilt as `design-canvas/canvas.css`, which the canvas pages import in every project.
- **Playwright**, for the capture and the oracle. `playwright` must load from `design-canvas/`: a pnpm project with only
  `@playwright/test` cannot, and the installer and `check-install.mjs` print the one command that adds it.
- **The canvas is served from the app's own origin.** The annotated PNG is drawn from the shot in a `<canvas>`, and a
  cross-origin image would taint it.

## What the core is guaranteed not to touch

`check-install.mjs` proves both on every run:

- Nothing under `design-canvas/core/` imports anything except `react`, `next/*`, `lucide-react`, node builtins and its own
  relative siblings. No store, no data layer, no app component, no path alias.
- Every core file is byte for byte what the skill shipped. The canvas has one appearance everywhere it is installed. An
  improvement to the core is made in the skill, so every project gets it, never in one target.

## The seams outside the folder

The canvas stays on this machine by default: the installer puts `design-canvas/`, the route stubs and `.next-canvas/` in the
repository's exclude list (never `.gitignore`), so the developers' repository never receives canvas files or pictures. A
project whose canvas folder is already tracked keeps it shared; `install-canvas.mjs --share` opts a repository in when the
user asks for the canvas to be shared through git.

Every line the canvas adds to a tracked app file is a **local line**: an added line, never an edited one, ending in a
`design-canvas:local` comment or inside a `design-canvas:local begin` ... `end` block (a comment line each), in the file's
own comment syntax. The overlay (`tool/overlay.mjs`, installed into the repository's git folder) keeps local lines out of
every commit and puts them back after a pull, merge, rebase or switch; a line that no longer fits is reported in one line and
kept aside. A pushed commit that imports the canvas, calls a pin helper or carries a marker is refused, naming the file;
only lines the push adds count, so a marked line the remote already holds (a merge brought it) is named in one line and
passes.

Written by the installer, only when they are not there yet (in `src/app` when the project keeps its App Router there):

1. `app/design-canvas/page.tsx`: the index of this project's canvases.
2. `app/design-canvas/[canvas]/page.tsx`: one canvas per URL segment.
3. `app/design-canvas/system/[set]/page.tsx`: the Design System tab's specimen page.
4. `app/api/design-canvas/comments/route.ts`: the comment endpoint.
5. `app/api/design-canvas/shots/route.ts`: the pictures endpoint. This is where the declaration is wired in, so nothing in
   `core/` knows which project it is looking at.
6. The block for agents in `CLAUDE.md` or `AGENTS.md` (from `stubs/agents-block.md`), a local block replaced on every
   install. A project with neither file gets the lines printed.
7. Three hook entries in `.claude/settings.local.json` (PreToolUse, PostToolUse and Stop, all running
   `design-canvas/hook.mjs`), merged in beside whatever is there. The file must be ignored by git; the installer checks.
8. Local lines in the root layout (`<CanvasStatePin />` and its import), the next config
   (`distDir: process.env.CANVAS_BUILD_DIR || ".next"`) and `tsconfig.json` (`".next-canvas/types/**/*.ts"` in
   `include`). A file with no place for a line of its own (a body tag holding its children on one line, a wrapped config,
   a one-line include) is left alone and the line is printed for the agent.
9. For a shared canvas only: the `.gitignore` lines for its scratch (comments, saved session, built share pages, `rounds/`)
   and the manifest line in `.gitattributes`.

Added by the agent, as local lines, as the installer's printout lists them:

10. **The chromeless-layout branch.** However this project decides a route renders without app chrome, put the whole
    `/design-canvas` subtree in it. Most apps already have such a passthrough for standalone surfaces; use it.
11. **`flows.ts` with its `CANVASES` record**, written for real; `check-canvas.mjs` fails a placeholder.
12. **The review-only URL flags and pinned values** step 4 of the workflow adds to make states reachable. Prefer `steps`
    and `network` in the declaration where they reach a state; what is left reads `canvasStateId()` on a local line.
13. **Whatever the repo's own tooling needs to leave `design-canvas/` alone** (a linter override, a formatter ignore), only
    where that tool reads untracked files, because the folder is vendored and reformatting it breaks the byte-for-byte check.

The canvas pages import the prebuilt `design-canvas/canvas.css`, so no Tailwind config names the canvas folder.

Hand-off notes for the developers are local lines too: `// design-canvas:handoff <what>, because <why>` on the exact spot.
At each push the pre-push hook lists them in one block (file:line, what, why), removes them from the code, and keeps the list
until an agent has shown it.

Write every seam into the README's project half, below the marker.

Outside the repo, the installer keeps one thing on the machine: the answer to the local-hooks question, in
`~/.config/design-canvas/answers.json` (or `$CANVAS_ANSWERS_FILE`), shared by every worktree of the repo.

## Flags the scripts take, so nothing is hard-coded to one project

- Every tool reads the app's address, the saved session, the browser and the login route from
  `design-canvas/settings.json`, with no default port. `--url` overrides the address for one run.
- `check-canvas.mjs --shell-selector` names this project's app chrome for the no-app-shell assertion, which otherwise looks
  for `header, nav, aside, [data-app-shell]` outside the canvas surface.
- `check-canvas.mjs --comment-on <id>` picks the screen for its comment round trip (the first declared screen otherwise).
- `capture-run.mjs --build-cmd` and `--serve-cmd` build and serve a project that is not Next.

## The one thing a project may override

`--canvas-font`. Set it in the project's own CSS and the canvas uses that family instead of its own stack:

```css
/* design-canvas:local begin */
[data-canvas-surface] {
  --canvas-font: var(--font-inter), Inter, sans-serif;
}
/* design-canvas:local end */
```

It exists because a project's `next/font` Inter and the `Inter` a browser finds do not always share metrics, which shifts
every caption. Nothing else about the canvas is configurable, and a second hook is how this would become a theme system.

## Deleting the whole thing

Run `node design-canvas/overlay.mjs uninstall`, delete every local line (`git grep -n design-canvas:local`), then
`design-canvas/`, the route stubs and `.next-canvas/`, and the installer's lines in the repository's exclude list. Nothing
tracked knows the tool exists. A shared canvas from an older install also has committed seams marked `DELETE WITH: the
design-canvas/ folder`; never untrack its folder while committed app code imports it (trap 35).
