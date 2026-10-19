# The capture pipeline, and the comment layer

Both already work. This file says what each is supposed to do, so that when one misbehaves you can tell, and so that
nobody simplifies a step whose reason is not obvious.

---

## The capture pipeline

The whole difficulty is when to press the shutter. A page photographed a moment too early is half loaded; a page caught
mid-animation is a design that never existed; and either one on a canvas is a lie the reviewer cannot detect.

### Where the list of screens comes from

From the declaration file, `project/flows.ts`, read in process by `screensFor` in `dump-screens.mjs` (bundled with
esbuild, variants expanded). No server is needed to know which screens exist, and a stale snapshot cannot exist.

### Which server: the dev server for a round, a build to prove a canvas

- **`round.mjs` captures against the dev server already running at `appUrl`.** That is what makes a round take seconds,
  and it is the normal loop. When nothing answers at the address, the round, `capture.mjs` and `check-canvas.mjs` each
  stop in one line before any browser or lane starts.
- **`capture-run.mjs` captures against a production build**, and it is how a whole canvas is proved for a review.
  `next dev` compiles each route on its first request inside the capture's own load budget, so under several pages at once
  a different set of frames comes back blank each run. A build serves the same frames repeatably.

`capture-run.mjs` builds into its own folder (`--build-dir`, `.next-canvas` by default, passed as `CANVAS_BUILD_DIR`),
sets `NEXT_PUBLIC_CANVAS_PINS=1`, serves the build on its own port (3055, or the next free one; `--port` says another),
captures, stops the server and prints what each phase cost. `--build-cmd` and `--serve-cmd` (with `{port}`) replace the
Next commands. It never reuses a server it did not start unless `--reuse` says so, because a leftover `next start` keeps
serving the bundle it was started with and the capture would photograph the previous build. Every other argument goes to
`capture.mjs`, and the exit code is the capture's.

`distDir: process.env.CANVAS_BUILD_DIR || ".next"` in the project's next config is what keeps the two builds apart.
Without it the variable is ignored, the build overwrites `.next`, and it takes down the dev server the reviewer is using.

By hand, for a project that needs the steps separately:

```bash
CANVAS_BUILD_DIR=.next-canvas NEXT_PUBLIC_CANVAS_PINS=1 npx next build
CANVAS_BUILD_DIR=.next-canvas npx next start --port 3055
node design-canvas/capture.mjs --canvas <slug> --url http://localhost:3055 --no-warm
```

Two things that bite:

- **A `NEXT_PUBLIC_*` flag is inlined at build time.** A build without `NEXT_PUBLIC_CANVAS_PINS=1` compiles the pin gate to
  off, and every pinned state becomes the route's default while the frames still claim the special case.
- **Never build into `.next` while a dev server is up.** They corrupt each other, and it surfaces as
  `TypeError: Cannot read properties of undefined (reading 'call')`, which reads like an app bug.

And capture on a quiet tree: a dev server recompiling under another agent's edits returns blank pages (trap 9).

### Before the pipeline: the declaration is checked, the comments are placed

Before any browser exists, every screen's steps and network rules are validated (an unknown step type throws with the
screen and the position, exit 2), and comment integrity runs (`comment-integrity.mjs`): a frame that left the declaration
takes its live comments to the successor the declaration names, or the run is refused with the frame and the ids named and
nothing touched. See `references/declaration.md`, "A frame that leaves".

### What must be true before the shutter, in order

0. **Done.** The screen's `steps` are pressed (`steps.mjs`, shared with the oracle's Open pass) and the page is given the
   settling it got on load. Everything below is about the page after them.
1. **Not lazy.** Every `loading="lazy"` image is switched to `eager` and every `decoding="async"` to `sync`, in every
   document, as each image is added (an init script watches every document).
2. **Loaded.** `readyState === "complete"`, non-empty body text, fonts loaded, and every image that will be in the shot
   complete, recursively in every same-origin frame with a real `src`. 45 second timeout, recorded as `neverLoaded`.
