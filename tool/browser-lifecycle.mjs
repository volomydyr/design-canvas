/**
 * design-canvas — A BROWSER THIS TOOL OPENS IS A BROWSER THIS TOOL CLOSES, however the run ends.
 *
 * WHY THIS EXISTS. Leftover browsers from killed runs pile up and keep the dev server's memory high while their pages
 * stay open. Measured here, in the same Playwright the tools use: a run killed with SIGKILL leaves the
 * bundled Chromium to exit on its own (its pipe to the tool closes), but leaves REAL CHROME (`browserChannel: "chrome"`, which an
 * app with video needs) running for good, orphaned, with its renderers. Playwright's own signal handlers do not help: a tool
 * blocked in `spawnSync` never runs them (the round and the capture run were exactly that), and SIGKILL runs nothing at all.
 *
 * The rule for the whole tool is that it serves the reviewer and the reviewer never has to remember a mechanic. Looking for
 * leftover browsers and killing them by hand is a mechanic, so the tools do it, in four layers, each one catching what the layer
 * above it cannot:
 *
 *   1. A `finally` (the tools' own) closes the browser the ordinary way, with a cap, and then kills whatever is left of its
 *      process group. `closeBrowser` and `withBrowser` are that step.
 *   2. An `exit` hook kills every tracked browser's whole process group, synchronously. It runs on a normal end, on
 *      `process.exit` inside a guard, and on an uncaught error.
 *   3. SIGINT, SIGTERM and SIGHUP handlers (Playwright's are switched off so there is exactly one owner) do the same, forward the
 *      signal to the child tools a round started, wait for them, and exit with the conventional 128 + n.
 *   4. A WATCHDOG, a detached `sh` that outlives the tool, for the one thing no handler can see: the tool being SIGKILLed. It
 *      polls once a second and kills the browser's process group the moment the tool (or the round that started the tool) is gone.
 *      It checks the group leader still looks like the browser before it kills anything, so a recycled pid is never hit.
 *
 * A browser is found by what Playwright does, not by a guess about Chrome: it launches the browser as a DIRECT CHILD in its own
 * process group, with `--remote-debugging-pipe`. The children of this process before and after the launch are compared, and the
 * new group leader with that flag is the browser. Windows has no `ps`, so there the tools keep Playwright's own behavior and layer 1.
 *
 * DELETE WITH: the design-canvas/ folder.
 */
import { execFileSync, spawn } from "node:child_process";
import { readdirSync, rmSync, rmdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** What Playwright passes every Chromium it launches over a pipe. A process with it, leading its own group, is the browser. */
export const BROWSER_MARK = "--remote-debugging-pipe";
/** The profile folder Playwright makes for a browser it launched: removed after a hard kill, and never anything else. */
const PROFILE = /[/\\]playwright_chromiumdev_profile-[A-Za-z0-9]+$/;

/**
 * THE WATCHDOG, as the `sh` that runs it. Arguments: the browser's process group, its profile folder (or ""), then every pid
 * whose death means the browser must go (the tool itself, and the round that started it). A zombie counts as dead: `kill -0`
 * succeeds on one, which is exactly the state a SIGKILLed tool is in until somebody reaps it. The third argument is the colon-joined
 * list of Playwright's artifacts folders for this browser, removed when empty (`rmdir` never removes anything that holds a file).
 */
export const WATCHDOG = `g="$1"; d="$2"; arts="$3"; shift 3
while :; do
  for p in "$@"; do
    s="$(ps -o state= -p "$p" 2>/dev/null)"
    case "$s" in ""|Z*) break 2 ;; esac
  done
  ps -o command= -p "$g" 2>/dev/null | grep -q -e '${BROWSER_MARK}' || exit 0
  sleep 1
done
kill -9 -- "-$g" 2>/dev/null
case "$d" in */playwright_chromiumdev_profile-*) sleep 1; rm -rf -- "$d" ;; esac
IFS=:
for a in $arts; do case "$a" in */playwright-artifacts-*) rmdir -- "$a" 2>/dev/null ;; esac; done
exit 0
`;

/** Every browser (or browser-like process) this process is responsible for, by the pid of its group leader. */
const tracked = new Map();
/** Child tools started through `spawnTracked`, so a signal can be passed on and waited for. */
const children = new Set();
/** Browser object to the entry that tracks it. */
const byBrowser = new WeakMap();
let hooked = false;
let shuttingDown = false;
/** The code a signal asked this process to end with, for the moment the last child tool has gone. */
let exitCode = null;

/* ------------------------------------------------------------------ finding the browser */

/** `ps -axo pid=,ppid=,pgid=,command=` as records. Exported so the parsing is tested without a process table. */
export function parsePs(text) {
  const out = [];
  for (const line of String(text).split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (match) out.push({ pid: Number(match[1]), ppid: Number(match[2]), pgid: Number(match[3]), command: match[4] });
  }
  return out;
}

/** The process table, or null where there is none to read (Windows, a sandbox without `ps`). */
function snapshot() {
  if (process.platform === "win32") return null;
  try {
    return parsePs(execFileSync("ps", ["-axo", "pid=,ppid=,pgid=,command="], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] }));
  } catch {
    return null;
  }
}

