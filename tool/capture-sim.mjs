#!/usr/bin/env node
/**
 * design-canvas — capture from the iOS Simulator, for a project whose real target is a phone. macOS only (it drives
 * `xcrun simctl`); Android is not supported. UNTESTED on a real project: treat its first run as a trial.
 *
 *   node design-canvas/capture-sim.mjs --canvas <slug> --scheme myapp [--only id,id] [--device <udid>] [--settle 2500]
 *
 * A React Native app served to the web renders something adjacent to the app (sheets, safe areas and the keyboard differ), so
 * this photographs the real app in a booted simulator instead. Each screen's `route` is appended to the app's URL scheme (its
 * deep links). Nothing here builds or launches the app: boot the simulator and run the app first.
 *
 * WHAT IT CANNOT PROVE. A screenshot has no DOM, so it cannot check `expect` claims, prove stability by shooting twice, or
 * count broken images. Every frame it writes says so: `backend: "simulator"`, `claimsVerified: false`, and the declared claims
 * as `claimsDeclared`. The manifest entry otherwise has the fields the canvas draws from (`screenId`, `file`, `w`, `h`, `hash`),
 * `w` and `h` in the screen's own viewport units.
 *
 * DELETE WITH: the design-canvas/ folder.
 */
/* execFileSync everywhere, never execSync: no shell, so a declaration's route or a device name cannot become a command. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { screensFor } from "./dump-screens.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const argOf = (name) => {
  const at = argv.indexOf(`--${name}`);
  return at === -1 ? undefined : argv[at + 1];
};
const has = (name) => argv.includes(`--${name}`);

const canvas = argOf("canvas") ?? "main";
if (!/^[a-z0-9][a-z0-9-]*$/.test(canvas)) {
  console.error(`refusing --canvas "${canvas}" — a canvas slug is lowercase letters, digits and dashes only.`);
  process.exit(1);
}
const scheme = argOf("scheme");
const only = (argOf("only") ?? "").split(",").map((one) => one.trim()).filter(Boolean);
const settleMs = Number(argOf("settle") ?? 2500);
const device = argOf("device") ?? "booted";

if (!scheme) {
  console.error("capture-sim needs --scheme <the app's url scheme>, the one its deep links use.");
  process.exit(1);
}

/* A simulator that is not booted is checked first, because every later failure would look like a broken app. */
function bootedDevices() {
  try {
    const out = execFileSync("xcrun", ["simctl", "list", "devices", "booted"], { encoding: "utf8" });
    return out.split("\n").filter((line) => /\(Booted\)/.test(line)).map((line) => line.trim());
  } catch {
    return null;
  }
}

/** A synchronous wait with no shell and no `sleep` binary. */
function wait(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(0, ms));
}

/** A PNG's size, from its header (`IHDR` holds the width and height as big-endian integers at bytes 16 to 24). */
function pngSize(file) {
  const head = readFileSync(file).subarray(0, 24);
  return { w: head.readUInt32BE(16), h: head.readUInt32BE(20) };
}

const booted = bootedDevices();
if (booted === null) {
  console.error("xcrun is not available: this tool needs a Mac with Xcode's command line tools (iOS Simulator only).");
  process.exit(1);
}
if (booted.length === 0) {
  console.error(
    "No booted simulator.\n\n" +
      "Boot one and start the app first; this tool photographs what is already running:\n" +
      "  xcrun simctl boot <device>   # or open Simulator.app\n" +
      "  npm run ios                  # or however this project starts on a device",
  );
  process.exit(1);
}
console.log(`[capture-sim] using: ${booted[0]}`);

let declared;
try {
  declared = (await screensFor(HERE, canvas)).screens;
} catch (error) {
  console.error(`capture-sim: ${error.message}`);
  process.exit(1);
}
/* Explanation frames are text panels with no route, never captured. */
const screens = declared
  .filter((one) => one.route && !one.explain && !one.frozen)
  .filter((one) => only.length === 0 || only.includes(one.id));
if (screens.length === 0) {
  console.error("nothing to capture: no declared screen has a route, or --only matched none of them.");
  process.exit(1);
}

const shotsDir = path.join(HERE, "shots", canvas);
mkdirSync(shotsDir, { recursive: true });
const manifestPath = path.join(shotsDir, "manifest.json");
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : { shots: [] };

/* WebP when `sips` (part of macOS) can write it, PNG when it cannot; the manifest names the file either way. */
function toWebp(pngPath, outPath) {
  try {
    execFileSync("sips", ["-s", "format", "webp", pngPath, "--out", outPath], { stdio: "ignore" });
    return existsSync(outPath);
  } catch {
    return false;
  }
}

const work = mkdtempSync(path.join(tmpdir(), "canvas-sim-"));
const failures = [];
const written = [];

for (const screen of screens) {
  const url = `${scheme}://${String(screen.route).replace(/^\/+/, "")}`;
  const raw = path.join(work, `${screen.id}.png`);
  try {
    execFileSync("xcrun", ["simctl", "openurl", device, url], { stdio: "ignore" });
  } catch {
    failures.push(`${screen.id}: the simulator refused the deep link ${url}`);
    continue;
  }
  /* One settle, not a stability proof: without a DOM there is no way to know the screen arrived. */
  wait(settleMs);
  try {
    execFileSync("xcrun", ["simctl", "io", device, "screenshot", raw], { stdio: "ignore" });
  } catch {
    failures.push(`${screen.id}: screenshot failed`);
    continue;
  }
  if (!existsSync(raw)) {
    failures.push(`${screen.id}: the screenshot did not appear`);
    continue;
  }

  /* Drawn at the device's width in points when the declaration names one (a simulator shoots at 2x or 3x). */
  const png = pngSize(raw);
  const w = screen.deviceViewport?.w ?? png.w;
  const h = Math.round((png.h * w) / png.w);
  const webp = path.join(shotsDir, `${screen.id}.webp`);
  let file;
  if (toWebp(raw, webp)) {
    file = path.basename(webp);
    rmSync(raw, { force: true });
  } else {
    file = `${screen.id}.png`;
    renameSync(raw, path.join(shotsDir, file));
  }
  const bytes = readFileSync(path.join(shotsDir, file));

  const entry = {
    screenId: screen.id,
    url: screen.url,
    file,
    w,
    h,
    wholePage: false,
    bytes: bytes.byteLength,
    capturedAt: new Date().toISOString(),
    hash: createHash("sha256").update(bytes).digest("hex").slice(0, 16),
    /* What this backend cannot check, said in the entry. */
    backend: "simulator",
    device: booted[0],
    claimsVerified: false,
    claimsDeclared: screen.expect ?? [],
    settleMs,
  };
  manifest.shots = [...(manifest.shots ?? []).filter((one) => one.screenId !== screen.id), entry];
  written.push(screen.id);
  console.log(`  ${screen.id} -> ${file}`);
}
rmSync(work, { recursive: true, force: true });

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(`\n[capture-sim] ${written.length} frame(s) written to ${path.relative(process.cwd(), shotsDir)}`);
console.log(
  "Claims were NOT verified: a screenshot has no DOM to read. Each frame records its declared claims\n" +
    "as claimsDeclared with claimsVerified false; check them by eye against the picture.",
);
if (failures.length > 0) {
  console.log(`\n${failures.length} PROBLEM(S):`);
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exit(1);
}
if (has("open")) execFileSync("open", ["-a", "Simulator"]);
