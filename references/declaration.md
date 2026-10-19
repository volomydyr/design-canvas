# Writing the declaration

`design-canvas/project/flows.ts` is the only place screens are named. It imports nothing but the core's types, so it is
plain data an agent can produce by reading a repo's routes, and it is the whole of what has to change when the app does.
Adding a screen is one entry plus the edge that says how a person reaches it. `core/types.ts` documents every field;
this file gives the rules and their reasons.

## One screen

```ts
{
  id: "empty-projects",         // stable. Renaming it orphans that screen's comments (see successors)
  label: "Nothing saved yet",   // brief, and about the same length on every frame
  note: "What it is for",       // not what it looks like: the frame shows that
  route: "/projects",           // a real route, with any query the app already understands
  state: "nothing-saved",       // optional; names an entry in ./states.ts
  kind: "Empty states",         // its section in Grouped Screens. At least two screens per kind
  source: ["app/projects/page.tsx", "components/projects/project-list.tsx"],
  expect: ["Nothing here yet", "Create a project"],
  expectMissing: "Recent projects",    // the only proof an empty state has, see below
  expectSelector: '[data-testid="cover"][data-filled="true"]',
}
```

**`expect` proves that the frame shows what its label claims.** It is text that must be present in the settled page:
one string, or a list of which all must be there. Two labels that resolve to the same state is the failure it catches,
and it is the failure that really happens: two frames with different labels that both render the same screen look
complete and are wrong.

**Choose the claim from the page, never from the label.** Pages title-case, truncate and abbreviate; a search page
prints the query title-cased, and a detail page may never print an item's internal code. A claim written from the label
is a claim about what you assumed.

**A string the app fills in at run time is claimed as the page prints it**, never with its placeholder: the locale's
`Type {confirmation} to confirm` is claimed as `Type RESET to confirm`, and the preflight matches it against the template.
When the filled-in part is set in its own element, the page's text may not hold the sentence in one piece; then claim the
fixed words on each side as separate strings.

Claims are read from the frame's own surface: the open dialog stack, with menus and popovers in front of it, or the body
when nothing is open (`SURFACE_TEXT` in `steps.mjs`), in the page and in every same-origin frame inside it. So a dialog
frame is proved only by what is in front of the scrim.

**`expectMissing` is how an empty state proves itself, and it is not optional there.** Every positive string on an
empty list page is equally true of the same page full (the page title is on both), so `expect` cannot separate them.
What separates them is what the page does not say: no filter strip, no recent band, no results row.

**`expectSelector`** is the same claim for a state with no words in it: an uploaded image is a picture, and which step a
dialog is on is an attribute.

**`focus: "<selector>"`** is for the one frame in a flow where someone is typing. The capture blurs every document before
the shutter, so a field mid-use would photograph as the resting design. Declaring the field puts its focus back after the
freeze, caret at the end of the value, and asserts it. Do not use it anywhere else: an unasked-for focus ring is what the
blur exists to prevent.

**`source`** is one or two files: the route file, then the component that owns the surface. A picture cannot answer
"where does this live", so an agent asked to change a frame starts here. Keep it short; the preflight and the oracle fail
a path that does not exist, and the capture follows its imports to decide when the frame is out of date. A frame of a
dialog, sheet or menu lists that surface's own file: the preflight's note "Reachable but not on the canvas" names every
such surface, and every address linked or navigated to, that the declared screens' files reach and no frame shows.

**No two screens may resolve to the same address and state.** They photograph identically, a reader looks for the
difference, does not find it, and stops trusting the canvas. A state worth seeing gets its own pinned state, steps or
network rules; if it cannot have one, it does not need a frame. The oracle and the preflight fail a collision. Steps and
network rules count as part of the address.

**Write labels and notes in the product's words, never the tool's.** They are read by a designer. Before writing a
label, check the word appears in the product itself.

**A group of one is not a group.** Every `kind` holds at least two screens, and the oracle fails one that does not. Do not
sweep leftovers into an "Other" bucket either. The groups run in declaration order. **`soloKind: true`** is for the
subject that has no other section: a section of one is then honest, and padding it with a near-duplicate would be worse.
A solo group nobody claimed still fails.