3. **Data in.** No fetch or XHR in flight for 400 ms, at most 10 seconds (a note, never a failure, when it cannot be
   quiet). A request held open for the life of the page (a subscription, a stream) stops counting after 6 seconds and is
   learned for the run. Held requests are not counted. `--no-network-wait` switches this off.
4. **Settled.** No document changed for 400 ms, for at most 1200 ms; again after the steps and after a resize. Loading
   placeholders (`[aria-busy]`, `[data-loading]`, `[data-skeleton]`, `.animate-pulse`) are waited out, except on a frame
   whose `network` holds the request they wait for.
5. **Finished.** Endless animations are paused first, so the wait for the rest can end; then every frame waits for nothing
   running, 9 second timeout. Motion is allowed to finish rather than disabled, so the picture is the design the animation
   was taking the page to. `prefers-reduced-motion` is not set, because that would capture a different product. Endless
   animations are counted into `pausedMidFlight`, a note worth reading (trap 11). An element carrying `data-canvas-busy` is
   waited for too, up to 9 seconds.
6. **Frozen.** A stylesheet in every document pauses animations and transitions and hides the caret; videos are paused; the
   active element is blurred; scroll-driven reveals are forced into their revealed state (trap 10).
7. **True.** Every declared claim is looked for on the frame's own surface (`SURFACE_TEXT` in `steps.mjs`) in every
   document, re-read for up to 25 seconds; `expectSelector` too. A pinned frame first waits for `data-canvas-pinned`, and a
   timeout there is a claim of its own naming the pin (trap 19). A state the states file does not have (the mark reads
   `unknown`, or the page logs "Unknown pinned state") fails the frame at once and keeps its previous picture; a new frame
   gets no picture, because the default under a state's name is a wrong picture. The preflight names such a `state` first. A screen's network rules must have been asked for.
8. **Stable.** Two consecutive captures byte for byte identical, up to 5 tries 600 ms apart, every animation finished before
   each, so a surface that mounts between two shots is drawn finished. A page still loading or moving cannot produce the
   same bytes twice. `animated: true` accepts one shot.

### How big the picture is

Decided by the page. The height is the taller of what the window scrolls and what the page's main inner scroller hides;
above 1.1 viewports the whole page is captured, capped at 8000px, otherwise one screen. `oneViewport: true` declines the
inner-scroller growth. A long shot whose deepest visible element sits within one viewport goes back to one screen. The
canvas draws each frame at the size it was captured at, and zoomed out it draws the quarter-scale copy in `small/` while
that copy has at least as many pixels as the frame takes on screen.

### A run

- **Lanes.** Six frames at a time in one browser, eight under `capture-run.mjs`. `--lanes <n>` (1 to 16, or
  `CANVAS_LANES`; `round.mjs` and `capture-run.mjs` pass it on) runs fewer for a dev server that cannot carry six pages.
  Every frame proves itself on its own, so the number changes how long a run takes and nothing it says.
- **A second pass, alone.** A frame that fails in the lanes is shot again by itself after the lanes drain, and the run
  names the frames that needed it. A frame refused only for an edge origin keeps its previous picture at once.
- **Final failures are not retried**: a step that cannot be done (listed apart as `frame(s) whose steps could not be done`)
  and an image that finished failing (`images.broken`, a dead file).
- **A failed shot never replaces a picture that worked.** If it fails the second pass too, the previous picture and its
  manifest entry are kept and the run says so. A screen with no previous picture is written anyway, with the failure
  recorded, so the canvas shows it as not what it claims.
