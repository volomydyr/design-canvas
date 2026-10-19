# The traps, with the symptom you will see

Each of these cost real time. They are written symptom first, because that is how you meet them: something looks wrong
and the cause is somewhere else. The first part is what a project can meet. The second part, "Fixed in the tool", keeps
the numbers the code cites, with the cause and the fix in a few lines; a project cannot meet those any more.

## Contents

1. Styling that does nothing: a canvas page without the prebuilt stylesheet
3. A picture that passes every check and is not the design: lazy images
9. Blank captures that are not the pipeline's fault
10. White holes down a long page: scroll-driven reveals
11. A wait that always runs out on long pages
12. A pinned state that shows in one surface and not in another
13. Two frames, one picture
16. Frames that never settle: a JS-driven animation the freeze cannot see
17. Open lands on the wrong state: the pin is client-only and the server is not
19. Claims that fail only in a full run
22. A list that stops at eight rows, but only when a person opens it
24. A frame that proves its claim on the page behind the dialog, or on a skeleton
31. A state no URL reaches, photographed as the page it happens on
35. A clean checkout that cannot resolve `design-canvas/`
38. A reuse check that refuses a constant, or waves a component through a barrel
39. A frame that says Loading and photographs the live list
43. One frame's storage is another frame's start
44. Data that arrives with no skeleton and no claim
46. A frame that waits ten seconds for a request that never ends
48. A menu claim that fails over a dialog and passes everywhere else
50. A file shows as modified, and its diff is empty

---

## 1. Every styling change is a no-op

**Symptom.** The canvas looks like a wireframe. Panels are invisible. Raising a color value changes nothing. Some classes
work, which makes it read as a styling problem rather than a build one.

**Cause.** A canvas page from an older install that does not import `design-canvas/canvas.css`. The canvas's classes then
come from the app's Tailwind, which generates only what its `content` globs find, so every utility the canvas uses that the
app does not already use is never generated.

**Fix.** Add `import "<up>/design-canvas/canvas.css";` as the first import of `app/design-canvas/page.tsx` and
`app/design-canvas/[canvas]/page.tsx`, as the installer's pages do; `check-install.mjs` names the page and the exact line.
The prebuilt stylesheet needs no Tailwind config to name the canvas folder.

## 3. A picture that passes every check and is not the design

**Symptom.** A gallery page captured at 11kb: correct layout, no photographs. Every claim passed, the capture was stable,
and the picture was worthless.

**Cause.** The photographs are `loading="lazy"`, and a headless page never scrolls.

**Fix**, already in `capture.mjs`: lazy loading is switched off as each image is added, then waited on, and an image on
screen that never arrived fails the capture. An image that finished failing (a dead file) is listed apart; `brokenImages:
true` declares an app that really shows it broken.

## 9. Blank captures that are not the pipeline's fault

**Symptom.** A recapture comes back blank for a whole group of screens.

**Cause.** Someone is editing those files while the dev server recompiles. The route renders fine moments later.

**Rule.** A capture needs a quiet tree. If other work is in flight on the same files, a failed capture is not evidence of a
capture bug; open the route by hand before debugging the pipeline.

## 10. White holes down a long page: scroll-driven reveals

**Symptom.** A whole-page capture has a band of pure white where a real section belongs. Every claim passes; in the browser
the page is fine.

**Cause.** The section fades up on `animation-timeline: view()`. Before its range it holds `opacity: 0`, and a whole-page
shot photographs past the fold without scrolling.

**Confirm it** on the running page before changing anything:

```js
[...document.querySelectorAll("*")]
  .filter((el) => parseFloat(getComputedStyle(el).opacity) < 0.05 && el.getBoundingClientRect().height > 100)
  .map((el) => el.getAnimations().map((a) => [a.animationName, a.timeline?.constructor?.name, String(a.currentTime)]));
```

A `ViewTimeline` with a negative `currentTime` is this trap.

**The fix is in the cascade, and `capture.mjs` ships it.** Re-attaching each animation to `document.timeline` and calling
`finish()` works when you test it and fails at the shutter: the capture resizes the viewport, styles recompute, and the
browser hands the animation back to its ViewTimeline. So the capture stamps every element with a scroll-driven animation
and writes a rule for it:

