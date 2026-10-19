# The cognitive-load lens: progressive disclosure and the three levers

The second of the two lenses the exploration workflow runs before composing a round (see
SKILL.md, the diagnosis step). For task-completion product UI, "conversion" means the user
finishing the task they came for. The model is the same either way: abandonment is the failure.
Generic by design: nothing in this file is about any one project.

## The model

Users abandon flows not because they don't want to finish, but because thinking is tiring.
Every unnecessary decision, unfamiliar pattern, or piece of visual noise drains the finite
mental budget users arrive with. When that budget runs out, they leave.

---

## Two kinds of load

There are two kinds of cognitive load. Only one is your problem to solve.

**Intrinsic load:** the unavoidable thinking required to understand the offer or complete the
task. This is why the user showed up. Don't try to eliminate it; just don't add to it.

**Extraneous load:** everything else. Processing that consumes mental resources without
helping the user get closer to their goal. This is where tasks get abandoned. Your job is to
find it and cut it.

---

## The audit: three levers

### Lever 1: cut visual clutter

Clutter isn't just about aesthetics. Every redundant element forces the brain to evaluate it
before discarding it. That evaluation costs something.

**Ask of every element on screen:**
- Does this help the user understand what to do or why to do it?
- If removed, would anything important be lost?

**High-cost clutter patterns:**
- Redundant navigation links that go to the same place
- Decorative images that don't clarify or reinforce the value proposition
- Typography variation (size, weight, color) applied without semantic meaning: it signals
  hierarchy that isn't there, so the brain has to reconcile the mismatch
- Several competing calls to action at the same decision point
- Legal or compliance copy surfaced at the wrong moment (present it when it's relevant, not by
  default)

**Principle:** every element you remove that isn't earning its place is a free cognitive budget
increase for the elements that matter.

---

### Lever 2: build on existing mental models

Users arrive with expectations shaped by every other product they've used. When your interface
matches those expectations, they don't have to learn; they just do. When it doesn't, they
pause to figure it out. Pauses kill momentum, and momentum is what gets a task finished.

**Patterns users already know (use them):**
- Primary action = most visually prominent button
- Destructive actions (delete, cancel) = less prominent, often text links
- Form fields = labeled above or inside the field, not beside it
- Errors = red, warnings = yellow, success = green
- Progress = left to right, or top to bottom
- Trust signals (security badges, testimonials) = near the point of commitment

**Questions to identify mental model mismatches:**
- Is the label for this element what users would call it?
- Is the primary action where users would expect to find it?
- Does this layout pattern match what users have seen on comparable products?
- Are we using interaction patterns (hover states, modals, accordions) in conventional ways?

**Principle:** familiarity is a feature. Novelty in UI adds cognitive cost without adding value.
Innovate on the product; be conventional about the interface.

---

### Lever 3: offload tasks from the user

Every moment a user has to remember something, calculate something, or make a decision they
didn't come here to make is a moment they might leave. The question isn't just "is this
clear?" but "do they even have to do this?"

**Task offloading opportunities:**

| User task | Offloaded alternative |
|---|---|
| Remember what they entered earlier | Show it again on confirmation or summary screens |
| Choose from options they don't understand | Use a smart default; let them override |
| Type something that can be inferred | Fill it in from context (location, account data, previous input) |
| Read to understand | Show an image or example instead |
| Decide between equally unfamiliar options | Recommend one: "Most popular", "Best for your situation" |
| Count or calculate | Do the math for them (show totals and comparisons) |
| Remember what step they're on | Show a progress indicator |

**Questions to identify offloading opportunities:**
- Is there any information we already have that we're asking users to enter again?
- Are there decisions in this flow that we could make for most users?
- Is there math, comparison, or calculation happening in the user's head?
- Is the user holding anything in memory between steps?

**Principle:** the best form field is the one that doesn't exist. The best decision is the one
the user doesn't have to make.

---

## Audit format

When reviewing a UI, flow, or screen, structure your output as:

### 1. Extraneous load found
List specific elements or patterns that are adding cognitive cost without helping the user. Be
specific: name the element and explain the cost it's creating.

### 2. Mental model gaps
Identify any places where the interface departs from convention in a way that requires users
to stop and learn. Flag label mismatches, unexpected interaction patterns, or layout choices
that conflict with established expectations.

### 3. Offloading opportunities
Call out moments where the user is being asked to do something the product could do for them.
Rank by impact on finishing the task, if possible.

### 4. Priority recommendations
Give 3 to 5 concrete changes in priority order. Each recommendation should:
- Name the specific element or step
- Describe the change
- Explain the cognitive cost it removes
- Note the expected impact (high, medium, low)

---

## Decision heuristics

Use these to quickly triage a design under review:

- **The squint test**: squint at the screen. What do you see first? Is that what the user
  needs to act on?
- **The first-time test**: would a user seeing this for the first time know what to do within
  3 seconds?
- **The subtraction test**: remove one element. Does anything important break? If not, remove
  it.
- **The phone call test**: could a user describe this screen to someone on the phone without
  confusion? If not, it's too complex.
- **The memory test**: at any point in the flow, is the user carrying information forward in
  their head that we could display for them instead?

---

## What not to cut

Not all friction is bad. Some cognitive load is intrinsic: it's the thing the user came to
think about.

- **Don't simplify the offer.** If the product is genuinely complex, the goal is to present
  it clearly, not to hide that complexity
- **Don't remove confirmation steps** for high-stakes, irreversible actions. Friction here is
  a feature (it prevents errors)
- **Don't default-select** in ways that could mislead or harm. Smart defaults must be honest
  defaults

---

## Notes on copy

Cognitive load isn't just visual; it's linguistic too. When reviewing copy:

- **Shorter sentences reduce parsing load:** break long sentences into shorter ones
- **Active voice is processed faster** than passive voice
- **Plain words over technical terms,** unless the audience is expert and the jargon carries
  precision
- **Front-load the key information:** put the action or benefit first, conditions second
- **Avoid negatives:** "Don't miss out" requires parsing; "Offer ends tonight" is direct
