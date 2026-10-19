/**
 * design-canvas CORE — one canvas's review file on disk: where it lives, how it is read and written, and the git history
 * every write is committed to. The comments route and the tools that write the file (capture, split-canvas) all go
 * through here, so the rules exist once. Plain JavaScript, so a tool imports it with no build step; the types are in
 * `comment-file.d.mts`.
 *
 * A review is `design-canvas/comments/<slug>.json` plus the annotated pictures in `design-canvas/comments/<slug>/`. Installs
 * that kept a flat `comments.json` or a flat `shots/` are moved to this layout once, by the installer
 * (`scripts/migrate-layout.mjs`); nothing here reads the old layout.
 *
 * DELETE WITH: the design-canvas/ folder.
 */
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Written into the file itself, so an agent opening it cold knows the protocol. */
export const CONTRACT = [
  "Design comments from /design-canvas. Each comment names the screen, its real route, the pinned state, and",
  "a rectangle in percentages of that screen. `image` is the screenshot WITH THAT RECTANGLE DRAWN ON IT:",
  "open it and look inside the outline — that is what the note is about.",
  "Start with `node design-canvas/drain.mjs --canvas <this file's name> --list`: it lists the open notes and, under",
  "each, the other frames drawn from the same files, which a fix in a shared file reaches too.",
  "After acting on comments, mark them consumed with `node design-canvas/drain.mjs --canvas <this file's name>",
  "--ids <ids>` so they are never read twice. Consumed is not resolved: it only means an agent has ingested it.",
  "`stale: true` means that screen has been captured again since the comment was made, so what is under",
  "the outline may have changed — reconcile it, do not drop it. A comment you have consumed on a screen you",
  "have recaptured is the REVIEWER's to answer: they either approve it, which DELETES it, so a comment that",
  "has vanished since you recaptured was accepted, or they dismiss it with another round of feedback, which",
  "puts the new words in `note`, the words you already answered in `history`, and clears `consumedAt` — so it",
  "arrives back in your queue with its picture redrawn from the current screenshot. READ `history` BEFORE",
  "`note` ON ANY COMMENT THAT HAS IT: a dismissal is the next message in a thread, not a new remark, and it is",
  "usually written as one, a short reply that only says the fix missed, which says nothing",
  "without the round it is answering. The whole thread is what makes the problem legible. `editedAt` means they",
  "rewrote the words before you acted; the region and the picture are unchanged by an edit.",
  "A COMMENT THAT ASKS A QUESTION IS ANSWERED IN THE RECORD, NOT IN CHAT: PATCH { id, answer: \"<the answer>\" }",
  "(or `node design-canvas/drain.mjs --canvas <slug> --ids cN --answer \"…\"`). The answer is drawn under the",
  "reviewer's words in the open pin, the write marks the comment consumed, and a dismissal carries the pair into",
  "`history` together.",
  "A RECORD IS NEVER KEPT WHERE NOBODY CAN REACH IT. Marking a VERDICT consumed deletes it, because a like is",
  "not a question and no press on the canvas could ever answer one; marking a NOTE consumed hands it to the",
  "reviewer, who approves or reopens it. A capture removes any answered comment whose screen has left the",
  "declaration. Every one of those deletions is a commit in design-canvas/comments/.history, a git repository",
  "of its own: `git -C design-canvas/comments/.history log -p` is where you read what a comment said before it",
  "went, and it is the only place, so do not keep a spent record alive in this file to preserve it.",
  "`waiting` is the reviewer's queue of screens to look at (\"new\" or \"changed\"), written by the capture.",
  "`viewedAt` is when the reviewer first opened this canvas: until then nothing is queued, and that visit empties `waiting`.",
].join(" ");

/** A canvas's review paths, given the `design-canvas/` folder and the canvas slug. */
export function commentPaths(canvasDir, slug) {
  return {
    slug,
    json: path.join(canvasDir, "comments", `${slug}.json`),
    images: path.join(canvasDir, "comments", slug),
    /* As written into a comment's `image`, repo-relative, for the agent to open. */
    imagesRel: `design-canvas/comments/${slug}`,
    history: path.join(canvasDir, "comments", ".history"),
  };
}

/** The number in a comment id, or 0 for anything that is not an id the route issues (`c` plus digits). */
const numberOf = (id) => {
  const n = /^c(\d+)$/.exec(String(id))?.[1];
  return n === undefined ? 0 : Number.parseInt(n, 10);
};

