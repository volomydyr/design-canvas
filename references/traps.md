# The traps, with the symptom you will actually see

Every one of these was found the hard way while building the canvas this skill carries. They are written
symptom-first, because that is how you will meet them: something looks wrong and the cause is somewhere
else entirely.

## Contents

1. Styling that does nothing — Tailwind's content globs
2. Overlays clipped at a frame's edge — paint containment
3. A picture that passes every check and is not the design — lazy images
4. Every eased interaction dead, dragging fine — the rAF handle
5. A slow, worsening canvas — `will-change` on a huge world
6. Frame drops on a plain drag — custom properties per frame
7. A page that waits 45 seconds and gives up — cross-origin frames, and waiting for the wrong images
8. Assertions that cannot fail — the default view, and scale-dependent measurements
9. Blank captures that are not the pipeline's fault
10. White holes down a long page — scroll-driven reveals
11. A wait that always runs out on long pages — animations that never stop
12. A pinned state that shows in one surface and not in another — draft versus saved
13. Two tiles, one picture
14. Icons 4px wide — a class that never won
15. The ones inherited from the live-frames era
16. Frames that never settle — a JS-driven animation the freeze cannot see
17. Open lands on the wrong state — the pin is client-only and the server is not
18. A new control on a frame that hovers, highlights and never fires
19. Claims that fail only in a full run
20. A 200 that patched nothing — the slug is a query parameter
21. The recapture loop, and the two reasons it cost an afternoon
22. A list that stops at eight rows, but only when a person opens it
23. A desktop frame laid out at a phone's width
24. A frame that proves its claim on the page behind the dialog, or on a skeleton
25. Clear All offers to delete thirteen comments on a canvas whose hand-off says one

---

## 1. Every styling change is a no-op

**Symptom.** The canvas looks like a wireframe. Panels are invisible. Raising a colour value changes
nothing. Ring colours never appear. Several rounds of "make the contrast better" produce no visible
difference — and some classes work, which makes it read as a styling problem rather than a build one.

**Cause.** `design-canvas/` is a new top-level folder and Tailwind only generates the classes it finds by
scanning its `content` globs. **Every utility the canvas uses that the app does not already use somewhere
else is never generated at all.** The ones that happen to coincide with app usage work.

**Fix.** v3: add `"./design-canvas/**/*.{ts,tsx}"` to `content` in the Tailwind config. v4: `@source
"../design-canvas";` in the CSS entry. Mark it `DELETE WITH: the design-canvas/ folder`. Do it **before** styling
or judging anything. `check-install.mjs` fails when it is missing.

**Generalise it:** any new top-level folder that renders UI must be added to the content globs as its first
act, or every subsequent styling decision is untestable.

## 2. Captions vanish; the comment box is cropped at the frame edge

**Cause.** `content-visibility: auto` on the frame (a real and correct performance win — it skips rendering
off-screen frames) implies `contain: layout paint`, and **paint containment clips anything a child paints
outside the box.** It bit twice: the caption above the frame, then the note box extending past its right
edge.

**Fix.** The annotation layer is a **sibling** of the picture box, not a child of it. Only the picture gets
containment.

**Rule:** decide the containment boundary before the overlay, not after. Anything that must paint outside a
frame's bounds cannot live inside an element with `content-visibility` or `contain: paint`.

## 3. A picture that passes every check and is not the design

**Symptom.** A store front page captured at 11kb: correct layout, no jewelry in it. Every declared claim
passed. The capture was perfectly stable. The picture was worthless.

**Cause.** The product photography is `loading="lazy"`, and **a headless page never scrolls**, so the
browser never reached any of it.

**Fix**, three parts, all of them in `capture.mjs` already:

1. Lazy loading is switched **off** first — `loading="lazy"` → `eager`, `decoding="async"` → `sync` — in
   every document including nested frames, **twice, a beat apart**, because a component that renders late
   brings its own lazy images.
2. Then waited on.
3. **An image on screen with no natural size fails the capture outright**: `images: { shown, empty }` in the
   manifest, and `empty > 0` is a failure — _"the picture has holes in it"_.

This is the most important line in the whole pipeline: _"the exact failure this whole pipeline exists to
prevent: a picture that passes every check and is not the design."_

## 4. Zoom, wheel, keyboard and jump-to-screen are all dead; dragging works

**Cause.** React's development double-mount. The cleanup called `cancelAnimationFrame(handle.current)` but
did not reset `handle.current` to null. On remount the loop starter saw a non-null handle, concluded a loop
was already running, and never started one. **Only the eased half of the interaction died** — everything
that animates towards a target — while dragging survived because a drag paints directly without the loop.

**Fix.** Null the handle in cleanup, not merely cancel it.

**Rule:** any rAF, interval or timer handle stored in a ref must be nulled in cleanup. In StrictMode
"cancelled" and "not running" are different states, and only the ref can tell you which one you are in.

Related, same file: clamp ctrl+wheel per event. One mouse notch delivers a delta of 120, which uncapped is a
7× zoom jump straight to the limit.

