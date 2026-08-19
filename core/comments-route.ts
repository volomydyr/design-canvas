/**
 * design-canvas CORE — comment persistence, as files in the repo.
 *
 * DEV ONLY. Every method 404s in production, the same guard the Lottie harness route uses. Nothing here is
 * part of the product: it exists so design feedback lands somewhere an agent can read directly, instead of
 * being copied out of a browser by hand.
 *
 * A COMMENT IS TWO FILES, and that is the point. The record in `comments.json` says which screen, which real
 * route, which pinned state and which rectangle; beside it, `comments/<id>.png` is the captured screen with
 * that rectangle drawn on it. The agent reading the note does not have to imagine the region — it opens the
 * picture and sees the outline. The canvas draws that picture in the browser, where the pixels already are,
 * so nothing here needs an image library.
 *
 * Generic: no knowledge of what the canvas is showing. The whole file goes with the folder.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";

import {
  CANVAS_SLUG,
  type CanvasComment,
  type CanvasCommentFile,
  type CanvasVerdict,
  canvasHidden,
  CANVAS_PUBLISHED,
} from "./types";

/** Node, not edge: this route writes files. */
export const runtime = "nodejs";
/** Never cached — the file changes under the canvas while it is open. */
export const dynamic = "force-dynamic";

/** Beside the tool, not at the repo root: the whole folder is one thing to gitignore or delete. */
const DIR = path.join(process.cwd(), "design-canvas");

/**
 * WHERE ONE CANVAS'S REVIEW LIVES. A project can hold several canvases, and a review is per canvas: the
 * numbers on the pins are what the designer says out loud ("c4"), so two canvases sharing one file would
 * hand the agent two different screens both called c4.
 */
type Paths = {
  /** The records. */
  json: string;
  /** The annotated PNGs. */
  images: string;
  /** The images folder as it is written into a comment, repo-relative, for the agent to open. */
  imagesRel: string;
  /** The canvas these paths belong to, carried so every write can claim a flat legacy file. */
  slug: string;
};

/**
 * The canvas named on the request, or `main` when none is — which is what a single-canvas project's client
 * sends, and what every install built before canvases were named sends.
 *
 * VALIDATED, BECAUSE IT REACHES A FILESYSTEM PATH. This is the second piece of request data in this file to
 * do that; the first was `?id=` in DELETE, which is the traversal `ID` below exists to close. Same treatment,
 * and for the same reason: a whitelist matching exactly what a slug may be, not a sanitizer.
 */
function slugOf(request: Request): string | null {
  const raw = new URL(request.url).searchParams.get("canvas");
  if (!raw) return "main";
  return CANVAS_SLUG.test(raw) ? raw : null;
}

/**
 * A canvas's two paths, with a READ FALLBACK to the layout used before canvases were named.
 *
 * An install that has been reviewed already has `comments.json` and `comments/<id>.png`, and that reviewer's
 * notes are the one thing in this tool nothing else can reproduce. So a canvas whose namespaced file does not
 * exist yet keeps reading the flat one, and the first write after that lands namespaced. The flat file is left
 * where it is rather than moved: a tool that relocates a reviewer's file behind their back is a tool that gets
 * blamed the next time anything goes missing.
 */
async function pathsFor(slug: string): Promise<Paths> {
  const namespaced: Paths = {
    json: path.join(DIR, "comments", `${slug}.json`),
    images: path.join(DIR, "comments", slug),
    imagesRel: `design-canvas/comments/${slug}`,
    slug,
  };
  try {
    await fs.access(namespaced.json);
    return namespaced;
  } catch {
    /* Nothing namespaced yet. */
  }
  const flat = path.join(DIR, "comments.json");
  try {
    /**
     * AND IT IS ONLY THIS CANVAS'S FALLBACK IF NOBODY ELSE HAS CLAIMED IT.
     *
     * Unconditional, this handed every canvas in the project the same review. A second canvas, never reviewed,
     * drew the first one's comment count in its Hand Off badge and failed its own oracle on comments about screens
     * it does not declare. The claim is written by the first WRITE (see `stamp` in the handlers below), so a canvas
     * that has actually been reviewed keeps its notes and every other canvas starts empty, which is the truth.
     */
    const raw = JSON.parse(await fs.readFile(flat, "utf8")) as CanvasCommentFile;
    if (raw.canvas && raw.canvas !== slug) return namespaced;
    return {
      json: flat,
      images: path.join(DIR, "comments"),
      imagesRel: "design-canvas/comments",
      slug,
    };
  } catch {
    return namespaced;
  }
}