- **A picture of a page that did not arrive is kept out**: a new picture under 40 percent of the old one's bytes, from a
  page with under 30 characters of text (a white page, a route's loading skeleton), is held for the second pass and then
  refused; the old picture stays and the run fails naming both sizes (`shot-guard.mjs`; `sparse: true` for a page that is
  this empty).
- **Time.** The run ends with `time:` for its own steps and `time in frames, summed:` for each wait, so a slow run names
  the wait that made it slow.
- **`--only <id>,<id>`** recaptures named screens and merges the manifest rather than replacing it.

### Login, sessions and browsers

- **A saved session.** The capture browser is a fresh profile, so an app behind a login photographs its sign-in page. The
  user logs in once, by hand: `npx playwright open --save-storage=design-canvas/auth-state.json <app url>`. Every tool then reads it from `storageState` in
  `design-canvas/settings.json` (or `--storage-state`, or `CANVAS_STORAGE_STATE`). The file holds live tokens: it is
  gitignored, and the agent never reads or prints it. A session the app keeps in localStorage is saved per origin; the
  capture gives its own port the entries saved for the same host on another port.
- **The login probe.** The first real page is opened before anything else. A landing on a sign-in route (a path named
  login, sign-in, sso or the like; `--login-route` or `loginRoute` names another) ends the run with exit 2 and one line
  naming the `npx playwright open --save-storage=…` command. When a blocked write came before the redirect (an app that checks its session
  with a POST), the line names that request and `allowWrites` instead. `--no-login-check` is for a canvas whose first frame
  is deliberately behind a redirect.
- **A browser or context failure never prints the session.** Launch and context errors are printed as their first line,
  with every cookie and localStorage value from the file scrubbed out. Exit 2.
- **Video needs real Chrome.** Bundled Chromium has no H.264 codec, so MP4 players photograph as error boxes.
  `browserChannel: "chrome"` (or `--browser-channel chrome`, or `CANVAS_BROWSER_CHANNEL`) launches the installed Chrome.
- **A browser a tool opens is always closed**, however the tool ends, a SIGKILL included (`browser-lifecycle.mjs`, trap 37).
  A new tool launches through `launchBrowser` in `browser-guards.mjs`.

The oracle reads the same settings and variables as the capture, so one project setting serves both.

### Recapturing after a change

Changed-only is the default; `--all` captures everything. Recapturing everything marks every comment on the canvas stale,
which moves answered work back into the reviewer's queue.

The mechanism is a **stamp** on every shot: a content hash of every project file the screen's `source` entries reach
through their imports (`closure.mjs`: relative specifiers and tsconfig `paths` aliases), the file that implements its
pinned state, the global inputs no import reaches (the Tailwind config, the global stylesheet, the pin adapter), and a hash
of the screen's own declaration (url, state, claims, viewport, device, steps, network rules; not its label, note or kind).
A screen is recaptured when any of that differs, when it has never been captured, or when its shot has no stamp. Hashes,
not timestamps or git: an mtime changes on a checkout, and git cannot see an uncommitted edit. A run that captures nothing
says so in under a second.

Two things keep it honest. `check-canvas.mjs` re-hashes the same stamp and counts the shots older than their files in one
note. And every capture, a changed-only one included, prunes the shots of screens no longer declared and says which.

### When the pictures are recaptured

Recapturing every out-of-date frame after every turn photographs canvases nobody is looking at. So a recapture runs at
moments, and takes the frames in focus. With the local hooks answered yes (`install-canvas.mjs --checks yes`):

- **The end of a turn that changed what the pictures are made of.** The Stop hook runs `recapture.mjs --hook`, which
  compares a fingerprint of every stamped file and declaration with the one the last such turn left. The same means
  nothing starts. Otherwise a background run waits until no turn has ended for 8 seconds and captures the canvases a
  reviewer has open now.
- **A round.** `round.mjs` captures the frames it names, then starts the same background run for the open canvases.
- **Opening a canvas.** The comments route starts `recapture.mjs --opened <slug>`, which refreshes that canvas there and
  then. While a pin is open or comment mode is on, the canvas keeps the pictures it is showing and takes the new ones
  afterwards; refreshed frames land in the Changed Screens queue.
- **Sharing.** `review-build.mjs` refreshes the canvas before it reads a picture, and stops when a frame on the page
  cannot be refreshed.
- **By hand.** `node design-canvas/recapture.mjs [--canvas <slug>]` captures every out-of-date frame now; `--plan` lists
  them and why, and marks the open canvases.

**Which canvases are open.** While its tab is visible, the canvas page reports the canvas, tab, device and the frames on
screen (on opening, when that changes, and once a minute); a hidden tab reports that it is gone, and a report counts for
2 minutes (`design-canvas/rounds/viewing.json`). Two open tabs both count. An automated browser never reports, and neither
does a page an agent opens in a real browser with `?agent=1` added to the canvas address, for the rest of that visit; such a
page never counts as the reviewer's first visit either. The frames
on screen are captured first (`capture.mjs --first`), then the rest of that canvas; more than 10 frames run 2 at a time.

**Everything else stays out of date quietly.** The end of a turn shows one line with the count per canvas that is not
open; nobody is asked about recapturing. The oracle counts out-of-date frames in one note per canvas, never a failure.
Every `capture.mjs` holds a lock per canvas, so a round and a refresh of one canvas never write beside each other.

No server answering, no `appUrl`, or a declaration that cannot be read: one line in `design-canvas/rounds/recapture-log.txt`,
and the frames stay out of date for the next moment.

### The manifest is the receipt

Chromium's `Page.captureScreenshot` over CDP, WebP at quality 92, with a quarter-scale copy in `small/`.

| Recorded                                   | Fails the run when                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------------------ |
| `claims: [{ claim, met }]`                 | any `met` is false: "captured a page that does not have …"                           |
| `stable`, `tries`                          | two captures never came out identical (not for `animated`)                           |
| `bytes`                                    | under 6000: "the picture is N bytes, which is a blank page"                          |
| `images: { shown, empty, broken }`         | an image still arriving; `broken` (finished failing) is listed apart                 |
| `origins`                                  | an edge origin resolves to nothing, to several places, or outside the picture       |
| `today`                                    | never; it remembers each exploration frame's `redesigns` link                        |
| `controls`                                 | never; the visible controls and short labels, an option is compared with today by them |
| `pausedMidFlight`                          | never; a note                                                                        |
| `hash`, `stamp`                            | never; staleness and changed-only selection are computed from them                   |
| `bases` (manifest level)                   | never; per exploration, the commit and files of its first capture, for `parity.mjs` |
| `w`, `h`, `wholePage`, `url`, `capturedAt` | never; they are the receipt                                                          |

**The visual change report.** After the last frame, every re-photographed frame is compared with the picture it replaced
(`visual-delta.mjs`): the percent of pixels that differ, the percent outside the regions of the comments on that frame,
and the box that holds every change. A frame is flagged when it changed outside what was commented on, or at all where
nothing was, above `flagPct` in settings (0.5 by default). A flag is evidence, never a failure. It writes `delta.json` and
the replaced pictures to `--delta-out <dir>` (default `design-canvas/rounds/<slug>/latest/`), which the contact sheet is
built from; `--no-delta` skips it. A round that did not pass is continued by the next `round.mjs` run in the same folder, so
a retry still compares with the pictures the round started from, never with its own first attempt (`--keep-originals`); a
round that passes removes the `open` mark from its folder and the next run starts a new one.

**What an option no longer shows.** For every exploration frame that declares `redesigns`, the capture compares the
controls and short labels its picture recorded with those of today's screen and lists, per option, what today's screen
shows that the option does not. A today's screen whose picture predates the list is captured once along with the option.
`round.mjs` prints the list at its end and `capture.mjs` in its `next:` lines; it goes into the hand-over, per option, so a
restructuring option cannot drop a control unseen.

**Real-code mode.** The first capture of an exploration records its base in the manifest (`bases`): the commit checked
out then, the code files its `original` reached, and its mode. A real-code exploration that leaves the declaration keeps
its base until its parity check passes, so retiring it in the same edit as the fold-in still checks the fold-in. The
preflight runs the check for every real-code exploration (the round runs `parity.mjs` itself under `--no-preflight`): each
unit of those files at the base, from the TypeScript AST, must still be in the same file. A unit is a statement or a
condition header with the markup cut out, a condition in the markup, a handler, a prop bound to an expression, a form
field's name, a door (a link's target, a navigation, a dialog or form rendered), a translation key or its default copy.
Units count as a multiset, so one of two identical gated controls going is a loss; keys and copy only have to be present.
When a pull, merge or rebase run by the agent brings the developers' commits to those files, the hook moves the base to
the pulled commit after the command and says so in one line; the designer's own commits never move it. For commits that
arrived another way, `parity.mjs --canvas <slug> --exploration <id> --base <commit>` moves it by hand.

