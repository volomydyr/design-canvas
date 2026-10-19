/**
 * design-canvas CORE — comment persistence, as files in the repo.
 *
 * DEV ONLY: every method 404s in production. It exists so design feedback lands where an agent can read it directly.
 *
 * A COMMENT IS TWO FILES. The record in `comments/<slug>.json` says which screen, which route, which pinned state and which
 * rectangle; beside it, `comments/<slug>/<id>.png` is the captured screen with that rectangle drawn on it, so the agent
 * opens the picture and sees the outline. The canvas draws that picture in the browser, so nothing here needs an image
 * library. Reading, writing and the history live in `comment-file.mjs`, shared with the tools that write the same file.
 *
 * Generic: no knowledge of what the canvas is showing. The whole file goes with the folder.
 */

import { execFileSync, spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  promises as fs,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";

import {
  commentPaths,
  type CommentPaths,
  nextCommentId,
  readCommentFile,
  writeCommentFile,
} from "./comment-file.mjs";
import {
  CANVAS_SLUG,
  type CanvasComment,
  type CanvasCommentFile,
  canvasHidden,
  CANVAS_PUBLISHED,
} from "./types";

/* Kept for route stubs written by earlier installs, which re-export these two. Node, not edge: this route writes files;
   never cached: the file changes under the canvas while it is open. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The canvas named on the request, or `main` when none is. Validated with a whitelist because it reaches a filesystem
 * path; null means malformed.
 */
function slugOf(request: Request): string | null {
  const raw = new URL(request.url).searchParams.get("canvas");
  if (!raw) return "main";
  return CANVAS_SLUG.test(raw) ? raw : null;
}

/** A canvas's review paths, beside the tool: the whole folder is one thing to gitignore or delete. */
const pathsFor = (slug: string): CommentPaths =>
  commentPaths(path.join(process.cwd(), "design-canvas"), slug);

/**
 * THE PREDEFINED WORDS A VERDICT CARRIES, so the file reads as instructions rather than as a bare enum. The round a verdict
 * drives: drop the disliked options, work on the comments left, and build three more variations of each liked option.
 */
const VERDICT_NOTE = {
  like: "Liked. Keep this direction and build three variations of it.",
  dislike: "Disliked. Drop this option.",
} as const;

/**
 * Apply a verdict to a comment list. PURE, and exported for the tests. A screen holds at most one verdict: a new one
 * replaces it, `null` removes it, and a note on the same screen is never touched.
 */
export function withVerdict(
  comments: CanvasComment[],
  verdict: {
    screenId: string;
    value: "like" | "dislike" | null;
    id: string;
    flowId?: string;
    label?: string;
    route?: string;
    state?: string | null;
    image?: string;
    at: string;
  },
): CanvasComment[] {
  const kept = comments.filter(
    (one) =>
      !(
        one.screenId === verdict.screenId &&
        (one.kind === "like" || one.kind === "dislike")
      ),
  );
  if (verdict.value === null) return kept;
  return [
    ...kept,
    {
      id: verdict.id,
      kind: verdict.value,
      flowId: verdict.flowId ?? "",
      screenId: verdict.screenId,
      label: verdict.label ?? verdict.screenId,
      route: verdict.route ?? "",
      state: verdict.state ?? null,
      /* The whole frame: a verdict is about the option, not about a rectangle inside it. */
      region: { xPct: 0, yPct: 0, wPct: 100, hPct: 100 },
      /* The screen's own shot. Nothing is drawn on it, because there is no region to outline. */
      image: verdict.image ?? "",
      note: VERDICT_NOTE[verdict.value],
      createdAt: verdict.at,
    },
  ];
}

/**
 * THE REVIEWER'S FIRST VISIT. PURE, and exported for the tests. The marks a canvas collects while it is being built are noise
 * to someone who has seen none of it, so the first visit records `viewedAt` and empties `waiting` in one write; from then on
 * the capture queues what arrives or changes. Null when the file already records a visit, so a second one writes nothing.
 */
export function firstVisit(file: CanvasCommentFile, at: string): CanvasCommentFile | null {
  return file.viewedAt ? null : { ...file, viewedAt: at, waiting: {} };
}

/**
 * A published (view-only) canvas may read and may never write. Reading answers an empty review, because the review file
 * is gitignored and absent from a deployment; a write is refused here and not only in the interface.
 */
function readOnly(): NextResponse | null {
  return CANVAS_PUBLISHED
    ? new NextResponse("This canvas is published read only: comments live where it was captured", {
        status: 405,
      })
    : null;
}

/**
 * EVERY MUTATION GOES THROUGH ONE QUEUE. Each handler reads the whole file, changes it and writes it back, so two of them
 * overlapping would lose an update. A promise chain rather than a lock: this route is one dev-mode process, and a
 * rejected job does not break the chain.
 */
let queue: Promise<unknown> = Promise.resolve();

function serialized<T>(job: () => Promise<T>): Promise<T> {
  const next = queue.then(job, job);
  queue = next.catch(() => undefined);
  return next;
}

/**
 * The one way a mutation refuses: ids that are not in this canvas's file. Thrown from inside the change callback, so it
 * lands before the write and a wrong request leaves no file behind.
 */
class UnknownIds extends Error {
  constructor(readonly missing: string[]) {
    super(`unknown comment ids: ${missing.join(", ")}`);
  }
}

/** Read, change, write, as one step nothing else can interleave with. `why` is the history's commit message. */
function mutate(
  paths: CommentPaths,
  change: (file: CanvasCommentFile) => Promise<CanvasCommentFile> | CanvasCommentFile,
  why: string,
): Promise<CanvasCommentFile> {
  return serialized(async () =>
    writeCommentFile(paths, await change(await readCommentFile(paths)), why),
  );
}

/**
 * THE ONLY SHAPE A COMMENT ID MAY HAVE, and the gate every filesystem path in this file goes through. A whitelist matching
 * exactly what `nextCommentId` mints (`c` plus digits), never a sanitizer: no separators, dots or encodings get through.
 */
const ID = /^c\d+$/;

/** A comment's picture, resolved and proven to be inside the images folder. */
function imagePath(paths: CommentPaths, id: string): string | null {
  if (!ID.test(id)) return null;
  const root = path.resolve(paths.images);
  const file = path.resolve(root, `${id}.png`);
  return file.startsWith(`${root}${path.sep}`) ? file : null;
}

/**
 * A CONSUMED VERDICT IS SPENT, SO IT IS DELETED: a like is not a question, and no press on the canvas could answer one.
 * Every consumed verdict in the file goes, not only the ones a request named. The history keeps the words.
 */
async function dropSpentVerdicts(
  paths: CommentPaths,
  comments: CanvasComment[],
): Promise<CanvasComment[]> {
  const spent = comments.filter(
    (one) => Boolean(one.kind) && one.kind !== "note" && Boolean(one.consumedAt),
  );
  if (spent.length === 0) return comments;
  await Promise.all(
    spent
      .map((one) => imagePath(paths, one.id))
      .filter((file): file is string => Boolean(file))
      .map((file) => fs.rm(file, { force: true })),
  );
  const gone = new Set(spent.map((one) => one.id));
  return comments.filter((one) => !gone.has(one.id));
}

/**
 * The annotated picture, written from the data URL the canvas drew. Repo-relative path back. Prefix and slice, never a
 * regex over the whole payload: a greedy capture over a multi-megabyte string overflows the stack.
 */
const PNG_URL = "data:image/png;base64,";

async function writeImage(
  paths: CommentPaths,
  id: string,
  dataUrl: string,
): Promise<string | null> {
  if (!dataUrl.startsWith(PNG_URL)) return null;
  const base64 = dataUrl.slice(PNG_URL.length);
  if (!base64) return null;
  const file = imagePath(paths, id);
  if (!file) return null;
  await fs.mkdir(paths.images, { recursive: true });
  await fs.writeFile(file, Buffer.from(base64, "base64"));
  return `${paths.imagesRel}/${id}.png`;
}

/**
 * WHICH CANVASES ARE OPEN RIGHT NOW. While its tab is visible, the canvas page reports which canvas, tab and device it shows and
 * which frames are on screen; a hidden tab reports that it is gone. The reports live in `design-canvas/rounds/viewing.json`
 * (scratch, like the rest of `rounds/`), and the recapture reads them to decide which frames to photograph and which first
 * (`openCanvases` in recapture.mjs, whose `VIEWING_TTL_MS` is the same span as the one here).
 *
 * A report is a request anyone who reaches the dev server can send, and an opening starts a process, so everything in it is
 * bounded: a canvas that has pictures on disk, short plain names, at most `MAX_VISIBLE` frame ids of `FRAME`'s shape, at most
 * `MAX_VIEWERS` viewers kept, and at most one refresh per canvas at a time and per `REFRESH_GAP_MS` (`mayStartRefresh`).
 */
const VIEWING_TTL_MS = 2 * 60 * 1000;
const REFRESH_GAP_MS = 30_000;
const MAX_VIEWERS = 20;
const MAX_VISIBLE = 200;
const VIEWER = /^[A-Za-z0-9-]{8,64}$/;
const FRAME = /^[A-Za-z0-9][\w.:-]{0,119}$/;
const WORD = /^[a-z-]{1,32}$/;

export type ViewingReport = { viewer?: string; tab?: string; device?: string; visible?: string[]; gone?: boolean };
export type ViewingFile = {
  viewers: Record<string, { canvas: string; tab: string | null; device: string | null; visible: string[]; at: string }>;
};

/**
 * One report applied to the viewing file. PURE, and exported for the tests. Expired reports are dropped, and only the newest
 * `MAX_VIEWERS` are kept; a `gone` report removes the viewer only when it was on this canvas, so a late "gone" from the canvas
 * just left never removes the one just opened. `opened` is true when no viewer had this canvas open before the report and the
 * report opens it: the moment its out-of-date frames refresh. Null for a malformed report.
 */
export function withViewing(
  file: ViewingFile | null,
  slug: string,
  report: ViewingReport,
  now: number,
): { file: ViewingFile; opened: boolean } | null {
  if (typeof report?.viewer !== "string" || !VIEWER.test(report.viewer)) return null;
  const fresh = Object.entries(file?.viewers ?? {})
    .filter(([id, one]) => VIEWER.test(id) && one && typeof one.canvas === "string" && now - Date.parse(one.at) < VIEWING_TTL_MS)
    .sort(([, a], [, b]) => Date.parse(b.at) - Date.parse(a.at));
  const viewers: ViewingFile["viewers"] = Object.fromEntries(fresh);
  const wasOpen = fresh.some(([, one]) => one.canvas === slug);
  if (report.gone) {
    if (viewers[report.viewer]?.canvas === slug) delete viewers[report.viewer];
    return { file: { viewers }, opened: false };
  }
  const word = (value: unknown) => (typeof value === "string" && WORD.test(value) ? value : null);
  const entry = {
    canvas: slug,
    tab: word(report.tab),
    device: word(report.device),
    visible: (Array.isArray(report.visible) ? report.visible : [])
      .slice(0, MAX_VISIBLE)
      .filter((id): id is string => typeof id === "string" && FRAME.test(id)),
    at: new Date(now).toISOString(),
  };
  const kept = Object.entries(viewers).filter(([id]) => id !== report.viewer).slice(0, MAX_VIEWERS - 1);
  return { file: { viewers: Object.fromEntries([[report.viewer, entry], ...kept]) }, opened: !wasOpen };
}

/**
 * May an opening start a refresh of its canvas? PURE, and exported for the tests. Not while a capture of the canvas holds its
 * lock, not while the last refresh started is still running, and not within `REFRESH_GAP_MS` of it, so a stream of reports
 * starts one process at most.
 */
export function mayStartRefresh({
  last,
  captureHolder,
  now,
  alive,
}: {
  last: { pid?: number; at?: string } | null;
  captureHolder: number | null;
  now: number;
  alive: (pid: number) => boolean;
}): boolean {
  if (captureHolder !== null && alive(captureHolder)) return false;
  if (!last) return true;
  if (typeof last.pid === "number" && alive(last.pid)) return false;
  const at = Date.parse(String(last.at));
  return !(Number.isFinite(at) && now - at < REFRESH_GAP_MS);
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
/**
 * The process that wrote a lock or a start record is still that process: alive, and started before the record was written. A
 * record outlives a crash or a reboot, after which its pid soon belongs to another process (`holderRunning` in recapture.mjs).
 */
const running = (record: { pid?: unknown; at?: unknown } | null): boolean => {
  if (!record || typeof record.pid !== "number" || !alive(record.pid)) return false;
  const at = Date.parse(String(record.at));
  if (!Number.isFinite(at)) return true;
  try {
    const started = Date.parse(execFileSync("ps", ["-o", "lstart=", "-p", String(record.pid)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim());
    return !Number.isFinite(started) || started <= at + 2000;
  } catch {
    return true;
  }
};
const readJson = <T,>(file: string): T | null => {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
};

/**
 * Record a report, synchronously, so two tabs reporting at once cannot interleave a read and a write. A canvas with no pictures
 * on disk is refused: it is no canvas of this project, or one never captured, and either way there is nothing to refresh. When
 * a report opens a canvas and `mayStartRefresh` allows it, `recapture.mjs --opened <slug>` starts in the background with fixed
 * arguments and the slug checked above; it checks this machine's answer to the install question itself and does nothing when
 * the canvas is current. A published view-only build never records or starts anything (PATCH refuses before this).
 */
function recordViewing(slug: string, report: ViewingReport): { status: number; error?: string } {
  if (CANVAS_PUBLISHED) return { status: 405, error: "this canvas is published read only" };
  const dir = path.join(process.cwd(), "design-canvas");
  if (!CANVAS_SLUG.test(slug) || !existsSync(path.join(dir, "shots", slug, "manifest.json")))
    return { status: 404, error: "no captured canvas has that slug" };
  const file = path.join(dir, "rounds", "viewing.json");
  const next = withViewing(readJson<ViewingFile>(file), slug, report, Date.now());
  if (!next) return { status: 400, error: "a viewing report needs a viewer id" };
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(next.file, null, 2)}\n`);
  const script = path.join(dir, "recapture.mjs");
  const started = path.join(dir, "rounds", slug, "opened.json");
  const last = readJson<{ pid?: number; at?: string }>(started);
  const lock = readJson<{ pid?: number; at?: string }>(path.join(dir, "rounds", slug, "capture.lock"));
  if (
    next.opened &&
    existsSync(script) &&
    mayStartRefresh({
      /* A record whose pid now belongs to another process is a refresh that ended. */
      last: last && !running(last) ? { at: last.at } : last,
      captureHolder: running(lock) ? (lock?.pid ?? null) : null,
      now: Date.now(),
      alive,
    })
  ) {
    mkdirSync(path.dirname(started), { recursive: true });
    const log = openSync(path.join(dir, "rounds", "recapture-log.txt"), "a");
    const child = spawn(process.execPath, [script, "--opened", slug], {
      cwd: process.cwd(),
      detached: true,
      stdio: ["ignore", log, log],
    });
    child.unref();
    closeSync(log);
    writeFileSync(started, `${JSON.stringify({ pid: child.pid ?? null, at: new Date().toISOString() })}\n`);
  }
  return { status: 200 };
}

/**
 * THE REVIEW ANSWERS ONLY THIS MACHINE, AND A WRITE COMES ONLY FROM THE CANVAS PAGE OR A TOOL.
 *
 * Any page the reviewer visits while the dev server runs can send requests here: a form or a `no-cors` fetch needs no preflight,
 * and a hostile domain that resolves to 127.0.0.1 (DNS rebinding) makes its requests look same-origin, with its own name in both
 * `Host` and `Origin`. So a request is answered only when its `Host` is a loopback name or address (`localhost`, `*.localhost`,
 * `127.x.x.x`, `[::1]`) or the host of the project's `appUrl` (design-canvas/settings.json), and a write also needs its `Origin`,
 * when a browser sends one, to be that same host, and `Sec-Fetch-Site`, when sent, to say same-origin. A tool (the capture, the
 * drain, the round, the oracle) sends neither and talks to the app's own address. Null when the request may go on, else why
 * not. PURE, and exported for the tests: `configured` is the `appUrl` host.
 */
export function refusal(request: Request, { write, configured = null }: { write: boolean; configured?: string | null }): string | null {
  const hostOf = (value: string | null | undefined): string | null => {
    if (!value) return null;
    try {
      return new URL(value.includes("://") ? value : `http://${value}`).host.toLowerCase();
    } catch {
      return null;
    }
  };
  const nameOf = (host: string) => new URL(`http://${host}`).hostname;
  const host = hostOf(request.headers.get("host") ?? new URL(request.url).host);
  const allowed = (one: string) => {
    const name = nameOf(one);
    return name === "localhost" || name.endsWith(".localhost") || /^127(?:\.\d{1,3}){3}$/.test(name) || name === "[::1]" || (configured !== null && name === configured.toLowerCase());
  };
  if (!host || !allowed(host)) return "this canvas answers only on this machine's own address or the project's appUrl";
  if (!write) return null;
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return "a write from another site is refused: comments come from the canvas page or a tool";
  const origin = request.headers.get("origin");
  if (origin !== null && hostOf(origin) !== host) return "a write from another site is refused: comments come from the canvas page or a tool";
  return null;
}

/** The project's `appUrl` host, read per request so a changed setting needs no restart. */
function configuredHost(): string | null {
  const settings = readJson<{ appUrl?: unknown }>(path.join(process.cwd(), "design-canvas", "settings.json"));
  if (typeof settings?.appUrl !== "string") return null;
  try {
    return new URL(settings.appUrl).hostname;
  } catch {
    return null;
  }
}

/** The 403 for a request `refusal` turns away, or null. A published build answers reads anywhere and refuses writes elsewhere. */
export function guard(request: Request, write: boolean): NextResponse | null {
  if (CANVAS_PUBLISHED) return null;
  const why = refusal(request, { write, configured: configuredHost() });
  return why ? NextResponse.json({ error: why }, { status: 403 }) : null;
}

/** A comment's picture travels in the body; nothing a reviewer draws comes near this. */
const MAX_BODY = 25 * 1024 * 1024;
const MAX_NOTE = 10_000;

/**
 * The JSON body of a write, or the response refusing it: JSON only (a cross-site form or `text/plain` post is not), and bounded.
 */
async function jsonBody<T>(request: Request): Promise<T | NextResponse> {
  if (!/^application\/json\b/i.test(request.headers.get("content-type") ?? ""))
    return NextResponse.json({ error: "the body must be application/json" }, { status: 415 });
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY) return NextResponse.json({ error: "the body is too large" }, { status: 413 });
  const text = await request.text();
  if (text.length > MAX_BODY) return NextResponse.json({ error: "the body is too large" }, { status: 413 });
  try {
    return JSON.parse(text) as T;
  } catch {
    return NextResponse.json({ error: "the body is not JSON" }, { status: 400 });
  }
}

