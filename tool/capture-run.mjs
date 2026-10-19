#!/usr/bin/env node
/**
 * design-canvas — capture the whole canvas against a production build, in one command.
 *
 *   node design-canvas/capture-run.mjs --canvas trips                 # changed frames only, the default
 *   node design-canvas/capture-run.mjs --canvas trips --all           # every frame
 *   node design-canvas/capture-run.mjs --canvas trips --reuse         # a build already running on --port
 *
 * A production build is the reliable thing to capture against: `next dev` compiles each route inside the capture's load
 * budget, so a different set of frames comes back blank every run. The build goes into its own folder (`--build-dir`,
 * `.next-canvas` by default, through `CANVAS_BUILD_DIR`) and is served on its own port, so the dev server the reviewer uses
 * keeps `.next` and its port.
 *
 * Its own flags are `--canvas`, `--port`, `--build-dir`, `--build-cmd`, `--serve-cmd` and `--reuse`; every other argument
 * (`--only`, `--all`, `--lanes`, `--storage-state`, `--browser-channel`, `--login-route`, `--no-login-check`...) goes to
 * `capture.mjs` as it is. The exit code is the capture's. `capture.mjs` already re-shoots a held frame alone once.
 *
 * DELETE WITH: the design-canvas/ folder.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { spawnCollected, spawnTracked } from "./browser-lifecycle.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

const OWN_VALUES = ["canvas", "port", "build-dir", "build-cmd", "serve-cmd"];
const argv = process.argv.slice(2);
const argOf = (name) => {
  const at = argv.indexOf(`--${name}`);
  return at === -1 ? null : argv[at + 1];
};
const has = (name) => argv.includes(`--${name}`);
/** Everything that is not one of this file's own flags, for capture.mjs. */
const passOn = argv.filter((one, at) => one !== "--reuse" && !OWN_VALUES.some((name) => one === `--${name}` || argv[at - 1] === `--${name}`));

const canvas = argOf("canvas") ?? "main";
/** Its own port, so the dev server on the usual one is untouched. Moves if that port is occupied. */
let port = Number(argOf("port") ?? 3055);
const buildDir = argOf("build-dir") ?? ".next-canvas";
/**
 * How this project builds and serves itself: Next by default, overridable because the capture only drives a URL.
 *   --build-cmd "npm run build"  --serve-cmd "npm run start -- --port {port}"
 * `{port}` is substituted. Both run with `CANVAS_BUILD_DIR` and `NEXT_PUBLIC_CANVAS_PINS=1` in the environment.
 */
const buildCmd = argOf("build-cmd") ?? "npx next build";
const serveCmd = argOf("serve-cmd") ?? "npx next start --port {port}";
/* Without NEXT_PUBLIC_CANVAS_PINS a build pins nothing, so every frame would photograph the default state. */
const buildEnv = { ...process.env, CANVAS_BUILD_DIR: buildDir, NEXT_PUBLIC_CANVAS_PINS: "1" };

