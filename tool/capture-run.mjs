#!/usr/bin/env node
/**
 * design-canvas — CAPTURE THE WHOLE CANVAS, PROPERLY, IN ONE COMMAND.
 *
 * WHY THIS EXISTS. SKILL.md has always said to capture against a production build, and stated the measurement:
 * 2.4s a screen and repeatable against a build, versus a lottery against `next dev`, where the route compile lands
 * inside each screen's own load budget and a different set of frames comes back blank every run. It was ignored
 * anyway — including by me, for a whole session — because the procedure was four commands and the build would
 * clobber the dev server the designer reviews on. The owner, after watching frames get re-shot one at a time:
 * *"capture speed might be slightly better now, but overall it still takes way too long, like tens of minutes to
 * hours depending on images."*
 *
 * A four-step procedure that is easy to skip is a procedure that gets skipped. So this is the one command, and it
 * removes the reason to skip it: `CANVAS_BUILD_DIR` gives the build its own folder and `--port` its own port, so
 * the review server keeps `.next` and its own port and never notices.
 *
 *   node design-canvas/capture-run.mjs --canvas checkout
 *   node design-canvas/capture-run.mjs --canvas checkout --changed      # the default; --all overrides
 *   node design-canvas/capture-run.mjs --canvas checkout --reuse        # a build already running on --port
 *
 * IT ALSO RETRIES WHAT FLAKED. `capture.mjs` already re-shoots a screen alone once; anything still failing after
 * that used to come back as text for a human to read and re-run by hand, one `--only` at a time. That loop is the
 * other half of "way too long", and it is mechanical, so it lives here.
 *
 * DELETE WITH: the design-canvas/ folder.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

const argv = process.argv.slice(2);
const argOf = (name) => {
  const at = argv.indexOf(`--${name}`);
  return at === -1 ? null : argv[at + 1];
};
const has = (name) => argv.includes(`--${name}`);

const canvas = argOf("canvas") ?? "main";
/** Its own port, so the dev server on the usual one is untouched. */
const port = Number(argOf("port") ?? 3055);
/** Its own build folder, for the same reason. See `distDir` in the project's next config. */
const buildDir = argOf("build-dir") ?? ".next-canvas";
/** How many times a screen that keeps failing is given another run of its own. */
const rounds = Number(argOf("retries") ?? 2);
/**
 * HOW THIS PROJECT BUILDS AND SERVES ITSELF. Next by default, because that is what the tool was written
 * against, and overridable because nothing else here assumes a framework: the capture drives a URL through
 * Playwright and does not care what produced it.
 *
 *   --build-cmd "npm run build"  --serve-cmd "npm run start -- --port {port}"
 *
 * `{port}` is substituted in the serve command. Both commands run with `CANVAS_BUILD_DIR` and
 * `NEXT_PUBLIC_CANVAS_PINS=1` in the environment; a non-Next project can ignore the second and use the first
 * however it likes, or ignore both and simply build the way it always does.
 */
const buildCmd = argOf("build-cmd") ?? "npx next build";
const serveCmd = argOf("serve-cmd") ?? "npx next start --port {port}";