/** Written into the file itself, so an agent opening it cold knows the protocol. */
const CONTRACT = [
  "Design comments from /design-canvas. Each comment names the screen, its real route, the pinned state, and",
  "a rectangle in percentages of that screen. `image` is the screenshot WITH THAT RECTANGLE DRAWN ON IT:",
  "open it and look inside the outline — that is what the note is about.",
  "After acting on a comment, PATCH /api/design-canvas/comments with { id, consumed: true } so it is never",
  "read twice. Consumed is not resolved: it only means an agent has ingested it.",
  "`stale: true` means that screen has been captured again since the comment was made, so what is under",
  "the outline may have changed — reconcile it, do not drop it. A comment you have consumed on a screen you",
  "have recaptured is the REVIEWER's to answer: they either approve it, which DELETES it, so a comment that",
  "has vanished since you recaptured was accepted, or they dismiss it with another round of feedback, which",
  "puts the new words in `note`, the words you already answered in `history`, and clears `consumedAt` — so it",
  "arrives back in your queue with its picture redrawn from the current screenshot. READ `history` BEFORE",
  "`note` ON ANY COMMENT THAT HAS IT: a dismissal is the next message in a thread, not a new remark, and it is",
  "usually written as one — \"you probably misunderstood me\", \"that is still wrong\" — which says nothing",
  "without the round it is answering. The whole thread is what makes the problem legible. `editedAt` means they",
  "rewrote the words before you acted; the region and the picture are unchanged by an edit.",
].join(" ");

/**
 * THE PREDEFINED WORDS A VERDICT CARRIES, so the file reads as instructions rather than as a bare enum.
 *
 * The owner's own description of what a verdict is: _"it's just gonna have predefined comments that are going to
 * be saved to this screenshot when you use either a like or a dislike."_ And the round they drive, in their
 * words: _"you remove those that I dislike, you work on the comments that I left, if I left any, and you create
 * three more variations for any options that I liked."_ These two sentences are that, per record, so an agent
 * reading one comment in isolation still knows what it is being asked to do.
 */
const VERDICT_NOTE = {
  like: "Liked. Keep this direction and build three variations of it.",
  dislike: "Disliked. Drop this option.",
} as const;

/**
 * Apply a verdict to a comment list. PURE, and exported for the tests — the route's own happy path rewrites the
 * reviewer's real file, which its test file is forbidden from touching after a throwaway probe once emptied it.
 * The rules worth holding shut are all in here: replace rather than append, `null` removes, and a note on the
 * same screen is never disturbed.
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
      /* Predefined words, so the file reads as instructions to whoever opens it cold. */
      note: VERDICT_NOTE[verdict.value],
      createdAt: verdict.at,
    },
  ];
}

/**
 * WHERE THE ROUTE MUST NOT ANSWER AT ALL: a production build that was not asked for a read-only canvas.
 *
 * A VIEW-ONLY DEPLOYMENT MAY READ AND MAY NEVER WRITE. Reading is how the canvas draws pins, and there are none
 * to draw — the file is gitignored, so a deployment has no review in it and this answers an empty one, which is
 * the truth rather than an error. Writing is refused HERE and not only in the interface, because a client is not
 * a permission system: the comment layer is absent from a view-only canvas, and if a request arrives anyway it
 * is answered with 405 rather than a filesystem error on a read-only disk.
 */
function isProduction(): boolean {
  return canvasHidden();
}

/** A write reaching a canvas that is only allowed to be read. */
function readOnly(): NextResponse | null {
  return CANVAS_PUBLISHED
    ? new NextResponse("This canvas is published read only: comments live where it was captured", {
        status: 405,
      })
    : null;
}

