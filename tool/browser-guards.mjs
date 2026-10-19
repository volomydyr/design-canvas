/**
 * design-canvas — THE BROWSER-SIDE GUARDS that capture.mjs and check-canvas.mjs share, so the two can never
 * disagree about them. One file, because "the capture handles it and the oracle does not" is exactly the drift
 * trap 24 records for claims.
 *
 * SIX JOBS (the sixth is the lifecycle in `browser-lifecycle.mjs`, reached through
 * `launchBrowser`: a browser the tool opened is closed however the run ends):
 *
 *   1. A CRASH NEVER PRINTS THE SESSION. A Playwright launch or context failure used to reach the session output
 *      with the saved storage state (live login tokens) inside the error text. `launchBrowser`, `openContext`
 *      and `guardCrashes` print ONE line: the first line of the error, with every cookie and localStorage value
 *      from the storage state scrubbed out of it and anything that still looks like session data withheld. Never
 *      the call log, never the options, never the file's contents. `CANVAS_DEBUG=1` does not change that.
 *
 *   2. A LOGIN REDIRECT STOPS THE RUN IN SECONDS. A capture whose first page lands on the sign-in route photographs
 *      every frame as a sign-in page and fails every claim, and the oracle waits out its whole 240 seconds for a
 *      canvas that never arrives. `checkLoginRedirect` looks at where the FIRST page landed and exits with one line
 *      that names the fix: the storage-state refresh command SKILL.md documents.
 *
 *   3. OVERLAYS THE PROJECT HAS DECLARED ARE DISMISSED, and the framework's own dev overlay is hidden (`hideDevOverlay`). A real app resurrects its first-run and promo dialogs in
 *      the capture browser, because their dismissals live in localStorage and localStorage is per origin. The
 *      project lists what to do in `design-canvas/dismiss.json`: a localStorage seed planted before the app's own
 *      scripts run, or a click on a named button. `forbid` stays the tripwire for everything the list misses.
 *
 *   4. NOTHING THE APP SENDS CAN WRITE. Every context a tool opens goes through `openContext`, which puts `guardWrites` on the
 *      WHOLE context (every page, popups the app opens included) and blocks service workers, whose requests no route sees. It
 *      aborts a GraphQL save (a mutation, or an operation whose type cannot be read), a GraphQL request it cannot read, and
 *      every other request that is not GET, HEAD or OPTIONS, except the canvas's own API on the page's origin and the parts of an
 *      address the project lists in `allowWrites` (settings.json). The capture's
 *      `answer` rules still reply to a save first, on the page, so a frame can show a refusal and nothing reaches the server
 *      either way. Each block is one line, once per operation, and the run ends with the count. Why it exists: a capture run
 *      against a shared account must never create records there, and an opt-in guard cannot rule that out. A canvas lets
 *      writes through only by declaring `{ writes: "allow" }`.
 *
 *   5. A `forbid` HIT NAMES ITS REMEDY. The failure line says which text was forbidden; `forbidRemedy` says what to
 *      do about it, under the failures it explains.
 *
 * Exit code 2 means "the run could not start" (no browser, no session, a bad dismiss file); 1 stays "it ran and
 * something is wrong", so a caller can tell the two apart.
 *
 * DELETE WITH: the design-canvas/ folder.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { launchTracked } from "./browser-lifecycle.mjs";
import { writesPolicy, writeVerdict } from "./network.mjs";

/* Every tool that launches a browser goes through `launchBrowser` below, so every one of them gets the lifecycle (a close in a
   finally, a kill of the process group on exit, on a signal and on the tool's own SIGKILL) and none has to remember to ask. */
export { closeBrowser, withBrowser } from "./browser-lifecycle.mjs";

/** The exit code for a run that could not begin, as opposed to one that found problems. */
export const SETUP_EXIT = 2;

/* ------------------------------------------------------------------ 1. errors that never carry the session */

/** Every value in a Playwright storage-state file that could be a credential, read so it can be scrubbed. */
function secretsIn(storageState) {
  if (!storageState) return [];
  try {
    const state = JSON.parse(readFileSync(storageState, "utf8"));
    const values = new Set();
    for (const cookie of state.cookies ?? []) if (String(cookie?.value ?? "").length >= 6) values.add(String(cookie.value));
    for (const origin of state.origins ?? [])
      for (const item of origin?.localStorage ?? []) if (String(item?.value ?? "").length >= 6) values.add(String(item.value));
    return [...values].sort((a, b) => b.length - a.length);
  } catch {
    return [];
  }
}

