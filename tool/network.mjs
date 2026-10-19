/**
 * design-canvas — NETWORK CONTROL: a screen says what the page's data requests do while the picture is taken, and the capture,
 * the oracle's Open pass and the preflight's live pass do exactly that, through this one module.
 *
 * A list that is still loading, a list that failed, a list with nothing in it and a save the server refused exist only while
 * the DATA is late, refused or empty, so no URL and no press reaches them. A screen declares the data's behavior
 * (`CanvasScreen.network`) and nothing in the app has to know the canvas exists.
 *
 * THE RULES, in a list, one key per rule, like `steps`. A rule names a GraphQL operation, or (any value with a `/` in it) a part
 * of a request's address, which is how a REST or any other `fetch`/XHR request is matched:
 *
 *   { hold: "DocumentList" }                           the request is never answered: the page stays in its loading state
 *   { fail: "ContactList" }                            answered with a GraphQL error: the page shows its failed state
 *   { fail: "X", message: "Offline" }                  the same, with the error text the app may print
 *   { answer: "ContactList", data: {...} }             answered by the capture: an empty list, a record, a refusal
 *   { answer: "ArchiveItem", data: null, errors: [{ message: "refused", extensions: { code: 403 } }] }
 *   { hold: "/api/trips" }                             any fetch or XHR whose address contains "/api/trips", never answered
 *   { fail: "/api/trips", message: "Offline" }         answered 500 with `{ "error": "Offline" }`
 *   { answer: "/api/trips", data: [] }                 answered 200 with `data` as the JSON body (`errors` is GraphQL only)
 *   { writes: "abort" }                                CANVAS LEVEL ONLY (`CanvasDeclaration.network`), and THE DEFAULT: every
 *                                                      write is aborted (see below); the rule may be left out
 *   { writes: "allow" }                                CANVAS LEVEL ONLY, and DANGEROUS: saves reach the server. Only for an app
 *                                                      whose data is a throwaway sandbox nobody else uses
 *
 * WRITES ARE BLOCKED BY DEFAULT, by the context-level guard (`guardWrites` in `browser-guards.mjs`, decided by `writeVerdict`
 * below): a GraphQL mutation, an operation whose type cannot be read, an upload, a REST call, a server action, a popup's request.
 * A screen's own rule runs first, so a frame can ANSWER a save (a refusal) and nothing reaches the server either way.
 *
 * A GraphQL operation is named the way the app sends it: the `operationName`, or the name after `query` or `mutation` in the
 * document, exact and case sensitive. A screen's own rule that no request matches is a FAILED CLAIM: a hold that matches
 * nothing would photograph live data under a "Loading" label.
 *
 * WHERE A RULE LIVES. On the PAGE, never the context, so one frame's held request cannot reach another lane's frame. A held
 * request is never sent to the server, and `dispose` aborts it before its page closes, because a page closed with a request
 * still paused lets the browser send it. A screen's rule for the same operation or address replaces the canvas's.
 *
 * WHAT IT DOES NOT SEE. A request the app's SERVER makes (a server component's fetch never passes through the browser), a
 * GraphQL request with no operation name and no named document, a persisted query with no text, and a batch of operations
 * (never answered or held). A service worker answers from the worker: the capture blocks service workers whenever rules exist.
 *
 * THE QUIET WAIT lives here too (`trackRequests`): it waits until no fetch or XHR has been in flight for a moment. A held
 * request is not in flight for this purpose.
 *
 * DELETE WITH: the design-canvas/ folder.
 */
import { createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

/**
 * THE CANVAS'S WRITE POLICY, as the last canvas-wide list parsed in this process said it: "abort" unless the canvas declared
 * `{ writes: "allow" }`. Every tool parses its canvas's list before it opens a browser, and `openContext` reads this to decide
 * whether to install the context guard, so no tool has to pass the policy along (and none can forget to).
 */
let canvasWrites = "abort";
export const writesPolicy = () => canvasWrites;

/**
 * PARTS OF AN ADDRESS THE GUARD LETS THROUGH, from `allowWrites` in `design-canvas/settings.json` (set by `loadSettings`): a request
 * an app sends as a POST that only reads, such as a session check on every page. Blocking it logs the capture out.
 */
let allowedWrites = [];
export const allowWrites = (parts) => {
  allowedWrites = [...(parts ?? [])];
};

/** Every rule kind, in the order the docs list them. */
export const NETWORK_KINDS = ["hold", "fail", "answer", "writes"];

/** The keys each kind takes besides its own. Anything else on a rule is a typo the run refuses rather than ignores. */
const EXTRA_KEYS = {
  hold: [],
  fail: ["message"],
  answer: ["data", "errors"],
  writes: [],
};

/** The longest list a screen or a canvas may carry: a longer one is a mock server, and that belongs in the app. */
export const MAX_RULES = 12;

/** A GraphQL operation name (`Name` in the spec). */
const OPERATION_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** A rule that names a part of an address rather than an operation: anything with a `/` in it. */
const isAddress = (target) => target.includes("/");

/** What the page reads when a `fail` names no message. */
export const DEFAULT_FAIL_MESSAGE = "The capture made this request fail";

/**
 * THE QUIET WAIT's two numbers, shared by the capture, the preflight's live pass and the oracle's Open pass so that all three read
 * a page in the same condition: nothing may have been in flight for this long, and the wait goes on for this long at most.
 */
export const QUIET_MS = 400;
export const QUIET_CAP_MS = 10_000;

/** How the three request-level rules read in a claim: "the page asked for X and the capture held it". */
const VERB = { hold: "held", fail: "failed", answer: "answered" };

/** A request is GraphQL when its path says so. Anything else is not the capture's business and goes through untouched. */
export const isGraphqlUrl = (url) => /graphql/i.test(url.pathname ?? String(url));

/* ------------------------------------------------------------------ the declaration */

/**
 * VALIDATE A LIST OF RULES AND RETURN IT, or throw with the position and the reason. Runs before a browser exists, so a typo in
 * the third rule fails the run in milliseconds. `canvas: true` is the canvas-wide list, the only place `writes` may be.
 */
export function parseNetwork(list, where = "a screen", { canvas = false } = {}) {
  if (list === undefined || list === null) return [];
  const fail = (at, message) => {
    throw new Error(`${where}: network[${at}] ${message}`);
  };
  if (!Array.isArray(list)) throw new Error(`${where}: network must be a list of rules, got ${typeof list}`);
  if (list.length > MAX_RULES)
    throw new Error(`${where}: ${list.length} network rules is a mock server, not a list of rules (at most ${MAX_RULES}); answer the app's data in the app instead`);
  const seen = new Map();
  let writes = 0;
  if (canvas) canvasWrites = "abort";
  list.forEach((rule, at) => {
    if (!rule || typeof rule !== "object" || Array.isArray(rule)) return fail(at, `is not an object like { hold: "OperationName" }`);
    const present = Object.keys(rule).filter((key) => NETWORK_KINDS.includes(key));
    if (present.length === 0) {
      const first = Object.keys(rule)[0] ?? "(empty)";
      return fail(at, `has an unknown rule "${first}". The rules are: ${NETWORK_KINDS.join(", ")}`);
    }
    if (present.length > 1) return fail(at, `names ${present.join(" and ")}: one rule does one thing`);
    const kind = present[0];
    const allowed = new Set([kind, ...EXTRA_KEYS[kind]]);
    for (const key of Object.keys(rule)) if (!allowed.has(key)) return fail(at, `${kind} does not take "${key}". It takes: ${[...allowed].join(", ")}`);
    if (kind === "writes") {
      if (!canvas) return fail(at, `writes is declared once, on the canvas (CanvasDeclaration.network), and never on a screen`);
      if (rule.writes !== "abort" && rule.writes !== "allow")
        return fail(at, `writes takes "abort" (the default, so it may be left out) or "allow" (saves reach the server: only for a throwaway sandbox)`);
      canvasWrites = rule.writes;
      writes += 1;
      if (writes > 1) return fail(at, `writes is declared twice`);
      return;
    }
    const op = rule[kind];
    if (typeof op !== "string" || !(OPERATION_NAME.test(op) || isAddress(op)))
      return fail(at, `${kind} needs the operation's name as the app sends it (letters, digits and underscores), or a part of the request's address with a / in it`);
    if (seen.has(op)) return fail(at, `${kind} names ${op}, which network[${seen.get(op)}] already handles: an operation gets one rule`);
    seen.set(op, at);
    if (kind === "fail" && rule.message !== undefined && !(typeof rule.message === "string" && rule.message.trim().length > 0))
      return fail(at, `message must be the text of the error, as a non-empty string`);
    if (kind === "answer") {
      if (isAddress(op) && "errors" in rule) return fail(at, `errors is for a GraphQL operation; a rule on an address answers its "data" as the response body`);
      if (!("data" in rule) && !("errors" in rule)) return fail(at, `answer needs "data" (what the server returns, or null) or "errors", or both`);
      if (rule.errors !== undefined && !(Array.isArray(rule.errors) && rule.errors.length > 0 && rule.errors.every((one) => one && typeof one === "object" && !Array.isArray(one))))
        return fail(at, `errors must be a non-empty list of error objects like { message: "refused" }`);
    }
  });
  return list;
}

/** One rule in a word or two: `hold DocumentList`. */
export function describeRule(rule) {
  const kind = NETWORK_KINDS.find((one) => rule && Object.prototype.hasOwnProperty.call(rule, one));
  if (!kind) return "unknown rule";
  return kind === "writes" ? `writes ${rule.writes === "allow" ? "allow" : "abort"}` : `${kind} ${rule[kind]}`;
}

/** A list in one line, for a log and for the preflight. */
export function describeNetwork(list) {
  return (list ?? []).map(describeRule).join(", ");
}

/**
 * WHAT MAKES TWO FRAMES OF ONE ROUTE DIFFERENT PICTURES, in words: a loading, an empty and a failed list share their route, so
 * the duplicate-picture rule has to count the rules, and its message says which. Sorted, because two screens that hold the same
 * operations in another order are the same picture. `writes` is left out on purpose: it changes no picture.
 */
export function networkSignature(list) {
  return (list ?? [])
    .filter((rule) => !("writes" in rule))
    .map(describeRule)
    .sort()
    .join(", ");
}

/**
 * THE SAME, AS AN IDENTITY: two frames that answer one operation with different data are different pictures (a list with nothing in
 * it and a list with one row), which the words above cannot tell apart, so each rule carries a short digest of what it says.
 * Used as the key of the duplicate-picture rule; `networkSignature` is what its message prints.
 */
export function networkKey(list) {
  return (list ?? [])
    .filter((rule) => !("writes" in rule))
    .map((rule) => {
      const kind = NETWORK_KINDS.find((one) => Object.prototype.hasOwnProperty.call(rule, one));
      const said = createHash("sha256").update(JSON.stringify([rule.data ?? null, rule.errors ?? null, rule.message ?? null])).digest("hex").slice(0, 8);
      return `${kind} ${rule[kind]} ${said}`;
    })
    .sort()
    .join(", ");
}

/**
 * THE RULES ONE FRAME RUNS UNDER: the canvas-wide list, then the screen's own, a screen's rule replacing the canvas's for the
 * same operation. `required` is true for a screen's own rules only: the frame says what its page asks for, so a rule nothing
 * asked for is a failed claim, while a canvas-wide rule applies to whatever pages happen to ask and proves nothing.
 */
export function mergeNetwork(canvasList, screenList) {
  const byOperation = new Map();
  for (const [scope, list] of [
    ["canvas", canvasList],
    ["screen", screenList],
  ]) {
    for (const entry of list ?? []) {
      const kind = NETWORK_KINDS.find((one) => Object.prototype.hasOwnProperty.call(entry, one));
      if (kind === "writes") continue;
      const op = entry[kind];
      byOperation.set(op, { kind, op, url: isAddress(op), scope, required: scope === "screen", message: entry.message, data: entry.data, errors: entry.errors });
    }
  }
  return { rules: [...byOperation.values()] };
}

/** Does this declaration ask the capture to do anything to the network at all? */
export const hasNetwork = (canvasList, screenList) => (canvasList ?? []).length > 0 || (screenList ?? []).length > 0;

/* ------------------------------------------------------------------ reading a request */

/** Parse JSON, or `undefined` when it is not JSON (an `application/graphql` body is the document itself). */
function tryJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * THE TOP-LEVEL OPERATIONS OF A GRAPHQL DOCUMENT, in order: `[{ type: "query" | "mutation" | "subscription", name: string | null }]`.
 * Comments and strings are skipped, a fragment is not an operation, and a document that starts with `{` is the anonymous
 * query shorthand. It reads words at the top level only, so a field called `mutation` inside a selection is never taken for one.
 */
export function listOperations(source) {
  const text = String(source ?? "");
  const found = [];
  let at = 0;
  let braces = 0;
  let parens = 0;
  let pending = null;
  let fragment = false;
  const isStart = (char) => /[A-Za-z_]/.test(char ?? "");
  const isWord = (char) => /[A-Za-z0-9_]/.test(char ?? "");
  while (at < text.length) {
    const char = text[at];
    if (char === "#") {
      while (at < text.length && text[at] !== "\n" && text[at] !== "\r") at += 1;
      continue;
    }
    if (char === '"') {
      if (text.startsWith('"""', at)) {
        const end = text.indexOf('"""', at + 3);
        at = end === -1 ? text.length : end + 3;
      } else {
        at += 1;
        while (at < text.length && text[at] !== '"') at += text[at] === "\\" ? 2 : 1;
        at += 1;
      }
      continue;
    }
    if (char === "(") parens += 1;
    else if (char === ")") parens = Math.max(0, parens - 1);
    else if (char === "{") {
      if (braces === 0 && parens === 0) {
        if (pending) found.push(pending);
        else if (!fragment) found.push({ type: "query", name: null });
        pending = null;
        fragment = false;
      }
      braces += 1;
    } else if (char === "}") braces = Math.max(0, braces - 1);
    else if (braces === 0 && parens === 0 && isStart(char)) {
      let end = at;
      while (isWord(text[end])) end += 1;
      const word = text.slice(at, end);
      if (word === "query" || word === "mutation" || word === "subscription") {
        let next = end;
        while (/[\s,]/.test(text[next] ?? "")) next += 1;
        let name = null;
        if (isStart(text[next])) {
          let stop = next;
          while (isWord(text[stop])) stop += 1;
          name = text.slice(next, stop);
          end = stop;
        }
        pending = { type: word, name };
      } else if (word === "fragment") {
        fragment = true;
        pending = null;
      }
      at = end;
      continue;
    }
    at += 1;
  }
  return found;
}

/** One request payload (`{ query, operationName }`) as the operation it runs. Null when it names none. */
function operationOf(payload) {
  if (!payload || typeof payload !== "object") return null;
  const text = typeof payload.query === "string" ? payload.query : "";
  const wanted = typeof payload.operationName === "string" && payload.operationName.length > 0 ? payload.operationName : null;
  const listed = text ? listOperations(text) : [];
  const chosen = wanted ? listed.find((one) => one.name === wanted) : listed[0];
  if (chosen) return { type: chosen.type, name: chosen.name ?? wanted };
  /* A named operation the document does not define, or no document at all (a persisted query): the name is known, the type is not. */
  return wanted ? { type: "unknown", name: wanted } : null;
}

/**
 * THE OPERATIONS A REQUEST CARRIES, as `[{ type, name }]`: one for an ordinary request, several for a batch, none for a
 * request that is not GraphQL at all. A POST body that is JSON is read as the payload (or the list of them); one that is not
 * is the document itself. A GET carries its document in the address (`?query=...&operationName=...`), which is how urql
 * sends a read it wants cached.
 */
export function operationsOf(request) {
  const method = String(request.method?.() ?? "GET").toUpperCase();
  const body = method === "GET" || method === "HEAD" ? null : request.postData?.();
  let payloads = [];
  if (body) {
    const parsed = tryJson(body);
    payloads = parsed === undefined ? [{ query: body }] : Array.isArray(parsed) ? parsed : [parsed];
  } else {
    try {
      const params = new URL(request.url()).searchParams;
      const query = params.get("query");
      const operationName = params.get("operationName");
      if (query || operationName) payloads = [{ query: query ?? "", operationName: operationName ?? undefined }];
    } catch {
      payloads = [];
    }
  }
  return payloads.map(operationOf).filter(Boolean);
}

/* ------------------------------------------------------------------ deciding */

const labelOf = (operation) => operation.name ?? "unnamed";

/** A save, for the policy: a mutation, or an operation whose type cannot be read (a persisted query): it may be one. */
export const isSave = (operation) => operation.type === "mutation" || operation.type === "unknown";

/**
 * WHAT TO DO WITH ONE REQUEST, as a pure decision so it is tested without a browser: `{ action: "answer" | "hold" | "fail", rule }`
 * for a fetch or XHR whose address contains a rule's address, or a GraphQL request carrying one operation a rule names, and
 * `{ action: "continue" }` for everything else, which then meets the context's write guard.
 */
export function decide(request, merged) {
  const type = request.resourceType?.();
  if (type === "fetch" || type === "xhr") {
    const rule = merged.rules.find((one) => one.url && String(request.url()).includes(one.op));
    if (rule) return { action: rule.kind, rule };
  }
  let graphql = false;
  try {
    graphql = isGraphqlUrl(new URL(request.url()));
  } catch {
    graphql = false;
  }
  const operations = graphql ? operationsOf(request) : [];
  if (operations.length !== 1 || !operations[0].name) return { action: "continue" };
  const rule = merged.rules.find((one) => !one.url && one.op === operations[0].name);
  return rule ? { action: rule.kind, rule } : { action: "continue" };
}

/* ------------------------------------------------------------------ the write guard's verdict */

/** The methods that read. Anything else is a write wherever it goes, unless it is the canvas's own API. */
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** The canvas's own routes in the app (comments, shots): the canvas's tools may write there, nothing else may. */
export const CANVAS_API = "/api/design-canvas/";

/**
 * IS THIS REQUEST A WRITE, for the context-level guard (`guardWrites` in `browser-guards.mjs`): `{ write: false }` or
 * `{ write: true, label }`, a pure decision so it is tested without a browser. A write is:
 *   - a GraphQL request carrying a save (`isSave`: a mutation, or a type that cannot be read), batches included, GET included;
 *   - a GraphQL request that is not a read method and carries no operation this module can read (it cannot be shown to read);
 *   - any other request that is not GET, HEAD or OPTIONS (an upload, a REST call, a server action, an analytics post), except a
 *     same-origin request to the canvas's own API (`CANVAS_API`), which only the canvas's tools send.
 * A request whose address contains a part the project lists in `allowWrites` is never a write.
 * `origin` is the origin of the page that sent the request, when known.
 */
export function writeVerdict(request, { origin } = {}) {
  const method = String(request.method?.() ?? "GET").toUpperCase();
  let url;
  try {
    url = new URL(request.url());
  } catch {
    return READ_METHODS.has(method) ? { write: false } : { write: true, label: `${method} (unreadable address)` };
  }
  if (allowedWrites.some((part) => url.href.includes(part))) return { write: false };
  if (isGraphqlUrl(url)) {
    const operations = operationsOf(request);
    const saves = operations.filter(isSave);
    if (saves.length > 0) return { write: true, label: saves.map((one) => `${one.type} ${labelOf(one)}`).join(", ") };
    if (operations.length === 0 && !READ_METHODS.has(method)) return { write: true, label: `${method} ${url.host}${url.pathname} (no readable operation)` };
    return { write: false };
  }
  if (READ_METHODS.has(method)) return { write: false };
  if (url.pathname.startsWith(CANVAS_API) && origin && url.origin === origin) return { write: false };
  return { write: true, label: `${method} ${url.host}${url.pathname}` };
}

/** What the server would have said, for an `answer` or a `fail`: a GraphQL payload, or for a rule on an address the body itself. */
export function bodyOf(rule) {
  if (rule.url) return rule.kind === "fail" ? { error: rule.message ?? DEFAULT_FAIL_MESSAGE } : rule.data === undefined ? null : rule.data;
  if (rule.kind === "fail") return { data: null, errors: [{ message: rule.message ?? DEFAULT_FAIL_MESSAGE }] };
  const payload = { data: rule.data === undefined ? null : rule.data };
  if (rule.errors) payload.errors = rule.errors;
  return payload;
}

/**
 * THE CORS HEADERS A FULFILLED ANSWER NEEDS when the app's API is on another origin than the page: the browser refuses an
 * answer the server did not mark as allowed, and a fulfilled one never met the server. A same-origin request has no `Origin`
 * header and gets none.
 */
function corsFor(request) {
  const origin = request.headers?.().origin;
  return origin ? { "access-control-allow-origin": origin, "access-control-allow-credentials": "true", vary: "Origin" } : {};
}

/* ------------------------------------------------------------------ the quiet wait */

/**
 * A REQUEST OPEN THIS LONG IS NOT THE PAGE'S DATA ARRIVING, it is a channel the app keeps open: a GraphQL subscription over
 * HTTP, a stream, a long-poll. The quiet wait stops counting it after this long. Without it a page that always holds one such
 * request paid the whole cap twice per frame: measured on a real canvas, more than half of the time a frame took, and
 * every frame's note said the same thing. Six seconds, because a slow read is exactly what the quiet wait exists for: the fixture's
 * `SlowTotal` answers in 4.5 seconds with nothing else to wait on, and it must still be waited for. A read slower than six seconds
 * is still covered by the waits that look at the page (the placeholders, the claims, two identical pictures), and the run names
 * every request it stopped waiting for. Learned channels (below) cost nothing at all after the first frames. See "A frame
 * that waits ten seconds for a request that never ends" in references/traps.md.
 */
export const LONG_LIVED_MS = 6_000;

/**
 * WHAT A REQUEST IS, across pages: the method, the address without its query string (a long-poll's cursor changes on every
 * call) and the GraphQL operation names it carries. Two frames' copies of the same subscription share it; two different reads
 * to one `/graphql` endpoint do not.
 */
export function requestSignature(request) {
  const method = String(request.method?.() ?? "GET").toUpperCase();
  let where = String(request.url?.() ?? "");
  try {
    const url = new URL(where);
    where = `${url.origin}${url.pathname}`;
  } catch {
    /* Not an absolute address: the whole string is the best name there is. */
  }
  let names = [];
  try {
    names = operationsOf(request).map(labelOf);
  } catch {
    names = [];
  }
  return names.length > 0 ? `${method} ${where} ${names.join(",")}` : `${method} ${where}`;
}

/**
 * WHICH REQUESTS ARE IN FLIGHT on a page (`fetch` and `xhr` only: a document, an image or a font has its own wait). Held
 * requests are released from the count by the route handler, because they never finish and the page is meant to be waiting.
 * `release` can arrive before the `request` event does, so a released request is remembered and never counted.
 *
 * LONG-LIVED REQUESTS ARE NOT WAITED FOR (see `LONG_LIVED_MS`): one open longer than that stops counting, and one whose
 * signature is in `longLived` never counts at all. `learn()` adds the signatures of requests that were STILL open when the
 * page was done with (it runs in the controller's `dispose`), so a run that shares one set pays the threshold once, on the
 * first frames, and not on every frame after. A read that was merely slow finished before its page closed and is never
 * learned, which is why the learning waits for the end of a frame rather than for the threshold.
 */
export function trackRequests(page, { longLived = new Set(), longLivedMs = LONG_LIVED_MS } = {}) {
  /** request -> { at, signature } */
  const inflight = new Map();
  const released = new WeakSet();
  let last = Date.now();
  const counts = (request) => {
    const type = request.resourceType?.();
    return type === "fetch" || type === "xhr";
  };
  /** Is this request still something to wait for, at `now`? */
  const waitingFor = (entry, now) => now - entry.at < longLivedMs && !longLived.has(entry.signature);
  const onRequest = (request) => {
    if (!counts(request) || released.has(request)) return;
    const entry = { at: Date.now(), signature: requestSignature(request) };
    inflight.set(request, entry);
    /* A channel this run already knows is not activity: a long-poll that answers and opens again every few seconds would
       otherwise reset the quiet window on every reconnect. */
    if (!longLived.has(entry.signature)) last = entry.at;
  };
  const onDone = (request) => {
    const entry = inflight.get(request);
    if (!entry) return;
    inflight.delete(request);
    if (waitingFor(entry, Date.now())) last = Date.now();
  };
  page.on("request", onRequest);
  page.on("requestfinished", onDone);
  page.on("requestfailed", onDone);
  return {
    release(request) {
      released.add(request);
      inflight.delete(request);
    },
    pending: () => [...inflight.keys()].map((request) => request.url()),
    /** The signatures of what is still open now and has been for `longLivedMs`, added to the shared set. Returns the new ones. */
    learn() {
      const now = Date.now();
      const learned = [];
      for (const entry of inflight.values()) {
        if (now - entry.at < longLivedMs || longLived.has(entry.signature)) continue;
        longLived.add(entry.signature);
        learned.push(entry.signature);
      }
      return learned;
    },
    /**
     * Resolves when nothing that is still worth waiting for has been in flight for `quietMs`, or when `capMs` is up, whichever is
     * first. `quiet: false` says it was the cap, with what was still out: the caller reports it as a note and takes the picture
     * anyway. `ignored` names the long-lived requests the wait did not count, by signature, so the caller can say so.
     */
    async quiet({ quietMs = QUIET_MS, capMs = QUIET_CAP_MS } = {}) {
      const deadline = Date.now() + capMs;
      for (;;) {
        const now = Date.now();
        const entries = [...inflight.entries()];
        const waiting = entries.filter(([, entry]) => waitingFor(entry, now));
        const ignored = [...new Set(entries.filter(([, entry]) => !waitingFor(entry, now)).map(([, entry]) => entry.signature))];
        if (waiting.length === 0 && now - last >= quietMs) return { quiet: true, pending: [], ignored };
        if (now >= deadline) return { quiet: false, pending: waiting.map(([request]) => request.url()), ignored };
        await sleep(50);
      }
    },
  };
}

/* ------------------------------------------------------------------ doing it */

/**
 * PUT THE RULES ON A PAGE, before it navigates. Returns a controller:
 *   `hits`      how many requests each rule matched, by operation or address
 *   `unmet()`   the screen's own rules that no request has matched yet (a claim that is not yet proved)
 *   `report()`  what happened, for the manifest: `[{ rule, scope, hits }]`
 *   `tracker`   the in-flight tracker, for the quiet wait
 * `longLived` is a set of request signatures the quiet wait does not count, shared across the pages of one run so a channel the
 * app always holds open is learned once (see `trackRequests`); left out, each page learns on its own.
 * With nothing to do it registers no route at all, so a page with no rules is exactly the page it always was.
 */
export async function applyNetwork(page, merged, { longLived } = {}) {
  const tracker = trackRequests(page, { longLived });
  const hits = new Map(merged.rules.map((rule) => [rule.op, 0]));
  /** The routes of held requests, still waiting: `dispose` aborts them before the page closes. */
  const held = [];
  const control = {
    hits,
    tracker,
    unmet: () => merged.rules.filter((rule) => rule.required && hits.get(rule.op) === 0),
    /** Is this page holding a request back right now? A hold rule that has been hit: the page is a loading frame by declaration. */
    holding: () => merged.rules.some((rule) => rule.kind === "hold" && (hits.get(rule.op) ?? 0) > 0),
    report: () => merged.rules.map((rule) => ({ rule: describeRule({ [rule.kind]: rule.op }), scope: rule.scope, hits: hits.get(rule.op) ?? 0 })),
    /**
     * ABORT EVERY HELD REQUEST, BEFORE THE PAGE IS CLOSED. This is not tidiness. Closing a page with a request still paused makes
     * the browser let it through: measured on five frames of one route, the held request reached the real server the instant its
     * page closed in 6 runs of 8 (0 of 8 with this). For a read that is load on a dev server that was never meant to hear of it; for
     * a held mutation it is a save. So whoever opened the page calls this in its `finally`, ahead of `page.close()`. Safe to call
     * twice, and on a page that is already gone.
     */
    async dispose() {
      /* What is still open at the end of the frame, and has been for a while, is a channel: the run stops waiting for it. */
      tracker.learn();
      await Promise.allSettled(held.splice(0).map((route) => route.abort("aborted")));
    },
  };
  if (merged.rules.length === 0) return control;
  const addresses = merged.rules.filter((rule) => rule.url).map((rule) => rule.op);
  await page.route((url) => isGraphqlUrl(url) || addresses.some((part) => url.href.includes(part)), async (route) => {
    const request = route.request();
    try {
      /* FALLBACK, NEVER CONTINUE: what this page lets through still passes the context's write guard (`guardWrites`), which
         a `route.continue()` here would skip. */
      if (String(request.method()).toUpperCase() === "OPTIONS") {
        await route.fallback();
        return;
      }
      const verdict = decide(request, merged);
      if (verdict.action === "continue") {
        await route.fallback();
        return;
      }
      hits.set(verdict.rule.op, (hits.get(verdict.rule.op) ?? 0) + 1);
      if (verdict.action === "hold") {
        tracker.release(request);
        held.push(route);
        return;
      }
      const status = verdict.rule.url && verdict.action === "fail" ? 500 : 200;
      await route.fulfill({ status, contentType: "application/json", headers: corsFor(request), body: JSON.stringify(bodyOf(verdict.rule)) });
    } catch {
      /* The page went away under the handler (a request can arrive after its page was closed): there is nobody to answer. The
         request falls to the context's write guard, so an error here can never be the way a save gets out. */
      try {
        await route.fallback();
      } catch {
        /* Already handled, or closed with the page. */
      }
    }
  });
  return control;
}

/** A rule nobody asked for, as the claim the manifest records: "the page asked for X and the capture held it". */
export const unmetClaim = (rule) => `the page asked for ${rule.op} and the capture ${VERB[rule.kind]} it`;

/** The hits in one short line for the capture's result row: `hold DocumentList x1`. */
export function describeHits(control) {
  return control
    .report()
    .map((one) => `${one.rule} x${one.hits}`)
    .join(", ");
}