/** Split a command line into what `spawn` wants. Quoted arguments are kept whole. */
function parts(line) {
  return (line.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((one) => one.replace(/^["']|["']$/g, ""));
}
let base = `http://localhost:${port}`;

const started = Date.now();
const since = () => `${((Date.now() - started) / 1000).toFixed(1)}s`;
const say = (line) => console.log(`[capture-run ${since()}] ${line}`);

/** Every phase's wall time, printed at the end. */
const timings = [];
async function phase(name, run) {
  const at = Date.now();
  const value = await run();
  timings.push([name, Date.now() - at]);
  return value;
}

/** Whether something is already answering on the port. */
async function up() {
  try {
    const response = await fetch(`${base}/api/design-canvas/shots?canvas=${canvas}`, { signal: AbortSignal.timeout(2000) });
    return response.ok || response.status === 404;
  } catch {
    return false;
  }
}

let server = null;
/* Stops the server on every way out; a signal reaches here through browser-lifecycle.mjs, which owns SIGINT, SIGTERM and SIGHUP.
   Children run without blocking this process, so a signal reaches them too and each closes its own browser. */
process.on("exit", () => {
  if (server && !server.killed) {
    say("stopping the capture server");
    server.kill("SIGTERM");
  }
});

/* ------------------------------------------------------------------ 1. the build, in its own folder */

/**
 * A server this run did not start is not trusted: it is usually a leftover from a killed run serving a stale bundle. Reuse is
 * explicit (`--reuse`). A busy default port moves the run to a free one; a busy `--port` the caller pinned stops it.
 */
if (!has("reuse") && (await up())) {
  if (has("port")) {
    console.error(
      `capture-run: something is already answering on :${port}, and this run did not start it.\n` +
        "That is usually a leftover server from an earlier run, which would photograph a stale bundle.\n" +
        "Stop it, choose another --port, or pass --reuse if you know that server is the one you want.",
    );
    process.exit(1);
  }
  const taken = port;
  let moved = false;
  for (let candidate = taken + 1; candidate <= taken + 20; candidate += 1) {
    port = candidate;
    base = `http://localhost:${port}`;
    if (!(await up())) {
      moved = true;
      break;
    }
  }
  if (!moved) {
    console.error(`capture-run: :${taken} and the twenty ports above it are all busy.`);
    process.exit(1);
  }
  say(`:${taken} is busy with a server this run did not start, so using :${port} instead`);
}

if (has("reuse")) {
  say(`reusing whatever is already serving ${base}, because --reuse says so`);
} else {
  const code = await phase("build", async () => {
    say(`building into ${buildDir}, and the dev server's build folder is not touched`);
    const [command, ...rest] = parts(buildCmd);
    return spawnTracked(command, rest, { cwd: ROOT, env: buildEnv });
  });
  if (code !== 0) {
    say("the build failed, so there is nothing honest to capture");
    process.exit(code);
  }

  await phase("boot", async () => {
    say(`starting it on :${port}`);
    const [command, ...rest] = parts(serveCmd.replaceAll("{port}", String(port)));
    server = spawn(command, rest, { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"], env: buildEnv });
    for (let wait = 0; wait < 120; wait += 1) {
      if (await up()) return;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    say(`nothing answered on ${base} within a minute`);
    process.exit(1);
  });
}

/* ------------------------------------------------------------------ 2. the capture */

const { status, output } = await phase("capture", async () => {
  say("capturing");
  /* `--no-warm`: a build has already compiled every route. */
  /* Eight lanes against a build, unless the caller said: a production server carries them, a dev server gains nothing past six. */
  const lanes = has("lanes") || process.env.CANVAS_LANES ? [] : ["--lanes", "8"];
  return spawnCollected("node", [path.join(HERE, "capture.mjs"), "--canvas", canvas, "--url", base, "--no-warm", ...lanes, ...passOn], {
    cwd: ROOT,
    env: process.env,
  });
});

/* ------------------------------------------------------------------ 3. what it cost */

say("done");
for (const [name, ms] of timings) console.log(`  ${name.padEnd(10)} ${(ms / 1000).toFixed(1)}s`);
console.log(`  ${"total".padEnd(10)} ${((Date.now() - started) / 1000).toFixed(1)}s`);
/* Exit code 2 is capture.mjs saying it could not start (no browser, no session, a login redirect on the first page). */
if (status === 2) say("the capture could not start, so no screen was tried: the line above names the fix");
else if (status !== 0) say("some screens do not prove their claims: see the problems above");
/* The capture's next steps, repeated last: the timings above would otherwise push them out of the tail a reader looks at. */
const next = status === 0 ? output.split("\n").filter((line) => line.startsWith("next: ")) : [];
if (next.length > 0) console.log(`\n${next.join("\n")}`);
process.exit(status);