## 5. Panning gets slower the more canvas exists

**Cause.** `will-change: transform` on the transformed world container. The world is ~16000px wide;
`will-change` asks the compositor for a dedicated layer, and a layer that large is past the GPU's maximum
texture size, so the browser falls back to a slower path — the opposite of the intent.

**Fix.** No `will-change` on the world container. It is an optimisation for small, frequently animated
elements.

## 6. Frame drops on a plain drag, whatever is mounted

**Cause.** Zoom was published to the tree as a CSS custom property and rewritten every `requestAnimationFrame`.
A custom-property write on an ancestor **invalidates style for every element that inherits it** — roughly 200
per frame here.

**Fix.** Write the variable only when the zoom value actually changes. A drag does not change the zoom, so a
drag costs one transform and nothing else.

## 7. A finished page that waits 45 seconds and then gives up

**Two different causes, both in the load predicate.**

- **A cross-origin iframe reports `contentDocument: null` forever**, which a naive predicate reads as "not
  ready yet". Skip frames with no `src` or `src === "about:blank"`, and skip any frame whose document cannot
  be read. 47s → 2.9s.
- **Waiting for every image** rather than the ones in the shot. A collection page carries 39 photographs, six
  above the fold; it waited for 33 that no viewport-height capture could ever show. Wait only for images
  intersecting the viewport and larger than 2px — and when whole-page capture is on, run the same predicate
  with `all = true`, because then everything below the fold really is in the picture.

## 8. An assertion that cannot fail

Two shapes of the same bug, and both are worse than a missing assertion because they read as proof.

- **The checker asserted against whichever view happened to be default.** When the default moved from flows
  to grouped screens, the edge assertions ran against a view that draws **zero** edges and would have
  passed. An oracle must **establish the state it asserts against**.
- **A "no group of one frame" check that measured pixels.** The canvas is zoomable, so the measurement meant
  nothing and the check passed always. Count frames, not pixels: any check that is scale-dependent cannot
  fail.

Three more of the checker's own flakes, all the same class — the test was faster than the thing it tested:
measuring while the canvas was still easing from a jump (wait for stillness — two identical reads), reading
`comments.json` before the POST landed (wait for the write), and asserting after a fixed 120ms sleep that a
lazy picture had loaded (wait on the condition). Fix them rather than tolerating them; a flaky oracle stops
being read.

## 9. Blank captures that are not the pipeline's fault

**Symptom.** A recapture comes back blank for a whole group of screens.

**Cause.** Another agent, or you, editing those exact files while the dev server recompiles. The route
renders fine moments later.

**Rule:** a capture run needs a quiet tree. If other work is in flight on the same files, a failed capture is
not evidence of a capture bug — open the route by hand before debugging the pipeline.

## 10. White holes down a long page — scroll-driven reveals

**Symptom.** A whole-page capture has a band of pure white in it, hundreds of pixels tall, where a real
section belongs. Everything else on the page is correct, every claim passes, the file is a normal size. In
the browser the page is fine.

**Cause.** The section fades up as it scrolls into view: `animation-timeline: view()` with `both` fill. Before
its range the animation holds its FROM state, which is `opacity: 0`. A whole-page shot photographs past the
fold **without ever scrolling**, so every band below the first screen sits in that before-phase.

**How to confirm it in one line**, on the running page, before changing anything:

```js
[...document.querySelectorAll("*")]
  .filter(
    (el) =>
      parseFloat(getComputedStyle(el).opacity) < 0.05 &&
      el.getBoundingClientRect().height > 100,
  )
  .map((el) =>
    el
      .getAnimations()
      .map((a) => [
        a.animationName,
        a.timeline?.constructor?.name,
        String(a.currentTime),
      ]),
  );
```

A `ViewTimeline` with a negative `currentTime` is this trap exactly.

**The fix, and the wrong fix that tests clean.** Re-attaching each animation to `document.timeline` and
calling `finish()` DOES work — opacity 0 to 1, measured — and then does not survive the shutter: the capture
resizes the viewport to reach past the fold, styles recompute, and a CSS animation's timeline comes from the
cascade, so the browser rebuilds the animation and hands it straight back to its ViewTimeline. The page
photographs exactly as blank as before while every check in the run says fine. **So it has to be done in the
cascade**: stamp the elements carrying a scroll-driven animation and write a rule for them.

```js
for (const animation of document.getAnimations()) {
  if (!animation.timeline || animation.timeline instanceof DocumentTimeline)
    continue;
  const target = animation.effect?.target;
  if (target instanceof Element)
    target.setAttribute("data-canvas-revealed", "");
}
/* [data-canvas-revealed] { animation: none !important; opacity: 1 !important; } */
```

`capture.mjs` ships this. It is here because the same shape will appear in any project using scroll-driven
animation, and because the wrong fix is the one you will reach for first.

## 11. A wait that always runs out on long pages

**Symptom.** Every long screen takes the full animation budget and then reports one or two animations
"paused mid-flight". The pictures look fine, so the note gets ignored.