```js
for (const animation of document.getAnimations()) {
  if (!animation.timeline || animation.timeline instanceof DocumentTimeline) continue;
  const target = animation.effect?.target;
  if (target instanceof Element) target.setAttribute("data-canvas-revealed", "");
}
/* [data-canvas-revealed] { animation: none !important; opacity: 1 !important; } */
```

## 11. A wait that always runs out on long pages

**Symptom.** Every long screen takes the full animation budget and reports one or two animations "paused mid-flight". The
pictures look fine, so the note gets ignored.

**Cause.** Scroll-driven animations run forever, because nothing scrolls. The capture filters them out of the quiet test.

**The lesson.** That note was the finding: the counts landed on exactly the screens with white holes in them (trap 10). A
capture's own notes are findings.

## 12. A pinned state that shows in one surface and not in another

**Symptom.** A state pins correctly in a surface that hosts a preview, and does nothing on the page's own URL.

**Cause.** The state was written where an editor stages changes (a draft) rather than where the page reads them. A preview
host is usually draft-aware; a plain page reads only what is saved.

**Rule.** Pin the state the way the product saves it, and prove it with a selector claim on the surface being captured.

## 13. Two frames, one picture

**Symptom.** A reviewer says they do not understand a group of screenshots and asks whether all of them are needed.

**Cause.** Two declared screens resolve to the same address with the same state, so they photograph identically. A reader
hunts for the difference, does not find one, and stops trusting the canvas.

**Rule.** One frame, one picture. A state worth seeing gets its own pin, steps or network rule. The oracle and the
preflight fail a collision.

## 16. Frames that never settle: a JS-driven animation the freeze cannot see

**Symptom.** `never captured the same picture twice: still moving`, on every screen that holds one particular surface, while
every claim passes.

**Cause.** The freeze pauses CSS animations and waits for `document.getAnimations()` to go quiet. Neither reaches a library
that drives its own ticker and writes inline styles (GSAP, anime.js, a hand-rolled `requestAnimationFrame` loop). A timeline
with `repeat: -1` keeps running through the shutter.

**The fix is in the app, not the tool.** Freeze the animation in its end state when the URL carries the canvas param:

```ts
/* Read from the URL rather than imported, so deleting design-canvas/ cannot break this file.
   DELETE WITH: the design-canvas/ folder. */
const canvasFrame = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("canvas");

if (prefersReducedMotion || canvasFrame) {
  /* the completed state: the line fully drawn, the mark at full opacity and scale */
  return;
}
```

Most surfaces already have this branch for `prefers-reduced-motion`; reuse it. Freeze it finished, never dimmed or
disabled: a still frame of a state no user sees is the one thing this tool must not produce.

Motion that ends, driven from JavaScript, can say so instead: while an element carries `data-canvas-busy`, the capture
waits up to 9 seconds before it freezes the page. Remove the attribute when the last beat has landed.

## 17. Open lands on the wrong state: the pin is client-only and the server is not

**Symptom.** Every frame's Open button opens the route's default state instead of the pinned one: a real, plausible, wrong
screen, for as long as hydration takes, which on a cold dev route is seconds.

**Why nothing caught it.** The capture waits for the settled page, so it photographs the right state. The one path nobody
automates is a person pressing Open and looking at once.

**Cause.** Pinned state lives in client stores, so the pin runs in the browser. The server renders the default and sends it.

**Fix, and why it is markup rather than React.** By the time any component can decide anything, the browser has painted the
server's HTML. In `project/canvas-state-pin.tsx`, render an inline `<script>` that, only when the URL carries the pin param,
appends a `<style>` hiding the body, and remove that style in the component's mount effect:

```tsx
const BLANK_UNTIL_PINNED = `(function(){ ... location.search has "canvas" ... document.head.appendChild(style) ... })();`;

export function CanvasStatePin() {
  applyCanvasState();
  useEffect(() => { document.getElementById("canvas-pinning")?.remove(); }, []);
  return <script dangerouslySetInnerHTML={{ __html: BLANK_UNTIL_PINNED }} />;
}
```

Three details that matter: a `<style>` element, never an attribute on `<html>` or `<body>` (that is a hydration
difference); the script clears the style itself on a 5 second timer, so the worst case is never a permanently blank app; and
it does nothing without the pin param. A blank moment is honest; a different real screen is not. A canvas whose Open button
lies is worse than one with no Open button.

## 19. Claims that fail only in a full run

**Symptom.** A full capture reports several screens as missing text those pages plainly contain. The same screens with
`--only` pass.

