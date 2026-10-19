"use client";

/**
 * design-canvas CORE — the infinite canvas itself.
 *
 * Everything on the canvas is positioned in world coordinates inside one element, and pan and zoom move that
 * element, so an edge can never drift from the frame it points at. Input sets `target`, and a frame loop eases
 * the on-screen `current` towards it; a drag tracks the pointer exactly and only its throw is eased.
 *
 * Text is sized in world pixels and scales with the frames. Two values do not scale, because they are not part of
 * the drawing: the edge stroke (`--canvas-edge-width`) and the comment box (`--canvas-inv-zoom`).
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

/** Zoom bounds. 1 is the declaration's own frame scale, so 1.25 is a page at its real size. The floor is low enough for a grouped
    view of several sections side by side to fit a wide screen. */
const MIN_ZOOM = 0.04;
/* Past 1.25 a captured page is upscaled, and the softness seen would not be in the design. */
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

/**
 * The two values that do not scale with the canvas. The comment box is a control, so it counter-scales by exactly
 * 1/zoom. Edge strokes hold about two screen pixels, capped low because the arrowheads are sized from the stroke.
 */
function writeZoomVars(node: HTMLElement, z: number) {
  node.style.setProperty("--canvas-inv-zoom", String(1 / z));
  node.style.setProperty("--canvas-edge-width", `${Math.min(8, Math.max(2, 2.2 / z))}px`);
}

export type CanvasSurfaceHandle = {
  /** Frame a world box, choosing the zoom that fits it. */
  frame: (box: Box) => void;
  /**
   * Put a world box on screen at a given zoom: centred, or with its top near the top of the viewport.
   * `top` is for landing on one screen, where the name above the frame shows where you have arrived.
   */
  centre: (box: Box, zoom: number, align?: "centre" | "top") => void;
  zoomBy: (factor: number) => void;
  /** What is on screen right now. Read, never written. */
  read: () => Transform;
};

/** World space left above a box landed on with `align: "top"`, so the caption drawn above it stays in view. */
const TOP_LEAD = 150;

