# The words a canvas draws

Read this before writing a declaration. `tool/copy-rules.mjs` checks every rule here mechanically and
`check-canvas.mjs` fails on a violation, so a canvas cannot ship copy that breaks them.

The standard is **ASD-STE100, Simplified Technical English**, chosen for the reason it exists: the reader
is a teammate opening the index cold, a developer looking for the state they have to build, or the
reviewer six weeks later. None of them was in the room.

## The slots, and what fits in each

| Slot                        | Case         | Cap                      | Example                                        |
| --------------------------- | ------------ | ------------------------ | ---------------------------------------------- |
| `declaration.title`         | Title Case   | 4 words, no `,` `:` `—`  | `Custom Domain`                                |
| `declaration.note`          | Sentence     | 25 words, 2 sentences    | `Where the storefront's address stops being ours. One record at the registrar does the whole job.` |
| `flow.title`                | Title Case   | 6 words                  | `When The Provider Can Do It`                  |
| `flow.note`                 | Sentence     | 25 words, 2 sentences    | `When the provider supports Domain Connect, step 1 offers one press instead of a record to copy.` |
| `screen.label`              | Title Case   | 6 words                  | `A File That Would Not Upload`                 |
| `screen.note`               | Sentence     | 20 words, **1 sentence** | `The prompt that stops an oversized film before it uploads`                                        |
| `kinds[].whatBelongs`       | Sentence     | 14 words, a fragment     | `an address that failed, stopped, or was canceled`                                                 |
| `edge.label`                | Title Case   | 12 to 24 characters      | `Presses Connect`                              |

A **title is a name**, not a sentence about the thing. `Online Store` is a name;
`Online Store — every surface, live` is a name with a sentence stuck to it, and the sentence belongs in
the note. This matters beyond neatness: the index card and the canvas switcher both draw `title`, so a
title that is really two things shows up as two different names for one canvas.

## The rules

1. **One idea per sentence.** A screen note is one sentence. If it needs two, the second one is usually
   the reason it was written, and the reason belongs in a code comment rather than on the canvas.
2. **Active voice.** `The provider adds the record`, never `the record is added by the provider`.
3. **One word, one meaning.** The people in this product are the **jeweler** and the **customer** —
   never user, seller, merchant, buyer, shopper or visitor. A photographed screen is a **frame**, never
   a screenshot or a thumbnail.
4. **No intensifiers, no marketing, no hedging.** `simply`, `just`, `really`, `very`, `actually`,
   `powerful`, `seamless`, `intuitive`, `various`, `several`, `stuff` all get deleted. If a note says
   "several", say how many.
5. **Title Case on names and labels, sentence case on notes.** Minor words (`a`, `the`, `and`, `of`,
   `on`, `to`, `with`, …) stay lower unless they open or close the label. Verbs and negations do not:
   `It Did Not Go Through`.
6. **American spelling.** canceled, traveling, recognize, color, organize.
7. **No dashes as punctuation and no semicolons.** Both mean the sentence is doing two jobs. Use two
   sentences, or a comma.
8. **Short phrases ASD-STE100 replaces:** `in order to` → `to`, `prior to` → `before`,
   `is able to` → `can`, `due to the fact that` → `because`.

## What the checker cannot do

It cannot tell whether the words are TRUE, whether the note is worth reading, or whether a label
describes the frame above it. The claims in `expect` cover the last of those; the first two are what a
reviewer is for. A canvas that passes this check can still be useless, so read your own note once and
ask what a stranger would learn from it.