**`flowOnly: true`** draws a screen in the user flows only. A journey has edge cases a user rarely meets; they belong on
the path, and a dozen near-identical edge cases side by side in Grouped Screens stop being comparable.

## Holds for an app as it really is

The capture refuses pictures that look broken. A few real states look broken on purpose, and the screen says so:

- `brokenImages: true`: images here never load because the app is broken there, and the broken image is the finding. A
  flagged screen where every image loads fails, because the flag is out of date.
- `sparse: true`: the page is genuinely under the blank-page floor (one gray line on white). Its claims still have to
  pass.
- `animated: true`: the surface never settles by design (a pulsing skeleton, rows whose video plays), so the
  two-identical-shots proof is impossible. One shot is accepted; every other check still applies.
- `oneViewport: true`: photograph one viewport and stop. For a data table whose inner scroller is the design; without it
  the capture grows the window to open an inner scroller and photographs every row. Also for a dialog over a long page,
  when the page around it is not the point: without it the frame is the whole page with the dialog in its middle.
- `frozen: true`: the state no longer exists in the app, and the picture on file is its last true photograph. The capture,
  the drift note and the live Open check all skip it.

How tall a picture is belongs to the capture: above 1.1 viewports the whole page is photographed (capped at 8000px),
otherwise one screen.

## Overlays: `forbid` and `dismiss.json`

A real app brings back its first-run and promo overlays in the capture browser, because their dismissals live in
localStorage and the capture origin has dismissed nothing. Two tools, used together:

- **`forbid`** on the canvas lists overlay text that must appear on no frame ("Welcome to", "Don't show this again").
  It is read from the whole document, so an overlay behind an open dialog still counts, and every polluted frame fails.
- **`design-canvas/dismiss.json`** says how to get rid of them, and the capture and the oracle both do it. Two kinds of
  step: a `localStorage` seed planted before the app's scripts run, and a `click` on a button by its exact accessible name
  (`within` narrows it to a CSS selector), pressed if it is showing and skipped if not.

```json
{ "*":        [ { "localStorage": { "promo-dismissed": "1" } } ],
  "trips":    [ { "click": "Got it" }, { "click": "Maybe later", "within": "[role=dialog]" } ] }
```

`"*"` applies to every canvas, a slug to that canvas only, and a bare array is `"*"`. Both tools print which clicks fired.
The file is the project's own: never overwritten by an install, and committed with the canvas when the canvas is shared. Next's dev indicator needs no step; the capture
hides it before every shot.

## Devices: `device`, `devices` and `twin`

A canvas can hold desktop and phone screens. `device: "phone"` on a screen puts it on the phone; absent means desktop.
The viewport comes from `devices` on the canvas (`{ phone: { w: 390, h: 844 } }`; desktop falls back to `viewport`), so a
phone screen has no `viewport` of its own. A switch above the tabs picks the device and filters every view and its
comments; it appears only when both devices have screens. A phone screen's label does not say "phone".

`twin: "<id>"` names the same screen on the other device. It is declared on either side, once, and draws a jump button
under the frame. Absent is the ordinary case: either device can have designs the other does not.

`viewport` on a screen is for a genuine one-off. A viewport that keeps the canvas's width and only raises its height is
refused, because it pads the frame past any real window.

## A step the app cannot show: the explanation frame

A journey does not end at this product's edge: a person signs in on an identity provider's page, a step happens on a phone, a
confirmation arrives by email. Skipping the beat draws a product that skips a step, and a stand-in for a third party's page
is not allowed. The honest node is an explanation frame:

```ts
{ id: "provider-sign-in", label: "Provider Sign In",
  explain: "The person signs in with a work account on the provider's page, then comes back to the trip list." },
```

The rules, every one enforced by the oracle:

- `explain` is the body, `label` is the step's name, and there is no `route`: nothing to open or photograph.
- Flows only. No `kind`, never inside an exploration.
- No claims: nothing is captured, so nothing can be proved.
- Edges into and out of it follow the normal edge-label rules.
- The body has its own copy cap (about 45 words, up to four sentences) so it fits its panel.

`explainKind` says which of three truths it is, and each has its own chrome (the oracle checks the rendered kind):

