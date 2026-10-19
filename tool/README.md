# design-canvas

An infinite canvas of every screen and state of this app, with the user flows drawn as diagrams and a comment layer that
hands an agent the picture of what you pointed at. It is not a page of the app: it has no app shell, and its look is fixed
and the same in every project. The agent that installed it knows the full procedure (the design-canvas skill); this file
is the short version for anyone working in this repo.

## Using it

- Open `<appUrl>/design-canvas` (the address is in `design-canvas/settings.json`) for the list of this project's canvases;
  each canvas is at `/design-canvas/<slug>`.
- Drag to pan, pinch or Cmd and scroll to zoom, `0` to fit everything, Cmd or Ctrl and K to search every frame.
- The tabs: **Grouped Screens** puts similar states side by side; **User Flows** draws each journey with what the person did
  on every arrow; **Exploration** appears only while a design question is open, and opens first while it exists; **Design
  System** appears once components are photographed. A device switch appears when the canvas has desktop and phone screens.
- **Open**, under every frame, opens the real page in the state the picture shows.
- **Comment** (or `c`): drag a box around what you mean and type. Hand Off gives the line to paste into an agent. When the
  agent has worked a comment and retaken the picture, the review row at the bottom walks you through it: Approve, Approve &
  next, or Dismiss with more feedback. New and changed screens are walked the same way.

## Commands

Every tool reads `design-canvas/settings.json` (`appUrl`, `storageState`, `browserChannel`, `loginRoute`, `locales`,
`allowWrites`, `buildFrom`), so none needs a port typed; there is no default port. `--url` overrides the address for one
run, and every tool takes `--canvas <slug>` (default `main`). Each tool's last line is its verdict.

```bash
node design-canvas/round.mjs --canvas <slug> --only <ids> --drain <comment ids>   # a review round, against the dev server
node design-canvas/capture-run.mjs --canvas <slug>          # capture against a production build, to prove a canvas
node design-canvas/check-canvas.mjs --canvas <slug>         # the oracle: PASS, or FAIL (<count>): ...
node design-canvas/preflight.mjs --canvas <slug>            # the seconds-long checks of the declaration
node design-canvas/parity.mjs --canvas <slug>               # real-code explorations: what today's screen did and lost
node design-canvas/capture.mjs --canvas <slug> --only <ids> # capture named frames (changed frames by default, --all for every one)
node design-canvas/drain.mjs --canvas <slug> --list         # open comments in full (kind, note, earlier rounds); --ids c4,c5 marks them worked
node design-canvas/affected.mjs --canvas <slug> --ids c4    # other frames drawn from the same files
node design-canvas/verdicts.mjs check --canvas <slug>       # options with no like or dislike recorded
node design-canvas/split-canvas.mjs --from <old> --to <new> # move comments when a canvas is split
node design-canvas/recapture.mjs --plan                     # frames out of date, and why (open canvases marked)
node design-canvas/recapture.mjs --canvas <slug>            # capture a canvas's out-of-date frames now
node design-canvas/components.mjs find "<what you need>"    # existing parts that fit; show <file>, state
node design-canvas/system-capture.mjs --only <set id>       # photograph a component set for the Design System tab
node design-canvas/registry.mjs                             # the components the build-from canvases use
node design-canvas/review-build.mjs --canvas <slug> --live <review.json>     # build the team page
node design-canvas/review-comments.mjs list --canvas <slug> --file <review.json>   # read the team's comments
node design-canvas/capture-sim.mjs --canvas <slug> --scheme <url scheme>     # an iOS Simulator app (macOS only)
```

A round captures against the dev server already running, which takes seconds. A whole canvas is proved against a
production build: `capture-run.mjs` builds into `.next-canvas` (`distDir: process.env.CANVAS_BUILD_DIR || ".next"` in the
next config keeps it apart from `.next`), serves it on its own port, captures and stops. Never build into `.next` while a
dev server is up.

An app behind a login needs a saved session. When the capture meets a sign-in page it stops within seconds and prints the
one command that saves it; then set `storageState` in `settings.json`. That file holds live tokens and is never committed.

## Where things live

The canvas stays on this machine: `design-canvas/`, its routes and `.next-canvas/` are in the repository's exclude list, so
git never sees them. A project that shares its canvas through git (one installed before this, or opted in with
`install-canvas.mjs --share`) commits what a teammate needs and ignores the rest, as marked.