/** What a serialised storage state or a JWT looks like, for text that slipped past the exact-value scrub. */
const SESSION_DATA = /"(?:cookies|origins|localStorage|sessionStorage|value)"\s*:|eyJ[\w-]{10,}\.[\w-]{10,}/;

/**
 * THE FIRST LINE OF AN ERROR AND NOTHING ELSE. Playwright puts the useful sentence on line one and the call log,
 * the launch arguments and, for a context crash, the options it was given on the lines after it. The storage
 * state is one of those options.
 */
export function safeLine(error, storageState) {
  let line = String(error?.message ?? error ?? "unknown error").split("\n")[0].trim();
  for (const secret of secretsIn(storageState)) line = line.split(secret).join("[redacted]");
  if (SESSION_DATA.test(line)) line = "(the message is withheld: it carried session data)";
  return line.length > 240 ? `${line.slice(0, 237)}...` : line;
}

/** Set by `guardCrashes`: what a tool prints as its own last line (the oracle's FAIL) when it has to stop. */
let closing = null;

/**
 * Register the tool's closing line BEFORE `guardCrashes` can (a tool reads its settings first, and a settings file that is wrong
 * stops the run before the crash guard exists), so even that stop ends on the tool's verdict line.
 */
export function setClosing(tail) {
  closing = tail ?? null;
}

/** One line, and out. The tool's closing line (if it registered one) follows it, so a tail never ends on a bare error. */
export function die(who, message, code = SETUP_EXIT) {
  console.error(`${who}: ${message}`);
  closing?.("the run could not start", console.error);
  process.exit(code);
}

/**
 * A SAVED SESSION THAT IS MISSING OR NOT A SESSION FILE STOPS THE RUN WITH THE FIX, before any browser starts. It
 * never says anything about what the file holds.
 */
export function requireStorageState(who, storageState, appUrl) {
  if (!storageState) return;
  const refresh = `npx playwright open --save-storage=${storageState} ${appUrl}`;
  if (!existsSync(storageState))
    die(who, `--storage-state names ${storageState}, which does not exist: log in once with "${refresh}" and run this again`);
  try {
    const state = JSON.parse(readFileSync(storageState, "utf8"));
    if (!state || typeof state !== "object" || !Array.isArray(state.cookies))
      throw new Error("not a storage state");
  } catch {
    die(who, `${storageState} is not a Playwright storage state: log in again with "${refresh}"`);
  }
}

export async function launchBrowser(chromium, { who, channel, storageState }) {
  try {
    return await launchTracked(chromium, channel ? { channel } : {}, { who });
  } catch (error) {
    return die(who, `the browser could not start${channel ? ` on channel "${channel}"` : ""}: ${safeLine(error, storageState)}`);
  }
}

/**
 * A SAVED SESSION FOLLOWS THE PAGES TO THEIR ADDRESS. localStorage is kept per origin, so a session saved against the dev server is
 * missing on a capture served on a port of its own. When the file holds nothing for `origin`, the entries it holds for the same
 * host on another port are given to `origin` too. Returns the path unchanged when there is nothing to move.
 */
export function sessionFor(storageState, origin) {
  if (!storageState || !origin) return storageState;
  let state;
  let target;
  try {
    state = JSON.parse(readFileSync(storageState, "utf8"));
    target = new URL(origin);
  } catch {
    return storageState;
  }
  const origins = Array.isArray(state?.origins) ? state.origins : [];
  if (origins.some((one) => one?.origin === target.origin)) return storageState;
  const hostOf = (one) => {
    try {
      return new URL(one.origin).hostname;
    } catch {
      return null;
    }
  };
  const sameHost = origins.filter((one) => hostOf(one) === target.hostname);
  if (sameHost.length === 0) return storageState;
  return { ...state, origins: [...origins, { origin: target.origin, localStorage: sameHost.flatMap((one) => one.localStorage ?? []) }] };
}

/** `origin` is the address the pages are photographed at, for `sessionFor`. */
export async function openContext(browser, options, { who, storageState, origin }) {
  const guarded = writesPolicy() !== "allow";
  let context;
  try {
    context = await browser.newContext({
      ...options,
      /* A service worker's requests never reach a route: with the guard on, the app gets none. */
      ...(guarded ? { serviceWorkers: "block" } : {}),
      ...(storageState ? { storageState: sessionFor(storageState, origin) } : {}),
    });
  } catch (error) {
    return die(who, `the browser context could not open: ${safeLine(error, storageState)}`);
  }
  if (guarded) await guardWrites(context, { who });
  return context;
}

/* ------------------------------------------------------------------ 4. nothing the app sends can write */

