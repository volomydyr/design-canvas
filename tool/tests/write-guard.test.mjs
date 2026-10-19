/**
 * THE WRITE GUARD: every context a canvas tool opens blocks what the app could write (`guardWrites` in browser-guards.mjs, the
 * verdict `writeVerdict` in network.mjs). The reason it exists and is on by default: a capture against a shared account must
 * never create records there, and an opt-in guard cannot rule that out.
 *
 *   - the verdict, without a browser: a mutation, an operation of unknown type, a batch carrying one, a GraphQL POST it cannot
 *     read, and any non-GraphQL request that is not GET, HEAD or OPTIONS are writes; a query, a GET and the canvas's own API on
 *     the page's origin are not
 *   - in a real browser (set CANVAS_TEST_PROJECT to a project that has playwright): a context from `openContext` lets a read
 *     through to a dummy server and nothing else, popups included, while a page's `answer` rule still answers a save first
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

import { guardWrites, loginFixMessage, openContext, sessionFor, writeGuardSummary } from "../browser-guards.mjs";
import { allowWrites, applyNetwork, mergeNetwork, parseNetwork, writeVerdict } from "../network.mjs";
import { loadSettings } from "../project-settings.mjs";

const PROJECT = process.env.CANVAS_TEST_PROJECT;
const needsProject = (name, run) =>
  PROJECT ? test(name, { timeout: 120_000 }, run) : test(name, { skip: "set CANVAS_TEST_PROJECT to a project that has playwright to run this test" }, run);

const request = ({ method = "POST", url = "http://app.test/graphql", body } = {}) => ({
  method: () => method,
  url: () => url,
  postData: () => (body === undefined ? null : typeof body === "string" ? body : JSON.stringify(body)),
});

/* ------------------------------------------------------------------ the verdict */

test("writeVerdict: a GraphQL save is a write, whatever shape it comes in", () => {
  assert.deepEqual(writeVerdict(request({ body: { operationName: "SaveJob", query: "mutation SaveJob { a }" } })), { write: true, label: "mutation SaveJob" });
  assert.deepEqual(writeVerdict(request({ body: { query: "fragment F on T { query } mutation M { a { ...F } }" } })), { write: true, label: "mutation M" });
  assert.deepEqual(writeVerdict(request({ body: { operationName: "Persisted", extensions: { persistedQuery: { version: 1 } } } })), { write: true, label: "unknown Persisted" }, "a persisted query may be a save");
  assert.equal(writeVerdict(request({ body: [{ query: "query A { a }" }, { query: "mutation B { b }" }] })).write, true, "a batch carrying a save");
  assert.equal(writeVerdict(request({ body: { hello: "world" } })).write, true, "a GraphQL POST it cannot read cannot be shown to read");
  assert.equal(writeVerdict(request({ method: "GET", url: `http://app.test/graphql?query=${encodeURIComponent("mutation M { a }")}` })).write, true, "a save sent as a GET");
});

test("writeVerdict: a read goes through", () => {
  assert.deepEqual(writeVerdict(request({ body: { operationName: "Q", query: "query Q($query: String) { search(query: $query) { query } }" } })), { write: false });
  assert.deepEqual(writeVerdict(request({ body: { query: "{ viewer { id } }" } })), { write: false });
  assert.deepEqual(writeVerdict(request({ body: { operationName: "S", query: "subscription S { a }" } })), { write: false });
  assert.deepEqual(writeVerdict(request({ method: "GET", url: "http://app.test/library?explore=1" })), { write: false });
  assert.deepEqual(writeVerdict(request({ method: "OPTIONS", url: "http://api.test/graphql" })), { write: false });
});