### The oracle's live Open pass

Every frame's Open button is re-proved on the served app, and each visit asks the dev server to compile a route, so by
default the pass visits only the frames the capture re-photographed since their last clean live visit (the capture writes
them to `design-canvas/rounds/<slug>/live-unproven.json`; a clean visit takes a frame off). `--only a,b` visits those;
`--live-all` visits every frame, for proving a whole canvas. It says how many it left alone. Never restart the reviewer's
dev server to clear its memory: a restart breaks the hot reload of the tab they are looking at.

### A native app: the iOS Simulator

For a React Native or Expo project the web target photographs the wrong thing: bottom sheets, safe areas and the keyboard
are absent or different. `capture-sim.mjs --canvas <slug> --scheme <app-url-scheme>` photographs the app running in the iOS
Simulator, on macOS only (`xcrun simctl`); Android is not supported, and it is untested on a real project. Boot the
simulator and start the app yourself. Each screen's `route` is appended to the app's URL scheme. It verifies no claims: each
frame says so (`backend: "simulator"`, `claimsVerified: false`), so check them by eye.

---

## The comment layer

Drag a rectangle on a frame, type, save. Two artifacts, and the second one is the point:

- `design-canvas/comments/<slug>.json`: the screen, its route, the pinned state, the region in percentages of the frame
  (so it means the same at any zoom and after a recapture), the note, the hash of the shot it was drawn on.
