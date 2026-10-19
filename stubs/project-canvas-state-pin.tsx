"use client";

/**
 * design-canvas ADAPTER — the one thing the canvas mounts inside the app itself.
 *
 * It exists so `./states.ts` is evaluated inside a canvas frame before the page's own components mount, which
 * is the only moment early enough to pin a state: a screen that reads a store into `useState` on mount, or
 * memoises a selector with an empty dependency list, will otherwise render the default while the frame claims a
 * special case. It calls the apply again on its first render, because a client-side navigation changes the query
 * without re-evaluating a module.
 *
 * MOUNTED IN the root layout by the installer, as two local lines (the import and the element, each marked `design-canvas:local`),
 * which stay in this working copy and never reach a commit. Delete them and the whole `design-canvas/` folder goes with nothing
 * left behind.
 *
 * DELETE THIS FILE WITH: the design-canvas/ folder. A project that pins no states does not need it at all.
 */

import { useEffect } from "react";

import { CANVAS_STATE_PARAM } from "../core/types";
import { applyCanvasState, canvasPinsAllowed } from "./states";

/**
 * A PINNED PAGE MUST NEVER SHOW A DIFFERENT REAL STATE, not even for a moment — and this is a correctness fix,
 * not a nicety.
 *
 * THE BUG. Pinning happens in the browser, because the state lives in client stores. The SERVER therefore
 * renders the route's DEFAULT state and sends that HTML, and the page only becomes the pinned state once
 * hydration has run. Every frame's Open button landed on exactly that: a real, plausible, WRONG screen for as
 * long as hydration took — which on a cold dev route is seconds, not milliseconds.
 *
 * The rule: a button that opens a frame opens the same thing in the same state. Every pinned URL server-renders
 * the route's default state first, and no automated check can see it: the capture pipeline waits for the settled
 * page, so it always photographs the RIGHT state.
 *
 * WHY THE FIX IS A SCRIPT AND A STYLE RATHER THAN REACT. The wrong-state window is BEFORE hydration, so nothing
 * React does can close it — by the time a component can decide anything, the browser has already painted the
 * server's HTML. What runs earlier is markup: a `<style>` and an inline `<script>` in the initial document. The
 * script sets an attribute when the URL carries a pin, the style hides the body while it is set, and the effect
 * below clears it once the state is really in place.
 *
 * IT COSTS NOTHING ON AN ORDINARY LOAD. No `?canvas=` in the URL means the script sets nothing, the style
 * matches nothing, and every real user gets the page exactly as before — no blank frame, no deferred render, no
 * hydration mismatch, because the server and the client render the same tree either way.
 *
 * The script clears the attribute itself after 5 seconds regardless. A tool whose failure mode is a permanently
 * blank app is worse than the bug it fixes.
 *
 * `dangerouslySetInnerHTML` here carries no injection surface: the string is a module constant, and its one
 * interpolation is `CANVAS_STATE_PARAM`, a hardcoded literal from `core/types.ts`. Nothing from the request, the
 * URL or any store reaches it.
 */
const PIN_STYLE_ID = "canvas-pinning";

/**
 * AN INJECTED STYLE ELEMENT RATHER THAN AN ATTRIBUTE, because of what React says about the alternative.
 *
 * The first version set `data-canvas-pinning` on `<html>`, and React warned on every pinned page: "Extra
 * attributes from the server: data-canvas-pinning". `<html>` is server-rendered, so an attribute the server did
 * not send is a hydration difference — harmless, but noise in a console that this tool's own pipeline reads. A
 * `<style>` element appended to `<head>` is not diffed, so it is silent.
 */
const BLANK_UNTIL_PINNED = `
(function () {
  try {
    if (!new URLSearchParams(location.search).has(${JSON.stringify(CANVAS_STATE_PARAM)})) return;
    var style = document.createElement("style");
    style.id = ${JSON.stringify(PIN_STYLE_ID)};
    style.textContent = "body{visibility:hidden!important}";
    document.head.appendChild(style);
    setTimeout(function () { style.remove(); }, 5000);
  } catch (error) {
    /* Never let this stop the app from rendering. */
  }
})();
`;

/**
 * THE MARK THAT SAYS THE PIN IS REALLY IN PLACE, for `capture.mjs` to wait on.
 *
 * Without it the capture has no way to know the difference between "this page has settled" and "this page has
 * settled AS THE PINNED STATE". Those are not the same moment: the pin can only run in the browser, so the
 * server sends the default and the state arrives with hydration. Every settle signal the capture has — network
 * quiet, fonts ready, animations done, two identical screenshots — can be satisfied by the server's version.
 *
 * The consequence was a capture whose verdicts depended on load: a full 41-screen run failed five run-pinned
 * screens for missing text those pages plainly contain, and each one proved itself in six seconds when captured
 * alone. Waiting a fixed number of seconds instead only moves the threshold, which was tried first and failed
 * again on a different five.
 *
 * Set in an effect rather than during render, so nothing here is a hydration difference: the server never sends
 * it, and the client only adds it after React has already rendered with the pinned state in place.
 */
const PINNED_MARK = "data-canvas-pinned";

/**
 * A STATE THE STATES FILE DOES NOT HAVE IS MARKED AS SUCH, never as pinned: the page then shows the default, and a frame that
 * waits only for the mark would photograph that default under the state's name. The capture fails such a frame and keeps its
 * previous picture.
 */
const UNKNOWN_STATE = "unknown";

export function CanvasStatePin() {
  /* `canvasPinsAllowed()`, not NODE_ENV: see its note in ./states.ts. */
  const known = canvasPinsAllowed() ? applyCanvasState().known : true;

  /* After hydration the store holds the pinned state and React has rendered it, so the page can be shown. */
  useEffect(() => {
    document.getElementById(PIN_STYLE_ID)?.remove();
    /* Same effect, deliberately: the moment the page becomes safe to LOOK at is the moment it is safe to JUDGE. */
    document.documentElement.setAttribute(PINNED_MARK, known ? "1" : UNKNOWN_STATE);
  }, [known]);

  if (!canvasPinsAllowed()) return null;
  return <script dangerouslySetInnerHTML={{ __html: BLANK_UNTIL_PINNED }} />;
}