test("writeVerdict: any other request that is not a read is a write, except the canvas's own API on the page's origin", () => {
  assert.deepEqual(writeVerdict(request({ url: "http://api.test/upload", body: "bytes" })), { write: true, label: "POST api.test/upload" });
  assert.deepEqual(writeVerdict(request({ method: "PUT", url: "https://s3.test/bucket/a.png", body: "bytes" })), { write: true, label: "PUT s3.test/bucket/a.png" });
  assert.equal(writeVerdict(request({ url: "http://app.test/library", body: "server action" })).write, true, "a server action");
  assert.deepEqual(writeVerdict(request({ url: "http://app.test/api/design-canvas/comments", body: {} }), { origin: "http://app.test" }), { write: false });
  assert.equal(writeVerdict(request({ url: "http://app.test/api/design-canvas/comments", body: {} })).write, true, "with no known origin, not even the canvas API");
  assert.equal(writeVerdict(request({ url: "http://evil.test/api/design-canvas/comments", body: {} }), { origin: "http://app.test" }).write, true, "another origin's path that looks like it");
});

test("writeVerdict: a part of an address listed in allowWrites (settings.json) goes through, and nothing else does", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "canvas-allow-writes-"));
  try {
    mkdirSync(path.join(dir, "design-canvas"));
    writeFileSync(path.join(dir, "design-canvas", "settings.json"), JSON.stringify({ appUrl: "http://localhost:4000", allowWrites: ["/api/auth/verify"] }));
    assert.deepEqual(loadSettings(path.join(dir, "design-canvas"), "test").allowWrites, ["/api/auth/verify"]);
    assert.deepEqual(writeVerdict(request({ url: "http://app.test/api/auth/verify", body: "{}" })), { write: false }, "a session check sent as a POST");
    assert.deepEqual(writeVerdict(request({ url: "http://app.test/api/websites", body: "{}" })), { write: true, label: "POST app.test/api/websites" });
    writeFileSync(path.join(dir, "design-canvas", "settings.json"), JSON.stringify({ appUrl: "http://localhost:4000" }));
    loadSettings(path.join(dir, "design-canvas"), "test");
    assert.equal(writeVerdict(request({ url: "http://app.test/api/auth/verify", body: "{}" })).write, true, "without the list, the same POST is blocked");
  } finally {
    allowWrites([]);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a login redirect after a blocked write names the request and the setting; without one it names the session", () => {
  const hit = { from: "/dashboard", to: "/login" };
  const where = { storageState: "design-canvas/auth-state.json", appUrl: "http://localhost:4000" };
  const blocked = loginFixMessage(hit, { ...where, blocked: ["POST localhost:4000/api/auth/verify"] });
  assert.match(blocked, /after the write guard blocked POST localhost:4000\/api\/auth\/verify/);
  assert.match(blocked, /"allowWrites": \["\/api\/auth\/verify"\]/);
  assert.match(blocked, /may have expired/, "the session stays the second explanation");
  assert.match(loginFixMessage(hit, { ...where, blocked: [] }), /^\/dashboard redirected to the login route \(\/login\): the saved session in .* has expired/);
  assert.match(loginFixMessage(hit, { appUrl: where.appUrl, blocked: ["POST localhost:4000/api/auth/verify"] }), /the session is missing/, "no session at all is still said first");
});

