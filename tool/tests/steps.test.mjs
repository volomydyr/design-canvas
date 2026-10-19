/**
 * Tests for the three step types and the selector targets added to `steps.mjs` (hover, scroll, waitFor, `css=`, `nth: -1`) and
 * for the typed error a step that cannot be done is thrown as. The five original types are held by `round.test.mjs`.
 *
 *   node --test tool/tests/steps.test.mjs
 *
 * Everything above the last heading needs no browser. The tests under "in a browser" need Playwright, which a project carries
 * and the skill does not: point CANVAS_TEST_PROJECT at a project that has it and they run; without it they are skipped, by name.
 *
 *   CANVAS_TEST_PROJECT=/path/to/project node --test tool/tests/steps.test.mjs
 *
 * NOT INSTALLED into a project: the installer copies only the files it lists.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";

import { MAX_STEPS, STEP_TYPES, SURFACE_TEXT, StepError, WAIT_FOR_MAX_SECONDS, WAIT_FOR_SECONDS, describeStep, describeSteps, isCssTarget, parseSteps, readSurfaceText, runSteps } from "../steps.mjs";

/* ------------------------------------------------------------------ the declaration */

test("there are eight step types, the original five first", () => {
  assert.deepEqual(STEP_TYPES, ["click", "fill", "press", "waitText", "closeWelcome", "hover", "scroll", "waitFor"]);
  assert.throws(() => parseSteps([{ tap: "x" }], "s"), /The step types are: click, fill, press, waitText, closeWelcome, hover, scroll, waitFor/);
});

test("parseSteps accepts the new types, selector targets and `nth: -1`, and returns the list unchanged", () => {
  const list = [
    { hover: "Add Photo" },
    { hover: "css=[data-testid=image-preview]", nth: -1, within: "[role=dialog]" },
    { scroll: "css=[data-testid=photo-list]" },
    { scroll: "css=[data-testid=report-table]", to: 330 },
    { scroll: "Travel Preferences", role: "heading" },
    { waitFor: "css=[data-testid=profile-setup]" },
    { waitFor: "css=[data-testid=profile-setup]", seconds: 60 },
    { waitFor: "Photo Details", role: "tab", within: "[role=dialog]" },
    { click: "css=button:has-text('Save')", nth: -1 },
    { click: "css=[data-testid^=task-row-]", nth: 0, within: "main" },
    { fill: "css=#zoom-percent", with: "95" },
    { press: "Enter", on: "css=[data-testid=search-bar]" },
  ];
  assert.equal(list.length, MAX_STEPS);
  assert.equal(parseSteps(list, "t"), list);
});

test("a selector target is `css=` and something after it, and takes no role", () => {
  assert.equal(isCssTarget("css=#x"), true);
  assert.equal(isCssTarget("Save"), false);
  assert.equal(isCssTarget(undefined), false);
  assert.throws(() => parseSteps([{ click: "css=" }], "s"), /click needs a selector after "css="/);
  assert.throws(() => parseSteps([{ hover: "css=   " }], "s"), /hover needs a selector after "css="/);
  assert.throws(() => parseSteps([{ press: "Enter", on: "css=" }], "s"), /press needs a selector after "css="/);
  assert.throws(() => parseSteps([{ click: "css=#x", role: "button" }], "s"), /click takes no role with a css= target/);
  assert.throws(() => parseSteps([{ waitFor: "css=#x", role: "tab" }], "s"), /waitFor takes no role with a css= target/);
  /* A text that merely starts like a selector is a waitText's own business. */
  assert.doesNotThrow(() => parseSteps([{ waitText: "css= is a prefix" }], "s"));
});

