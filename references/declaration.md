# Writing the declaration

`design-canvas/project/flows.ts` is the only place screens are named. It imports nothing but the core's
types, so it is plain data an agent can produce by reading a repo's routes — and it is the whole of what
has to change when the app does. Adding a screen is one entry plus the edge that says how a person reaches
it.

## One screen

```ts
{
  id: "empty-store",            // stable. Renaming it orphans that screen's comments.
  label: "Nothing saved yet",   // brief, and about the same length on every frame
  note: "What it is FOR",       // not what it looks like — the frame shows what it looks like
  route: "/store",              // a REAL route, with any query the app already understands
  state: "nothing-saved",       // optional; names an entry in ./states.ts
  kind: "Empty states",         // groups it in Grouped screens. At least two screens per kind.
  source: ["app/store/page.tsx", "components/store/store-front.tsx"],
  expect: ["Nothing here yet", "Take a photo"],
  expectMissing: "Shop by category",   // the only oracle an empty state has — see below
  expectSelector: '[data-testid="cover"][data-filled="true"]',
}
```

**`expect` is the oracle for "this frame shows what its label claims."** It is text that must be present in
the settled page — one string, or a list of which all must be there. Two labels resolving to the same state
is the failure it catches, and it is the failure that actually happens: on the skill this replaces, two
frames were labelled "GemStudio Settings" and "Model Style" and both rendered the settings screen. The
canvas looked complete and was wrong, and the user found it rather than the build.

**Choose the claim from the page, never from the label.** Pages title-case, truncate and abbreviate; a
search page prints the query title-cased, and a product page may never print an item's internal code, because that code is the
seller's own reference. A claim written from the label is a claim about what you assumed.

Claims are searched in the frame's own document **and in every same-origin frame inside it**, because a
frame is everything rendered in it: a menu that draws a storefront in an iframe of its own can carry a
claim about a document one level down.

**`expectMissing` is what an EMPTY STATE proves itself with, and it is not optional there.** Every positive
string on a store with nothing in it is equally true of a store with everything in it — the business name is
on both — so `expect` cannot separate them and the tile can photograph the wrong state and pass. What
separates them is what the page does NOT say: no category strip, no collection band, no results row. Same
list rule as `expect`, same reach into nested frames, and the capture pushes it into the same claims array
so the manifest, the oracle and the failure line stay generic.

**`expectSelector`** is the same claim for a state with no words in it — a filled cover is a picture, and
which step a dialog is on is an attribute.

**`focus: "<selector>"`** is for the one frame in a flow where someone is TYPING. The capture blurs every
document before the shutter on purpose, so a frame of a field mid-use photographs as the resting design and
the state the tile claims is simply not in the picture. Declaring the field puts its focus back after the
freeze, caret at the end of the value, and asserts it — the caret itself stays invisible, so the two proof
shots still match. Do not reach for it anywhere else: an unasked-for focus ring is what this blur exists to
prevent.

**`source`** is one or two files: the route file, then the component that owns the surface. Once a frame is
a picture, "where does this live" is a question the picture cannot answer, and an agent asked to change
what is in the frame otherwise starts by hunting for it. Keep it short — a long list goes stale silently,
and the oracle asserts every path still exists on disk.

**NO TWO SCREENS MAY RESOLVE TO THE SAME ADDRESS AND STATE.** They photograph identically, and a reader has
no way to know the repetition was deliberate: they look for the difference, do not find it, and stop
trusting the canvas. It is a tempting mistake, because the reason for doing it sounds good — "the same
surface drawn again beside the others so the four variants can be compared" — and it survives review right
up until a designer reads it: _"I don't understand any of those screenshots. What are they supposed to show,
do we really need all of them?"_ One frame, one tile. A state worth seeing gets its own pinned state; if it
cannot have one, it does not need a tile. `check-canvas.mjs` fails on a collision. (An explanation frame is
outside this rule the only honest way — by having no address at all. See the section below.)

**Write labels and notes in the PRODUCT's words, never the tool's.** They are read by a designer, not by the
agent that wrote them. A canvas shipped with four tiles saying "slot", which was the internal name for the
box a cover goes in and a word the product's UI never used once: _"the language is just really weird. Like
what does the slot mean? We never used such words anywhere."_ Before writing a label, check the word appears
in the product itself.