```ts
// A third party's surface, not ours to draw. Neutral dashed panel, "Outside this app". The default.
{ id: "provider-sign-in", label: "Provider Sign In", explain: "…" },
// Ours, but not capturable from this repo (another repository, an email, the mobile app). Tinted dashed panel.
{ id: "trip-email", label: "Trip Confirmation Email", explain: "…", explainKind: "product" },
// A boundary node: the step continues in another canvas of this project. A white card with an Open Canvas button.
{ id: "trip-complete", label: "Finish in Trips", explain: "…", explainKind: "canvas:trips" },
```

Use `"canvas:<slug>"` for real in-app crossings only; it is how canvases connect instead of duplicating each other.

## Before there is code: `wireframe`, `still` and `opens`

When the question is how a whole area should be shaped, building directions into the app is the wrong first spend. Draw
them as lo-fi HTML (black and white, rectangles, real copy, hierarchy in size and weight only), serve them from a folder
outside the app, and declare each as a `wireframe`:

```ts
// On the canvas: where the static files are served.
wireframeBase: "http://localhost:3070",
// On the option: the file, and nothing that points into the app.
{ id: "tasks-landing-a", label: "Three pages, the list first",
  note: "Projects, Tasks and Reports as sidebar pages; the overview table lands first",
  wireframe: "tasks-landing-a.html", expect: ["Due Today", "Awaiting review"] },
```

- No `route`, no `source`, no `kind`. The frame draws a Wireframe pill where Open would be, and the oracle skips its live
  pass.
- `expect` still applies: the claims are the words on the wireframe.
- The picture is stamped with the served HTML's hash, so editing the file recaptures it.
- It belongs on the exploration tab as an option. It is never what `original` or `redesigns` names.
- The static server is the project's business (a twenty-line node file beside the HTML is enough).

**`still: true`** marks a `wireframe` URL that is a still of the real app: a page holding one screenshot, taken by driving
the running app into a state no URL reaches. It is what a `redesigns` points at when today's state has no route of its own.
Its pill reads Still; it has no Open; its claims are proved against the served page. Old code needs pictures to compare
against, not pins.

**`opens: "<url>"`** gives a still an Open button: the full address of a running app that shows this state, when one
exists elsewhere (another branch's dev server). It is not re-proved by the oracle.

## The switch to today's screen: `redesigns`

Every exploration frame carries a switch that flips it in place to the screen it redesigns: the picture becomes today's
shot at the frame's size, the caption reads "Today: …", and a second press brings the option back. So every exploration
screen says which screen that is, in the same state, or `null`:

```ts
{ id: "ov-task-edit", label: "Edit a Task", wireframe: "ov-task-edit.html",
  under: "ov-tasks", redesigns: "task-edit-dialog", expect: ["Edit", "Due date"] },
```

- `redesigns` names a screen the permanent views draw; the preflight and the oracle fail a missing one, an unknown id, and
  one that names an exploration frame.
- It is the same state, never the nearest page: an empty tab flips to today's empty tab, a dialog to today's dialog.
- `null` means today's app has nothing like this frame. The frame then draws no switch, and every preflight lists it, so a
  missing before is never silent.
- A link is never dropped. The capture records each frame's link in the manifest (`today`); a frame that had one and now
  declares `null` or nothing fails with the id to put back. A frame that becomes something today's app never had gets a
  new id, and a frame named in `successors` inherits the link of the one it replaces.
- So every state an option is drawn in has to exist in today's app as a captured screen, by URL, steps or a still. That is
  most of the work on a large round.

## A state no URL reaches: `steps`

A dialog opened by local state, a menu, a tab, a field with something typed in it has no address. A `?canvas=` pin for it
puts a review-only flag in the app's code (a local line, which no commit carries, but which every update of the file must
fit around), worth it for a state the redesign keeps and wasteful for old code photographed only to sit beside a redesign. So a screen may say what a person does before the shutter:

```ts
{ id: "task-edit-dialog", label: "Edit a Task", note: "The dialog today", route: "/tasks",
  steps: [
    { closeWelcome: "Got it" },                       // a first-run dialog, pressed only if it is showing
    { click: "Edit" },                                // a control by its accessible name
    { waitText: "Edit Task" },                        // until this text is on the open surface
  ],
  expect: ["Edit Task", "Due date"] },
{ id: "task-title-typed", label: "A Title Typed In", note: "The field filled and confirmed", route: "/tasks",
  steps: [
    { click: "Edit" },
    { fill: "Title", with: "Call the venue" },        // a field by its label, placeholder or accessible name
    { press: "Enter", on: "Title" },                  // a key, optionally in a field
    { waitText: "Saved" },
  ],
  expect: ["Saved"] },
```

