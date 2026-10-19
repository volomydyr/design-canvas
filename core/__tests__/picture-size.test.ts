/**
 * Which picture a frame draws. The small copy is only ever drawn when it has at least as many pixels across as
 * the frame takes up on screen, so zooming out never makes a frame blurrier than the full capture would.
 */
import { describe, expect, it } from "vitest";

import { drawsSmall, zoomStep } from "../picture-size";

describe("zoomStep", () => {
  it("rounds the zoom up to a power of two", () => {
    expect(zoomStep(0.06)).toBe(0.0625);
    expect(zoomStep(0.0625)).toBe(0.0625);
    expect(zoomStep(0.07)).toBe(0.125);
    expect(zoomStep(0.3)).toBe(0.5);
    expect(zoomStep(1)).toBe(1);
    expect(zoomStep(1.25)).toBe(2);
  });

  it("never returns zero or less, whatever it is given", () => {
    expect(zoomStep(0)).toBeGreaterThan(0);
    expect(zoomStep(-1)).toBeGreaterThan(0);
  });

  it("only changes at a few points across the whole zoom range", () => {
    const steps = new Set<number>();
    for (let z = 0.06; z <= 1.25; z += 0.001) steps.add(zoomStep(z));
    expect(steps.size).toBeLessThanOrEqual(6);
  });
});

describe("drawsSmall", () => {
  const desktop = { w: 360 };
  /* A 1440px capture drawn at frame scale 0.8 is 1152 world pixels wide. */
  const frameW = 1152;

  it("uses the copy while it has enough pixels for the frame on screen", () => {
    expect(drawsSmall(desktop, frameW, 0.0625, 1)).toBe(true);
    expect(drawsSmall(desktop, frameW, 0.25, 1)).toBe(true);
    expect(drawsSmall(desktop, frameW, 0.125, 2)).toBe(true);
  });

  it("switches to the full capture before the copy would be stretched", () => {
    expect(drawsSmall(desktop, frameW, 0.5, 1)).toBe(false);
    expect(drawsSmall(desktop, frameW, 0.25, 2)).toBe(false);
    expect(drawsSmall(desktop, frameW, 1, 1)).toBe(false);
  });

  it("counts device pixels, so a sharper screen switches sooner", () => {
    expect(drawsSmall(desktop, frameW, 0.25, 1)).toBe(true);
    expect(drawsSmall(desktop, frameW, 0.25, 2)).toBe(false);
  });

  it("is exact at the boundary", () => {
    expect(drawsSmall({ w: 100 }, 400, 0.25, 1)).toBe(true);
    expect(drawsSmall({ w: 99 }, 400, 0.25, 1)).toBe(false);
  });

  it("draws the full capture when there is no copy", () => {
    expect(drawsSmall(undefined, frameW, 0.0625, 1)).toBe(false);
    expect(drawsSmall({ w: 0 }, frameW, 0.0625, 1)).toBe(false);
  });
});
