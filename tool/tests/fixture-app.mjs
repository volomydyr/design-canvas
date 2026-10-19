/**
 * A THROWAWAY APP AND ITS GRAPHQL API, for the tests that run the real capture, preflight and round on real pages
 * (`capture-network.test.mjs`). It is a few pages and two tiny servers, and it is what makes the claims about the capture checkable:
 *
 *   /tasks      a list that shows "Loading tasks" (a skeleton with `aria-busy`) until `TaskList` answers, then rows, or
 *               "No tasks yet", or "Could not load tasks" with Retry, and a "Filter tasks" button that opens a dialog
 *   /save       a Save button that sends the mutation `SaveTask` and says what came back, or that the request never did
 *   /total      a page whose data (`SlowTotal`, 4.5 seconds) arrives with no skeleton and nothing to wait for but the network
 *   /cors       a page that asks an API on ANOTHER origin, so an answer the capture fulfills needs the CORS headers
 *   /stream     a page that keeps one request open forever (`Forever`, a subscription the server never answers) beside a quick read
 *               (`Rows`), so the quiet wait has a channel to stop waiting for and data it must still wait for
 *   /broken     a page with one image that loads and one whose file is gone (a 404): a hole no second pass can fill
 *   /dialog     a dialog fixed over the whole window in one flat colour, so a picture can show whether the page was laid out at the
 *               full height of its viewport (`#123456` to the last row) or at a shorter one (white under it)
 *   /plain      two lines of text
 *   /goals      two buttons whose names share a word, for an origin named by a Playwright selector
 *   /dev-badge  a dev server's indicator: a red badge in the shadow root of a <nextjs-portal>
 *   /account    a session read from localStorage and checked with a POST (`/api/session/verify`); without it, off to /login
 *   /late       a panel that mounts a second after load with a fade-in, so a picture shows whether a late entrance was finished
 *   /lazy       a long page whose one lazy picture is added by a script after load, far below the fold
 *   /deep       a long page whose one picture is added after load, far below the fold, and takes three seconds to arrive
 *   /pinned     a pinned page: `?canvas=open` is a state it has, any other one it does not (the mark says "unknown")
 *   /flaky      the page the broken-shot guard works on: a rich table, a loading skeleton with no words, or a short page that really
 *               is this small, by the mode the test sets
 *
 * The API counts what it is asked, by operation, and by the page that asked: a request the capture held, failed or answered must
 * never be in the count, and a save must never be.
 *
 * In a test process it runs in-process (`startFixture`). Run as `node fixture-app.mjs <port>` it is its own process, which is how a
 * test hands it to `capture-run.mjs --reuse`: its control endpoints are `GET /__seen`, `POST /__flaky?mode=`, `PUT /__served?canvas=`.
 *
 * NOT INSTALLED into a project: the installer copies only the files it lists.
 */
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

/* A banner with a gradient in it, so that even the plainest page of the fixture is a picture of a real size: a page of two lines is
   under the capture's blank-page floor, and that floor is not what these tests are about. */