/**
 * The browsers a launch added: direct children of `parent` that lead their own process group, carry the pipe flag, and were not
 * children before. Playwright launches the browser exactly like that, and a child the tool started for another reason does not.
 */
export function pickBrowsers(processes, { parent, before = new Set() }) {
  return processes.filter((one) => one.ppid === parent && one.pgid === one.pid && !before.has(one.pid) && one.command.includes(BROWSER_MARK));
}

/** Does this pid still look like the browser it was when it was tracked? Checked before anything is killed. */
function stillOurs(pid) {
  try {
    const command = execFileSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return command.includes(BROWSER_MARK);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ the owners a watchdog waits on */

/** This process, and the tool that started it when that tool said so (`CANVAS_OWNER_PID`, set by round.mjs and capture-run.mjs). */
export function ownersOf(env = process.env, self = process.pid) {
  const owners = [self];
  const named = Number(env.CANVAS_OWNER_PID);
  if (Number.isInteger(named) && named > 1 && named !== self) owners.push(named);
  return owners;
}

/** The environment a child tool runs in: it knows who started it, so a killed round takes its capture's browser with it. */
export function childEnv(env = process.env) {
  return { ...env, CANVAS_OWNER_PID: String(process.pid) };
}

/* ------------------------------------------------------------------ tracking and killing */

function startWatchdog(entry) {
  if (process.platform === "win32") return null;
  try {
    const child = spawn("/bin/sh", ["-c", WATCHDOG, "canvas-watchdog", String(entry.pid), entry.dir ?? "", entry.artifacts.join(":"), ...ownersOf().map(String)], { detached: true, stdio: "ignore" });
    child.on("error", () => undefined);
    child.unref();
    return child;
  } catch {
    return null;
  }
}

/** The profile folder out of the browser's command line, when it is Playwright's own under the temp folder. */
function profileOf(command) {
  const found = /--user-data-dir=(\S+)/.exec(command ?? "");
  return found && PROFILE.test(found[1]) && path.resolve(found[1]).startsWith(path.resolve(os.tmpdir())) ? found[1] : null;
}

/**
 * Track a process that leads its own group and kill the whole group if this tool goes. A browser is tracked through
 * `launchTracked`; this is the lower level, exported so the mechanism is tested with a stand-in browser and no Playwright.
 */
export function trackPid(pid, { who = "design-canvas", command = "", artifacts = [] } = {}) {
  hook();
  const entry = { pid, who, dir: profileOf(command), artifacts, watchdog: null, done: false };
  entry.watchdog = startWatchdog(entry);
  tracked.set(pid, entry);
  return entry;
}

function release(entry) {
  if (entry.done) return;
  entry.done = true;
  try {
    entry.watchdog?.kill("SIGKILL");
  } catch {
    /* The watchdog may already have finished. */
  }
  tracked.delete(entry.pid);
}

/** Kill the entry's whole group, only if its leader still looks like the browser, then forget it. Synchronous: it runs at exit. */
function killEntry(entry) {
  if (entry.done) return;
  if (stillOurs(entry.pid)) {
    try {
      process.kill(-entry.pid, "SIGKILL");
    } catch {
      /* Gone between the check and the kill. */
    }
    if (entry.dir) {
      try {
        rmSync(entry.dir, { recursive: true, force: true });
      } catch {
        /* A profile folder that will not go is the temp folder's to clear. */
      }
    }
    /* The empty artifacts folder Playwright made for this browser, which it removes itself on an ordinary close. `rmdir` only
       removes an empty one, so nothing it holds can be lost. */
    for (const dir of entry.artifacts) {
      try {
        rmdirSync(dir);
      } catch {
        /* Not empty, or already gone. */
      }
    }
  }
  release(entry);
}

/** Kill every tracked browser's process group. Synchronous, idempotent, and safe to call from an exit handler. */
export function killTracked() {
  for (const entry of [...tracked.values()]) killEntry(entry);
}

/** How many browsers are tracked now. For the tests, and for a tool that wants to say it left none behind. */
export const trackedCount = () => tracked.size;

function hook() {
  if (hooked) return;
  hooked = true;
  process.on("exit", () => killTracked());
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => onSignal(signal));
}

/**
 * A SIGNAL ENDS THE RUN, and ends it clean: the browsers go first, the child tools are told the same thing and waited for (they
 * close their own), and the exit code is the conventional 128 + the signal, which is what a shell reports for a killed job.
 */
function onSignal(signal) {
  const code = 128 + (os.constants.signals[signal] ?? 15);
  killTracked();
  if (shuttingDown) return;
  shuttingDown = true;
  if (children.size === 0) process.exit(code);
  for (const child of children) {
    try {
      child.kill(signal);
    } catch {
      /* Already gone. */
    }
  }
  /* A child that ignores the signal is killed after five seconds: the run was asked to stop. */
  setTimeout(() => {
    for (const child of children) {
      try {
        child.kill("SIGKILL");
      } catch {
        /* Already gone. */
      }
    }
    process.exit(code);
  }, 5000);
  exitCode = code;
}

/** The folders Playwright keeps a browser's downloads and traces in, under the temp folder. */
function artifactFolders() {
  try {
    return readdirSync(os.tmpdir())
      .filter((name) => name.startsWith("playwright-artifacts-"))
      .map((name) => path.join(os.tmpdir(), name));
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ launching and closing */

/**
 * Launch a browser the tool can always account for. `options` are Playwright's launch options; the signal handlers are taken
 * over (Playwright's would leave a tool alive after SIGTERM with its browser already closed under it).
 */
export async function launchTracked(chromium, options = {}, { who = "design-canvas" } = {}) {
  hook();
  const before = new Set((snapshot() ?? []).filter((one) => one.ppid === process.pid).map((one) => one.pid));
  const artifactsBefore = artifactFolders();
  const browser = await chromium.launch({ ...options, handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false });
  const now = snapshot();
  if (now) {
    const found = pickBrowsers(now, { parent: process.pid, before })[0];
    if (found) {
      const artifacts = artifactFolders().filter((dir) => !artifactsBefore.includes(dir));
      byBrowser.set(browser, trackPid(found.pid, { who, command: found.command, artifacts }));
    }
  }
  return browser;
}

/**
 * Close a browser the ordinary way, with a cap on how long that may take, and then kill whatever is left of its process group.
 * Safe to call twice and on a browser that never tracked. A failed close is not an error: the group kill is the answer to it.
 */
export async function closeBrowser(browser, { capMs = 8000 } = {}) {
  if (!browser) return;
  const entry = byBrowser.get(browser);
  let timer;
  try {
    await Promise.race([browser.close(), new Promise((resolve) => (timer = setTimeout(resolve, capMs)))]);
  } catch {
    /* Already closed, or crashed: the kill below finishes the job. */
  } finally {
    clearTimeout(timer);
  }
  if (entry) killEntry(entry);
}

/**
 * A browser for the length of one function, and never longer: closed in a `finally`, whatever the function does. `timeoutMs` is a
 * ceiling for a short job nobody watches (a contact sheet): past it the function is abandoned, the browser is closed and killed,
 * and the caller gets an error naming the ceiling.
 */
export async function withBrowser(chromium, options, run, { who, timeoutMs, capMs } = {}) {
  const browser = await launchTracked(chromium, options, { who });
  let timer;
  try {
    const work = run(browser);
    if (!timeoutMs) return await work;
    work.catch(() => undefined);
    return await Promise.race([
      work,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${who ?? "design-canvas"}: the browser did not finish within ${Number((timeoutMs / 1000).toFixed(1))} seconds`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    await closeBrowser(browser, capMs ? { capMs } : undefined);
  }
}

/* ------------------------------------------------------------------ child tools */

/**
 * Start a child tool WITHOUT blocking this process, which is what `spawnSync` did and why a signal could not reach anything while
 * it ran: the handlers above only run between turns of the event loop. The child is told who started it (so a SIGKILL of this
 * process still takes the child's browser with it), a signal is passed on, and what comes back is the exit code a shell would show.
 */
function start(command, args, options, collect) {
  hook();
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: collect ? ["inherit", "pipe", "pipe"] : "inherit", ...options, env: childEnv(options.env ?? process.env) });
    children.add(child);
    let output = "";
    if (collect) {
      /* Teed as it arrives, so a long run shows its progress, and kept so the caller can read what it said. */
      child.stdout.on("data", (chunk) => {
        output += chunk;
        process.stdout.write(chunk);
      });
      child.stderr.on("data", (chunk) => {
        output += chunk;
        process.stderr.write(chunk);
      });
    }
    const finish = (status) => {
      children.delete(child);
      if (shuttingDown && children.size === 0) process.exit(exitCode ?? status);
      resolve(collect ? { status, output } : status);
    };
    child.on("error", () => finish(1));
    child.on("close", (status, signal) => finish(status ?? (signal ? 128 + (os.constants.signals[signal] ?? 15) : 1)));
  });
}

/** A child tool with its output on this one's, resolving to its exit code. */
export const spawnTracked = (command, args, options = {}) => start(command, args, options, false);

/** A child tool whose output is teed to this one's and also returned: `{ status, output }`. */
export const spawnCollected = (command, args, options = {}) => start(command, args, options, true);
