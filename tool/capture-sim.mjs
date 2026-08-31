#!/usr/bin/env node
/**
 * design-canvas — CAPTURE FROM THE iOS SIMULATOR, for a project whose real target is a phone.
 *
 * WHY THIS EXISTS. `capture.mjs` drives a browser, which is right for a web app and wrong for a native
 * one. A React Native project served to Expo web renders something adjacent to the app: bottom sheets
 * behave differently or not at all, safe areas are absent, the keyboard never appears, scroll momentum
 * and haptics do not exist. Canvas frames captured there are pictures of a thing nobody ships, and the
 * sessions that tried it ended up hand-writing "verified on web only" into every report instead.
 *
 * WHAT THIS PROVES, AND WHAT IT CANNOT. It photographs the REAL app on a real simulator, so the picture
 * is honest about layout, safe areas, sheets and keyboard. It cannot read the page, so it cannot check
 * a screen's `expect` claims, cannot prove stability by shooting twice, and cannot count broken images
 * — all three of those live in the DOM that a screenshot does not have. Rather than pretend, every
 * frame it writes is marked `backend: "simulator"` with `claimsVerified: false`, and the declared
 * claims are copied in as `claimsDeclared` so the oracle and the reviewer can both see what was NOT
 * checked. A frame that says it proved nothing is worth more than one that quietly claims it did.
 *
 *   node design-canvas/capture-sim.mjs --canvas <slug> --scheme myapp \
 *     --screens-file /tmp/screens.json [--only id,id] [--device <udid>] [--settle 2500]
 *
 * `--scheme` is the app's URL scheme, the one its deep links already use; each screen's `route` is
 * appended to it. Nothing here launches or builds the app: boot the simulator and run the app first,
 * exactly as a person would, then point this at it.
 *
 * DELETE WITH: the design-canvas/ folder.
 */
/* execFileSync everywhere, never execSync: no shell means a declaration's route or a device name
   cannot become a command, and every argument below comes from a project's own declaration file. */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

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
const screensFile = argOf("screens-file");
const only = (argOf("only") ?? "").split(",").map((one) => one.trim()).filter(Boolean);
const settleMs = Number(argOf("settle") ?? 2500);
const device = argOf("device") ?? "booted";

if (!scheme || !screensFile) {
  console.error(
    "capture-sim needs --scheme <app url scheme> and --screens-file <dump-screens output>.\n" +
      "  node design-canvas/dump-screens.mjs --canvas <slug> > /tmp/screens.json",
  );
  process.exit(1);
}

/* A SIMULATOR THAT IS NOT BOOTED IS THE FIRST THING TO CHECK, because every later failure looks like
   a broken app instead of a missing device. */
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
  const buffer = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(buffer), 0, 0, Math.max(0, ms));
}

const booted = bootedDevices();
if (booted === null) {
  console.error("xcrun is not available — this tool needs Xcode's command line tools and a Mac.");
  process.exit(1);
}
if (booted.length === 0) {
  console.error(
    "No booted simulator.\n\n" +
      "Boot one and start the app first — this tool photographs what is already running, it does not\n" +
      "build or launch anything:\n" +
      "  xcrun simctl boot <device>   # or open Simulator.app\n" +
      "  npm run ios                  # or however this project starts on a device",
  );
  process.exit(1);
}
console.log(`[capture-sim] using: ${booted[0]}`);

const parsed = JSON.parse(readFileSync(screensFile, "utf8"));
const declared = parsed.screens ?? parsed;
/* Explanation frames are text panels with no route — never captured, here or in the browser path. */
const screens = declared
  .filter((one) => one.route && !one.explain && !one.frozen)
  .filter((one) => (only.length === 0 ? true : only.includes(one.id)));

if (screens.length === 0) {
  console.error("nothing to capture: no declared screen has a route, or --only matched none of them.");
  process.exit(1);
}

const shotsDir = path.join("design-canvas", "shots", canvas);
mkdirSync(shotsDir, { recursive: true });
const manifestPath = path.join(shotsDir, "manifest.json");
const manifest = existsSync(manifestPath)
  ? JSON.parse(readFileSync(manifestPath, "utf8"))
  : { shots: [] };

/* WebP if the machine can, PNG if it cannot. `sips` ships with macOS, so this needs no dependency;
   a project that would rather have smaller frames can convert them later. The manifest records which
   one was written, so nothing downstream has to guess at the extension. */
function toWebp(pngPath, outPath) {
  try {
    execFileSync("sips", ["-s", "format", "webp", pngPath, "--out", outPath], { stdio: "ignore" });
    return existsSync(outPath);
  } catch {
    return false;
  }
}

const work = tmpdir();
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
  /* One settle, not a stability proof. Without the DOM there is no way to know the screen arrived, so
     this waits and says so, rather than shooting twice and calling agreement proof. */
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

  const webp = path.join(shotsDir, `${screen.id}.webp`);
  const png = path.join(shotsDir, `${screen.id}.png`);
  let file;
  if (toWebp(raw, webp)) {
    file = path.basename(webp);
    rmSync(raw, { force: true });
  } else {
    renameSync(raw, png);
    file = path.basename(png);
  }

  const entry = {
    id: screen.id,
    file,
    label: screen.label ?? screen.id,
    route: screen.route,
    state: screen.state ?? null,
    capturedAt: new Date().toISOString(),
    /* THE HONEST PART. This backend photographs a real device and reads nothing, so it says both. */
    backend: "simulator",
    device: booted[0],
    claimsVerified: false,
    claimsDeclared: screen.expect ?? [],
    settleMs,
  };
  manifest.shots = [...(manifest.shots ?? []).filter((one) => one.id !== screen.id), entry];
  written.push(screen.id);
  console.log(`  ${screen.id} -> ${file}`);
}

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 1)}\n`, "utf8");

console.log(`\n[capture-sim] ${written.length} frame(s) written to ${shotsDir}`);
console.log(
  "Claims were NOT verified: a screenshot has no DOM to read. Each frame records its declared claims\n" +
    "as claimsDeclared with claimsVerified false — check them by eye against the picture, which is the\n" +
    "only thing that can check them here.",
);
if (failures.length > 0) {
  console.log(`\n${failures.length} PROBLEM(S):`);
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exit(1);
}
if (has("open")) execFileSync("open", ["-a", "Simulator"]);
