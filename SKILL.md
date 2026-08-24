---
name: design-canvas
description: >-
  Put a design-review canvas into any project: one infinite, pannable surface holding a captured frame of
  EVERY screen and EVERY state of the real running app, grouped by kind, drawn as branching user-flow
  diagrams, and — while a design question is open — holding competing directions side by side for
  comparison, with a drag-a-rectangle comment layer that hands an agent the annotated picture of what was
  pointed at. Use this whenever the user asks for "a canvas of all the screens", "show me every surface",
  "every state on one page", "an overview of what we built", "a design review canvas", "put the flows on a
  canvas", "let me comment on the screens and send it to you", or wants to see a feature whole rather than
  one screen at a time. Also use it to explore design options as real screens rather than mockups, and to
  understand an unfamiliar, already-built project: it maps what screens exist, what states they have and
  what leads to what. Also the prerequisite for redesigning something that already exists, because it
  produces the agreed surface list and the baseline every alternative is measured against. One project can
  hold SEVERAL canvases, one per feature, each at its own URL. It COPIES a finished canvas in — the
  canvas's own design is fixed and is never restyled to the target project — and writes only that
  project's screen declaration. Not for a feature that does not exist yet.
---

# Design canvas

A canvas that imports the prototype. **Not the prototype that imports the canvas.** Those are the owner's
words about the first attempt, which was built as a page inside the app, inherited its sidebar, and had to
be thrown away:

> "It should be a canvas that imports the prototype. It should not be the prototype that imports the
> canvas."

Two jobs, and the second is why it is worth carrying between projects:

- **Review.** Every surface and every state of a feature in front of a designer at once, so they can see
  it whole, judge it, and comment on the exact part they mean.
- **Comprehension.** Point it at an unfamiliar, already-built repo and get a map of how it is put
  together — what screens exist, what states they have, what leads to what. The owner:
  _"the reason why it should be a viewer is because what if I want to use it in a different project. In a
  project that might be already built, and I just want to understand how it is built."_

## Four things that are already decided

Do not reopen them, and do not let a target project's conventions argue you out of them.

**1. The canvas's design is finished and travels as-is.** Owner: _"I really like the design of
the canvas, I think it can be reused as is for any projects."_ Its dark stage, toolbar, frame treatment,
captions, edges, comment box, pan and zoom feel, type sizes and colours are copied unchanged into every
project. Do **not** restyle it to the target's brand or tokens, do **not** substitute the target's button,
panel or icon components, do **not** "improve" or simplify the chrome, and do **not** re-derive the
colours — the dark surface is deliberate, because the canvas must never compete with the frames it holds.
`scripts/install-canvas.mjs` does the copying and `scripts/check-install.mjs` fails if a core file was
edited in the target, so this is checked rather than trusted. If the canvas looks different in the second
project than in the first, this skill has failed.

**No all caps, anywhere, ever** — not in a heading, not in an eyebrow, not in a label. It applies to the
canvas's own chrome exactly as it applies to a product's UI: differentiate with weight, size and colour. The
index page shipped with one uppercase heading on it and that was the first thing the owner said about the page.

The limit of that restraint, in the owner's own words, because "minimal" was once read as "unstyled":

> "I know I originally told you that the design has to be very simple, but I never told you that it has to
> be low quality or poor or not thought through at all… right now it looks like a freaking wireframe."

and why it is restrained at all:

> "if you try to make it look colorful, fancy... it will make me biased. I won't understand where is the
> real design."

**2. It always captures.** Every frame is a screenshot taken by `capture.mjs`. There is no live-frames
mode, no threshold and no toggle — one path, one set of rules. This deliberately reverses the never-
screenshots rule of the skill it replaces, and the reason is recorded so nobody re-litigates it by
accident: a surface holding dozens of live app pages cannot be panned or zoomed smoothly, and on a canvas
that is not a detail — **the interaction IS the instrument.** Measured on the build this came from: 38
live Next pages was unusable; 38 WebP frames drag at 60fps, median frame gap 17ms.

What that costs, and the one thing bought back: a picture cannot be poked at, so **every frame carries an
Open button back to the running page in its exact pinned state.** The owner demanded it in the same breath
as the pivot:

> "now that we turned it into screenshots for the sake of higher performance we need an easy way for the
> user to actually go and open this exact freaking thing to see how it interacts in the real project"

A canvas of pictures with no way back to the real thing is the failure the original never-screenshots rule
was written against, and is still forbidden.

**3. It is a viewer.** It renders the project's real routes. It never contains a hand-written stand-in for
a page, nothing is ever built inside it and moved out, and a screen that cannot be reached at a URL is
work to be done, not a thing to approximate. _"It is very important and crucial that they are real-life
pages. because screens doesn't make sense. HTML doesn't make sense in this case."_

**4. It is not a page of the app.** Same origin — the capture pipeline, the checker and the annotated PNG
all need it — but structurally outside: no app shell, no sidebar, no app navigation, its own full-viewport
surface.

## The three views, and which of them is temporary

**Grouped screens** (the default) and **user flows** are permanent. They are what a project keeps iterating on
and what gets handed to developers.

**Exploration** is the third tab, and it exists only while a design question is open: several genuinely
different answers to one question, each a real route of the real app, drawn side by side at full size so they
disagree with each other visibly. It is the 5-then-3-then-1 funnel expressed as declaration — round one is one
entry with five directions, round two REPLACES it with three variants of whichever won. Every panel opens
with TODAY'S DESIGN as its first frame (`original`, required) — six frames in a five-direction round: the
reference, then options 1 to 5.

### The two rules that decide whether it is an exploration at all

**1. DIFFERENT PATTERNS, NOT SETTINGS OF ONE COMPONENT.** A round where every frame is the same component with
pieces switched on and off is not an exploration, however different the frames measure. If the incumbent is a
table, at least most of the directions must not be tables: a different pattern means a different way to solve the
problem — a list, a stepper, a summary that drills in, a per-item card, a sheet, a page, an inline surface — not
the same grid with fewer columns. Owner, 2026-08-20, on five variants of one failures table: _"It was never about
simplifying the modal table. It was about finding completely different other patterns that suit this specific
situation way better and make it all feel simpler and easier to understand. meaning that I don't need to see
another table. It can be a modal, but it should not be a table."_ And on why the variants round is worse than
useless: _"the idea of the exploration is typically about finding different ways how to solve and issue how to
design something. Otherwise, it's not an exploration. It's just you giving me the same table without titles or
with titles or without an explanation or with an explanation, which is just stupid."_

A variation-of-the-incumbent round happens only when he ASKS for one: _"If I need a variation of the existing
component, I will say it plainly."_ Feedback that a surface is too complicated, too heavy, or hard to understand
is never that request — it is the signal that the pattern itself is the thing under question.

**2. TODAY'S DESIGN OPENS THE PANEL — AS THE REFERENCE, NEVER AS AN OPTION.** Every exploration declares
`original`: the id of the screen being redesigned, already captured in the permanent views. The tab draws that
frame FIRST, named "Today: …", unnumbered, with no verdict buttons — so the reviewer judges the options against
the incumbent without leaving the tab, and the incumbent can never be mistaken for a candidate. Owner,
2026-08-24: _"anytime you use the exploration, it always shows you not just the five options, but it shows you
six screens where the first one is the original design and the other ones from 1 to 5 are the explorations."_
This REVERSED his 2026-08-20 ruling that kept today's design off the tab ("there is no need to put how the
design looks today in the exploration") — he changed it the day real rounds were about to start. What survives
from the old rule: the incumbent is a REFERENCE, not a sixth direction. It reuses the screen's existing shot
(nothing is photographed twice), it takes no number and no verdict, and a round whose options are edits of it
still fails rule 1. `check-canvas.mjs` fails an exploration without an `original`, or with one the flows do
not declare.

