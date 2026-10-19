"use client";

/**
 * design-canvas core: the review row at the bottom (one queue walked kind by kind: new screens, changed screens,
 * comments to review), its switches to the other kinds, and the undo bar that stands in for it after Approve All.
 */

import { useEffect, useState } from "react";

import { cn } from "./cn";
import {
  BAR_ITEM,
  BAR_MOTION,
  BAR_MOTION_TINT,
  BAR_SQUARE,
  MOTION_STYLE,
  REVIEW_QUIET,
  REVIEW_SHADOW,
  useOpenState,
} from "./canvas-motion";
import { IconCommentBubble, IconFrames, IconLeft, IconRight } from "./icons";

export type ReviewKind = "new" | "changed" | "comments";

/** The three review queues: the bar's hue, the count's hue on the switch, and the words. Changed wears the toolbar's own chrome. */
const REVIEW_KIND = {
  new: { bar: "bg-[hsl(206_58%_36%)]", count: "text-[hsl(206_58%_30%)]", label: "New Screens", title: "New screens" },
  changed: { bar: "bg-[hsl(180_15%_5.5%)]", count: "text-[hsl(180_15%_5.5%)]", label: "Changed Screens", title: "Changed screens" },
  comments: { bar: "bg-[hsl(154_46%_30%)]", count: "text-[hsl(154_46%_24%)]", label: "Comments to Review", title: "Comments to review" },
} as const;

export function ReviewRow({
  show,
  onKind,
  kindCount,
  kindIndex,
  kindTotal,
  onSwitch,
  onPrev,
  onCurrent,
  onNext,
  onApproveAll,
}: {
  show: boolean;
  /** The kind under the cursor, which sets the bar's color and words. */
  onKind: ReviewKind;
  kindCount: Record<ReviewKind, number>;
  /** Position and total inside the kind the label names. */
  kindIndex: number;
  kindTotal: number;
  onSwitch: (kind: ReviewKind) => void;
  onPrev: () => void;
  onCurrent: () => void;
  onNext: () => void;
  onApproveAll: () => void;
}) {
  const [reviewPresent, reviewOpen] = useOpenState(show);
  if (!reviewPresent) return null;
  return (
    <div
      className="absolute bottom-6 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-2"
      data-canvas-review-row=""
    >
      {/** One switch per other queue with something waiting, in that queue's color with its count. */}
      {(["new", "changed", "comments"] as const)
        .filter((kind) => kind !== onKind && kindCount[kind] > 0)
        .map((kind) => (
        /** The review bar's own surface holding one `BAR_ITEM` square in `REVIEW_QUIET`, so its height matches. */
        <div
          key={kind}
          style={MOTION_STYLE}
          className={cn(
            "relative flex items-center rounded-full p-1.5",
            REVIEW_SHADOW,
            REVIEW_KIND[kind].bar,
          )}
          data-canvas-chrome=""
          data-canvas-review-switch={kind}
        >
          <button
            type="button"
            title={REVIEW_KIND[kind].title}
            aria-label={`${REVIEW_KIND[kind].title} (${kindCount[kind]})`}
            onClick={() => onSwitch(kind)}
            className={cn(BAR_ITEM, REVIEW_QUIET, BAR_SQUARE)}
          >
            {kind === "comments" ? <IconCommentBubble /> : <IconFrames />}
          </button>
          {/* The count in the corner, white on the bar's hue; `tabular-nums` keeps two digits from shifting its width. */}
          <span
            className={cn(
              "pointer-events-none absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-white px-1 text-[0.625rem] font-semibold leading-none tabular-nums",
              REVIEW_KIND[kind].count,
            )}
          >
            {kindCount[kind]}
          </span>
        </div>
      ))}
    <div
      data-open={reviewOpen}
      style={MOTION_STYLE}
      /* The gap lives on the groups, so the stepper is flush and the rest is spaced. The bar's color follows the
         kind in view, matching the outline on the frames. */
      className={cn(
        /* More padding on the right: Approve All is the widest item and needs room from the edge. */
        "flex items-center rounded-full p-1.5 pr-2.5",
        REVIEW_SHADOW,
        REVIEW_KIND[onKind].bar,
        BAR_MOTION_TINT,
      )}
      data-canvas-chrome=""
      data-canvas-review={onKind}
    >
      {/* The stepper: arrow, count, arrow, flush against each other so they read as one control. */}
      <div className="flex items-center" data-canvas-stepper="">
      <button
        type="button"
        aria-label="Previous"
        className={cn(BAR_ITEM, REVIEW_QUIET, BAR_SQUARE)}
        onClick={onPrev}
      >
        <IconLeft />
      </button>
      {/* The count is the label: no glyph, and slightly tighter padding. */}
      <button
        type="button"
        title="Go to this one"
        className={cn(BAR_ITEM, "px-2.5", REVIEW_QUIET, "tabular-nums")}
        onClick={onCurrent}
      >
        {kindIndex + 1} of {kindTotal}{" "}
        {REVIEW_KIND[onKind].label}
      </button>
      <button
        type="button"
        aria-label="Next"
        className={cn(BAR_ITEM, REVIEW_QUIET, BAR_SQUARE)}
        onClick={onNext}
      >
        <IconRight />
      </button>
      </div>
      <span className="mx-1.5 h-5 w-px bg-white/25" />
      <button
        type="button"
        className={cn(BAR_ITEM, "px-2.5", REVIEW_QUIET)}
        onClick={onApproveAll}
      >
        {/* One word for both: either way it means the reviewer has looked at these and they are fine. */}
        Approve All
      </button>
    </div>
    </div>
  );
}

/** The undo window after Approve All on comments, in the review row's place and the comments' green. */
export function UndoBar({ removing, onUndo }: { removing: string[] | null; onUndo: () => void }) {
  const [undoPresent, undoOpen] = useOpenState(removing !== null);
  /* Held separately because the bar outlives `removing`: it is still fading when the list is already null. */
  const [undoCount, setUndoCount] = useState(0);
  useEffect(() => {
    if (removing !== null) setUndoCount(removing.length);
  }, [removing]);
  if (!undoPresent) return null;
  return (
    <div
      data-open={undoOpen}
      style={MOTION_STYLE}
      className={cn(
        "absolute bottom-6 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-1 rounded-full bg-[hsl(154_46%_30%)] p-1.5",
        REVIEW_SHADOW,
        BAR_MOTION,
      )}
      data-canvas-chrome=""
      data-canvas-undo=""
    >
      {/* `undoCount` rather than `removing.length`: this element outlives `removing` by one transition so it
         can fade out, and reading a field off null is how that would crash. */}
      <span className="px-2.5 text-[0.8125rem] font-medium text-white/85">
        Approved {undoCount}
      </span>
      <button
        type="button"
        className={cn(BAR_ITEM, "px-2.5", REVIEW_QUIET)}
        onClick={onUndo}
      >
        Undo
      </button>
    </div>
  );
}