export const CanvasSurface = forwardRef<
  CanvasSurfaceHandle,
  {
    /** The world's own bounds, so the surface can frame everything. */
    world: Box;
    /** The box the canvas opens on: the whole world, or a linked section's panel. */
    opening: Box;
    /**
     * Reported when the zoom changes enough to matter, for the readout, and once more when it comes to rest
     * (`settled`), which is when the frames may change picture size. Never per frame.
     */
    onZoom?: (zoom: number, settled: boolean) => void;
    /** True while a tile is taking comment clicks: dragging then would fight the pin. */
    locked?: boolean;
    /**
     * Called once the opening framing has been applied, which the frames' entrance waits on (see `entranceDelay`
     * in `canvas-view.tsx`). Before that the transform is unplaced and the world must not be seen.
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
  const settledAt = useRef(0);
  const [grabbing, setGrabbing] = useState(false);
  /** False until the opening framing has been applied. */
  const [placed, setPlaced] = useState(false);
  /** Drops the loader from the tree once its exit has finished, so nothing is left animating. */
  const [gone, setGone] = useState(false);
  useEffect(() => {
    if (!placed) return;
    const timer = window.setTimeout(() => setGone(true), 460);
    return () => window.clearTimeout(timer);
  }, [placed]);

  const clampZoom = (zoom: number) =>
    Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

  /**
   * The loop writes to the DOM, never to React state, so panning does not re-render a frame. The zoom variables
   * are written only when the zoom changes, and while it moves only on the `data-canvas-zoom-vars` readers: an
   * inherited variable on the world restyles everything inside it. The world gets them once the zoom settles.
   */
  const varsAt = useRef(0);
  const worldVarsAt = useRef(0);
  const paint = useCallback((settled = true) => {
    const node = worldRef.current;
    if (!node) return;
    const { x, y, z } = current.current;
    node.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${z})`;
    /* Any change, not a threshold: these writes are cheap, and a skipped one shows as the comment box resizing. */
    if (z !== varsAt.current) {
      varsAt.current = z;
      node
        .querySelectorAll<HTMLElement>("[data-canvas-zoom-vars]")
        .forEach((reader) => writeZoomVars(reader, z));
    }
    if (settled && Math.abs(z - worldVarsAt.current) > 0.001) {
      worldVarsAt.current = z;
      writeZoomVars(node, z);
    }
    const moved = Math.abs(z - reported.current) / z > 0.02;
    const landed = settled && Math.abs(z - settledAt.current) > 0.001;
    if (moved || landed) {
      reported.current = z;
      if (landed) settledAt.current = z;
      onZoom?.(z, landed);
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
    paint(false);
    raf.current = window.requestAnimationFrame(tick);
  }, [paint]);

  const run = useCallback(() => {
    if (raf.current === 0) raf.current = window.requestAnimationFrame(tick);
  }, [tick]);

  /**
   * The handle is cleared, not just cancelled: `run()` schedules only when it is 0, and a stale number left by
   * an unmount (React mounts twice in development) would stop every eased movement from starting again.
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
        /* `top` lands on the top of the picture and its name: the middle of a tall frame does not show where you are. */
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
   * Fit a box to the viewport, never magnifying it: the `1` in `Math.min` caps a fit at actual size, so a sparse
   * tab lands close in rather than blown up past its own size.
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
      /* Keep the world point under the pointer where it is, so the zoom pulls towards the pointer. */
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

  /* Frames the opening box once, placed rather than animated in. */
  const framedOnce = useRef(false);
  useEffect(() => {
    if (framedOnce.current || opening.w === 0) return;
    framedOnce.current = true;
    frame(opening);
    current.current = { ...target.current };
    paint();
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
      /* A trackpad pinch arrives with ctrlKey set; a mouse zooms with a modifier held. Everything else pans. */
      if (event.ctrlKey || event.metaKey) {
        /* Clamped per event: a mouse wheel notch sends a delta of 120, which uncapped jumps to the zoom limit. */
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
    /* A press on `data-canvas-chrome` returns before `preventDefault()`, which would cost a button or link its
       activation, and starts no pan. */
    if ((event.target as HTMLElement).closest("[data-canvas-chrome]")) return;
    /* Alongside `select-none`: a press on text starts a selection unless the default is prevented. */
    event.preventDefault();
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
    /* A drag moves both transforms, so the canvas tracks the pointer exactly. Easing here would feel like lag. */
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
    /* The throw: the eased loop carries the release's velocity on. */
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
      /* The stage is dark grey, not near-black, so light and dark screenshots both read as sitting on it. A literal,
         not a host project token: the canvas looks the same in every project (see core/design-tokens.md). */
      /* `select-none`: nothing in the world is text to copy, and a pan must not start a text selection. The comment
         box adds `select-text` back for itself. */
      className="absolute inset-0 touch-none select-none overflow-hidden bg-[hsl(192_12%_13%)]"
      style={{ cursor: grabbing ? "grabbing" : "grab" }}
      /* `select-none` does not stop the native image drag, so the world refuses drag starts. */
      onDragStart={(event) => event.preventDefault()}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      data-canvas-surface=""
    >
      {/* No `will-change: transform`: this element spans the whole canvas, and one layer past the maximum texture
          size drops the surface onto a slow path. */}
      {/* The whole world stays hidden until placed. `visibility`, not `opacity`, so the frames' own staggered
          entrance is the only opacity animation in play. */}
      <div
        ref={worldRef}
        className="absolute left-0 top-0 origin-top-left"
        style={{ visibility: placed ? "visible" : "hidden" }}
        data-canvas-world=""
      >
        {children}
      </div>
      {/* The loader, until the world is placed: three equal frame outlines fading in sequence on the frames' own
          60ms rhythm and curve, so the wait and the arrival read as one gesture. */}
      {/* It leaves by blurring and lifting. The blur is affordable here because this element is one viewport and
          leaves the tree after its exit; a blur on the world would not be. */}
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
 * The zoom readout: the real range `MIN_ZOOM` to `MAX_ZOOM` mapped (not clamped) onto 10 to 100, because the raw
 * 6% and 125% mean nothing to a reader. Every step still moves the number.
 */
export function shownZoom(zoom: number): number {
  const at = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
  const through = (at - MIN_ZOOM) / (MAX_ZOOM - MIN_ZOOM);
  return Math.round(10 + through * 90);
}

export { ZOOM_STEP };