- **Eight types.** `click`, `fill` (with `with`), `press` (with `on`), `waitText`, `closeWelcome`, `hover`, `scroll` (with
  `to`) and `waitFor` (with `seconds`). An unknown type, two types in one step, a key a type does not take, or more than
  twelve steps throws, with the screen and the position, in the capture, the oracle and the preflight.
- **`click` finds a button, link, tab, menu item, option, checkbox, radio or switch by its exact accessible name.** `role`
  narrows it, `within` (a CSS selector) scopes it, `nth` (from 0, or `-1` for the last) picks one. Several matches and no
  `nth` is an error.
- **A target is a name or a selector.** `click`, `fill`, `hover`, `scroll`, `waitFor` and `press.on` take an accessible
  name or `css=<selector>`, handed to Playwright's CSS engine (`css=[data-testid=new-task]`, `css=button:has-text("Save")`).
  Names come first because a design is judged by what a person reads; selectors exist because an app's controls are often
  found only by a test id. `role` is refused on a selector.
- **`hover` leaves the pointer on its target**, so a hover state or a tooltip's trigger is what the picture shows. Wait for
  a delayed tooltip with `waitFor`, not with a clock.
- **`scroll` brings its target to the top of what scrolls around it.** With `to`, the target is the scroller and is set to
  that many pixels from its top.
- **`waitFor` waits until an element is showing**: 30 seconds unless `seconds` says (1 to 300). A press already waits ten
  seconds for its own target.
- **A step that cannot be done is final.** Nothing there, two there, the text never came: the capture lists it apart from
  failed claims, keeps the picture on the canvas, and does not run it again. Capture the frame alone with `--only <id>` to
  tell a stale declaration from a slow server.
- **`waitText` reads the same surface the claims do.**
- **`closeWelcome` is a condition, not a press**: with a string it presses that button if it is showing; with `true` it
  performs the click steps of `dismiss.json`.
- **The capture and the oracle's Open pass run the same steps** through `steps.mjs`. The claims are about the page after
  them, and editing a screen's steps recaptures it.
- **Open lands on the route**, because nothing in the app knows what was pressed. Its hover text says what to press, and the
  `note` should too. A frame whose `opens` names a link that lands in the state goes there instead.

## What the page's data does: `network`

A list that is loading, one that failed to load, one with nothing in it and a save the server refused exist only while the
data is late, refused or empty. A screen says what its page's data requests do while the picture is taken, and nothing in
the app has to know:

```ts
{ id: "tasks-loading", label: "Tasks Loading", note: "The list while it loads", route: "/tasks",
  network: [{ hold: "TaskList" }],                               // never answered: the loading state
  expect: ["Tasks", "Loading tasks"] },
{ id: "tasks-error", label: "Tasks Not Loaded", note: "The list when the read fails", route: "/tasks",
  network: [{ fail: "TaskList" }],                               // a GraphQL error: the failed state
  expect: ["Could not load tasks"] },
{ id: "tasks-empty", label: "No Tasks Yet", note: "The list with nothing in it", route: "/tasks",
  network: [{ answer: "TaskList", data: { taskList: { data: [], totalRecords: 0 } } }],
  expect: ["No tasks yet"], expectMissing: "Task 1" },
{ id: "archive-refused", label: "Archive Refused", note: "A save the server refused", route: "/settings", steps: [ /* ... */ ],
  network: [{ answer: "ProjectArchive", data: null, errors: [{ message: "refused" }] }],
  expect: ["Could not archive"] },
{ id: "projects-loading", label: "Projects Loading", note: "A REST list while it loads", route: "/projects",
  network: [{ hold: "/api/projects" }],                          // any fetch or XHR whose address contains /api/projects
  expect: ["Loading projects"] },
```

