"use client";

/**
 * design-canvas CORE: the search control in the toolbar, and the list it opens.
 *
 * One field over every frame of every canvas in the project (see `search.ts`). Choosing a result hands it back to the
 * view, which opens its canvas, tab and device and fits the frame. Opened by the button or by Cmd or Ctrl and K;
 * arrows move through the list, Enter picks, Escape or a press outside closes it.
 *
 * The panel hangs under the zoom corner and is never wider than the window less the corner's inset each side, so it
 * fits a phone held upright as well as a desktop.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { cn } from "./cn";
import {
  MOTION_STYLE,
  PANEL_MOTION,
  PANEL_SURFACE,
  ROW,
  ROW_SUB,
  useDismissOnOutside,
  useOpenState,
} from "./canvas-motion";
import { IconSearch } from "./icons";
import { type SearchEntry, searchScreens } from "./search";

export function CanvasSearch({
  entries,
  canvas,
  view,
  onPick,
  buttonClassName,
}: {
  entries: SearchEntry[];
  /** Where the reviewer is, which breaks ties in the ranking. */
  canvas: string;
  view: string;
  onPick: (entry: SearchEntry) => void;
  /** The toolbar's own control classes, so the button is one more control of the same bar. */
  buttonClassName: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [present, shown] = useOpenState(open);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const results = useMemo(
    () => searchScreens(entries, query, { canvas, view }),
    [entries, query, canvas, view],
  );
  useEffect(() => setActive(0), [query]);

  const close = useCallback(() => setOpen(false), []);
  useDismissOnOutside(open, boxRef, close);

  /* Synchronous, so the field exists and takes focus inside the press itself: a touch keyboard only opens for a
     focus that happens during the gesture. The query is kept and selected, so typing replaces it. */
  const show = useCallback(() => {
    flushSync(() => setOpen(true));
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const combo = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
      if (combo && !(event.target as HTMLElement | null)?.closest?.("textarea")) {
        event.preventDefault();
        if (open) close();
        else show();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, show, close]);

  const pick = (entry: SearchEntry | undefined) => {
    if (!entry) return;
    setOpen(false);
    inputRef.current?.blur();
    onPick(entry);
  };

  const move = (by: number) => {
    if (results.length === 0) return;
    const next = (active + by + results.length) % results.length;
    setActive(next);
    listRef.current?.children[next]?.scrollIntoView({ block: "nearest" });
  };

  return (
    <div ref={boxRef} data-canvas-search="">
      <button
        type="button"
        aria-label="Search screens"
        aria-expanded={open}
        aria-keyshortcuts="Meta+K Control+K"
        title="Search screens"
        onClick={() => (open ? close() : show())}
        className={buttonClassName}
      >
        <IconSearch />
      </button>
      {open || present ? (
        <div
          data-open={open && shown}
          style={MOTION_STYLE}
          /* Under the corner bar, right-aligned like the hand-off panel; at phone width it spans the window less the
             bar's own 24px inset on each side. */
          className={cn(
            "absolute right-0 top-[calc(100%+12px)] w-[min(420px,calc(100vw-48px))] origin-top-right p-2",
            PANEL_SURFACE,
            PANEL_MOTION,
          )}
          data-canvas-chrome=""
          data-canvas-search-panel=""
        >
          <input
            ref={inputRef}
            type="text"
            enterKeyHint="search"
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls="canvas-search-results"
            aria-activedescendant={results[active] ? `canvas-search-${active}` : undefined}
            aria-label="Search screens"
            placeholder="Search screens"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") move(1);
              else if (event.key === "ArrowUp") move(-1);
              else if (event.key === "Enter") pick(results[active]);
              else return;
              event.preventDefault();
            }}
            /* 16px on a touch screen, because a smaller field makes a phone zoom the whole page in on focus. */
            className="h-10 w-full rounded-xl bg-white/[0.06] px-3.5 text-[1rem] font-medium text-white outline-none placeholder:text-white/40 focus-visible:ring-1 focus-visible:ring-white/25 sm:text-[0.875rem]"
          />
          {query.trim() ? (
            results.length > 0 ? (
              <div
                ref={listRef}
                id="canvas-search-results"
                role="listbox"
                aria-label="Matching screens"
                className="mt-2 max-h-[min(420px,calc(100dvh-160px))] overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                {results.map((entry, index) => (
                  <button
                    key={`${entry.canvas}/${entry.view}/${entry.groupId}/${entry.screenId}`}
                    id={`canvas-search-${index}`}
                    type="button"
                    role="option"
                    aria-selected={index === active}
                    onMouseMove={() => setActive(index)}
                    onClick={() => pick(entry)}
                    className={cn(ROW, "w-full text-left", index === active ? "bg-white/[0.08] text-white" : "text-white/70")}
                    data-canvas-search-result={entry.screenId}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{entry.label}</span>
                      <span className={ROW_SUB}>
                        {entry.canvasTitle} · {entry.section}
                        {entry.device === "phone" ? " · Phone" : ""}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="px-3 pb-1.5 pt-3 text-[0.8125rem] text-white/35">
                No matching screens
              </p>
            )
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