/** The highest comment number in a list. */
export function highestIdIn(comments) {
  return (comments ?? []).reduce((max, one) => Math.max(max, numberOf(one.id)), 0);
}

/**
 * The next id: one past the larger of the list's highest and `floor`, the highest ever issued (`maxId`). Ids are never
 * reused, because the number on a pin is what a reviewer and an agent say to each other.
 */
export function nextCommentId(comments, floor = 0) {
  return `c${Math.max(highestIdIn(comments), floor) + 1}`;
}

/**
 * The file, or an empty review when there is none. A file that exists and does not parse THROWS: answering it as empty
 * would let the next write persist the emptiness. `maxId` always covers every id in the file as read, so a write that
 * removes the highest comment still remembers it.
 */
export async function readCommentFile(paths) {
  let parsed;
  try {
    parsed = JSON.parse(await fs.readFile(paths.json, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return { contract: CONTRACT, updatedAt: new Date().toISOString(), comments: [] };
    throw error;
  }
  const comments = Array.isArray(parsed.comments) ? parsed.comments : [];
  const maxId = Math.max(typeof parsed.maxId === "number" ? parsed.maxId : 0, highestIdIn(comments));
  return {
    contract: CONTRACT,
    updatedAt: parsed.updatedAt ?? new Date().toISOString(),
    comments,
    ...(parsed.waiting && typeof parsed.waiting === "object" ? { waiting: parsed.waiting } : {}),
    ...(maxId > 0 ? { maxId } : {}),
    ...(typeof parsed.viewedAt === "string" ? { viewedAt: parsed.viewedAt } : {}),
  };
}

/**
 * Write the file and commit it to the history. `why` is the commit message after the slug, the writer's own word for what
 * it did. Only the known fields are written, so nothing a reader does not understand survives a write.
 */
export async function writeCommentFile(paths, file, why = "update") {
  const maxId = Math.max(typeof file.maxId === "number" ? file.maxId : 0, highestIdIn(file.comments));
  const waiting = file.waiting && Object.keys(file.waiting).length > 0 ? file.waiting : null;
  const out = {
    contract: CONTRACT,
    updatedAt: new Date().toISOString(),
    comments: file.comments ?? [],
    ...(waiting ? { waiting } : {}),
    ...(maxId > 0 ? { maxId } : {}),
    ...(typeof file.viewedAt === "string" ? { viewedAt: file.viewedAt } : {}),
  };
  await fs.mkdir(path.dirname(paths.json), { recursive: true });
  await fs.writeFile(paths.json, `${JSON.stringify(out, null, 2)}\n`, "utf8");
  await commitHistory(paths, why);
  return out;
}

/**
 * THE HISTORY: a git repository of its own inside `design-canvas/comments/`, which the project already ignores, so the
 * app's own repository never sees it. Every write is a commit of the records (never the pictures), which is what makes a
 * deleted record recoverable: `git -C design-canvas/comments/.history log -p`. It never fails a write: a machine without
 * git keeps the tool and loses the log.
 */
const opened = new Map();

function openHistory(dir) {
  if (!opened.has(dir))
    opened.set(
      dir,
      (async () => {
        try {
          await fs.mkdir(dir, { recursive: true });
          /* A file test, never `git rev-parse`, which walks up and would answer with the app's own repository. */
          try {
            await fs.access(path.join(dir, ".git"));
          } catch {
            await run("git", ["-C", dir, "init", "--quiet"]);
            /* A local identity, so the log does not depend on, or sign with, whoever is configured globally. */
            await run("git", ["-C", dir, "config", "user.email", "design-canvas@localhost"]);
            await run("git", ["-C", dir, "config", "user.name", "design canvas"]);
          }
          return true;
        } catch {
          return false;
        }
      })(),
    );
  return opened.get(dir);
}

/** Commit the file as it is on disk now. Called after each write, and before a tool deletes records, so they survive. */
export async function commitHistory(paths, why) {
  if (!(await openHistory(paths.history))) return;
  const name = `${paths.slug}.json`;
  try {
    await fs.copyFile(paths.json, path.join(paths.history, name));
    await run("git", ["-C", paths.history, "add", "--", name]);
    await run("git", ["-C", paths.history, "commit", "--quiet", "-m", `${paths.slug}: ${why}`]);
  } catch {
    /* Nothing staged (a write that changed no records) exits non-zero, which is not a failure worth reporting. */
  }
}