**Cause.** The same scroll-driven animations. They are `running` forever, because what advances them is a
scroll position and nothing scrolls. Filter animations whose timeline is not the document timeline out of
the quiet test.

**The lesson under the trap, which is the more useful half:** that note WAS the finding. Three runs reported
`pausedMidFlight: 1, 1, 2` on exactly the three screens with white holes in them, and it was read as
ordinary — "an animation that never ends is a spinner" — until the reviewer pointed at the holes by hand. A
capture pipeline's own notes are findings. Read them as findings.

## 12. A pinned state that shows in one surface and not in another

**Symptom.** A state pins correctly in the surface that hosts a preview, and does nothing on the page's own
URL. Same store, same state id, one works.

**Cause.** The state was written where an EDITOR stages changes rather than where the page reads them — a
`draft` map that an Apply step later commits into the saved one. A preview host is usually draft-aware; a
plain page is not, and reads only what is saved.

**Rule.** Pin the state the way the product SAVES it, and prove it with a selector claim on the surface being
captured. This one shipped a canvas where a menu tile showed a picture and the same store on its own address
showed four grey "no photo yet" boxes; the claim is what caught it, not the eye.

## 13. Two tiles, one picture

**Symptom.** A reviewer says they do not understand a group of screenshots and asks whether all of them are
needed.

**Cause.** Two declared screens resolve to the same address with the same state, so they photograph
identically. Usually done deliberately, "so the states can be compared side by side", with a note in the
declaration explaining it. The note does not save it: a reader sees two pictures, hunts for the difference,
does not find one, and stops trusting the whole canvas.

**Rule.** One frame, one tile. A state worth seeing gets its own pinned state; if it cannot have one, it does
not need a tile. `check-canvas.mjs` groups the declared screens by composed URL and fails on a collision.

## 14. Icons 4px wide — a class that never won

**Symptom.** An icon in a square button renders as a sliver: measured 4x16px where 16x16 was intended. Only
some icons, only in some buttons, and it looks like the icon library is broken.

**Cause.** `cn()` in this core is a **plain string joiner**, deliberately: it has no dependency and no Tailwind
conflict resolution. So `cn(BAR_ITEM, "w-8 px-0")` emits `px-3.5` AND `px-0`, both apply, and the one later in
the generated sheet wins — which was `px-3.5`. A 32px-wide button with 28px of padding leaves a 4px content
box, and the icon is a shrinkable flex item, so it collapses into it.

**Two rules, and the second is why `core/icons.tsx` exists:**