### The diagnosis step — run it before composing any round

A round of directions is an answer, and an answer needs a stated question. Before writing an
exploration entry, run BOTH lenses against the original screen — its captured frame plus its flow
context (what leads in, what leads out, what the person is there to finish):

1. **[references/heuristics.md](references/heuristics.md)** in critique mode — the breadth scan across
   the 10 usability heuristics, only the violated ones, max 3 priority actions.
2. **[references/cognitive-load.md](references/cognitive-load.md)** — the depth drill: extraneous load,
   mental-model gaps, offloading opportunities, the five triage tests.

Then compose the round FROM the findings:

- The panel's `title` (the question) comes from the top finding, phrased as the design question it
  opens — "Where does the primary action live?", never "How can this be better?"
- Each direction's `note` names the finding(s) that direction answers, so every option arrives with a
  reason and the reviewer judges five arguments, not five pictures.
- The findings themselves are working material, not canvas content: they inform titles and notes but
  are never pasted onto frames or into the declaration wholesale.
- Directions still obey rule 1 above: findings say what is broken; DIFFERENT PATTERNS are how five
  answers stay five answers. Use the lenses' guidance modes when shaping each one.

**The previous round does not stay on the canvas.** Owner: _"I do not need to see the old explorations from the
first round. that's not how the exploration process works."_ A round that has been judged is spent: its winners
came back as variants and its losers are gone, so leaving it up puts rejected work next to live work and makes the
reviewer re-read decisions they already made. One round on the tab at a time.

It lives here rather than in a gallery of its own because the two hard parts of judging options were already
solved here and nowhere else: a frame is the real screen rather than a mockup imitating it, and the comment
layer hands back the annotated picture of the exact thing being argued with. Owner: _"what if it
could also do the visual explorations? It would be just another tab in addition to user flows and grouped
screens… all the feedback will basically be handled through the comments mechanism that we already built."_

**AND IT IS MEANT TO BE DELETED.** Owner: _"exploration is more for you… you can decide what you like the most,
you can iterate on it and then you can actually use it in the groups and user flows and get rid of the
explorations. So at some point, some screens will get deleted from there. and maybe even the whole tab will get
deleted."_ So it is data, never structure:

- No `explorations` key means no third tab. Emptying it removes the tab, and the view falls back to grouped
  screens rather than leaving an empty stage.
- Deleting a direction is routine: `capture.mjs` prunes its picture and its manifest entry, and the canvas
  ignores comments whose screen is gone, so nothing is left counting work on a frame nobody can look at.
- The scaffolding that made a direction reachable at a URL goes with it — mark it
  `DELETE WITH: the <question> exploration`, not with the canvas folder. It has an earlier deletion date than
  everything else the install added.
- **The new-screens queue never covers exploration frames.** The blue ring and the "N of M New Screens" stepper
  belong to the two PERMANENT views, where a frame arriving among frames that were already there is news. On the
  exploration tab every frame is new by definition, so the count can only ever equal the number of options, and
  a one-by-one walk fights the whole point of drawing them side by side to be compared. Owner, seeing a round
  arrive under "1 of 5 New Screens": _"the screens on the exploration tab do not need to be marked as new,
  because they are essentially all new. The new screen functionality that marks them with blue color and allows
  to review them one by one is supposed to be for the user flows and for the grouped screens."_
  `canvas-view.tsx` enforces it by filtering `view === "exploration"` out of `declaredIds`, which keeps those
  ids out of `seen` as well — so retiring a spent round leaves nothing behind that still counts it.
- **BUT THE PROMOTED SCREENS ARE NEW, and marking them is not optional.** The moment the winner lands in the two
  permanent views, every screen carrying it goes into the queue, because promotion is never one frame changing
  tabs. Owner: _"when I approve the designs from the exploration and you move them to the other two tabs, it is
  actually important to mark them as the new screens because it is very typical that in the exploration you show
  only, let's say the most important parts of the design but when you connect it to the user flow so it consists
  of many more screens that are related to the thing that we approved and picked to use as our design."_ Brand
  new ids flag by themselves. Screens that ALREADY existed and whose design just changed do not — they are in
  `seen` — so `unsee.mjs` takes them back out. Step 4 of the retirement below is where that happens, and skipping
  it hands the reviewer a fan-out they were never shown.

**Ask which views this canvas needs, with AskUserQuestion, before writing the declaration.** Multiselect, three
options: grouped screens, user flows, exploration. A canvas built for handover wants the first two; a canvas
opened to decide something wants the third as well. One question, and it stops a view being declared that
nobody asked for.

**Exploration is the FIRST tab and the opening view while it exists.** Owner: _"I also think the
explorations tab has to be the first one when it's available."_ A declaration with an open question is a canvas
whose whole point is that question; the two permanent views take the bar back the moment it is deleted.

### Before any option is captured: run `/impeccable` on it

**This is a hard gate, not a suggestion, and it comes before the shutter.** Every direction goes through the
**impeccable** skill — its design vocabulary and its checks — and through the target project's own design
system document (`PRODUCT.md` or whatever the repo calls it) BEFORE it is captured and put in front of a
reviewer.

Why it is a gate rather than advice: an option that has not been through it is a plausible-looking arrangement
of the project's components with nobody's judgement in it, and putting five of those side by side wastes the one
thing this whole tool exists to buy — a reviewer's round. The owner, on discovering it had been skipped, _"you not running it means none of the designs you suggested make sense because its literally trash
AI slop without this skill. I won't even review them until you do it properly."_

This skill was written without naming it, and that omission is exactly how it got skipped: the funnel was
documented, the quality bar was assumed. It is named here now.

- Run it **per direction**, not once over the set: five options are five designs.
- Run the project's design-system gate too — for a repo with a `document-components`-style skill, that means
  the reuse and token checks, and pasting what was found.
- If the project ships more design-lens skills, run those as well. Ask which ones exist rather than guessing.
- `check-canvas.mjs` cannot check this. It proves a frame is the state it claims; it has no opinion about
  whether the design is any good. That part is not automatable, which is why it is written down.

### How a round works

The funnel is 5 → 3 → 1, and the canvas runs all of it. Every option carries three things a reviewer needs and
one thing the next round needs.

**What the reviewer gets.** A panel headed by what the SCREEN IS (`surface`), the question under it, then the
options **numbered** 1..N — because a reviewer says "number three", never the four words on the frame. Each
option's `note` is what makes it DIFFERENT from its neighbours, not what it is. Under every frame: Open; at the right of every name: **like** and
**dislike**, in green and red, plus the comment layer.

**What you get back.** The likes and dislikes are verdicts, stored beside the comments in `comments/<slug>.json`. They
are deliberately separate from comments, because they answer different questions: a direction can be kept with
three complaints on it, or dropped with nothing wrong in it beyond being the weaker idea. Hand Off then writes
the round out as an instruction rather than a list of notes:

> Round 2 of the exploration. DELETE the disliked options and the scaffolding only they used: … Build
> three variations of each, as a new exploration entry with `round: 2`: … Work the comments first —
> they apply to the options they sit on, and a variation that ignores them is a wasted round.

#### Reading the verdicts. Five rules, and the third is the one that gets missed

The reviewer's own words, after watching an agent get it wrong: _"if I like some options and I don't
specifically dislike the other ones, it still means that I disliked the other ones because I haven't liked them,
right?"_ Yes. So:

**1. A like is exclusive, and silence is rejection.** Within one exploration, the liked options survive and
everything else goes — whether or not it carries an explicit dislike. Do not treat an unliked option as pending
and do not carry it into the next round "in case". An exploration with two likes out of five is a decision about
all five.

