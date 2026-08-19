"use client";

/**
 * design-canvas CORE — one screen on the canvas: the captured picture of a real route, and the comments drawn
 * on it.
 *
 * WHY A PICTURE AND NOT THE LIVE PAGE. It was the live page, in an iframe, and the fidelity was perfect.
 * The performance was not: a surface holding dozens of live Next routes cannot be panned or zoomed
 * smoothly, and interaction quality is not a nicety on a canvas — it is the whole instrument. So a frame is
 * now an image, captured by `capture.mjs`, which only presses the shutter once the page has finished
 * arriving, its animations have finished playing, and two consecutive captures have come out identical.
 * What the live version could ask a page at review time is instead PROVED at capture time and carried in
 * the manifest, so a frame still says out loud when it is not showing what its label claims.
 *
 * WHAT COMMENTING BECAME. There is no document to resolve a click against any more, so a comment is a
 * rectangle DRAWN AROUND the thing being talked about: press, drag, let go, type. What the agent then gets
 * is not a description of a region but the screenshot with that outline burned into it, beside the note —
 * which is a stronger handoff for a design remark than any selector was.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/* Relative, and nothing from the host project: the buttons and the note field are plain elements the core
   styles itself, because a frame's chrome has to look the same in every repo this is installed in. */
import { MOTION_STYLE } from "./canvas-motion";
import { cn } from "./cn";
import { CanvasTooltip } from "./canvas-tooltip";
import {
  IconClose,
  IconDislike,
  IconLike,
  IconDesktop,
  IconOpenExternal,
  IconPhone,
  IconSpinner,
} from "./icons";
import type {
  CanvasComment,
  CanvasDevice,
  CanvasRegion,
  CanvasScreen,
  CanvasShot,
} from "./types";

/** Smaller than this, in frame pixels, and it was a click rather than an outline. */
const MIN_REGION = 12;

/**
 * THE TYPE SCALE, IN WORLD PIXELS, and both halves of that matter.
 *
 * World pixels: a label belongs to the canvas exactly the way a frame does — zoom in and it gets bigger, zoom
 * out and it gets smaller, and it never moves. An earlier version scaled labels against the zoom to keep them
 * a constant size on screen, which read as the canvas rearranging itself while you used it.
 *
 * A scale, not a set of guesses. Three steps, each far enough from the next to be told apart at a glance
 * without reading: the frame's NAME, then what it is FOR, then the developer's line. The group's own title is
 * a fourth step above all of these and lives in canvas-view.tsx. When two levels end up the same size the
 * canvas stops having a hierarchy at all, which is exactly what happened when the name was 54 against a group
 * title of 88.
 */
const NAME_SIZE = 42;
const NOTE_SIZE = 28;
const META_SIZE = 23;
const CHIP_SIZE = 23;
/** The open button under a frame: fixed, so it is the same target in the same place on every frame. */
const BUTTON_W = 116;
const BUTTON_H = 52;
/** A comment pin, in world pixels, so it sits on the design the way a sticker would. */
const PIN_SIZE = 44;

/** Space between the caption and the frame, between the caption's own lines, and under the frame. */
const CAPTION_GAP = 26;
const LINE_GAP = 12;
const FOOT_GAP = 20;

/**
 * The frame's edge, as a shadow rather than a border.
 *
 * A 1px border on an element the canvas is scaling lands on fractional pixels, and the browser rounds the
 * border and the picture inside it differently — which is the seam that showed up along the edges. A shadow
 * is painted outside the box and has nothing to line up with, so it cannot produce that artifact.
 *
 * TWO RINGS, because a screenshot can be light or dark and both have to separate from the stage: the light
 * hairline holds the edge of a dark screen, and the wide soft shadow underneath holds the edge of a light one
 * by darkening the stage around it.
 */
const RING = 3;
/** The annotation language: a rounded outline and a marker, red because a note has to be findable on any
 *  design. Nothing else on the canvas is red — a red control read as an error. */
const REGION_RADIUS = 14;
/* The literal red, not the host project's `--destructive`: an annotation has to be findable on any design,
   and a project whose danger colour is orange would quietly turn the whole annotation language orange. */
const RED = "hsl(0 84.2% 60.2%)";
const RED_TINT = "hsl(0 84.2% 60.2% / 0.22)";
const SAVED_REGION = `0 0 0 5px ${RED}, 0 0 0 9px ${RED_TINT}`;
/* THE OUTLINE IS ALWAYS RED. It used to go white once its screen had been recaptured, which meant that after
   a round of fixes every box on the canvas was white and the annotation language quietly disappeared:
   "comments' outline that I draw used to be red (like the comment pill), but now it looks like it's white..
   why? keep it red all the time." Whether a comment has been answered is said by the buttons in its pin, not
   by taking the mark off the thing being marked. */
const PIN_SHADOW = `0 8px 24px hsl(0 0% 0% / 0.45)`;
/**
 * The buttons in a note box. Screen-sized, like the box they sit in.
 *
 * A step up from `0.625rem` / `h-7` once, with the box and the field: "the comment menu itself that
 * appears could be slightly scaled up just a bit." The box is the one piece of this tool a reviewer types
 * into, and it was drawn at the size of a caption.
 */
const NOTE_GHOST =
  "h-9 rounded-full px-4 text-[0.75rem] font-medium text-white/70 transition-colors duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-white/[0.08] hover:text-white";
const NOTE_PRIMARY =
  "inline-flex h-9 items-center justify-center rounded-full bg-white px-4 text-[0.75rem] font-medium text-[hsl(180_15%_5.5%)]";
