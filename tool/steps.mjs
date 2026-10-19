/**
 * design-canvas — CLICK STEPS: a screen says what a person does to the page before the shutter, and the capture and the
 * oracle's Open pass do exactly that, through this one module.
 *
 * A dialog opened by local state, a menu, a tab or a field with something typed in it has no URL, and a `?canvas=` pin needs
 * app code. So a screen may declare a short list of steps (`CanvasScreen.steps` in core/types.ts) and nothing in the app has
 * to know the canvas exists.
 *
 * EIGHT STEP TYPES AND NO NINTH. An unknown one THROWS, here, in the capture, the oracle and the preflight alike, before
 * anything is pressed. A step that silently did nothing would photograph the resting page under a label that claims a
 * dialog, and every claim written for the dialog would then fail for a reason nobody can see.
 *
 *   { click: "Adjust" }                        a control by its accessible name: button, link, tab, menu item, option,
 *                                              checkbox, radio or switch (`role` narrows it, `within` is a CSS scope,
 *                                              `nth` picks one of several, -1 is the last). Several matches WITHOUT `nth` is an
 *                                              error: a step that picks "whichever came first" drifts the day a twin appears.
 *   { fill: "Guests", with: "12" }             a field by its label, placeholder or accessible name.
 *   { press: "Enter", on: "Guests" }           a key; `on` focuses a field first.
 *   { waitText: "Export Tasks" }               until the text is on the open surface: the dialog stack when anything is
 *                                              open, else the page. The SAME scope the claims are read from (trap 24).
 *   { closeWelcome: "Got it" }                 a first-run dialog: pressed if it is showing, skipped without a word if not,
 *   { closeWelcome: true }                     because it is a condition of the browser's storage and not of the design.
 *                                              `true` performs the click steps of design-canvas/dismiss.json.
 *   { hover: "Add Photo" }                     the pointer over a control, and left there: a hover state, a tooltip's trigger.
 *   { scroll: "css=[data-testid=list]" }       the target brought to the top of whatever scrolls around it, so a frame can show
 *   { scroll: "css=.table", to: 330 }          the part it is about. With `to`, the target IS the scroller and is set to that
 *                                              many pixels from its own top.
 *   { waitFor: "css=#loaded", seconds: 60 }    until an element is showing (30 seconds unless `seconds` says, 300 at most): the
 *                                              wait for a thing that is not text, and the one a dev server's first compile needs.
 *
 * A TARGET IS A NAME OR A SELECTOR. `click`, `fill`, `hover`, `scroll`, `waitFor` and `press.on` take either the accessible name
 * (exact, as before) or `css=<selector>`, handed to Playwright's own CSS engine, so `css=[data-testid=new-task-cta]` and
 * `css=button:has-text("Save")` both work. The names came first because a design is judged by what a person reads; the selectors
 * exist because a large app's controls are mostly found by a test id.
 * `role` has nothing to narrow on a selector and is refused there; `within` and `nth` still apply.
 *
 * At most twelve steps: a longer list is a script, and a script belongs in the app as a pin or in a test. Main frame only, for
 * the reason the origins are main-frame only: the page the steps press is the page the picture is of.
 *
 * A STEP THAT CANNOT BE DONE IS A `StepError`, and it is final. The control is not there, two are, the text never came: the
 * declaration no longer describes the page (or the server was too slow to show it), and doing the same thing again with the
 * same patience finds the same nothing. The capture lists these apart from a frame that failed its claims, names the step, and
 * never runs them again.
 *
 * DELETE WITH: the design-canvas/ folder.
 */
import { clickDismissals } from "./browser-guards.mjs";

/** Every step type, in the order the docs list them. */
export const STEP_TYPES = ["click", "fill", "press", "waitText", "closeWelcome", "hover", "scroll", "waitFor"];