**2. A liked option comes back as three variations**, in a NEW exploration entry with `round: 2`, and
its comments are worked BEFORE the variations are drawn. A comment that names a correction is not one of the
options — fix it in the component and say so in the panel's note. Only genuine alternatives become variations.

**3. An exploration with NO verdicts at all is WRONG, not pending.** This is the one that gets missed. It happens
when that exploration's options were built on top of an option from an earlier section that the reviewer did not
pick — so there was nothing there worth liking or disliking, because the whole set sits under a premise that lost.
In his words: _"if I haven't selected that option as something I liked, it means that it doesn't make sense for me
to neither like anything there or dislike anything in there because it's all incorrect. It's not under what I
selected."_

Delete those explorations and rebuild them under what actually won, once it has won. Do NOT migrate their frames
to a surviving host and keep the panel — the options were answers to a question that is no longer being asked.

**4. A VARIATION IS AN ALTERNATIVE, NOT A STATE.** Three variants means three designs that answer the same
question in three different ways, side by side, judged against each other. It does NOT mean three moments of the
same design. A round that shipped a reconnect remedy as before / pressing / after was rejected on sight:
_"in some sections, you're not showing three options, but you're showing three states of the same option, which is
a mistake, like you're changing the logic of the skill, which is not allowed."_

The test: could the reviewer like exactly one of the three and delete the other two, and still have a working
design? If not, they are not options. A sequence belongs in the **flows** view, where a chain of states is the
whole point. Put the sequence there and put the alternatives here.

**5. LATER ROUNDS CONVERGE ON ONE PATTERN. Round two is not five fresh inventions.** By round two the reviewer has
already told you what they like, and every section has to be built out of those same parts:
_"there are too many differences between these designs. So when we are on the second round, you already should
understand the patterns that I like from all the sections. And you need to keep the designs in all the new sections
in the second round consistent between these patterns. So you simply cannot use one pattern in one screen and
another in another."_

So before drawing round two, write down the pattern the likes imply — the row, the surface, the action, the words —
and build every section's variants out of it. What differs between three variants is one decision. What must NOT
differ is the vocabulary. A round two where each section invented its own row is a round one with a new label on
it, and it will be rejected as one.

**The one exception**, and check it before deleting: an exploration with no premise above it — the first
structural question — has nothing to be wrong about. No verdicts there means not yet reviewed. If you cannot tell
which case you are in, say which reading you are acting on before you delete anything.

#### The heading, and why `round` is a number

The Exploration tab carries one heading above every section, and the canvas owns its words. `round` on an
exploration entry is an integer — `1`, `2`, `3` — and the furthest round on the tab picks the copy:

| `round` | Title | Subtitle |
| --- | --- | --- |
| 1 | The first directions | Genuinely different answers to each question, drawn as real screens so they disagree visibly |
| 2 | Variations on what you kept | Three takes on each direction that survived, with your comments worked into every one |
| 3 and up | Refined from your notes | One design per question now, rebuilt around the comments you left on the option you kept |

**Three kinds of round and no more**, in the owner's words: _"there is essentially a first, a second, and the
third and everything after that is the same."_ Round four does not need new words, because it is doing round
three's job again.

**`round` is a NUMBER, not prose.** The canvas owns the words for round one, round two, and everything
after; the declaration says only how deep the question is. A string here cannot be composed with — the heading
comes out as a fragment with the word repeated in the sentence after it — so do not put one here, and do not
build the heading by concatenation.

**The rules the copy follows**, all his, and they are why it reads the way it does:

- **The title says what this IS**, not what to do about it. The mark beside it opens the mechanism for anyone
  who wants it: _"you don't need to restate what the user has to do here. It has to be really clear what it
  is… all the details are anyway hidden in the info icon tooltip."_
- **The subtitle is one sentence with no full stop.** Not two, and never a fragment.
- Neither line restates the other.

**The rules live on the canvas too.** `canvas-view.tsx` prints them in the Exploration view, because the person
who invented them asked for it: _"this mechanism is something that I keep in my mind but even I sometimes forget
how it works"_. If you change the rules, change that panel in the same commit.

**So the next round is mechanical.** Delete the dropped entries and whatever URL scaffolding only they used,
act on the comments, add one new `explorations` entry, recapture with `--changed`, and hand it back. Owner's own
description of the loop: _"you remove those that I dislike, you work on the comments that I left, if I left any,
and you create three more variations for any options that I liked… and only after that we use it in the grouped
screens tab and in the user flows tab."_

**WHAT THE NEXT ROUND CONTAINS IS DECIDED PER PANEL, NOT PER CANVAS.** Each panel is one surface narrowing on
its own, and it is at its own stage of the funnel:

- **Several options liked in one panel** → three variants of EACH of them, and nothing else. Not a mixture, and
  never a variant of an option that was not liked. Owner, after a round that did both: _"whenever I like more
  than one design on a section, it means that I want to see three options for it in the next round for both
  things that I selected… in reality we needed to get six options, three for the first design that I selected
  and three for the other one that I selected"_, and on a variant he had never picked: _"I don't remember me
  selecting this option, so I don't understand why you decided to design it in this round. That's weird."_
- **One option liked in a panel** → the funnel is on its last leg, so REFINE THAT ONE against the comments,
  `round: 3`, and keep refining it until it is approved. Do not fan out into three again. Owner: _"the
  next one has to be not the three options again. it has to be the selection of what I like the most and the
  comments applied to what I like the most, so that I could iterate on it until it's really good and I
  completely approve it and it's ready to move to the other two tabs and get rid of the exploration tab."_
- **THE ROUND YOU ARE REFINING IS DELETED, NOT KEPT BESIDE IT.** Files, declaration entries, frames and all.
  Owner: _"obviously the round one should get deleted when you show the round two, because what's the purpose of
  it? This is the exploration process. We don't keep the old designs. We choose the best ones out of the best
  ones and we improve them."_ Only what survived from a deleted round survives, as extracted blocks the new
  round is built from.

**A VERDICT OUTLIVES THE FRAME IT WAS LEFT ON, so check the ids in a hand-off against the declaration before
building anything.** Likes stay in the comment file after their screens are deleted, and a hand-off that
replays them sends you to refine options that no longer exist. `canvas-view.tsx` now filters them out, and a
hand-off produced before that fix will still name deleted ids — say so rather than guessing which round it
means.

**The last round ends by deleting the exploration, and that is a real piece of work rather than a tidy-up.**
The owner, on why: _"There is no need to keep those files or exploration folders because they just overload the
context and they don't really make sense anymore. They are not the source of truth anymore."_ An exploration left
on a canvas after it was decided is a question that reads as still open, and an `explorations/` folder left in the
repo is a second answer competing with the shipped one.

So retiring one has six steps, and none of them is optional:

1. **PROMOTE THE WINNER INTO THE FEATURE.** Its components move out of any `explorations/` folder and into the
   surface they belong to, carrying their docblocks — the reasoning is the most valuable thing the rounds
   produced. The real page renders them; the losing options are deleted, files and all.
2. **UPDATE THE PROTOTYPE, NOT ONLY THE CANVAS.** Until this step the design lived behind a review-only flag and
   the app itself was unchanged. The owner: _"you definitely need to update the prototype as well. so I could test
   the prototype myself to not just look at the screens."_ A canvas showing an approved design the app does not
   render is the worst state this tool can leave a project in.