async function readFile(paths: Paths): Promise<CanvasCommentFile> {
  try {
    const raw = await fs.readFile(paths.json, "utf8");
    const parsed = JSON.parse(raw) as Partial<CanvasCommentFile>;
    return {
      contract: CONTRACT,
      updatedAt: parsed.updatedAt ?? new Date().toISOString(),
      comments: Array.isArray(parsed.comments) ? parsed.comments : [],
      ...(Array.isArray(parsed.seen) ? { seen: parsed.seen } : {}),
    };
  } catch (error) {
    /**
     * A MISSING FILE IS AN EMPTY REVIEW. A BROKEN ONE IS NOT.
     *
     * Both used to land here and both answered "zero comments", which is only honest for the first. A file
     * that exists and does not parse — a torn read while another write was in flight, an editor saving half
     * of it — became an empty list, and then the next write PERSISTED that emptiness and minted ids from
     * `c1` again. That is a comment file destroyed by a transient read, and it is the shape of the losses
     * this route's history calls unexplained: one of the reviewer's comments went missing during a run of
     * `check-canvas.mjs` once, restored from `comments.json.2`.
     *
     * So: no file, empty review. A file that will not parse, throw — the route answers 500, the caller
     * shows its error, and the bytes on disk are left exactly as they are for `comments.json.1` to rescue.
     */
    if ((error as { code?: string }).code === "ENOENT") {
      return {
        contract: CONTRACT,
        updatedAt: new Date().toISOString(),
        comments: [],
      };
    }
    throw error;
  }
}

/**
 * EVERY WRITE KEEPS THE VERSION IT REPLACES. `comments.json.1` is the file as it was one write ago, `.2` two
 * writes ago, and so on to five.
 *
 * This exists because comments went missing in the project this was built in, repeatedly, and the mechanism
 * was never identified: two bursts of Approve All are in the server log and account for some of it, and one
 * emptying is not explained by any request the log contains. Rather than keep guessing, the loss is made
 * recoverable — a reviewer's comments are the one thing in this tool nothing else can reproduce. The pictures
 * survive on their own, because a record removed from the JSON does not delete the PNG beside it unless the
 * route was asked to.
 *
 * Five deep and rotated on write, so the cost is bounded and the newest is always `.1`. Restoring is a copy:
 *   cp design-canvas/comments.json.1 design-canvas/comments.json
 */
const HISTORY = 5;

async function keepPrevious(paths: Paths): Promise<void> {
  const file = paths.json;
  try {
    await fs.access(file);
  } catch {
    return;
  }
  for (let step = HISTORY - 1; step >= 1; step -= 1) {
    try {
      await fs.rename(`${file}.${step}`, `${file}.${step + 1}`);
    } catch {
      /* Nothing at that depth yet. */
    }
  }
  try {
    await fs.copyFile(file, `${file}.1`);
  } catch {
    /* A backup that cannot be written must not stop the write it protects. */
  }
}

/**
 * EVERY MUTATION GOES THROUGH ONE QUEUE, AND THIS IS THE FIX FOR COMMENTS COMING BACK FROM THE DEAD.
 *
 * Each handler here reads the whole file, changes one record and writes the whole file back. Two of those
 * overlapping is a lost update: both read the same list, and the second write does not know about the
 * first. `Approve All` did exactly that — one DELETE per comment, fired together — so the last response
 * won and every other approval was undone. Reported: "it keeps my old comments even after I
 * approve all of them", with the next comment numbered 12 because eleven survivors were still on the
 * canvas and a pin is numbered by its position.
 *
 * It is also the likeliest mechanism behind the losses the history above calls unexplained: the same race
 * drops records instead of resurrecting them when the interleaving goes the other way.
 *
 * A promise chain rather than a lock: this route is one dev-mode process, the critical section is a read
 * and a write of one small file, and a chain cannot deadlock or leak. A rejected job does not break the
 * chain, so one bad request cannot stop the next. ONE queue for every canvas rather than one each: the
 * cost is that two canvases cannot be written at the same instant, which no reviewer can do anyway.
 */
let queue: Promise<unknown> = Promise.resolve();

function serialized<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  queue = run.catch(() => undefined);
  return run;
}

/**
 * THE ONE WAY A MUTATION REFUSES: the ids it was handed are not in this canvas's file.
 *
 * Thrown from inside `mutate`'s change callback, so it lands BEFORE `writeFile` — a rejected PATCH must leave
 * no trace at all, and in particular must not bring a canvas file into existence just by being wrong about
 * which canvas it was talking to.
 */
class UnknownIds extends Error {
  constructor(readonly missing: string[]) {
    super(`unknown comment ids: ${missing.join(", ")}`);
  }
}