const shell = (title, body, script = "") =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>body{margin:0;font:16px/1.4 sans-serif;padding:24px}@keyframes pulse{50%{opacity:.4}}.animate-pulse{animation:pulse 1.2s infinite}.banner{height:140px;margin:0 0 16px;background:linear-gradient(100deg,#ff6b6b,#4dabf7 35%,#51cf66 65%,#ffa94d)}</style></head><body><div class="banner"></div><h1>Fixture App</h1>${body}<script>${script}</script></body></html>`;

/** A page script that sends one GraphQL operation to this app's own API (or the one named) and hands the JSON to `then`. */
const ASK = `const ask = (operationName, query, url) => fetch(url || "/api/graphql", { method: "POST", headers: { "content-type": "application/json", "x-frame": location.pathname + location.search }, body: JSON.stringify({ operationName, query, variables: {} }) }).then((r) => r.json());`;

const ANSWERS = {
  TaskList: () => ({ data: { taskList: { data: [{ id: 1 }, { id: 2 }, { id: 3 }], totalRecords: 3 } } }),
  SaveTask: () => ({ data: { saveTask: { ok: true } } }),
  SlowTotal: () => ({ data: { total: 7 } }),
  Rows: () => ({ data: { rows: 3 } }),
};

/** A small image that really loads, as a data address so it needs no route of its own. */
const GOOD_IMAGE = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#4dabf7"/></svg>')}`;

const pages = (apiPort) => ({
  "/tasks": () =>
    shell(
      "Tasks",
      `<h2>Open Tasks</h2><div id="state" aria-busy="true" class="animate-pulse" style="height:60px;background:#ddd">Loading tasks</div><button hidden data-testid="open-filter">Filter tasks</button>`,
      `${ASK}
      const state = document.getElementById("state");
      ask("TaskList", "query TaskList { taskList { data { id } totalRecords } }").then((j) => {
        state.removeAttribute("aria-busy"); state.classList.remove("animate-pulse"); state.removeAttribute("style");
        if (j.errors) { state.innerHTML = '<p role="alert">Could not load tasks</p><button>Retry</button>'; return; }
        const rows = j.data.taskList.data;
        state.innerHTML = rows.length ? "<ul>" + rows.map((m) => "<li>Task " + m.id + "</li>").join("") + "</ul>" : "<p>No tasks yet</p>";
        const open = document.querySelector("[data-testid=open-filter]");
        open.hidden = false;
        open.onclick = () => document.body.insertAdjacentHTML("beforeend", '<div role="dialog" aria-label="Filter" style="position:fixed;top:80px;left:80px;background:#fff;border:2px solid #333;padding:24px"><h3>Filter tasks</h3><button data-testid="apply">Apply</button></div>');
      });`,
    ),
  "/save": () =>
    shell(
      "Save",
      `<h2>Task Editor</h2><button id="save">Save task</button><p id="result">Not saved yet</p>`,
      `${ASK}
      document.getElementById("save").onclick = () => ask("SaveTask", "mutation SaveTask { saveTask { ok } }")
        .then((j) => { document.getElementById("result").textContent = j.errors ? "Save refused: " + j.errors[0].message : "Saved"; })
        .catch(() => { document.getElementById("result").textContent = "Could not save (network)"; });`,
    ),
  "/total": () =>
    shell(
      "Totals",
      `<h2>Totals</h2><p id="t">Total: 0</p>`,
      `${ASK}
      ask("SlowTotal", "query SlowTotal { total }").then((j) => { document.getElementById("t").textContent = "Total: " + j.data.total; });`,
    ),
  "/cors": () =>
    shell(
      "Cross origin",
      `<h2>Other origin</h2><p id="c">Cors waiting</p>`,
      `${ASK}
      ask("CorsList", "query CorsList { corsList { total } }", "http://127.0.0.1:${apiPort}/graphql")
        .then((j) => { document.getElementById("c").textContent = "Cors items: " + j.data.corsList.total; })
        .catch(() => { document.getElementById("c").textContent = "Cors failed"; });`,
    ),
  "/stream": () =>
    shell(
      "Stream",
      `<h2>Live Feed</h2><p id="rows">Streamed rows: 0</p>`,
      `${ASK}
      ask("Forever", "subscription Forever { tick }").catch(() => {});
      ask("Rows", "query Rows { rows }").then((j) => { document.getElementById("rows").textContent = "Streamed rows: " + j.data.rows; });`,
    ),
  "/broken": () =>
    shell(
      "Broken image",
      `<h2>Gallery</h2><img alt="kept" width="120" height="80" src="${GOOD_IMAGE}"><img alt="gone" width="120" height="80" src="/media/gone.png"><p>Two photographs, one of them gone</p>`,
    ),
  "/dialog": () =>
    shell(
      "Dialog",
      `<p>The page behind the dialog</p><div role="dialog" aria-label="Full" style="position:fixed;inset:0;background:#123456;color:#fff;padding:40px;font-size:24px">Dialog over the whole window</div>`,
    ),
  "/plain": () => shell("Plain", `<p>Nothing else is on this page</p>`),
  /* A session kept in localStorage and checked with a POST on every load, as many apps do: no session, or a check that does not
     come back, sends the page to the sign-in route. */
  "/account": () =>
    shell(
      "Account",
      `<h2>Account</h2><p id="who">Checking the session</p>`,
      `const token = localStorage.getItem("fixture-session");
      if (!token) location.replace("/login");
      else fetch("/api/session/verify", { method: "POST", body: token }).then((r) => r.json())
        .then((j) => { document.getElementById("who").textContent = "Signed in as " + j.user; })
        .catch(() => location.replace("/login"));`,
    ),
  "/login": () => shell("Login", `<h2>Sign in</h2>`),
  "/goals": () => shell("Goals", `<main><h2>Goals</h2><button>New Goal</button> <button>Goal Report</button></main>`),
  /* The pin component and a states file in one page: `?canvas=open` is a state it has, any other is one it does not, which it
     says the way the starter does (a console error, and the mark set to "unknown"); `&legacy=1` is a pin component older than
     that mark, which marks every page pinned. */
  "/pinned": () =>
    shell(
      "Pinned",
      `<main id="pinned"></main>`,
      `const q = new URLSearchParams(location.search); const state = q.get("canvas"); const known = state === "open";
      if (state && !known) console.error('[design-canvas] Unknown pinned state "' + state + '". The frame is showing the default.');
      setTimeout(() => {
        document.getElementById("pinned").innerHTML = known ? "<h2>Pinned open</h2><p>The pinned state is in place</p><button>Close panel</button>" : "<h2>Resting page</h2><p>The default rendering of this route, with nothing pinned</p>";
        document.documentElement.setAttribute("data-canvas-pinned", known || q.get("legacy") ? "1" : "unknown");
      }, 200);`,
    ),
  /* The element a Next dev server draws its indicator in, with a red badge in its shadow root, as on any dev-server page. */
  "/dev-badge": () =>
    shell(
      "Dev badge",
      `<p>A page served by a dev server</p>`,
      `const host = document.createElement("nextjs-portal");
      host.attachShadow({ mode: "open" }).innerHTML = '<div style="position:fixed;left:20px;bottom:20px;width:40px;height:40px;background:#e03131"></div>';
      document.body.appendChild(host);`,
    ),
  /* A page whose data comes from a plain REST address, not GraphQL. */
  "/rest": () =>
    shell(
      "Rest",
      `<h2>Trips</h2><p id="r">Loading trips</p>`,
      `fetch("/api/rest/trips").then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
        .then((j) => { document.getElementById("r").textContent = j.count ? "Trips: " + j.count : "No trips yet"; })
        .catch((status) => { document.getElementById("r").textContent = "Could not load trips (" + status + ")"; });`,
    ),
  /* A panel that arrives a second after the page, fading in: late enough to land after the settle, inside the stillness proof. */
  "/late": () =>
    shell(
      "Late",
      `<style>@keyframes rise{from{opacity:0}to{opacity:1}}</style><p>A panel arrives in a moment</p>`,
      `setTimeout(() => document.body.insertAdjacentHTML("beforeend", '<div id="late" style="position:fixed;left:40px;top:320px;width:360px;height:160px;background:#0a7d3b;color:#fff;animation:rise 400ms ease-out both">Arrived late</div>'), 1000);`,
    ),
  /* A long page whose only picture is lazy, far below the fold, and added by a script after the page has loaded. */
  "/lazy": () =>
    shell(
      "Lazy",
      `<p>A long page with one picture at the bottom</p><div style="height:2600px"></div><div id="slot"></div>`,
      `setTimeout(() => { document.getElementById("slot").innerHTML = '<img id="deep" alt="deep" width="400" height="200" loading="lazy" src="/media/dot.svg">'; }, 300);`,
    ),
  /* A long page whose only picture is added after load far below the fold and arrives slowly: the document is already
     complete, so only an image wait that covers the whole page sees it. */
  "/deep": () =>
    shell(
      "Deep",
      `<p>A long page with a slow picture at the bottom</p><div style="height:2600px"></div><div id="slot"></div>`,
      `setTimeout(() => { document.getElementById("slot").innerHTML = '<img id="deep" alt="deep" width="400" height="200" src="/media/slow.svg">'; }, 300);`,
    ),
});

/** The page the broken-shot guard works on, by mode. */
function flakyPage(mode) {
  const fetchIt = `${ASK} ask("TaskList", "query TaskList { taskList { totalRecords } }").catch(() => {});`;
  if (mode === "skeleton") {
    const blocks = Array.from({ length: 10 }, () => `<div style="height:40px;margin:10px 0;background:#e6e6e6"></div>`).join("");
    return shell("Flaky", blocks, fetchIt);
  }
  if (mode === "empty") return shell("Flaky", `<p>Nothing here yet. Add your first task to start using the fixture app.</p>`, fetchIt);
  const rows = Array.from(
    { length: 18 },
    (_, r) => `<tr>${Array.from({ length: 8 }, (_, c) => `<td style="background:hsl(${(r * 37 + c * 53) % 360} 70% ${55 + (c % 3) * 10}%);padding:10px 14px">Row ${r + 1} col ${c + 1}</td>`).join("")}</tr>`,
  ).join("");
  return shell("Flaky", `<table>${rows}</table>`, fetchIt);
}

const readBody = (req) =>
  new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => resolve(body));
  });