3. **DELETE THE SCAFFOLDING.** The `?explore=` flag, the exploration's state pins, and every `DELETE WITH: the
   <question> exploration` marker that named them.
4. **REDECLARE THE STATES IN THE TWO PERMANENT VIEWS.** The winner has states the old design did not — new beats,
   new copy, new failures — and the grouped view and the flows have to carry all of them, with the flow's edges
   extended to the new beats. Claims that quoted the old copy are now false and will fail the capture, which is
   the check working.

   **THE EXPLORATION SHOWED A SLICE; THE FLOW SHOWS THE WHOLE THING.** An exploration frame is the one moment
   that made the question decidable. Connected up, the same idea usually touches several states — the beats
   before it, the failures around it, the version on the other device — so expect this step to produce MORE
   screens than the round had options, not the same count.
5. **MARK EVERY PROMOTED SCREEN AS NEW, so the reviewer walks the fan-out.** New ids flag by themselves. Screens
   that already existed and whose design just changed are in `seen`, so they arrive silently unless you take them
   out of it:

   ```bash
   node design-canvas/unsee.mjs --canvas <slug> --ids <every screen the winner landed on>
   node design-canvas/unsee.mjs --canvas <slug> --list        # what is still marked seen
   ```

   Owner, on why this is not optional: _"it is actually important to mark them as the new screens because it is
   very typical that in the exploration you show only, let's say the most important parts of the design but when
   you connect it to the user flow so it consists of many more screens that are related to the thing that we
   approved."_ Promotion is the one moment the queue exists for, and it is the one place the queue used to be
   silent — a retirement that skips this looks finished and delivered no review.
6. **REMOVE THE `explorations` KEY** so the third tab disappears, then run a FULL capture: `--changed` will not
   prune the frames of screens that no longer exist, and a full run says which it removed.
7. **SAY WHAT WENT.** In the hand-over, list the deleted files and the deleted scaffolding, so nobody goes looking
   for an option that no longer exists — and name the screens you put back in the new queue, so the walk is
   expected rather than a surprise.

## What lands in the target project

**One name for the tool, the folder and the URL.** It was `dev-canvas/` at `/dev/canvas`, which is two names
for one thing and neither of them the tool's: _"now that we use the name design-canvas for the skill and put
all its contents under this folder, I think we should also use a proper URL."_ So the folder is
`design-canvas/`, a canvas is at `/design-canvas/<slug>`, and the two endpoints are
`/api/design-canvas/comments` and `/api/design-canvas/shots`. It is dev-only by default — the pages and both
routes 404 under `NODE_ENV=production`.

**IT CAN BE PUBLISHED READ ONLY, and that is the only exception.** `NEXT_PUBLIC_CANVAS_VIEW_ONLY=1` at build time
lifts that 404 and takes the comment layer away — absent, not disabled: no Comment button, no Hand Off, no Clear
All, no drag, and the route refuses every write with 405. It exists because a canvas is a thing people are sent
to read, and a reviewer will want to hand developers a link rather than ask them to run the app:
*"it would be helpful if it did because I could then share it with my developers."* A published canvas owes two
things from the target project, both in its README: the shots have to be traced into the picture route's bundle
(they live outside `public/` on purpose), and `NEXT_PUBLIC_CANVAS_PINS=1` has to be set or every frame's Open
button lands on an unpinned page. It has NO AUTH of its own — whatever protects the deployment protects it.

**SEVERAL CANVASES PER PROJECT, SEPARATED BY URL AND BY NOTHING ELSE.** One project stopped being one canvas
the moment a second feature wanted one. Owner: _"we already have one for the online store stuff,
but we need another one for the checkout… what we could do is to handle it by different URLs. So for example…
design-canvas/storefront for the storefront stuff and design-canvas/checkout for the checkout stuff. I'm not
sure we need to introduce any new UI on the canvas yet."_ So there is **no canvas switcher in the toolbar** —
the address bar is the switcher, and `/design-canvas` with no slug lists what the project has.

A slug is a URL segment and a directory name at once (lowercase, digits, dashes), and it namespaces the
pictures and the review. That is not tidiness: two canvases sharing one shots folder would have each capture run
delete the other's frames as orphans, because a screen the other canvas declares is a screen this one has never
heard of — and two canvases sharing one comment file would hand the agent two different screens both called
`c4`.

```
design-canvas/
  core/       generic, copied byte for byte, NEVER edited per project
  project/    the adapter, and the ONLY thing written fresh — exactly three files.
              flows.ts exports CANVASES: every canvas, keyed by its slug
  canvas-page.tsx  capture.mjs  check-canvas.mjs  dump-screens.mjs  README.md
  shots/<slug>/         the captured screens and their manifest, per canvas — COMMITTED
  comments/<slug>.json  comments/<slug>/   feedback and its pictures, per canvas — gitignored
