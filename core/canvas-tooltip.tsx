"use client";

/**
 * design-canvas CORE — the one hover explanation the canvas has.
 *
 * WHY THIS FILE EXISTS. There were two of these, written twice, and both were wrong in a way that only
 * showed up in one of the two places:
 *
 *   1. Sized in `em`. The exploration header sets a huge font size, so `w-[12em]` was ~660px there and
 *      readable; the hand-off panel sets `0.75rem`, so the same class was **108px** wide and the same words
 *      became a column of two-word lines. Owner, on the second one: _"Why would it be so small in width and
 *      so big in height?"_ A width that depends on the font size of whatever it is dropped into is not a
 *      component, it is a coincidence.
 *   2. Positioned `absolute` inside the trigger. In world space that means it scales with the canvas zoom —
 *      crisp at 100%, six-pixel type at 43% — and near a viewport edge it clipped its own first word.
 *
 * So: ONE component, FIXED pixel type and width, positioned in VIEWPORT space from the trigger's measured
 * rect and clamped to the window. It reads identically in the toolbar, in a panel, and floating over the
 * world at any zoom, because none of those can reach it.
 *
 * AND IT IS PORTALLED TO `document.body`, which is not optional. `position: fixed` does NOT escape an
 * ancestor carrying a `transform` — a transform makes that ancestor the containing block for fixed
 * descendants. The canvas world is one big transform, so the first version of this, rendered in place,
 * measured 130x32 with 55px type at 43% zoom: the panel was being positioned AND SCALED by the very zoom it
 * exists to be immune to. A portal is the only way out of a transformed subtree.
 *
 * THE WHOLE TRIGGER IS THE TARGET, not a dot beside it. Owner: _"the whole thing should be hoverable, not
 * just the info icon, even the word 'Where?' should be showing the tooltip on hover."_ So the trigger is
 * whatever the caller passes as `label`, with the mark inside it, and one hover region around both.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { MOTION_STYLE, PANEL_MOTION, useOpenState } from "./canvas-motion";
import { IconInfo } from "./icons";

/** The panel's own dimensions, in real pixels. Never relative to anything. */
const WIDTH = 300;
/** How far the panel sits from the trigger, and how close it may come to the window edge. */
const GAP = 10;
const MARGIN = 12;
/** Roughly how tall the panel gets, for deciding whether it opens downward. */
const ABOVE_ALLOWANCE = 170;

/**
 * The panel's surface. Same shape and shadow as the hand-off panel, ONE STEP LIGHTER THAN THE STAGE rather
 * than darker than it.
 *
 * It used to be the toolbar's near-black, and the toolbar is that colour for a stated reason: chrome sits one
 * step BELOW the stage so the controls read as under the frames rather than beside them. A tooltip is the
 * opposite object — it floats over the stage and over the frames for as long as a pointer rests somewhere — so
 * borrowing the sunken colour made it read as a hole. The owner, on it over a frame: *"the tooltip bg has to be
 * a bit lighter color than it is right now."* The stage is `hsl(192 12% 13%)`; this is the same hue five points
 * up, which is a clear step at any zoom without turning grey.
 */
const PANEL =
  "pointer-events-none fixed z-[200] rounded-2xl bg-[hsl(192_12%_18%)] p-4 shadow-[0px_4px_16px_0px_rgba(0,0,0,0.24),0px_10px_32px_0px_rgba(0,0,0,0.28)]";