/** The keys each type takes besides its own. Anything else on a step is a typo the run refuses rather than ignores. */
const EXTRA_KEYS = {
  click: ["role", "within", "nth"],
  fill: ["with", "role", "within"],
  press: ["on"],
  waitText: [],
  closeWelcome: [],
  hover: ["role", "within", "nth"],
  scroll: ["role", "within", "nth", "to"],
  waitFor: ["role", "within", "seconds"],
};

/** What `click` looks for when no role is named. */
const CLICK_ROLES = ["button", "link", "tab", "menuitem", "option", "checkbox", "radio", "switch"];
/** What `fill` and `press.on` look for when no role is named, after label and placeholder. */
const FIELD_ROLES = ["textbox", "searchbox", "combobox", "spinbutton"];

/** The longest list a screen may carry. */
export const MAX_STEPS = 12;

/** How long a control may take to appear (hydration, a dialog animating in) before the step is an error. */
const APPEAR_MS = 10_000;
/** How long a `waitText` may wait. */
const TEXT_MS = 15_000;
/** How long a `closeWelcome` looks for something to close. A dialog that is not showing by then is not going to. */
const WELCOME_MS = 2_000;
/** How long a `waitFor` waits unless it says, and the most it may ask for. */
export const WAIT_FOR_SECONDS = 30;
export const WAIT_FOR_MAX_SECONDS = 300;

/** The prefix that makes a target a selector. */
const CSS = "css=";
export const isCssTarget = (name) => typeof name === "string" && name.startsWith(CSS);
const cssOf = (name) => name.slice(CSS.length).trim();

/**
 * A STEP THAT COULD NOT BE DONE. `kind` says why in one word: `missing` (nothing showing, or `nth` past the end), `ambiguous`
 * (several and no `nth`), `text` (a `waitText` that never came), `failed` (the browser refused the action itself). `step` is
 * its position, from 1. See the header: every one of them is final.
 */
export class StepError extends Error {
  constructor(message, { kind = "failed", step } = {}) {
    super(message);
    this.name = "StepError";
    this.kind = kind;
    this.step = step;
  }
}

/** Which step this is, in words: the thing a failure line starts with. */
export function describeStep(step) {
  const type = STEP_TYPES.find((one) => step && Object.prototype.hasOwnProperty.call(step, one));
  if (!type) return "unknown step";
  if (type === "fill") return `fill ${JSON.stringify(step.fill)} with ${JSON.stringify(step.with)}`;
  if (type === "press") return `press ${step.press}${step.on ? ` on ${JSON.stringify(step.on)}` : ""}`;
  if (type === "closeWelcome") return step.closeWelcome === true ? "closeWelcome (dismiss.json)" : `closeWelcome ${JSON.stringify(step.closeWelcome)}`;
  if (type === "scroll") return `scroll ${JSON.stringify(step.scroll)}${step.to !== undefined ? ` to ${step.to}` : ""}`;
  if (type === "waitFor") return `waitFor ${JSON.stringify(step.waitFor)}${step.seconds !== undefined ? ` for up to ${step.seconds}s` : ""}`;
  return `${type} ${JSON.stringify(step[type])}`;
}

/** The whole list in one line, for a log and for the preflight. */
export function describeSteps(steps) {
  return (steps ?? []).map(describeStep).join(", ");
}

const isName = (value) => typeof value === "string" && value.trim().length > 0;

/**
 * VALIDATE A LIST OF STEPS AND RETURN IT, or throw with the position and the reason. Runs before a browser exists, so
 * a typo in the tenth step fails the run in milliseconds and not after nine presses.
 */