test("`nth` counts from 0 and -1 is the last, `seconds` and `to` have their ranges", () => {
  assert.doesNotThrow(() => parseSteps([{ click: "A", nth: -1 }, { click: "A", nth: 0 }], "s"));
  assert.throws(() => parseSteps([{ click: "A", nth: -2 }], "s"), /nth counts from 0, and -1 is the last one/);
  assert.throws(() => parseSteps([{ hover: "A", nth: 1.5 }], "s"), /nth counts from 0/);
  assert.equal(WAIT_FOR_SECONDS, 30);
  assert.equal(WAIT_FOR_MAX_SECONDS, 300);
  assert.doesNotThrow(() => parseSteps([{ waitFor: "A", seconds: 1 }, { waitFor: "A", seconds: 300 }], "s"));
  assert.throws(() => parseSteps([{ waitFor: "A", seconds: 0 }], "s"), /seconds is how long to wait, a whole number from 1 to 300/);
  assert.throws(() => parseSteps([{ waitFor: "A", seconds: 301 }], "s"), /seconds is how long to wait/);
  assert.throws(() => parseSteps([{ waitFor: "A", seconds: 2.5 }], "s"), /seconds is how long to wait/);
  assert.doesNotThrow(() => parseSteps([{ scroll: "A", to: 0 }, { scroll: "A", to: 330 }], "s"));
  assert.throws(() => parseSteps([{ scroll: "A", to: -1 }], "s"), /to is a scroll position in pixels from the top, 0 or more/);
  assert.throws(() => parseSteps([{ scroll: "A", to: 1.5 }], "s"), /to is a scroll position/);
});

test("each type takes only its own keys, and the new ones have their values", () => {
  assert.throws(() => parseSteps([{ hover: "A", with: "x" }], "s"), /hover does not take "with"/);
  assert.throws(() => parseSteps([{ click: "A", to: 3 }], "s"), /click does not take "to"/);
  assert.throws(() => parseSteps([{ click: "A", seconds: 3 }], "s"), /click does not take "seconds"/);
  assert.throws(() => parseSteps([{ waitFor: "A", nth: 0 }], "s"), /waitFor does not take "nth"\. It takes: waitFor, role, within, seconds/);
  assert.throws(() => parseSteps([{ hover: "" }], "s"), /hover needs the exact text/);
  assert.throws(() => parseSteps([{ scroll: 4 }], "s"), /scroll needs the exact text/);
  assert.throws(() => parseSteps([{ waitFor: "A", hover: "B" }], "s"), /names waitFor and hover: one step does one thing/);
});

test("the cap of twelve counts every type, the new ones included", () => {
  const twelve = Array.from({ length: 12 }, () => ({ waitFor: "css=#x" }));
  assert.equal(parseSteps(twelve, "s").length, 12);
  assert.throws(() => parseSteps([...twelve, { hover: "css=#y" }], "s"), /13 steps is a script/);
});

test("describeStep reads the new types as what a person does", () => {
  assert.equal(describeStep({ hover: "Add Photo" }), 'hover "Add Photo"');
  assert.equal(describeStep({ scroll: "css=#panel" }), 'scroll "css=#panel"');
  assert.equal(describeStep({ scroll: "css=.table", to: 330 }), 'scroll "css=.table" to 330');
  assert.equal(describeStep({ waitFor: "css=#loaded" }), 'waitFor "css=#loaded"');
  assert.equal(describeStep({ waitFor: "css=#loaded", seconds: 60 }), 'waitFor "css=#loaded" for up to 60s');
  assert.equal(describeSteps([{ hover: "A" }, { scroll: "B" }, { waitFor: "C" }]), 'hover "A", scroll "B", waitFor "C"');
});

test("a StepError carries why and where, and is an Error", () => {
  const error = new StepError("step 2 (click \"A\"): no visible control named \"A\"", { kind: "missing", step: 2 });
  assert.ok(error instanceof Error);
  assert.equal(error.name, "StepError");
  assert.equal(error.kind, "missing");
  assert.equal(error.step, 2);
  assert.equal(new StepError("x").kind, "failed", "a refusal by the browser is the default kind");
});

/* ------------------------------------------------------------------ in a browser */

const project = process.env.CANVAS_TEST_PROJECT;
let chromium = null;
if (project) {
  try {
    chromium = createRequire(path.join(project, "package.json"))("playwright").chromium;
  } catch {
    chromium = null;
  }
}
const inBrowser = chromium ? {} : { skip: "set CANVAS_TEST_PROJECT to a project that has playwright to run the browser tests" };

