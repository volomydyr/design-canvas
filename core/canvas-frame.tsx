"use client";

/**
 * design-canvas core: one screen on the canvas, the captured picture of a real route and the comments drawn on it.
 *
 * A picture rather than the live page, so dozens of frames pan and zoom smoothly; `capture.mjs` proves at capture
 * time what the frame claims, and the manifest carries it. A comment is a rectangle drawn on the picture, and the
 * agent gets the screenshot with that outline burned in.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

/* Relative imports only, nothing from the host project, so a frame's chrome looks the same in every repo. */
import { DANGER, MOTION_STYLE } from "./canvas-motion";
import { drawsSmall, hangsBelow } from "./picture-size";
import { cn } from "./cn";
import { CanvasTooltip } from "./canvas-tooltip";
import {
  IconClose,
  IconDislike,
  IconLike,
  IconDesktop,
  IconExpand,
  IconLeft,
  IconOpenExternal,
  IconRight,
  IconPhone,
  IconSpinner,
  IconToday,
} from "./icons";
import {
  REMARK_OFFSET,
  remarkTiles,
  STICKY_FONT,
  STICKY_LINE,
  STICKY_TOP,
  STICKY_W,
  TILE_LABEL,
} from "./remarks-layout";
import type {
  CanvasComment,
  CanvasDevice,
  CanvasEvidence,
  CanvasRegion,
  CanvasScreen,
  CanvasShot,
} from "./types";
import { openAddress, openHint } from "./types";

/** Smaller than this, in frame pixels, and it was a click rather than an outline. */
const MIN_REGION = 12;

/**
 * The type scale, in world pixels, so labels zoom with the canvas like the frames. Three steps far enough apart to
 * tell at a glance: the name, what it is for, the developer's line. The group title sits above, in canvas-view.tsx.
 */
const NAME_SIZE = 42;
/**
 * Remark colors, one meaning each. Yellow is a proposal: a suggestion's tint and edge, and the sticky-note paper.
 * Orange is where to look: every highlight and the line from a note to its target. Red is kept for comments.
 */
const SUGGESTION_TINT = "#fffbe3";
const SUGGESTION_EDGE = "#ffd84d";
const STICKY_PAPER = "#ffe766";
const ANNOTATE = "#f76707";
const NOTE_SIZE = 28;
const META_SIZE = 23;
const CHIP_SIZE = 23;
/** The open button under a frame: fixed, so it is the same target in the same place on every frame. */
const BUTTON_W = 116;
const BUTTON_H = 52;
/** A comment pin, in world pixels, so it sits on the design the way a sticker would. */
const PIN_SIZE = 44;

/** Space between the caption and the frame, and under the frame. */
const CAPTION_GAP = 26;
const FOOT_GAP = 20;

/**
 * The frame's edge, as a shadow rather than a border: a border on a scaled element rounds differently from the
 * picture inside it and leaves a seam. Two rings: a light hairline for dark screens, a soft shadow for light ones.
 */
const RING = 3;
const REGION_RADIUS = 14;
/* A literal red rather than the host's `--destructive`, so an annotation stays red and findable on any design. */
const RED = "hsl(0 84.2% 60.2%)";
const RED_TINT = "hsl(0 84.2% 60.2% / 0.22)";
const SAVED_REGION = `0 0 0 5px ${RED}, 0 0 0 9px ${RED_TINT}`;
/* The outline stays red in every state; the buttons in its pin say whether the comment has been answered. */
const PIN_SHADOW = `0 8px 24px hsl(0 0% 0% / 0.45)`;
/** The buttons in a note box, in screen pixels like the box. */
const NOTE_GHOST =
  "h-9 rounded-full px-4 text-[0.75rem] font-medium text-white/70 transition-colors duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-white/[0.08] hover:text-white";
const NOTE_PRIMARY =
  "inline-flex h-9 items-center justify-center rounded-full bg-white px-4 text-[0.75rem] font-medium text-[hsl(180_15%_5.5%)]";
/** The secondary beside a primary: the outlined treatment of the buttons under a frame, at the note box's size. */
const NOTE_SECONDARY =
  "h-9 rounded-full px-4 text-[0.75rem] font-medium text-white ring-1 ring-white/[0.22] transition-colors duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-white/[0.12]";
/** The one destructive treatment, shared with Clear All in the toolbar. */
const NOTE_DANGER = cn("h-9 rounded-full px-4 text-[0.75rem] font-medium", DANGER);
/** The X in the corner of an open pin. A control, so it keeps its size on screen like the box does. */
const NOTE_CLOSE =
  "absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-full text-white/45 transition-colors duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-white/[0.08] hover:text-white";
/* The note field, shared by a new note, an edit and a reply. `select-text` because the world disables selection
   (`canvas-surface.tsx`) and Safari, unlike Chrome, inherits that into form fields. */
const NOTE_FIELD =
  "w-full select-text resize-none rounded-xl bg-white/[0.06] px-4 py-3.5 text-[0.875rem] font-medium leading-relaxed text-white outline-none placeholder:text-white/40 focus-visible:ring-1 focus-visible:ring-white/25";
/** Screen pixels: the note box is a control, so it keeps its size on screen via `--canvas-inv-zoom` (canvas-surface.tsx). */
const NOTE_BOX_W = 468;
const NOTE_BOX_RADIUS = 18;
const NOTE_BOX_SHADOW = `0 18px 44px hsl(0 0% 0% / 0.55)`;
const FRAME_EDGE = `0 0 0 ${RING}px hsl(0 0% 100% / 0.14), 0 ${RING * 8}px ${RING * 22}px hsl(0 0% 0% / 0.55)`;
/** The frame's edge in the new-screen blue, brighter and thicker so an unseen frame is findable at low zoom. */
const NEW_EDGE = `0 0 0 ${RING * 1.5}px hsl(206 92% 66% / 0.95), 0 ${RING * 8}px ${RING * 22}px hsl(0 0% 0% / 0.55)`;
/**
 * A seen frame whose picture changed since: a white line with a gap of the canvas ground between it and the picture,
 * so it reads on light screenshots too, held at a few screen pixels at any zoom so it shows when the canvas is fitted.
 */
const CHANGED_EDGE = `0 0 0 calc(2px * var(--canvas-inv-zoom, 1)) hsl(192 12% 13%), 0 0 0 calc(4px * var(--canvas-inv-zoom, 1)) hsl(0 0% 100% / 0.95), 0 ${RING * 8}px ${RING * 22}px hsl(0 0% 0% / 0.55)`;

/** The pills under a frame (file badges, the failure and wireframe pills), and the file badge's own look. */
const PILL = { fontSize: META_SIZE, lineHeight: 1.5, padding: "6px 14px" } as const;
const BADGE = "shrink-0 rounded-full bg-white/[0.09] font-mono text-white/60";
/** The round icon buttons under a frame (today's version, the other device), outlined at rest. */
const ROUND =
  "inline-flex shrink-0 items-center justify-center rounded-full font-medium transition-colors duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)]";