```

**The shots are committed on purpose.** They are artefacts and `capture.mjs` regenerates every one, but a
checkout without them opens the canvas on empty frames, and the canvas is a thing people are sent to read:
_"I think it would be nice to commit the canvas as well, because that's something that the developers might
need to look at."_ 28 screens was 2.6MB of WebP. The comments are not committed — one reviewer's working
notes, megabytes of PNGs, and a merge conflict inside somebody's feedback.

`core/` holds everything already solved: the infinite surface and its easing, the whole visual design,
frame rendering and captions, the edge layer and its attachment, the two groupings and the switch, the
comment layer with its box, markers, handoff and clear-all, the capture pipeline and manifest, and the
oracle. Re-solving any of it in a new project is the failure this skill exists to prevent.

`project/` is exactly three things and nothing else belongs there:

1. **`flows.ts`** — the screen declaration: which routes, at which pinned state, with what label, kind,
   claims and source files, plus the flow graph and its edge labels, any open explorations, and the
   `CANVASES` record that names every canvas this project has. A large declaration may keep each canvas in
   its own file under `project/canvases/` and import them here, but this is where a canvas is NAMED, so this
   is where the list is read.
2. **`states.ts`** — how _this_ project forces a screen into a state. Optional: a screen with no state
   renders its route as it comes, and a project with no `states.ts` still gets a working canvas.
3. **`canvas-state-pin.tsx`** — the one component the root layout mounts so a state lands before the
   page's own components do. Delete it with `states.ts` when nothing is pinned.

Outside the folder, the minimum, each carrying `DELETE WITH: the design-canvas/ folder`: four route stubs,
the Tailwind content glob, the chromeless-layout branch, one line in the root layout, three `.gitignore`
lines, and whatever review-only URL flags step 4 has to add.

**`README.md` is half the project's, and the install is not finished until that half is written.** Below the
`<!-- design-canvas:project` marker near its end nothing is ever overwritten: the installer splices its own
half above whatever is already there. That half is where the project's ports go, the scripts that carry
them, every seam the install cut into the repo and why, the file-by-file list to undo when the folder goes,
and what is known not to work yet. Everything above the marker is generic and cannot state any of it — it
does not know the target's ports, so it names 3000 and is wrong wherever that is not the answer. The first
project handed its canvas to a team had no project half at all, and its README sent developers to a port the
app had never run on. `check-install.mjs` notes a missing or placeholder half; writing it is the agent's job.

## Before you start

The core assumes **Next.js App Router + React + Tailwind**, and the two scripts need **Playwright**. Check
that first and say so plainly if the target is something else: a Vite or Remix project needs the two API
routes rewritten against its own server, which is real work and not a footnote. `references/porting.md`
says what is portable and what is not.

## The workflow

Eight steps. Steps 1 and 4 are the real work, the canvas itself is the easy part, and step 8 is the
reason the other seven exist.

### 1. Enumerate the screens and states FROM THE CODE

Not from memory and not by clicking around — intuition undercounts badly. Read the routes and the
components and walk:

- every member of every mode / step / level union, and every `case` of the switches on them
- every conditional render: `armed ? … : …`, `available ? … : null`, empty versus populated
- every state a store can be seeded into, and every async state — idle, loading, failed, empty, over quota
- the same surface at meaningfully different content volumes; nothing chosen versus everything chosen is
  two surfaces, not one

**THE SMALL STATES ARE THE POINT OF THE FLOW VIEW, AND THEY ARE WHAT GETS UNDERCOUNTED.** A canvas that
holds one frame per screen is a gallery of destinations; what a reviewer needs to judge is what happens
between them. So for every surface a person types into or presses, the flow carries the beats, not just the
outcome:

- the field **focused** and still empty, because that is when the page should be showing them where the
  answer will land
- the field **filled**, before anything is submitted
- the press **refused** — the validation error, in the words it actually renders
- the press **accepted but not finished** — saving, checking, waiting, whatever the surface calls it
- and the two ends: the state before anything was done, and the state once it is done

The owner's own words for this rule: *"for the user flows you really need to cover those five last very,
very important, very, very detailed small edge cases or states or things like that because like even the
state when I click the input, the state when I enter something, the state when I enter something wrong and
I click the button and I see an error. So all those things, we need that."*

**GROUPED SCREENS MAY BE THE SHORTLIST. USER FLOWS MAY NOT.** The grouped view is for comparing near
identical surfaces side by side, so it earns its keep with the states that carry the design decisions —
about 95% of what matters, and a beat that differs only by a caret does not belong there. The flow view is
the opposite: it is the one place a missing intermediate state reads as a product that skips a step. When a
state is worth capturing but not worth comparing, declare it and keep it out of the grouped view's `kind`
grouping rather than dropping it.

**Every one of those beats needs a way in (step 4).** A focused field and a rendered validation error are
component-local state, so they need a pinned state or a review-only flag exactly as a dialog beat does. If
a beat cannot be reached without one, that is work to schedule, not a reason to leave it off the canvas.

**A STEP OUTSIDE THIS APP IS AN EXPLANATION FRAME, NEVER A GAP AND NEVER A MIMIC.** A flow that leaves the
product — a hosted checkout, a step on another device, a document arriving by email — keeps the beat as a
declared node with `explain` set and no `route`: the flows view draws it as a dashed text panel saying what
happens there, it is never captured, it never appears in the grouped screens, and edges through it carry
normal labels. The owner, deciding it: _"the screen that it might show won't really be a screenshot, But it
could be just an explanation of what will happen here on this step of the user flow."_ It exists because
the alternative on both sides is banned: skipping the beat reads as a product that skips a step, and a
faithful-looking stand-in for a third party's page is a screen this product does not own.
`references/declaration.md` has the entry and the rules the oracle enforces on it.

**THREE KINDS OF NON-PHOTOGRAPHED STEP, THREE CHROMES** (`explainKind`, enforced by the oracle against the
rendered panel). One dark panel was carrying three different truths, and the owner stopped it: _"if you use
the same approach for both, it will start to be confusing."_ Declare which one it is:
- `"outside"` (default) — a third party's surface (a hosted checkout, an OS dialog). Neutral dashed panel,
  "Outside this app".
- `"product"` — part of THIS product's flow, but not capturable from this repo: a buyer page in another
  repository, a transactional email, the mobile app. Tinted dashed panel, "In this product, not capturable
  from here". It tells the reviewer this step is ours and will be designed, the canvas just cannot reach it.
- `"canvas:<slug>"` — a BOUNDARY NODE: the step continues in another canvas of this project (a flow born in
  a quote, a tag press landing in stock). Drawn as the dark panels' inverse — a white card, dark text, no
  border — with one big fully rounded "Open Canvas" button that navigates to the other canvas (the button
  carries `data-canvas-chrome`, or the surface's pan handler eats its clicks — that bug shipped once).
  This is how canvases interconnect instead of duplicating each other's screens. Use it for real in-app
  crossings only; a step that leaves the product is `"outside"` or `"product"`.

Then **audit reachability and delete what nothing reaches.** A canvas that includes an unreachable screen
is lying about the product, and everything downstream treats the lie as real. Building one of these once
found four unreachable levels and ~309 lines including three components. Propose the deletions, get them
agreed, remove them, re-verify the feature works.

Get the list agreed before building anything, and **say up front that making states reachable by URL will
be the bulk of the work** — that is step 4, and discovering it late is how these run long.

Ask two things with **AskUserQuestion** while the list is being agreed: **which views this canvas needs**
(grouped screens, user flows, exploration — multiselect), and **which canvas this is**, if the project already
has one. A second feature gets its own slug rather than being added to an existing canvas.

### 2. Install the core

```bash
node ${CLAUDE_SKILL_DIR}/scripts/install-canvas.mjs --target <repo root>
```

`${CLAUDE_SKILL_DIR}` is the folder this SKILL.md is in, substituted by the runtime — so the same line works
whether the skill sits in `~/.claude/skills/`, in a project, or inside an installed plugin. Keep the working
directory at the target project either way. If the substitution does not resolve, the runtime shows this
skill's loaded base directory; use that path instead.

Never hand-write a core file, and never edit one after it lands. Then do the seams the script prints and
cannot do itself, **Tailwind first** — a folder outside the content globs has every class it uses that the
app does not already use silently dropped, and every styling observation you make afterwards is
meaningless.

As each seam goes in, write it into the README's project half, below the marker: what was edited, why, and
what removes it. Add this project's ports and any `package.json` script that wraps a canvas command there
too, and replace the placeholder text while doing it — the half above the marker names port 3000 because a
shipped file cannot know better, and an unwritten project half means the ports are recorded nowhere.

### 3. Write the declaration

`design-canvas/project/flows.ts` is the only place screens are named. **Read
[references/copy.md](references/copy.md) before you write a word of it**: every title, label and note on a canvas
is held to one standard, ASD-STE100 Simplified Technical English, and `check-canvas.mjs` FAILS on a violation
rather than noting it. The short version is one idea per sentence, the active voice, Title Case on names and
labels, twenty words on a screen note, and no "simply" or "really" anywhere. The starter it was installed with
carries the rest of the rules; `references/declaration.md` carries them with their reasons — what a claim is and why it
must be chosen from the page rather than from the label, why an empty state needs `expectMissing` and cannot
be proved without it, why no two screens may resolve to the same address and state, why labels use the
product's words and never the tool's, why every `kind` needs at least two screens, and the edge-label rule (an action starting with a verb from a closed list, or a condition starting with
"When", every label 12 to 24 characters, no `back` edges, enforced by the oracle).

Three per-screen fields declare HONEST capture holds, for photographing a real app as it really is:
`brokenImages: true` says images on this screen never load because the app itself is broken there — the
broken image IS the finding, so the shot is accepted showing it (a flagged screen where every image loads
still fails: the bug healed and the flag is stale); `sparse: true` says the page is genuinely under
the blank-page byte floor — one grey line on white is a real state, and its claims still have to pass;
and `animated: true` says the surface NEVER SETTLES by design (a pulsing loading skeleton, rows whose
media plays) — the two-identical-shots stability proof is impossible there, so the single shot is
accepted as one instant of a moving surface, with every other check still applied.

An action edge can also declare WHERE its press lives: `origin: "Mark as Shipped"` (the control's exact
visible text, or `css=` plus a selector) is measured by the capture into a rectangle in the manifest — a
spec resolving to zero or several visible places fails like a missed claim, so the region can never drift.
The flows view draws the measured regions as vivid ORANGE highlights (orange because blue, green and red
already carry other meanings) behind a cursor-click toggle that sits right of the User Flows tab, appears
only while that tab is on, glows orange when pressed, and RESTS OFF; with it on, each edge re-anchors to
start AT its highlight, so one orange line connects the pressed control to the screen it opens — that
connection is the whole pairing: no numbers, no hover choreography (both retired on the owner's feedback
as overcomplication). EVERY action edge carries `origin` or `noOrigin: "<reason>"` — the oracle refuses
neither and refuses an origin on a condition edge — so orange is the norm for presses and every grey
press is a written decision. The capture refuses a rectangle the picture does not hold, so a highlight
can never float outside its frame. `references/declaration.md` carries the full rule.

A USER FLOW IS CONNECTED BY ACTIONS. "If the user does this, they see this" — that is the definition, in
the owner's words, and a "flow" that is a linear chain of states joined only by "When …" conditions is a
grouped-screens section wearing a flow's clothes. The oracle fails any flow with edges but no action edge.
Condition edges stay legal as branches of a journey; they cannot be the whole of one. States, variants and
versions belong in grouped screens — showing the same set in both tabs erases the reason there are two.

The flows are the part most likely to be got wrong. A user flow is a **branching diagram**, not a row:

> "a user flow is not a linear thing. The whole point of the user flow is to show all the possible branches
> of the flow that the user is going through. Otherwise, you're not building anything really helpful for
> me. Like if you're making a linear set of frames that are not really even connected visually, it doesn't
> help."

and the arrows, not the frames, do the explaining:

> "user flows don't need titles about screens. they need interaction explanation over the arrows, making it
> clear what has happened."

**ADDING A SCREEN TO A CANVAS THAT ALREADY EXISTS IS ITS OWN STEP, and it is the one that rots.** Read
`kinds` in the declaration before writing the entry, and file the screen under one of the sections it names.
If none of them fits, add a section deliberately, with a sentence saying what belongs in it. This is checked:
a screen filed under a section the declaration does not name is an oracle FAILURE, not a note, because the
alternative is a heading that looks deliberate and is not. It came from a real one, an error state filed
beside the happy path: _"This is an error state, so you put it in the wrong section … it's important that even
after the canvas becomes reeeeally big, you put new screens in their proper places (groups or flows) or create
new ones when needed, even if you start from a blank context but in the project with such a canvas already set
up."_ The same judgment applies to flows: a new state usually belongs in an existing flow, next to the states
it can be reached from, and a new flow is for a journey none of them covers.

### 3b. When a canvas has outgrown itself, split it

**A canvas is this tool's top level of information architecture.** Its own frames, its own comments, its own
review queue, its own entry on the index, and the switcher in the top-left corner crosses between them. So the
answer to "this canvas has too many sections to navigate" is another canvas, never another level of nesting
inside one.

**Two signals, and both have to be true.** Size alone means nothing: one long feature is allowed to be long.
What makes a canvas two canvases is size (past ~45 frames or ~8 sections) PLUS a seam — two families of route
with no arrow crossing between them. `check-canvas.mjs` prints both, with the seam it found, as a note.

**The procedure, in order.** Skipping the third step is how a review gets orphaned:

1. Declare the new canvas in `project/flows.ts`: a new slug, its own `title`, `note`, `viewport`, `frameScale`
   and `kinds`, and move the flows into it whole. Move their `kinds` entries with them.
2. Check the seam is real: no edge should now point from one canvas into the other. If one does, the split is
   in the wrong place — those two flows belong together.
3. `node design-canvas/split-canvas.mjs --from <old> --to <new>` moves every comment whose screen moved, with
   its annotated picture and its thread, renumbered inside the new review. A comment belongs to a screen, so it
   travels with it.
4. Capture the new canvas: `node design-canvas/capture-run.mjs --canvas <new>`.
5. Capture the old one too, even though nothing in it changed — that run is what deletes the pictures of the
   frames that left.
6. Run the oracle on both, and on every other canvas in the project.

### 4. Make every declared state reachable by URL

The bulk of the work, and it is app-code work rather than canvas work.

- Concentrate the scaffolding so it can be deleted in one move, and give every flag a comment naming what
  deletes it.
- Watch for **mount effects that reset what you seeded**: a screen that reads a store once into `useState`
  on mount, or memoises with an empty dependency list, silently undoes a deep link and then renders the
  default while the frame claims a special case. That is what `project/canvas-state-pin.tsx` and the
  module-scope apply in `states.ts` exist for.
- Verify the state you asked for is the state you got, from the DOM. A URL never implies a state.

### 5. Capture

**A CAPTURE RUN IS NOT FINISHED WHEN ITS ASSERTIONS PASS. LOOK AT THE PICTURES.** Before anything about a
run is reported, open every new or changed frame as an image and hold it against its label. The assertions
prove text is in the DOM; only eyes catch an overlay covering the page, a blank band under a short page, or
the wrong surface photographed — a promo dialog once sat over all thirty-one frames of a canvas while every
assertion passed, and the owner found it, five hours late, by looking. The picture is the deliverable, so
the picture is what gets verified. A run reported without this look is unverified, whatever the oracle says.

**A REAL APP RESURRECTS ITS FIRST-RUN AND PROMO OVERLAYS IN THE CAPTURE BROWSER.** Their dismissals live in
localStorage, localStorage is per origin, and the capture origin (its own port) has dismissed nothing — so
dismiss them once ON THE CAPTURE ORIGIN and re-save the storage state, and declare each overlay's text in
the canvas's `forbid` list so any return, including overlays the app ships later, fails every polluted
frame loudly instead of being photographed.

**ONE COMMAND, and it captures against a PRODUCTION BUILD.**

```bash
node design-canvas/capture-run.mjs --canvas <slug>
```

That is the whole procedure. It builds into its own folder (`CANVAS_BUILD_DIR`, so the dev server's `.next` is
untouched), serves it on its own port, dumps the declaration, captures, re-runs anything that flaked, stops the
server, and prints what each phase cost.

**AN APP BEHIND A LOGIN CAPTURES WITH A SAVED SESSION.** The capture browser is a fresh profile, so on an
authenticated app every frame comes out as the sign-in page. The user — never the agent — logs in once:

```bash
npx playwright open --save-storage=design-canvas/auth-state.json <app url>
```

and every run after that names the file: `--storage-state design-canvas/auth-state.json` on `capture-run.mjs`
or `capture.mjs`, or `CANVAS_STORAGE_STATE=<path>` set once for the project. The file holds live session
tokens: the installer gitignores it, the agent never reads or prints its contents, and when the session
expires the fix is the same one-time login again — frames full of sign-in pages are the symptom.

**AN APP WITH VIDEO IN ITS CHROME CAPTURES ON REAL CHROME.** Playwright's bundled Chromium has no H.264
codec, so every MP4 player photographs as a black "An unknown error occurred" box — a state no user is
ever in. Pass `--browser-channel chrome` (or set `CANVAS_BROWSER_CHANNEL=chrome` once for the project)
and the capture launches the installed Chrome instead. Found on gemhub-web, whose sidebar carries a
promo video on every page.

**WHY A BUILD.** `next dev` compiles each route on first request inside the capture's own load budget, and with
several pages in flight the cost lands on a different screen every run — measured on the project this came from:
31 problems, then 22, a different set blank each time, every failure at the timeout. Measured again on a
28-frame canvas, one round each way:

| | dev server | production build |
| --- | --- | --- |
| all 28 screens | 170–380s, and a different handful failed every run | **24.6s, 0 failures, first try** |
| per screen | 5–8s | **0.9s** |
| hand re-shoots afterwards | 2 to 4 rounds of `--only` | none |

**THE FOUR-STEP VERSION IS WHY THIS WAS SKIPPED.** It was documented for months and ignored — including by an
agent that had read this file — because a build clobbered the dev server the reviewer was on, and because four
commands are four chances to do it the easy way instead. Both reasons are gone. If you find yourself typing
`capture.mjs --url http://localhost:3000`, you are choosing the lottery.

