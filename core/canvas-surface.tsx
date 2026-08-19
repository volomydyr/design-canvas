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
  /**
   * Put a world box on screen at a given zoom: centred, or with its top near the top of the viewport.
   *
   * `top` is for landing on ONE screen — a jump between devices, a step to a comment — where the name above the
   * frame is part of knowing where you have arrived.
   */
  centre: (box: Box, zoom: number, align?: "centre" | "top") => void;
  zoomBy: (factor: number) => void;
  /** What is on screen right now. Read, never written. */
  read: () => Transform;
};

/**
 * How much world space is left above a box that is landed on with `align: "top"`.
 *
 * A frame's caption sits above it in world units (`CAPTION_SPACE` is 90 in the layout), so landing the box's own
 * top at the very top of the screen would push the name out of view — which is the one thing the owner asked to
 * be able to see when he lands.
 */
const TOP_LEAD = 150;

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
     * REPORTED THE MOMENT THE WORLD HAS BEEN PLACED, which is what the frames' entrance waits on.
     *
     * The transform starts at the world's top-left corner at half scale and the opening framing runs in an
     * effect — after the first paint. So opening a canvas showed one frame of the first screenshot, blown up in
     * the corner, and then jumped: *"for a fraction of a second, it keeps me super zoomed in to, I think one of
     * the or even the first image on the canvas, which just looks weird."*
     *
     * TWO LOADING GRAPHICS WERE TRIED HERE AND BOTH WERE REJECTED — a bar with the canvas's name, then three
     * pulsing rectangles: *"the loading visual looks like some weird bar chart. also it should not show the name
     * of the canvas."* What replaced them is not a third graphic. The surface reports; the frames arrive in the
     * order the diagram reads, which is the one thing this wait genuinely is. See `entranceDelay` in
     * `canvas-view.tsx`.
     */
    onPlaced?: () => void;
    children: ReactNode;
  }