/** One page with everything the new steps need: test ids, a hover reveal, a late element, two scrollers. */
const PAGE = `<body style="margin:0;font:14px sans-serif">
  <style>
    .reveal { display: none } .host:hover .reveal { display: block }
    #scroller { height: 120px; overflow: auto; border: 1px solid #000 }
    #long { height: 1000px } #page-end { margin-top: 2400px }
  </style>
  <button data-testid="row-a" class="row">Row</button><button data-testid="row-b" class="row">Row</button><button data-testid="row-c" class="row">Row</button>
  <div class="host" data-testid="host" style="width:200px;height:40px;background:#ddd">Hover me <span class="reveal" data-testid="revealed">Revealed</span></div>
  <div id="out"></div>
  <input data-testid="guests" aria-label="Guests">
  <div id="scroller" data-testid="scroller"><div id="long"><p>Top of scroller</p><h2 data-testid="deep" style="margin-top:600px">Deep section</h2></div></div>
  <div id="page-end"><h2 data-testid="page-end-heading">End of page</h2></div>
  <script>
    document.querySelectorAll(".row").forEach((b, at) => { b.onclick = () => { document.getElementById("out").textContent = "pressed " + at; }; });
    setTimeout(() => { const late = document.createElement("div"); late.dataset.testid = "late"; late.textContent = "Arrived late"; document.body.appendChild(late); }, 1500);
    document.querySelector("[data-testid=guests]").onkeydown = (e) => { if (e.key === "Enter") document.getElementById("out").textContent = "entered " + e.target.value; };
  </script></body>`;

test("in a browser: css= targets press, fill and focus by test id, `nth: -1` takes the last, and ambiguity still needs a word", inBrowser, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(PAGE);
    await runSteps(page, parseSteps([{ click: "css=[data-testid=row-b]" }]), {});
    assert.equal(await page.locator("#out").innerText(), "pressed 1");
    await runSteps(page, parseSteps([{ click: "css=.row", nth: -1 }]), {});
    assert.equal(await page.locator("#out").innerText(), "pressed 2", "-1 is the last visible match");
    await runSteps(page, parseSteps([{ click: "css=.row", nth: 0 }]), {});
    assert.equal(await page.locator("#out").innerText(), "pressed 0");
    await runSteps(page, parseSteps([{ click: "css=button:has-text('Row')", nth: 1 }]), {});
    assert.equal(await page.locator("#out").innerText(), "pressed 1", "Playwright's own CSS engine: :has-text works");
    await runSteps(page, parseSteps([{ fill: "css=[data-testid=guests]", with: "12" }, { press: "Enter", on: "css=[data-testid=guests]" }]), {});
    assert.equal(await page.locator("#out").innerText(), "entered 12");
    await assert.rejects(runSteps(page, [{ click: "css=.row" }], {}), (error) => {
      assert.ok(error instanceof StepError);
      assert.equal(error.kind, "ambiguous");
      assert.equal(error.step, 1);
      assert.match(error.message, /step 1 \(click "css=\.row"\): 3 visible elements match css=\.row: add nth \(from 0\) or within \(a CSS scope\) to say which; nth -1 is the last/);
      return true;
    });
    await assert.rejects(runSteps(page, [{ click: "css=.row", nth: 7 }], {}), /nth 7 asked for, and only 3 element\(s\) matching css=\.row are showing/);
  } finally {
    await browser.close();
  }
});

test("in a browser: a step that cannot be done is a StepError that names the step, and the next steps never run", inBrowser, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(PAGE);
    const startedAt = Date.now();
    await assert.rejects(runSteps(page, [{ click: "css=[data-testid=row-a]" }, { click: "css=[data-testid=nothing-here]" }, { click: "css=[data-testid=row-c]" }], {}), (error) => {
      assert.ok(error instanceof StepError);
      assert.equal(error.kind, "missing");
      assert.equal(error.step, 2);
      assert.match(error.message, /^step 2 \(click "css=\[data-testid=nothing-here\]"\): no visible element matching css=\[data-testid=nothing-here\]$/);
      return true;
    });
    assert.equal(await page.locator("#out").innerText(), "pressed 0", "the third step was never pressed");
    assert.ok(Date.now() - startedAt < 20_000, "the control is looked for for ten seconds and no longer");
    await assert.rejects(runSteps(page, [{ waitText: "never on this page" }], {}), (error) => error instanceof StepError && error.kind === "text");
  } finally {
    await browser.close();
  }
});

