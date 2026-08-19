"use client";

/**
 * design-canvas CORE — the infinite canvas itself.
 *
 * ONE TRANSFORM ON ONE CONTAINER. Everything on the canvas — frames, edges, labels — is positioned in
 * world coordinates inside a single element, and panning and zooming move that element. That is why this
 * needs no library and no dependency: there is nothing to synchronise, so an edge cannot drift away from
 * the frame it points at however far the canvas is moved.
 *
 * WHY IT IS ANIMATED RATHER THAN SET DIRECTLY. A wheel event is a step, and stepping a transform is what
 * makes a canvas feel like a jerking document. So there are two transforms: the one the input asks for
 * (`target`) and the one on screen (`current`), and a frame loop eases the second towards the first. A
 * drag is exempt — a hand moving something must track the pointer exactly, or it feels broken — but the
 * throw at the end of a drag, every wheel zoom, and every jump to a flow are all eased.
 *
 * EVERYTHING ON THE CANVAS IS THE SAME SIZE AS THE CANVAS. Text does not fight the zoom: a frame's name and
 * an edge's label are sized in world pixels, so they grow and shrink with the frames and never move relative
 * to them. An earlier version scaled labels against the zoom to keep them legible on screen, and it read as
 * the canvas rearranging itself while you used it.
 *
 * Two things are exempt, and both are exempt for the same reason — they are not part of the drawing. The
 * stroke width of the edges (`--canvas-edge-width`) would otherwise vanish into a hairline, and the box a
 * comment is typed into (`--canvas-inv-zoom`) is a control, so it holds its size on screen at every zoom.
 * Both are written only when the zoom actually changes, never per frame.
 */