test("sessionFor gives the capture's origin the localStorage saved for the same host on another port, and changes nothing else", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "canvas-session-for-"));
  try {
    const file = path.join(dir, "state.json");
    const dev = { origin: "http://localhost:3000", localStorage: [{ name: "token", value: "test-value" }] };
    writeFileSync(file, JSON.stringify({ cookies: [], origins: [dev, { origin: "http://other.test", localStorage: [{ name: "x", value: "y" }] }] }));
    assert.deepEqual(sessionFor(file, "http://localhost:3055").origins.at(-1), { origin: "http://localhost:3055", localStorage: dev.localStorage });
    assert.equal(sessionFor(file, "http://localhost:3000"), file, "the origin it was saved on: the file as it is");
    assert.equal(sessionFor(file, "http://127.0.0.1:3055"), file, "another host gets nothing");
    assert.equal(sessionFor(file, undefined), file);
    writeFileSync(file, JSON.stringify({ cookies: [], origins: [dev, { origin: "http://localhost:3055", localStorage: [] }] }));
    assert.equal(sessionFor(file, "http://localhost:3055"), file, "a file that already holds the origin is left alone");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ a real browser */

needsProject("in a real browser, openContext lets a read through and blocks every write, popups included; an answered save is still answered", async () => {
  const require = createRequire(path.join(PROJECT, "package.json"));
  const { chromium } = require("playwright");
  const seen = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      seen.push(`${req.method} ${req.url}`);
      res.setHeader("access-control-allow-origin", "*");
      res.setHeader("access-control-allow-headers", "*");
      res.end(req.url === "/" ? "<html><body>t</body></html>" : "{}");
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  parseNetwork([], "the canvas", { canvas: true }); // the default policy: guarded
  const browser = await chromium.launch();
  try {
    const context = await openContext(browser, {}, { who: "test" });
    const page = await context.newPage();
    const control = await applyNetwork(page, mergeNetwork(undefined, [{ answer: "SaveRefused", data: null, errors: [{ message: "refused" }] }]));
    await page.goto(`${base}/`);
    const send = (target, body, where = "/graphql") =>
      target.evaluate(
        async ([url, body]) => {
          try {
            const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body });
            return `sent ${await response.text()}`;
          } catch {
            return "blocked";
          }
        },
        [`${base}${where}`, body],
      );
    const result = {
      mutation: await send(page, JSON.stringify({ operationName: "SaveJob", query: "mutation SaveJob { a }" })),
      persisted: await send(page, JSON.stringify({ operationName: "Persisted", extensions: { persistedQuery: {} } })),
      batch: await send(page, JSON.stringify([{ query: "query A { a }" }, { query: "mutation B { b }" }])),
      query: await send(page, JSON.stringify({ operationName: "Q", query: "query Q { a }" })),
      upload: await send(page, "bytes", "/upload"),
      canvasApi: await send(page, "{}", "/api/design-canvas/comments"),
      answered: await send(page, JSON.stringify({ operationName: "SaveRefused", query: "mutation SaveRefused { a }" })),
    };
    await page.evaluate((url) => window.open(url), `${base}/`);
    const popup = await context.waitForEvent("page");
    await popup.waitForLoadState();
    result.popupMutation = await send(popup, JSON.stringify({ query: "mutation M { m }" }));
    assert.equal(result.mutation, "blocked");
    assert.equal(result.persisted, "blocked");
    assert.equal(result.batch, "blocked");
    assert.equal(result.query, "sent {}");
    assert.equal(result.upload, "blocked");
    assert.equal(result.canvasApi, "sent {}", "the canvas's own API on the page's origin");
    assert.match(result.answered, /^sent .*refused/, "a screen's answer replies to the save before the guard; nothing reaches the server");
    assert.equal(result.popupMutation, "blocked", "a page the app opens is guarded too");
    const writesSeen = seen.filter((line) => !line.startsWith("GET"));
    assert.deepEqual(writesSeen.sort(), ["POST /api/design-canvas/comments", "POST /graphql"].sort(), "only the read and the canvas API reached the server");
    assert.match(writeGuardSummary(), /write\(s\) blocked: .*upload x1.*mutation M x1/, "the context guard catches what the page rule does not see: an upload, a popup");
  } finally {
    await browser.close();
    server.close();
  }
});

test("a canvas that declares writes allow opens an unguarded context", async () => {
  parseNetwork([{ writes: "allow" }], "the canvas", { canvas: true });
  let routed = 0;
  const context = { route: async () => (routed += 1) };
  const browser = { newContext: async (options) => ({ ...context, options }) };
  const opened = await openContext(browser, { viewport: { width: 1, height: 1 } }, { who: "test" });
  assert.equal(routed, 0);
  assert.equal(opened.options.serviceWorkers, undefined, "service workers are left as the caller asked");
  parseNetwork([], "the canvas", { canvas: true });
  const guarded = await openContext(browser, {}, { who: "test" });
  assert.equal(routed, 1, "the default routes the whole context");
  assert.equal(guarded.options.serviceWorkers, "block");
  void guardWrites;
});