export function parseSteps(steps, where = "a screen") {
  if (steps === undefined || steps === null) return [];
  const fail = (at, message) => {
    throw new Error(`${where}: steps[${at}] ${message}`);
  };
  if (!Array.isArray(steps)) throw new Error(`${where}: steps must be a list of steps, got ${typeof steps}`);
  if (steps.length > MAX_STEPS)
    throw new Error(`${where}: ${steps.length} steps is a script, not a step list (at most ${MAX_STEPS}); pin the state in the app instead`);
  steps.forEach((step, at) => {
    if (!step || typeof step !== "object" || Array.isArray(step)) return fail(at, `is not an object like { click: "Name" }`);
    const present = Object.keys(step).filter((key) => STEP_TYPES.includes(key));
    if (present.length === 0) {
      const first = Object.keys(step)[0] ?? "(empty)";
      return fail(at, `has an unknown step type "${first}". The step types are: ${STEP_TYPES.join(", ")}`);
    }
    if (present.length > 1) return fail(at, `names ${present.join(" and ")}: one step does one thing`);
    const type = present[0];
    const allowed = new Set([type, ...EXTRA_KEYS[type]]);
    for (const key of Object.keys(step))
      if (!allowed.has(key)) return fail(at, `${type} does not take "${key}". It takes: ${[...allowed].join(", ")}`);
    if (type === "closeWelcome") {
      if (step.closeWelcome !== true && !isName(step.closeWelcome))
        return fail(at, `closeWelcome takes true (the dismiss.json clicks) or the exact name of the button`);
    } else if (!isName(step[type])) {
      return fail(at, `${type} needs the exact text to work with, as a non-empty string`);
    }
    if (type === "fill" && typeof step.with !== "string") return fail(at, `fill needs "with": the text to type`);
    for (const named of [type === "closeWelcome" || type === "waitText" ? null : step[type], type === "press" ? step.on : null]) {
      if (isCssTarget(named) && cssOf(named).length === 0) return fail(at, `${type} needs a selector after "css="`);
    }
    if (step.role !== undefined && !isName(step.role)) return fail(at, `role must be a role name like "button"`);
    if (step.role !== undefined && isCssTarget(step[type]))
      return fail(at, `${type} takes no role with a css= target: a role narrows a lookup by accessible name, and a selector has none to narrow`);
    if (step.within !== undefined && !isName(step.within)) return fail(at, `within must be a CSS selector`);
    if (step.on !== undefined && !isName(step.on)) return fail(at, `on must be the name of a field`);
    if (step.nth !== undefined && !(Number.isInteger(step.nth) && (step.nth >= 0 || step.nth === -1)))
      return fail(at, `nth counts from 0, and -1 is the last one`);
    if (step.seconds !== undefined && !(Number.isInteger(step.seconds) && step.seconds >= 1 && step.seconds <= WAIT_FOR_MAX_SECONDS))
      return fail(at, `seconds is how long to wait, a whole number from 1 to ${WAIT_FOR_MAX_SECONDS}`);
    if (step.to !== undefined && !(Number.isInteger(step.to) && step.to >= 0)) return fail(at, `to is a scroll position in pixels from the top, 0 or more`);
  });
  return steps;
}

/**
 * THE OPEN SURFACE'S TEXT, run inside a page: the ONE reader the capture (`readPage`), the oracle (`readSurface`) and this
 * module share, because trap 24 is what three copies of it cost (change one scope and change the others in the same edit).
 *
 * Nothing open: the whole body, exactly as always, which already holds every portal (a menu opened on a plain page is in it).
 * A dialog open: the open dialog stack, never the page behind the scrim (trap 24), AND the floating layers in front of it. A
 * menu, a select's list or a popover's wrapper is portalled to the body beside the dialog, not inside it, so reading the stack
 * alone left every claim about a menu opened over a dialog unprovable, as Radix menus show. Radix
 * marks the dialog `aria-hidden` when a MODAL menu opens over it, which once dropped the dialog and fell back to the body (the
 * page behind counted too); that hidden dialog is now read with the layer in front of it; a
 * non-modal one leaves the dialog in place and its menu outside the stack. Layers inside a dialog are already in its text and
 * are not read twice.
 */