/** A region is four finite percentages. */
const isRegion = (region: unknown): boolean =>
  Boolean(region) &&
  typeof region === "object" &&
  ["xPct", "yPct", "wPct", "hPct"].every((key) => Number.isFinite((region as Record<string, unknown>)[key]));

/** The frames a canvas has pictures of, or null when it has no manifest to tell. */
function capturedFrames(slug: string): Set<string> | null {
  const manifest = readJson<{ shots?: Array<{ screenId?: unknown }> }>(path.join(process.cwd(), "design-canvas", "shots", slug, "manifest.json"));
  if (!manifest || !Array.isArray(manifest.shots)) return null;
  return new Set(manifest.shots.map((shot) => shot?.screenId).filter((id): id is string => typeof id === "string"));
}

/** A function, not a shared constant: a response body can only be read once. */
const badSlug = () =>
  NextResponse.json(
    { error: "canvas must be lowercase letters, digits and dashes" },
    { status: 400 },
  );

export async function GET(request: Request) {
  if (canvasHidden()) return new NextResponse("Not found", { status: 404 });
  const refused = guard(request, false);
  if (refused) return refused;
  const slug = slugOf(request);
  if (!slug) return badSlug();
  return NextResponse.json(await readCommentFile(pathsFor(slug)));
}

