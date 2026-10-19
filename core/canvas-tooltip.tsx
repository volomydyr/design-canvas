"use client";

/**
 * design-canvas CORE — the one hover explanation the canvas has.
 *
 * Fixed pixel type and width, positioned in viewport space from the trigger's measured rect and clamped to the
 * window, so it reads the same in the toolbar, in a panel and over the world at any zoom.
 *
 * Portalled to `document.body`: `position: fixed` does not escape an ancestor with a `transform`, and the canvas
 * world is one, so rendered in place the panel would be positioned and scaled by the zoom.
 *
 * The whole `label`, with the mark inside it, is one hover region.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { MOTION_STYLE, PANEL_MOTION, useOpenState } from "./canvas-motion";
import { IconInfo } from "./icons";
import { hangsBelow } from "./picture-size";

/** The panel's own dimensions, in real pixels. Never relative to anything. */
const WIDTH = 300;
/** How far the panel sits from the trigger, and how close it may come to the window edge. */
const GAP = 10;
const MARGIN = 12;

/**
 * The panel's surface: the hand-off panel's shape and shadow, one step lighter than the stage
 * (`hsl(192 12% 13%)`), because a tooltip floats over the frames while the darker toolbar sits under them.
 */
const PANEL =
  "pointer-events-none fixed z-[200] rounded-2xl bg-[hsl(192_12%_18%)] p-4 shadow-[0px_4px_16px_0px_rgba(0,0,0,0.24),0px_10px_32px_0px_rgba(0,0,0,0.28)]";

export function CanvasTooltip({
  label,
  title,
  children,
  mark = 15,
  className = "",
  compact = false,
}: {
  /** The visible trigger. Hovering ANY of it opens the panel, the mark included. */
  label: ReactNode;
  /** The panel's heading. One short noun phrase. Omitted with `compact`, where the body is the whole of it. */
  title?: string;
  /** The panel's body. */
  children: ReactNode;
  /**
   * The mark's size in the pixels of whatever it sits in: 15 for chrome, larger beside a heading drawn in world
   * pixels. `0` for no mark, for a trigger that already looks hoverable, such as a `+4` badge.
   */
  mark?: number;
  className?: string;
  /** A short hint for an icon button: body text only, as wide as its words, centred on the trigger, no title. */
  compact?: boolean;
}) {
  const hostRef = useRef<HTMLSpanElement | null>(null);
  const panelRef = useRef<HTMLSpanElement | null>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  /**
   * The pointer drives `hovered`; `useOpenState` keeps the panel `present` for one duration after it goes false,
   * and the position is kept, so the panel fades out where it stood.
   */
  const [hovered, setHovered] = useState(false);
  const [present, open] = useOpenState(hovered && at !== null);

  /**
   * Placed from the real panel, hidden until then: `GAP` from the trigger, below when there is room, else above,
   * right-aligned (a compact one centred), and clamped to the window. `getBoundingClientRect` already includes the
   * canvas transform, so a trigger in the world reports where it is on screen.
   */
  const place = useCallback(() => {
    const node = hostRef.current;
    const panel = panelRef.current;
    if (!node || !panel) return;
    const rect = node.getBoundingClientRect();
    const size = panel.getBoundingClientRect();
    const wantLeft = compact ? rect.left + rect.width / 2 - size.width / 2 : rect.right - size.width;
    const left = Math.min(Math.max(MARGIN, wantLeft), window.innerWidth - size.width - MARGIN);
    const top = hangsBelow({ anchorBottom: rect.bottom, height: size.height, gap: GAP, bottom: window.innerHeight - MARGIN })
      ? rect.bottom + GAP
      : Math.max(MARGIN, rect.top - GAP - size.height);
    setAt((was) => (was && Math.abs(was.left - left) <= 0.5 && Math.abs(was.top - top) <= 0.5 ? was : { left, top }));
  }, [compact]);
  /* Once per hover, before the first paint. */
  useLayoutEffect(() => {
    if (hovered && !at) place();
  }, [hovered, at, place]);
  /* A window resize moves the trigger under an open panel. */
  useEffect(() => {
    if (!hovered) return;
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [hovered, place]);
  const show = () => {
    setAt(null);
    setHovered(true);
  };

  return (
    <span
      ref={hostRef}
      /* `data-canvas-chrome` keeps the pan surface's pointer capture off the trigger. See trap 18. */
      data-canvas-chrome=""
      className={`relative inline-flex cursor-help items-center gap-1.5 align-middle ${className}`}
      tabIndex={0}
      role="note"
      aria-label={title ?? (typeof children === "string" ? children : undefined)}
      onPointerEnter={show}
      onPointerLeave={() => setHovered(false)}
      onFocus={show}
      onBlur={() => setHovered(false)}
    >
      {label}
      {mark > 0 ? <IconInfo size={mark} className="opacity-70" /> : null}
      {hovered || present
        ? createPortal(
            <span
              ref={panelRef}
              className={`${PANEL} ${PANEL_MOTION}${compact ? " px-3 py-2" : ""}`}
              data-open={open}
              style={{
                ...MOTION_STYLE,
                left: at?.left ?? 0,
                top: at?.top ?? 0,
                visibility: at ? undefined : "hidden",
                ...(compact ? { width: "max-content", maxWidth: WIDTH } : { width: WIDTH }),
              }}
              /* The pointer passes through it, so leaving the trigger always closes it and it never takes a click. */
              role="tooltip"
            >
              {compact ? (
                <span className="block text-[0.8125rem] font-medium text-white">{children}</span>
              ) : (
                <>
                  <span className="block text-[0.8125rem] font-semibold text-white">
                    {title}
                  </span>
                  <span className="mt-1.5 block text-[0.75rem] leading-relaxed text-white/60">
                    {children}
                  </span>
                </>
              )}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
}