**A group of one is not a group.** Every `kind` should hold at least two screens; a heading over one frame is
a frame with a heading on it. `check-canvas.mjs` fails on it. Do not sweep the leftovers into a bucket
called "Other" either — that is a heading over things that have nothing to do with each other. The order of
the groups is the declaration's order, so the kinds run in the same sequence as the journeys do.

**Unless the subject has no other section, and then you say so with `soloKind: true`.** The rule above is
aimed at a frame that was filed apart from a section it belonged in. When nothing else on the canvas is
about that subject, a section of one is honest and the alternative is worse: padding it with a near-duplicate
of the same screen. The owner, 2026-08-24, on an Organization settings group of one: _"the oracle should
fail when you have similar screens but for some reason you decide to put one in a separate section just WITH
THIS ONE screen, even though it could easily be a part of the existing section. in this situation there's no
other existing section about the org settings. otherwise you need a better screens than just the same one
with only avatar uploaded."_ The check cannot judge "could have joined" on its own, so the declaration
claims it. A solo group nobody claimed still fails.

## A step the app cannot show: the explanation frame

A journey does not end at this product's edge — a buyer pays on a hosted checkout this repo does not own, a
step happens on a phone, a confirmation arrives by email. Skipping the beat draws a product that skips a
step; drawing a stand-in for the third party's page is banned. The honest node is an EXPLANATION FRAME:

```ts
{ id: "stripe-checkout", label: "Stripe Hosted Checkout",
  explain: "The buyer enters an address and card on Stripe's own page. Tax is calculated from the
    address. Payment lands on the jeweler's account and Stripe sends the signed event back." },
```

The rules, every one enforced by `check-canvas.mjs`:

- `explain` is the body, `label` is the step's name, and there is NO `route` — nothing to open, nothing to
  photograph, so a route on one is a failure, not a convenience.
- Flows only. No `kind` (it never appears in the grouped screens), never inside an exploration.
- No `expect` and no `expectMissing`: nothing is captured, so nothing can be proved.
- Edges into and out of it follow the normal edge-label rules below. It is a real node on the path.
- The body is held to its own copy cap (about 45 words, up to four sentences) so it fits the fixed panel
  the flows view draws it in.

Three kinds of non-photographed step exist, and the panel chrome tells them apart (`explainKind`; the
oracle fails a panel whose rendered kind differs from the declared one):

```ts
// A third party's surface — not ours to draw. Neutral dashed panel, "Outside this app". The default.
{ id: "stripe-checkout", label: "Stripe Hosted Checkout", explain: "…" },
// Ours, in this product's flow, but not capturable from this repo (another repository, an email, the
// mobile app). Tinted dashed panel, "In this product, not capturable from here".
{ id: "buyer-order-page", label: "Buyer Order Status Page", explain: "…", explainKind: "product" },
// A BOUNDARY NODE: the step continues in another canvas of this project. Solid tinted panel,
// "Continues in the Quotes canvas" + a live "Open canvas" link. In-app crossings only.
{ id: "quote-complete", label: "Complete Order in Quotes", explain: "…", explainKind: "canvas:quotes" },
```

## A direction that needs more than one picture

One frame per direction is usually right, and sometimes it is not enough to judge one: a direction whose point is a
tab one click away has to show that tab shut AND open, or the reviewer is asked to imagine half of it. So a screen
can say it supports a direction, and the exploration draws it underneath:

```ts
{ id: "x-tab", label: "A tab in the picker", route: "…&explore=shelf-tab" },
{ id: "x-tab-open", label: "…with the tab open", route: "…&explore=shelf-tab&tab=store",
  under: "x-tab" },
```

Each direction becomes a COLUMN: the main frame on top, its supporting frames stacked beneath, the next direction
beside it. Only the main frame is numbered, and only the main frame carries the like and dislike, because a verdict
is about the direction rather than about one of its pictures. A supporting frame's `label` should say what it adds
("the tab open"), never repeat the direction's name.

## A set to compare, not a journey

Some groups only ever answer the grouped view's question: the same screen once per third-party provider, one
per locale, one per plan tier. Declared as a flow they turn up in the flow view too, as a row of frames with no
arrows sitting beside real journeys, and they read as one. So a flow can say it belongs to the grouped view
alone:

```ts
{
  id: "domain-providers",
  title: "Who manages the domain",
  note: "The record step once per provider we can name, so the marks can be checked",
  groupedOnly: true,   // drawn in Grouped Screens, absent from User Flows
  screens: [ /* … */ ],
  edges: [],           // nothing to move between
}
```

The screens are captured like any others and carry their own `kind`, which is what gives them their section in
the grouped view. The oracle counts each view's own population, so a canvas with one of these holds fewer
frames in User Flows than in Grouped Screens and that is not a failure.

## The flow graph

A flow is a **directed graph**, not a sequence. A screen can have several outgoing and several incoming
edges, and the edges that matter most are the ones that leave the happy path: a skip, a close, a store with
nothing in it. There is deliberately no way to declare "these are in a row" — the only way to say two
screens are connected is to name the move that connects them.

**The edge-label rule, enforced by `check-canvas.mjs` rather than trusted.** Before there was a rule,
"keep it short" produced labels like `a piece` — a noun sitting between two screens, explaining nothing.
The owner:

> "what does 'a piece' mean between two screenshots? usually, as I already mentioned, these connectors are
> about actions done on the previous screen that lead to the next screen. it can't be just a noun or some
> random word(s). also, you still need to follow the consistent amount of charachters for all such flows"

- An **action edge** says what the person DID on the screen the arrow leaves, starting with a present-tense
  verb from the closed list: `Presses`, `Opens`, `Answers`, `Finishes`, `Chooses`, `Picks`, `Adds`,
  `Makes`, `Searches`, `Waits`. Where the surface has a real button, the verb quotes it:
  `Presses Set up my store`. Nothing here invents product copy.
- A **condition edge** says what was TRUE, has no press behind it, and starts with `When`:
  `When no pieces exist`, `When no collections`. These are the branches.
- **Every label is 12 to 24 characters, across the whole canvas** and not merely within one flow, so thirty
  chips read as one system rather than as thirty separate decisions.
- The oracle fails the build on a missing label, a first word outside the list, or a length outside the
  range. Extending the verb list is a decision to make deliberately in `check-canvas.mjs`, not a way around
  a label that will not fit.

**There is no `back`.** Return edges were drawn once and deleted rather than restyled — 52 edges became 33,
and the reverse lane was the single biggest source of clutter for the least information. A Back button and
a breadcrumb are things every developer already expects. **An edge earns its place by saying something that
cannot be guessed from the frames themselves**, and left-to-right order already says "and then this one".

Two parallel edges that land on the same screen can be collapsed into one when both answers go to the same
place: saying it once is the honest and shorter version.

**In the flows view the frames carry no titles at all.** It reads picture → what the person did → picture.
Titles live in Grouped screens, where they are the only thing telling near-identical screens apart. That is
the owner's instruction, not a layout accident:

> "user flows don't need titles about screens. they need interaction explanation over the arrows, making it
> clear what has happened."

**Where on the screen the move starts: `origin`.** An action edge can additionally say WHERE the press
lives, by naming the control's exact visible text (`origin: "Mark as Shipped"`) or, prefixed `css=`, a
selector for a control with no text of its own. The declaration only names it — the CAPTURE measures it:
the spec is resolved on the live page into a rectangle written into the manifest, and a spec that resolves
to nothing or to more than one visible place **fails the capture the way a missed claim does**, so a
region can never quietly drift away from its control. On the flows view the measured regions appear
behind an **Origins toggle that rests off** (several tinted rings per frame read as overload on a simple
flow); switched on, each region is a numbered ring paired with its edge's label chip, hovering either
lights both, and the edge is re-drawn out of the ring's border so the arrow itself points at the control.
Origins belong on press edges whose control is visible in the picture — a condition edge (`When …`) has
no origin, and an explanation frame cannot own one. The oracle verifies every declared origin was
measured, every measurement is still declared, and one press of the toggle draws exactly one ring per
measurement.

## Explorations, while a question is open

An `explorations` entry is one design question and the competing answers to it. It is the same `CanvasScreen`
shape as everywhere else — real routes, real pinned states, real claims — with the differences that matter below.

