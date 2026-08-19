# The hard parts, unsolved

**One open problem, and it is the flow layout geometry** — section 1. It is the weakest part of the tool.
Section 2 is a solved one, kept as the record of what it cost, because the cost is the useful part.

Do not present the open one as solved, and do not start on it mid-build without saying so — it reshapes the
canvas enough to be its own decision.

## 1. The flow layout geometry

**The weakest part of the tool**, and never fixed:

> "The first-run flow is still eleven columns wide, so no single zoom shows both its shape and its screens.
> Nothing overlaps in it now, but it's long… the edges are honest now; the geometry isn't."

A long flow is a very wide strip. At a zoom where the shape of the diagram is legible, every frame in it is
a grey rectangle; at a zoom where the screens can be judged, the shape is off-screen. The sparse rows also
leave large empty areas inside a group's panel.

**What good would look like:** a wide flow readable as a whole _and_ at frame level without two different
zooms. The obvious candidate — wrapping a long spine into stacked rows — was not attempted because it
reshapes the diagram, and that is the owner's call rather than an implementation detail.

**What is already solved and must not be broken while fixing it:** no edge ever crosses a frame it does not
belong to. A frame only occupies its own column, so an edge between neighbouring columns can always go
straight across the gap; an edge spanning two or more columns takes the long way — down out of the bottom
of its frame, along a clear lane under the diagram, up into the frame it lands on, one lane per edge, with
the group's panel grown to contain the lanes. **Enforced, not eyeballed:** the oracle samples forty points
along every edge path in screen coordinates and fails if any point lands inside a frame that is not one of
its two ends. Any new layout has to keep passing that.

## 2. Viewport-height captures — SOLVED

Kept because how it was got wrong is more useful than the fact that it works.

Whole-page capture was built, proved, and then parked behind `CAPTURE_WHOLE_PAGES = false`, on a reading of
one remark — the owner interrupted a recapture with _"it takes way too long bro"_, which was taken to mean
the capture run rather than the agent's turnaround. It meant the turnaround. Meanwhile the canvas showed the
top 900px of a 4045px storefront and called it the design, and the first thing the owner asked when he
looked at it properly was _"what about fullscreen pages where it is important to show the full length?"_

**It is on now, and it is not a list of pages — it is a fact about each one.** If the document is
meaningfully taller than the viewport, the whole page is captured (`captureBeyondViewport` with an explicit
clip, the height recorded per shot); if it is not, one screen IS the design and a fixed-height overlay stays
900px. The canvas draws each frame at the size it was captured at.

**Three things fall out of it, and every one of them cost a round:**

- Everything below the fold must have ARRIVED before the shutter. Lazy images that a headless page never
  scrolls past are the old trap; the new one is components that only render on intersection.
- **Scroll-driven reveals photograph as white holes.** Full detail in `traps.md`, including why fixing it in
  JavaScript works when you test it and silently fails at the shutter.
- A note box anchored below its region can land a thousand pixels off-screen on a 4000px frame. The core
  caps the drop at 420px for exactly this reason.

**The cost that was correctly predicted:** very unequal frame heights inside a flow diagram, which makes
problem 1 worse. That is now the only open one.

## 3. A read-only canvas on a deployed URL — wanted, never built

Asked for mid-demo: the owner opened the canvas on the project's Vercel URL to show his team and got a 404.
That is the tool working as designed — the page and both routes 404 under `NODE_ENV=production`, because a
review tool has no business on a customer-facing deploy — and his call for that project was to leave it local:
_"right now in this prototype, no need to do it. that's okay if it's local."_

If a project does want one, the shape is settled and the constraint is the interesting part:

1. **An explicit opt-in flag, not `NODE_ENV`.** The page and the shots route gate on something like
   `NEXT_PUBLIC_CANVAS_PUBLIC=1`, so a deploy has to ask for the canvas rather than get it by accident.
2. **The captured screens served as static files.** The shots route reads them off disk, which is not
   dependable inside a serverless function; a deployed canvas serves them from the public directory instead.
3. **Commenting is OFF, and the canvas must say so rather than fail.** The comment layer writes JSON and PNGs
   into the repo and a deployed filesystem is read-only. A save that silently 500s is the worst version of
   this: the reviewer loses the outline they just drew. So the flag hides the comment tool and keeps the Open
   buttons, which is what a deployed canvas is actually good for — a team reading the surfaces and clicking
   through to real pages.
4. **Pinned states need their own flag on the deploy** (`NEXT_PUBLIC_CANVAS_PINS=1`), or every Open button
   lands on the route's default state rather than the state its frame shows.

## 4. What the canvas structurally cannot show

Not defects, but they belong in the honest list at handover:

- **A picture cannot be interrogated.** The single largest cost of capturing rather than mounting live
  pages. Truth is proved once, at capture time, and goes stale silently until the next capture.
  `check-canvas.mjs` catches a screen whose **address** changed against the declaration; it cannot catch a
  screen whose **design** changed. Recapture is a command someone has to remember to run.
- **Surfaces that cannot be captured honestly** — a camera page inside a frame shows the camera blocked by
  the frame's permissions policy, a state no user is ever in. Name it in the declaration and do not draw
  it.
- **States with no URL flag of their own**, reached only by browsing inside another surface.
- **Viewports.** The declaration supports one per screen. If no phone screen is declared, say so.

## 5. Two conversations that were deferred and never happened

Recorded because they are open, not because they are owed here:

- The owner twice deferred a wider discussion of "the commands and the user flow diagrams". The commands
  discussion never took place at all; the flows one happened only as specific defect reports.
- One instruction was never resolved: _"remove outline border from here"_, on an image the agent could not
  see. It removed the ring around the toolbar bar, flagged the guess three times, and asked whether the
  frame hairline or the handoff panel was meant instead. Never confirmed.

That agent's practice is worth copying: it said where it had to guess rather than pretending, and named the
alternative it had rejected and why. That is how the white-background question got settled correctly on the
second try.