/**
 * Start the fixture. `port` 0 lets the system pick; `host` is what the app listens on (everything, unless named). Returns the ports and
 * the state a test reads and sets: `state.seen` (what the API was asked, by operation), `state.askedBy`, `state.flakyMode`, and
 * `state.served` (the declaration the route endpoint serves, by canvas slug, so the capture can learn it the way it does from a dev server).
 */
export async function startFixture({ port = 0, host } = {}) {
  const state = { seen: new Map(), askedBy: [], flakyMode: "good", served: new Map() };
  /** The responses of `Forever`, never answered, ended when the fixture closes. */
  const hanging = new Set();
  const count = (op) => state.seen.get(op) ?? 0;

  /* The API of ANOTHER origin: real CORS, a preflight and an answer, counting what it is asked. */
  const api = http.createServer(async (req, res) => {
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type, x-frame", "access-control-allow-methods": "POST, OPTIONS" };
    if (req.method === "OPTIONS") {
      res.writeHead(204, cors);
      res.end();
      return;
    }
    await readBody(req);
    state.seen.set("CorsList", count("CorsList") + 1);
    res.writeHead(200, { ...cors, "content-type": "application/json" });
    res.end(JSON.stringify({ data: { corsList: { total: 5 } } }));
  });
  await new Promise((done) => api.listen(0, host, done));
  const apiPort = api.address().port;
  const routes = pages(apiPort);

  const app = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    if (req.method === "POST" && url.pathname === "/api/graphql") {
      const parsed = JSON.parse((await readBody(req)) || "{}");
      const op = parsed.operationName ?? /(?:query|mutation)\s+(\w+)/.exec(parsed.query ?? "")?.[1] ?? "unnamed";
      state.seen.set(op, count(op) + 1);
      state.askedBy.push(`${op} ${req.headers["x-frame"] ?? ""}`);
      /* A channel the server never answers: it stays open until the page that asked goes away, or the fixture closes. */
      if (op === "Forever") {
        hanging.add(res);
        res.on("close", () => hanging.delete(res));
        return;
      }
      setTimeout(
        () => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify(ANSWERS[op]?.() ?? { data: null, errors: [{ message: `no such operation ${op}` }] }));
        },
        op === "SlowTotal" ? 4500 : 120,
      );
      return;
    }
    if (url.pathname === "/api/session/verify") {
      state.seen.set("verify", count("verify") + 1);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ user: "Tester" }));
      return;
    }
    if (url.pathname === "/api/rest/trips") {
      state.seen.set("rest", count("rest") + 1);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ count: 3 }));
      return;
    }
    if (url.pathname === "/api/design-canvas/shots") {
      const body = state.served.get(url.searchParams.get("canvas"));
      res.writeHead(body ? 200 : 404, { "content-type": "application/json" });
      res.end(body ?? "{}");
      return;
    }
    if (url.pathname === "/__seen") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ seen: Object.fromEntries(state.seen), askedBy: state.askedBy }));
      return;
    }
    if (url.pathname === "/__flaky") {
      state.flakyMode = url.searchParams.get("mode") ?? "good";
      res.writeHead(204);
      res.end();
      return;
    }
    if (url.pathname === "/__served" && req.method === "PUT") {
      state.served.set(url.searchParams.get("canvas"), await readBody(req));
      res.writeHead(204);
      res.end();
      return;
    }
    if (url.pathname === "/media/slow.svg") {
      setTimeout(() => {
        res.writeHead(200, { "content-type": "image/svg+xml" });
        res.end('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="#c2255c"/></svg>');
      }, 3000);
      return;
    }
    if (url.pathname === "/media/dot.svg") {
      res.writeHead(200, { "content-type": "image/svg+xml" });
      res.end('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="#c2255c"/></svg>');
      return;
    }
    const page = url.pathname === "/flaky" || url.pathname === "/flaky2" ? () => flakyPage(state.flakyMode) : routes[url.pathname];
    if (!page) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    res.writeHead(200, { "content-type": "text/html" });
    res.end(page());
  });
  await new Promise((done) => app.listen(port, host, done));

  return {
    port: app.address().port,
    apiPort,
    state,
    count,
    /** Where the counts stand now: every test shares one fixture, so a test counts what happened SINCE. */
    mark: () => new Map(state.seen),
    since: (before, op) => count(op) - (before.get(op) ?? 0),
    close: () => {
      for (const res of hanging) res.destroy();
      app.close();
      app.closeAllConnections?.();
      api.close();
    },
  };
}

/* Run as a program: `node fixture-app.mjs <port>` is the app on that port, in its own process. */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const fixture = await startFixture({ port: Number(process.argv[2] ?? 0) });
  console.log(`fixture listening ${fixture.port} ${fixture.apiPort}`);
}