**Cause.** A pinned state is applied on hydration (trap 17). Under a full run's load on `next dev`, hydration can take longer
than any settle signal, and while the page is hidden for trap 17, its `innerText` is the empty string. Every claim reads as
absent.

**Two fixes that do not work:** re-reading the text for longer (a different set of screens fails), and raising the budget.

**The fix, in the tool.** `CanvasStatePin` sets `data-canvas-pinned` on `<html>` in the same effect that reveals the page,
and the capture waits for it. A timeout there is a claim of its own, naming the pin, so a timing problem never reads as a
content problem. If a project's pin component was hand-written, make sure it sets that attribute, and sets it to
`unknown` when `applyCanvasState()` reports the state as not known: the capture then fails the frame and keeps its picture
instead of photographing the default under the state's name.

## 22. A list that stops at eight rows, but only when a person opens it

**Symptom.** Open on a frame over a list shows eight rows out of three hundred, with the footer still reading the real
total. Every capture and oracle check is green.

**Cause.** A cap added so a dialog frame would not be photographed down to its last row, gated on "a canvas pin is on the
URL". Open carries exactly that URL.

**Fix.** Reach for `oneViewport` first; frame height belongs to the capture. When app code must render differently for the
photograph, gate it on `canvasCapturing()` (the starter states file), which reads the mark only the capture's browser sets.
The oracle's live pass does not set it, so it sees the page as Open does.

## 24. A frame that proves its claim on the page behind the dialog, or on a skeleton

**Symptom.** All green: a dialog frame that shows no dialog, a "Viewed" frame that shows an expired item, a list frame of
shimmering rows.

**Cause.** Claims once matched the whole page, so text behind a scrim, a filter chip in the list underneath, or chrome that
paints before the data could satisfy them.

**How it works now.** Claims are read from the open dialog stack (with floating layers in front of it) when anything is open,
else from the body, and loading placeholders are waited out first. `forbid` reads the whole document; `expectMissing` reads
the frame's own surface. The capture and the oracle read the same surface.

**When you write a claim,** ask what else on the page could satisfy it. Chrome that paints before data is not evidence of
data.

## 31. A state no URL reaches, photographed as the page it happens on

**Symptom.** A frame labeled "Edit a Task" photographs the page behind the dialog, or needed a review-only `?canvas=` flag in
production code to be reachable at all.

**Fix.** `steps` on the screen (`references/declaration.md`). Claims are read after the steps, from the open dialog stack, so
a dialog that never opened fails its claims. Open still lands on the route, so its hover text says what to press.

## 35. A clean checkout that cannot resolve `design-canvas/`

**Symptom.** The dev machine is fine. The deploy build, from a clean checkout, fails: `Module not found: Can't resolve
'../../design-canvas/project/states'`.

**Why.** The canvas folder stays on the designer's machine, and a line of app code that imports it reached a commit without
its `design-canvas:local` marker. With the overlay nothing tracked imports the canvas: every marked line stays in the working
copy, so a clean checkout builds.

**Fix.** Mark the line (an added line, ending in `// design-canvas:local`), then fix the commit. The pre-push hook refuses a
push that carries such a line and names the file and line; `check-install.mjs` names an unmarked one before it is committed.
A project from an older install whose seams were committed keeps its canvas folder tracked, so its build resolves: never
untrack that folder while committed app code imports it.

## 38. A reuse check that refuses a constant, or waves a component through a barrel

**Symptom.** An agent is refused for importing a string constant or a schema as if it were a component, or a component
arriving through an `index.ts`, a `dynamic(() => import(...))` or `import * as Kit` goes through untouched.

**How the check decides.** A component is a function declaration, or an exported const whose value is a function, `memo(`,
`forwardRef(`, `lazy(`, an alias of another component or a wrapper call on one. A barrel is followed to the file that
defines the name (up to five levels), a namespace import is judged as every component the barrel re-exports, and a dynamic
import like a static one. A refusal that is still wrong is passed with `reuse-check: <name>, because <reason>` in the file.

## 39. A frame that says Loading and photographs the live list

**Symptom.** A frame labeled "Tasks Loading" shows the list with its rows, and every claim passes.

**Cause.** `network: [{ hold: "TaskList" }]` named an operation the page never sends: a renamed query, a typo, a read that
now goes out unnamed.

**How it works now.** A screen's own rule is a claim. The capture waits for the page to ask and fails the frame with "the
page asked for TaskList and the capture held it"; the preflight's live pass and the oracle say the same. Fix the name to
what the app sends.

