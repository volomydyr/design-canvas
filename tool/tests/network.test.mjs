/**
 * Tests for `network.mjs`: what a screen's `network` rules mean, how a GraphQL request is read, what is done with it, and the
 * wait for a page's data to be in. None of it needs a browser, an app or a dependency, so it runs in the skill's own checkout:
 *
 *   node --test tool/tests/network.test.mjs
 *
 * The browser half (the same rules on real pages, in lanes, through the capture itself) is `capture-network.test.mjs`.
 *
 * NOT INSTALLED into a project: the installer copies only the files it lists.
 */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";

import {
  DEFAULT_FAIL_MESSAGE,
  MAX_RULES,
  QUIET_CAP_MS,
  QUIET_MS,
  LONG_LIVED_MS,
  applyNetwork,
  bodyOf,
  decide,
  describeHits,
  describeNetwork,
  describeRule,
  hasNetwork,
  isGraphqlUrl,
  listOperations,
  mergeNetwork,
  networkKey,
  networkSignature,
  operationsOf,
  writesPolicy,
  writeVerdict,
  parseNetwork,
  requestSignature,
  trackRequests,
  unmetClaim,
} from "../network.mjs";
import { lintDeclaration, lintNetwork } from "../preflight-rules.mjs";

/* ------------------------------------------------------------------ the declaration */

test("parseNetwork accepts every rule, returns the list unchanged, and takes nothing as an empty list", () => {
  const list = [
    { hold: "TaskList" },
    { fail: "ContactList" },
    { fail: "JobList", message: "Offline" },
    { answer: "ProjectList", data: { projectList: { projects: [], total: 0 } } },
    { answer: "ProjectArchive", data: null, errors: [{ message: "refused", extensions: { code: 403 } }] },
    { answer: "OnlyErrors", errors: [{ message: "no" }] },
  ];
  assert.equal(parseNetwork(list, "t"), list);
  assert.deepEqual(parseNetwork(undefined, "t"), []);
  assert.deepEqual(parseNetwork(null, "t"), []);
  assert.deepEqual(parseNetwork([], "t"), []);
  const canvas = [{ writes: "abort" }, { hold: "Analytics" }];
  assert.equal(parseNetwork(canvas, "the canvas", { canvas: true }), canvas);
});