export const SURFACE_TEXT = () => {
  const visible = (el) => {
    const box = el.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  };
  const shown = (el) => el.getAttribute("aria-hidden") !== "true" && visible(el);
  /* A menu or a list counts only when it floats (fixed, or in an absolutely placed portal at the body's top level): a list that
     is part of the page behind the dialog is still the page behind it. A Radix popper wrapper is fixed by construction. */
  const floats = (el) => {
    for (let at = el; at && at !== document.body; at = at.parentElement) {
      const position = getComputedStyle(at).position;
      if (position === "fixed") return true;
      if (at.parentElement === document.body && position === "absolute") return true;
    }
    return false;
  };
  const layersOver = (dialogs) => {
    const floating = Array.from(
      document.querySelectorAll('[data-radix-popper-content-wrapper],[role="menu"],[role="listbox"]'),
    ).filter((el) => shown(el) && floats(el) && !dialogs.some((dialog) => dialog.contains(el)));
    return floating.filter((el) => !floating.some((other) => other !== el && other.contains(el)));
  };
  const read = (els) => els.map((el) => el.innerText ?? "").join("\n");
  const dialogs = Array.from(document.querySelectorAll('[role="dialog"],[role="alertdialog"]'));
  const open = dialogs.filter(shown);
  if (open.length > 0) return read([...open, ...layersOver(open)]);
  /* THE STACK IS EMPTY ONLY BECAUSE A MODAL LAYER HID IT: a modal Radix menu, list or popover marks every dialog under it
     `aria-hidden`. Those dialogs are still open and still the surface, with the layer in front of them, and the page behind
     is still not evidence. The body is the surface only when no dialog is on the page at all (or one is hidden with nothing
     floating over it, exactly as before). */
  const hidden = dialogs.filter((el) => el.getAttribute("aria-hidden") === "true" && visible(el));
  if (hidden.length > 0) {
    const layers = layersOver(hidden);
    if (layers.length > 0) return read([...hidden, ...layers]);
  }
  return document.body?.innerText ?? "";
};

/** THE TEXT A CLAIM IS READ FROM, as this module needs it: `SURFACE_TEXT` across every same-origin frame. */
export async function readSurfaceText(page) {
  let text = "";
  for (const frame of page.frames())
    text += `${await frame
      .evaluate(SURFACE_TEXT)
      .catch(() => "")}\n`;
  return text;
}

/** The scope a step looks inside: the page, or the first element matching `within`. */
const scopeOf = (page, step) => (step.within ? page.locator(step.within).first() : page);

/** Every visible locator the candidates resolve to, in document order per candidate. */
async function visibleOf(locators) {
  const found = [];
  for (const locator of locators) {
    const count = await locator.count().catch(() => 0);
    for (let at = 0; at < count; at += 1) {
      const one = locator.nth(at);
      if (await one.isVisible().catch(() => false)) found.push(one);
    }
  }
  return found;
}

/** Poll until `find` yields something, or until the time is up (then the last answer, which may be empty). */
async function until(page, find, ms) {
  const limit = Date.now() + ms;
  for (;;) {
    const found = await find();
    if (found.length > 0 || Date.now() >= limit) return found;
    await page.waitForTimeout(250);
  }
}

/** The accessible names of what IS showing, so a failed step says what it could have meant. */
async function namesShowing(page, roles) {
  const names = new Set();
  for (const role of roles) {
    const all = page.getByRole(role);
    const count = Math.min(await all.count().catch(() => 0), 40);
    for (let at = 0; at < count; at += 1) {
      const one = all.nth(at);
      if (!(await one.isVisible().catch(() => false))) continue;
      const name = (await one.innerText().catch(() => "")).trim().replace(/\s+/g, " ");
      if (name && name.length < 50) names.add(name);
    }
  }
  return [...names].slice(0, 8);
}