/** Every write blocked in this process, label to count, across every context a tool opened. */
const blockedWrites = new Map();
let summaryHooked = false;

/** "3 writes blocked: mutation SaveJob x2, POST api.test/upload x1", or null when nothing was blocked. */
export function writeGuardSummary() {
  if (blockedWrites.size === 0) return null;
  const total = [...blockedWrites.values()].reduce((sum, n) => sum + n, 0);
  return `${total} write(s) blocked: ${[...blockedWrites].map(([label, n]) => `${label} x${n}`).join(", ")}`;
}

/** The origin of the page that sent a request, when the browser still knows it. */
function originOf(request) {
  try {
    const href = request.frame()?.url();
    return href && /^https?:/.test(href) ? new URL(href).origin : undefined;
  } catch {
    return undefined;
  }
}

/**
 * THE CONTEXT-LEVEL WRITE GUARD (job 4 above). Routes every request of the context; a write (`writeVerdict` in `network.mjs`) is
 * aborted and logged once per label, anything else falls back to whatever routes the context or the page have below it (none,
 * normally: the page's own rules run FIRST, because Playwright runs a page's routes before its context's, and they fall back to
 * this one). `log` is for tests. The run's count prints as the process exits.
 */
export async function guardWrites(context, { who = "canvas", log = (line) => console.log(line) } = {}) {
  if (!summaryHooked) {
    summaryHooked = true;
    process.once("exit", () => {
      const summary = writeGuardSummary();
      if (summary) console.log(`${who}: write guard: ${summary}`);
    });
  }
  await context.route("**/*", async (route) => {
    const request = route.request();
    let verdict;
    try {
      verdict = writeVerdict(request, { origin: originOf(request) });
    } catch {
      verdict = { write: true, label: `${request.method()} (unreadable request)` };
    }
    if (!verdict.write) {
      await route.fallback().catch(() => {});
      return;
    }
    const seen = blockedWrites.get(verdict.label) ?? 0;
    blockedWrites.set(verdict.label, seen + 1);
    if (seen === 0) log(`${who}: write guard blocked ${verdict.label}`);
    await route.abort("blockedbyclient").catch(() => {});
  });
}

/**
 * THE LAST NET: anything that still throws past the catches above ends as one line plus up to three frames of THIS
 * tool's own stack (file and line, no arguments, no options), so a bug in the tool stays findable and a Playwright
 * error stays a sentence. `tail` runs first, so the oracle can close on its FAIL line.
 */
export function guardCrashes({ who, storageState, tail }) {
  closing = tail ?? null;
  const stop = (error) => {
    console.error(`${who}: stopped by an unexpected error: ${safeLine(error, storageState)}`);
    const frames = String(error?.stack ?? "")
      .split("\n")
      .filter((line) => /^\s+at /.test(line) && !line.includes("node_modules") && !line.includes("node:internal"))
      .slice(0, 3);
    for (const frame of frames) console.error(frame);
    tail?.("the run crashed");
    process.exit(1);
  };
  process.on("uncaughtException", stop);
  process.on("unhandledRejection", stop);
}

/* ------------------------------------------------------------------ 2. the login redirect */

/**
 * A SIGN-IN ROUTE, by its name. `auth` alone is not here on purpose: an app's own `/auth/...` pages are often real
 * screens, and a false alarm that stops a run is worse than the slow failure it replaces. An app that names its
 * sign-in route something else says so once: `--login-route /welcome` (or `CANVAS_LOGIN_ROUTE=/welcome`), a path
 * prefix, read by the capture and the oracle alike.
 */
const LOGIN_PATH = /(?:^|\/)(?:log-?in|sign-?in|sign_in|sso|session\/new|users\/sign_in)(?:\/|$)/i;

const pathOf = (url) => {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
};

/** Did asking for `requested` end on a sign-in route? Null when not; the two paths when so. */
export function loginRedirect(requested, landed, loginRoute) {
  const from = pathOf(requested);
  const to = pathOf(landed);
  const isLogin = (route) =>
    LOGIN_PATH.test(route) || Boolean(loginRoute && (route === loginRoute || route.startsWith(`${loginRoute.replace(/\/$/, "")}/`)));
  if (!from || !to || from === to || isLogin(from)) return null;
  return isLogin(to) ? { from, to } : null;
}

/**
 * The one line that names the fix, the same for a missing session and for an expired one. With a session and a blocked write
 * before the redirect, the blocked request comes first: an app that checks its session with a POST is logged out by the guard.
 */
