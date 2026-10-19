"use client";

/**
 * design-canvas core: the Hand Off button and its panel. The panel shows the prompt for the agent (`handoff.ts`), a
 * switch that marks an exploration decided, Copy, and Clear All.
 */

import { useCallback, useRef, useState } from "react";

import { cn } from "./cn";
import {
  BAR_ITEM,
  BAR_PAD,
  BAR_SOLID,
  DANGER,
  MOTION_STYLE,
  PANEL_MOTION,
  PANEL_SURFACE,
  useDismissOnOutside,
  useOpenState,
} from "./canvas-motion";
import { CanvasTooltip } from "./canvas-tooltip";
import type { handoffPrompt } from "./handoff";
import { IconCheck, IconCopy, IconTrash } from "./icons";

/**
 * A section's link, written to the clipboard. A refused write falls back to a selected text field and the
 * browser's copy command; `false` means neither worked and the caller shows the link instead.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    /* Selecting the field takes focus; it goes back to the button, which keeps its tooltip open. */
    const was = document.activeElement as HTMLElement | null;
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.append(field);
    field.select();
    let done = false;
    try {
      done = document.execCommand("copy");
    } catch {
      done = false;
    }
    field.remove();
    was?.focus({ preventScroll: true });
    return done;
  }
}

export function HandoffButton({
  prompt,
  explore,
  settled,
  onSettle,
  onDismiss,
  total,
  onClearAll,
}: {
  prompt: ReturnType<typeof handoffPrompt>;
  /** Whether the Exploration tab is in view: only there can the question be marked decided. */
  explore: boolean;
  settled: boolean;
  onSettle: () => void;
  /** A press outside closed the panel. */
  onDismiss: () => void;
  /** Every comment in the review file, which Clear All deletes. */
  total: number;
  onClearAll: () => void;
}) {
  const [handoff, setHandoff] = useState(false);
  /* The whole button-plus-panel, so a press on the button itself is not read as a press outside. */
  const handoffRef = useRef<HTMLDivElement | null>(null);
  /** Clear All, pressed once. See the button for why it takes two. */
  const [armed, setArmed] = useState(false);
  const [copied, setCopied] = useState(false);
  /** The observer watching the prompt box, kept so a re-attach cannot leave the old one running. */
  const watching = useRef<ResizeObserver | null>(null);
  /* Whether the prompt overflows its box, and whether its end is reached; both drive the fade. */
  const [promptScrolls, setPromptScrolls] = useState(false);
  const [promptAtEnd, setPromptAtEnd] = useState(false);
  /* A callback ref with a `ResizeObserver`: the panel animates in, so the prompt is measured when its node attaches
     and again whenever its layout changes. */
  const promptBox = useCallback((box: HTMLParagraphElement | null) => {
    watching.current?.disconnect();
    if (!box) return;
    box.scrollTop = 0;
    setPromptAtEnd(false);
    const measure = () =>
      setPromptScrolls(box.scrollHeight > box.clientHeight + 2);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    watching.current = observer;
  }, []);
  const [handoffPresent, handoffOpen] = useOpenState(handoff);
  /* A press elsewhere closes the panel; decided applies to one hand-off, so the next panel opens undecided. */
  const closeHandoff = useCallback(() => {
    setHandoff(false);
    setArmed(false);
    onDismiss();
  }, [onDismiss]);
  useDismissOnOutside(handoff, handoffRef, closeHandoff);
  return (
    <div className="relative" ref={handoffRef}>
      <button
        type="button"
        aria-expanded={handoff}
        onClick={() => {
          setArmed(false);
          setHandoff((open) => !open);
        }}
        /* Solid: the primary action of the comment layer. */
        className={cn(BAR_ITEM, BAR_PAD, BAR_SOLID)}
      >
        Hand Off
        {/* Everything waiting to travel, verdicts included since they are comments; the panel breaks it down. */}
        <span className="tabular-nums opacity-55">{prompt.waiting.length}</span>
      </button>
      {/* Mounted through its own exit, so closing fades rather than blinks — see `useOpenState`. */}
      {handoffPresent ? (
        <div
          data-open={handoffOpen}
          style={MOTION_STYLE}
          className={cn(
            "absolute right-0 top-[calc(100%+12px)] w-[420px] origin-top-right p-4",
            PANEL_SURFACE,
            PANEL_MOTION,
          )}
        >
          {/* Only the parts that exist, so the line never shows a zero. */}
          <p className="text-[0.8125rem] text-white">
            {prompt.summary}. Give the agent this line:
          </p>
          {/** Decided sits above the prompt because it rewrites it; exploration view only. */}
          {explore && prompt.panels.length > 0 ? (
            <button
              type="button"
              onClick={onSettle}
              aria-pressed={settled}
              className="mt-3 flex w-full items-start gap-2.5 rounded-lg bg-white/[0.06] px-3 py-2.5 text-left"
            >
              <span
                className={cn(
                  "mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border",
                  settled
                    ? "border-white bg-white text-[hsl(180_15%_5.5%)]"
                    : "border-white/30",
                )}
              >
                {settled ? <IconCheck size={11} /> : null}
              </span>
              <span className="text-[0.75rem] leading-snug text-white">
                Check this when the exploration is done
                <span className="mt-0.5 block font-medium text-white/50">
                  The agent will apply your comments, delete the exploration, and move what you
                  kept into the user flows and grouped screens
                </span>
              </span>
            </button>
          ) : null}
          {/** Scrolls inside a fixed height with no scrollbar; a `mask-image` fade shows there is more until the end. */}
          <p
            ref={promptBox}
            onScroll={(event) => {
              const box = event.currentTarget;
              setPromptAtEnd(
                box.scrollTop + box.clientHeight >= box.scrollHeight - 2,
              );
            }}
            className="mt-2 max-h-[168px] overflow-y-auto rounded-lg bg-white/[0.06] px-4 py-3 text-[0.75rem] font-medium leading-relaxed text-white/60 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            style={
              promptScrolls && !promptAtEnd
                ? {
                    maskImage:
                      "linear-gradient(to bottom, black calc(100% - 28px), transparent)",
                    WebkitMaskImage:
                      "linear-gradient(to bottom, black calc(100% - 28px), transparent)",
                  }
                : undefined
            }
          >
            {prompt.text}
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              className="inline-flex h-8 items-center gap-1.5 rounded-full bg-white px-3 text-[0.75rem] font-medium text-[hsl(180_15%_5.5%)]"
              onClick={async () => {
                if (!(await copyText(prompt.text))) return;
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1800);
              }}
            >
              {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
              {copied ? "Copied" : "Copy"}
            </button>
            {/**
             * Two presses, because it deletes every comment and picture: the first arms it and shows `comments.length`,
             * the raw count it destroys; the second acts. Not a dialog, since this panel is already the surface.
             */}
            <button
              type="button"
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[0.75rem] font-medium",
                DANGER,
              )}
              onClick={() => {
                if (!armed) {
                  setArmed(true);
                  return;
                }
                onClearAll();
                setArmed(false);
                setHandoff(false);
              }}
            >
              <IconTrash size={14} />
              {armed ? `Delete all ${total}?` : "Clear All"}
            </button>
            {/* Where the files live, in a tooltip whose hover region is the word itself. */}
            <CanvasTooltip
              className="ml-auto text-[0.75rem] font-medium text-white/35"
              label="Where?"
              title="Where these live"
            >
              In `design-canvas/comments/`, one JSON file and a picture per note. Both are gitignored, so
              nothing reaches the repository, and Clear all empties them.
            </CanvasTooltip>
          </div>
        </div>
      ) : null}
    </div>
  );
}
