# The capture pipeline, and the comment layer

Both are in `core/` and already work. This file is here so that when one of them misbehaves you can tell
what it is supposed to do, and so that nobody "simplifies" a step whose reason is not obvious.

---

# The capture pipeline

The governing sentence, from the script's own header: **the whole difficulty is when to press the
shutter.** A page screenshotted a moment too early is a half-loaded page; a page caught mid-animation is a
design that never existed; and either one presented on a canvas is a lie the reviewer cannot detect.

## Where the list of screens comes from

From the **running app** — `GET /api/design-canvas/shots?screens=1` — never from parsing TypeScript. The
pictures therefore can never be of a different set of screens than the canvas draws. The same is true of
the oracle. If the dev server is not up, the script exits rather than guessing.

## CAPTURE AGAINST A PRODUCTION BUILD. This is not a preference

`next dev` compiles each route on its first request, **inside the capture's own load budget**. With several
pages in flight the cost lands on a different screen every run: measured on the project this came from, the
same declaration produced 31 problems, then 22, with a different set blank each time and every failure
sitting exactly at the timeout. Against a build, each screen captured in about 2.4 seconds and the run was
repeatable. Hours went into "flaky pipeline" bugs that were a dev server compiling.

The route that serves the declaration is dev-only and 404s under `NODE_ENV=production`, so the declaration
is read from the FILE instead — `dump-screens.mjs` transpiles it with esbuild and prints the same shape the
route returns. It reads the file every time rather than caching a dump, because a stale snapshot fails in
the most confusing way available: the capture reports a claim the declaration no longer makes.

```bash
NEXT_PUBLIC_CANVAS_PINS=1 npm run build          # whatever flag the project's state pinning is gated on
npx next start --port 3055
node design-canvas/dump-screens.mjs > /tmp/screens.json
node design-canvas/capture.mjs --url http://localhost:3055 --screens-file /tmp/screens.json --no-warm
```

Two things that will bite:

- **A `NEXT_PUBLIC_*` flag is inlined at build time.** An ordinary build compiles it to `false`, and every
  pinned state silently becomes the route's default while the tiles still claim the special case. Whatever
  gates state pinning has to allow a build to opt in — see `canvasPinsAllowed()` in the starter states file.
- **Never run a build while a dev server is up.** They share `.next` and corrupt each other; it surfaces as
  `TypeError: Cannot read properties of undefined (reading 'call')` from `webpack-runtime.js`, which reads
  like an application bug and is not one. The canvas VIEWER and `check-canvas.mjs` still want the dev
  server, so the order is: stop dev, build, start, capture, stop, start dev, check.

## What must be true before the shutter, in order

1. **Not lazy.** Every `loading="lazy"` image switched to `eager` and every `decoding="async"` to `sync`,
   in the document and in every nested frame — **run twice, 400ms apart**, because components that render
   late bring their own lazy images.
2. **Loaded.** `readyState === "complete"`, **the body has non-empty innerText**, `document.fonts.status
=== "loaded"`, and **every image that will be in the shot** is complete. Applied recursively to every
   same-origin frame with a real `src`; `about:blank` and unreadable frames are skipped rather than waited
   on. 45s timeout, and a timeout is recorded as `neverLoaded` and reported as a failure.
3. **A floor.** `MIN_SETTLE_MS = 1200` unconditionally, so a one-off entrance animation is never caught
   mid-flight.
4. **Finished.** Endless animations (`iterations === Infinity`) are **paused first**, so waiting for the
   rest can terminate; then every frame waits for nothing running, 9s timeout. Motion is deliberately
   allowed to run rather than being disabled — the point is to let it **finish**, so what is captured is
   the design the animation was taking the page to. `prefers-reduced-motion` is **not** set, because that
   would capture a different product. Animations that never end are counted into `pausedMidFlight` and
   reported as a note.
5. **Frozen.** A stylesheet injected into **every** document — `animation-play-state: paused !important`,
   `animation-delay: 0s !important`, `transition: none !important`, `caret-color: transparent !important`
   on `*, *::before, *::after`. Remaining running animations paused, every `<video>` paused, and
   `document.activeElement.blur()` called, because the blinking caret is the one thing that moves with no
   animation attached to it.
6. **True.** Every declared claim looked for in the concatenated `innerText` of **every document in the
   page**, and `expectSelector` in every frame. A mislabelled screen is caught here, before it becomes a
   picture.
7. **Stable.** Two consecutive captures **byte for byte identical**, up to 5 tries 600ms apart. This is the
   strongest cheap proof that the picture is of a settled design: a page still loading or still moving
   cannot produce the same bytes twice.

## Recapturing after a change, which is every round after the first

`--changed` is the flag, and the mechanism is a **stamp** on every shot: a content hash of each file the screen
declares in `source`, plus a hash of the screen's own declaration — its url, its pinned state, its claims, its
viewport. Not its label, note or kind: renaming a tile does not change the page under it.