- **Never write a utility expecting to override another.** No padding in shared constants; each caller sets
  its own. A host project whose `cn` DOES merge (shadcn's) will hide this bug until the folder is installed
  somewhere that does not — which is exactly how it shipped.
- **Icons are components with width and height ATTRIBUTES**, `shrink-0`, and a fixed default size. An icon
  whose size depends on the cascade winning an argument will be 4px wide in somebody's project. No icon
  library in the core, for the same reason the colours are literals.

## 15. Inherited from the live-frames era, still true

- **One hold is not enough.** A surface that mounts another route in a frame of its own settles seconds after
  its host, so the freeze must recurse into nested frames and re-run. `capture.mjs` applies every in-page
  step to `page.frames()`, not just the top document, for this reason.
- **"Settled" cannot mean "has child elements".** A Next dev page reaches `readyState: complete` with a body
  holding only `<script>` tags. Settled means something has actually rendered — hence
  `body.innerText.trim().length > 0`.
- **A claim must be chosen from the page, not from the label.** A search page title-cases the query; a
  product page may never print an item's internal code, because that code is the seller's own reference. Both were caught on the
  first run, which is the point of claims existing at all.
- **A 1px border on a scaled element produces a visible seam.** The browser rounds the border and the
  picture differently on fractional pixels. The frame edge is a hairline drawn as a **shadow**.
- **Two numbers that have to agree in two files.** The caption height lives in the frame component and the
  row gap in the layout; guessing the second printed group titles on top of the first row's captions.
  `CAPTION_SPACE` is declared once in `graph-layout.ts` and every vertical gap is derived from it.
- **A FIFO mount queue floods.** Fitting the whole canvas put every tile in the queue at once, so the one you
  were looking at was behind all the others. Ultimately solved by capturing instead of mounting.

---

## 16. Frames that never settle — a JS-driven animation the freeze cannot see
17. Open lands on the wrong state — the pin is client-only and the server is not

**Symptom.** `never captured the same picture twice — still moving`, on every screen that holds one particular
surface, while every claim on those screens passes and the rest of the run is clean. Measured on the install
this came from: five of nine frames, all five holding the same 40px illustration, and the three frames that
happened to pass did so on the third and fifth try.

**Cause.** The capture's freeze step injects a stylesheet that pauses CSS animations and transitions, and waits
for `document.getAnimations()` to go quiet. Neither reaches an animation library that drives its own ticker and
writes inline styles — GSAP, anime.js, a hand-rolled `requestAnimationFrame` loop. A timeline with
`repeat: -1` therefore keeps running through the shutter, and the two-identical-captures proof can never pass.

It reads as a broken pipeline, which is the expensive part: the run reports a stability failure, the pictures
look fine to the eye, and the temptation is to raise the retry count.

**The fix is in the app, not in the tool.** The capture cannot discover an arbitrary library's global, and a
tool that tried would be guessing. Freeze the animation in its **end state** when the URL carries the canvas
param:

```ts
/* Read from the URL rather than imported, so deleting design-canvas/ cannot break this file.
   DELETE WITH: the design-canvas/ folder. */
const canvasFrame =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).has("canvas");

if (prefersReducedMotion || canvasFrame) {
  /* the completed state: the line fully drawn, the mark at full opacity and scale */
  return;
}
```

Most surfaces already have this branch, because `prefers-reduced-motion` needs the same end state — reuse it
rather than inventing a second one.

**Freeze it FINISHED, never dimmed or disabled.** A still frame of a state no user ever sees is the one thing
this tool must not produce, and "disabled" is exactly that: on the project this came from, a dimmed version of
this illustration had already been rejected on sight — _"nothing changed except making the animation disabled,
which even makes it worse, feeling like something's broken"_. The end of the loop is a state every viewer
really sees.

---

## 17. Open lands on the wrong state — the pin is client-only and the server is not

**Symptom.** Every frame's Open button opens the route's DEFAULT state instead of the pinned one. Not a
blank, not an error — a real, plausible, wrong screen. The reviewer who found it on a finished canvas: _"the
links for opening the screens locally do not work… They all show me the same disconnected empty state, which
is weird. If something has a button to open it, it should open the same exact thing in the same exact state."_
All 19 pinned URLs on that canvas did it.

**Why nothing caught it.** Every automated check passed, and always would have. `capture.mjs` waits for the
settled page, so it photographs the state AFTER hydration — the right one. `check-canvas.mjs` asserts against
those pictures. The one path nobody automates is a human clicking Open and looking immediately, which is the
only path where the pre-hydration paint is visible.

**Cause.** Pinned state lives in client stores, so the pin can only run in the browser. The server renders the
route's default and sends that HTML; the page becomes the pinned state when hydration runs. On a cold `next
dev` route that is seconds. The window is not a flicker — it is long enough to read, screenshot and report.

**Fix, and why it is markup rather than React.** Nothing a component does can close the window: by the time
any component can decide anything, the browser has painted the server's HTML. What runs earlier is markup. In
`project/canvas-state-pin.tsx`, render an inline `<script>` that — only when the URL carries the pin param —
appends a `<style>` hiding the body, and remove that style in the component's mount effect, by which point the
store holds the pinned state and React has rendered it:

```tsx
const BLANK_UNTIL_PINNED = `(function(){ ... location.search has "canvas" ... document.head.appendChild(style) ... })();`;

export function CanvasStatePin() {
  applyCanvasState();
  useEffect(() => { document.getElementById("canvas-pinning")?.remove(); }, []);
  return <script dangerouslySetInnerHTML={{ __html: BLANK_UNTIL_PINNED }} />;
}
```

Three details that are not optional:

- **A `<style>` element, never an attribute on `<html>` or `<body>`.** The first version set
  `data-canvas-pinning` on `<html>` and React warned on every pinned page — "Extra attributes from the server"
  — because those elements are server-rendered and the attribute is a hydration difference. An element appended
  to `<head>` is not diffed, so it is silent.
- **The script clears the style itself on a timer** (5s). A tool whose failure mode is a permanently blank app
  is worse than the bug it fixes.
- **It must do nothing without the pin param.** No `?canvas=` means no style, no deferred render, no hydration
  difference — every real user gets the page exactly as before.

**Generalise it:** a blank moment is honest, a different real screen is not. Any state a canvas can only
establish on the client needs the page held back until it is established, or the Open button lies.

## 18. A new control on a frame that hovers, highlights and never fires

**Symptom.** A control added to a frame's chrome — a verdict button, a badge, anything in the figcaption —
renders correctly, shows its hover state, and does absolutely nothing when pressed. No error, no console
warning, no failed request. Nothing at all. The reviewer presses Like on twelve options, gets twelve hover
highlights, and the hand-off comes back empty because not one verdict was ever saved.

**Why nothing caught it.** `check-canvas.mjs` asserts what is on screen, and the button IS on screen, correct
in every state. There is no assertion that a control does its job, because the oracle cannot press anything.
Reading the code catches nothing either: the handler, the client call and the route are all correct, and each
one works when called directly.

**Cause.** `core/canvas-surface.tsx` is a pan-and-zoom world. On `pointerdown` it starts a drag and calls
`setPointerCapture`, which redirects every later pointer event to the surface — including the `mouseup` that
would have completed the click. The press begins on the button and ends on the canvas, so no `click` event is
ever generated. The surface has one escape hatch and it is a deliberate one:

```tsx
if ((event.target as HTMLElement).closest("[data-canvas-chrome]")) return;
```

The toolbar and the comment rail carry that attribute. A control inside a FRAME does not, which is why the
pins that predate this each carry `onPointerDown={(event) => event.stopPropagation()}` instead.

**Fix.** Every interactive element added inside a frame gets the same guard as the pins:

```tsx
<button onClick={...} onPointerDown={(event) => event.stopPropagation()}>
```

**How to prove it, since inspection cannot.** Log `pointerdown`, `mousedown`, `mouseup` and `click` on the
control and on `document` in the capture phase, then drive a real press with `page.mouse.down()` /
`.up()` rather than `locator.click()`. The signature of this bug is exact: `pointerdown` and `mousedown` arrive
on the control, `mouseup` and `click` arrive on a `div`, and `lostpointercapture` fires there too. Calling the
React `onClick` prop by hand succeeds while a real press fails — if those two disagree, the event is being
captured and the handler is not the thing to debug.

**Generalise it:** on a canvas that pans, a click is not a click until something releases the pointer. Any new
control on a frame is guilty until a real synthetic press proves otherwise, and "it looks right and the
handler is correct" is not that proof.

**AND `locator.click()` IS NOT THAT PROOF EITHER.** It drives the element directly, so it passes whether or not
the pointer is being captured — which is the entire failure this trap describes. A session reported the Open
buttons working on that basis and was told twice they were not. Prove it with `page.mouse.down()` / `.up()` at
the control's measured centre, in three states, because the mechanism depends on the surface's drag state:
fresh load, after a pan, after a zoom. Log `pointerdown`, `mousedown`, `mouseup` and `click`; all four on the
control plus the side effect firing is a pass, and `mouseup`/`click` on a `div` is this bug.

**A second, separate defect in the same handler, fixed 2026-09-01.** `onPointerDown` called
`event.preventDefault()` BEFORE the `[data-canvas-chrome]` guard, so every press — including one on a frame's
Open button or the toolbar — had its default cancelled before the guard could return. On the world that is
invisible, because the pan then starts as intended; on the chrome it costs the press its activation behaviour.
The guard runs first now. If you are reordering that function, keep it first.

## 19. Claims that fail only in a full run

**Symptom.** A full capture reports several screens as unproved — "the page does not have 'Network interrupted',
'Reference is missing'" — for text those pages plainly contain. Capture the same screens with `--only` and every one
passes in about six seconds. Nothing about the pages changed between the two runs.

**Why it matters more than it looks.** The verdicts depend on how many OTHER screens were captured beside them,
which makes the whole run unactionable: a real regression and a scheduling artefact print the same line. The
honest-looking direction of the failure is what makes it dangerous — it never claims something false is true, so
it reads as a finding and gets chased as one. Two rounds of chasing is how it was diagnosed.

**Cause, and it is two things compounding.** A pinned state is applied on HYDRATION, because the state lives in
client stores (trap 17). Under a full run's load against `next dev`, which compiles routes on demand, hydration
can take far longer than any of the settle signals. And while trap 17's fix is in force the body carries
`visibility: hidden` — so `innerText` of a page that has not hydrated yet is **the empty string**, not the
server's text. Every claim is therefore absent, and the message reads exactly like a page that lost its content.

**Two fixes that did not work, recorded because they are the tempting ones.**

1. _Re-read the text until the claims appear, up to a budget._ Eight seconds. The next full run failed a
   different five screens. A threshold set inside the distribution it is trying to exclude just reshuffles which
   screens fail.
2. _Raise the budget._ Same shape of failure, later. Nothing here is a slow render; the page has not started.

**The fix.** Wait for a signal that means the pin is in place, not for a duration. `CanvasStatePin` sets
`data-canvas-pinned` on `<html>` in the same effect that reveals the page, so the mark cannot appear before the
store holds the state and React has rendered with it:

```js
let pinned = true;
if (screen.state) {
  pinned = await page
    .waitForFunction(() => document.documentElement.hasAttribute("data-canvas-pinned"), {
      timeout: PIN_TIMEOUT_MS,          // 45s: a whole hydration under a full run's load
    })
    .then(() => true)
    .catch(() => false);
}
if (!pinned) claims.push({ claim: `the pinned state "${screen.state}" was applied`, met: false });
```

**The `catch` is the part to get right.** A silent one degrades into "the page does not have X" for every claim,
which is what sent three rounds of debugging after phantom content bugs. A timeout has to be a claim of its own,
naming the pin, or the tool lies about which thing is broken.

**Generalise it:** never assert against a pinned page on a timer. And when a diagnostic can only be read from a
page that a fix has deliberately hidden, make the failure path say so out loud — a wait that gives up quietly
turns a timing problem into a content problem, and the content is where everyone looks first.

---

## 20. A 200 that patched nothing, because the slug is a query parameter

**What happened.** Nine comments were drained at the end of a round: `PATCH /api/design-canvas/comments` with
`{ canvas: "checkout", id, consumed: true }`, nine times, nine `200`s. Every one of them was a no-op. `?canvas=`
is read from the QUERY STRING, so a slug in the JSON body selects the DEFAULT canvas — the ids did not exist
there, PATCH did not mind, and a `comments/main.json` was created to hold the nothing that changed. The
reviewer's real notes sat exactly where they were while the log said they had been consumed.

**Why it survived so long.** Every other guard in that route refuses loudly — a malformed id is a `400`, a bad
slug is a `400`, an emptied note is a `400`. Patching an id that is simply absent was the one path that answered
success, and it is the only one an agent cannot detect from the response.

**The fix.** The mutation refuses, from inside `mutate`'s callback so it lands before the write:

```ts
const missing = [...ids].filter((id) => !comments.some((c) => c.id === id));
if (missing.length > 0) throw new UnknownIds(missing);
```

```
no such comment on canvas "main": c1
```

Three things that message has to do. **404, not 200** — a drain is only worth having if the answer proves it.
**Name the canvas it looked in**, because "main" when you meant "checkout" is the whole diagnosis in one word.
**All or nothing**, naming every missing id: a batch that quietly patches four of six is the same trap one size
down. And because it throws before `writeFile`, a rejected PATCH now leaves no file behind — being wrong about
which canvas you are talking to must not bring that canvas into existence.

**Generalise it:** in a tool an agent drives, the write that silently matched nothing is worse than a crash. Any
call whose whole purpose is "this has been dealt with" must fail loudly when it dealt with nothing — and when a
target is selected by a name, the error has to say which name it used, not just that the target was missing.

---

## 21. The recapture loop, and the two reasons it cost an afternoon

**What it felt like.** _"around 30 minutes for our canvas. But it doesn't make any sense."_ He is right that it
makes no sense, and wrong about where the time went: a full 33-screen capture measures **~80 to 190 seconds**,
start to finish. Nothing about one run is slow. The half hour was the LOOP — the same run fired eight times in an
afternoon, each time followed by two hand-typed commands to clean up after it.

**Cost one: `--changed` could not see a shared component.** It hashed only the one or two files a screen names in
`source`, and said so in its own header. So editing one shared control component — which every frame of the canvas
renders — marked NOTHING as stale, and the only safe move was a full run: 33 screens captured to see 12 of them
differ. Fixed by following imports out from the declared entries:

```js
const entries = [...(screen.source ?? [])];
for (const file of filesReachedFrom(entries)) { /* hash the whole closure */ }
```

Measured: touching one shared status component now selects **19 of 33** screens and leaves 14 alone. Before, it
selected zero. The walker follows only project specifiers (`@/`, `./`, `../`) and ignores anything it cannot
resolve, because its failure mode has to be "recaptured something it did not need to", never the reverse.

**Cost two: a field that was never there.** The same fix added "a screen that pins a state also depends on the
file implementing it", written as `if (screen.state)`. It never fired once. The declaration reaches `capture.mjs`
**over the API**, and what the route serves has no `state` field at all — the pin arrives inside `url` as
`?canvas=<id>`. So the hole stayed open behind a line of code that looked like it had closed it, and rewriting a
fixture still changed a dozen pictures while marking none of them stale.

```js
if (/[?&]canvas=/.test(screen.url ?? "")) entries.push("design-canvas/project/states.ts");
```

**Generalise it:** when a script reads a declaration it did not load itself, print one record and look at it
before writing code against the shape you assume it has. A guard on a field that does not exist is worse than no
guard, because it stops anyone looking again.

**Cost three, and the honest limit.** Every full run leaves a handful of screens whose claims did not appear —
trap 19's shape, and trap 19 already records that waiting longer only reshuffles WHICH screens fail. So the run
now does the thing that actually works: whatever failed goes round again, **sequentially, after a 3 second pause**,
once the lanes have drained and `next dev` has stopped compiling. Measured, that recovers most of them (2 of 4,
then 3, then 2 of 2) and the run exits 0 instead of demanding two more commands. It prints which screens needed it,
because a screen that only ever passes alone is a fact worth seeing.

**And the cause was never open — I was ignoring the instruction.** `SKILL.md` step 5 opens with "**Against a
PRODUCTION BUILD, not the dev server**", carries the measurements (31 problems, then 22, a different set blank each
time, versus 2.4s a screen repeatable against a build), and gives the exact four commands. Every run behind this
trap was fired at `next dev`. So the retry pass is a seatbelt for a mistake, not a fix for a limitation: it earns
its place because a dev-server capture is genuinely convenient mid-iteration, but a canvas being proved for a
review is captured against a build.

**Generalise it:** when a tool keeps failing the same way, re-read its own instructions before improving it. Two
of the three costs in this trap were paid to work around a paragraph that was already written.

---

## 22. A list that stops at eight rows, but only when a person opens it

**Symptom.** The reviewer presses Open on a frame over a list and sees eight rows out of three hundred, with the
footer still reading the real total. Every capture and every oracle check is green. It reads as a product bug, and
it is the second time he has reported one like it: _"there is always a limit of showing maximum 8 quotes. but it
doesn't make sense. there are like 300 plus quotes there."_

**Cause.** A cap added so a DIALOG frame would not be photographed down to the fiftieth row behind it, gated on
"a canvas pin is on the URL". The Open button carries exactly that URL, so the cap fired for the person too. The
oracle's live pass cannot catch it: it asserts the frame's claims, and a capped list still carries them.

**Fix.** Reach for `oneViewport` first; frame height belongs to the capture. When app code must still render
differently for the photograph, gate it on `canvasCapturing()` (the starter states file), which reads the
`window.__designCanvasCapture` mark `capture.mjs` sets with `addInitScript`. `check-canvas.mjs` deliberately does not
set that mark, so its live pass sees the page exactly as Open does.

**Generalise it:** a pin says what state to open; it does not say who is looking. Anything that exists only to
make a picture sensible has to know it is making a picture.

## 23. A desktop frame laid out at a phone's width, inside a desktop-sized picture

**What it looks like.** A 1440x900 shot whose app is drawn in a ~600px column, carrying the mobile tab bar and no
sidebar, with the rest of the frame blank. Every claim passes, the shot is the right size, the manifest is happy.
The owner, on one of these: _"clearly a mobile screen while it had to be desktop"_.

**Cause.** `captureOne` resolved a screen's viewport as "its own `viewport`, else its `deviceViewport`, else null",
and on null it skipped `setViewportSize` altogether. Null is not "the canvas default" — the page keeps whatever the
PREVIOUS screen left it at. So the moment a canvas declares a `device: "phone"` frame, that frame sets 390 and every
desktop frame captured after it is laid out at 390 while its picture is still written at the canvas viewport. It
only ever bites a canvas that mixes devices, which is why two canvases in the same repo were clean and the third
was not, and why a later single-frame retry "fixed" some frames by accident: a fresh page starts at the context
default.

**Why nothing caught it.** Width was the only thing anyone measured, and the width was right — the shot really is
1440 wide. The claims are text, and the text is all present at 390. The stability check compares two passes of the
same wrong state. Only looking at the picture catches it.

**Fix.** The fallback is the canvas `viewport`, and `setViewportSize` runs for every screen. A guard before the
measurement compares `window.innerWidth` with the width the picture will claim and throws when they disagree, so a
layout/picture mismatch is a named failure instead of a silent frame.

**Generalise it:** a per-screen setting that falls through to "do nothing" inherits the previous screen's state.
One page, many screens, and anything set per screen has to be set on EVERY screen, including the default one.

## 24. A frame that proves its claim on the page behind the dialog, or on a skeleton

**What it looks like.** Three frames, one canvas, all green. A frame for the Add Charge dialog shows no dialog.
A frame for a quote the buyer VIEWED shows an expired one. A list frame shows eight shimmering rows and
"0 quotes". Every one passed its claims and came out identical twice. The owner, on the third:
_"Are you just randomly screenshotting some shit and telling me that it's true?"_

**Cause, and it is one cause.** Claims were matched against `document.body.innerText` — the WHOLE page.
So a dialog frame whose claim is the document behind it passes without the dialog opening; a frame claiming
"Viewed" passes on any quote, because "Viewed" is a filter chip in the list underneath; and a frame claiming
a title and column headings passes on a skeleton, because chrome paints before the rows arrive. The shutter's
own guards cannot help: a skeleton is steady, so "two identical frames" is satisfied, and nothing is in flight,
so "network quiet" is satisfied.

**Fix.** Claims are read from the OPEN DIALOG STACK when anything is open, and from the body when nothing is,
so a dialog frame can only be proved by what is in front of the scrim. Loading placeholders (`[aria-busy]`,
`[data-loading]`, `[data-skeleton]`, `.animate-pulse`) are waited out before the claims are read, and a frame
that never settles fails with that as its claim instead of photographing the placeholders. The canvas-wide
`forbid` reads the WHOLE document instead, because an overlay behind an open dialog is still an overlay in
the picture — while `expectMissing` stays on the frame's own surface, since it is the positive claim inverted
and the page behind an open dialog is full of other states' words.

**The stack, not its top, and that correction cost its own round.** Reading only the innermost dialog looks
tighter and puts a second unreachable surface in place of the first. An app whose editor IS a dialog, and which
opens the scanner over a brand-new document by design, left every claim about that document unprovable from any
route: the scanner was always the innermost thing open, so the composer's own sections could not be read from
anywhere. A frame whose subject is unreachable is worse than a loose claim, because no wording fixes it. The
stack is the surface.

**And the oracle has to read what the capture reads.** `check-canvas.mjs` re-proves every frame's claims on the
served app, and while it read `document.body` and the capture read the dialog stack, the two disagreed on every
dialog frame: the oracle reported "28 live URLs re-proved their claims" on a canvas whose capture had just
refused eleven of them. Change one scope and change the other in the same edit.

**Generalise it:** a claim has to be unprovable by the surface the frame is NOT about. Chrome that paints before
data is not evidence of data, and text behind a scrim is not evidence of what is in front of it. When you write
a claim, ask what else on the page could satisfy it.

---

## 25. Clear All offers to delete thirteen comments on a canvas whose hand-off says one

**Symptom.** The Hand Off panel reads "1 comment to send", the badge on the button reads 1, and the red
button beside them arms to "Delete all 13?". Nothing on the canvas accounts for the other twelve. The owner,
looking at it: _"where the hell the other 12 came from? Weren't they supposed to get deleted if they were
earlier attached to something which also got deleted."_

**Cause, and it is one sentence.** Every count on that panel is FILTERED, each filter added on the reviewer's
own feedback, and Clear All is the only thing that reads the raw array — so it was the only thing that could
see the records the filters had quietly stopped counting. Three kinds had accumulated:

- **A verdict whose option was deleted.** Retiring an exploration round removes its screens from the
  declaration; the capture then deleted their pictures and their manifest entries and left the verdicts. With
  no frame there is no pin, with no pin there is no Approve, and `spent()` in `canvas-view.tsx` drops them from
  the queue on purpose (a finished round must not read as a standing warning). Counted nowhere, removable by
  nothing.
- **A note consumed on a screen nobody recaptured.** The review queue asked for `consumedAt` AND `stale`, and
  `stale` is only set by a capture of that screen. A fix made in code without spending a capture — which is
  ordinary, and is often what the reviewer asks for — produced a comment that was out of the hand-off because
  it was consumed and out of the review bar because it was not stale.
- **A consumed verdict anywhere.** The queue excludes verdicts by design, and rightly: a like is not a
  question. So consuming one moved it into a set of size zero.

**Why nothing caught it.** Each of those exclusions is individually correct and each was written from a real
complaint. What nobody checked was whether the sets were EXHAUSTIVE, and they were not: the file had a fourth
place, and the only door into it was an irreversible button's arming step.

**Fix, and it is an invariant rather than a patch.** Every record is in exactly one of three places:

| | where it lives |
| --- | --- |
| unread | the hand-off, whether or not its screen still exists |
| consumed note | the review bar, whether or not the picture was retaken |
| consumed verdict, or anything answered whose screen is gone | deleted |

So: `toReview` no longer asks for `stale`; the route deletes a verdict when it is consumed; and
`sweepAnsweredComments` in `capture.mjs` removes an answered comment whose screen has left the declaration,
plus its annotated PNG. An UNREAD note still survives its screen and keeps travelling — that exception is
load-bearing and has its own history, two real notes that stopped being handed off when their options were
deleted. Deleting is only safe because `design-canvas/comments/.history` is now a git repository of its own,
committed on every write, so a removed record is a `git log -p` away.

**And the sweep is called from BOTH exits of the capture.** A declaration that lost a screen is exactly the
change where nothing needs recapturing, so the run takes the "nothing has changed" branch — which is where the
orphan prune had to be added for the same reason, one layer down, after deleted screens kept their pictures
forever. Anything that cleans up after a DECLARATION cannot live only on the path that captures.

**Generalise it:** when a view filters a set, the filters have to be exhaustive or the leftovers become
invisible work. Write down where every record is allowed to be, and make the destructive control count the
same sets the informative ones do — a number that only the delete button can compute is a number nobody has
checked.

## A comment on a screen that sits in several groups showed up on all of them

Today's design is the incumbent of every exploration panel, so the same screen is drawn once per panel. Pins
were matched to frames by screen id alone, so one outline drawn on it appeared on every copy, as many times as
there were groups, and the saved record named the first group that happened to hold the screen, not the one it
was drawn in. Owner, 2026-09-21: "whenever you use one screen and you put it on several groups and I leave the
comment to that one screen, it actually duplicates it as many as there are groups." Fixed at the source: the
frame passes the group it is drawn in (`groupId`) with every new comment, `belongsOnFrame` in
`comments-client.ts` decides which frame a saved comment belongs on (screen AND group; a record with no
`flowId` predates this and keeps showing wherever its screen is), and the focus jump prefers the frame of the
recorded group. Comments saved before the fix keep their first-group `flowId`; read the note, not the group.

## A share page written by hand drifted from the canvas in a dozen places

The first time the canvas was shared with the team, the page was an imitation written from memory: three
separate pills instead of one bar, a Fit button the canvas does not have, the zoom somewhere else, a reference
row of today's screens that the switch already shows, a hint floating over the canvas, a banner that wrapped
into a paragraph. Each one came back as feedback, five rounds of it, and the owner's verdict on the pattern
was "why reinvent new patterns?". The approved result is `tool/review/page.html`, and `review-build.mjs` only
fills its blanks (title, slug, owner, data). If the page looks wrong, fix the template in the skill and
reinstall; never write a share page for one project.

Two rules came with it. **The page is republished only when the owner says so**: it is the version the owner chose
to show, and one that followed every recapture would move the screens under the team's comments. And **a
publish after the first never carries `review.json`** unless it is an answer built on the live file read just
now: the first test lost the owner's comments to a reviewer's save built on an empty file, which is why the
page also refuses to comment when `review.json` fails to load.

