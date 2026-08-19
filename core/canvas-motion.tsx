"use client";

/**
 * design-canvas CORE — every transition the canvas runs, in one file.
 *
 * WHY ONE FILE. Owner, on the canvas: _"we just simply lack smooth animations. something very simple but in
 * different places where it makes sense... It all happens instantly right now, but it would make this internal
 * tool feel more premium if it was smooth"_ — with the constraint that came with it: _"It definitely has to be
 * high in performance rather than have a beautiful UI."_
 *
 * Those two pull against each other, so the motion is deliberately cheap and deliberately centralised:
 *
 *   - **Only `opacity` and `transform`.** Both are composited, so a panel fading in never lays out or paints
 *     the canvas behind it. Nothing here animates height, width, top or left; a diagram holding forty
 *     screenshots cannot afford a layout pass for a menu.
 *   - **One duration and one curve, named here.** A tool where every element eases differently reads as
 *     nervous rather than smooth, and tuning it means editing one constant instead of hunting nine.
 *   - **Exit animations need the element to still exist**, which is the whole reason `useOpenState` exists —
 *     React unmounts it the instant the flag goes false, and an unmounted panel cannot fade.
 *   - **`prefers-reduced-motion` collapses all of it to zero.** Not a nicety: the reviewer pans and zooms
 *     continuously, and for someone who has asked the operating system for less movement, chrome sliding
 *     around the edges of that is the worst possible place to add some.
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
 * THE REVIEW BAR ALSO CHANGES COLOUR, so its tint has to travel with the same duration and curve as everything else.
 *
 * `BAR_MOTION` names the two properties a bar animates on the way in and out. The review bar does one more thing: it
 * turns from blue to green as the queue crosses from new screens to comments, and that swapped instantly while the
 * rest of the tool eased. The owner: *"when I switch between these two toolbars, between the new screens and comments
 * to review, there should be a smooth animation like everywhere else we have it. It should not change just
 * instantly."* Derived from `BAR_MOTION` rather than written out, so the two can never drift apart.
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

/**
 * KEEP IT MOUNTED LONG ENOUGH TO LEAVE.
 *
 * Returns `[present, open]`. Render while `present`; put `open` on `data-open`. When the caller's flag goes
 * false, `open` flips immediately — starting the exit transition — and `present` stays true for one duration
 * so the transition can actually run. Opening is the mirror: mounted first at `open=false`, flipped true on
 * the next frame, because a browser does not transition a property that was set in the same paint the element
 * appeared in. That last detail is the entire reason this is a hook and not an inline boolean.
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
 * CLOSE ON A PRESS OUTSIDE.
 *
 * Owner: _"whenever any menus are open, I should be able to dismiss them by clicking outside... The only
 * exception could be the comment menu, because otherwise the user can by accident close it, removing all the
 * text that they wrote."_ So this is opt-in per menu, and the comment draft deliberately does not opt in.
 *
 * `pointerdown` in the CAPTURE phase, because the canvas surface calls `setPointerCapture` on its own
 * pointerdown to pan — by the bubble phase the event is no longer travelling anywhere this could see it.
 * Escape closes too: a menu that only closes by pointer is a menu a keyboard cannot put down.
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
