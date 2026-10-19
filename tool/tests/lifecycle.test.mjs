/**
 * Tests for the one promise `browser-lifecycle.mjs` makes: a browser a tool opens does not outlive the tool, however the tool
 * ends. "However" is the point, so most of these END a real process in a real way (SIGKILL, SIGTERM, SIGINT, a normal exit)
 * and then look at the process table.
 *
 *   node --test tool/tests/lifecycle.test.mjs
 *
 * WITHOUT A BROWSER. The browser is a stand-in: a detached node process leading its own process group and carrying the flag
 * Playwright launches Chromium with (`--remote-debugging-pipe`), which is what the lifecycle recognises a browser by. That runs
 * anywhere, with no Playwright. The test under "in a browser" launches the real thing through `launchTracked`, on the bundled
 * Chromium and on installed Chrome, and needs Playwright, which a project carries and the skill does not:
 *
 *   CANVAS_TEST_PROJECT=/path/to/project node --test tool/tests/lifecycle.test.mjs
 *
 * The real-Chrome case is the one that matters most: measured with bare Playwright, a tool killed with SIGKILL leaves the bundled
 * Chromium to exit on its own and leaves installed Chrome running for good.
 *
 * NOT INSTALLED into a project: the installer copies only the files it lists.
 */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { BROWSER_MARK, WATCHDOG, childEnv, ownersOf, parsePs, pickBrowsers } from "../browser-lifecycle.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIFECYCLE = pathToFileURL(path.join(HERE, "..", "browser-lifecycle.mjs")).href;
const made = [];
const scratch = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "canvas-lifecycle-test-"));
  made.push(dir);
  return dir;
};
/* Every stand-in browser a test starts, by process group, and every host, so a failing test cannot leave either behind (a host
   that outlives the suite would also hold its stdout pipe open and hang the runner). */