<details><summary>The steps, for a project that needs them separately</summary>

```bash
CANVAS_BUILD_DIR=.next-canvas NEXT_PUBLIC_CANVAS_PINS=1 npx next build
CANVAS_BUILD_DIR=.next-canvas npx next start --port 3055
node design-canvas/dump-screens.mjs --canvas <slug> > /tmp/screens.json
node design-canvas/capture.mjs --canvas <slug> --url http://localhost:3055 --screens-file /tmp/screens.json --no-warm
```

`distDir: process.env.CANVAS_BUILD_DIR || ".next"` in the project's next config is what keeps the two builds
apart. Without it, a capture and a review cannot happen at the same time.
</details>

**`--canvas` names which canvas is being captured**, and it defaults to `main`, so a single-canvas project can
leave it off. Every path the run touches is namespaced by it — the pictures it writes, the manifest it prunes
orphans against, the comment file it marks stale — so a run that forgets the flag on a multi-canvas project does
not merely capture the wrong screens: it deletes the other canvas's frames as orphans.

**RECAPTURING ONLY WHAT CHANGED IS THE DEFAULT.** `--all` is the override. The reason is not speed first: a
full recapture marks EVERY comment on the canvas stale, including the ones about screens nobody touched, which
shoves work back into the reviewer's queue that they had already answered.

