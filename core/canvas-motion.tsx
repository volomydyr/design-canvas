"use client";

/**
 * design-canvas core: every transition the canvas runs, and the chrome's shared classes (bars, panels, rows), in
 * one file.
 *
 * Motion is cheap and centralised, because performance comes before polish:
 *   - Only `opacity` and `transform`, which are composited, so a fading panel never lays out the canvas behind it.
 *   - One duration and one curve, named here, so every element eases the same way.
 *   - `useOpenState` keeps an element mounted through its exit, because an unmounted panel cannot fade.
 *   - `prefers-reduced-motion` turns all of it off.
 */

import { useEffect, useRef, useState } from "react";

/** The one duration, in milliseconds. Long enough to read as motion, short enough never to be in the way. */
export const MOTION_MS = 140;

/** The one curve: fast out of the gate, settled at the end. */
export const EASE = "cubic-bezier(0.22, 0.61, 0.36, 1)";

/**
 * A panel that fades and lifts. Drive it with `data-open` — the attribute selector means the open and closed
 * appearances are two lines of CSS rather than two branches of JSX, so they cannot drift apart.
 */
export const PANEL_MOTION =
  "transition-[opacity,transform] motion-reduce:transition-none data-[open=false]:pointer-events-none data-[open=false]:opacity-0 data-[open=false]:translate-y-1 data-[open=true]:opacity-100 data-[open=true]:translate-y-0";

/** A bar that rises from the bottom edge: same fade, a little more travel, because it comes from off-screen. */
export const BAR_MOTION =
  "transition-[opacity,transform] motion-reduce:transition-none data-[open=false]:pointer-events-none data-[open=false]:opacity-0 data-[open=false]:translate-y-2 data-[open=true]:opacity-100 data-[open=true]:translate-y-0";

/**
 * `BAR_MOTION` plus `background-color`, for the review bar, whose tint changes between its two queues. Derived
 * from `BAR_MOTION` so the two cannot drift apart.
 */
export const BAR_MOTION_TINT = BAR_MOTION.replace(
  "transition-[opacity,transform]",
  "transition-[opacity,transform,background-color]",
);

/** The inline style both of the above need. Kept here so the duration and curve have exactly one home. */
export const MOTION_STYLE = {
  transitionDuration: `${MOTION_MS}ms`,
  transitionTimingFunction: EASE,
} as const;

/** The chrome's near-black surface, its round bars (toolbar, zoom, switcher) and its panels, and the review bars' deeper shadow. */
export const BAR_SURFACE = "rounded-full bg-[hsl(180_15%_5.5%)] px-2 py-2 shadow-[0px_4px_16px_0px_rgba(0,0,0,0.04),0px_10px_32px_0px_rgba(0,0,0,0.04)]";
export const PANEL_SURFACE = "rounded-2xl bg-[hsl(180_15%_5.5%)] shadow-[0px_4px_16px_0px_rgba(0,0,0,0.04),0px_10px_32px_0px_rgba(0,0,0,0.04)]";
export const REVIEW_SHADOW = "shadow-[0px_4px_16px_0px_rgba(0,0,0,0.18),0px_10px_32px_0px_rgba(0,0,0,0.22)]";
/** The blue corner dot on a tab or the switcher: something waits there. */
export const DOT = "absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-[hsl(211_100%_60%)]";
/** Every delete button: the annotation red on a red wash, the only red this tool owns. */
export const DANGER =
  "text-[hsl(0_84.2%_67%)] transition-colors duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-[hsl(0_84.2%_60.2%_/_0.14)] hover:text-[hsl(0_84.2%_72%)]";

/** A row in a chrome panel's list (the canvas switcher, the search results): a title over a quiet subline. */
export const ROW = "flex items-center gap-2 rounded-xl px-3 py-2.5 text-[0.8125rem] transition-colors";
/** The one quiet type for a row's subline, counts and empty states. */
export const ROW_SUB = "block truncate text-white/35";

/**
 * Returns `[present, open]`: render while `present`, put `open` on `data-open`. Closing flips `open` at once and
 * keeps `present` for one duration; opening mounts at `open=false` and flips it a frame later, because a browser
 * does not transition a property set in the paint the element appeared in.
 */
export function useOpenState(wanted: boolean): [boolean, boolean] {
  const [present, setPresent] = useState(wanted);
  const [open, setOpen] = useState(wanted);
  const frame = useRef<number | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    if (timer.current !== null) window.clearTimeout(timer.current);

    if (wanted) {
      setPresent(true);
      /* Two frames, not one. One rAF still lands in the paint that mounts the element in some browsers, and
         the panel then appears at its final opacity with no transition at all. */
      frame.current = requestAnimationFrame(() => {
        frame.current = requestAnimationFrame(() => setOpen(true));
      });
    } else {
      setOpen(false);
      timer.current = window.setTimeout(() => setPresent(false), MOTION_MS);
    }

    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [wanted]);

  return [present, open];
}

/**
 * Closes a menu on a press outside it or on Escape. Opt-in, so the comment draft does not lose its text by accident.
 * `pointerdown` in the capture phase, because the surface's pan captures the pointer before it can bubble here.
 */
export function useDismissOnOutside(
  open: boolean,
  ref: { current: HTMLElement | null },
  close: () => void,
) {
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      const node = ref.current;
      if (node && event.target instanceof Node && !node.contains(event.target))
        close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, ref, close]);
}

/**
 * One toolbar control, shared so every control has the same height. No padding here: `cn` does not merge
 * Tailwind conflicts, so padding is always the caller's. `whitespace-nowrap` keeps the bar on one row.
 */
export const BAR_ITEM =
  "inline-flex h-8 shrink-0 items-center gap-2 whitespace-nowrap rounded-full text-[0.8125rem] font-medium outline-none transition-colors duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)] focus-visible:ring-1 focus-visible:ring-white/40";
export const BAR_PAD = "px-3.5";
export const BAR_SQUARE = "w-8 justify-center";

/**
 * Four states, four looks: a selected tab is a lifted segment, an unselected tab is quiet type, and an engaged
 * mode and the primary action are both the solid pill, so a tab never reads as an action.
 */
export const BAR_TAB_ON = "bg-white/[0.16] text-white";
export const BAR_QUIET = "text-white/70 hover:bg-white/[0.08] hover:text-white";
export const BAR_SOLID = "bg-white text-[hsl(180_15%_5.5%)]";
export const REVIEW_QUIET =
  "text-white/85 hover:bg-white/[0.16] hover:text-white transition-colors";
/** The hairline between zones of a bar. */
export const DIVIDER = <span className="mx-1 h-5 w-px bg-white/[0.14]" />;