- `design-canvas/comments/<slug>/<id>.png`: the captured screen with that rectangle drawn on it, numbered like the pin.

And `design-canvas/comments/.history`, a git repository of its own holding the record files only. Every write to a review
lands as a commit named for what happened, so `git log -p` is the durable history of a review and the only place a deleted
comment's words survive:

```bash
git -C design-canvas/comments/.history log --oneline -- <slug>.json
git -C design-canvas/comments/.history show <commit>:<slug>.json
```

The comments folder is gitignored, and the Hand Off panel says so.

**Why a region and not a selector.** A frame is a picture, so there is nothing to hit-test. What the agent gets is better
for a design note: the screenshot with the outline drawn on it. The PNG is drawn in the browser in a `<canvas>`, which is
why the tool must be served from the app's own origin: a cross-origin image would taint it.

**The routes answer only this machine.** The comments and shots routes answer a request whose `Host` is a loopback name or
address (`localhost`, `*.localhost`, `127.x.x.x`, `[::1]`) or the host of `appUrl` in `design-canvas/settings.json`, so a
hostile domain that resolves to this machine (DNS rebinding) reads and writes nothing. A write also needs a browser's
`Origin` to be that host and `Sec-Fetch-Site`, when sent, to say same-origin; its body is JSON and bounded, its note is
text, and its frame is one the canvas has a picture of. Tools send neither header and talk to the app's own address. A
published build answers reads anywhere and refuses every write. To review from another device on the network, set
`appUrl` to the address that device uses.

**An id names one comment for ever.** The file carries `maxId`, the highest number it ever issued; the next id is the
larger of that and the highest live id, plus one (trap 29).