const OUTLINED = "text-white ring-1 ring-white/[0.22] hover:bg-white/[0.12]";
const ROUND_SIZE = { height: BUTTON_H, width: BUTTON_H, lineHeight: 1 } as const;

/** A comment's red outline on the frame, as percentages of it; `fill` tints the one being dragged. */
function Outline({ region, fill }: { region: CanvasRegion; fill?: string }) {
  return (
    <div
      className="pointer-events-none absolute"
      style={{
        left: `${region.xPct}%`,
        top: `${region.yPct}%`,
        width: `${region.wPct}%`,
        height: `${region.hPct}%`,
        borderRadius: REGION_RADIUS,
        boxShadow: SAVED_REGION,
        ...(fill ? { background: fill } : {}),
      }}
    />
  );
}

/**
 * How many badges fit under a frame, by arithmetic rather than measurement, so dragging causes no reflow: the
 * badges are monospace, so a width is characters times size times ratio, plus padding. The rest go to a `+N` badge.
 */
const MONO_RATIO = 0.6;
const SANS_RATIO = 0.55;
/** 14px each side, from the badge's own padding. */
const BADGE_PAD = 28;
/** The gap between everything in the caption row, from the row's own `gap`. */
const CAPTION_GAP_X = 12;
const monoBadgeW = (text: string) =>
  Math.round(text.length * META_SIZE * MONO_RATIO) + BADGE_PAD;
const sansBadgeW = (text: string) =>
  Math.round(text.length * META_SIZE * SANS_RATIO) + BADGE_PAD;

/** The badges that fit and the ones `+N` takes, dropped only from the tail because the declared order is meaningful. */
function fitBadges(
  files: readonly string[],
  room: number,
): { shown: string[]; hidden: string[] } {
  for (let k = files.length; k > 0; k -= 1) {
    const shown = files.slice(0, k);
    const hidden = files.length - k;
    let total = shown.reduce(
      (sum, file) => sum + CAPTION_GAP_X + monoBadgeW(badgeFor(file)),
      0,
    );
    /* The overflow badge costs its own pill and its gap. No mark beside it: see the `mark={0}` below. */
    if (hidden > 0) total += CAPTION_GAP_X + monoBadgeW(`+${hidden}`);
    if (total <= room) return { shown, hidden: files.slice(k) };
  }
  return { shown: [], hidden: [...files] };
}

/** A badge's text: the file name, or folder and file for `page.tsx` and `route.ts`, which every route shares. */
function badgeFor(file: string): string {
  const parts = file.split("/");
  const name = parts[parts.length - 1];
  if (name !== "page.tsx" && name !== "route.ts") return name;
  return parts.slice(-2).join("/");
}

export type FramePin = {
  comment: CanvasComment;
  /** Its number in the canvas-wide list, which is what the designer will say out loud. */
  n: number;
  /** Reopened with new feedback after an agent worked it (see `reopenedAfterWork`): drawn as a light marker. */
  reopened?: boolean;
};

export type NewRegionComment = {
  screenId: string;
  /** The flow or exploration the frame was drawn in, since one screen can sit in several. See `belongsOnFrame`. */
  groupId: string;
  region: CanvasRegion;
  note: string;
  /** The shot with the outline drawn on it, as a data URL. Written to a file beside the JSON. */
  image: string;
  shotHash: string;
};

/** Where an evidence screenshot is served: the shots route, which only serves files a declaration names. */
function evidenceSrc(canvas: string, file: string): string {
  return `/api/design-canvas/shots?canvas=${encodeURIComponent(canvas)}&evidence=${encodeURIComponent(file)}`;
}

/** The part of a screenshot that matters, outlined in the annotation orange. Boxes are fractions of the picture. */
function EvidenceMarks({ marks, stroke }: { marks?: CanvasEvidence["marks"]; stroke: number }) {
  if (!marks || marks.length === 0) return null;
  return (
    <>
      {marks.map((box, index) => (
        <span
          key={index}
          className="pointer-events-none absolute"
          style={{
            left: `${box.x * 100}%`,
            top: `${box.y * 100}%`,
            width: `${box.w * 100}%`,
            height: `${box.h * 100}%`,
            border: `${stroke}px solid ${ANNOTATE}`,
            borderRadius: 8,
            boxShadow: `0 0 0 ${Math.max(2, stroke / 2)}px hsl(0 0% 100% / 0.7)`,
          }}
          aria-hidden
        />
      ))}
    </>
  );
}

/**
 * One screenshot opened large. Portalled to the body, since a fixed overlay inside the transformed world would pan
 * and scale with it; it stops presses and wheels at its root because React still bubbles them to the pan surface.
 * Escape or a press outside closes it; the arrows step through the frame's other screenshots.
 */