/**
 * THE VISIBLE MATCHES FOR A TARGET, waiting up to `ms` for the first one to show. `groups` is a list of lists of locators, tried
 * IN ORDER: the first group with anything visible answers. One element can match a role AND a label, and counting it twice would
 * call a unique control ambiguous, so what is searched together is only what cannot overlap (the roles), and the looser lookups
 * (label, placeholder) are a later group.
 */
async function visibleMatches(page, groups, ms) {
  const first = async () => {
    for (const group of groups) {
      const found = await visibleOf(group);
      if (found.length > 0) return found;
    }
    return [];
  };
  return until(page, first, ms);
}

/** What a failure calls the target: `button named "Save"`, or `element matching css=#save`. */
const targetWords = (name, label) => (isCssTarget(name) ? `element matching ${name}` : `${label} named "${name}"`);

/**
 * ONE CONTROL, or an error that says why not: nothing showing, or several without an `nth` to choose.
 */
async function oneControl(page, step, name, label, groups, rolesForHelp) {
  const found = await visibleMatches(page, groups, APPEAR_MS);
  const css = isCssTarget(name);
  if (found.length === 0) {
    const showing = css ? [] : await namesShowing(page, rolesForHelp);
    throw new StepError(
      `no visible ${targetWords(name, label)}${step.within ? ` inside ${step.within}` : ""}` +
        (showing.length > 0 ? `. What is showing: ${showing.map((one) => `"${one}"`).join(", ")}` : ""),
      { kind: "missing" },
    );
  }
  if (step.nth !== undefined) {
    const at = step.nth === -1 ? found.length - 1 : step.nth;
    if (!found[at])
      throw new StepError(`nth ${step.nth} asked for, and only ${found.length} ${css ? "element(s) matching" : `${label}(s) named`} ${css ? name : `"${name}"`} are showing`, { kind: "missing" });
    return found[at];
  }
  if (found.length > 1)
    throw new StepError(
      `${found.length} visible ${css ? `elements match ${name}` : `${label}s are named "${name}"`}: add nth (from 0) or within (a CSS scope) to say which; nth -1 is the last`,
      { kind: "ambiguous" },
    );
  return found[0];
}

/** The lookups for a control named by its role. */
const byRole = (scope, name, roles) => [roles.map((role) => scope.getByRole(role, { name, exact: true }))];
/** The lookups for a field: its role first, then its label, then its placeholder. */
const byField = (scope, name, roles) => [
  roles.map((role) => scope.getByRole(role, { name, exact: true })),
  [scope.getByLabel(name, { exact: true })],
  [scope.getByPlaceholder(name, { exact: true })],
];
/** A `css=` target as a Playwright locator: the one resolver for a selector, used by the steps and by the capture's origins. */
export const cssLocator = (scope, name) => scope.locator(`css=${cssOf(name)}`);
/** The lookup for a target named by a selector: the one thing it can be. */
const bySelector = (scope, name) => [[cssLocator(scope, name)]];

/** The lookups for a control (click, hover, scroll, waitFor): a selector, or the roles it may have. */
const controlLookups = (scope, name, roles) => (isCssTarget(name) ? bySelector(scope, name) : byRole(scope, name, roles));
/** The lookups for a field (fill, press.on): a selector, or its role, label or placeholder. */
const fieldLookups = (scope, name, roles) => (isCssTarget(name) ? bySelector(scope, name) : byField(scope, name, roles));

/**
 * DO THE STEPS, in order, on this page. The caller has validated them (`parseSteps`) and waits for the page to settle
 * again afterwards; this only presses things. Any failure is thrown as a StepError with the step's position and what it was
 * doing, so the capture's failure line reads `home-settings: step 2 (click "Open settings"): no visible button named ...`.
 *
 * `dismissals` is what `loadDismissals` returned, for `closeWelcome: true`.
 */