```
design-canvas/
  core/                 the canvas, copied byte for byte; check-install fails if it is edited
  project/flows.ts      the declaration: every screen, its route, state, claims and flows; CANVASES names every canvas
  project/states.ts, canvas-state-pin.tsx   how a screen is forced into a state (optional)
  project/system.tsx    the Design System tab's component sets
  project/parity-exceptions.json   real-code mode: logic that moved to another file, and where it is now, or that the reviewer
                                   asked to remove, with their words (optional)
  *.mjs, canvas-page.tsx, canvas.css, README.md   the tools, overwritten on every install (this file's top half too)
  settings.json         this project's address, session, browser, locales and checks. Never overwritten. Shared: committed
  dismiss.json          first-run and promo overlays the capture dismisses. Never overwritten. Shared: committed
  shots/<slug>/         the pictures, their small/ copies and manifest.json. Shared: committed, so a clone opens on real frames
  shots/_system/        the Design System tab's pictures. Shared: committed
  evidence/<slug>/      other systems' screenshots shown beside frames. Shared: committed
  review/page.html      the team page template; review/<slug>.json its settings (url, owner, headings). Shared: committed
  comments/             <slug>.json, <slug>/<id>.png and .history (a git repo of every review write). Never committed
  rounds/<slug>/        replaced pictures, change reports, contact sheets, logs. Never committed
  review/<slug>/        a built team page and its snapshots. Never committed
  auth-state.json       the saved login session. Never committed
```

## Lines in the app's own files

Every line the canvas needs in a tracked file (the pin in the root layout, `distDir` in the next config, the tsconfig
include, a pinned value read in app code) ends in a `design-canvas:local` comment, or sits between `design-canvas:local
begin` and `end` comment lines. They are added lines only. The overlay (`overlay.mjs`, installed into the repository's git
folder) keeps them out of every commit and puts them back after a pull, merge, rebase or switch; a line that no longer fits
an updated file is reported in one line and kept aside. A push that adds canvas code is refused, naming the file; a canvas
line the remote already holds is named in one line and does not block.

`// design-canvas:handoff <what>, because <why>` marks something the developers will need. At the next push those lines are
listed in one block and removed from the code.

## Publishing it read only

The canvas is dev-only: the pages and both routes 404 under `NODE_ENV=production`. To publish it for people who do not run
the app:

```bash
NEXT_PUBLIC_CANVAS_VIEW_ONLY=1 NEXT_PUBLIC_CANVAS_PINS=1 npm run build
```

- `NEXT_PUBLIC_CANVAS_VIEW_ONLY=1` serves the canvas and its pictures and removes the comment layer: no Comment, no Hand
  Off, no Clear All. The comments route refuses writes with 405.
- `NEXT_PUBLIC_CANVAS_PINS=1` is required on a build, or every Open button lands on the page's resting state. It also lets
  anyone with the URL force the app's review-only states. In development pins are always on, through `canvasPinsAllowed()`.
- The pictures live outside `public/`, so trace them into the function bundle. For Next:
  `experimental.outputFileTracingIncludes` with `"/api/design-canvas/shots": ["./design-canvas/shots/**"]`. After a
  build, `.next/server/app/api/design-canvas/shots/route.js.nft.json` should list them.
- Nothing protects it: whatever gates the deployment gates the canvas.

## Deleting it

Run `node design-canvas/overlay.mjs uninstall`, then delete:

- every local line: `git grep -n design-canvas:local` lists them (the root layout's pin, `distDir` in the next config, the
  tsconfig include, the agents block in `CLAUDE.md` or `AGENTS.md`, any review-only flag)
- the `design-canvas/` folder, `.next-canvas/` and the five route stubs: `app/design-canvas/page.tsx`,
  `app/design-canvas/[canvas]/page.tsx`, `app/design-canvas/system/[set]/page.tsx`, `app/api/design-canvas/comments/route.ts`,
  `app/api/design-canvas/shots/route.ts` (under `src/app` when the app keeps its routes there)
- the installer's lines in the repository's exclude list, and the three `design-canvas/hook.mjs` entries in
  `.claude/settings.local.json`
- for a shared canvas, the canvas lines in `.gitignore` and `.gitattributes`, and anything marked `DELETE WITH: the
  design-canvas/ folder`

This project's own list is below.

<!-- design-canvas:project. Everything from this line down belongs to this project and survives a re-install -->

## This project

Nothing written here yet, which means the facts of this install are recorded nowhere: the ports it runs on, the commands
that carry them, the seams the install added to this repo, and whatever is known to be missing.

Fill in, and keep it to what a fresh reader cannot get from the code:

- **Ports and commands.** The port captures run against (the dev server's address is in `settings.json`), and any
  `package.json` script that wraps a canvas command.
- **Seams.** Every edit outside `design-canvas/` this install needed (linter and formatter exemptions, the Tailwind glob,
  the layout branch, the state pin), with the reason, and the file-by-file list to undo when the folder goes.
- **Gaps.** What is known not to work here yet, so the next reader stops rediscovering it.