/** The one destructive treatment, matching Clear All in the toolbar. Every delete in this tool looks like
 *  this and nothing else does. */
const NOTE_DANGER =
  "h-9 rounded-full px-4 text-[0.75rem] font-medium text-[hsl(0_84.2%_67%)] transition-colors duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-[hsl(0_84.2%_60.2%_/_0.14)] hover:text-[hsl(0_84.2%_72%)]";
/** The X in the corner of an open pin. A control, so it keeps its size on screen like the box does. */
const NOTE_CLOSE =
  "absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-full text-white/45 transition-colors duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-white/[0.08] hover:text-white";
/** The field: 14px, up from 12, and the same one whether the note is new, being edited, or being added to. */
/* `select-text` because the WORLD forbids selection (`canvas-surface.tsx`, so a comment drag cannot paint a
   frame blue) and a box you type into is the one thing inside it that must still allow a caret and a
   double-click. Safari inherits `user-select: none` into form fields; Chrome does not. This makes both agree. */
const NOTE_FIELD =
  "w-full select-text resize-none rounded-xl bg-white/[0.06] px-4 py-3.5 text-[0.875rem] font-medium leading-relaxed text-white outline-none placeholder:text-white/40 focus-visible:ring-1 focus-visible:ring-white/25";
/**
 * The note box is the ONE element on the canvas that keeps its size on screen: it is a control, not part of the
 * drawing, and a text box that grows as you zoom is a text box fighting you. So these are SCREEN pixels, held
 * there by counter-scaling with `--canvas-inv-zoom` (see canvas-surface.tsx).
 */
const NOTE_BOX_W = 468;
const NOTE_BOX_RADIUS = 18;
const NOTE_BOX_SHADOW = `0 18px 44px hsl(0 0% 0% / 0.55)`;
const FRAME_EDGE = `0 0 0 ${RING}px hsl(0 0% 100% / 0.14), 0 ${RING * 8}px ${RING * 22}px hsl(0 0% 0% / 0.55)`;
/**
 * THE SAME EDGE, IN THE NEW-SCREEN BLUE. Not a badge and not a second object: the hairline every frame already
 * draws, in the one colour that means "you have not seen this yet".
 *
 * Light blue rather than the review green, so the two states cannot be confused — the owner, once both existed:
 * *"the outline I think that it actually has to be blue, like light blue. and the toolbar has to be blue as
 * well."* Brighter and thicker than the ordinary edge, because it has to be findable at 10% zoom across a canvas
 * of seventy frames, which is the whole reason it exists.
 */
const NEW_EDGE = `0 0 0 ${RING * 1.5}px hsl(206 92% 66% / 0.95), 0 ${RING * 8}px ${RING * 22}px hsl(0 0% 0% / 0.55)`;

/**
 * What a source path says on a badge. The file name, except when the file name is `page.tsx` or `route.ts` —
 * every route in a Next app is called that, so the badge would name nothing. Those get the folder that gives
 * them their meaning instead. The full path is on the badge's own tooltip either way.
 */
/**
 * HOW MANY BADGES FIT UNDER A FRAME, and why this is arithmetic rather than a measurement.
 *
 * The caption row is one line under the frame and it used to draw every declared file, so a screen built from
 * seven of them ran straight across the gap and printed on top of its neighbour's row. The owner, seeing two
 * frames' captions collide: *"these items overlap when there are many of them."*
 *
 * The row cannot be measured before it is laid out, and measuring it after means a reflow on every frame on a
 * surface built to be dragged. But the badges are `font-mono`, where every glyph is the same width, so the
 * width of one is its character count times the type size times the font's own ratio, plus its padding. That
 * is exact for the file names and close enough for the one sans-serif pill beside them.
 *
 * So the row takes what fits inside the FRAME'S OWN WIDTH and hands the rest to a `+N` badge, which is the
 * owner's own remedy: *"hide the other ones that didnt fit into smth like a '+N' badge that on hover could
 * show the other ones in a tooltip (same tooltip we already use on the canvas in other places)."* A caption
 * can now never be wider than the thing it captions, at any zoom, for any declaration.
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

/**
 * The split: the badges that fit, and the ones the `+N` takes. Widest-first would reorder a list whose ORDER
 * is meaningful — the declaration names the most defining file first — so this only ever drops from the tail.
 */
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
};

export type NewRegionComment = {
  screenId: string;
  region: CanvasRegion;
  note: string;
  /** The shot with the outline drawn on it, as a data URL. Written to a file beside the JSON. */
  image: string;
  shotHash: string;
};