**A capture never writes, by default.** Every context a tool opens aborts every write no rule answers: a mutation, an
operation whose type cannot be read, and any request that is not GET, HEAD or OPTIONS (uploads, REST calls, server actions,
popups, service workers). Only the canvas's own API gets through, plus any address containing a part listed in
`allowWrites` in `design-canvas/settings.json` (a POST that only reads, such as a session check). Each blocked request is
named once and the run ends with the count. A capture against a shared account would otherwise leave records that look like
real activity. A canvas for a throwaway sandbox nobody else uses may declare, once:

```ts
export const CANVAS = { /* ... */ network: [{ writes: "allow" }], flows: [ /* ... */ ] }; // saves reach the server
```

- **Four rules, one key each.** `hold` (never answered), `fail` (a GraphQL error; `message` is the text the app may print),
  `answer` (with `data`, `errors` or both) and `writes` (canvas level only). At most twelve rules; an unknown rule, two kinds
  in one rule, an operation named twice, `writes` on a screen, or an `answer` with nothing to answer throws, in the capture,
  the oracle and the preflight.
- **A value with a `/` names part of an address** instead of an operation and matches any fetch or XHR whose address
  contains it, whatever its method. `fail` answers it with HTTP 500, `answer` with HTTP 200 and `data` as the body. A
  request the app's server makes (a server component's fetch) never passes through the browser and cannot be held; pin that
  state in the app instead.
- **An operation is named the way the app sends it**: the request's `operationName`, or the name after `query` or
  `mutation` in its document. Exact and case sensitive. A request with no name, a persisted query with no text and a batch
  cannot be matched.
- **A screen's own rule is a claim: the page must ask for the operation.** A hold that matches nothing would photograph the
  live list under a Loading label, so a rule the page never triggers fails the frame. The canvas-wide rules prove nothing.
- **The rules go on the frame's own page**, so one frame's held request cannot reach a frame in another lane. A held
  request is aborted before its page closes, because a browser releases what it still holds when the page goes away.
- **A frame with a hold does not wait out the loading placeholders it asked for.** A frame that fails or answers a request
  still waits for them.
- **Rules are part of the picture's identity**: a loading, an empty and a failed list share one route and are three
  pictures. Editing a screen's rules recaptures it.
- **Service workers are blocked** whenever a frame or the canvas declares rules, because a worker answers from itself.
- **Open's hover text says so**: "The picture holds back, fails or answers some of the page's data". Open lands on the real
  page, where the real data answers.
- **What lanes still share** is the browser's storage and cookies. An app that persists query results, or steps that persist
  a view choice, can leave it for another lane's frame (trap 43); `--lanes 1` shows whether that is the cause.

## Variants of one component: `variants`

Comparing several variants of one component needs one in-app route that reads `?variant=` and one frame per value. Say it
once, on the screen:

```ts
{ id: "filter", label: "Filter Bar", note: "One shape of the filter bar", route: "/lab/filter",
  variants: ["chips", "tabs", "menu"],          // or a count: variants: 4  (1, 2, 3, 4)
  expect: ["Filter bar", "Shape {variant}"], source: ["app/lab/filter/page.tsx"] }
```

The declaration expands, in place, into one ordinary screen per variant:

| | |
| --- | --- |
| id | `filter-chips`, `filter-tabs`, `filter-menu` (a count gives `filter-1` to `filter-4`) |
| route | `/lab/filter?variant=chips` (joined with `&` when the route already has a query) |
| label | `Filter Bar Chips` (each word capitalized; the six-word cap applies to the whole label) |
| everything else | inherited: `kind`, `note`, `source`, `state`, `steps`, `redesigns`, `expect`, `sparse` and the rest |
| `{variant}` | in `expect`, `expectMissing` and `expectSelector`, replaced by the frame's own name |

- **The app owes one thing**: the route reads `?variant=` and renders that variant.
- **Each variant is an ordinary frame**: captured, stamped, claimed, commented on, opened at `?variant=<name>`. The oracle
  adds one rule: two variants that come out as the same picture fail, because the page ignores the parameter.
- **They sit together** in declared order, in the flow, section or exploration that holds them; in an exploration they are
  numbered like options.
- **Two to twelve variants, named with lowercase letters, digits and dashes.** A duplicate, a name with a space, a route that
  already carries `?variant=`, a `twin`, and a wireframe, still or explanation frame are refused.
- **A variants screen draws no arrows.** An arrow, `under`, `suggests`, `redesigns`, `twin` or `original` that names the
  expanded-away id (`filter`) is refused, with the frames to name instead.