test("in a browser: hover leaves the pointer on the target, so a hover state is what the picture shows", inBrowser, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(PAGE);
    assert.equal(await page.locator("[data-testid=revealed]").isVisible(), false);
    await runSteps(page, parseSteps([{ hover: "css=[data-testid=host]" }]), {});
    assert.equal(await page.locator("[data-testid=revealed]").isVisible(), true, "the :hover rule applies while the pointer stays");
    await page.waitForTimeout(300);
    assert.equal(await page.locator("[data-testid=revealed]").isVisible(), true, "and it is still there a moment later");
    /* By accessible name, with a role: the first-class way. */
    await runSteps(page, parseSteps([{ hover: "Row", nth: 0 }]), {});
    assert.equal(await page.locator("[data-testid=revealed]").isVisible(), false, "the pointer moved off the host");
  } finally {
    await browser.close();
  }
});

test("in a browser: scroll brings the target to the top of what scrolls, and `to` sets the scroller itself", inBrowser, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await page.setContent(PAGE);
    const innerTop = () => page.evaluate(() => document.getElementById("scroller").scrollTop);
    assert.equal(await innerTop(), 0);
    await runSteps(page, parseSteps([{ scroll: "css=[data-testid=deep]" }]), {});
    const placed = await page.evaluate(() => {
      const box = document.getElementById("scroller").getBoundingClientRect();
      const deep = document.querySelector("[data-testid=deep]").getBoundingClientRect();
      return { inner: document.getElementById("scroller").scrollTop, offset: Math.round(deep.top - box.top) };
    });
    assert.ok(placed.inner > 400, `the scroller scrolled (${placed.inner})`);
    assert.ok(placed.offset <= 3, `the target is at the top of the scroller, not centred (${placed.offset}px below its edge)`);
    await runSteps(page, parseSteps([{ scroll: "css=[data-testid=scroller]", to: 0 }]), {});
    assert.equal(await innerTop(), 0, "`to` is an absolute position");
    await runSteps(page, parseSteps([{ scroll: "css=[data-testid=scroller]", to: 330 }]), {});
    assert.equal(await innerTop(), 330);
    await runSteps(page, parseSteps([{ scroll: "css=[data-testid=page-end-heading]" }]), {});
    assert.ok((await page.evaluate(() => window.scrollY)) > 1000, "the window scrolled for a target that is in the page, not in a scroller");
    /* By accessible name, with a role: the first-class way, for a heading that no control role would find. */
    await page.evaluate(() => window.scrollTo(0, 0));
    await runSteps(page, parseSteps([{ scroll: "End of page", role: "heading" }]), {});
    assert.ok((await page.evaluate(() => window.scrollY)) > 1000, "a heading is found by its name and its role");
    await assert.rejects(runSteps(page, [{ scroll: "End of page" }], {}), /no visible control named "End of page"/, "without the role, a heading is not one of the controls a name looks for");
  } finally {
    await browser.close();
  }
});

test("in a browser: waitFor waits for an element, and gives up at its own seconds", inBrowser, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(PAGE);
    assert.equal(await page.locator("[data-testid=late]").count(), 0);
    const startedAt = Date.now();
    await runSteps(page, parseSteps([{ waitFor: "css=[data-testid=late]" }]), {});
    assert.ok(Date.now() - startedAt >= 1000, "it waited for the element that arrives after 1.5 seconds");
    assert.equal(await page.locator("[data-testid=late]").count(), 1);
    const giveUpAt = Date.now();
    await assert.rejects(runSteps(page, [{ waitFor: "css=[data-testid=never]", seconds: 1 }], {}), (error) => {
      assert.ok(error instanceof StepError);
      assert.equal(error.kind, "missing");
      assert.match(error.message, /^step 1 \(waitFor "css=\[data-testid=never\]" for up to 1s\): no visible element matching css=\[data-testid=never\] within 1s$/);
      return true;
    });
    assert.ok(Date.now() - giveUpAt < 4000, "one second means about one second");
    /* By accessible name, with a role, and inside a scope. */
    await runSteps(page, parseSteps([{ waitFor: "Deep section", role: "heading", within: "[data-testid=scroller]" }]), {});
  } finally {
    await browser.close();
  }
});

/* ------------------------------------------------------------------ the open surface, with menus portalled beside a dialog */