```bash
node design-canvas/capture.mjs --canvas <slug> --url http://localhost:3055 --screens-file /tmp/screens.json
node design-canvas/capture.mjs --all --canvas <slug> --url http://localhost:3055   # prove the whole canvas
```

**What a screen is considered to depend on**, because this is what makes skipping safe rather than merely cheap:

- **Everything its declared `source` files import, transitively.** `source` names one or two entry files, written
  by hand; the run walks out from them through every project file they reach. A change to a button used by nine
  screens marks those nine. This used to hash only the named files, which meant a shared component was invisible
  and the only safe move was capturing everything — see trap 21 for what that cost.
- **The file that implements its pinned state**, when its url carries `?canvas=`. Rewriting a fixture changes the
  picture without changing anything the screen names.
- **The global inputs no import graph reaches**: the Tailwind config, the global stylesheet, the pin adapter.

A run that captures nothing says so and exits in under a second. What it skipped is always printed, and
`check-canvas.mjs` reports drift as a note on every run, so nothing goes stale quietly.

**IT RETRIES ITS OWN FLAKES.** Any screen whose claims did not appear goes round once more, sequentially, three
seconds after the lanes drain. It prints which screens needed that, because a screen that only ever passes alone
is a fact about the screen. This exists because a full run against `next dev` reliably leaves a handful of late
claims — which is a symptom of not following the production-build instruction above, not a reason to skip it.

Each shot carries a **stamp**: a content hash of every file its screen declares in `source`, plus a hash of the
screen's own declaration (address, pinned state, claims). `--changed` re-hashes and captures a screen when any
of them differs, when it has never been captured, or when its shot has no stamp. Hashes rather than timestamps
or git, because a formatter changes an mtime and git cannot see an uncommitted edit — which is the state this
runs in. The run **prints what it left alone**. Since the stamp became an import closure plus the pinned state's file
plus the global inputs, a shared component IS seen — see step 5 for the exact list of what a screen is considered
to depend on.

Two things fall out of it, and both are the point:

- **`check-canvas.mjs` notes a shot older than the files it names**, by re-hashing the same stamp. That is the
  safety net for the run where nobody passed the flag.
- **Orphans are pruned.** A screen deleted from the declaration takes its picture and its manifest entry with
  it on the next capture, and the run says which.

**Never build while a dev server is up** — they share `.next`, and the corruption surfaces as
`TypeError: Cannot read properties of undefined (reading 'call')`, which reads like an app bug. **And on a
quiet tree**: a dev server recompiling under another agent's edits returns blank pages, and a blank capture
then looks like a pipeline bug when it is not one. Recapture after any change to the screens.
`references/capture-and-comments.md` has the shutter discipline in full and the manifest contract.

### 5b. Push the capture loop off the expensive model

**The capture and the checker use no model at all.** They are Node plus Playwright: `capture.mjs` photographs and
asserts, `check-canvas.mjs` re-asserts against the built canvas. Nothing in either reasons about anything. So the
token cost of a canvas is never the tooling — it is the agent sitting in the loop reading output, deciding what to
recapture, and running it again. The owner named the cost precisely: _"it spends too many tokens, because we do
everything in the main session. and in the main session I use the Opus model, which is one of the most expensive
ones. maybe for some routine mechanical stuff it could use simpler models."_

He is right, and the split is clean, because the two halves of this skill need opposite things:

| Needs judgement — keep it in the main session | Mechanical — hand it to a subagent on a cheap model |
| --- | --- |
| Deciding what screens and states exist | Running capture, reading which screens failed, recapturing them |
| Writing the declaration and the `expect` claims | Running `check-canvas.mjs` until it exits 0 |
| Designing the options; reading a round's verdicts | Reporting the final counts and any claim that failed twice |
| Judging a picture against the design system | Nothing about a picture. It never opens one |

**Dispatch it like this**, and note what it is NOT allowed to do:

> Run `node design-canvas/capture.mjs --canvas <slug> --url <url>`, then `node design-canvas/check-canvas.mjs
> --canvas <slug> --url <url>`. If a screen fails its claims on both passes, recapture just that screen with
> `--only <id>`. Repeat until both exit 0 or the same screen fails twice in a row. Report: the number captured,
> the screens that needed a second pass, and the exact text of any claim that never appeared. **Do not edit any
> file. Do not change a claim to make it pass. Do not open a screenshot.** A claim that will not come true is a
> finding to report, not a thing to fix.

That last line is the whole safety of the arrangement. A claim is the oracle; an agent that may edit claims to get
a green run has been handed the ability to delete the only proof this tool produces. The cheap model drives the
shutter and reports. Every decision about what the pictures should CONTAIN stays where the judgement is.

### 6. Prove it

```bash
node ${CLAUDE_SKILL_DIR}/scripts/check-install.mjs --target <repo root>
node design-canvas/check-canvas.mjs --canvas <slug>
```

Then typecheck, lint and format everything touched. The oracle asserts: no app shell around the canvas;
**no two screens resolve to the same address and state**; every declared screen has a frame and a capture;
every capture met its own claims, came out identical twice and has no unloaded images; every picture loads
at its captured size; every edge is attached to the frames it names **before and after a real drag and a
real zoom**; no edge crosses a frame it does not belong to; a comment round-trips to its record and its
annotated PNG; and no group holds fewer than two frames. A failure is a build error, not a note.

**Read the capture's own notes as findings, not as noise.** A count of animations "paused mid-flight" in a
whole-page run is not a spinner being tidy — on the project this came from it was `1, 1, 2` on exactly the
three screens that had blank white bands in them, and it was dismissed three runs in a row until the
reviewer pointed at the holes by hand.

Two frames pinned to different states must genuinely differ — check that from the DOM as well, because two
labels resolving to the same state is the most likely bug in the whole exercise and the canvas looks
complete while it is wrong.

### 7. Hand it over, and say what is thin before being asked

**A FIRST DELIVERY STARTS THE REVIEWER AT ZERO MARKS.** Before handing over a canvas's first build, run
`node design-canvas/adopt.mjs --canvas <slug>`. The new-screens queue is meaningful only against a baseline —
on a first capture every screen is new, so marking any is noise and marking all is the exploration-tab
mistake in the permanent views. The owner's rule, verbatim: *"you start marking them only afterwards when you
genuinely create a new screen/screens."* Agents also open the canvas page (every oracle run does), which
seeds the baseline mid-build and leaves arbitrary marks at handover — adopt-at-delivery is what makes the
queue mean what it says. From the second round on, never adopt: screens added to a delivered canvas are
exactly what the queue exists to flag.