export function CanvasFrame({
  canvas,
  screen,
  shot,
  manifestLoaded,
  scale,
  pins,
  nextNumber,
  showTitle,
  optionNumber,
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
  chromeW,
  revealed = true,
  entranceDelay = 0,
  isNew = false,
}: {
  /** Which canvas this frame belongs to. Namespaces the picture it asks for — see `src`. */
  canvas: string;
  /**
   * THE SAME SCREEN ON THE OTHER DEVICE, when there is one. Absent draws no control.
   *
   * The owner asked for it beside Open, and as a shortcut rather than a second navigation: *"what if we had a
   * similar button to kind of, that would be kind of like a shortcut to open the same screen if it's available,
   * but on the other device. So if you're looking at a desktop screen, there might be like a button very similar
   * to open, but it would be just a icon that you can click and it would show you the same screenshot on the
   * canvas but for mobile."* So it is an icon, it sits with Open, and it moves the canvas rather than the page.
   */
  onTwin?: { device: CanvasDevice; go: () => void } | null;
  /**
   * How wide this frame's caption and foot may be, in world units, which is not always the picture's width.
   *
   * A phone frame is about 312 wide and its chrome was built against a desktop's 1152. Rather than shrink the
   * type or drop a control, the chrome is allowed to be wider than the picture and the layout reserves the room
   * (`chromeWidth` in graph-layout.ts). Absent means the picture's own width, which is every desktop frame.
   */
  chromeW?: number;
  /**
   * WHETHER THE WORLD HAS BEEN PLACED YET. A frame is invisible until it has, which is what removed the flash of
   * the first screenshot blown up in the corner: there is nothing to see at the wrong transform.
   *
   * Defaults to true so a frame drawn outside a surface is not invisible by accident.
   */
  revealed?: boolean;
  /** Milliseconds this frame waits before arriving, so a flow composes itself in its own order. */
  entranceDelay?: number;
  /**
   * A SCREEN THE REVIEWER HAS NOT SEEN BEFORE, which takes the frame's own edge in blue.
   *
   * The mark is the edge rather than a badge because the edge is already there: every frame draws a hairline, so
   * this is the same object in a different colour rather than one more thing on the canvas. The owner: *"it would
   * be nice to mark it, mark each screen somehow… maybe like with a green color border or something like that,
   * because we already show a border"*, and then, once the two states existed side by side, *"the outline I think
   * that it actually has to be blue, like light blue"* — green stays the colour of a comment awaiting approval.
   */
  isNew?: boolean;
  screen: CanvasScreen;
  /** What was captured for this screen, or null when it has never been captured. */
  shot: CanvasShot | null;
  /**
   * WHETHER THE MANIFEST HAS ARRIVED YET, which is NOT the same question as whether this screen has a picture.
   *
   * Without this the two are indistinguishable — `shot: null` meant both "never captured" and "we have not asked
   * yet" — and the canvas showed the wrong one of them first. Owner, on the skeletons: _"when I open the canvas it
   * just freezes for a second or two, then unfreezes and shows me all screens as not captured for another second or
   * two, only than it shows the skeleton in each screen for a fraction of the second but it doesnt make sense
   * anymore cause it DOES NOT do it at the beginning when it actually loads, defeating the whole purpose of such an
   * approach."_
   *
   * Measured before the fix: "Not captured yet" at 660ms, the skeleton at 674ms, the first picture at 689ms. The
   * skeleton was real and it was last. So the frame waits on this instead: while the manifest is in flight every
   * frame is a skeleton, and "Not captured yet" is only ever said about a screen the manifest has actually
   * answered for.
   */
  manifestLoaded: boolean;
  /** How much of real size the picture is drawn at on the canvas. */
  scale: number;
  pins: FramePin[];
  /** The number the next comment anywhere on the canvas will carry, burned into its picture. */
  nextNumber: number;
  /**
   * Whether to name the frame above it. TRUE when the screens are grouped, because there the titles are the
   * only thing telling near-identical screens apart. FALSE in a flow, where the arrows carry the explanation:
   * picture, what the user did, next picture. A title there would be a third thing to read for no gain.
   */
  showTitle: boolean;
  /** 1-based position among an exploration's options. Absent everywhere else, and then no badge is drawn. */
  optionNumber?: number;
  /** This option's standing, or null. Only meaningful with `onVerdict`. */
  verdict?: "like" | "dislike" | null;
  /** Present only in an exploration: without it the two buttons are not drawn at all. */
  onVerdict?: (value: "like" | "dislike" | null) => void;
  /** Comment mode is on: a drag on this frame draws an outline instead of panning the canvas. */
  commenting: boolean;
  onSave: (comment: NewRegionComment) => Promise<void>;
  onDeletePin: (id: string) => void;
  /** Rewrite a comment's words in place, from its own pin. Region and picture untouched. */
  onEditPin: (id: string, note: string) => Promise<void>;
  /**
   * The next round of feedback on a comment the agent has already answered: the words, and a fresh annotated
   * picture cut from the CURRENT screenshot, because that is the one the reviewer is looking at and the one
   * the agent has to look at next. Reopens the comment rather than making a second one on the same box.
   */
  onFeedback: (id: string, note: string, image: string) => Promise<void>;
  /**
   * WHICH PIN IS OPEN IS OWNED BY THE CANVAS, not by the frame. It was local state here until the review
   * queue needed to open one from outside — stepping through what is waiting for you means flying the canvas
   * to a pin and opening it, and a frame cannot be told to do that if it keeps the answer to itself.
   */
  openPin: string | null;
  onOpenPin: (id: string | null) => void;
}) {
  const imageRef = useRef<HTMLImageElement | null>(null);
  /**
   * WHETHER THE PICTURE HAS ARRIVED, so a frame can show a shape instead of a hole.
   *
   * Owner, on a canvas holding thirty-odd screenshots: _"it takes some time to load when there is lots of
   * screenshots, like in our case already. and I just see like a very weird state instead of some beautiful maybe
   * skeleton loader."_ The "weird state" is an `<img>` with width and height but no bytes: a frame-sized void
   * with a caption under it.
   *
   * Started from `complete` rather than `false`, because a cached picture finishes loading before this component
   * ever hydrates and `onLoad` never fires for it. Assume false there and every already-loaded frame keeps a
   * skeleton over it forever — which is a worse bug than the one being fixed.
   */
  const [loaded, setLoaded] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<{
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  } | null>(null);
  const [draft, setDraft] = useState<CanvasRegion | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  /** The pin whose words are being rewritten, and the words so far. */
  const [editing, setEditing] = useState<{ id: string; note: string } | null>(
    null,
  );
  /** The pin being given another round of feedback, and the words so far. */
  const [feedback, setFeedback] = useState<{ id: string; note: string } | null>(
    null,
  );
  const popRef = useRef<HTMLDivElement | null>(null);

  const w = Math.round((shot?.w ?? 1440) * scale);
  const h = Math.round((shot?.h ?? 900) * scale);
  const failed =
    (shot?.claims ?? []).some((claim) => !claim.met) || shot?.stable === false;
  const missing = (shot?.claims ?? [])
    .filter((claim) => !claim.met)
    .map((claim) => claim.claim);
  /**
   * The caption row's own budget: the frame's width, less the Open button and the failure pill when there is
   * one, because both of those are never dropped. See `fitBadges`.
   */
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

  /* Measured, never assumed: on the canvas the picture is scaled by its own `scale` AND by the canvas
     zoom, and the box's own width already has both in it. */
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
    /* Drawing a rectangle is not selecting text. Without this the same drag did both, and the frame under the
       outline came out blue. */
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
   * The handoff, made here because this is where the pixels already are: the captured shot at its own size
   * with the outline and the comment's number burned into it. Same origin, so the canvas is not tainted and
   * `toDataURL` works — that is the whole reason the pictures are served from the app rather than a CDN.
   */
  const annotate = useCallback(
    (region: CanvasRegion, n: number): string | null => {
      const image = imageRef.current;
      if (!image || !shot) return null;
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
      /* Red, and the only red anywhere near this tool: an annotation has to be findable on any design at a
         glance, which is the opposite requirement to the canvas's own chrome. */
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
    const image = annotate(draft, nextNumber);
    if (!image) return;
    setSaving(true);
    try {
      await onSave({
        screenId: screen.id,
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
   * WHEN A COMMENT IS THE REVIEWER'S TO ANSWER: the agent has read it AND the screen has been photographed
   * since, so there is something new to look at. Before both of those, the comment is still an instruction
   * and the actions are Edit and Delete.
   */
  const reviewable = (comment: CanvasComment) =>
    Boolean(comment.consumedAt) && comment.stale === true;

  /** Another round on a comment already answered: new words, new picture, back into the agent's queue. */
  const sendFeedback = async () => {
    if (!feedback || !shot || feedback.note.trim().length === 0) return;
    const pin = pins.find((one) => one.comment.id === feedback.id);
    if (!pin) return;
    const image = annotate(pin.comment.region, pin.n);
    if (!image) return;
    setSaving(true);
    try {
      await onFeedback(feedback.id, feedback.note.trim(), image);
      setFeedback(null);
    } finally {
      setSaving(false);
    }
  };

  /** Rewrite the words on a pin. Nothing else about the comment moves — see the route's own note. */
  const saveEdit = async () => {
    if (!editing || editing.note.trim().length === 0) return;
    const { id, note: words } = editing;
    setEditing(null);
    await onEditPin(id, words.trim());
  };

  /**
   * A CLICK OUTSIDE CLOSES AN OPEN PIN. Owner: "it makes more sense to have an X icon and also to close it
   * automatically if the user clicks outside of this component, because having a big close button is a bit
   * confusing." Capture phase, so it runs before the canvas's own pan handler decides what the press was;
   * the pin button itself is excluded, or opening one would immediately close it again.
   */
  useEffect(() => {
    /**
     * ONLY THE FRAME THAT OWNS THE OPEN PIN LISTENS. `openPin` became a prop when the review queue needed to
     * open one from outside, which means all twenty-eight frames now see it — and twenty-seven of them have a
     * null `popRef`, so every one of them decided the click was "outside" and closed the pin. Pressing
     * Dismiss dismissed the box instead. The frame that renders the popover is the only one with an opinion.
     */
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

  /**
   * THE SLUG TRAVELS WITH THE REQUEST, and leaving it out was a bug that only a SECOND canvas could reveal.
   *
   * The shots route resolves which canvas is being asked about from `?canvas=<slug>` and infers it when the
   * project has only one. Every project had only one until two were installed side by side, and then every
   * picture on both canvases came back 400: 28 frames and 62 frames, all skeleton, because the route could not
   * guess which namespace `intro-1` lived in. The reviewer saw an empty canvas.
   *
   * The frame already knows the answer — it is rendering one canvas — so it says so rather than letting the
   * route guess.
   */
  const src = useMemo(
    () =>
      shot
        ? `/api/design-canvas/shots?canvas=${encodeURIComponent(canvas)}&id=${encodeURIComponent(screen.id)}&v=${shot.hash}`
        : null,
    [canvas, shot, screen.id],
  );

  /* After `src`, because it is what this watches: a new picture for the same frame goes back to the skeleton. */
  useEffect(() => {
    const image = imageRef.current;
    setLoaded(image?.complete === true);
  }, [src]);

  const dragBox = drag ? asRegion(drag) : null;

  /**
   * Where a note box hangs from. Anchored to the region's left edge normally, and to its RIGHT edge once the
   * region is past the middle of the frame — otherwise a comment on anything near the right-hand side opens a
   * box that runs off into the canvas away from the thing it is about.
   */
  const boxAnchor = (region: CanvasRegion) => {
    const flip = region.xPct + region.wPct / 2 > 55;
    /**
     * HOW FAR BELOW THE REGION'S TOP THE CARD MAY HANG, and it is a cap rather than a position because a
     * frame can be thousands of pixels tall.
     *
     * The card hangs under the outline, which is right: it must not cover what was just pointed at. But the
     * anchor was `yPct + hPct` in FRAME percent, and once long pages began capturing at full length — 4045px
     * for a storefront, 4760 for a product page — an ordinary drag put the card a thousand-odd pixels below
     * the region, off the viewport entirely. The reviewer outlines something and the box to type in is
     * somewhere they have to go looking for. The oracle caught it as a Save button it could not reach.
     *
     * So the drop is capped at 420px of frame, expressed as a percentage of THIS frame's own height. On a
     * 900px frame that is 47% and nothing changes — every region is shorter than that. On a tall frame the
     * card follows the region's TOP instead, which is where the drag started and therefore where the
     * reviewer is looking.
     */
    const maxDropPct = h > 0 ? (420 / h) * 100 : 100;
    const drop = Math.min(region.hPct, maxDropPct);
    return {
      ...(flip
        ? { right: `${100 - (region.xPct + region.wPct)}%` }
        : { left: `${region.xPct}%` }),
      top: `${region.yPct + drop}%`,
      width: NOTE_BOX_W,
      borderRadius: NOTE_BOX_RADIUS,
      boxShadow: NOTE_BOX_SHADOW,
      /* Screen-constant. The origin is the corner it hangs from, so it grows away from the frame's edge
         rather than across it. */
      transform: "scale(var(--canvas-inv-zoom, 1))",
      transformOrigin: flip ? "top right" : "top left",
      marginTop: 12,
      padding: 14,
    };
  };

  return (
    <figure
      className="relative m-0"
      style={{
        width: w,
        height: h,
        /**
         * THE ENTRANCE, AND IT IS THE ONLY MOTION HERE.
         *
         * Opacity alone: this element is one of dozens on a surface being panned and zoomed, and a transform or a
         * filter on each of them is what turns the instrument into a slideshow. `entranceDelay` is the frame's
         * place in the diagram's own reading order, so the canvas composes itself left to right rather than
         * appearing as one block — and it is over inside a quarter second either way.
         *
         * Exponential ease-out from an already-final position: nothing slides in from anywhere.
         */
        opacity: revealed ? 1 : 0,
        transition: `opacity 260ms cubic-bezier(0.16, 1, 0.3, 1) ${revealed ? entranceDelay : 0}ms`,
      }}
      data-canvas-screen={screen.id}
    >
      {/**
       * ABOVE THE FRAME: its title, when the screens are grouped, and nothing else. It carried a state chip and
       * a line of description as well, and both are gone — the description said what the title said, and the
       * chip printed the difference between two frames a second time. In a FLOW there is no title at all: the
       * arrows explain the journey, and naming every frame on top of that is a third thing to read.
       */}
      {showTitle ? (
        <figcaption
          /* `left-0` and a width rather than `inset-x-0`: a phone frame's chrome is wider than its picture, and
             the layout has reserved that room. A desktop frame gets the picture's width and nothing changes. */
          className="absolute bottom-full left-0 flex items-center text-white"
          style={{
            marginBottom: CAPTION_GAP,
            gap: 12,
            width: chromeW ?? "100%",
          }}
          title={screen.note}
        >
          {/**
           * THE OPTION'S NUMBER IS PART OF THE NAME, as text, in an exploration only.
           *
           * A reviewer choosing between five directions says "number three", not the four words on the frame, so
           * the number has to be on the frame. It was a round badge, which was over-built for what it is — owner,
           * _"the screen number has to be a simple text (e.g., '1. bla bla bla') — there's NO need to
           * make a UI badge with a number, dont overcomplicate it."_
           */}
          <span
            className="min-w-0 flex-1 truncate font-semibold tracking-[-0.015em]"
            style={{ fontSize: NAME_SIZE, lineHeight: 1.15 }}
          >
            {optionNumber ? `${optionNumber}. ` : ""}
            {screen.label}
          </span>

          {/**
           * LIKE AND DISLIKE — at the far right of the name, as icons, in green and red.
           *
           * A verdict is not a sentence: it is one of two things, pressed dozens of times across a canvas, and a
           * thumb in its own colour says it in the space a word would need. Owner: _"like and dislike
           * should have icons (svgs), place to the very right from the screen name and be green/red."_
           *
           * A verdict says whether an option SURVIVES; a comment says what is wrong with it. Those are different
           * questions — an option can be liked with three complaints on it — and keeping them apart is what lets a
           * hand-off say "drop these, refine that, and here is what to fix while you do it".
           *
           * Pressing the one a frame already carries clears it, so a mis-click is one press to undo.
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
                    /**
                     * THE PAN SURFACE EATS THIS CLICK WITHOUT THIS LINE, and it does it silently.
                     *
                     * `canvas-surface.tsx` starts a world-drag on pointerdown and calls `setPointerCapture`, so
                     * every later pointer event — including the mouseup that would have completed the click — is
                     * redirected to the surface. The button renders, highlights, hovers, and never fires. Its own
                     * pins already guard themselves the same way, which is why they worked and this did not.
                     *
                     * Measured, because this is invisible by inspection: `pointerdown` and `mousedown` arrived on
                     * the button, `mouseup` and `click` arrived on the surface div, and `lostpointercapture` fired
                     * there too. Invoking the React `onClick` prop by hand saved a verdict; a real press never did.
                     */
                    onPointerDown={(event) => event.stopPropagation()}
                    aria-pressed={on}
                    aria-label={value === "like" ? "Like" : "Dislike"}
                    title={value === "like" ? "Like" : "Dislike"}
                    data-canvas-verdict={value}
                    className={cn(
                      "inline-flex shrink-0 items-center justify-center rounded-full transition-colors duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
                      /**
                       * THE GROUND ARRIVES ON HOVER, and stays only once a verdict is actually given.
                       *
                       * Owner, on a first attempt that tinted both circles at rest: _"I said show bg
                       * on hover didnt I? so why the hell did you add them by default like this"_. So three
                       * states, and the difference between them is the whole readout:
                       *
                       *   at rest      no circle at all, just the glyph in its own colour. Nothing is claimed.
                       *   on hover     the circle appears, tinted, so the target is obvious under the cursor.
                       *   once given   the circle goes SOLID and stays, hover or not, because a verdict has to be
                       *                legible when nobody is pointing at it — that is what a reviewer scans a
                       *                whole canvas for. It deepens further on hover, so pressing it again to
                       *                clear a mis-click still feels like a control rather than a label.
                       *
                       * THE ALPHA GOES INSIDE THE COLOUR, never on an opacity modifier. `bg-[hsl(...)]/25`
                       * compiles to NOTHING — Tailwind will not hang a slash opacity off an arbitrary `hsl()`
                       * value, so it silently drops the declaration while the neighbouring `text-[hsl(...)]`
                       * works. Measured, not guessed: `getComputedStyle().backgroundColor` read
                       * `rgba(0, 0, 0, 0)` in every state before this was written the long way.
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
       * BELOW THE FRAME: one button, and the badges.
       *
       * The button is a FIXED SIZE with a fixed word on it. It used to be the route itself as a link, which gave
       * every frame a differently sized affordance in a different place — hard to aim at and impossible to keep
       * consistent as routes change. A button is a button; the address it opens is on hover.
       *
       * The badges name the components this screen is built from — the file, not the whole path, because a badge
       * is a label and a path is a paragraph. The full path is on hover, and the declaration keeps it in full for
       * whoever has to open it.
       */}
      <figcaption
        className="absolute left-0 top-full flex items-center"
        style={{ marginTop: FOOT_GAP, gap: 12, width: chromeW ?? "100%" }}
        data-canvas-chrome=""
      >
        <a
          href={shot?.url ?? screen.route}
          target="_blank"
          rel="noreferrer"
          /* Solid white: this is the way from a picture back to the running page, and the whole reason the
             frames could be turned into pictures at all. It should be the first thing found under a frame. */
          className="inline-flex shrink-0 items-center justify-center rounded-full bg-white font-medium text-[hsl(180_15%_5.5%)] transition-colors duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-white/85"
          style={{
            fontSize: META_SIZE,
            lineHeight: 1,
            height: BUTTON_H,
            width: BUTTON_W,
            gap: 8,
          }}
          title={`Open ${shot?.url ?? screen.route} in a new tab`}
          data-canvas-open=""
        >
          Open
          <IconOpenExternal size={META_SIZE + 1} />
        </a>

        {/**
         * THE SAME SCREEN ON THE OTHER DEVICE, and it moves the canvas rather than opening anything.
         *
         * Beside Open because it answers the neighbouring question — *"a button very similar to open, but it would
         * be just a icon that you can click and it would show you the same screenshot on the canvas but for
         * mobile"*. An icon and no word, so a phone frame's foot does not grow a second pill, and outlined rather
         * than solid so Open stays the one filled thing under a frame.
         *
         * Only rendered when the declaration names a twin: a design that exists on one device only has no button,
         * which is the ordinary case in both directions.
         */}
        {onTwin ? (
          /**
           * WITH THE CANVAS'S OWN TOOLTIP, not just a `title`.
           *
           * An icon with no word needs saying out loud, and the owner asked for it after using it: *"when I hover
           * over the phone or desktop action below the screenshot it should show me a tooltip that says something
           * like show on desktop show on mobile, because it might be not self explanatory without it."* `mark={0}`
           * because the button is already visibly pressable, which is this component's own rule for that case.
           */
          <CanvasTooltip
            mark={0}
            title={onTwin.device === "phone" ? "Show on mobile" : "Show on desktop"}
            label={
              <button
                type="button"
                onClick={onTwin.go}
                className="inline-flex shrink-0 items-center justify-center rounded-full font-medium text-white ring-1 ring-white/[0.22] transition-colors duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-white/[0.12]"
                style={{ height: BUTTON_H, width: BUTTON_H, lineHeight: 1 }}
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
            {/* One word briefer, on the owner's note about this exact panel: "photographed" was doing the work
                "at a phone's size" already does. */}
            {onTwin.device === "phone"
              ? "The same screen at a phone's size. The canvas switches device and lands on it."
              : "The same screen at a desktop's size. The canvas switches device and lands on it."}
          </CanvasTooltip>
        ) : null}

        {failed ? (
          <span
            className="shrink-0 rounded-full bg-[hsl(0_84.2%_60.2%)] font-medium text-[hsl(210_40%_98%)]"
            style={{
              fontSize: META_SIZE,
              lineHeight: 1.5,
              padding: "6px 14px",
            }}
            title={
              missing.length > 0
                ? `Captured a page without ${missing.map((claim) => `"${claim}"`).join(", ")}`
                : "Two captures of this page came out different, so it was still moving"
            }
          >
            not what it claims
          </span>
        ) : null}
        {shownSource.map((file) => (
          <span
            key={file}
            className="shrink-0 rounded-full bg-white/[0.09] font-mono text-white/60"
            style={{
              fontSize: META_SIZE,
              lineHeight: 1.5,
              padding: "6px 14px",
            }}
            title={file}
          >
            {badgeFor(file)}
          </span>
        ))}
        {hiddenSource.length > 0 ? (
          <CanvasTooltip
            title="Also built from"
            /* No mark: the badge is already visibly a stand-in for what it is not showing. */
            mark={0}
            className="shrink-0 text-white/60"
            label={
              <span
                className="shrink-0 rounded-full bg-white/[0.09] font-mono text-white/60"
                style={{
                  fontSize: META_SIZE,
                  lineHeight: 1.5,
                  padding: "6px 14px",
                }}
              >
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

      {/**
       * THE PICTURE, and ONLY the picture, is what gets paint containment. Everything a comment draws lives in
       * the layer below this one instead, because `content-visibility` brings containment with it and
       * containment clips: the note box was being cut off at the edge of the screenshot it belonged to.
       */}
      <div
        className="relative h-full w-full bg-white/[0.04]"
        style={{
          /* A failed claim outranks everything: a frame that does not prove what it says is a bug, and a new
             frame is only news. */
          boxShadow: failed
            ? `0 0 0 ${RING}px ${RED}, 0 ${RING * 8}px ${RING * 22}px hsl(0 0% 0% / 0.55)`
            : isNew
              ? NEW_EDGE
              : FRAME_EDGE,
          contentVisibility: "auto",
          containIntrinsicSize: `${w}px ${h}px`,
        }}
      >
        {/* A picture, or the skeleton standing in for one that is still on its way — see `manifestLoaded`. */}
        {src || !manifestLoaded ? (
          <>
            {/**
             * THE SKELETON, and it is deliberately almost nothing.
             *
             * The constraint came with the request: _"It definitely has to be high in performance rather than have
             * a beautiful UI."_ So no shimmer. A moving gradient repaints its whole area every frame, and on a
             * surface holding dozens of these while being panned that is the one thing that cannot be afforded —
             * the interaction IS the instrument here.
             *
             * What it is instead: three plain fills and a pulse on OPACITY, which the compositor animates without
             * touching layout or paint. Two bands suggest a page rather than a rectangle — a header and a body —
             * because the frames are all screenshots of pages and a shape that reads as one makes the wait legible
             * rather than blank. `content-visibility: auto` on the parent means offscreen frames never build this
             * at all, so the cost is bounded to what is actually on screen.
             */}
            {loaded ? null : (
              <div
                className="absolute inset-0 animate-pulse motion-reduce:animate-none"
                aria-hidden
              >
                <div className="h-full w-full bg-white/[0.05]" />
                <div className="absolute left-0 right-0 top-0 h-[9%] bg-white/[0.05]" />
                <div className="absolute left-[6%] top-[16%] h-[4%] w-[38%] rounded-full bg-white/[0.06]" />
              </div>
            )}
            {/* A plain <img>, not next/image: the source is a dev-only API route serving a file this tool wrote,
               there is nothing to optimise, and the element has to stay same-origin and untainted so the
               annotated PNG can be drawn from it in a canvas. */}
            {/* Only once there is something to point it at: while the manifest is in flight the skeleton above is
               the whole of this branch, and an <img> with no source is a request for the page's own URL. */}
            {src ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              ref={imageRef}
              src={src}
              alt={screen.label}
              width={shot?.w}
              height={shot?.h}
              loading="lazy"
              decoding="async"
              draggable={false}
              onLoad={() => setLoaded(true)}
              /* Fades in over the skeleton rather than replacing it in one paint. Opacity only, and the duration
                 is the canvas's one duration — see `canvas-motion.tsx`. */
              style={MOTION_STYLE}
              className={cn(
                "relative h-full w-full select-none transition-opacity motion-reduce:transition-none",
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
      </div>

      {/* The annotation layer: outlines, pins and the note box, over the picture and outside its containment. */}
      <div
        ref={boxRef}
        className={cn(
          "absolute inset-0",
          commenting ? "cursor-crosshair" : "pointer-events-none",
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {/* Saved comments: the region, and a marker that opens it. */}
        {pins.map(({ comment, n }) => (
          <div key={comment.id}>
            <div
              className="pointer-events-none absolute"
              style={{
                left: `${comment.region.xPct}%`,
                top: `${comment.region.yPct}%`,
                width: `${comment.region.wPct}%`,
                height: `${comment.region.hPct}%`,
                borderRadius: REGION_RADIUS,
                boxShadow: SAVED_REGION,
              }}
            />
            <button
              type="button"
              className="pointer-events-auto absolute grid place-items-center rounded-full bg-[hsl(0_84.2%_60.2%)] font-semibold text-[hsl(210_40%_98%)] transition-transform duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)] hover:scale-105"
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
              title={comment.note}
              /* A PIN IS CLICKABLE IN EITHER MODE. Without this the pointerdown reaches the annotation layer
                 underneath and starts drawing a new outline, so with comment mode still on — which is where a
                 reviewer always is, having just saved one — pressing your own pin did nothing at all. */
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
                style={boxAnchor(comment.region)}
                data-canvas-chrome=""
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

                {/**
                 * WHAT A PIN OFFERS DEPENDS ON WHETHER IT HAS BEEN ACTED ON AND PHOTOGRAPHED AGAIN, and the
                 * two states are deliberately not the same set of buttons with one swapped.
                 *
                 * WAITING (the agent has not read it, or the screen has not been captured since): the words
                 * can still be fixed, or the comment thrown away. Edit belongs HERE and only here — "editing
                 * is correct when you haven't yet handed it off to your agent".
                 *
                 * REVIEWABLE (read AND recaptured): the only two things left are the reviewer's verdict.
                 * "after the agent implemented the adjustment and retaken the screenshot, we either approve it
                 * or we dismiss it. If we dismiss it, it should work kind of like editing but more like an
                 * additional comment, additional feedback. If we approve it, it's the same as we just delete
                 * it." So there is no Edit here, Approve deletes, and Dismiss asks for the next round of
                 * feedback on the same rectangle — which reopens the comment rather than making a second one.
                 *
                 * Everything the old version printed under the note is gone: the file name of the annotated
                 * PNG, which is the agent's business rather than the reviewer's, and "read by the agent",
                 * which the owner could not read without guessing what it implied.
                 */}
                {feedback?.id === comment.id || editing?.id === comment.id ? (
                  <>
                    <textarea
                      autoFocus
                      rows={3}
                      value={
                        feedback?.id === comment.id
                          ? feedback.note
                          : (editing?.note ?? "")
                      }
                      placeholder={
                        feedback?.id === comment.id
                          ? "What is still wrong?"
                          : undefined
                      }
                      className={cn(NOTE_FIELD, "mt-3")}
                      style={{ minHeight: 112 }}
                      onChange={(event) =>
                        feedback?.id === comment.id
                          ? setFeedback({
                              id: comment.id,
                              note: event.target.value,
                            })
                          : setEditing({
                              id: comment.id,
                              note: event.target.value,
                            })
                      }
                      onKeyDown={(event) => {
                        if (
                          event.key === "Enter" &&
                          (event.metaKey || event.ctrlKey)
                        )
                          void (feedback ? sendFeedback() : saveEdit());
                        if (event.key === "Escape") {
                          setFeedback(null);
                          setEditing(null);
                        }
                      }}
                    />
                    <div className="mt-3 flex justify-end gap-1.5">
                      <button
                        type="button"
                        className={NOTE_GHOST}
                        onClick={() => {
                          setFeedback(null);
                          setEditing(null);
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={
                          saving ||
                          (feedback?.id === comment.id
                            ? feedback.note
                            : (editing?.note ?? "")
                          ).trim().length === 0
                        }
                        className={cn(NOTE_PRIMARY, "disabled:opacity-40")}
                        onClick={() =>
                          void (feedback ? sendFeedback() : saveEdit())
                        }
                      >
                        {feedback?.id === comment.id ? "Send" : "Save"}
                      </button>
                    </div>
                  </>
                ) : reviewable(comment) ? (
                  <div className="mt-4 flex justify-end gap-1.5">
                    <button
                      type="button"
                      className={NOTE_GHOST}
                      onClick={() => setFeedback({ id: comment.id, note: "" })}
                    >
                      Dismiss
                    </button>
                    <button
                      type="button"
                      className={NOTE_PRIMARY}
                      onClick={() => {
                        onOpenPin(null);
                        onDeletePin(comment.id);
                      }}
                    >
                      Approve
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
                      onClick={() =>
                        setEditing({ id: comment.id, note: comment.note })
                      }
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
          <div
            className="pointer-events-none absolute"
            style={{
              left: `${dragBox.xPct}%`,
              top: `${dragBox.yPct}%`,
              width: `${dragBox.wPct}%`,
              height: `${dragBox.hPct}%`,
              borderRadius: REGION_RADIUS,
              boxShadow: SAVED_REGION,
              background: "hsl(0 84.2% 60.2% / 0.1)",
            }}
          />
        ) : null}

        {/* The outline just drawn, and the note going with it. */}
        {draft ? (
          <>
            <div
              className="pointer-events-none absolute"
              style={{
                left: `${draft.xPct}%`,
                top: `${draft.yPct}%`,
                width: `${draft.wPct}%`,
                height: `${draft.hPct}%`,
                borderRadius: REGION_RADIUS,
                boxShadow: SAVED_REGION,
              }}
            />
            <div
              className="pointer-events-auto absolute z-[50] bg-[hsl(180_15%_5.5%)] ring-1 ring-white/[0.14]"
              style={boxAnchor(draft)}
              data-canvas-chrome=""
              onPointerDown={(event) => event.stopPropagation()}
            >
              <textarea
                autoFocus
                value={note}
                rows={3}
                placeholder="What is wrong with this?"
                /* Slightly smaller than the note it becomes, medium, quiet, and set in from the left so the
                   first character is not against the wall. */
                /* `0.75rem`, up from `0.625rem`: "the placeholder text there could be maybe one or two pixels
                   bigger. and I mean, value text as well." One property covers both — a textarea's
                   placeholder takes the field's own size — so the two cannot drift apart. */
                className={NOTE_FIELD}
                style={{ minHeight: 132 }}
                onChange={(event) => setNote(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey))
                    void save();
                  if (event.key === "Escape") setDraft(null);
                }}
              />
              <div className="mt-2.5 flex items-center justify-between">
                {/* "gitignored" used to sit here, on every comment anybody ever wrote. Where the files live
                    is one fact, said once, in the hand-off panel — not a caption on the writing surface. */}
                <span />
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    className={NOTE_GHOST}
                    onClick={() => setDraft(null)}
                  >
                    Cancel
                  </button>
                  {/* THE WAIT LIVES HERE NOW. The write is a round trip to disk plus a PNG the size of the
                      screenshot, so it is long enough to notice and long enough to press twice. The button
                      states what it is doing and stops accepting presses while it does it, which is both the
                      feedback and the guard. */}
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

        {/**
         * "Saved for the agent" WAS HERE, as a white pill floating over the frame for two seconds.
         *
         * Owner: _"when I save a comment, I see a badge saying something like saved to agent, but I don't think
         * we need that. we can just maybe have some quick loading state in the save button instead."_ He is
         * right twice over. The pill announced a thing the reviewer had just done on purpose, and it announced
         * it AFTER the only moment of doubt — the write itself — had already passed. The wait is what wants a
         * signal, so the signal moved into the Save button, and the proof that it worked is the numbered pin
         * that is now sitting on the frame.
         */}
      </div>
    </figure>
  );
}