export async function POST(request: Request) {
  if (canvasHidden()) return new NextResponse("Not found", { status: 404 });
  const published = readOnly();
  if (published) return published;
  const refused = guard(request, true);
  if (refused) return refused;
  const slug = slugOf(request);
  if (!slug) return badSlug();
  const paths = pathsFor(slug);
  const parsed = await jsonBody<Partial<CanvasComment> & { image?: string }>(request);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;
  /* Held in constants so the check below still narrows them inside the queued callback. */
  const { note, screenId, region } = body;
  if (typeof note !== "string" || !note.trim() || typeof screenId !== "string" || !screenId || !region) {
    return NextResponse.json(
      { error: "note, screenId and region are required" },
      { status: 400 },
    );
  }
  if (note.length > MAX_NOTE || screenId.length > 200 || !isRegion(region))
    return NextResponse.json({ error: "a note is text, a screenId a frame id, and a region four percentages" }, { status: 400 });
  /* A comment is drawn on a picture, so its frame is one the canvas has a picture of. */
  const frames = capturedFrames(slug);
  if (frames && !frames.has(screenId)) return NextResponse.json({ error: `canvas "${slug}" has no picture of "${screenId}"` }, { status: 400 });
  /* Minted inside the queue, so two saves landing together cannot take the same number. */
  let failure: string | null = null;
  const written = await mutate(paths, async (file) => {
    const id = nextCommentId(file.comments, file.maxId);
    const image = body.image ? await writeImage(paths, id, body.image) : null;
    if (!image) {
      /* A comment with no picture of its own region would be a comment the agent cannot see. */
      failure = "a PNG data URL is required";
      return file;
    }
    const comment: CanvasComment = {
      id,
      flowId: body.flowId ?? "",
      screenId,
      label: body.label ?? screenId,
      route: body.route ?? "",
      state: body.state ?? null,
      region,
      image,
      note,
      createdAt: new Date().toISOString(),
      consumedAt: null,
      shotHash: body.shotHash,
      stale: false,
    };
    return { ...file, comments: [...file.comments, comment] };
  }, "comment left");
  if (failure) return NextResponse.json({ error: failure }, { status: 400 });
  return NextResponse.json(written);
}