**FIRST, THE TEST THAT DECIDES WHETHER THIS IS AN EXPLORATION.** The directions have to be different PATTERNS, and
today's design is not one of them. Both rules are in the skill's own "The two rules that decide whether it is an
exploration at all", both are the owner's, and a round that breaks either is thrown away rather than reviewed:
same-component-with-toggles is not an exploration, and a frame of the incumbent wastes a panel on what is already
in the permanent views. If the incumbent is a table, most directions must not be tables. A variations round
happens only when he asks for one plainly.

- **`surface` is the panel's heading, and it names the SCREEN rather than the exercise.** "The settings page
  while a sync is running", never "Option set A" and never the question on its own. A reviewer has to know what
  they are looking at before they can prefer one version of it: _"you clearly explain what this thing is
  supposed to be… the title of the group of the section has to be really clear."_ The question goes in `title`
  and is drawn underneath.
- **The options are NUMBERED from their order in `screens`.** The canvas draws 1..N on the frames because that
  is what a reviewer says out loud. Order them deliberately: the most conventional departure first and the
  boldest last, so reading left to right travels away from habit. THE INCUMBENT IS NOT OPTION ONE — it is not an
  option at all. This bullet used to say "the first option should be the incumbent or the most obvious answer",
  and that sentence is what produced a round whose first frame was the shipped design: _"there is no need to put
  how the design looks today in the exploration. Why would you do that? This is not an exploration."_

- **A screen is a DIRECTION, and its `label` is the direction's name.** "Run panel above the table", not "The
  integrations page". The label is what gets said out loud when choosing, so it has to name the difference
  rather than the surface. Titles are shown in this view for exactly that reason.
- **No edges, ever.** Directions are alternatives; an arrow between two of them would claim a person can move
  from one to the other, and only one of them will ever exist.
- **A round is an entry, not a nesting level.** Five directions is one exploration. Three variants of whichever
  won REPLACES it, with `round` naming which is which. A judged round is spent and comes off the tab: _"I do not
  need to see the old explorations from the first round. that's not how the exploration process works."_ (This
  bullet said the rejected round stays visible, which contradicted the skill's own rule and the quote behind it.)

Two or more screens, or there is nothing to compare, and the layout reports it as a problem rather than drawing
a panel headed by a question with a single answer under it.

**Write it expecting to delete it.** The two permanent views are handed to developers; an exploration is spent
the moment it is decided. When it goes, delete the entry, recapture (which prunes the pictures), and delete the
URL scaffolding that made the directions reachable — that scaffolding is marked
`DELETE WITH: the <question> exploration` rather than with the canvas folder, because it goes first.

The same rule as everywhere else still applies and is the easiest one to break here: **no two screens may
resolve to the same route and state.** Five directions all pointing at `/some/page` with no distinguishing
pinned state are five copies of one picture, and the oracle fails on it.

## Say what is missing, in the file

A canvas that pretends to be complete is worse than one that says what it misses, and the declaration's
own header is where those admissions belong — not a separate document that drifts. The kinds worth writing
down:

- **Surfaces that cannot be captured honestly.** A camera page inside a frame shows the camera blocked by
  the frame's permissions policy, which is a state no user is ever in. A frame showing a state the product
  does not have is the one thing this tool must never do, so that branch is named in a note and not drawn.
- **States with no URL flag of their own**, reached only by browsing inside another surface.
- **Viewports not covered.** The declaration supports one viewport per screen; if no phone screen is
  declared, say so.
- **Any frame drawn twice on purpose** — the same page appearing in two kinds so a component can be
  compared side by side — because otherwise it reads as a mistake.

## Pinning states

`project/states.ts` is the only file that may import the project's stores or data. It runs at **module
scope**, not in an effect, because a page that reads a store once into `useState` on mount or memoises a
selector with an empty dependency list will otherwise render the default while the frame claims a special
case — and nothing about the picture says so.

Write down the facts the pinning relies on, each verified in the code rather than assumed: which stores
persist and therefore have to be skipped or overridden, which are plain in-memory stores and therefore
free, and which data comes from a module-level array needing a dev-only setter. On the project this came
from, those three sentences were the difference between states that pinned and states that silently did
not.