Give the URL, the screen count, and then the honest list: states you could not reach, surfaces deliberately
left off and why, anything animated that a still frame misrepresents, and **the scaffolding you added**, so
it can be ripped out. `references/hard-parts.md` names the two problems this tool has not solved — do not
present them as solved, and do not quietly attempt them mid-build.

### 8. Work the review round, which is what the canvas is FOR

Everything above builds the instrument. This is using it, and it is where a canvas either earns its cost or
does not. Written from the first real round: thirteen comments left in one sitting, worked in one pass.

1. **"Remove this" means remove it from the CANVAS.** The reviewer wrote "remove this screen we dont need
   it" and then immediately wrote a second comment on the same screen: _"I meant remove on the canvas, not
   in the prototype."_ A comment is aimed at the picture in front of them. Never delete a route, a component
   or a page because a tile was cut, and say in the report which of the two you did.
2. **Most comments will be about the PRODUCT, not about the canvas.** Five of those thirteen were: a
   placeholder that should not exist, an owner-only view that cannot actually be reached, empty bands where
   photographs belong, wording nobody uses. That is the tool working. Expect to edit the app and recapture.
3. **When the comment is a question, answer it with a fact from the code before proposing anything.** Asked
   why a prompt existed when the page "already shows placeholders", the honest answer — the placeholders are
   a RELABEL of bands that already exist, so at zero there is nothing to relabel — turned a design question
   into a one-line deletion. Options first would have redesigned something that should not have been there.
4. **Check who can reach the state at all.** Five tiles were built on a review-only flag that grants
   owner affordances to any URL carrying it, and no real user can ever arrive at one: _"anything that's
   opened as a separate link is just how the end customer is going to see it."_ For every tile: who is
   looking, and how did they get here.
5. **Answer the blocking questions in ONE round, then work the batch, then capture once.** Recapturing per
   comment marks other comments stale for no reason and costs a build each time.
6. **`consumed` is the agent's word.** Mark each comment consumed as you ingest it, with the script — one
   command for the batch, and it names anything it could not find rather than reporting success:

   ```bash
   node design-canvas/drain.mjs --canvas <slug> --ids c40,c41,c46
   node design-canvas/drain.mjs --canvas <slug> --list     # what is still open
   ```

   By hand, one `PATCH` per comment, this has been got wrong twice — comments left undrained, and a reviewer
   looking at work he had already given. Whether the fix is good is still the reviewer's call, on the
   recaptured frame, which is what Approve and Still wrong on a stale pin are for.
7. **Report per comment id.** The pin number is what the reviewer says out loud, so the report is "c4: here
   is what it was, here is what it is now", never a prose summary of a day's work.
8. **After you recapture, the comments are the REVIEWER's again.** Each one you ingested is now waiting for
   Approve or Dismiss on a pin, counted by the pill in the corner and no longer offered for hand-off. Do not
   delete them yourself, do not mark them resolved, and do not treat your own recapture as sign-off: Approve
   is the reviewer's word and it is the only thing that removes a comment.
9. **Never run an interactive test against the reviewer's real comment file.** Copy it aside first. A
   role-based click on a popover that is re-rendering can land on the button that was there a frame ago, and
   one of them is Approve, which deletes. That is how a real comment was lost here.

## The traps

Every one of these cost real time, and a reuse will meet most of them again. **Read
`references/traps.md` before debugging anything** — the top five, so you recognise the symptom:

- **A folder outside Tailwind's content globs** has every class it uses that the app does not already use
  silently dropped. Symptom: the canvas looks like a wireframe and raising a colour value does nothing.
- **`content-visibility` brings paint containment, which clips overlays.** Symptom: captions vanish, the
  comment box is cropped at the frame edge. Anything painting outside a frame must be a **sibling**.
- **A headless page never scrolls, so lazy images never load.** Symptom: a correct layout with no
  photographs in it, 11kb, every claim passing. A picture that passes every check and is not the design.
- **Open lands on the wrong state, because the pin is client-only and the server is not.** Symptom: every
  frame's Open button shows the route's DEFAULT state — a real, plausible, wrong screen, for as long as
  hydration takes, which on a cold dev route is seconds. No automated check can see it: the capture waits for
  the settled page, so it always photographs the right one. The fix is in `project/canvas-state-pin.tsx` and it
  has to be markup rather than React, because the paint happens before any component can decide anything —
  trap 17 has the code. **A canvas whose Open button lies is worse than a canvas with no Open button**, which
  is the whole reason the frames were allowed to become pictures.
- **A JS-driven animation cannot be frozen by a stylesheet.** Symptom: `never captured the same picture twice
  — still moving`, on every screen holding one surface, with all claims passing. GSAP and anything else that
  animates by writing inline styles from its own ticker is invisible to `document.getAnimations()`, so the
  capture's freeze step cannot see it and the "finished" wait never ends. Measured: five of nine frames failed
  on one 40px illustration with `repeat: -1`. The fix is in the app, not the tool — freeze it in its END state
  when the URL carries the canvas param, read from `window.location.search` so deleting the canvas cannot break
  the file. Freeze it fully drawn, never dimmed or disabled: a still frame of a state no user ever sees is the
  one thing this tool must not produce.
- **A scroll-driven reveal photographs as a white hole.** Symptom: a whole-page shot with a band of pure
  white where a real section belongs, correct everywhere else, fine in the browser. The band fades up on
  `animation-timeline: view()` and a capture never scrolls. Fixing it in JavaScript works when you test it
  and reverts at the shutter, which is the part that will cost you an hour — the trap file has both.
- **An icon 4px wide.** Symptom: a glyph in a square button renders as a sliver. The core's `cn` is a plain
  joiner with no Tailwind conflict resolution, so a `px-0` meant to override a shared `px-3.5` simply joins
  it and loses. Nothing in the core may write a utility expecting to override another, and every icon is a
  component with width and height attributes rather than classes.
- **A rAF handle cancelled but not nulled in cleanup** dies in React's development double-mount. Symptom:
  every eased interaction is dead while dragging still works.
- **An oracle that does not set the view it asserts against.** Symptom: none — the edge assertions pass
  against a view that draws zero edges, which is worse than failing.

## Where this fits, and where it stops

- **An incumbent exists → run this first.** Redesigning something that is already built starts with the agreed
  surface list and the baseline every alternative is measured against, and that is what this produces. Any
  exploration that skips it is inventing the thing it claims to be improving.
- **Nothing to photograph → this does not apply.** A surface with no route in a running app cannot be captured,
  and a canvas of frames that do not exist yet is a mockup gallery with extra steps. Say so rather than running
  this out of habit. This is the tool's real limit, not a caveat.
- **The exploration funnel belongs to this skill.** Five directions in round one, three variations of whichever
  survived in round two, one refined design after that; a variation is an ALTERNATIVE, never a state of the same
  option; and every round is a declaration, not a gallery kept somewhere else. It is written out in the
  exploration section above and needs nothing outside this file.
- **The canvas records what the surfaces ARE, never why they are that way.** The reasoning behind a decision
  belongs wherever the project keeps its decisions; a frame is evidence of a state, not of an argument.
- **impeccable** — **required**, not optional, and required BEFORE capturing rather than after: every
  exploration direction and every new surface goes through it first. See the gate above. Also for judging and
  fixing the surfaces an existing canvas exposes, one at a time. If a setup does not have it, nothing here
  breaks — but the gate is why the directions are worth reviewing at all.

## Trust the reviewer over the checker

Every automated assertion here can pass on a canvas a person sees is broken: measured once, a run came out
green with three white holes in it, four tiles nobody could interpret and five built on a state the app could
not reach. The pipeline's own notes had been saying so for three runs and nobody read them.

So: read your tool's notes, and hand the pictures to a person. The checks prove a frame is a settled picture
of the state it claims. Whether the design is right is not a thing they can answer.