**What else a comment reaches is derived, never stored.** `affected.mjs` compares the commented frame's import walk with
every other frame's, on every canvas, and groups the frames by the files they share: the same page first, then shared
components (five lines; the line under them gives the exact `affected.mjs ... --all` command that lifts the cap), and a file
that draws most of a canvas said once as shell level. A named import is followed through a barrel (`index.ts`) to the file
that defines the name, as the reuse check does (trap 38), so one hook from a barrel does not tie a frame to everything it
re-exports. The capture's stamp keeps the plain walk, because importing from a barrel runs every module it re-exports. It
works per frame, not per box. `drain.mjs --list` prints these lines under each open note.

**Consumed is a separate axis from resolved.** An agent marks a comment consumed with `drain.mjs` (the route's `PATCH`
with `{ id, consumed: true }`); `--answer-file <path>` (or `-` for stdin) also writes an answer onto it, drawn under the
note in the open pin. The answer goes through a file, never inside the command line, where its quotes or `$(` would be run by
the shell. A worked note is the reviewer's to close from then on: its pin offers Approve and Dismiss, and the comments queue
counts it, whether or not its recapture changed the picture. A
PATCH of an id that is not on the canvas is refused with 404, naming the canvas it looked in (trap 20). The layer has no
statuses, severities, accounts or mentions, and adding them is how it becomes heavy.

**Staleness is visible, never silent.** A capture flags every comment whose screen it photographed and whose hash no longer
matches as `stale`; a frame the run kept is never a reason. A reopened note records the hash of the picture it was reopened
on. Verdicts go stale too but are never drain work: the drain gate and its advice leave them out, because draining one
deletes it. Staleness is never a reason to drop a comment.

**A review is three places and no more.** Every record is unread in the hand-off, a consumed note in the review row, or
deleted: a consumed verdict by the route, and an answered comment whose screen has left the declaration by the next
capture, with its PNG. An unread note survives its screen and keeps traveling. Keep that list exhaustive, or a record
becomes invisible work (trap 25).

**Two queues, for two people.** A comment the agent has not ingested is outbound: Hand Off counts it, and Hand Off is
hidden when nothing is outbound. A comment the agent has ingested is inbound: the fix is on screen and only the reviewer
can say whether it worked.

**What a pin offers depends on its queue:**

- **Waiting** (not ingested): Delete and Edit. A note is edited only before it is handed off.
- **To review** (ingested): Dismiss, Approve and Approve & next, and no Edit. Approve deletes it, because a closed comment
  is one that is gone. Approve & next also opens the next comment waiting for review. Dismiss asks for another round on the
  same rectangle: the new words become the note, the answered words move into `history`, and the PNG is redrawn from the
  picture the reviewer is objecting to. It stays one comment on one rectangle.

The popover closes with an X in the corner or a click outside it.

**Two marker styles.** A pin is a red circle with a white number. A note the reviewer reopened with Dismiss after an agent
worked it, and that no agent has worked since, is a light red circle with a dark red number (`reopenedAfterWork` in
`comments-client.ts`: the last `history[].at` is later than `consumedAt`).

**The review row belongs to the tab in view.** At the bottom of the canvas, it walks one queue at a time: new screens,
changed screens (white edge), both read from the `waiting` map the capture writes, and comments to review whose frame is on
this tab. The capture queues nothing until the reviewer first opens the canvas: that visit records `viewedAt` in the review
file and empties `waiting`, so a canvas is delivered with no marks and only later arrivals and changes are marked. The
oracle's browser writes to its own probe key and a published canvas writes nothing, so neither counts as a visit. A small switch beside it leads to each other queue that has something on this tab; new frames on another tab show as a dot on that tab, and its queues start there. Pressed, a switch flies to the first item and
centers the outline, not the frame, so a note on a tall frame does not open below the fold. Approve All acts at once and
offers an undo for six seconds: the items are hidden, not deleted, until the window closes.

**Red is reserved for annotations.** The comment toggle is not red and is labeled "Comment". The comment box is the only
element that ignores zoom: it counter-scales by 1/zoom, and flips to the region's other side when the region sits past the
middle of a frame. It hangs below its region, or above it when below would put its buttons under the review row or the
window's edge (`hangsBelow`, the tooltip's rule).