/** Split a command line into what `spawn` wants. Quoted arguments are kept whole. */
function parts(line) {
  return (line.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((one) =>
    one.replace(/^["']|["']$/g, ""),
  );
}
const base = `http://localhost:${port}`;

const started = Date.now();
const since = () => `${((Date.now() - started) / 1000).toFixed(1)}s`;
const say = (line) => console.log(`[capture-run ${since()}] ${line}`);

/** Every phase's wall time, printed at the end: "it takes too long" cannot be acted on without numbers. */
const timings = [];
async function phase(name, run) {
  const at = Date.now();
  const value = await run();
  timings.push([name, Date.now() - at]);
  return value;
}

function run(command, args, extraEnv = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
  });
  return result.status ?? 1;
}

/** Whether something is already answering on the port. */
async function up() {
  try {
    const response = await fetch(`${base}/api/design-canvas/shots?canvas=${canvas}`, {
      signal: AbortSignal.timeout(2000),
    });
    return response.ok || response.status === 404;
  } catch {
    return false;
  }
}

let server = null;
let workDir = null;

function stop() {
  if (server && !server.killed) {
    say("stopping the capture server");
    server.kill("SIGTERM");
  }
  if (workDir) rmSync(workDir, { recursive: true, force: true });
}
process.on("exit", stop);
process.on("SIGINT", () => {
  stop();
  process.exit(130);
});

/* ------------------------------------------------------------------ 1. the build, in its own folder */

if (has("reuse") || (await up())) {
  say(`reusing whatever is already serving ${base}`);
} else {
  const code = await phase("build", async () => {
    say(`building into ${buildDir} — the dev server's build folder is not touched`);
    const [command, ...rest] = parts(buildCmd);
    return run(command, rest, {
      CANVAS_BUILD_DIR: buildDir,
      /* A build pins nothing without this, so every frame would photograph the default state and claim otherwise.
         The project may already hardcode it; setting it here means the run does not depend on that. */
      NEXT_PUBLIC_CANVAS_PINS: "1",
    });
  });
  if (code !== 0) {
    say("the build failed, so there is nothing honest to capture");
    process.exit(code);
  }

  await phase("boot", async () => {
    say(`starting it on :${port}`);
    const [command, ...rest] = parts(serveCmd.replaceAll("{port}", String(port)));
    server = spawn(command, rest, {
      cwd: ROOT,
      stdio: ["ignore", "ignore", "inherit"],
      env: { ...process.env, CANVAS_BUILD_DIR: buildDir, NEXT_PUBLIC_CANVAS_PINS: "1" },
    });
    for (let wait = 0; wait < 120; wait += 1) {
      if (await up()) return;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    say(`nothing answered on ${base} within a minute`);
    process.exit(1);
  });
}

/* ------------------------------------------------------------------ 2. the screens, dumped once */

workDir = mkdtempSync(path.join(tmpdir(), "design-canvas-"));
const screensFile = path.join(workDir, `${canvas}.json`);

await phase("dump", async () => {
  say("dumping the declaration");
  const dump = spawnSync("node", [path.join(HERE, "dump-screens.mjs"), "--canvas", canvas], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (dump.status !== 0) {
    process.stderr.write(dump.stderr ?? "");
    say("could not read the declaration");
    process.exit(1);
  }
  writeFileSync(screensFile, dump.stdout, "utf8");
});

/* ------------------------------------------------------------------ 3. capture, then re-run only what failed */

const captureArgs = (only) => [
  path.join(HERE, "capture.mjs"),
  "--canvas",
  canvas,
  "--url",
  base,
  "--screens-file",
  screensFile,
  /* Nothing to warm: a build has already compiled every route. */
  "--no-warm",
  ...(only ? ["--only", only.join(",")] : has("all") ? ["--all"] : []),
];

/** Screen ids named in capture.mjs's own problem lines, which are the only thing worth re-running. */
function failedFrom(output) {
  const ids = new Set();
  for (const line of output.split("\n")) {
    const match = /^\s+- ([a-zA-Z0-9_-]+):/.exec(line);
    if (match) ids.add(match[1]);
  }
  return [...ids];
}

let outstanding = null;
let lastCode = 0;
for (let round = 0; round <= rounds; round += 1) {
  const label = round === 0 ? "capture" : `retry ${round}`;
  const output = await phase(label, async () => {
    say(round === 0 ? "capturing" : `re-running ${outstanding.length} screen(s) that failed`);
    const result = spawnSync("node", captureArgs(outstanding), {
      cwd: ROOT,
      encoding: "utf8",
      env: process.env,
    });
    process.stdout.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    lastCode = result.status ?? 1;
    return `${result.stdout ?? ""}${result.stderr ?? ""}`;
  });
  if (lastCode === 0) break;
  const failed = failedFrom(output);
  if (failed.length === 0) break;
  /* No progress: the same screens failed again, so they are broken rather than flaky and a human has to look. */
  if (outstanding && failed.length >= outstanding.length && round === rounds) break;
  outstanding = failed;
}

/* ------------------------------------------------------------------ 4. what it cost */

say("done");
for (const [name, ms] of timings)
  console.log(`  ${name.padEnd(10)} ${(ms / 1000).toFixed(1)}s`);
console.log(`  ${"total".padEnd(10)} ${((Date.now() - started) / 1000).toFixed(1)}s`);
if (lastCode !== 0)
  say("some screens still do not prove their claims — see the problems above");
process.exit(lastCode);