/** The reader as it was before menus were read, kept here so the no-dialog case can be held to it exactly. */
const DIALOGS_ONLY = () => {
  const open = Array.from(document.querySelectorAll('[role="dialog"],[role="alertdialog"]')).filter((el) => {
    if (el.getAttribute("aria-hidden") === "true") return false;
    const box = el.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  });
  if (open.length === 0) return document.body?.innerText ?? "";
  return open.map((el) => el.innerText ?? "").join("\n");
};

/** A Radix-style menu: portalled to the body in its popper wrapper, beside whatever else is open, never inside it. */
const MENU = `<div data-radix-popper-content-wrapper style="position:fixed;top:200px;left:300px;z-index:60"><div role="menu" style="background:#fff;border:1px solid #000;padding:8px"><div role="menuitem">Archive task</div><div role="menuitem">Print packing slip</div></div></div>`;
const DIALOG = (attrs = "") => `<div role="dialog" ${attrs} style="position:fixed;top:40px;left:40px;width:400px;height:300px;background:#fff;border:1px solid #000;z-index:50"><h2>Task details</h2><button>More actions</button></div>`;
const surfaceOf = async (page, body) => {
  await page.setContent(`<body style="margin:0;font:14px sans-serif"><main><h1>Tasks list behind</h1><p>Viewed</p></main>${body}</body>`);
  return { now: await page.evaluate(SURFACE_TEXT), before: await page.evaluate(DIALOGS_ONLY), body: await page.evaluate(() => document.body.innerText) };
};

test("in a browser: a menu open over a dialog, modal or not, is part of the surface, and the page behind the dialog still is not", inBrowser, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    /* A NON-MODAL MENU OVER A DIALOG: the dialog stays open, the menu sits beside it in the body. The old reader read the dialog alone. */
    const over = await surfaceOf(page, `${DIALOG()}${MENU}`);
    assert.match(over.now, /Task details/);
    assert.match(over.now, /Archive task/, "the menu's items are on the surface");
    assert.ok(!/Tasks list behind|Viewed/.test(over.now), "the page behind the scrim is still not evidence");
    assert.ok(!/Archive task/.test(over.before), "the reader before this change could not see the menu: every claim on it failed");
    assert.equal(await readSurfaceText(page), `${over.now}\n`, "the steps read through the same function");
    /* A MODAL MENU OVER A DIALOG (Radix hides everything else, the dialog included, with aria-hidden): the dialog and the menu,
       not the page behind. The reader before this change fell back to the whole body here. */
    const modal = await surfaceOf(page, `${DIALOG('aria-hidden="true"')}${MENU}`);
    assert.match(modal.now, /Task details/, "the dialog the menu hid is still the surface");
    assert.match(modal.now, /Archive task/, "and the menu in front of it");
    assert.ok(!/Tasks list behind|Viewed/.test(modal.now), "the page behind the dialog is not evidence");
    assert.equal(modal.before, modal.body, "the old reader read the whole body, page behind included");
    /* A dialog hidden with nothing floating over it reads the body, exactly as before. */
    const hiddenAlone = await surfaceOf(page, DIALOG('aria-hidden="true"'));
    assert.equal(hiddenAlone.now, hiddenAlone.before);
    /* A LIST THAT IS PART OF THE PAGE BEHIND (not floating) stays behind the scrim. */
    const behind = await surfaceOf(page, `<ul role="listbox"><li role="option">Filter chip Viewed</li></ul>${DIALOG()}`);
    assert.ok(!/Filter chip Viewed/.test(behind.now), "a list in the page behind is not a layer in front");
    /* A MENU INSIDE THE DIALOG is in the dialog's text already and is not read twice. */
    const inside = await surfaceOf(page, DIALOG().replace("</div>", `${MENU.replace("position:fixed", "position:absolute")}</div>`));
    assert.equal(inside.now.match(/Archive task/g)?.length, 1);
    assert.equal(inside.now, inside.before);
  } finally {
    await browser.close();
  }
});

test("in a browser: with no dialog open the surface is the body, exactly as before, a menu over the plain page included", inBrowser, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const plain = await surfaceOf(page, MENU);
    assert.equal(plain.now, plain.before, "byte for byte the reader it replaced");
    assert.equal(plain.now, plain.body);
    assert.match(plain.now, /Tasks list behind[\s\S]*Archive task/);
    const empty = await surfaceOf(page, "");
    assert.equal(empty.now, empty.before);
  } finally {
    await browser.close();
  }
});