export async function runSteps(page, steps, { dismissals } = {}) {
  for (const [at, step] of steps.entries()) {
    const label = `step ${at + 1} (${describeStep(step)})`;
    try {
      if ("click" in step) {
        const roles = step.role ? [step.role] : CLICK_ROLES;
        const target = await oneControl(page, step, step.click, step.role ?? "control", controlLookups(scopeOf(page, step), step.click, roles), roles.slice(0, 3));
        await target.click({ timeout: 5_000 });
      } else if ("fill" in step) {
        const roles = step.role ? [step.role] : FIELD_ROLES;
        const target = await oneControl(page, step, step.fill, "field", fieldLookups(scopeOf(page, step), step.fill, roles), roles);
        await target.fill(step.with, { timeout: 5_000 });
      } else if ("press" in step) {
        if (step.on) {
          const target = await oneControl(page, {}, step.on, "field", fieldLookups(page, step.on, FIELD_ROLES), FIELD_ROLES);
          await target.focus({ timeout: 5_000 });
        }
        await page.keyboard.press(step.press);
      } else if ("hover" in step) {
        const roles = step.role ? [step.role] : CLICK_ROLES;
        const target = await oneControl(page, step, step.hover, step.role ?? "control", controlLookups(scopeOf(page, step), step.hover, roles), roles.slice(0, 3));
        await target.hover({ timeout: 5_000 });
      } else if ("scroll" in step) {
        const roles = step.role ? [step.role] : CLICK_ROLES;
        const target = await oneControl(page, step, step.scroll, step.role ?? "control", controlLookups(scopeOf(page, step), step.scroll, roles), roles.slice(0, 3));
        if (step.to !== undefined) await target.evaluate((el, top) => el.scrollTo({ top, behavior: "instant" }), step.to);
        else await target.evaluate((el) => el.scrollIntoView({ block: "start", inline: "nearest", behavior: "instant" }));
      } else if ("waitFor" in step) {
        const roles = step.role ? [step.role] : CLICK_ROLES;
        const seconds = step.seconds ?? WAIT_FOR_SECONDS;
        const found = await visibleMatches(page, controlLookups(scopeOf(page, step), step.waitFor, roles), seconds * 1000);
        if (found.length === 0)
          throw new StepError(`no visible ${targetWords(step.waitFor, step.role ?? "control")}${step.within ? ` inside ${step.within}` : ""} within ${seconds}s`, { kind: "missing" });
      } else if ("waitText" in step) {
        const limit = Date.now() + TEXT_MS;
        let text = await readSurfaceText(page);
        while (!text.includes(step.waitText) && Date.now() < limit) {
          await page.waitForTimeout(250);
          text = await readSurfaceText(page);
        }
        if (!text.includes(step.waitText)) throw new StepError(`"${step.waitText}" never appeared on the open surface within ${TEXT_MS / 1000}s`, { kind: "text" });
      } else if ("closeWelcome" in step) {
        if (step.closeWelcome === true) {
          if (!dismissals?.clicks?.length)
            throw new StepError(`closeWelcome: true performs the click steps of design-canvas/dismiss.json and this project has none: name the button instead, closeWelcome: "Got it"`, { kind: "failed" });
          const limit = Date.now() + WELCOME_MS;
          while ((await clickDismissals(page, dismissals.clicks)).length === 0 && Date.now() < limit) await page.waitForTimeout(250);
        } else {
          const limit = Date.now() + WELCOME_MS;
          for (;;) {
            const showing = await visibleOf(["button", "link"].map((role) => page.getByRole(role, { name: step.closeWelcome, exact: true })));
            if (showing.length > 0) {
              await showing[0].click({ timeout: 5_000 });
              break;
            }
            if (Date.now() >= limit) break;
            await page.waitForTimeout(250);
          }
        }
      }
    } catch (error) {
      const first = String(error?.message ?? error).split("\n")[0];
      throw new StepError(`${label}: ${first}`, { kind: error instanceof StepError ? error.kind : "failed", step: at + 1 });
    }
    /* A beat for the page to react before the next press: a dialog mounting, a field enabling. */
    await page.waitForTimeout(200);
  }
}
