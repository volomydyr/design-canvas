"use client";

/**
 * design-canvas core: the canvas switcher, top left. It lists the registry's canvases, grouped by `section`, with what
 * waits on each and its frame count; a dot on the button says something waits on another canvas.
 */

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";

import { cn } from "./cn";
import {
  BAR_ITEM,
  BAR_PAD,
  BAR_QUIET,
  BAR_SURFACE,
  DOT,
  MOTION_STYLE,
  PANEL_MOTION,
  PANEL_SURFACE,
  ROW,
  ROW_SUB,
  useDismissOnOutside,
  useOpenState,
} from "./canvas-motion";
import { IconChevron } from "./icons";

/** What waits on one canvas, by kind. */
export type Waits = { fresh: number; changed: number; comments: number };

/** A link travelled client-side, so there is no reload flash; modified presses (new tab, window, download) stay the browser's. */
const navigate = (event: React.MouseEvent<HTMLAnchorElement>, go: () => void) => {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
  event.preventDefault();
  go();
};

export function CanvasSwitcher({
  title,
  canvas,
  siblings,
  waitingIn,
  waitsElsewhere,
}: {
  /** This canvas's title, on the button. */
  title: string;
  canvas: string;
  siblings: Array<{ slug: string; title: string; section: string | null; frames: number }>;
  /** What waits on a canvas, or undefined while it has not been read. */
  waitingIn: (slug: string) => Waits | undefined;
  waitsElsewhere: boolean;
}) {
  const router = useRouter();
  /** Whether the list is open; a press outside or Escape closes it. */
  const [switching, setSwitching] = useState(false);
  const switcherRef = useRef<HTMLDivElement | null>(null);
  const [switcherPresent, switcherOpen] = useOpenState(switching);
  const closeSwitcher = useCallback(() => setSwitching(false), []);
  useDismissOnOutside(switching, switcherRef, closeSwitcher);
  return (
    <div
      ref={switcherRef}
      className="absolute left-5 top-5 z-[60]"
      data-canvas-switcher=""
    >
      <div
        className={cn("flex items-center", BAR_SURFACE)}
        data-canvas-chrome=""
      >
        <button
          type="button"
          aria-expanded={switching}
          title="Switch canvas"
          onClick={() => setSwitching((was) => !was)}
          className={cn(BAR_ITEM, BAR_PAD, BAR_QUIET, "relative")}
        >
          {/* Truncated anyway: a project can declare a longer title than the copy checker allows. */}
          <span className="max-w-[220px] truncate">{title}</span>
          <IconChevron
            className={cn(
              "transition-transform motion-reduce:transition-none",
              switching && "rotate-180",
            )}
          />
          {/* The tabs' corner dot: another canvas has something waiting. The open list says what and where. */}
          {waitsElsewhere ? (
            <span
              aria-label="Something waiting on another canvas"
              data-canvas-switcher-dot=""
              className={DOT}
            />
          ) : null}
        </button>
      </div>
      {switcherPresent ? (
        <div
          data-open={switcherOpen}
          style={MOTION_STYLE}
          className={cn(
            "absolute left-0 top-[calc(100%+12px)] max-h-[calc(100vh-140px)] w-[320px] origin-top-left overflow-y-auto overscroll-contain p-2",
            PANEL_SURFACE,
            PANEL_MOTION,
          )}
          data-canvas-chrome=""
        >
          {/* Grouped by `section` and capped to the window with its own scroll, so a long list of canvases never
              runs off the screen. */}
          {siblings.map((one, index) => [
            one.section && one.section !== siblings[index - 1]?.section ? (
              <div
                key={`section-${one.section}`}
                className="px-3 pb-1 pt-3 text-[0.75rem] font-semibold text-white/40 first:pt-1"
              >
                {one.section}
              </div>
            ) : null,
            <a
              key={one.slug}
              href={`/design-canvas/${one.slug}`}
              onClick={(event) =>
                navigate(event, () => {
                  setSwitching(false);
                  if (one.slug !== canvas) router.push(`/design-canvas/${one.slug}`);
                })
              }
              aria-current={one.slug === canvas ? "page" : undefined}
              className={cn(
                ROW,
                one.slug === canvas
                  ? "bg-white/[0.08] text-white"
                  : "text-white/70 hover:bg-white/[0.06] hover:text-white",
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{one.title}</span>
                {/* What waits there, by kind, in the count's own quiet type. Nothing when nothing waits. */}
                {(() => {
                  const counts = waitingIn(one.slug);
                  const parts = counts
                    ? [
                        counts.fresh > 0 ? `${counts.fresh} new` : null,
                        counts.changed > 0 ? `${counts.changed} changed` : null,
                        counts.comments > 0
                          ? `${counts.comments} ${counts.comments === 1 ? "comment" : "comments"}`
                          : null,
                      ].filter(Boolean)
                    : [];
                  return parts.length > 0 ? (
                    <span
                      className={cn(ROW_SUB, "tabular-nums")}
                      data-canvas-switcher-waiting={one.slug}
                    >
                      {parts.join(", ")}
                    </span>
                  ) : null;
                })()}
              </span>
              {/* The count, not a thumbnail strip: the canvas behind this panel is already the picture view. */}
              <span className="shrink-0 tabular-nums text-white/35">
                {one.frames}
              </span>
            </a>
          ])}
          <span className="mx-3 my-1 block h-px bg-white/[0.08]" />
          <a
            href="/design-canvas"
            onClick={(event) =>
              navigate(event, () => {
                setSwitching(false);
                router.push("/design-canvas");
              })
            }
            className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-[0.8125rem] text-white/55 transition-colors hover:bg-white/[0.06] hover:text-white"
          >
            All canvases
          </a>
        </div>
      ) : null}
    </div>
  );
}