test("a rule that cannot run THROWS, with the screen and the position", () => {
  assert.throws(() => parseNetwork([{ hold: "A" }, { wait: "A" }], "task-loading"), /task-loading: network\[1\] has an unknown rule "wait"\. The rules are: hold, fail, answer, writes/);
  assert.throws(() => parseNetwork([{}], "s"), /network\[0\] has an unknown rule "\(empty\)"/);
  assert.throws(() => parseNetwork(["hold"], "s"), /network\[0\] is not an object/);
  assert.throws(() => parseNetwork({ hold: "A" }, "s"), /network must be a list of rules/);
  assert.throws(() => parseNetwork([{ hold: "A", fail: "B" }], "s"), /names hold and fail: one rule does one thing/);
  assert.throws(() => parseNetwork([{ hold: "A", data: {} }], "s"), /hold does not take "data"/);
  assert.throws(() => parseNetwork([{ fail: "A", errors: [] }], "s"), /fail does not take "errors"\. It takes: fail, message/);
  assert.throws(() => parseNetwork([{ hold: "" }], "s"), /hold needs the operation's name/);
  assert.throws(() => parseNetwork([{ hold: "two words" }], "s"), /hold needs the operation's name/);
  assert.throws(() => parseNetwork([{ hold: 4 }], "s"), /hold needs the operation's name/);
  assert.throws(() => parseNetwork([{ fail: "A", message: "" }], "s"), /message must be the text of the error/);
  assert.throws(() => parseNetwork([{ answer: "A" }], "s"), /answer needs "data"/);
  assert.throws(() => parseNetwork([{ answer: "A", data: null, errors: [] }], "s"), /errors must be a non-empty list of error objects/);
  assert.throws(() => parseNetwork([{ answer: "A", data: null, errors: ["refused"] }], "s"), /errors must be a non-empty list of error objects/);
});

test("an operation gets one rule: naming it twice is refused, and says where the first one is", () => {
  assert.throws(() => parseNetwork([{ hold: "A" }, { answer: "A", data: null }], "s"), /network\[1\] answer names A, which network\[0\] already handles/);
});

test("`writes` belongs to the canvas, takes `abort` (the default) or `allow`, and is declared once", () => {
  assert.throws(() => parseNetwork([{ writes: "abort" }], "task-loading"), /task-loading: network\[0\] writes is declared once, on the canvas/);
  assert.throws(() => parseNetwork([{ writes: "allow" }], "task-loading"), /writes is declared once, on the canvas/);
  assert.throws(() => parseNetwork([{ writes: true }], "the canvas", { canvas: true }), /writes takes "abort" \(the default/);
  assert.throws(() => parseNetwork([{ writes: "abort" }, { writes: "abort" }], "the canvas", { canvas: true }), /writes is declared twice/);
  parseNetwork([{ writes: "allow" }], "the canvas", { canvas: true });
  assert.equal(writesPolicy(), "allow", "a canvas that says allow turns the context guard off");
  parseNetwork([{ hold: "A" }], "the canvas", { canvas: true });
  assert.equal(writesPolicy(), "abort", "a canvas that says nothing is guarded");
  parseNetwork([{ writes: "abort" }], "the canvas", { canvas: true });
  assert.equal(writesPolicy(), "abort");
});

test("a list longer than twelve is a mock server and is refused", () => {
  assert.equal(MAX_RULES, 12);
  const twelve = Array.from({ length: 12 }, (_, at) => ({ hold: `Op${at}` }));
  assert.equal(parseNetwork(twelve, "s").length, 12);
  assert.throws(() => parseNetwork([...twelve, { hold: "Op12" }], "s"), /13 network rules is a mock server/);
});

test("rules read as words, and as a signature that ignores order and `writes`", () => {
  assert.equal(describeRule({ hold: "A" }), "hold A");
  assert.equal(describeRule({ answer: "B", data: null }), "answer B");
  assert.equal(describeRule({ writes: "abort" }), "writes abort");
  assert.equal(describeNetwork([{ hold: "A" }, { fail: "B" }]), "hold A, fail B");
  assert.equal(describeNetwork(undefined), "");
  assert.equal(networkSignature([{ fail: "B" }, { hold: "A" }, { writes: "abort" }]), "fail B, hold A");
  assert.equal(networkSignature([{ hold: "A" }, { fail: "B" }]), networkSignature([{ fail: "B" }, { hold: "A" }]), "the same rules in another order are the same picture");
  assert.equal(networkSignature(undefined), "");
});

test("hasNetwork says whether anything is declared at either level", () => {
  assert.equal(hasNetwork(undefined, undefined), false);
  assert.equal(hasNetwork([], []), false);
  assert.equal(hasNetwork([{ writes: "abort" }], undefined), true);
  assert.equal(hasNetwork(undefined, [{ hold: "A" }]), true);
});

test("a frame runs under the canvas's rules and its own, its own replacing the canvas's for one operation", () => {
  const merged = mergeNetwork([{ writes: "abort" }, { answer: "Telemetry", data: null }, { hold: "Shared" }], [{ fail: "Shared" }, { hold: "List" }]);
  assert.deepEqual(
    merged.rules.map((rule) => [rule.op, rule.kind, rule.scope, rule.required]),
    [
      ["Telemetry", "answer", "canvas", false],
      ["Shared", "fail", "screen", true],
      ["List", "hold", "screen", true],
    ],
  );
  assert.deepEqual(mergeNetwork(undefined, undefined), { rules: [] });
  assert.deepEqual(mergeNetwork([{ writes: "allow" }], undefined), { rules: [] }, "the write policy is the context guard's, not a rule");
  assert.deepEqual(mergeNetwork(undefined, [{ hold: "/api/trips" }]).rules.map((rule) => [rule.op, rule.url]), [["/api/trips", true]], "a value with a / is an address");
});

/* ------------------------------------------------------------------ reading a request */

test("listOperations reads the operations at the top of a document and nothing inside one", () => {
  assert.deepEqual(listOperations("query TaskList($page: Int = 1) { taskList(page: $page) { id } }"), [{ type: "query", name: "TaskList" }]);
  assert.deepEqual(listOperations("mutation SaveJob($input: JobInput!) { saveJob(input: $input) { id } }"), [{ type: "mutation", name: "SaveJob" }]);
  assert.deepEqual(listOperations("{ viewer { id } }"), [{ type: "query", name: null }], "the shorthand is an anonymous query");
  assert.deepEqual(listOperations("query { viewer { id } }"), [{ type: "query", name: null }]);
  assert.deepEqual(listOperations("mutation { save }"), [{ type: "mutation", name: null }]);
  assert.deepEqual(listOperations("subscription Live { tick }"), [{ type: "subscription", name: "Live" }]);
  assert.deepEqual(
    listOperations("query A { a } mutation B { b }"),
    [
      { type: "query", name: "A" },
      { type: "mutation", name: "B" },
    ],
  );
  assert.deepEqual(listOperations("fragment Bits on Job { id } query Jobs { jobs { ...Bits } }"), [{ type: "query", name: "Jobs" }], "a fragment is not an operation");
  assert.deepEqual(listOperations("# mutation Sneaky { x }\nquery Real { a }"), [{ type: "query", name: "Real" }], "a comment is not an operation");
  assert.deepEqual(listOperations('query Q { search(term: "mutation Sneaky { x }") { id } }'), [{ type: "query", name: "Q" }], "a string is not an operation");
  assert.deepEqual(listOperations('query Q { search(term: """a "mutation" b""") { id } }'), [{ type: "query", name: "Q" }], "a block string is not an operation");
  assert.deepEqual(listOperations("query Q { mutation { id } }"), [{ type: "query", name: "Q" }], "a field called mutation is not an operation");
  assert.deepEqual(listOperations("query Q($o: In = { a: 1 }) { a }"), [{ type: "query", name: "Q" }], "braces inside the variable definitions are not the selection");
  assert.deepEqual(listOperations(""), []);
  assert.deepEqual(listOperations(undefined), []);
});

const request = ({ method = "POST", url = "http://app.test/api/graphql", body, headers = {}, type = "fetch" } = {}) => ({
  method: () => method,
  url: () => url,
  postData: () => (body === undefined ? null : typeof body === "string" ? body : JSON.stringify(body)),
  headers: () => headers,
  resourceType: () => type,
});

test("operationsOf reads a POST by its operationName, or by the name in the document when the body names none", () => {
  assert.deepEqual(operationsOf(request({ body: { operationName: "TaskList", query: "query TaskList { a }", variables: {} } })), [{ type: "query", name: "TaskList" }]);
  assert.deepEqual(operationsOf(request({ body: { query: "query TaskList { a }" } })), [{ type: "query", name: "TaskList" }], "some reads go out unnamed: the document names them");
  assert.deepEqual(operationsOf(request({ body: { operationName: null, query: "mutation SaveJob { a }" } })), [{ type: "mutation", name: "SaveJob" }]);
  assert.deepEqual(operationsOf(request({ body: { operationName: "B", query: "query A { a } mutation B { b }" } })), [{ type: "mutation", name: "B" }], "the named operation of a document with several");
  assert.deepEqual(operationsOf(request({ body: { query: "mutation { save }" } })), [{ type: "mutation", name: null }], "an unnamed mutation is still a mutation");
  assert.deepEqual(operationsOf(request({ body: { query: "{ viewer { id } }" } })), [{ type: "query", name: null }]);
});

test("operationsOf reads a persisted query by its name alone, with a type it does not know", () => {
  assert.deepEqual(operationsOf(request({ body: { operationName: "SaveJob", extensions: { persistedQuery: { version: 1, sha256Hash: "x" } } } })), [{ type: "unknown", name: "SaveJob" }]);
});

test("operationsOf reads a GET from the address, which is how urql sends a read it wants cached", () => {
  const query = encodeURIComponent("query ContactList($p: Int) { contactList(page: $p) { total } }");
  assert.deepEqual(operationsOf(request({ method: "GET", url: `http://app.test/graphql?query=${query}&variables=%7B%7D` })), [{ type: "query", name: "ContactList" }]);
  assert.deepEqual(operationsOf(request({ method: "GET", url: `http://app.test/graphql?operationName=Persisted&extensions=%7B%7D` })), [{ type: "unknown", name: "Persisted" }]);
  assert.deepEqual(operationsOf(request({ method: "GET", url: "http://app.test/graphql" })), []);
});

test("operationsOf reads a raw document body, a batch, and nothing that is not GraphQL", () => {
  assert.deepEqual(operationsOf(request({ body: "mutation Raw { x }" })), [{ type: "mutation", name: "Raw" }], "application/graphql: the body is the document");
  assert.deepEqual(operationsOf(request({ body: [{ query: "query A { a }" }, { query: "mutation B { b }" }] })), [
    { type: "query", name: "A" },
    { type: "mutation", name: "B" },
  ]);
  assert.deepEqual(operationsOf(request({ body: { hello: "world" } })), []);
  assert.deepEqual(operationsOf(request({ body: "" })), []);
  assert.deepEqual(operationsOf(request({ method: "OPTIONS" })), []);
});

test("a request is GraphQL when its path says so, and only its path", () => {
  assert.equal(isGraphqlUrl(new URL("http://app.test/api/graphql")), true);
  assert.equal(isGraphqlUrl(new URL("http://app.test/GraphQL?x=1")), true);
  assert.equal(isGraphqlUrl(new URL("http://app.test/static/chunk.js?note=graphql")), false);
  assert.equal(isGraphqlUrl(new URL("http://app.test/library")), false);
});

/* ------------------------------------------------------------------ deciding */

const op = (type, name) => ({ type, name });

test("decide: a rule for the one GraphQL operation a request carries wins, everything else goes on to the write guard", () => {
  const merged = mergeNetwork([{ writes: "abort" }], [{ hold: "Held" }, { fail: "Failed" }, { answer: "Answered", data: null }, { answer: "SaveRefused", data: null, errors: [{ message: "no" }] }]);
  const gql = (body) => request({ body });
  assert.deepEqual(decide(gql({ query: "{ a }" }), merged), { action: "continue" }, "an unnamed read cannot match a rule");
  assert.equal(decide(gql({ operationName: "Held", query: "query Held { a }" }), merged).action, "hold");
  assert.equal(decide(gql({ operationName: "Failed", query: "query Failed { a }" }), merged).action, "fail");
  assert.equal(decide(gql({ operationName: "Answered", query: "query Answered { a }" }), merged).action, "answer");
  assert.equal(decide(gql({ operationName: "Other", query: "query Other { a }" }), merged).action, "continue");
  assert.equal(decide(gql({ operationName: "SaveRefused", query: "mutation SaveRefused { a }" }), merged).action, "answer", "a rule for a mutation answers it: the screen shows the refusal");
  assert.equal(decide(gql({ operationName: "SaveJob", query: "mutation SaveJob { a }" }), merged).action, "continue", "a save with no rule is the write guard's to abort");
  assert.equal(decide(gql([{ query: "query Held { a }" }, { query: "query Other { b }" }]), merged).action, "continue", "a batch is never answered or held");
  assert.equal(decide(request({ url: "http://app.test/api/tasks", body: { operationName: "Held", query: "query Held { a }" } }), merged).action, "continue", "not a GraphQL address");
});

test("decide: a rule on an address matches a fetch or XHR whose address contains it, and nothing else", () => {
  const merged = mergeNetwork(undefined, [{ hold: "/api/trips" }, { answer: "/api/user", data: { name: "A" } }]);
  assert.equal(decide(request({ method: "GET", url: "http://app.test/api/trips?page=2" }), merged).action, "hold");
  assert.equal(decide(request({ method: "GET", url: "http://app.test/api/user", type: "xhr" }), merged).action, "answer");
  assert.equal(decide(request({ method: "GET", url: "http://app.test/api/trips", type: "document" }), merged).action, "continue", "a page load is never held");
  assert.equal(decide(request({ method: "GET", url: "http://app.test/api/other" }), merged).action, "continue");
});

test("a rule on an address is validated like any other, and takes no GraphQL errors", () => {
  assert.deepEqual(parseNetwork([{ hold: "/api/trips" }, { fail: "api.test/v1/", message: "Offline" }, { answer: "/api/user", data: [] }], "trips"), [
    { hold: "/api/trips" },
    { fail: "api.test/v1/", message: "Offline" },
    { answer: "/api/user", data: [] },
  ]);
  assert.throws(() => parseNetwork([{ answer: "/api/user", errors: [{ message: "no" }] }], "trips"), /trips: network\[0\] errors is for a GraphQL operation/);
  assert.throws(() => parseNetwork([{ hold: "trips list" }], "trips"), /or a part of the request's address with a \/ in it/);
});

test("bodyOf says what the server would have said", () => {
  assert.deepEqual(bodyOf({ kind: "fail", op: "A" }), { data: null, errors: [{ message: DEFAULT_FAIL_MESSAGE }] });
  assert.deepEqual(bodyOf({ kind: "fail", op: "A", message: "Offline" }), { data: null, errors: [{ message: "Offline" }] });
  assert.deepEqual(bodyOf({ kind: "answer", op: "A", data: { list: [] } }), { data: { list: [] } });
  assert.deepEqual(bodyOf({ kind: "answer", op: "A", data: null }), { data: null });
  assert.deepEqual(bodyOf({ kind: "answer", op: "A", errors: [{ message: "no" }] }), { data: null, errors: [{ message: "no" }] });
  assert.deepEqual(bodyOf({ kind: "answer", op: "A", data: null, errors: [{ message: "no" }] }), { data: null, errors: [{ message: "no" }] });
  assert.deepEqual(bodyOf({ kind: "answer", op: "/api/a", url: true, data: [] }), [], "an address is answered with the data as the body");
  assert.deepEqual(bodyOf({ kind: "fail", op: "/api/a", url: true }), { error: DEFAULT_FAIL_MESSAGE });
});

/* ------------------------------------------------------------------ a page, with fakes */

/** A page that records what was routed and lets a test send requests through the handler. */
function fakePage() {
  const page = new EventEmitter();
  page.routes = [];
  page.route = async (matcher, handler) => {
    page.routes.push({ matcher, handler });
  };
  page.off = page.removeListener.bind(page);
  return page;
}

/** A route that records what the handler did with the request. */
function fakeRoute(req, { failFulfill = false } = {}) {
  const calls = [];
  return {
    calls,
    request: () => req,
    continue: async () => calls.push({ do: "continue" }),
    fallback: async () => calls.push({ do: "fallback" }),
    abort: async () => calls.push({ do: "abort" }),
    fulfill: async (options) => {
      if (failFulfill) throw new Error("Target page, context or browser has been closed");
      calls.push({ do: "fulfill", ...options, body: JSON.parse(options.body) });
    },
  };
}

test("a page with no rules gets no route at all: saves are the context guard's", async () => {
  for (const canvas of [undefined, [{ writes: "abort" }], [{ writes: "allow" }]]) {
    const page = fakePage();
    const control = await applyNetwork(page, mergeNetwork(canvas, undefined));
    assert.equal(page.routes.length, 0);
    assert.deepEqual(control.report(), []);
    assert.deepEqual(control.unmet(), []);
  }
});

test("the route sees GraphQL requests only, and the handler does what the rule says", async () => {
  const page = fakePage();
  const control = await applyNetwork(
    page,
    mergeNetwork([{ writes: "abort" }], [{ hold: "Held" }, { fail: "Failed", message: "Offline" }, { answer: "Answered", data: { list: [] } }]),
  );
  assert.equal(page.routes.length, 1);
  const [{ matcher, handler }] = page.routes;
  assert.equal(matcher(new URL("http://app.test/api/graphql")), true);
  assert.equal(matcher(new URL("http://app.test/library")), false);

  const send = async (options, extra) => {
    const route = fakeRoute(request(options), extra);
    await handler(route);
    return route.calls;
  };
  const query = (name) => ({ body: { operationName: name, query: `query ${name} { a }` } });

  assert.deepEqual(await send(query("Held")), [], "a held request is neither answered nor continued: it waits for ever");
  assert.deepEqual(await send(query("Failed")), [
    { do: "fulfill", status: 200, contentType: "application/json", headers: {}, body: { data: null, errors: [{ message: "Offline" }] } },
  ]);
  assert.deepEqual(await send(query("Answered")), [{ do: "fulfill", status: 200, contentType: "application/json", headers: {}, body: { data: { list: [] } } }]);
  assert.deepEqual(await send(query("Untouched")), [{ do: "fallback" }], "a read falls back to the context's write guard, which lets it through");
  assert.deepEqual(await send({ method: "OPTIONS" }), [{ do: "fallback" }], "a preflight is left to the context guard, which lets it through");
  assert.deepEqual(await send({ body: { operationName: "SaveJob", query: "mutation SaveJob { a }" } }), [{ do: "fallback" }], "a save falls back to the context's write guard, which aborts it");
  assert.equal(control.hits.get("Held"), 1);
  assert.equal(control.hits.get("Failed"), 1);
  assert.equal(control.hits.get("Answered"), 1);
  assert.deepEqual(control.unmet(), []);
  assert.deepEqual(control.report(), [
    { rule: "hold Held", scope: "screen", hits: 1 },
    { rule: "fail Failed", scope: "screen", hits: 1 },
    { rule: "answer Answered", scope: "screen", hits: 1 },
  ]);
  assert.equal(describeHits(control), "hold Held x1, fail Failed x1, answer Answered x1");
});

test("the route sees the addresses its rules name, and answers them with their own status and body", async () => {
  const page = fakePage();
  const control = await applyNetwork(page, mergeNetwork(undefined, [{ fail: "/api/trips", message: "Offline" }, { answer: "/api/user", data: { name: "A" } }]));
  const [{ matcher, handler }] = page.routes;
  assert.equal(matcher(new URL("http://app.test/api/trips?x=1")), true);
  assert.equal(matcher(new URL("http://app.test/api/graphql")), true);
  assert.equal(matcher(new URL("http://app.test/photo.png")), false);
  const send = async (options) => {
    const route = fakeRoute(request(options));
    await handler(route);
    return route.calls;
  };
  assert.deepEqual(await send({ method: "GET", url: "http://app.test/api/trips" }), [{ do: "fulfill", status: 500, contentType: "application/json", headers: {}, body: { error: "Offline" } }]);
  assert.deepEqual(await send({ method: "GET", url: "http://app.test/api/user" }), [{ do: "fulfill", status: 200, contentType: "application/json", headers: {}, body: { name: "A" } }]);
  assert.deepEqual(control.unmet(), []);
  assert.equal(describeHits(control), "fail /api/trips x1, answer /api/user x1");
});

test("a page is holding only once a hold rule has been hit, so a canvas-wide hold on something it never asked for does not make it a loading frame", async () => {
  const page = fakePage();
  const control = await applyNetwork(page, mergeNetwork([{ hold: "CanvasWide" }], [{ hold: "Held" }, { answer: "Answered", data: null }]));
  assert.equal(control.holding(), false, "nothing has been asked yet");
  const query = (name) => request({ body: { operationName: name, query: `query ${name} { a }` } });
  await page.routes[0].handler(fakeRoute(query("Answered")));
  assert.equal(control.holding(), false, "an answered request is not a held one");
  await page.routes[0].handler(fakeRoute(query("Held")));
  assert.equal(control.holding(), true);
  const other = await applyNetwork(fakePage(), mergeNetwork([{ hold: "CanvasWide" }], []));
  assert.equal(other.holding(), false, "a canvas-wide hold that the page never triggered holds nothing");
});

test("dispose aborts every held request before its page closes, once, and never touches a request that was answered", async () => {
  const page = fakePage();
  const control = await applyNetwork(page, mergeNetwork(undefined, [{ hold: "Held" }, { answer: "Answered", data: null }]));
  const query = (name) => request({ body: { operationName: name, query: `query ${name} { a }` } });
  const heldOne = fakeRoute(query("Held"));
  const heldTwo = fakeRoute(query("Held"));
  const answered = fakeRoute(query("Answered"));
  for (const route of [heldOne, heldTwo, answered]) await page.routes[0].handler(route);
  assert.deepEqual(heldOne.calls, [], "held: not continued, not aborted yet");
  await control.dispose();
  assert.deepEqual(heldOne.calls, [{ do: "abort" }], "a page closed with a request still paused lets the browser send it, so it is aborted first");
  assert.deepEqual(heldTwo.calls, [{ do: "abort" }]);
  assert.deepEqual(answered.calls.map((call) => call.do), ["fulfill"]);
  await control.dispose();
  assert.deepEqual(heldOne.calls, [{ do: "abort" }], "a second call has nothing left to abort");
  const none = await applyNetwork(fakePage(), mergeNetwork(undefined, undefined));
  await none.dispose();
});

test("an answer carries the CORS headers when the API is on another origin, and none when it is not", async () => {
  const page = fakePage();
  await applyNetwork(page, mergeNetwork(undefined, [{ answer: "List", data: { list: [] } }]));
  const route = fakeRoute(request({ body: { operationName: "List", query: "query List { a }" }, headers: { origin: "http://app.test:3042" } }));
  await page.routes[0].handler(route);
  assert.deepEqual(route.calls[0].headers, { "access-control-allow-origin": "http://app.test:3042", "access-control-allow-credentials": "true", vary: "Origin" });
});

test("a rule the page never asked for is unmet, with the claim the manifest records; a canvas-wide rule is never required", async () => {
  const page = fakePage();
  const control = await applyNetwork(page, mergeNetwork([{ hold: "CanvasWide" }], [{ hold: "Held" }, { fail: "Failed" }, { answer: "Answered", data: null }]));
  assert.deepEqual(
    control.unmet().map(unmetClaim),
    ["the page asked for Held and the capture held it", "the page asked for Failed and the capture failed it", "the page asked for Answered and the capture answered it"],
    "the canvas-wide rule proves nothing, so it is not listed",
  );
  const route = fakeRoute(request({ body: { operationName: "Held", query: "query Held { a }" } }));
  await page.routes[0].handler(route);
  assert.equal(control.unmet().length, 2);
});

test("a handler that cannot answer because the page went away falls back to the context guard quietly and throws nothing", async () => {
  const page = fakePage();
  await applyNetwork(page, mergeNetwork(undefined, [{ answer: "List", data: null }]));
  const route = fakeRoute(request({ body: { operationName: "List", query: "query List { a }" } }), { failFulfill: true });
  await page.routes[0].handler(route);
  assert.deepEqual(route.calls, [{ do: "fallback" }], "never a continue: an error in the handler must not be the way a save gets out");
});

/* ------------------------------------------------------------------ the quiet wait */

test("the tracker waits for fetches and XHR to finish, and ignores everything else", async () => {
  const page = fakePage();
  const tracker = trackRequests(page);
  const fetchOne = request({ type: "fetch", url: "http://app.test/api/graphql" });
  const image = request({ type: "image", url: "http://app.test/a.png" });
  page.emit("request", image);
  assert.deepEqual(tracker.pending(), [], "an image is the load wait's business");
  page.emit("request", fetchOne);
  assert.deepEqual(tracker.pending(), ["http://app.test/api/graphql"]);
  setTimeout(() => page.emit("requestfinished", fetchOne), 120);
  const startedAt = Date.now();
  const result = await tracker.quiet({ quietMs: 80, capMs: 3000 });
  assert.equal(result.quiet, true);
  assert.ok(Date.now() - startedAt >= 190, "it waited for the request, then for the quiet window");
  assert.deepEqual(tracker.pending(), []);
});

test("the tracker gives up at the cap and says what was still out", async () => {
  const page = fakePage();
  const tracker = trackRequests(page);
  const slow = request({ type: "xhr", url: "http://app.test/poll" });
  page.emit("request", slow);
  const result = await tracker.quiet({ quietMs: 50, capMs: 250 });
  assert.equal(result.quiet, false);
  assert.deepEqual(result.pending, ["http://app.test/poll"]);
  page.emit("requestfailed", slow);
  assert.equal((await tracker.quiet({ quietMs: 50, capMs: 2000 })).quiet, true);
});

test("a released request is never waited for, whichever of the two events arrives first", async () => {
  const page = fakePage();
  const tracker = trackRequests(page);
  const heldAfter = request({ type: "fetch", url: "http://app.test/graphql?a" });
  const heldBefore = request({ type: "fetch", url: "http://app.test/graphql?b" });
  page.emit("request", heldAfter);
  tracker.release(heldAfter);
  tracker.release(heldBefore);
  page.emit("request", heldBefore);
  assert.deepEqual(tracker.pending(), []);
  assert.equal((await tracker.quiet({ quietMs: 50, capMs: 1000 })).quiet, true);
});

test("a request held open forever stops counting after the long-lived threshold, and a fresh one is still waited for", async () => {
  const page = fakePage();
  const tracker = trackRequests(page, { longLivedMs: 300 });
  const forever = request({ type: "fetch", body: { operationName: "Stream", query: "subscription Stream { a }" } });
  const fresh = request({ type: "fetch", body: { operationName: "List", query: "query List { a }" } });
  const startedAt = Date.now();
  page.emit("request", forever);
  setTimeout(() => page.emit("request", fresh), 200);
  /* Open for 250ms, under the threshold: the stream crosses it at 300, and the wait must still be on the read until 450. */
  setTimeout(() => page.emit("requestfinished", fresh), 450);
  const result = await tracker.quiet({ quietMs: 80, capMs: 3000 });
  const took = Date.now() - startedAt;
  assert.equal(result.quiet, true, "the stream alone never makes the wait run to its cap");
  assert.ok(took >= 520, `the fresh read was waited for, and the quiet window after it (${took}ms)`);
  assert.ok(took < 1500, `and nothing waited on the stream past its threshold (${took}ms)`);
  assert.deepEqual(result.ignored, ["POST http://app.test/api/graphql Stream"], "what it stopped waiting for is named");
  assert.deepEqual(tracker.pending(), ["http://app.test/api/graphql"], "the stream is still open: it is skipped, not forgotten");
});

test("a page whose only request never finishes goes quiet at the threshold, not at the cap", async () => {
  const page = fakePage();
  const tracker = trackRequests(page, { longLivedMs: 300 });
  page.emit("request", request({ type: "xhr", url: "http://app.test/poll?since=1" }));
  const startedAt = Date.now();
  const result = await tracker.quiet({ quietMs: 50, capMs: 5000 });
  assert.equal(result.quiet, true);
  assert.ok(Date.now() - startedAt < 1000, "the threshold, not the five second cap");
  assert.deepEqual(result.ignored, ["POST http://app.test/poll"], "the cursor in the query string is not part of what the request is");
});

test("a channel still open when its page is done is learned for the run; a slow read that finished is not", async () => {
  const longLived = new Set();
  const first = fakePage();
  const control = await applyNetwork(first, mergeNetwork(undefined, undefined), { longLived });
  const stream = () => request({ type: "fetch", body: { operationName: "Stream", query: "subscription Stream { a }" } });
  const slow = request({ type: "fetch", body: { operationName: "SlowList", query: "query SlowList { a }" } });
  first.emit("request", stream());
  first.emit("request", slow);
  await new Promise((done) => setTimeout(done, 80));
  first.emit("requestfinished", slow);
  /* The threshold has not passed yet: nothing is learned from a page that was not open long enough to tell. */
  assert.deepEqual(control.tracker.learn(), []);
  const late = trackRequests(fakePage(), { longLived, longLivedMs: 50 });
  assert.equal(late.learn().length, 0, "a tracker with nothing open learns nothing");
  const page = fakePage();
  const tracker = trackRequests(page, { longLived, longLivedMs: 50 });
  page.emit("request", stream());
  page.emit("request", slow);
  page.emit("requestfinished", slow);
  await new Promise((done) => setTimeout(done, 80));
  assert.deepEqual(tracker.learn(), ["POST http://app.test/api/graphql Stream"], "only the request still open");
  assert.ok(!longLived.has("POST http://app.test/api/graphql SlowList"));
  /* The next frame of the run does not wait for the learned channel at all, not even to the threshold. */
  const next = fakePage();
  const nextTracker = trackRequests(next, { longLived, longLivedMs: 5000 });
  next.emit("request", stream());
  const startedAt = Date.now();
  const result = await nextTracker.quiet({ quietMs: 50, capMs: 3000 });
  assert.equal(result.quiet, true);
  assert.ok(Date.now() - startedAt < 500, "a learned channel costs one quiet window, not the threshold");
});

test("the controller's dispose learns what was still open into the run's set", async () => {
  const longLived = new Set();
  const page = fakePage();
  const control = await applyNetwork(page, mergeNetwork(undefined, undefined), { longLived });
  page.emit("request", request({ type: "fetch", body: { operationName: "Stream", query: "subscription Stream { a }" } }));
  await control.dispose();
  assert.equal(longLived.size, 0, "open for less than the threshold: not learned");
  assert.equal(LONG_LIVED_MS, 6000, "the threshold the capture, the preflight and the oracle share");
});

test("a request's signature is its method, its address without the query and its operation names", () => {
  const list = request({ body: { operationName: "List", query: "query List { a }" } });
  const other = request({ body: { operationName: "Other", query: "query Other { a }" } });
  assert.notEqual(requestSignature(list), requestSignature(other), "two reads to one endpoint are two things");
  assert.equal(requestSignature(request({ method: "GET", url: "http://app.test/events?cursor=9" })), "GET http://app.test/events");
  assert.equal(requestSignature(request({ url: "not a url" })), "POST not a url");
});

test("the quiet wait has one pair of numbers, shared by the capture, the preflight and the oracle", () => {
  assert.equal(QUIET_MS, 400);
  assert.equal(QUIET_CAP_MS, 10_000);
});

/* ------------------------------------------------------------------ the preflight's rules about network */

const frame = (id, extra = {}) => ({ id, flowId: "f", url: "/tasks", ...extra });
const decl = (screens) => ({ screens, groups: [{ id: "f", edges: [] }], explorations: [], kinds: [] });

test("a loading, an empty and a failed list share one route and are three pictures, not one picture three times", () => {
  const problems = lintDeclaration(
    decl([
      frame("tasks"),
      frame("tasks-loading", { network: [{ hold: "TaskList" }] }),
      frame("tasks-empty", { network: [{ answer: "TaskList", data: { list: [] } }] }),
      frame("tasks-error", { network: [{ fail: "TaskList" }] }),
    ]),
  );
  assert.deepEqual(problems, []);
});

test("two answers of one operation are different pictures when they say different things, and one picture when they say the same", () => {
  const empty = { answer: "TaskList", data: { list: [] } };
  const one = { answer: "TaskList", data: { list: [{ id: 1 }] } };
  assert.deepEqual(lintDeclaration(decl([frame("a", { network: [empty] }), frame("b", { network: [one] })])), []);
  assert.deepEqual(lintDeclaration(decl([frame("a", { network: [empty] }), frame("b", { network: [{ ...empty }] })])), ["b and a are both /tasks with answer TaskList, so they are one picture twice"]);
  assert.deepEqual(
    lintDeclaration(decl([frame("a", { network: [{ hold: "X" }, { fail: "Y" }] }), frame("b", { network: [{ fail: "Y" }, { hold: "X" }] })])),
    ["b and a are both /tasks with fail Y, hold X, so they are one picture twice"],
    "the same rules in another order are the same picture, and the message says which rules",
  );
  assert.notEqual(networkKey([{ fail: "Y", message: "Offline" }]), networkKey([{ fail: "Y" }]), "the error text the app may print is part of the picture");
  assert.equal(networkKey([{ writes: "abort" }]), "", "`writes` changes no picture");
  /* Steps and rules together: the same route with the same steps and different rules is still two pictures. */
  assert.deepEqual(lintDeclaration(decl([frame("a", { steps: [{ click: "Open" }], network: [{ hold: "X" }] }), frame("b", { steps: [{ click: "Open" }], network: [{ fail: "X" }] })])), []);
});

test("lintNetwork refuses what the capture refuses, and a rule on a frame that asks for no data", () => {
  assert.deepEqual(lintNetwork([frame("a", { network: [{ hold: "A" }] })], [{ writes: "abort" }]), []);
  assert.deepEqual(lintNetwork([frame("a")], undefined), []);
  const problems = lintNetwork(
    [
      frame("bad-rule", { network: [{ wait: "A" }] }),
      frame("writes-here", { network: [{ writes: "abort" }] }),
      frame("a-wireframe", { wireframe: true, network: [{ hold: "A" }] }),
      frame("a-still", { still: true, network: [{ hold: "A" }] }),
      frame("an-explanation", { url: null, explain: "Outside the app.", network: [{ hold: "A" }] }),
    ],
    [{ writes: "block" }],
  );
  assert.equal(problems.length, 6, problems.join("\n"));
  assert.match(problems[0], /^the canvas: network\[0\] writes takes "abort" \(the default/);
  assert.match(problems[1], /^bad-rule: network\[0\] has an unknown rule "wait"/);
  assert.match(problems[2], /^writes-here: network\[0\] writes is declared once, on the canvas/);
  for (const line of problems.slice(3)) assert.match(line, /network rules on a frame that is not a page of the app \(an explanation, a wireframe or a still\) have nothing to act on/);
});