function EvidenceLarge({
  canvas,
  items,
  at,
  onAt,
  onClose,
}: {
  canvas: string;
  items: CanvasEvidence[];
  at: number;
  onAt: (index: number) => void;
  onClose: () => void;
}) {
  const item = items[at];
  const step = useCallback(
    (by: number) => onAt((at + by + items.length) % items.length),
    [at, items.length, onAt],
  );
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      else if (event.key === "ArrowRight" && items.length > 1) step(1);
      else if (event.key === "ArrowLeft" && items.length > 1) step(-1);
      else return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [items.length, onClose, step]);
  if (typeof document === "undefined") return null;
  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();
  const round =
    "grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/[0.1] text-white transition-colors duration-[220ms] hover:bg-white/[0.2]";
  return createPortal(
    <div
      className="fixed inset-0 flex flex-col items-center justify-center gap-4 bg-[hsl(180_15%_4%_/_0.9)] p-8"
      style={{ zIndex: 2147483000 }}
      role="dialog"
      aria-modal="true"
      aria-label={`${item.name}, opened large`}
      onPointerDown={stop}
      onWheel={stop}
      onClick={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) onClose();
      }}
      data-canvas-evidence-large={item.file}
    >
      <button type="button" onClick={onClose} aria-label="Close" className={cn(round, "absolute right-6 top-6")}>
        <IconClose size={20} />
      </button>
      <div className="flex max-w-full items-center gap-4">
        {items.length > 1 ? (
          <button type="button" onClick={() => step(-1)} aria-label="Previous" className={round}>
            <IconLeft size={20} />
          </button>
        ) : null}
        <div className="relative inline-block overflow-hidden rounded-xl bg-white leading-[0]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={evidenceSrc(canvas, item.file)}
            alt={item.caption ?? item.name}
            draggable={false}
            className="block select-none"
            /* Fitted to the window, up as well as down, in exact pixels rather than object-fit so the marks stay on
               the part they outline. */
            style={(() => {
              const fit = Math.min(
                (window.innerWidth * 0.84) / item.w,
                (window.innerHeight * 0.72) / item.h,
                2.5,
              );
              return { width: Math.round(item.w * fit), height: Math.round(item.h * fit) };
            })()}
          />
          <EvidenceMarks marks={item.marks} stroke={4} />
        </div>
        {items.length > 1 ? (
          <button type="button" onClick={() => step(1)} aria-label="Next" className={round}>
            <IconRight size={20} />
          </button>
        ) : null}
      </div>
      <div className="max-w-[72ch] text-center text-white">
        <div className="text-[1.25rem] font-semibold">{item.name}</div>
        {item.source ? <div className="mt-1 text-[0.875rem] text-white/60">{item.source}</div> : null}
        {item.caption ? <div className="mt-2 text-[1rem] leading-relaxed text-white/85">{item.caption}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

export function CanvasFrame({
  canvas,
  screen,
  groupId,
  shot,
  manifestLoaded,
  scale,
  pins,
  nextNumber,
  showTitle,
  explore,
  verdict,
  onVerdict,
  commenting,
  onSave,
  onDeletePin,
  onEditPin,
  onFeedback,
  openPin,
  onOpenPin,
  onTwin,
  today,
  chromeW,
  revealed = true,
  entranceDelay = 0,
  isNew = false,
  isChanged = false,
  zoomStep = 1,
}: {
  /** Which canvas this frame belongs to; sent with every picture request so the route never guesses between canvases. */
  canvas: string;
  /** The same screen on the other device, shown by moving the canvas. Absent draws no control. */
  onTwin?: { device: CanvasDevice; go: () => void } | null;
  /** Exploration only: the screen this option redesigns and its shot, shown in place. Absent draws no switch. */
  today?: { screen: CanvasScreen; shot: CanvasShot | null };
  /** Caption and foot width in world units, wider than a phone picture (`chromeWidth` in graph-layout.ts). */
  chromeW?: number;
  /** Whether the world has been placed; the frame is invisible until then. Defaults to true outside a surface. */
  revealed?: boolean;
  /** Milliseconds this frame waits before arriving, so a flow composes itself in its own order. */
  entranceDelay?: number;
  /** A screen the reviewer has not seen before: its edge turns blue. */
  isNew?: boolean;
  /** The reviewer had seen this frame and its picture changed since: the changed-screens queue. */
  isChanged?: boolean;
  /** The canvas zoom rounded up to a power of two (`zoomStep` in picture-size.ts): picks the full picture or its small copy. */
  zoomStep?: number;
  screen: CanvasScreen;
  /** What was captured for this screen, or null when it has never been captured. */
  shot: CanvasShot | null;
  /** Whether the manifest has arrived: until then every frame is a skeleton, never "Not captured yet". */
  manifestLoaded: boolean;
  /** How much of real size the picture is drawn at on the canvas. */
  scale: number;
  /** The group this frame is drawn in, so its pins and its new comments are its own. */
  groupId: string;
  pins: FramePin[];
  /** The number the next comment anywhere on the canvas will carry, burned into its picture. */
  nextNumber: number;
  /** Name the frame above it: on when grouped, off in a flow, where the arrows explain the screens. */
  showTitle: boolean;
  /**
   * Present only on the Exploration tab, with the frame's place there: its 1-based option number, whether it is
   * today's design (the reference, named "Today:"), and whether it hangs under another frame as a suggestion. The
   * screen's own remarks (`evidence`, `sticky`, `marks`) are drawn only there too.
   */
  explore?: { option?: number; incumbent?: boolean; suggestion?: boolean };
  /** This option's standing, or null. Only meaningful with `onVerdict`. */
  verdict?: "like" | "dislike" | null;
  /** Present only in an exploration: without it the two buttons are not drawn at all. */
  onVerdict?: (value: "like" | "dislike" | null) => void;
  /** Comment mode is on: a drag on this frame draws an outline instead of panning the canvas. */
  commenting: boolean;
  onSave: (comment: NewRegionComment) => Promise<void>;
  /** `stay` keeps the view where it is; without it, approving a comment moves on to the next one. */
  onDeletePin: (id: string, stay?: boolean) => void;
  /** Rewrite a comment's words in place, from its own pin. Region and picture untouched. */
  onEditPin: (id: string, note: string) => Promise<void>;
  /** Another round on an answered comment: new words and a picture cut from the current shot; reopens the comment. */
  onFeedback: (id: string, note: string, image: string, shotHash: string) => Promise<void>;
  /** Owned by the canvas, so the review queue can open a pin from outside. */
  openPin: string | null;
  onOpenPin: (id: string | null) => void;
}) {
  const optionNumber = explore?.option;
  const incumbent = Boolean(explore?.incumbent);
  /** Hung under another frame: draws none of the chrome under a frame. A reference hangs too, without the yellow. */
  const hung = Boolean(explore?.suggestion);
  const suggestion = hung && !screen.reference;
  const evidence = explore && !incumbent ? screen.evidence : undefined;
  const { sticky, marks, stickyOn } = explore ? screen : ({} as Partial<CanvasScreen>);
  const imageRef = useRef<HTMLImageElement | null>(null);
  /** Whether the picture has arrived. The effect on `src` reads `complete`, since a cached image may never fire `onLoad`. */
  const [loaded, setLoaded] = useState(false);
  const [drag, setDrag] = useState<{
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  } | null>(null);
  const [draft, setDraft] = useState<CanvasRegion | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  /** An open pin's words being rewritten (`edit`) or answered with another round (`feedback`), and the words so far. */
  const [pinDraft, setPinDraft] = useState<{ id: string; note: string; mode: "edit" | "feedback" } | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const draftBoxRef = useRef<HTMLDivElement | null>(null);
  /** Whether the open note box (an open pin, or a new note) hangs above its region: see `useLayoutEffect` below `boxAnchor`. */
  const [boxAbove, setBoxAbove] = useState(false);

  const w = Math.round((shot?.w ?? 1440) * scale);
  const h = Math.round((shot?.h ?? 900) * scale);
  /* A declared-animated screen records `stable: false` by design; only a real failure gets the red pill. */
  const failed =
    (shot?.claims ?? []).some((claim) => !claim.met) ||
    (shot?.stable === false && !screen.animated);
  const missing = (shot?.claims ?? [])
    .filter((claim) => !claim.met)
    .map((claim) => claim.claim);
  /** The caption row's budget: the frame's width less the Open button and any failure pill, which are never dropped. */
  const { shown: shownSource, hidden: hiddenSource } = fitBadges(
    screen.source ?? [],
    w -
      BUTTON_W -
      (failed ? CAPTION_GAP_X + sansBadgeW("not what it claims") : 0),
  );

  /** Percentages of the frame, so a comment means the same at any zoom and after any recapture. */
  const asRegion = (box: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  }): CanvasRegion => ({
    xPct: (Math.min(box.x1, box.x2) / w) * 100,
    yPct: (Math.min(box.y1, box.y2) / h) * 100,
    wPct: (Math.abs(box.x2 - box.x1) / w) * 100,
    hPct: (Math.abs(box.y2 - box.y1) / h) * 100,
  });

  /* Measured from the box, whose size already includes both the frame's `scale` and the canvas zoom. */
  const pointIn = (event: React.PointerEvent) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * w,
      y: ((event.clientY - rect.top) / rect.height) * h,
    };
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!commenting || event.button !== 0) return;
    event.stopPropagation();
    /* Drawing a rectangle must not also select text. */
    event.preventDefault();
    const at = pointIn(event);
    setDraft(null);
    setDrag({ x1: at.x, y1: at.y, x2: at.x, y2: at.y });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const at = pointIn(event);
    setDrag({ ...drag, x2: at.x, y2: at.y });
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const box = drag;
    setDrag(null);
    if (
      Math.abs(box.x2 - box.x1) < MIN_REGION ||
      Math.abs(box.y2 - box.y1) < MIN_REGION
    )
      return;
    event.stopPropagation();
    setDraft(asRegion(box));
    setNote("");
  };

  /**
   * The handoff picture: the full shot with the outline and number burned in. The pictures are served same-origin
   * so the canvas is not tainted and `toDataURL` works.
   */
  const annotate = useCallback(
    async (region: CanvasRegion, n: number): Promise<string | null> => {
      let image = imageRef.current;
      if (!image || !shot) return null;
      /* The annotated picture is always cut from the full capture, whichever copy the frame is drawing. */
      if (image.src.endsWith("&size=small")) {
        const full = new Image();
        full.src = image.src.slice(0, -"&size=small".length);
        try {
          await full.decode();
          image = full;
        } catch {
          /* Drawn from the copy on screen rather than not at all. */
        }
      }
      const canvas = document.createElement("canvas");
      canvas.width = shot.w;
      canvas.height = shot.h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(image, 0, 0, shot.w, shot.h);
      const x = (region.xPct / 100) * shot.w;
      const y = (region.yPct / 100) * shot.h;
      const rw = (region.wPct / 100) * shot.w;
      const rh = (region.hPct / 100) * shot.h;
      /* Red, so the outline is findable on any design. */
      ctx.lineWidth = 4;
      ctx.strokeStyle = "#e11d48";
      ctx.strokeRect(x, y, rw, rh);
      const label = String(n);
      ctx.font = "bold 22px system-ui, sans-serif";
      const pad = 8;
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = "#e11d48";
      ctx.fillRect(x, Math.max(0, y - 30), tw + pad * 2, 30);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(label, x + pad, Math.max(22, y - 8));
      return canvas.toDataURL("image/png");
    },
    [shot],
  );

  const save = async () => {
    if (!draft || !shot || note.trim().length === 0) return;
    const image = await annotate(draft, nextNumber);
    if (!image) return;
    setSaving(true);
    try {
      await onSave({
        screenId: screen.id,
        groupId,
        region: draft,
        note: note.trim(),
        image,
        shotHash: shot.hash,
      });
      setDraft(null);
      setNote("");
    } finally {
      setSaving(false);
    }
  };

  /**
   * A comment is the reviewer's to close once the agent has read it and the screen was recaptured or the agent
   * answered under the pin. Before that it is still an instruction: Edit and Delete.
   */
  const reviewable = (comment: CanvasComment) =>
    Boolean(comment.consumedAt) &&
    (comment.stale === true || Boolean(comment.answer));

  /** Another round on a comment already answered: new words, new picture, back into the agent's queue. */
  const sendFeedback = async (draft: { id: string; note: string }) => {
    if (!shot) return;
    const pin = pins.find((one) => one.comment.id === draft.id);
    if (!pin) return;
    const image = await annotate(pin.comment.region, pin.n);
    if (!image) return;
    setSaving(true);
    try {
      await onFeedback(draft.id, draft.note.trim(), image, shot.hash);
      setPinDraft(null);
    } finally {
      setSaving(false);
    }
  };

  /** Send the pin draft: another round of feedback, or the rewritten words (nothing else about the comment changes). */
  const sendPinDraft = async () => {
    if (!pinDraft || pinDraft.note.trim().length === 0) return;
    if (pinDraft.mode === "feedback") return sendFeedback(pinDraft);
    setPinDraft(null);
    await onEditPin(pinDraft.id, pinDraft.note.trim());
  };

  /**
   * A press outside closes an open pin. Capture phase, so it runs before the pan handler; the pin buttons are
   * excluded, or opening one would close it again.
   */
  useEffect(() => {
    /* Only the frame that renders the open pin listens; every other frame's `popRef` is null and would close it. */
    if (!openPin || !pins.some((pin) => pin.comment.id === openPin)) return;
    const closeIfOutside = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (popRef.current?.contains(target ?? null)) return;
      if (target instanceof Element && target.closest("[data-canvas-pin]"))
        return;
      onOpenPin(null);
    };
    document.addEventListener("pointerdown", closeIfOutside, true);
    return () =>
      document.removeEventListener("pointerdown", closeIfOutside, true);
  }, [openPin, onOpenPin, pins]);

  /** The switch to today: while flipped, everything below reads `pictured` rather than `shot`. */
  const [showingToday, setShowingToday] = useState(false);
  /** Which evidence tile is open large, or null. See `EvidenceLarge`. */
  const [openEvidence, setOpenEvidence] = useState<number | null>(null);
  const flipped = showingToday && today ? today : null;
  const pictured = flipped ? flipped.shot : shot;
  const picturedId = flipped ? flipped.screen.id : screen.id;
  const fullSrc = useMemo(
    () =>
      pictured
        ? `/api/design-canvas/shots?canvas=${encodeURIComponent(canvas)}&id=${encodeURIComponent(picturedId)}&v=${pictured.hash}`
        : null,
    [canvas, pictured, picturedId],
  );
  /**
   * The small copy while the frame is small on screen, used only when it has at least as many pixels as the frame
   * shows, so it looks the same and a zoomed-out canvas skips decoding full captures.
   */
  const small = drawsSmall(
    pictured?.small,
    w,
    zoomStep,
    typeof window === "undefined" ? 1 : window.devicePixelRatio || 1,
  );
  const src = fullSrc && small ? `${fullSrc}&size=small` : fullSrc;
  /**
   * The last arrived picture of this same shot stays under the new one while it loads, so switching between the
   * small copy and the full capture never shows the skeleton. A different shot has a different key.
   */
  const pictureKey = pictured ? `${picturedId}:${pictured.hash}` : null;
  const [arrived, setArrived] = useState<{ key: string; src: string } | null>(null);
  const backdrop =
    arrived && arrived.key === pictureKey && arrived.src !== src ? arrived.src : null;

  /* After `src`, because it is what this watches: a new picture for the same frame goes back to the skeleton. */
  useEffect(() => {
    const image = imageRef.current;
    const done = image?.complete === true && image.naturalWidth > 0;
    setLoaded(image?.complete === true);
    if (done && src && pictureKey) setArrived({ key: pictureKey, src });
  }, [src, pictureKey]);

  const dragBox = drag ? asRegion(drag) : null;

  /* The drop below the region's top is capped at 420 frame pixels, so on a tall frame the box stays near the drag. */
  const dropPct = (region: CanvasRegion) => Math.min(region.hPct, h > 0 ? (420 / h) * 100 : 100);

  /**
   * Where a note box hangs: the region's left edge, or its right edge past the middle, so it stays by its region. Below
   * the region, or above it when `above` (its buttons would otherwise sit under the window's edge or the review row).
   */
  const boxAnchor = (region: CanvasRegion, above = false) => {
    const flip = region.xPct + region.wPct / 2 > 55;
    return {
      ...(flip
        ? { right: `${100 - (region.xPct + region.wPct)}%` }
        : { left: `${region.xPct}%` }),
      ...(above
        ? { bottom: `${100 - region.yPct}%`, marginBottom: 12 }
        : { top: `${region.yPct + dropPct(region)}%`, marginTop: 12 }),
      width: NOTE_BOX_W,
      borderRadius: NOTE_BOX_RADIUS,
      boxShadow: NOTE_BOX_SHADOW,
      /* Screen-constant, growing away from the corner it hangs from rather than across the frame. */
      transform: "scale(var(--canvas-inv-zoom, 1))",
      transformOrigin: `${above ? "bottom" : "top"} ${flip ? "right" : "left"}`,
      padding: 14,
    };
  };

  /**
   * BELOW OR ABOVE, by the tooltip's rule (`hangsBelow`), measured when a box opens or changes what it holds: below when its
   * buttons clear the window's bottom edge and the review row, else above the region. The review row sits over the canvas,
   * so a box under it would show buttons nobody can press.
   */
  const openRegion = draft ?? pins.find((one) => one.comment.id === openPin)?.comment.region ?? null;
  useLayoutEffect(() => {
    const box = draft ? draftBoxRef.current : popRef.current;
    const layer = box?.offsetParent;
    if (!box || !layer || !openRegion) {
      setBoxAbove(false);
      return;
    }
    const area = layer.getBoundingClientRect();
    const row = document.querySelector("[data-canvas-review-row]")?.getBoundingClientRect();
    const bottom = Math.min(window.innerHeight, row && row.height > 0 ? row.top : Infinity) - 12;
    const anchorBottom = area.top + ((openRegion.yPct + dropPct(openRegion)) / 100) * area.height;
    setBoxAbove(!hangsBelow({ anchorBottom, height: box.getBoundingClientRect().height, gap: 12, bottom }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openPin, draft, pinDraft?.id, pinDraft?.mode]);

  return (
    <figure
      className="relative m-0"
      style={{
        width: w,
        height: h,
        /**
         * The entrance, the only motion here: opacity alone, since a transform on dozens of panned elements
         * stutters. `entranceDelay` follows the diagram's reading order, so the canvas composes left to right.
         */
        opacity: revealed ? 1 : 0,
        transition: `opacity 260ms cubic-bezier(0.16, 1, 0.3, 1) ${revealed ? entranceDelay : 0}ms`,
      }}
      data-canvas-screen={screen.id}
      data-canvas-incumbent={incumbent ? "true" : undefined}
      data-canvas-showing={flipped ? "today" : undefined}
    >
      {/* Above the frame: its title when the screens are grouped. A flow has none; its arrows explain the screens. */}
      {showTitle ? (
        <figcaption
          /* `left-0` and a width rather than `inset-x-0`: a phone frame's chrome is wider than its picture. */
          className="absolute bottom-full left-0 flex items-center text-white"
          style={{
            marginBottom: CAPTION_GAP,
            gap: 12,
            width: chromeW ?? "100%",
          }}
          title={screen.note}
        >
          {/* An exploration option's number is plain text before its name, since options are referred to by number. */}
          <span
            className="min-w-0 flex-1 truncate font-semibold tracking-[-0.015em]"
            style={{ fontSize: NAME_SIZE, lineHeight: 1.15 }}
          >
            {/* The incumbent says what it is the same way the options say their number: as plain text. */}
            {flipped || incumbent
              ? "Today: "
              : suggestion
                ? "Suggestion: "
                : optionNumber
                  ? `${optionNumber}. `
                  : ""}
            {flipped ? flipped.screen.label : screen.label}
          </span>

          {/**
           * Like and dislike, as icons. A verdict says whether an option survives, apart from the comments on what
           * is wrong with it. Pressing the one already given clears it.
           */}
          {onVerdict ? (
            <span className="flex shrink-0 items-center" style={{ gap: 4 }}>
              {(["like", "dislike"] as const).map((value) => {
                const on = verdict === value;
                const Glyph = value === "like" ? IconLike : IconDislike;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => onVerdict(on ? null : value)}
                    /* Without this the pan surface captures the pointer on pointerdown and the click never fires. */
                    onPointerDown={(event) => event.stopPropagation()}
                    aria-pressed={on}
                    aria-label={value === "like" ? "Like" : "Dislike"}
                    title={value === "like" ? "Like" : "Dislike"}
                    data-canvas-verdict={value}
                    className={cn(
                      "inline-flex shrink-0 items-center justify-center rounded-full transition-colors duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
                      /**
                       * At rest no circle, just the glyph in its own color; on hover the circle appears; once given it
                       * stays solid. The alpha goes inside `hsl()`: Tailwind drops a slash opacity on an arbitrary value.
                       */
                      value === "like" &&
                        (on
                          ? "bg-[hsl(152_58%_42%)] text-white hover:bg-[hsl(152_58%_33%)]"
                          : "text-[hsl(152_58%_72%)] hover:bg-[hsl(152_58%_45%_/_0.28)] hover:text-[hsl(152_58%_82%)]"),
                      value === "dislike" &&
                        (on
                          ? "bg-[hsl(0_84.2%_58%)] text-white hover:bg-[hsl(0_84.2%_47%)]"
                          : "text-[hsl(0_84.2%_80%)] hover:bg-[hsl(0_84.2%_60.2%_/_0.28)] hover:text-[hsl(0_84.2%_88%)]"),
                    )}
                    style={{ width: NAME_SIZE * 1.7, height: NAME_SIZE * 1.7 }}
                  >
                    <Glyph size={Math.round(NAME_SIZE)} />
                  </button>
                );
              })}
            </span>
          ) : null}
        </figcaption>
      ) : null}

      {/**
       * Below the frame: a fixed-size Open button, the same target in the same place on every frame, and badges
       * naming the files the screen is built from, with the full path on hover.
       */}
      <figcaption
        className="absolute left-0 top-full flex items-center"
        style={{ marginTop: FOOT_GAP, gap: 12, width: chromeW ?? "100%" }}
        data-canvas-chrome=""
      >
        {/* The switch to today's screen: outlined while the option shows, solid while today does. */}
        {/* A suggestion carries none of this row: the design it departs from is the frame right above it. */}
        {today && !hung ? (
          <CanvasTooltip
            mark={0}
            compact
            label={
              <button
                type="button"
                onClick={() => setShowingToday((on) => !on)}
                aria-pressed={Boolean(flipped)}
                className={cn(ROUND, flipped ? "bg-white text-[hsl(180_15%_5.5%)] hover:bg-white/85" : OUTLINED)}
                style={ROUND_SIZE}
                data-canvas-today={today.screen.id}
              >
                <IconToday size={META_SIZE + 2} />
              </button>
            }
          >
            {/* Short and generic, no full stop: the copy rule for a hint on an icon. */}
            {flipped ? "Show the redesign" : "Show today's version"}
          </CanvasTooltip>
        ) : null}

        {/* No Open on a wireframe: there is no running page behind it. The pill beside the badges says what it is. */}
        {/* A still may name where its state runs (`opens`): then Open goes there, as on a live frame. */}
        {screen.wireframe && !screen.opens ? null : (
          <a
            href={openAddress(screen, shot?.url)}
            target="_blank"
            rel="noreferrer"
            /* Solid white: the way from a picture back to the running page, the first thing to find under a frame. */
            className="inline-flex shrink-0 items-center justify-center rounded-full bg-white font-medium text-[hsl(180_15%_5.5%)] transition-colors duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-white/85"
            style={{
              fontSize: META_SIZE,
              lineHeight: 1,
              height: BUTTON_H,
              width: BUTTON_W,
              gap: 8,
            }}
            /* Where it goes and what the reviewer would not otherwise know, such as the presses that reach the state.
               One pure function (`openHint`), so the words are held by a test. */
            title={openHint(screen, shot?.url)}
            data-canvas-open=""
          >
            Open
            <IconOpenExternal size={META_SIZE + 1} />
          </a>
        )}

        {/* The same screen on the other device: an outlined icon beside Open that moves the canvas, only when declared. */}
        {onTwin ? (
          /* The canvas tooltip names the device, since the icon has no word; `mark={0}` as the button is visibly pressable. */
          <CanvasTooltip
            mark={0}
            title={onTwin.device === "phone" ? "Show on mobile" : "Show on desktop"}
            label={
              <button
                type="button"
                onClick={onTwin.go}
                className={cn(ROUND, OUTLINED)}
                style={ROUND_SIZE}
                data-canvas-twin={onTwin.device}
              >
                {onTwin.device === "phone" ? (
                  /* A touch bigger than the monitor, for the same reason as in the toolbar. */
                  <IconPhone size={META_SIZE + 4} />
                ) : (
                  <IconDesktop size={META_SIZE + 2} />
                )}
              </button>
            }
          >
            {/* No "photographed": "at a phone's size" already does that work. */}
            {onTwin.device === "phone"
              ? "The same screen at a phone's size. The canvas switches device and lands on it."
              : "The same screen at a desktop's size. The canvas switches device and lands on it."}
          </CanvasTooltip>
        ) : null}

        {failed ? (
          <span
            className="shrink-0 rounded-full bg-[hsl(0_84.2%_60.2%)] font-medium text-[hsl(210_40%_98%)]"
            style={PILL}
            title={
              missing.length > 0
                ? `Captured a page without ${missing.map((claim) => `"${claim}"`).join(", ")}`
                : "Two captures of this page came out different, so it was still moving"
            }
          >
            not what it claims
          </span>
        ) : null}
        {screen.wireframe && !flipped && !hung ? (
          <span
            className="shrink-0 rounded-full bg-white/[0.09] font-medium text-white/60"
            style={PILL}
            title={
              screen.still
                ? screen.opens
                  ? "A screenshot of the real app, driven into this state by hand; Open goes to where it runs"
                  : "A screenshot of the real app, driven into this state by hand: no URL lands here, so nothing to open"
                : "A lo-fi wireframe served outside the app: nothing to open, no component behind it yet"
            }
            data-canvas-wireframe={screen.still ? "still" : ""}
          >
            {screen.still ? "Still" : "Wireframe"}
          </span>
        ) : null}
        {flipped || hung
          ? null
          : shownSource.map((file) => (
          <span
            key={file}
            className={BADGE}
            style={PILL}
            title={file}
          >
            {badgeFor(file)}
          </span>
        ))}
        {!flipped && !hung && hiddenSource.length > 0 ? (
          <CanvasTooltip
            title="Also built from"
            /* No mark: the badge is already visibly a stand-in for what it is not showing. */
            mark={0}
            className="shrink-0 text-white/60"
            label={
              <span className={BADGE} style={PILL}>
                {`+${hiddenSource.length}`}
              </span>
            }
          >
            {hiddenSource.map((file) => (
              <span key={file} className="block font-mono">
                {file}
              </span>
            ))}
          </CanvasTooltip>
        ) : null}
      </figcaption>

      {/* Only the picture gets paint containment: `content-visibility` clips, so the comment layer lives outside it. */}
      <div
        /* White behind today's picture: it is drawn to fit the option's frame, and the band it does not fill
           reads as paper rather than as a hole in the canvas. */
        className={cn("relative h-full w-full", flipped ? "bg-white" : "bg-white/[0.04]")}
        /* The changed edge reads the zoom, so it keeps its width while the canvas zooms. */
        data-canvas-zoom-vars={isChanged ? "" : undefined}
        style={{
          /* A failed claim outranks everything; a suggestion wears a yellow edge all round. */
          boxShadow: failed
            ? `0 0 0 ${RING}px ${RED}, 0 ${RING * 8}px ${RING * 22}px hsl(0 0% 0% / 0.55)`
            : suggestion
              ? `0 0 0 ${RING * 4}px ${SUGGESTION_EDGE}, ${FRAME_EDGE}`
              : isNew
                ? NEW_EDGE
                : isChanged
                  ? CHANGED_EDGE
                  : FRAME_EDGE,
          contentVisibility: "auto",
          containIntrinsicSize: `${w}px ${h}px`,
        }}
      >
        {/* A picture, or the skeleton standing in for one that is still on its way — see `manifestLoaded`. */}
        {src || !manifestLoaded ? (
          <>
            {/**
             * The skeleton: plain fills and an opacity pulse, no shimmer, since a moving gradient repaints on every
             * frame while panning. Offscreen frames never build it, thanks to `content-visibility: auto` above.
             */}
            {loaded || backdrop ? null : (
              <div
                className="absolute inset-0 animate-pulse motion-reduce:animate-none"
                aria-hidden
              >
                <div className="h-full w-full bg-white/[0.05]" />
                <div className="absolute left-0 right-0 top-0 h-[9%] bg-white/[0.05]" />
                <div className="absolute left-[6%] top-[16%] h-[4%] w-[38%] rounded-full bg-white/[0.06]" />
              </div>
            )}
            {/* A plain <img>, not next/image: it must stay same-origin and untainted so the annotated PNG can be drawn
               from it. No <img> without a source, which would request the page's own URL. */}
            {backdrop ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={backdrop}
                alt=""
                aria-hidden
                draggable={false}
                className={cn(
                  "absolute inset-0 h-full w-full select-none",
                  flipped ? "object-contain object-left-top" : "",
                )}
              />
            ) : null}
            {src ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              ref={imageRef}
              /* The frame's own picture, told apart from the evidence screenshots beside it by the oracle. */
              data-canvas-shot=""
              src={src}
              alt={flipped ? flipped.screen.label : screen.label}
              width={pictured?.w}
              height={pictured?.h}
              loading="lazy"
              decoding="async"
              draggable={false}
              onLoad={() => {
                setLoaded(true);
                if (src && pictureKey) setArrived({ key: pictureKey, src });
              }}
              /* Fades in over the skeleton, opacity only, with the canvas's one duration (`canvas-motion.tsx`). */
              style={MOTION_STYLE}
              className={cn(
                "relative h-full w-full select-none transition-opacity motion-reduce:transition-none",
                /* Today's shot keeps its own proportions inside the option's frame, pinned to the top left. */
                flipped ? "object-contain object-left-top" : "",
                loaded ? "opacity-100" : "opacity-0",
              )}
            />
            ) : null}
          </>
        ) : (
          <div className="grid h-full w-full place-items-center">
            <span className="text-white/40" style={{ fontSize: NOTE_SIZE }}>
              Not captured yet
            </span>
          </div>
        )}
        {/* A suggestion's yellow tint, multiplied so white turns yellow and lines stay black; drawn by the canvas so
            every suggestion looks the same, whatever drew it. */}
        {suggestion && !flipped ? (
          <div
            className="pointer-events-none absolute inset-0"
            style={{ background: SUGGESTION_TINT, mixBlendMode: "multiply" }}
            aria-hidden
          />
        ) : null}
      </div>

      {/* Remarks over the design: highlights and the sticky note with its line. Never on today's picture, and
          pointer events pass through so a comment can still be drawn anywhere. */}
      {!flipped && (sticky || (marks && marks.length)) ? (
        <div className="pointer-events-none absolute inset-0" aria-hidden>
          {(marks ?? []).map((mark, index) => (
            <div
              key={index}
              className="absolute"
              style={{
                left: `${mark.x * 100}%`,
                top: `${mark.y * 100}%`,
                width: `${mark.w * 100}%`,
                height: `${mark.h * 100}%`,
                border: `7px solid ${ANNOTATE}`,
                borderRadius: 14,
              }}
            >
              {mark.label ? (
                <span
                  className="absolute whitespace-nowrap font-semibold"
                  style={{
                    left: -7,
                    bottom: "100%",
                    marginBottom: 2,
                    background: ANNOTATE,
                    color: "#ffffff",
                    fontSize: 22,
                    lineHeight: 1.15,
                    padding: "4px 12px",
                    borderRadius: 8,
                  }}
                >
                  {mark.label}
                </span>
              ) : null}
            </div>
          ))}
          {/* The line from the note to the thing it is about: from the note's left edge to the highlight's right
              side, mid height, with a dot where it lands, drawn in the frame's own units so it scales with it. */}
          {sticky && marks && stickyOn !== undefined && marks[stickyOn] ? (() => {
            const target = marks[stickyOn];
            const sx = w + REMARK_OFFSET;
            const sy = STICKY_TOP + 64;
            const endX = (target.x + target.w) * w;
            const ty = (target.y + target.h / 2) * h;
            const d = `M${sx},${sy} C${sx - 120},${sy} ${endX + 140},${ty} ${endX},${ty}`;
            return (
              <svg
                className="absolute left-0 top-0 overflow-visible"
                width={w}
                height={h}
                style={{ zIndex: 2 }}
              >
                <path d={d} stroke={ANNOTATE} strokeWidth={7} fill="none" strokeLinecap="round" />
                <circle cx={endX} cy={ty} r={14} fill={ANNOTATE} />
              </svg>
            );
          })() : null}
          {sticky ? (
            <div
              className="absolute font-medium"
              style={{
                top: STICKY_TOP,
                left: w + REMARK_OFFSET,
                width: STICKY_W,
                background: STICKY_PAPER,
                color: "#1c1a0a",
                fontSize: STICKY_FONT,
                lineHeight: `${STICKY_LINE}px`,
                padding: "26px 28px 30px",
                /* Balanced lines: a note never ends on one word alone, as with any wrapping copy. */
                textWrap: "balance",
                transform: "rotate(1.6deg)",
                boxShadow: "0 18px 40px hsl(0 0% 0% / 0.45)",
                zIndex: 3,
              }}
            >
              {sticky}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Evidence beside the frame: other systems' screens, laid out by `remarkTiles`; a press opens one large. */}
      {!flipped && evidence && evidence.length ? (
        <div className="absolute left-0 top-0" style={{ width: 0, height: 0 }}>
          {remarkTiles({ sticky, evidence }, w, h).map((tile, index) => (
            <div
              key={`${tile.evidence.file}-${index}`}
              className="absolute"
              style={{ left: tile.x, top: tile.y - TILE_LABEL, width: tile.w }}
            >
              <div
                className="truncate font-semibold text-white"
                style={{ fontSize: 28, lineHeight: `${TILE_LABEL - 8}px`, height: TILE_LABEL }}
              >
                {tile.evidence.name}
              </div>
              <button
                type="button"
                /* The pan surface would take the press and eat the click; see the verdict buttons. */
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => setOpenEvidence(index)}
                aria-label={`Open ${tile.evidence.name} large`}
                title={tile.evidence.source ?? tile.evidence.name}
                data-canvas-evidence={tile.evidence.file}
                className="group relative block cursor-zoom-in overflow-hidden bg-white p-0"
                style={{
                  width: tile.w,
                  height: tile.h,
                  borderRadius: 10,
                  boxShadow: "0 0 0 3px hsl(0 0% 100% / 0.22), 0 14px 36px hsl(0 0% 0% / 0.5)",
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={evidenceSrc(canvas, tile.evidence.file)}
                  alt={tile.evidence.caption ?? tile.evidence.name}
                  width={tile.evidence.w}
                  height={tile.evidence.h}
                  loading="lazy"
                  decoding="async"
                  draggable={false}
                  className="block h-full w-full select-none object-cover object-left-top"
                />
                <EvidenceMarks marks={tile.evidence.marks} stroke={5} />
                <span
                  className="absolute grid place-items-center rounded-full bg-[hsl(180_15%_5.5%)] text-white opacity-80 transition-opacity duration-[220ms] group-hover:opacity-100"
                  style={{ right: 12, bottom: 12, width: 48, height: 48 }}
                  aria-hidden
                >
                  <IconExpand size={24} />
                </span>
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {openEvidence !== null && evidence && evidence[openEvidence] ? (
        <EvidenceLarge
          canvas={canvas}
          items={evidence}
          at={openEvidence}
          onAt={setOpenEvidence}
          onClose={() => setOpenEvidence(null)}
        />
      ) : null}

      {/* The annotation layer: outlines, pins and the note box, over the picture and outside its containment. */}
      <div
        className={cn(
          "absolute inset-0",
          /* No comments on today's picture: a note drawn here would be filed on the option. */
          commenting && !flipped ? "cursor-crosshair" : "pointer-events-none",
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {/* Saved comments: the region, and a marker that opens it. Hidden while the frame shows today. */}
        {flipped
          ? null
          : pins.map(({ comment, n, reopened }) => (
          <div key={comment.id}>
            <Outline region={comment.region} />
            <button
              type="button"
              className={cn(
                "pointer-events-auto absolute grid place-items-center rounded-full font-semibold transition-transform duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)] hover:scale-105",
                /* Light red with a dark red number: reopened with new feedback after the work, not yet worked again. */
                reopened
                  ? "bg-[hsl(0_84.2%_88%)] text-[hsl(0_84.2%_32%)]"
                  : "bg-[hsl(0_84.2%_60.2%)] text-[hsl(210_40%_98%)]",
              )}
              style={{
                left: `${comment.region.xPct}%`,
                top: `${comment.region.yPct}%`,
                width: PIN_SIZE,
                height: PIN_SIZE,
                marginLeft: -PIN_SIZE / 3,
                marginTop: -PIN_SIZE / 3,
                fontSize: CHIP_SIZE,
                boxShadow: PIN_SHADOW,
              }}
              data-canvas-chrome=""
              data-canvas-pin={comment.id}
              data-canvas-pin-reopened={reopened ? "" : undefined}
              title={comment.note}
              /* Clickable in either mode: otherwise the press reaches the annotation layer and starts a new outline. */
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() =>
                onOpenPin(openPin === comment.id ? null : comment.id)
              }
            >
              {n}
            </button>
            {openPin === comment.id ? (
              <div
                ref={popRef}
                className="pointer-events-auto absolute z-[50] bg-[hsl(180_15%_5.5%)] ring-1 ring-white/[0.14]"
                style={boxAnchor(comment.region, boxAbove)}
                data-canvas-chrome=""
                data-canvas-zoom-vars=""
                data-canvas-pin-open={comment.id}
                onPointerDown={(event) => event.stopPropagation()}
              >
                {/* An X, not a button in the row. Closing is not one of the decisions being offered. */}
                <button
                  type="button"
                  aria-label="Close"
                  className={NOTE_CLOSE}
                  onClick={() => onOpenPin(null)}
                >
                  <IconClose size={14} />
                </button>

                {/* The words, with room kept for the X. */}
                <p className="pr-9 text-[0.875rem] leading-snug text-white">
                  {comment.note}
                </p>

                {/* The agent's answer under the note, quieter and labeled so it never reads as the reviewer's words. */}
                {comment.answer ? (
                  <div
                    className="mt-3 border-l-2 border-white/[0.18] pl-3"
                    data-canvas-answer={comment.id}
                  >
                    <div className="text-[0.6875rem] font-medium text-white/50">
                      Answer
                    </div>
                    <p className="mt-1 pr-6 text-[0.8125rem] leading-snug text-white/85">
                      {comment.answer.text}
                    </p>
                  </div>
                ) : null}

                {/**
                 * Waiting (not read, or not recaptured since): Edit and Delete. Reviewable: Approve deletes the
                 * comment, and Dismiss asks for another round on the same rectangle, reopening it.
                 */}
                {pinDraft?.id === comment.id ? (
                  <>
                    <textarea
                      autoFocus
                      rows={3}
                      value={pinDraft.note}
                      placeholder={pinDraft.mode === "feedback" ? "What is still wrong?" : undefined}
                      className={cn(NOTE_FIELD, "mt-3")}
                      style={{ minHeight: 112 }}
                      onChange={(event) => setPinDraft({ ...pinDraft, note: event.target.value })}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void sendPinDraft();
                        if (event.key === "Escape") setPinDraft(null);
                      }}
                    />
                    <div className="mt-3 flex justify-end gap-1.5">
                      <button
                        type="button"
                        className={NOTE_GHOST}
                        onClick={() => setPinDraft(null)}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={saving || pinDraft.note.trim().length === 0}
                        className={cn(NOTE_PRIMARY, "disabled:opacity-40")}
                        onClick={() => void sendPinDraft()}
                      >
                        {pinDraft.mode === "feedback" ? "Send" : "Save"}
                      </button>
                    </div>
                  </>
                ) : reviewable(comment) ? (
                  <div className="mt-4 flex justify-end gap-1.5">
                    <button
                      type="button"
                      className={NOTE_GHOST}
                      onClick={() => setPinDraft({ id: comment.id, note: "", mode: "feedback" })}
                    >
                      Dismiss
                    </button>
                    <button
                      type="button"
                      className={NOTE_SECONDARY}
                      onClick={() => {
                        onOpenPin(null);
                        onDeletePin(comment.id, true);
                      }}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className={NOTE_PRIMARY}
                      onClick={() => {
                        onOpenPin(null);
                        onDeletePin(comment.id);
                      }}
                    >
                      Approve &amp; next
                    </button>
                  </div>
                ) : (
                  <div className="mt-4 flex justify-end gap-1.5">
                    <button
                      type="button"
                      className={NOTE_DANGER}
                      onClick={() => {
                        onOpenPin(null);
                        onDeletePin(comment.id);
                      }}
                    >
                      Delete
                    </button>
                    <button
                      type="button"
                      className={NOTE_PRIMARY}
                      onClick={() => setPinDraft({ id: comment.id, note: comment.note, mode: "edit" })}
                    >
                      Edit
                    </button>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        ))}

        {/* The outline being dragged. */}
        {dragBox ? (
          <Outline region={dragBox} fill="hsl(0 84.2% 60.2% / 0.1)" />
        ) : null}

        {/* The outline just drawn, and the note going with it. */}
        {draft ? (
          <>
            <Outline region={draft} />
            <div
              ref={draftBoxRef}
              className="pointer-events-auto absolute z-[50] bg-[hsl(180_15%_5.5%)] ring-1 ring-white/[0.14]"
              style={boxAnchor(draft, boxAbove)}
              data-canvas-chrome=""
              data-canvas-zoom-vars=""
              onPointerDown={(event) => event.stopPropagation()}
            >
              <textarea
                autoFocus
                value={note}
                rows={3}
                placeholder="What is wrong with this?"
                className={NOTE_FIELD}
                style={{ minHeight: 132 }}
                onChange={(event) => setNote(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey))
                    void save();
                  if (event.key === "Escape") setDraft(null);
                }}
              />
              <div className="mt-2.5 flex items-center justify-end">
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    className={NOTE_GHOST}
                    onClick={() => setDraft(null)}
                  >
                    Cancel
                  </button>
                  {/* The write is long enough to notice, so the button says it is saving and refuses a second press. */}
                  <button
                    type="button"
                    disabled={saving || note.trim().length === 0}
                    className={cn(NOTE_PRIMARY, "gap-1.5 disabled:opacity-40")}
                    onClick={() => void save()}
                  >
                    {saving ? (
                      <IconSpinner size={13} className="animate-spin" />
                    ) : null}
                    {saving ? "Saving" : "Save"}
                  </button>
                </div>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </figure>
  );
}