- **Adding a variant is one more name**; existing frames keep their ids and their comments.

Every reader goes through one function, `expandVariants` in `core/variants.ts`, so none of them can disagree.

## A frame that leaves: `successors`

Removing or promoting a frame leaves the comments pinned to it with no picture to show them on. The declaration names
where they go, at the canvas's top level:

```ts
successors: {
  "x-option-2": "ov-tasks",        // the promoted option's comments move to the permanent frame
  "retired-tab": null,             // answered notes released on purpose; never an unread one
},
```

- **The capture moves them before it does anything else.** The pin keeps its rectangle, its words, its thread and its
  consumed state; `movedFrom` records where it sat.
- **A frame that is gone with a live note and no entry refuses the run**, in the capture (exit 2, nothing touched), the
  preflight and the oracle, each naming the frame and the ids. A like or a dislike is not a live note: a verdict goes with
  the option it judged.
- **`null` is for answered notes only.** Drain an unread note first (`drain.mjs`). A chain (`a: "b"`, `b: "c"`) is followed
  to the frame that is still declared.
- **An entry is data about the past** and may stay for ever; the preflight says when one has nothing left to move.
- **A rename keeps its review state.** The capture moves the frame's place in the waiting queue to its successor.
- **Leaving the frame in place is always allowed** until the reviewer has approved the comments on it.

## Explorations

An `explorations` entry is one design question and the panel that answers it. Its screens are the same `CanvasScreen` shape
as everywhere else: real routes, wireframes or stills, real claims. How rounds are run is in SKILL.md.

```ts
explorations: [{
  id: "task-list-shape",
  surface: "The task list while a sync is running",   // the panel heading: what the screen is
  title: "Where does the sync's progress live?",       // the question, drawn under it
  note: "What is at stake in the choice",
  round: 1,                                            // a counter, nothing more
  original: "tasks-syncing",                           // today's screen, from the permanent views
  screens: [ /* options, their steps, and what hangs beside them */ ],
}]
```

- **`original` is required**: the id of today's screen, from the permanent views. The switches and the oracle read it. The
  panel draws it as a frame of its own only when something hangs under it (`suggests: "<original id>"`), at the top, before
  every option; otherwise each option's switch shows today's same state. The oracle fails a missing or unknown `original`.
- **`mode` is normally left out.** The preflight reads the files `original` reaches: data calls or mutations, server
  actions, route handlers, stores or permission checks put the exploration in real-code mode, none of them in simple mode,
  and one `mode:` line says which and why. Set `mode: "real-code"` only when the reviewer says so. Simple mode over files
  that hold real logic counts only on the reviewer's words, recorded by `parity.mjs --canvas <slug> --exploration <id> --mode
  simple --said-file <path>`; a `mode: "simple"` written in the declaration over such files is ignored, and the mode line says
  so. An `original` with no `source`, or one that is no screen of the canvas, is a preflight problem until it is fixed or
  simple mode is recorded that way.
  In real-code mode every option lists its file in `source`, draws over the original's hooks, handlers and data (an option
  file with data calls of its own is refused), and the chosen one is folded into the original's files. The parity check
  (`parity.mjs`) then compares those files with the commit the exploration was first captured at and fails the round on
  any lost behavior: a condition or gate, a handler (one that only forwards, `() => onDelete()`, is that function), a door,
  a field and its literal attributes (`type`, `required`, `action`, `method`, `target`), a translation key, a rendered
  component whose own file does something, a prop given to such a component or named for behavior (`value`, `disabled`,
  `open`). Layout is free: element types, nesting, a table that becomes cards, a list drawn another way, a renamed local,
  and props given to components that only draw pass. Code left in a declaration nothing uses counts as removed. A piece of
  logic that moved to another file gets an entry in `project/parity-exceptions.json`, which must name where it is now:
  `{ "exploration", "file", "kind", "unit", "movedTo": "<file>:<line>", "why" }`, with `unit` as the check printed it. An
  entry without `movedTo`, one whose file today's screen does not reach, or one whose line does not hold the unit, is
  refused. A behavior the reviewer asked to remove is a removal entry, `{ "exploration", "file", "kind", "removed", "said" }`,
  written only by `parity.mjs --canvas <slug> --exploration <id> --remove <file:line[#n]> --said-file <path>`, the file
  holding the reviewer's exact words as they said them in conversation (`--said-from <comment id>` takes the words of one of
  their canvas comments instead); one with no words is refused, and an agent never writes one on its own. Words never go
  inside the command line, where their quotes or `$(` would be run by the shell. Every removal and simple-mode entry carries
  `sig`, a digest of its exploration, unit and words keyed by a secret this machine keeps beside its answers file (outside
  every repository): an entry written or changed by hand, by any route, is refused by the check, naming the command. On another
  machine the entries need recording again there.