## 43. One frame's storage is another frame's start

**Symptom.** A frame's picture depends on which frame ran before it, in an app that keeps something in the browser.

**Cause.** Network rules are per page, but the browser context is shared: `localStorage`, IndexedDB and cookies are per
browser. An app that persists query results, or steps that change a stored view choice, can leave it for the next frame.

**Fix, when it bites.** `--lanes 1` makes the run repeatable and shows whether storage is the cause. A throwaway context
per frame would be the durable fix and is not built.

## 44. Data that arrives with no skeleton and no claim

**Symptom.** A picture of a list in the state it started in: a total that still reads zero. Stable, every claim met.

**How it works now.** After the page loads and after its steps, the capture waits until no fetch or XHR has been in flight
for 400 ms, at most 10 seconds, and notes what was still out. The preflight's live pass and the oracle wait the same way.
`--no-network-wait` is for an app that polls so often that every frame would pay the cap. If a figure still fills in late,
give the frame a claim on it.

## 46. A frame that waits ten seconds for a request that never ends

**Symptom.** Every frame carries "network was not quiet within 10s".

**How it works now.** A request open longer than 6 seconds (a subscription, a stream, a long-poll) stops counting, and one
still open when its page closes is learned for the run and named once. If the note persists, the app's channel opens late
or restarts; `--no-network-wait` switches the wait off.

## 48. A menu claim that fails over a dialog and passes everywhere else

**Symptom.** A frame that opens a menu inside a dialog fails every claim about the menu's items, while the picture shows
them.

**Cause.** Menus, lists and popovers are portaled beside the dialog, not inside it.

**How it works now.** One reader, `SURFACE_TEXT` in `steps.mjs`, reads the dialog stack plus the floating layers in front of
it. If a claim about a portaled surface still fails, check whether that surface is really in front of the dialog.

## 50. A file shows as modified, and its diff is empty

**Symptom.** `git status` lists an app file, `git diff` shows nothing, and a pull or a rebase refuses with "Your local
changes would be overwritten" or "You have unstaged changes".

**Why.** Only the file's local lines changed, by hand and with no agent hook run since. git's quick check sees a new size and
calls the file changed without reading it through the overlay's filter.

**Fix.** `node design-canvas/overlay.mjs sync`, which the canvas's Claude Code hook runs before every git command. Nothing is
lost either way: the lines are in the file, and the commit never carries them.

---

# Fixed in the tool

Kept so the numbers the code cites still resolve. Each one is in the code already; a project cannot meet it.

**2. Captions vanish; the comment box is cropped at the frame edge.** `content-visibility: auto` implies paint containment,
which clips what a child paints outside the box. The annotation layer is a sibling of the picture box.

**4. Zoom, wheel and keys dead while dragging works.** A `requestAnimationFrame` handle canceled but not nulled in cleanup
died in React's development double-mount. Handles are nulled in cleanup.

**5. Panning gets slower the more canvas exists.** `will-change: transform` on a world wider than the GPU's largest texture.
The world carries no `will-change`.

**6. Frame drops on a plain drag or zoom.** A CSS variable rewritten on the world every frame invalidated every descendant.
Variables are written only when they change, and during a zoom only on the elements that read them.

**7. A finished page that waits 45 seconds.** The load predicate waited on cross-origin frames and on images outside the
shot. Unreadable frames are skipped and only images in the shot are waited for.

**8. An assertion that cannot fail.** The oracle asserted against whichever view was default, and once measured pixels on
a zoomable canvas. The oracle sets the view it asserts against and counts frames, not pixels.

**14. Icons 4px wide.** The core's `cn` is a plain joiner, so a `px-0` meant to override a shared padding lost. Nothing in
the core writes a utility expecting to override another, and icons carry width and height attributes.

**15. Inherited from live frames.** Nested frames are frozen too; "settled" means rendered text, not child elements; frame
edges are shadows, not borders, so scaling leaves no seam; caption space is declared once in `graph-layout.ts`.

**18. A new control on a frame that hovers and never fires.** The pan surface captures the pointer on `pointerdown`, so a
press that starts on a control ends on the surface and no `click` fires. Controls carry `data-canvas-chrome` or stop
propagation on `pointerdown`. Prove a new control with a real `page.mouse.down()` and `up()`, never `locator.click()`.