>(function CanvasSurface(
  { world, opening, onZoom, locked = false, onPlaced, children },
  ref,
) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<HTMLDivElement | null>(null);
  const target = useRef<Transform>({ x: 0, y: 0, z: 0.5 });
  const current = useRef<Transform>({ x: 0, y: 0, z: 0.5 });
  const raf = useRef(0);
  const reported = useRef(0.5);
  const [grabbing, setGrabbing] = useState(false);
  /** False until the opening framing has been applied. Nothing in the world may be seen before that. */
  const [placed, setPlaced] = useState(false);
  /** And this drops the loader out of the tree once its exit has finished, so nothing is left animating. */
  const [gone, setGone] = useState(false);
  useEffect(() => {
    if (!placed) return;
    const timer = window.setTimeout(() => setGone(true), 460);
    return () => window.clearTimeout(timer);
  }, [placed]);

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
    (box: Box, zoom: number, align: "centre" | "top" = "centre") => {
      const { w, h } = viewport();
      const z = clampZoom(zoom);
      target.current = {
        z,
        x: w / 2 - (box.x + box.w / 2) * z,
        /**
         * `top` PUTS THE BOX'S TOP NEAR THE TOP OF THE SCREEN, with room above it for the caption.
         *
         * Landing on the middle of a tall frame is disorienting: the owner, on the jump between devices, *"I get
         * to the center of the screenshot when in reality I should get to the top of it. So I could see the top
         * of the screenshot and the name of the screenshot. Then it will make more sense than just seeing the
         * very center of the screenshot, which confuses a bit because you can't understand like what is
         * happening, why did I get moved somewhere in a random place."*
         *
         * `TOP_LEAD` is world space above the box, which is where the caption is drawn, plus air.
         */
        y:
          align === "top"
            ? TOP_LEAD * z - box.y * z
            : h / 2 - (box.y + box.h / 2) * z,
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
   * WHERE IT OPENS, which is wherever the caller says — and since the launch state made that moment visible,
   * the caller says the whole world. The owner: *"when the loading finishes, the canvas has to fit the screen
   * instead of zooming into the first screenshot."* This code does not care which box it is: it frames what it
   * is handed, once, and `frame` never magnifies.
   */
  const framedOnce = useRef(false);
  useEffect(() => {
    if (framedOnce.current || opening.w === 0) return;
    framedOnce.current = true;
    frame(opening);
    /* Placed, not animated in: an entrance from nowhere would be motion for its own sake. */
    current.current = { ...target.current };
    paint();
    /* Only now is the world pointing anywhere worth looking at, so only now may anything be seen. */
    setPlaced(true);
    onPlaced?.();
  }, [opening, frame, paint, onPlaced]);

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
      {/**
       * THE WHOLE WORLD WAITS, not just the frames in it.
       *
       * Hiding the frames alone left the group headings and their panels drawn at the unplaced transform, which is
       * the world's top-left corner at half scale: a section title rendered at 132 world pixels filled the screen
       * for the second it took the manifest to arrive. The owner photographed it — a giant "Teaching slides" over
       * an empty stage — *"that's how the canvas looks like now for about a second… and only after that it shows
       * the intended animation you built."*
       *
       * `visibility` rather than `opacity`, so the frames' own staggered entrance is the only opacity animation in
       * play and the two cannot fight over the same property.
       */}
      <div
        ref={worldRef}
        className="absolute left-0 top-0 origin-top-left"
        style={{ visibility: placed ? "visible" : "hidden" }}
        data-canvas-world=""
      >
        {children}
      </div>
      {/**
       * THE LOADER, for the second before the world can be shown.
       *
       * The manifest has to arrive before anything can be laid out, and until then there is genuinely nothing to
       * draw. Two graphics were rejected here — a bar over the canvas's name, then three rectangles of different
       * heights, which read as a chart — so this one is built from the thing the owner did choose: the arrival.
       * Three EQUAL frame outlines fading in sequence, on the same 60ms rhythm and the same curve the frames
       * themselves use a moment later, so the wait and the arrival are one gesture rather than two ideas.
       *
       * Outlines rather than fills, in the frames' own edge colour: what is coming is frames, and a filled block
       * is what made the last attempt read as a chart. No text, on his instruction.
       */}
      {/**
       * IT LEAVES BY BLURRING AND LIFTING, rather than by being removed.
       *
       * The owner, on the moment the loader becomes the canvas: *"maybe there could be like a nice blur out or I
       * don't know blur out and maybe a slight scale effect… just to make it feel more premium if it doesn't of
       * course impact the performance of the canvas too much."*
       *
       * IT DOES NOT COST THE CANVAS ANYTHING, and that is the reason it is allowed here of all places: this
       * element is 1 by 1 viewport, it exists only before the world is shown, and it is gone from the tree 420ms
       * after that. A blur on the world itself would be the opposite trade — tens of thousands of pixels each way,
       * on a surface that is about to be panned.
       */}
      {gone ? null : (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 grid place-items-center"
          style={{
            opacity: placed ? 0 : 1,
            filter: placed ? "blur(14px)" : "blur(0px)",
            transform: placed ? "scale(1.06)" : "scale(1)",
            transition:
              "opacity 380ms cubic-bezier(0.16, 1, 0.3, 1), filter 380ms cubic-bezier(0.16, 1, 0.3, 1), transform 420ms cubic-bezier(0.16, 1, 0.3, 1)",
          }}
          data-canvas-loading={placed ? "leaving" : "waiting"}
        >
          <div className="flex items-center gap-4">
            {[0, 1, 2].map((at) => (
              <span
                key={at}
                /* A size up, on the owner's note: at 64x44 the three of them read as a detail rather than as the
                   thing the screen is currently about. */
                className="h-[68px] w-[100px] rounded-[6px] ring-1 ring-white/[0.14] motion-reduce:animate-none"
                style={{
                  animation: `canvas-arrive 1200ms cubic-bezier(0.16, 1, 0.3, 1) ${at * 60}ms infinite`,
                }}
              />
            ))}
          </div>
          <style>{`@keyframes canvas-arrive{0%,100%{opacity:.25}45%{opacity:1}}`}</style>
        </div>
      )}
    </div>
  );
});

/**
 * WHAT THE ZOOM READS AS, which is not the same as what it is.
 *
 * The real range is 0.06 to 1.25 — a fit of a wide canvas is 6%, and the surface allows a little past 1:1 so a
 * frame can be inspected — and printing that raw gave a readout that ran from 6% to 125%. Neither end means
 * anything to a reader: 6% is not "six percent of" something they chose, and 125% invites the question of what
 * the other 25% is. The owner asked for the representation to be fixed rather than the behaviour: *"ensure that
 * the minimal percentage is always 10% and the biggest is always 100% (i.e., I'm not saying to change the
 * functionality of zooming, but rather change the way it represents in the UI, so these numbers feel a bit
 * nicer)."*
 *
 * So the scale is mapped, not clamped: the whole real range spans 10 to 100, every step still moves the number,
 * and the ends are exact.
 */
export function shownZoom(zoom: number): number {
  const at = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
  const through = (at - MIN_ZOOM) / (MAX_ZOOM - MIN_ZOOM);
  return Math.round(10 + through * 90);
}

export { ZOOM_STEP };