/** Read, change, write — as one step nothing else can interleave with. */
function mutate(
  paths: Paths,
  change: (
    comments: CanvasComment[],
  ) => Promise<CanvasComment[]> | CanvasComment[],
): Promise<CanvasCommentFile> {
  return serialized(async () => {
    const file = await readFile(paths);
    return writeFile(paths, await change(file.comments));
  });
}

/**
 * ONE LIST, so there is nothing for a handler to forget.
 *
 * This used to take a second `verdicts` array and read it back from disk whenever a caller did not pass one,
 * precisely because eight handlers each rewrite the whole file and the first one that forgot would silently
 * erase which options the reviewer had liked. Folding verdicts into `comments` as kinds deletes that hazard
 * rather than defending against it: a handler that rewrites the comments now carries the verdicts with them by
 * construction, because they are the same records.
 */
async function writeFile(
  paths: Paths,
  comments: CanvasComment[],
  seen?: string[],
): Promise<CanvasCommentFile> {
  await keepPrevious(paths);
  /* CARRIED, NEVER DROPPED. `seen` is the reviewer's other state in this file (see `CanvasCommentFile.seen`), and
     every comment write goes through here: forgetting it once would make every screen new again. */
  const existing = seen ?? (await readFile(paths)).seen;
  /* THE CLAIM, written once and then carried. Only on the flat file: a namespaced one says which canvas it is by
     its own name, and stamping it would be a second copy of the same fact that could disagree with the first. */
  const flat = paths.json === path.join(DIR, "comments.json");
  const claimed = flat
    ? (((await readFile(paths)) as CanvasCommentFile).canvas ?? paths.slug)
    : undefined;
  const file: CanvasCommentFile = {
    contract: CONTRACT,
    updatedAt: new Date().toISOString(),
    ...(claimed ? { canvas: claimed } : {}),
    comments,
    ...(existing && existing.length > 0 ? { seen: existing } : {}),
  };
  /* The namespaced layout puts the records inside `comments/`, which may not exist on a first write. */
  await fs.mkdir(path.dirname(paths.json), { recursive: true });
  await fs.writeFile(paths.json, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  return file;
}

/**
 * THE ONLY SHAPE A COMMENT ID MAY HAVE, and the gate every filesystem path in this file goes through.
 *
 * A background security review of c3f6aae7 reported a path traversal here, and it was real — in DELETE.
 * `?id=` went from the query string straight into `path.join(IMAGES, `${id}.png`)` and then to `fs.rm(...,
 * { force: true })`, so `?id=../../app/favicon` deleted a file outside the comments folder. An arbitrary
 * DELETE limited to names ending in `.png`, which is narrower than the write-anywhere the review described
 * — `writeImage` has always used a server-generated id — but a developer losing files in their own
 * repository from a GET-shaped request is not an acceptable way for a dev tool to behave.
 *
 * A WHITELIST, NOT A SANITIZER. `nextId` only ever mints `c` followed by digits, so anything else is not an
 * id this route issued and there is nothing to salvage by stripping characters out of it. Matching the
 * generator exactly is what makes this airtight: no separators, no dots, no encoding to unwrap, and no way
 * for a future `..` variant to sneak past a blacklist that did not anticipate it.
 */
const ID = /^c\d+$/;

/**
 * A comment's picture, resolved and PROVEN to be inside the images folder. Belt and braces on top of `ID`
 * above: if a later change ever widens what an id may contain, this still refuses to hand back a path that
 * escaped. `path.resolve` collapses any `..` before the check, so the comparison is on the real target.
 */
function imagePath(paths: Paths, id: string): string | null {
  if (!ID.test(id)) return null;
  const root = path.resolve(paths.images);
  const file = path.resolve(root, `${id}.png`);
  return file.startsWith(`${root}${path.sep}`) ? file : null;
}

/** Sequential and human-sized, because the number on the pin is what the designer will say out loud. */
function nextId(comments: CanvasComment[]): string {
  const highest = comments.reduce((max, comment) => {
    const n = Number.parseInt(comment.id.replace(/^c/, ""), 10);
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);
  return `c${highest + 1}`;
}

/**
 * The annotated picture, written from the data URL the canvas drew. Repo-relative path back.
 *
 * `id` here has always come from `nextId`, never from the request, so this was never the traversal the review
 * reported. It goes through `imagePath` anyway: one function owns every path this file touches, so the next
 * person to call it cannot reintroduce the hole by passing something looser.
 */
const PNG_URL = "data:image/png;base64,";

async function writeImage(
  paths: Paths,
  id: string,
  dataUrl: string,
): Promise<string | null> {
  /**
   * PREFIX AND SLICE, NEVER A REGEX WITH A CAPTURE GROUP OVER THE WHOLE PAYLOAD. This was
   * `/^data:image\/png;base64,(.+)$/s.exec(dataUrl)`, and on a long page it threw
   * `RangeError: Maximum call stack size exceeded` inside `RegExp.exec` — V8 runs a greedy `.+` over a
   * multi-megabyte string on the stack. The comment then failed with a 500 and the outline the designer had
   * just drawn was lost, which is the one failure this tool must not have: the drawing IS the message. Found
   * by `check-canvas.mjs`, whose round-trip probe commented on a 4045px screen.
   */
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
 * The 400 every method answers a malformed `?canvas=` with, rather than touching the filesystem.
 *
 * A FUNCTION, NOT A CONSTANT. It was one shared `NextResponse`, and a response body can only be read once: the
 * first malformed request got the JSON and every one after it got an empty body. Six of the seven tests below
 * failed on exactly that, which is a better place to find it than a reviewer's console.
 */
const badSlug = () =>
  NextResponse.json(
    { error: "canvas must be lowercase letters, digits and dashes" },
    { status: 400 },
  );

export async function GET(request: Request) {
  if (isProduction()) return new NextResponse("Not found", { status: 404 });
  const slug = slugOf(request);
  if (!slug) return badSlug();
  /**
   * THE RESPONSE SAYS WHICH FILE IT READ, and that is not cosmetic.
   *
   * Two layouts are live at once by design (see `pathsFor`): a namespaced `comments/<slug>.json` for a fresh
   * install, and a flat `comments.json` for one that was reviewed before namespacing existed. The hand-off
   * prompt named the namespaced one unconditionally, so on every upgraded install the agent was told to open a
   * path that does not exist — which is exactly what happened the first time an agent was handed a round on
   * this project. It cost two tool calls and a guess.
   *
   * `file` is response-only and never written to disk: the file cannot sensibly record its own name.
   */
  const paths = await pathsFor(slug);
  return NextResponse.json({
    ...(await readFile(paths)),
    file: path.relative(process.cwd(), paths.json),
  });
}

export async function POST(request: Request) {
  if (isProduction()) return new NextResponse("Not found", { status: 404 });
  const published = readOnly();
  if (published) return published;
  const slug = slugOf(request);
  if (!slug) return badSlug();
  const paths = await pathsFor(slug);
  const body = (await request.json()) as Partial<CanvasComment> & {
    image?: string;
  };
  if (!body.note || !body.screenId || !body.region) {
    return NextResponse.json(
      { error: "note, screenId and region are required" },
      { status: 400 },
    );
  }
  /* Minted and appended INSIDE the queue: two saves landing together used to read the same list and both
     take the same next number, so one of them was written over. */
  let failure: string | null = null;
  const written = await mutate(paths, async (comments) => {
    const id = nextId(comments);
    const image = body.image ? await writeImage(paths, id, body.image) : null;
    if (!image) {
      /* A comment with no picture of its own region would be a comment the agent cannot see. */
      failure = "a PNG data URL is required";
      return comments;
    }
    const comment: CanvasComment = {
      id,
      flowId: body.flowId ?? "",
      screenId: body.screenId,
      label: body.label ?? body.screenId,
      route: body.route ?? "",
      state: body.state ?? null,
      region: body.region,
      image,
      note: body.note,
      createdAt: new Date().toISOString(),
      consumedAt: null,
      shotHash: body.shotHash,
      stale: false,
    };
    return [...comments, comment];
  });
  if (failure) return NextResponse.json({ error: failure }, { status: 400 });
  return NextResponse.json(written);
}

/**
 * Two jobs, and they belong to two different people.
 *
 * `consumed` is the AGENT's: it has read the comment and will not read it again. `note` is the REVIEWER's:
 * they are fixing the words they wrote, from the pin, because a comment typed in one breath is often not the
 * comment they meant — "being able to edit the comments that you added would be nice."
 *
 * An edit deliberately touches nothing but the words. The region, the annotated picture and the `shotHash`
 * all stay: what was wrong was the sentence, not the place, and re-drawing the picture would lose the outline
 * the agent is meant to look at. An edit does NOT clear `consumedAt` either — an agent that has already acted
 * on the old wording is a fact, and the reviewer's next move for that case is Dismiss, which asks for a fresh
 * comment rather than quietly rewinding this one.
 */
export async function PATCH(request: Request) {
  if (isProduction()) return new NextResponse("Not found", { status: 404 });
  const published = readOnly();
  if (published) return published;
  const slug = slugOf(request);
  if (!slug) return badSlug();
  const paths = await pathsFor(slug);
  const body = (await request.json()) as {
    id?: string;
    ids?: string[];
    consumed?: boolean;
    /** Screen ids the reviewer has now seen. See the handler below. */
    seen?: string[];
    note?: string;
    /** Another round on a comment already answered — see below. */
    reopen?: boolean;
    /** A fresh annotated PNG, cut from the screenshot the reviewer is objecting to. */
    image?: string;
    /**
     * AN EXPLORATION VERDICT: `screenId` is a screen, not a comment id, and the result is a comment of a
     * verdict kind. `value: null` clears it, so a mis-click is one press to undo.
     */
    verdict?: {
      screenId?: string;
      value?: "like" | "dislike" | null;
      flowId?: string;
      label?: string;
      route?: string;
      state?: string | null;
      image?: string;
    };
  };

  if (body.verdict) {
    const screenId = body.verdict.screenId;
    if (!screenId)
      return NextResponse.json(
        { error: "a verdict needs a screenId" },
        { status: 400 },
      );
    const value = body.verdict.value ?? null;
    if (value !== null && value !== "like" && value !== "dislike")
      return NextResponse.json(
        { error: "a verdict is like, dislike or null" },
        { status: 400 },
      );
    return NextResponse.json(
      await serialized(async () => {
        const file = await readFile(paths);
        return writeFile(
          paths,
          withVerdict(file.comments, {
            screenId,
            value,
            id: nextId(file.comments),
            flowId: body.verdict?.flowId,
            label: body.verdict?.label,
            route: body.verdict?.route,
            state: body.verdict?.state ?? null,
            image: body.verdict?.image,
            at: new Date().toISOString(),
          }),
        );
      }),
    );
  }

  /**
   * SCREENS THE REVIEWER HAS SEEN, which is what makes a NEW screen stop being new.
   *
   * A genuinely new screen is one that has never been on this canvas before — the owner drew the line himself:
   * *"new screens are gonna be only the ones that are literally new. Like you just added it as a new screen. If
   * you updated the existing screen, it doesn't count as a new screen."* An updated screen is the comment path,
   * which already has its own queue, so the two sets can never hold the same frame.
   *
   * It lives in this file because this file is already the reviewer's own state about this canvas, and because a
   * second store would mean a second route, a second write path and a second thing to keep in step.
   */
  if (Array.isArray(body.seen)) {
    const adding = body.seen.filter((one) => typeof one === "string");
    return NextResponse.json(
      await serialized(async () => {
        const file = await readFile(paths);
        const seen = [...new Set([...(file.seen ?? []), ...adding])];
        return writeFile(paths, file.comments, seen);
      }),
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

  const now = new Date().toISOString();
  /**
   * REOPENING IS THE OTHER HALF OF A REVIEW, and it stays ONE comment rather than becoming a second one on
   * the same rectangle. The reviewer looked at the recaptured screen, decided it is still wrong, and said
   * why: the new words become the note, the words already answered move into `history` so the agent can see
   * what it tried, `consumedAt` clears — which is what moves this out of the reviewer's queue and back into
   * the agent's — and `stale` clears, because the objection is about the picture now on screen. That picture
   * is rewritten too, from the shot the reviewer was actually looking at.
   */
  const reopening = body.reopen === true && body.note !== undefined;
  const only = [...ids][0];

  /* Through the queue: an agent marking a batch consumed and a reviewer approving one at the same moment
     used to be a lost update either way round. */
  const next = (comments: CanvasComment[]) =>
    comments.map((comment) => {
    if (!ids.has(comment.id)) return comment;
    if (reopening) {
      return {
        ...comment,
        note: (body.note ?? "").trim(),
        history: [...(comment.history ?? []), { note: comment.note, at: now }],
        consumedAt: null,
        stale: false,
      };
    }
    return {
      ...comment,
      note: body.note === undefined ? comment.note : body.note.trim(),
      editedAt: body.note === undefined ? comment.editedAt : now,
      consumedAt:
        body.consumed === undefined
          ? comment.consumedAt
          : body.consumed
            ? (comment.consumedAt ?? now)
            : null,
    };
  });
  /**
   * AN ID THIS FILE DOES NOT HOLD IS A MISTAKE, NOT A NO-OP — and this route used to answer it with 200.
   *
   * What that costs: an agent draining a review sends nine ids, gets nine 200s, and reports the feedback as
   * consumed. If the canvas slug was wrong (`?canvas=` is a QUERY parameter, and putting it in the JSON body
   * instead silently selects the default canvas) every one of those ids was absent, every answer was 200, and
   * a `main.json` was created to hold the nothing that changed. The reviewer's real notes sat untouched while
   * the log said otherwise. That is the worst failure this file can have, because the whole point of `consumed`
   * is that an agent can trust it.
   *
   * ALL OR NOTHING, and the missing ids are named. A batch that quietly patches four of six is the same trap
   * one size down.
   */
  try {
    return NextResponse.json(
      await mutate(paths, async (comments) => {
        const missing = [...ids].filter(
          (id) => !comments.some((comment) => comment.id === id),
        );
        if (missing.length > 0) throw new UnknownIds(missing);
        const changed = next(comments);
        if (reopening && body.image) await writeImage(paths, only, body.image);
        return changed;
      }),
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

export async function DELETE(request: Request) {
  if (isProduction()) return new NextResponse("Not found", { status: 404 });
  const published = readOnly();
  if (published) return published;
  const slug = slugOf(request);
  if (!slug) return badSlug();
  const paths = await pathsFor(slug);
  const params = new URL(request.url).searchParams;
  /* `?all=1` is the "leave nothing behind" button: every record and every picture, in one press. The canvas
     offers it because a reviewer should never have to wonder whether this tool is accumulating files in their
     repository — the answer is that they can empty it, and that it was gitignored the whole time. */
  if (params.get("all") === "1") {
    await fs.rm(paths.images, { recursive: true, force: true });
    return NextResponse.json(await serialized(() => writeFile(paths, [])));
  }
  /**
   * ONE REQUEST, ANY NUMBER OF IDS, and that is what Approve All uses now.
   *
   * `?ids=c1,c2,c3` alongside the single `?id=`. It used to be one request per comment, fired together, and
   * since every request rewrites the whole file the last answer won and the rest of the approvals were
   * undone — the comments came back. Batching removes the race at its source rather than relying on the
   * queue to serialise a fan-out nobody needed.
   *
   * NOT TRIMMED, and the DELETE tests are why: `?id=c1%20` survives URL decoding as `c1 `, and trimming it
   * back to `c1` hands the guard a valid id and deletes that comment for real. Whitespace is exactly what
   * `ID` exists to refuse, so it must reach it intact. Empties are dropped only so that `?ids=c1,c2,` does
   * not fail on its own trailing comma.
   */
  const ids = [
    ...new Set(
      [...(params.get("ids") ?? "").split(","), params.get("id") ?? ""].filter(
        (one) => one.length > 0,
      ),
    ),
  ];
  /* The message stays "id required": it is the contract this route already published, and the batch form is
     an addition rather than a replacement. */
  if (ids.length === 0)
    return NextResponse.json({ error: "id required" }, { status: 400 });
  /* THE TRAVERSAL WAS HERE. `id` is the one piece of request data in this file that reached a filesystem
     path, and it reached `fs.rm` unchecked — see `ID` above for what that allowed and why the fix is a
     whitelist. Rejected before anything is read or written, so a bad id cannot even mutate the record file.
     EVERY id in a batch goes through it: one bad name refuses the whole request rather than deleting the
     good half of it. */
  const images = ids.map((one) => imagePath(paths, one));
  if (images.some((image) => image === null))
    return NextResponse.json({ error: "malformed id" }, { status: 400 });
  const gone = new Set(ids);
  return NextResponse.json(
    await mutate(paths, async (comments) => {
      /* The pictures go with the records: a comments folder full of orphans is a folder nobody trusts. */
      await Promise.all(
        images.map((image) => fs.rm(image as string, { force: true })),
      );
      return comments.filter((comment) => !gone.has(comment.id));
    }),
  );
}