- **`surface` names the screen, not the exercise**: "The settings page while a sync is running", never "Option set A".
  The question goes in `title`.
- **Options are numbered from their order in `screens`**, because a reviewer says "number three" out loud. Order them from
  the most conventional departure to the boldest. A screen's `label` names the direction ("Run panel above the table"), not
  the surface, and its `note` says what makes it different from its neighbors.
- **No edges.** Options are alternatives; only one of them will ever exist.
- **`round`** is a number, or `"refined"`. No words are built from it; the tab has no round heading.
- **`pages: true`** marks a panel that walks several pages of one area, a page per row with its surfaces beside it under
  `under`. Its rows are not a choice, so they carry no number and no verdict.
- **Two or more options**, or the layout reports a problem.
- **No two screens may resolve to the same route and state**, here as everywhere: five options pointing at one page with no
  distinguishing state are one picture five times.
- **Scaffolding that makes an option reachable** is marked `DELETE WITH: the <question> exploration`, because it goes
  before the canvas folder does. In an app file it is a local line too (`design-canvas:local`), so no commit carries it.

### An option that needs more than one screen: `under`

A direction whose point is a tab one click away has to show the tab shut and open, and a direction built on progressive
disclosure is a journey, sometimes 5 to 10 screens or more. Never squeeze a journey into one frame. A screen says which
option it belongs to with `under`, and the option's screens (itself, then everything under it, in declared order) are its
flow:

```ts
{ id: "x-wizard", label: "A guided setup", route: "…&explore=wizard" },
{ id: "x-wizard-2", label: "Choose the plan", route: "…&explore=wizard&step=2", under: "x-wizard" },
{ id: "x-wizard-3", label: "Confirm and finish", route: "…&explore=wizard&step=3", under: "x-wizard" },
```

One screen per option draws the options side by side in one row. Any option with steps, or any suggestion or reference
hung in the panel, turns the panel into stacked rows, one per option, its screens left to right, with what hangs under a
frame below it in its row. Only the option's first frame is numbered and carries the like and dislike. A
step's `label` names the step, never repeats the option's name. `under` is one level deep; the preflight fails deeper.

When one round carries variations of several parents, order `screens` parent by parent and name the parent in each label
("Timeline: …"), so the panel reads as one row per parent.

### What hangs beside a frame: suggestions, references, notes and evidence

A panel can hold more than options. These are drawn beside the frame they are about, never numbered, never given verdicts,
never counted as options, and never deleted when a round changes:

- **`suggests: "<frame id>"`**: a proposed change to a frame of the same panel (the `original` included). Drawn right under
  that frame, in its column, tinted pale yellow with a yellow edge so it never reads as the design that was shown, named
  "Suggestion:", with nothing under it (no switch, no pill, no file badges). Several stack downward. A suggestion of several
  screens is one row: the first `suggests` the frame, the rest add `under: "<first id>"` and run to its right.