export function loginFixMessage({ from, to }, { storageState, appUrl, blocked = [...blockedWrites.keys()] }) {
  const file = storageState ?? "design-canvas/auth-state.json";
  const refresh = `npx playwright open --save-storage=${file} ${appUrl}`;
  if (!storageState)
    return `${from} redirected to the login route (${to}): the session is missing. Log in once with "${refresh}", then pass --storage-state ${file} (or set CANVAS_STORAGE_STATE)`;
  if (blocked.length > 0) {
    const address = blocked.map((label) => /^[A-Z]+ [^/\s]+(\/\S*)/.exec(label)?.[1]).find(Boolean) ?? "<a part of its address>";
    return (
      `${from} redirected to the login route (${to}) after the write guard blocked ${blocked.slice(0, 3).join(", ")}. If that request only ` +
      `reads (a session check), list it in design-canvas/settings.json as "allowWrites": ["${address}"] and run this again; ` +
      `if it really writes, the saved session in ${storageState} may have expired: refresh it with "${refresh}"`
    );
  }
  return `${from} redirected to the login route (${to}): the saved session in ${storageState} has expired. Refresh it with "${refresh}" and run this again`;
}

/**
 * LOOK AT WHERE THE FIRST PAGE LANDED, and stop the run if it is a sign-in route. Waits for the load event and then
 * a short grace, because a guard that redirects from client code does it after hydration, not in the response.
 * Returns quietly when everything is fine, and exits with the fix when it is not. Judged by the route's NAME: a
 * password field is not evidence, because a real screen (account security) has one too.
 */
export async function checkLoginRedirect(page, requestedUrl, { who, storageState, appUrl, loginRoute, graceMs = 1500 }) {
  await page.waitForLoadState("load", { timeout: 6000 }).catch(() => undefined);
  const until = Date.now() + graceMs;
  for (;;) {
    const hit = loginRedirect(requestedUrl, page.url(), loginRoute);
    if (hit) die(who, loginFixMessage(hit, { storageState, appUrl }));
    if (Date.now() >= until) return;
    await page.waitForTimeout(250);
  }
}

/** The same test for a response fetched from Node (the declaration endpoint), which follows redirects silently. */
export function checkFetchedLogin(who, requestedUrl, response, { storageState, appUrl, loginRoute }) {
  if (!response?.redirected) return;
  const hit = loginRedirect(requestedUrl, response.url, loginRoute);
  if (hit) die(who, loginFixMessage(hit, { storageState, appUrl }));
}

/**
 * A DEV SERVER RELOADS THE DECLARATION A MOMENT AFTER IT IS SAVED, so a run started right after an edit can meet the old one.
 * `served()` returns the frame ids the server declares now; this asks again every `intervalMs` until every id in `declared`
 * is among them or `timeoutMs` has passed, and returns the ids still unknown (empty when the server caught up).
 */