import {
  forwardRef,
  type ReactNode,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

import type { Box } from "./graph-layout";

/** Zoom bounds. 1 is the declaration's own frame scale, so 1.25 is a page at its real size. */
const MIN_ZOOM = 0.06;
/* 1.25 puts a captured 1440px page on screen at exactly 1440px: past that the picture is being upscaled and
   the reviewer would be judging softness that is not in the design. */
const MAX_ZOOM = 1.25;
/** How much of the easing gap is closed per frame. Higher is snappier; this settles in ~8 frames. */
const EASE = 0.22;
/** Below this, the eased transform has arrived and the loop can stop. */
const EPSILON = 0.01;
/** How long a release's velocity keeps carrying the canvas. */
const THROW_MS = 170;
/** One notch of the zoom buttons and the keyboard. */
const ZOOM_STEP = 1.25;
/** Breathing room left around a box when the canvas is asked to frame it. */
const FIT_PADDING = 120;

export type Transform = { x: number; y: number; z: number };

export type CanvasSurfaceHandle = {
  /** Frame a world box, choosing the zoom that fits it. */
  frame: (box: Box) => void;
  /** Centre a world box at a given zoom, for looking at one screen rather than a whole diagram. */
  centre: (box: Box, zoom: number) => void;
  zoomBy: (factor: number) => void;
  /** What is on screen right now. Read, never written. */
  read: () => Transform;
};

export const CanvasSurface = forwardRef<
  CanvasSurfaceHandle,
  {
    /** The world's own bounds, so the surface can frame everything. */
    world: Box;
    /** The corner of the world the canvas opens on. See the framing effect below for why it is not all. */
    opening: Box;
    /** Reported when the zoom changes enough to matter, for the readout. Never per frame. */
    onZoom?: (zoom: number) => void;
    /** True while a tile is taking comment clicks: dragging then would fight the pin. */
    locked?: boolean;
    /**
     * WHAT TO SHOW WHILE THE WORLD IS BEING PLACED, and why this exists at all.
     *
     * The transform starts at the world's top-left corner at half scale, and the opening framing runs in an
     * effect — which is to say AFTER the first paint. So opening the canvas showed one frame of the first
     * screenshot, blown up in the corner, and then jumped. The owner: *"for a fraction of a second, it keeps
     * me super zoomed in to, I think one of the or even the first image on the canvas, which just looks
     * weird. I think it has to be some kind of an overall nice looking smooth, smooth, quick loading for
     * launching this canvas and then skeletons whenever the screens are not able to load super fast."*
     *
     * The surface owns the TIMING, because it is the only thing that knows when it has been placed. The
     * caller owns the WORDS, because the core knows nothing about what canvas it is drawing. Nothing here
     * animates the transform: an entrance from nowhere would be motion for its own sake, so the world simply
     * fades in once it is pointing at the right place.
     */
    launch?: ReactNode;
    children: ReactNode;
  }
>(function CanvasSurface(
  { world, opening, onZoom, locked = false, launch, children },
  ref,
) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<HTMLDivElement | null>(null);
  const target = useRef<Transform>({ x: 0, y: 0, z: 0.5 });
  const current = useRef<Transform>({ x: 0, y: 0, z: 0.5 });
  const raf = useRef(0);
  const reported = useRef(0.5);
  const [grabbing, setGrabbing] = useState(false);
  /** False until the opening framing has been applied, which is what the veil below waits on. */
  const [placed, setPlaced] = useState(false);

  const clampZoom = (zoom: number) =>
    Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

  /**
   * The loop. It writes to the DOM and never to React state, so panning a canvas of live pages does not
   * re-render one of them.
   *
   * THE VARIABLES ARE WRITTEN ONLY WHEN THE ZOOM CHANGES, and that is a performance fix rather than a
   * tidiness one. A custom property on this element invalidates style for every descendant that reads it
   * — every frame name, every edge label, every stroke — so writing them on each animation frame made a
   * plain drag recalculate style for hundreds of elements sixty times a second. A drag does not change the
   * zoom, so a drag now costs one transform and nothing else.
   */
  const varsAt = useRef(0);
  const paint = useCallback(() => {
    const node = worldRef.current;
    if (!node) return;
    const { x, y, z } = current.current;
    node.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${z})`;
    if (Math.abs(z - varsAt.current) > 0.001) {
      varsAt.current = z;
      /**
       * THE ONE THING THAT DOES NOT SCALE WITH THE CANVAS is the note box a comment is written in. Everything
       * else here belongs to the canvas and grows and shrinks with it; a box you are typing into is a control,
       * and a control that changes size while you use it is wrong. It counter-scales by exactly 1/zoom, with no
       * cap, so it is the same size on screen at 6% as at 125%.
       */
      node.style.setProperty("--canvas-inv-zoom", String(1 / z));
      /* Edge strokes are in world units, so they thin out as the canvas shrinks; this holds them at
         roughly two screen pixels down to a third scale. Capped low on purpose: the arrowheads are sized
         from the stroke, and an uncapped stroke drew arrowheads bigger than the frames they pointed at. */
      node.style.setProperty(
        "--canvas-edge-width",
        `${Math.min(8, Math.max(2, 2.2 / z))}px`,
      );
    }
    if (Math.abs(z - reported.current) / z > 0.02) {
      reported.current = z;
      onZoom?.(z);
    }
  }, [onZoom]);

  const tick = useCallback(() => {
    const to = target.current;
    const at = current.current;
    const dx = to.x - at.x;
    const dy = to.y - at.y;
    const dz = to.z - at.z;
    const done =
      Math.abs(dx) < EPSILON &&
      Math.abs(dy) < EPSILON &&
      Math.abs(dz) < EPSILON / 100;
    if (done) {
      current.current = { ...to };
      paint();
      raf.current = 0;
      return;
    }
    current.current = {
      x: at.x + dx * EASE,
      y: at.y + dy * EASE,
      z: at.z + dz * EASE,
    };
    paint();
    raf.current = window.requestAnimationFrame(tick);
  }, [paint]);

  const run = useCallback(() => {
    if (raf.current === 0) raf.current = window.requestAnimationFrame(tick);
  }, [tick]);

  /**
   * THE HANDLE HAS TO BE CLEARED, NOT JUST CANCELLED, and getting that wrong killed every eased movement on
   * the canvas while leaving dragging alive.
   *
   * React mounts twice in development. The first unmount cancelled the pending frame but left `raf.current`
   * holding its number, so `run()` — which only schedules when the handle is 0 — decided a loop was already
   * running and never started one again. Both zoom buttons, the wheel, the keyboard and every jump to a
   * screen went silently dead; a drag still worked, because a drag paints directly and never waits for the
   * loop. A regression that only affects the animated half of the interaction is exactly the kind that looks
   * like "it stopped working" rather than like a bug.
   */
  useEffect(
    () => () => {
      window.cancelAnimationFrame(raf.current);
      raf.current = 0;
    },
    [],
  );

  /* ---------------------------------------------------------------- framing */

  const viewport = () => {
    const rect = hostRef.current?.getBoundingClientRect();
    return { w: rect?.width ?? 1200, h: rect?.height ?? 800 };
  };

  const centre = useCallback(
    (box: Box, zoom: number) => {
      const { w, h } = viewport();
      const z = clampZoom(zoom);
      target.current = {
        z,
        x: w / 2 - (box.x + box.w / 2) * z,
        y: h / 2 - (box.y + box.h / 2) * z,
      };
      run();
    },
    [run],
  );

  /**
   * FIT A BOX TO THE VIEWPORT, and never MAGNIFY it to do so.
   *
   * The `Math.min(..., 1)` is the whole of the second half. Fitting is a shrink-to-see operation: a tab holding a
   * lot of frames lands far out, a tab holding a few lands close in, and both are what the reviewer asked for —
   * _"ideally you should just fit the screen on all tabs, either zoomed out a lot or zoomed out just a bit."_ What
   * they did NOT ask for is a sparse tab blown up past its own size, which is what an uncapped fit does: two small
   * frames in a wide viewport would arrive at 300% and read as a mistake rather than as a fit.
   *
   * So 1:1 is the ceiling. "Just a bit" bottoms out at actual size.
   */
  const frame = useCallback(
    (box: Box) => {
      const { w, h } = viewport();
      const z = clampZoom(
        Math.min(
          (w - FIT_PADDING * 2) / Math.max(1, box.w),
          (h - FIT_PADDING * 2) / Math.max(1, box.h),
          1,
        ),
      );
      centre(box, z);
    },
    [centre],
  );

  const zoomAt = useCallback(
    (factor: number, px: number, py: number) => {
      const to = target.current;
      const z = clampZoom(to.z * factor);
      /* Keep the world point under the pointer exactly where it is: that is what makes wheel zoom feel
         like the canvas is being pulled towards you rather than sliding away. */
      const wx = (px - to.x) / to.z;
      const wy = (py - to.y) / to.z;
      target.current = { z, x: px - wx * z, y: py - wy * z };
      run();
    },
    [run],
  );

  const zoomBy = useCallback(
    (factor: number) => {
      const { w, h } = viewport();
      zoomAt(factor, w / 2, h / 2);
    },
    [zoomAt],
  );

  useImperativeHandle(
    ref,
    () => ({ frame, centre, zoomBy, read: () => ({ ...current.current }) }),
    [frame, centre, zoomBy],
  );

  /**
   * WHERE IT OPENS, and why it is not the whole canvas. Fitting everything puts the surface at 6%, where a
   * page is seventy pixels wide: nothing can be read and every frame in the declaration would ask to load
   * at once. Opening on one screen and its neighbours lands at about a third scale, which is the zoom this
   * whole thing is built around — three or four frames across with the edges between them, each frame big
   * enough for the page inside it to be judged. The caller decides which corner that is.
   */
  const framedOnce = useRef(false);
  useEffect(() => {
    if (framedOnce.current || opening.w === 0) return;
    framedOnce.current = true;
    frame(opening);
    /* Placed, not animated in: an entrance from nowhere would be motion for its own sake. */
    current.current = { ...target.current };
    paint();
    /* Only now is the world pointing anywhere worth looking at, so only now may it be seen. */
    setPlaced(true);
  }, [opening, frame, paint]);

  /* ------------------------------------------------------------------ wheel */

  useEffect(() => {
    const node = hostRef.current;
    if (!node) return;
    /* Non-passive, because the browser's own page scroll and pinch-zoom have to be taken over. */
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = node.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      /* A trackpad pinch arrives as a wheel event with ctrlKey set — the same gesture a laptop user
         expects to zoom with — and the modifier keys do it for a mouse. Everything else pans. */
      if (event.ctrlKey || event.metaKey) {
        /* Clamped per event. A trackpad pinch arrives as a stream of small deltas and reads beautifully at
           this rate; a mouse wheel with the modifier held sends one delta of 120, which uncapped is a jump
           of seven times and lands you at the zoom limit from a single notch. */
        const delta = Math.max(-40, Math.min(40, event.deltaY));
        zoomAt(Math.exp(-delta * 0.01), px, py);
        return;
      }
      const to = target.current;
      target.current = {
        ...to,
        x: to.x - event.deltaX,
        y: to.y - event.deltaY,
      };
      run();
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [zoomAt, run]);

  /* ------------------------------------------------------------------- drag */

  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    vx: number;
    vy: number;
    at: number;
  } | null>(null);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (locked && event.button === 0) return;
    /* Belt and braces with `select-none` above: a press that lands on anything the browser considers text
       starts a selection unless the default is prevented, and `user-select` alone does not stop a drag that
       began before the style applied. */
    event.preventDefault();
    /* The chrome is not the canvas: a press on a button, the comment rail or a tile's own controls must
       not drag the world out from under it. */
    if ((event.target as HTMLElement).closest("[data-canvas-chrome]")) return;
    if (event.button !== 0 && event.button !== 1) return;
    drag.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      vx: 0,
      vy: 0,
      at: performance.now(),
    };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    setGrabbing(true);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state || state.id !== event.pointerId) return;
    const dx = event.clientX - state.x;
    const dy = event.clientY - state.y;
    const now = performance.now();
    const dt = Math.max(1, now - state.at);
    state.vx = dx / dt;
    state.vy = dy / dt;
    state.x = event.clientX;
    state.y = event.clientY;
    state.at = now;
    /* A drag moves BOTH, so the canvas tracks the hand exactly. Easing here would feel like lag. */
    target.current = {
      ...target.current,
      x: target.current.x + dx,
      y: target.current.y + dy,
    };
    current.current = {
      ...current.current,
      x: current.current.x + dx,
      y: current.current.y + dy,
    };
    paint();
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state || state.id !== event.pointerId) return;
    drag.current = null;
    setGrabbing(false);
    /* The throw: the eased loop glides into it, which is the whole difference between a canvas that
       feels like a surface and one that feels like a scroll container. */
    const idle = performance.now() - state.at > 90;
    if (!idle) {
      target.current = {
        ...target.current,
        x: target.current.x + state.vx * THROW_MS,
        y: target.current.y + state.vy * THROW_MS,
      };
      run();
    }
  };

  /* --------------------------------------------------------------- keyboard */

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const el = event.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      if (event.key === "0") frame(world);
      else if (event.key === "+" || event.key === "=") zoomBy(ZOOM_STEP);
      else if (event.key === "-" || event.key === "_") zoomBy(1 / ZOOM_STEP);
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [frame, zoomBy, world]);

  return (
    <div
      ref={hostRef}
      /* The stage is a dark grey rather than near-black, and that is a requirement rather than a taste: a
             screenshot can be light or dark, and both have to read as sitting ON something. Near-black loses
             the edge of a dark screen; this holds both, with the frames' own hairline doing the rest.

             WRITTEN OUT AS A LITERAL, NOT AS A TOKEN OF THE PROJECT THIS IS INSTALLED IN. The canvas has one
             appearance everywhere it is used — see core/design-tokens.md — and a token would make it inherit
             the host project's palette, which is the one thing it must never do. */
      /* `select-none`: THIS IS A CANVAS, NOT A DOCUMENT. Dragging out a comment rectangle, or just panning
         across a caption, started the browser's own text selection and painted whole frames blue — the owner:
         *"when I select an area to comment out over the screen, sometimes the whole screen gets selected, you
         know, when you select a text with a mouse in your browser… But I don't think it should be possible to
         do like that because this is a screen. we cannot really select anything there with a mouse."* Nothing
         inside the world is text to copy: the frames are pictures, and the captions label them. The one place
         text IS meant to be selected is the toolbar's hand-off line, and that is a SIBLING of this element
         rather than a child, so it keeps its selection. The comment box adds `select-text` back for itself. */
      className="absolute inset-0 touch-none select-none overflow-hidden bg-[hsl(192_12%_13%)]"
      style={{ cursor: grabbing ? "grabbing" : "grab" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      data-canvas-surface=""
    >
      {/* NO `will-change: transform` HERE, deliberately. This element is the size of the whole canvas —
          tens of thousands of pixels each way — and promoting it asks the browser for one composited layer
          far past the maximum texture size, which drops the whole surface onto a slow path. That was the
          single biggest cause of the first build's stutter. */}
      <div
        ref={worldRef}
        className="absolute left-0 top-0 origin-top-left"
        style={{
          opacity: placed ? 1 : 0,
          transition: "opacity 220ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
        data-canvas-world=""
      >
        {children}
      </div>
      {/**
       * THE LAUNCH STATE: the stage, and one quiet line, for as long as it takes to place the world.
       *
       * Built from the skeleton's own language rather than a new one — a plain fill and a pulse on OPACITY,
       * which the compositor animates without paint or layout, and no shimmer for the reason the skeleton
       * gives. It is never unmounted, only faded, so nothing pops as it goes; `pointer-events-none` once it
       * is out, or it would keep eating the first drag.
       *
       * The frames take over from here: a picture that has not arrived yet is a skeleton, which is what the
       * owner asked to keep — *"and then skeletons whenever the screens are not able to load super fast and
       * need some more time. Like basically like it works already."*
       */}
      <div
        aria-hidden
        className="absolute inset-0 grid place-items-center bg-[hsl(192_12%_13%)]"
        style={{
          opacity: placed ? 0 : 1,
          pointerEvents: placed ? "none" : "auto",
          transition: "opacity 220ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
        data-canvas-launch={placed ? "done" : "placing"}
      >
        <div className="flex flex-col items-center gap-3 animate-pulse motion-reduce:animate-none">
          <div className="h-[3px] w-16 rounded-full bg-white/[0.14]" />
          {launch ? (
            <div className="text-[0.75rem] font-medium tracking-[0.01em] text-white/45">
              {launch}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
});

export { ZOOM_STEP };