- **`reference: true`**, with `suggests`: hangs in the same place, but it is something to compare against (today's
  structure, another system's), so it takes no tint and no "Suggestion:" name.
- **`marks`**: boxes on the frame around exactly what changed, in orange, as fractions of the frame (measured from the
  served page, never typed), a word or two each.
- **`sticky`**: a few words on a note beside the frame; `stickyOn` (an index into `marks`) joins it by a line to the box it is
  about. A reviewer's own words go on it in quotation marks, verbatim.
- **`evidence`**: other systems' real screenshots beside the frame, under its note, each `{ file, w, h, name, source?,
  caption?, marks? }`. The file lives in `design-canvas/evidence/<slug>/`, cropped to what matters; the tile shows the
  system's name and opens large with its source and caption.
- A diagram that explains a suggestion is its own small wireframe page (shapes and lines, black and white), hung the same
  way.

A suggestion is understood only where it sits on the frame it changes. Never a board of text, never a separate section of
suggestions, never free-floating arrows. A frame that should simply be kept or dropped gets a note, a mark and its
evidence; its picture is not redrawn.

## A set to compare, not a journey: `groupedOnly`

Some groups only answer the grouped view's question: one screen per provider, per locale, per plan. As a flow they would
show up in User Flows as a row of frames with no arrows, beside real journeys. So a flow can say it belongs to the grouped
view alone:

```ts
{ id: "locales", title: "Every language",
  note: "The welcome step once per locale, so the copy can be checked",
  groupedOnly: true, screens: [ /* … */ ], edges: [] }
```

The oracle counts each view's own population, so User Flows then holds fewer frames than Grouped Screens.

## The flow graph

A flow is a directed graph, not a sequence. A screen can have several outgoing and incoming edges, and the edges that
matter most leave the happy path: a skip, a close, a list with nothing in it. The only way to say two screens are connected
is to name the move that connects them. In the flows view the frames carry no titles; it reads picture, then what the
person did, then picture.

**The edge-label rule, enforced by the oracle.**

- An **action edge** says what the person did on the screen the arrow leaves, starting with a present-tense verb from the
  closed list `EDGE_VERBS` in `copy-rules.mjs` (`Presses`, `Opens`, `Chooses`, `Adds` and the rest). Where the surface has
  a real button, the verb quotes it: `Presses Create account`.
- A **condition edge** says what was true, with no press behind it, and starts with `When`: `When no items exist`.
- **Every label is 12 to 24 characters, across the whole canvas**, so the chips read as one system.
- **There is no `back`.** A Back button is something every developer expects; an edge earns its place by saying what the
  frames cannot. Two parallel edges to the same screen can be one.
- **A flow is connected by actions.** A chain joined only by `When …` conditions is a set of states, and states belong in
  Grouped Screens. The oracle fails a flow with edges and no action edge.

**Where the press is: `origin`.** An action edge names the control pressed, by its exact visible text
(`origin: "Mark as Done"`) or by `css=` and a selector. The capture measures it into a rectangle in the manifest, and a
spec that resolves to nothing or to more than one visible place fails like a missed claim, so the region cannot drift. A
rectangle outside the picture is refused too. In User Flows, a toggle beside the view tabs (shown when the view has a
measured origin, off by default) draws each region as an orange highlight and starts its edge from it.

**Every action edge carries `origin` or `noOrigin: "<one short reason>"`**, and the oracle refuses neither. The honest
reasons: the control is behind a closed menu, the same text is in the picture twice, the edge leaves an explanation frame,
or the source frame is frozen. A condition edge carries neither, and the oracle refuses an origin on one.

**An origin is measured by the capture of the frame the edge starts from.** So a new or changed edge means recapturing
that frame too, not only the one it leads to: `--only` names both. Until then the oracle refuses the origin as never
measured.

## Say what is missing, in the file

A canvas that says what it misses is worth more than one that pretends to be complete. The declaration's own header is
where those admissions go:

- **Surfaces that cannot be captured honestly**, such as a camera page that a frame's permissions policy blocks.
- **States with no way in** yet: no URL, no steps, no network rule.
- **Devices not covered.** If the product has a phone layout and no phone screen is declared, say so.
- **Any frame drawn twice on purpose**, so it does not read as a mistake.

## Pinning states

`project/states.ts` is the only file that may import the project's stores or data. It runs at module scope, not in an
effect, because a page that reads a store once into `useState` on mount, or memoizes a selector with an empty dependency
list, will otherwise render the default while the frame claims a special case.

Write down the facts the pinning relies on, each checked in the code: which stores persist and have to be skipped or
overridden, which are plain in-memory stores, and which data comes from a module-level array that needs a dev-only setter.

Every app-code reader of a canvas param goes through `canvasPinsAllowed()` (dev, or `NEXT_PUBLIC_CANVAS_PINS=1` on a
build), never the env variable directly. Code that must render differently only for the photograph is gated on
`canvasCapturing()`, never on the pin, because Open carries the same URL (trap 22).