A screen is recaptured when its declaration hash differs, when any declared file's hash differs, when it has
never been captured, or when its shot predates stamping. Everything else is left alone and **named in the
output**, because silent completeness is the failure mode of every incremental build: a run that says "3
screens captured" and nothing else leaves a reader believing the other twenty-five were checked.

**Why not timestamps or git.** An mtime changes when a formatter runs and when a branch is checked out, so
timestamps recapture what did not change; git cannot see an uncommitted edit, which is exactly the state a
review round lives in, and a shot captured from a dirty tree records a commit that is a lie. A hash of the
bytes is true in both cases and needs nothing installed.

**What it cannot see, said in the run every time:** a shared component that a screen's `source` does not name.
`source` is one or two files per screen on purpose — the route and the surface — so a change to a button used
by nine screens is invisible to this. `--only` and a full run are the answer, and the printed "left alone"
list is what makes the gap visible rather than silent.

**The two halves that keep it honest.** `check-canvas.mjs` re-hashes the same stamp and NOTES any shot older
than the files it names, which catches the round where nobody passed the flag; and a capture PRUNES shots for
screens no longer declared, printing which, so a deleted screen does not leave its picture behind.

**Why this matters more than it sounds.** Recapturing everything marks every comment on the canvas stale.
Staleness is what moves a comment into the reviewer's queue, so a needless full recapture hands them back work
they already finished — the tool undoing its own review round.

## How big the picture is

Decided by the page, never by a list kept somewhere. If `scrollHeight > viewport.h * 1.1` the window itself
scrolls, so the design is longer than one screen and the whole page is captured; if it does not, the
surface is a fixed-height one whose insides scroll and **one screen IS the design** — a "full page" capture
of it would be the same picture under a different name. Capped at 8000px.

**Currently parked** behind `const CAPTURE_WHOLE_PAGES = false`, which is the only line that turns it back
on. It was built, it worked, and it was parked minutes later; see `hard-parts.md`. Everything below that
line still measures the page and reports what it found.

## The manifest is the receipt

Chromium's `Page.captureScreenshot` over CDP, WebP at quality 92 — Playwright's own helper does not take
WebP. About 70kb a frame. Four lanes over a shared queue, so a slow page cannot hold four fast ones behind
it; safe to parallelise for a specific reason, which is that **every screen proves itself independently**.

| Recorded                                   | Fails the run when                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------------------ |
| `claims: [{ claim, met }]`                 | any `met` is false — _"captured a page that does not have …"_                        |
| `stable`, `tries`                          | two captures never came out identical                                                |
| `bytes`                                    | under 6000 — _"the picture is N bytes, which is a blank page"_                       |
| `images: { shown, empty }`                 | `empty > 0` — _"N of M images on screen never loaded — the picture has holes in it"_ |
| `neverLoaded`                              | the load predicate timed out                                                         |
| `pausedMidFlight`                          | never — a note                                                                       |
| `hash` (sha256, 16 chars)                  | never — it is what staleness is computed from                                        |
| `w`, `h`, `wholePage`, `url`, `capturedAt` | never — they are the receipt                                                         |

A failure prints, collects, and exits non-zero at the end. **The image is still written** and the manifest
records which claim missed, so the failure appears on the canvas as _"not what it claims"_ rather than as an
absence. The canvas reads the manifest for exactly this reason: a frame whose capture failed says so
instead of looking fine.

`--only <id>,<id>` recaptures named screens, and **the manifest is merged rather than replaced**, so a
partial run does not throw away the rest.

---

# The comment layer

Drag a rectangle on a frame, type, save. Two artefacts, and the second one is the point.

- `design-canvas/comments.json` — the screen, its real route, the pinned state, the region in **percentages of
  the frame** (so it means the same at any zoom and after a differently sized recapture), the note, the
  hash of the shot it was drawn on.
- `design-canvas/comments/<id>.png` — **the captured screen with that rectangle drawn on it**, numbered to
  match the pin on the canvas.

Both gitignored, and the handoff panel says so out loud, because a reviewer should never have to wonder
whether this tool is accumulating files in their repository.

**Why a region and not a selector.** With no document under the cursor there is nothing to hit-test, and
the types file says so plainly rather than pretending: _"A selector is not available here and pretending
otherwise would be worse than this. What the agent gets instead is stronger for a design note: the
screenshot with the outline drawn on it, so the region being complained about is literally visible rather
than described."_

**The PNG is drawn in the browser**, in a `<canvas>`, where the pixels already are — which is why nothing
here needs an image library, and **why the tool must still be served from the app's own origin** even
though the frames are no longer live: a cross-origin image would taint the canvas element.

**Consumed is a separate axis from resolved.** An agent acting on a comment `PATCH`es
`/api/design-canvas/comments` with `{ id, consumed: true }`. Consumed only means it has been ingested, so
nothing is read twice and nothing is silently lost. There are no threads, statuses, severities, resolution
states, accounts, sharing or mentions, and adding any of them is how this becomes the over-engineered tool
it was built instead of: _"What I need is just comments."_