/**
 * The agent marks comments consumed or answers one; the reviewer edits words, reopens a worked note, sets a verdict or
 * approves screens. An edit touches only the words: the region, the picture and `shotHash` stay, and `consumedAt` is not
 * cleared (the reviewer's move for a worked note is a reopen).
 */
export async function PATCH(request: Request) {
  if (canvasHidden()) return new NextResponse("Not found", { status: 404 });
  const published = readOnly();
  if (published) return published;
  const refused = guard(request, true);
  if (refused) return refused;
  const slug = slugOf(request);
  if (!slug) return badSlug();
  const paths = pathsFor(slug);
  const parsed = await jsonBody<{
    id?: string;
    ids?: string[];
    consumed?: boolean;
    /** Frame ids the reviewer approved: they leave the waiting queue. */
    reviewed?: string[];
    /** The canvas was opened: the first time, `viewedAt` is set and the waiting queue empties (`firstVisit`). */
    viewed?: boolean;
    note?: string;
    /** Another round on a comment already answered. */
    reopen?: boolean;
    /** The agent's answer to a comment that asked something. One id at a time; it marks the comment consumed. */
    answer?: string;
    /** A fresh annotated PNG, cut from the screenshot the reviewer is objecting to. */
    image?: string;
    /** On a reopen, the hash of that screenshot: the next capture compares against it, not the first drawing's. */
    shotHash?: string;
    /** The canvas page is open and visible, or `gone` (`withViewing`). Nothing in the review file changes. */
    viewing?: ViewingReport;
    /** An exploration verdict on `screenId` (a screen, not a comment id). `value: null` clears it. */
    verdict?: {
      screenId?: string;
      value?: "like" | "dislike" | null;
      flowId?: string;
      label?: string;
      route?: string;
      state?: string | null;
      image?: string;
    };
  }>(request);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;
  if (body.note !== undefined && (typeof body.note !== "string" || body.note.length > MAX_NOTE))
    return NextResponse.json({ error: "a note is text" }, { status: 400 });
  if (body.answer !== undefined && (typeof body.answer !== "string" || body.answer.length > MAX_NOTE))
    return NextResponse.json({ error: "an answer is text" }, { status: 400 });

  if (body.viewing) {
    const recorded = recordViewing(slug, body.viewing);
    return recorded.status === 200
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ error: recorded.error }, { status: recorded.status });
  }

  if (body.verdict) {
    const { verdict } = body;
    const screenId = verdict.screenId;
    if (!screenId)
      return NextResponse.json(
        { error: "a verdict needs a screenId" },
        { status: 400 },
      );
    const value = verdict.value ?? null;
    if (value !== null && value !== "like" && value !== "dislike")
      return NextResponse.json(
        { error: "a verdict is like, dislike or null" },
        { status: 400 },
      );
    return NextResponse.json(
      await mutate(
        paths,
        (file) => ({
          ...file,
          comments: withVerdict(file.comments, {
            screenId,
            value,
            id: nextCommentId(file.comments, file.maxId),
            flowId: verdict.flowId,
            label: verdict.label,
            route: verdict.route,
            state: verdict.state ?? null,
            image: verdict.image,
            at: new Date().toISOString(),
          }),
        }),
        value === null ? `verdict cleared on ${screenId}` : `${value}d ${screenId}`,
      ),
    );
  }

  /* THE FIRST VISIT: read and written inside the queue, so two tabs opening at once record one visit. */
  if (body.viewed === true) {
    return NextResponse.json(
      await serialized(async () => {
        const file = await readCommentFile(paths);
        const visited = firstVisit(file, new Date().toISOString());
        return visited ? writeCommentFile(paths, visited, "first visit") : file;
      }),
    );
  }

  /* APPROVED SCREENS: new or changed, they leave the queue the capture put them in. */
  if (Array.isArray(body.reviewed)) {
    const done = new Set(body.reviewed.filter((one) => typeof one === "string"));
    return NextResponse.json(
      await mutate(
        paths,
        (file) => ({
          ...file,
          waiting: Object.fromEntries(
            Object.entries(file.waiting ?? {}).filter(([id]) => !done.has(id)),
          ),
        }),
        "screens reviewed",
      ),
    );
  }

  const ids = new Set([...(body.ids ?? []), ...(body.id ? [body.id] : [])]);
  if (ids.size === 0)
    return NextResponse.json({ error: "id or ids required" }, { status: 400 });
  /* An empty note would delete the message and leave the outline, which is worse than refusing. */
  if (body.note !== undefined && body.note.trim().length === 0)
    return NextResponse.json(
      { error: "a note cannot be emptied" },
      { status: 400 },
    );
  if (body.note !== undefined && ids.size > 1)
    return NextResponse.json(
      { error: "one id at a time when editing a note" },
      { status: 400 },
    );
  if (body.answer !== undefined && body.answer.trim().length === 0)
    return NextResponse.json(
      { error: "an answer cannot be empty" },
      { status: 400 },
    );
  if (body.answer !== undefined && ids.size > 1)
    return NextResponse.json(
      { error: "one id at a time when answering" },
      { status: 400 },
    );

  const now = new Date().toISOString();
  /**
   * A REOPEN stays one comment on one rectangle: the new words become the note, the answered words (and the answer) move
   * into `history`, and `consumedAt` and `stale` clear, which puts it back in the agent's queue. Its picture is redrawn
   * from the shot the reviewer was looking at, and `shotHash` becomes that shot's hash.
   */
  const reopening = body.reopen === true && body.note !== undefined;
  const answering = body.answer !== undefined;
  const only = [...ids][0];
  const change = (comment: CanvasComment): CanvasComment => {
    if (reopening) {
      return {
        ...comment,
        note: (body.note ?? "").trim(),
        history: [
          ...(comment.history ?? []),
          {
            note: comment.note,
            at: now,
            ...(comment.answer ? { answer: comment.answer.text } : {}),
          },
        ],
        answer: null,
        consumedAt: null,
        stale: false,
        ...(typeof body.shotHash === "string" ? { shotHash: body.shotHash } : {}),
      };
    }
    return {
      ...comment,
      note: body.note === undefined ? comment.note : body.note.trim(),
      editedAt: body.note === undefined ? comment.editedAt : now,
      answer: answering ? { text: (body.answer ?? "").trim(), at: now } : comment.answer,
      /* An answer consumes: the question has been read and replied to, so it is the reviewer's to close. */
      consumedAt:
        body.consumed === undefined
          ? answering
            ? (comment.consumedAt ?? now)
            : comment.consumedAt
          : body.consumed
            ? (comment.consumedAt ?? now)
            : null,
    };
  };
  /**
   * AN ID THIS FILE DOES NOT HOLD IS A MISTAKE, NOT A NO-OP, and the whole batch is refused with the missing ids named.
   * A wrong `?canvas=` would otherwise report success for notes that were never touched.
   */
  try {
    return NextResponse.json(
      await mutate(
        paths,
        async (file) => {
          const missing = [...ids].filter(
            (id) => !file.comments.some((comment) => comment.id === id),
          );
          if (missing.length > 0) throw new UnknownIds(missing);
          const changed = file.comments.map((comment) =>
            ids.has(comment.id) ? change(comment) : comment,
          );
          if (reopening && body.image) await writeImage(paths, only, body.image);
          return { ...file, comments: await dropSpentVerdicts(paths, changed) };
        },
        reopening
          ? `reopened ${only}`
          : answering
            ? `answered ${only}`
            : body.note !== undefined
              ? `edited ${only}`
              : `consumed ${[...ids].join(", ")}`,
      ),
    );
  } catch (error) {
    if (error instanceof UnknownIds)
      return NextResponse.json(
        {
          error: `no such comment on canvas "${slug}": ${error.missing.join(", ")}`,
        },
        { status: 404 },
      );
    throw error;
  }
}

