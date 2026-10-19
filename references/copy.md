# The words a canvas draws

Read this before writing a declaration. `tool/copy-rules.mjs` checks the caps and every rule below that a machine can
decide, and `check-canvas.mjs` fails on a violation.

The standard is **ASD-STE100, Simplified Technical English**, chosen for the reason it exists: the reader
is a teammate opening the index cold, a developer looking for the state they have to build, or the
reviewer six weeks later. None of them was in the room.

## The slots, and what fits in each

| Slot                        | Cap                      | Example                                        |
| --------------------------- | ------------------------ | ---------------------------------------------- |
| `declaration.title`         | 4 words, no `,` `:`      | `Trip Planner`                                 |
| `declaration.note`          | 25 words, 2 sentences    | `Where a trip takes shape. One page holds every stop and every note.` |
| `flow.title`                | 6 words                  | `When The Provider Can Do It`                  |
| `flow.note`                 | 25 words, 2 sentences    | `When the calendar provider allows it, step 1 offers one press instead of a form to fill.` |
| `screen.label`              | 6 words                  | `A File That Would Not Upload`                 |
| `screen.note`               | 20 words, **1 sentence** | `The prompt that stops an oversized film before it uploads`                                        |
| `kinds[].whatBelongs`       | 14 words, a fragment     | `an address that failed, stopped, or was canceled`                                                 |
| `edge.label`                | 12 to 24 characters      | `Presses Connect`                              |

A **title is a name**, not a sentence about the thing. `Trips` is a name;
`Trips, every surface, live` is a name with a sentence stuck to it, and the sentence belongs in
the note. This matters beyond neatness: the index card and the canvas switcher both draw `title`, so a
title that is really two things shows up as two different names for one canvas.

## The rules

1. **One idea per sentence.** A screen note is one sentence. If it needs two, the second one is usually
   the reason it was written, and the reason belongs in a code comment rather than on the canvas.
2. **Active voice.** `The provider adds the record`, never `the record is added by the provider`.
3. **One word, one meaning.** Pick one word for each kind of person in the product and keep it; the
   check does not know the product's words. A photographed screen is a **frame**, never a screenshot or a thumbnail.
4. **No intensifiers, no marketing, no hedging.** `simply`, `just`, `really`, `very`, `actually`,
   `powerful`, `seamless`, `intuitive`, `various`, `several`, `stuff` all get deleted. If a note says
   "several", say how many.
5. **No semicolons.** A semicolon means the sentence is doing two jobs. Use two sentences, or a comma.
6. **Short phrases ASD-STE100 replaces:** `in order to` → `to`, `prior to` → `before`,
   `is able to` → `can`, `due to the fact that` → `because`.

## What the checker cannot do

It cannot tell whether the words are true, whether the note is worth reading, or whether a label
describes the frame above it. The claims in `expect` cover the last of those; the first two are what a
reviewer is for. A canvas that passes this check can still be useless, so read your own note once and
ask what a stranger would learn from it.