**20. A 200 that patched nothing.** A drain sent the slug in the body while the route reads it from the query. A PATCH of
an id the canvas does not hold is now a 404 naming the canvas, all or nothing.

**21. The recapture loop.** Changed-only selection once hashed only the files a screen names, so a shared component
changed nothing. The stamp now walks imports, includes the pinned state's file, and a failed frame gets a second pass alone
after the lanes drain.

**23. A desktop frame laid out at a phone's width.** A screen with no viewport of its own inherited the previous screen's.
Every screen sets its viewport, and a guard throws when the layout width and the picture width disagree.

**25. Clear All offers to delete thirteen comments on a canvas whose hand-off says one.** Records sat outside every count.
Every record is now in exactly one of three places: unread in the hand-off, a consumed note in the review row, or deleted
(a consumed verdict, or an answered comment whose screen left). The sweep runs on every capture exit.

**26. The oracle's own comment test wrote into the reviewer's file.** The oracle's browser points the comments route at a
reserved key, `oracle-probe-<slug>`, and an `oracle:` comment found in the reviewer's file is a failure.

**27. A green tail above a failure list.** The oracle's last line is its verdict, `PASS` or `FAIL (<count>): …`, on every
exit. Read the last line.

**28. A sign-in page on every frame, and a crash that printed the tokens.** The first page is checked for a sign-in redirect
before any lane starts, and launch errors print only their first line with the session scrubbed (`browser-guards.mjs`).

**29. A comment number that means two comments.** The next id was the highest in the file plus one. The file now carries
`maxId`, which only goes up.

**30. Comments pinned to frames a promotion removed.** `successors` names where a removed frame's comments go, and a frame
gone with a live note and no successor refuses the run.

**32. A refusal found ten minutes into a run.** `preflight.mjs` runs the checks that are decidable from the file first, in
seconds, with the same code the oracle uses.

**33. A frame changed and nobody said so.** Every capture compares each re-photographed frame with the picture it replaced
and flags change outside the commented regions.

**34. Tools told different ports.** `design-canvas/settings.json` holds the address once, there is no default port, and
`round.mjs` proves the server knows this declaration.

**36. A live pass that compiled every route.** The oracle's Open pass visits only frames recaptured since their last clean
visit; `--live-all` is for proving a whole canvas.

**37. Browsers nobody closed.** Every tool launches through `browser-lifecycle.mjs`: a `finally`, signal handlers that kill
the process group, and a detached watchdog for a SIGKILL. A new tool uses `launchBrowser` or `withBrowser`.

**40. A held request that reached the server when its page closed.** A browser releases what it holds when a page closes.
Held routes are aborted in the `finally` that closes the page.

**41. A picture of a page that did not arrive.** `shot-guard.mjs` refuses a new picture far smaller than the one it replaces
from a page with almost no text, and keeps the old one.

**42. Six stale steps, eight minutes.** A step that cannot be done is final: listed apart and never retried.

**45. A white band under every dialog, in installed Chrome only.** Installed Chrome dropped the viewport emulation for the
screenshot session. The shutter's session sets the metrics itself, and a guard throws if the height moved.

**47. Good frames refused over one dead file.** An image that finished failing was treated as still arriving. It is now
photographed, listed apart and never retried (`images.broken`).

**49. Every frame waits the same 1.6 seconds.** Fixed waits became signals: images are made eager as they are added, and the
floor became a settle capped at the old length. Every animation is finished before each proof shot, so a late surface is
drawn finished.

**51. A marked line from a teammate's commit, dropped by the next commit here.** The filter took every marked line out, so a
`design-canvas:local` line that arrived through a pull left git with the designer's next commit of that file. A marked line
or block the committed version already holds is now tracked text: kept, seen by git, and removed here when it is removed
upstream. Only lines local to this working copy are overlay lines. An identical copy of a committed marked line counts as
committed too, and the pre-push scan names it in one line without blocking, because every remote-tracking ref already holds
it (a merge's first parent alone does not, which once stopped every push of a merge that brought a teammate's marked line). A hand-off line is collected and shown only when it is proven to be this
copy's own: absent from HEAD and from a merge or rebase in progress, and never added at that path by any commit a ref reaches.

**52. Open on a frame not captured yet lands on the default state.** The Open link took the pinned address from the capture
manifest and fell back to the bare route. It now falls back to the address the capture would use (`openAddress` in
`types.ts`), which carries the pinned state.