export async function waitForServedFrames(served, declared, { timeoutMs = 30_000, intervalMs = 1_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const known = await served();
    const unknown = declared.filter((id) => !known.has(id));
    if (unknown.length === 0 || Date.now() >= deadline) return unknown;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/* ------------------------------------------------------------------ 3. overlays the project has declared */

/**
 * `design-canvas/dismiss.json`: what to do about the first-run and promo overlays this project's app resurrects in
 * a fresh browser. Committed, written by whoever first sees the overlay, and read by BOTH the capture and the
 * oracle, so a frame and its Open destination are proved against the same page.
 *
 *   { "*":        [ { "localStorage": { "promo-dismissed": "1" } } ],       // every canvas in the project
 *     "trips":    [ { "click": "Got it" },                                  // this canvas only
 *                   { "click": "Maybe later", "within": "[role=dialog]" } ] }
 *
 * A bare array is the same as `{ "*": [...] }`. Two kinds of step and nothing else:
 *
 *   localStorage   key/value pairs planted at the start of EVERY document, before the app's own scripts run, so
 *                  the app reads "already dismissed" the way it would for a returning visitor.
 *   click          the exact accessible name of a button or link (`within`: a CSS selector to look inside). Clicked
 *                  once per load if it is showing, skipped without a word if it is not: an overlay is a condition.
 */
export function loadDismissals(canvasDir, slug, who) {
  const file = path.join(canvasDir, "dismiss.json");
  const none = { seeds: {}, clicks: [], file: null };
  if (!existsSync(file)) return none;
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    return die(who, `design-canvas/dismiss.json is not valid JSON (${String(error.message).split("\n")[0]})`);
  }
  const lists = Array.isArray(raw) ? [raw] : [raw?.["*"], raw?.[slug]];
  const seeds = {};
  const clicks = [];
  for (const list of lists) {
    if (list === undefined) continue;
    if (!Array.isArray(list)) return die(who, `design-canvas/dismiss.json: the steps for "${slug}" or "*" must be a list`);
    list.forEach((step, at) => {
      if (step && typeof step === "object" && step.localStorage && typeof step.localStorage === "object" && !Array.isArray(step.localStorage)) {
        for (const [key, value] of Object.entries(step.localStorage)) seeds[key] = typeof value === "string" ? value : JSON.stringify(value);
      } else if (step && typeof step === "object" && typeof step.click === "string" && step.click.trim()) {
        clicks.push({ click: step.click, within: typeof step.within === "string" ? step.within : null });
      } else {
        die(who, `design-canvas/dismiss.json: step ${at + 1} is neither { "localStorage": {...} } nor { "click": "Button name" }`);
      }
    });
  }
  return { seeds, clicks, file };
}

/** Plant the localStorage seeds at the start of every document in the context, every frame included. */
export async function seedDismissals(context, seeds) {
  if (Object.keys(seeds).length === 0) return;
  await context.addInitScript((entries) => {
    try {
      for (const [key, value] of Object.entries(entries)) window.localStorage.setItem(key, value);
    } catch {
      /* A sandboxed or cross-origin document has no storage to seed, and needs none. */
    }
  }, seeds);
}

/**
 * Click whatever declared dismissals are showing on this page RIGHT NOW. Names come back so the run can say what
 * fired: a dismissal that never matches anything is a fact worth seeing, not a silence.
 */
export async function clickDismissals(page, clicks) {
  const fired = [];
  for (const step of clicks) {
    const scope = step.within ? page.locator(step.within).first() : page;
    for (const role of ["button", "link"]) {
      const target = scope.getByRole(role, { name: step.click, exact: true }).first();
      if (!(await target.isVisible().catch(() => false))) continue;
      const done = await target.click({ timeout: 2000 }).then(() => true, () => false);
      if (done) {
        fired.push(step.click);
        await page.waitForTimeout(250);
        break;
      }
    }
  }
  return fired;
}

/**
 * THE FRAMEWORK'S DEV OVERLAY IS IN NO PICTURE. Next draws its dev indicator (and its error toast) on dev-server pages only, so a
 * frame captured on the dev server and the same frame from a build would differ by it. Added once the page has loaded: a node in
 * the head before hydration is one the framework did not render.
 */
export const DEV_OVERLAY_CSS = "nextjs-portal, #__next-build-watcher { display: none !important; }";
export const hideDevOverlay = (page) => page.addStyleTag({ content: DEV_OVERLAY_CSS }).catch(() => undefined);

/**
 * A PICTURE IS TAKEN WHEN TWO SHOTS IN A ROW COME OUT BYTE FOR BYTE IDENTICAL, `STABLE_GAP_MS` apart, at most `STABLE_TRIES` shots:
 * a page still loading or moving (a number counting up, a spring) cannot. `shoot` returns the bytes; `before` runs ahead of every
 * shot after the first. Returns the last shot, whether it was stable, and how many were taken. The capture and the design system
 * capture both use it, so their pictures are proved the same way.
 */
export const STABLE_TRIES = 5;
export const STABLE_GAP_MS = 600;
export async function stableShot(page, shoot, { before } = {}) {
  let previous = null;
  for (let tries = 1; ; tries += 1) {
    if (tries > 1 && before) await before();
    const image = await shoot();
    if (previous && Buffer.compare(previous, image) === 0) return { image, stable: true, tries };
    previous = image;
    await page.waitForTimeout(STABLE_GAP_MS);
    if (tries >= STABLE_TRIES) return { image, stable: false, tries };
  }
}

/* ------------------------------------------------------------------ 4. a forbid hit names its remedy */

/** What to do when text the canvas forbids is on a frame. Printed once, under the failures it explains. */
export function forbidRemedy({ appUrl, storageState, hits }) {
  const file = storageState ?? "design-canvas/auth-state.json";
  return [
    `${hits} frame(s) show text this canvas forbids: an overlay from the app is covering the picture. The remedy, in order:`,
    `  1. Dismiss it ONCE in the capture browser's own origin and save the session again: npx playwright open --save-storage=${file} ${appUrl}`,
    `  2. Or declare the dismissal in design-canvas/dismiss.json, which the capture and the oracle both read:`,
    `       { "*": [ { "localStorage": { "<the app's dismissal key>": "1" } }, { "click": "<the button's exact name>" } ] }`,
    `  3. Keep the overlay's text in this canvas's \`forbid\` list either way: it is what catches the next campaign the app ships.`,
  ].join("\n");
}