/**
 * Approving comments deletes them with their pictures: `?ids=c1,c2` (one request for Approve All, so there is nothing to
 * race) or `?id=c1`. `?all=1` is Clear All: every record and picture of this canvas, keeping `maxId`. Ids are not trimmed:
 * whitespace is exactly what `ID` refuses, and a trimmed `c1 ` would delete `c1` for real.
 */
export async function DELETE(request: Request) {
  if (canvasHidden()) return new NextResponse("Not found", { status: 404 });
  const published = readOnly();
  if (published) return published;
  const refused = guard(request, true);
  if (refused) return refused;
  const slug = slugOf(request);
  if (!slug) return badSlug();
  const paths = pathsFor(slug);
  const params = new URL(request.url).searchParams;
  if (params.get("all") === "1") {
    return NextResponse.json(
      await mutate(
        paths,
        async (file) => {
          await fs.rm(paths.images, { recursive: true, force: true });
          return { ...file, comments: [] };
        },
        "cleared all",
      ),
    );
  }
  const ids = [
    ...new Set(
      [...(params.get("ids") ?? "").split(","), params.get("id") ?? ""].filter(
        (one) => one.length > 0,
      ),
    ),
  ];
  if (ids.length === 0)
    return NextResponse.json({ error: "id required" }, { status: 400 });
  /* Every id is checked before anything is read or written: one bad name refuses the whole request. */
  const images = ids.map((one) => imagePath(paths, one));
  if (images.some((image) => image === null))
    return NextResponse.json({ error: "malformed id" }, { status: 400 });
  const gone = new Set(ids);
  return NextResponse.json(
    await mutate(
      paths,
      async (file) => {
        await Promise.all(
          images.map((image) => fs.rm(image as string, { force: true })),
        );
        return { ...file, comments: file.comments.filter((comment) => !gone.has(comment.id)) };
      },
      `approved ${ids.join(", ")}`,
    ),
  );
}