**Staleness is visible, never silent.** After a capture run, every comment whose screen was recaptured and
whose recorded hash no longer matches is flagged `stale: true` and the count is printed. What is under the
rectangle may not be what was being complained about. **Staleness is never a reason to drop a comment** —
the file's own contract says reconcile it, do not drop it.

**TWO QUEUES, AND THEY BELONG TO DIFFERENT PEOPLE.** This is the part that was wrong for a whole round and
reads as a small thing until a reviewer meets it. A comment the agent has not ingested is OUTBOUND — that is
what Hand off counts, and Hand off is hidden entirely when there is nothing outbound. A comment the agent HAS
ingested, on a screen photographed since, is INBOUND: the fix is on screen and only the reviewer can say
whether it worked. Nothing counts both. The owner found it with twelve answered comments on screen: _"it
still shows me that I can hand it off by copying the prompt, but there's really no comments that I should
send back to the agent."_

**What a pin offers depends on which queue it is in**, and the two states are not the same buttons with one
swapped:

- **Waiting** (not ingested, or not recaptured since): **Delete** and **Edit**. Editing belongs here and
  nowhere else — _"editing is correct when you haven't yet handed it off to your agent."_
- **Reviewable** (ingested AND recaptured): **Dismiss** and **Approve**, and no Edit. _"After the agent
  implemented the adjustment and retaken the screenshot, we either approve it or we dismiss it. If we dismiss
  it, it should work kind of like editing but more like an additional comment, additional feedback. If we
  approve it, it's the same as we just delete it."_

**Approve deletes.** A closed comment is one that is gone, so a comment that has vanished since a recapture
was accepted. **Dismiss asks for the next round** on the same rectangle: the new words become the note, the
answered words move into `history`, `consumedAt` and `stale` clear, and the annotated PNG is redrawn from the
screenshot the reviewer is objecting to. It stays ONE comment on one rectangle — the alternative, a second
comment beside the first, makes the pin count lie and gives the agent two notes about two different pictures.

**Nothing else is in the popover.** It used to print the path of the annotated PNG and the words "read by the
agent" under every note. Both went: the file name is the agent's business, and the status line could not be
read without guessing what it implied. Closing is an **X in the corner**, and a click anywhere outside closes
it — _"having a big close button is a bit confusing."_

**APPROVING ONE OPENS THE NEXT.** A queue that makes you find the next item yourself is a list, not a queue:
_"when I'm approving comments and I click approve and there are other comments that need my approval, I should
automatically see the next one right after clicking approve."_ The queue is recomputed from the server's
answer rather than from state — state still holds the one just approved — and the index is CLAMPED rather than
advanced, because the list shrank under it and staying put is advancing.

**APPROVE ALL ACTS AT ONCE AND OFFERS AN UNDO.** It deletes every comment awaiting review, so it was built
as a two-press confirm, and that was rejected on sight: _"we don't need a confirmation here, maybe show an
undo action for a few seconds instead."_ The undo is real rather than a re-creation — for six seconds the
comments are HIDDEN and nothing has been deleted, and the deletion happens when the window closes. Undo just
stops the timer. Re-creating deleted comments would mean new ids and new pictures, which is a copy, not an
undo. And no outlined button anywhere in it: _"why does this button have a border outline? remove it."_

**THE REVIEW QUEUE IS ONE PILL, and it is not in the toolbar.** After a round of fixes the pins are scattered
across a canvas that may be enormous: _"I can imagine that canvas can be really, really big with lots of
designs and just looking for the screenshots where you left a comment might be a bit frustrating. So we need
a better control."_ Bottom-right, it says how many are waiting for you; pressed, it flies to the first and
opens it, and becomes `‹ 3/6 ›` with one `Approve all`. The verdict is given in the pin, where the outline and
the words are — the pill only gets you there. It disappears when the queue empties.

Two things it has to do that are easy to miss, and both cost a round here:

- **Centre the OUTLINE, not the screen.** Centring the frame is fine until a frame is 3000px tall, and then
  the note opens below the fold: the stepper takes you to a screen and hides the thing it took you there for.
- **Only the frame that owns the open pin may listen for the outside click.** Once "which pin is open" moved
  up to the canvas so the pill could open one, all twenty-eight frames saw it, and the twenty-seven with no
  popover all decided the click was outside and closed it. Pressing Dismiss dismissed the box.

**Red is reserved for annotations.** The comment toggle in the toolbar is not red; the label is just
"Comment"; the icon is the action, not a speech bubble. The comment box is the **only** element on the
canvas that ignores zoom — it counter-scales by exactly 1/zoom with no cap, because it is a control rather
than part of the drawing, and it flips to the region's other side when the region sits past the middle of a
frame so it never opens away from the thing it is about.