const fakes = new Set();
const hosts = new Set();
after(() => {
  for (const host of hosts) {
    try {
      process.kill(host, "SIGKILL");
    } catch {
      /* Already gone. */
    }
  }
  for (const group of fakes) {
    try {
      process.kill(-group, "SIGKILL");
    } catch {
      /* Already gone, which is the point. */
    }
  }
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** Is the process running? A zombie is not: it is dead and waiting to be reaped. */
function alive(pid) {
  try {
    const state = execFileSync("ps", ["-o", "state=", "-p", String(pid)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return state !== "" && !state.startsWith("Z");
  } catch {
    return false;
  }
}
async function until(test, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (test()) return true;
    await sleep(100);
  }
  return test();
}

/**
 * A host: a node process that tracks a stand-in browser the way `launchTracked` tracks a real one. It prints `FAKE <pid>` once
 * the browser is up. `mode` is what it does afterwards: sit (wait for a signal), exit, or run a child host through `spawnTracked`.
 */
function writeHost(dir, mode) {
  const file = path.join(dir, `host-${mode}.mjs`);
  if (mode === "parent") writeHost(dir, "sit");
  writeFileSync(
    file,
    `import { spawn } from "node:child_process";
import { spawnTracked, trackPid } from ${JSON.stringify(LIFECYCLE)};
const mode = ${JSON.stringify(mode)};
if (mode === "parent") {
  /* A round: it runs a child tool (which has the browser) and waits. */
  spawnTracked(process.execPath, [${JSON.stringify(path.join(dir, "host-sit.mjs"))}]).then((code) => process.exit(code));
} else {
  const fake = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)", "--", ${JSON.stringify(BROWSER_MARK)}], { detached: true, stdio: "ignore" });
  fake.unref();
  trackPid(fake.pid, { who: "test-host", command: "node " + ${JSON.stringify(BROWSER_MARK)} });
  console.log("FAKE " + fake.pid + " HOST " + process.pid);
  if (mode === "exit") setTimeout(() => process.exit(0), 600);
  else setInterval(() => {}, 1000);
}
`,
  );
  return file;
}

/** Start a host and resolve with it and its browser's pid. */
function start(file) {
  return new Promise((resolve, reject) => {
    const host = spawn(process.execPath, [file], { stdio: ["ignore", "pipe", "inherit"] });
    let out = "";
    host.stdout.on("data", (chunk) => {
      out += chunk;
      const found = /FAKE (\d+) HOST (\d+)/.exec(out);
      if (found) {
        fakes.add(Number(found[1]));
        hosts.add(Number(found[2]));
        hosts.add(host.pid);
        const exited = new Promise((done) => host.on("close", (code, signal) => done({ code, signal })));
        /* A host that does not end when it was told to is a failure with a name, not a runner that never finishes. */
        const ended = () => Promise.race([exited, new Promise((_, no) => setTimeout(() => no(new Error("the host did not end within ten seconds")), 10_000).unref())]);
        resolve({ host, fake: Number(found[1]), hostPid: Number(found[2]), ended, output: () => out });
      }
    });
    host.on("error", reject);
    setTimeout(() => reject(new Error(`the host did not start: ${out}`)), 10_000).unref();
  });
}

/* ------------------------------------------------------------------ recognising a browser */

test("parsePs reads pid, parent, group and the whole command, spaces included", () => {
  const rows = parsePs("  12   1  12 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --remote-debugging-pipe\n 13 12 12 helper --type=renderer\nnot a row\n");
  assert.deepEqual(rows[0], { pid: 12, ppid: 1, pgid: 12, command: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --remote-debugging-pipe" });
  assert.equal(rows.length, 2);
});

test("pickBrowsers takes only a new direct child that leads its own group and carries the pipe flag", () => {
  const table = [
    { pid: 10, ppid: 5, pgid: 10, command: `chrome ${BROWSER_MARK}` }, // the browser
    { pid: 11, ppid: 10, pgid: 10, command: `helper ${BROWSER_MARK}` }, // its helper: not a direct child
    { pid: 12, ppid: 5, pgid: 5, command: `chrome ${BROWSER_MARK}` }, // a child in the tool's own group
    { pid: 13, ppid: 5, pgid: 13, command: "next start" }, // a child that is not a browser
    { pid: 14, ppid: 5, pgid: 14, command: `chrome ${BROWSER_MARK}` }, // a browser that was there before this launch
    { pid: 15, ppid: 6, pgid: 15, command: `chrome ${BROWSER_MARK}` }, // somebody else's browser
  ];
  assert.deepEqual(pickBrowsers(table, { parent: 5, before: new Set([14]) }).map((one) => one.pid), [10]);
});

test("a child tool is told who started it, and a watchdog waits on both", () => {
  assert.deepEqual(ownersOf({}, 100), [100]);
  assert.deepEqual(ownersOf({ CANVAS_OWNER_PID: "77" }, 100), [100, 77]);
  assert.deepEqual(ownersOf({ CANVAS_OWNER_PID: "nonsense" }, 100), [100]);
  assert.deepEqual(ownersOf({ CANVAS_OWNER_PID: "1" }, 100), [100], "pid 1 is never an owner");
  assert.equal(childEnv({ A: "1" }).CANVAS_OWNER_PID, String(process.pid));
  assert.match(WATCHDOG, /kill -9 -- "-\$g"/);
  assert.match(WATCHDOG, /Z\*/, "a zombie owner counts as dead");
});

/* ------------------------------------------------------------------ however the tool ends */

test("a tool that is SIGKILLed leaves no browser: the watchdog takes the process group", async () => {
  const one = await start(writeHost(scratch(), "sit"));
  assert.ok(alive(one.fake), "the stand-in browser is up");
  process.kill(one.hostPid, "SIGKILL");
  assert.ok(await until(() => !alive(one.fake)), "the browser is gone within eight seconds of the tool");
});

test("a tool that is sent SIGTERM closes its browser, and ends with 143", async () => {
  const one = await start(writeHost(scratch(), "sit"));
  process.kill(one.hostPid, "SIGTERM");
  const ended = await one.ended();
  assert.equal(ended.code, 143);
  assert.ok(await until(() => !alive(one.fake)));
});

test("a tool that is sent SIGINT (Ctrl-C) closes its browser, and ends with 130", async () => {
  const one = await start(writeHost(scratch(), "sit"));
  process.kill(one.hostPid, "SIGINT");
  const ended = await one.ended();
  assert.equal(ended.code, 130);
  assert.ok(await until(() => !alive(one.fake)));
});

test("a tool that simply ends, or stops with process.exit inside a guard, leaves no browser", async () => {
  const one = await start(writeHost(scratch(), "exit"));
  const ended = await one.ended();
  assert.equal(ended.code, 0);
  assert.ok(await until(() => !alive(one.fake)));
});

test("a round that is sent SIGTERM passes it to its child tool, waits for it, and the child's browser goes", async () => {
  const one = await start(writeHost(scratch(), "parent"));
  process.kill(one.hostPid, "SIGTERM");
  const ended = await one.ended();
  assert.equal(ended.code, 143, "the round ends with the code a killed job shows");
  assert.ok(await until(() => !alive(one.fake)), "the child's browser is gone");
});

test("a round that is SIGKILLed still takes its child tool's browser with it", async () => {
  const one = await start(writeHost(scratch(), "parent"));
  /* The host that printed FAKE is the CHILD (the parent runs it and prints nothing): its parent is the round. */
  const round = Number(execFileSync("ps", ["-o", "ppid=", "-p", String(one.hostPid)], { encoding: "utf8" }).trim());
  assert.ok(round > 1 && alive(round));
  process.kill(round, "SIGKILL");
  assert.ok(await until(() => !alive(one.fake)), "the watchdog waits on the round as well as on the tool, so the browser goes");
  try {
    process.kill(one.hostPid, "SIGKILL");
  } catch {
    /* Already gone. */
  }
});

test("the watchdog goes when the browser does, so nothing is left polling", async () => {
  const one = await start(writeHost(scratch(), "sit"));
  const watchers = () => execFileSync("ps", ["-axo", "pid,command"], { encoding: "utf8" }).split("\n").filter((line) => line.includes(`canvas-watchdog ${one.fake} `));
  assert.ok(watchers().length >= 1, "a watchdog is watching this browser");
  process.kill(one.hostPid, "SIGTERM");
  await one.ended();
  assert.ok(await until(() => watchers().length === 0), "and is gone once the browser is");
});

/* ------------------------------------------------------------------ launching, closing and the ceiling (a stand-in `chromium`) */

/**
 * A host that launches through `launchTracked` with a stand-in `chromium` whose `launch` starts the stand-in browser exactly the
 * way Playwright starts Chromium (a direct child, leading its own group, carrying the pipe flag). `script` is what the host does
 * with the browser it got.
 */
function writeLauncher(dir, name, script) {
  const file = path.join(dir, `launcher-${name}.mjs`);
  writeFileSync(
    file,
    `import { spawn } from "node:child_process";
import { closeBrowser, launchTracked, withBrowser } from ${JSON.stringify(LIFECYCLE)};
const seen = [];
const chromium = {
  async launch(options) {
    seen.push(options);
    const fake = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)", "--", ${JSON.stringify(BROWSER_MARK)}], { detached: true, stdio: "ignore" });
    fake.unref();
    console.log("FAKE " + fake.pid + " HOST " + process.pid);
    return { async close() { await new Promise(() => {}); } };
  },
};
${script}
`,
  );
  return file;
}

test("launchTracked takes Playwright's signal handlers over, so there is exactly one owner of SIGINT, SIGTERM and SIGHUP", async () => {
  const one = await start(
    writeLauncher(
      scratch(),
      "options",
      `await launchTracked(chromium, { channel: "chrome" }, { who: "t" });
console.log("OPTIONS " + JSON.stringify(seen[0]));
setInterval(() => {}, 1000);`,
    ),
  );
  assert.ok(alive(one.fake));
  assert.ok(await until(() => one.output().includes("OPTIONS ")));
  const options = JSON.parse(/OPTIONS (.*)/.exec(one.output())[1]);
  assert.deepEqual(options, { channel: "chrome", handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false }, "the caller's options are kept and Playwright's handlers are off");
  process.kill(one.hostPid, "SIGTERM");
  await one.ended();
  assert.ok(await until(() => !alive(one.fake)));
});

test("closeBrowser that hangs is capped, and the browser's process group is killed anyway", async () => {
  const one = await start(
    writeLauncher(
      scratch(),
      "hang",
      `const browser = await launchTracked(chromium, {}, { who: "t" });
const at = Date.now();
await closeBrowser(browser, { capMs: 300 });
console.log("CLOSED after " + (Date.now() - at) + "ms");
process.exit(0);`,
    ),
  );
  const ended = await one.ended();
  assert.equal(ended.code, 0);
  assert.ok(await until(() => !alive(one.fake)), "the browser is gone although close() never returned");
});

test("withBrowser abandons a job past its ceiling, closes the browser, and says which ceiling it was", async () => {
  const one = await start(
    writeLauncher(
      scratch(),
      "ceiling",
      `try {
  await withBrowser(chromium, {}, () => new Promise(() => {}), { who: "sheet", timeoutMs: 400, capMs: 300 });
} catch (error) {
  console.log("ERROR " + error.message);
}
process.exit(0);`,
    ),
  );
  assert.equal((await one.ended()).code, 0);
  assert.match(one.output(), /ERROR sheet: the browser did not finish within 0\.4 seconds/);
  assert.ok(await until(() => !alive(one.fake)));
});

/* ------------------------------------------------------------------ in a browser */

const PROJECT = process.env.CANVAS_TEST_PROJECT;
const inBrowser = PROJECT ? test : (name, run) => test(name, { skip: "set CANVAS_TEST_PROJECT to a project that has playwright to run the browser tests" }, run);

for (const channel of [undefined, "chrome"]) {
  inBrowser(`in a browser: a tool SIGKILLed mid-way leaves no ${channel ?? "bundled Chromium"} behind`, async () => {
    if (channel === "chrome" && !existsSync("/Applications/Google Chrome.app") && process.platform === "darwin") return;
    const dir = scratch();
    /* The profile folders Playwright makes land in this folder, so a survivor is recognised by its path and nothing else. */
    const tmp = path.join(dir, "tmp");
    mkdirSync(tmp);
    const project = path.join(dir, "project");
    mkdirSync(path.join(project, "design-canvas"), { recursive: true });
    execFileSync("ln", ["-s", path.join(PROJECT, "node_modules"), path.join(project, "node_modules")]);
    execFileSync("cp", [path.join(HERE, "..", "browser-lifecycle.mjs"), path.join(project, "design-canvas", "browser-lifecycle.mjs")]);
    writeFileSync(
      path.join(project, "design-canvas", "host.mjs"),
      `import { chromium } from "playwright";
import { launchTracked } from "./browser-lifecycle.mjs";
const browser = await launchTracked(chromium, ${JSON.stringify(channel ? { channel } : {})}, { who: "host" });
const page = await browser.newPage();
await page.goto("about:blank");
console.log("UP " + process.pid);
setInterval(() => {}, 1000);
`,
    );
    const mine = () =>
      execFileSync("ps", ["-axo", "pid,command"], { encoding: "utf8" })
        .split("\n")
        .filter((line) => line.includes(tmp) && line.includes(BROWSER_MARK) && !line.includes("canvas-watchdog"));
    const host = spawn(process.execPath, [path.join(project, "design-canvas", "host.mjs")], { cwd: project, env: { ...process.env, TMPDIR: `${tmp}/` }, stdio: ["ignore", "pipe", "inherit"] });
    let out = "";
    host.stdout.on("data", (chunk) => (out += chunk));
    assert.ok(await until(() => out.includes("UP "), 30_000), "the browser came up");
    assert.ok(mine().length >= 1, "and is in the process table");
    process.kill(host.pid, "SIGKILL");
    const gone = await until(() => mine().length === 0, 12_000);
    for (const line of mine()) {
      try {
        process.kill(-Number(line.trim().split(/\s+/)[0]), "SIGKILL");
      } catch {
        /* Gone. */
      }
    }
    assert.ok(gone, `no ${channel ?? "bundled Chromium"} process survived the SIGKILL of the tool that opened it`);
  });
}