export function CanvasTooltip({
  label,
  title,
  children,
  mark = 15,
  className = "",
}: {
  /** The visible trigger. Hovering ANY of it opens the panel, the mark included. */
  label: ReactNode;
  /** The panel's heading. One short noun phrase. */
  title: string;
  /** The panel's body. */
  children: ReactNode;
  /**
   * The mark's size in the pixels of whatever it sits in, or `0` for no mark at all.
   *
   * 15 for chrome, which is everything at the app's own scale. It is a prop because the exploration heading is
   * drawn in WORLD pixels at nearly 200 of them, and a 15px mark beside that is a speck — the panel it opens is
   * viewport-sized either way, but the thing you have to aim at is not.
   *
   * ZERO IS FOR A TRIGGER THAT ALREADY LOOKS HOVERABLE. A `+4` badge is one: it is visibly a stand-in for
   * things it is not showing, so an information mark beside it explained nothing and added a second object to
   * a caption row that had just been trimmed to fit. The owner: *"no need for a info icon here, the +N badge is
   * clear on itself that you can hover over it."*
   */
  mark?: number;
  className?: string;
}) {
  const hostRef = useRef<HTMLSpanElement | null>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  /**
   * HOVERED AND PRESENT ARE TWO DIFFERENT THINGS, which is what buys the exit animation.
   *
   * The panel used to be mounted by its position alone, so leaving the trigger unmounted it in the same frame
   * and there was nothing left on screen to fade — it simply vanished. Now the pointer drives `hovered`,
   * `useOpenState` keeps the panel mounted for one duration after that goes false, and the position is kept
   * rather than cleared so it fades where it stood. Owner: *"all the tooltips should appear and disappear with
   * a smooth animation."*
   */
  const [hovered, setHovered] = useState(false);
  const [present, open] = useOpenState(hovered && at !== null);

  /**
   * MEASURED ON OPEN, from the trigger's real position on screen. `getBoundingClientRect` already has the
   * canvas transform in it, so a trigger floating in the world at 43% zoom reports where it actually is and
   * the panel lands beside it at full size.
   */
  const place = useCallback(() => {
    const node = hostRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    /* Right-aligned to the trigger, then pulled back inside the window. Both existing callers sit near the
       right edge, and a panel that runs off it clips the first word of every line. */
    const left = Math.min(
      Math.max(MARGIN, rect.right - WIDTH),
      window.innerWidth - WIDTH - MARGIN,
    );
    /* Below by default, above when there is no room — an explanation that opens off the bottom of the
       window is the same failure as one that opens off the side. */
    const below = rect.bottom + GAP;
    const room = window.innerHeight - below - MARGIN;
    /* Below by preference. When there is not room, above — and `ABOVE_ALLOWANCE` is a guess at the panel's own
       height rather than a measurement, because the panel does not exist yet at this point. It only has to be
       close: the clamp keeps it on screen either way. */
    setAt({
      left,
      top: room > ABOVE_ALLOWANCE ? below : Math.max(MARGIN, rect.top - GAP - ABOVE_ALLOWANCE),
    });
  }, []);

  /* Re-placed while it is open, because the canvas can be panned or zoomed under it with a trackpad without
     the pointer ever leaving the trigger. */
  useEffect(() => {
    if (!hovered || !at) return;
    const again = () => place();
    window.addEventListener("scroll", again, true);
    window.addEventListener("resize", again);
    return () => {
      window.removeEventListener("scroll", again, true);
      window.removeEventListener("resize", again);
    };
  }, [at, place]);

  return (
    <span
      ref={hostRef}
      /* `data-canvas-chrome` keeps the pan surface's pointer capture off it. Without this the world starts
         dragging on hover and the pointer never reaches the trigger at all. See trap 18. */
      data-canvas-chrome=""
      className={`relative inline-flex cursor-help items-center gap-1.5 align-middle ${className}`}
      tabIndex={0}
      role="note"
      aria-label={title}
      onPointerEnter={() => {
        place();
        setHovered(true);
      }}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => {
        place();
        setHovered(true);
      }}
      onBlur={() => setHovered(false)}
    >
      {label}
      {mark > 0 ? <IconInfo size={mark} className="opacity-70" /> : null}
      {present && at
        ? createPortal(
            <span
              className={`${PANEL} ${PANEL_MOTION}`}
              data-open={open}
              style={{ ...MOTION_STYLE, left: at.left, top: at.top, width: WIDTH }}
              /* It is an explanation, not a surface: the pointer passes through it, so leaving the trigger
                 always closes it and it can never trap a click meant for the canvas. */
              role="tooltip"
            >
              <span className="block text-[0.8125rem] font-semibold text-white">
                {title}
              </span>
              <span className="mt-1.5 block text-[0.75rem] leading-relaxed text-white/60">
                {children}
              </span>
            </span>,
            document.body,
          )
        : null}
    </span>
  );
}
