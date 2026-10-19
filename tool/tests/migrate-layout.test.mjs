/**
 * Tests for `scripts/migrate-layout.mjs`: an older install's flat review file, flat pictures and seen/changed lists move to
 * today's layout once, nothing is lost or deleted, an id is never handed out twice, and a second run changes nothing.
 *
 *   node --test tool/tests/migrate-layout.test.mjs
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { highestIdInText, migrateLayout } from "../../scripts/migrate-layout.mjs";

const scratchDirs = [];
const scratch = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "canvas-migrate-"));
  scratchDirs.push(dir);
  return dir;
};
after(() => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
});
const json = (file) => JSON.parse(readFileSync(file, "utf8"));
const write = (file, value) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);
};
const note = (id, extra = {}) => ({ id, screenId: "list", note: `note ${id}`, image: `design-canvas/comments/${id}.png`, ...extra });

/**
 * A flat install: `comments.json` claimed by "tasks" with two pictures and two numbered backups, flat shots with a small
 * copy, plus a namespaced "profile" review with seen/changed lists and no `maxId`, whose history remembers c8.
 */
function flatFixture() {
  const dir = path.join(scratch(), "design-canvas");
  write(path.join(dir, "comments.json"), { contract: "x", updatedAt: "t", canvas: "tasks", seen: ["list"], comments: [note("c1"), note("c3", { consumedAt: "t" })], maxId: 4 });
  write(path.join(dir, "comments.json.1"), { comments: [note("c1")] });
  write(path.join(dir, "comments.json.2"), { comments: [] });
  write(path.join(dir, "comments", "c1.png"), "png-one");
  write(path.join(dir, "comments", "c3.png"), "png-three");
  write(path.join(dir, "shots", "manifest.json"), { shots: [{ screenId: "list", file: "list.webp", hash: "h1" }, { screenId: "form", file: "form.webp", hash: "h2" }] });
  write(path.join(dir, "shots", "list.webp"), "webp-list");
  write(path.join(dir, "shots", "form.webp"), "webp-form");
  write(path.join(dir, "shots", "small", "list.webp"), "small-list");

  write(path.join(dir, "shots", "profile", "manifest.json"), { shots: ["a", "b", "c", "d"].map((id) => ({ screenId: id, file: `${id}.webp`, hash: id })) });
  write(path.join(dir, "comments", "profile.json"), { comments: [{ id: "c2", screenId: "a", note: "x" }], seen: ["a", "b", "c"], changed: ["b", "d"] });
  const history = path.join(dir, "comments", ".history");
  mkdirSync(history, { recursive: true });
  const git = (...args) => execFileSync("git", ["-C", history, ...args], { stdio: "ignore" });
  git("init", "--quiet");
  git("config", "user.email", "t@localhost");
  git("config", "user.name", "t");
  for (const ids of [["c1", "c2", "c8"], ["c2"]]) {
    write(path.join(history, "profile.json"), { comments: ids.map((id) => ({ id })) });
    git("add", "--", "profile.json");
    git("commit", "--quiet", "-m", "profile: earlier");
  }
  return dir;
}

test("a flat review moves to its claimed canvas, pictures copied, the originals kept and nothing deleted", () => {
  const dir = flatFixture();
  const said = migrateLayout(dir);
  assert.ok(said.some((line) => /comments\.json moved to comments\/tasks\.json \(2 comment/.test(line)), said.join("\n"));

  const review = json(path.join(dir, "comments", "tasks.json"));
  assert.deepEqual(review.comments.map((one) => [one.id, one.image]), [
    ["c1", "design-canvas/comments/tasks/c1.png"],
    ["c3", "design-canvas/comments/tasks/c3.png"],
  ]);
  assert.equal(review.canvas, undefined, "the claim field is gone: the file's name says which canvas it is");
  assert.equal(review.seen, undefined);
  assert.equal(review.maxId, 4, "the mark the file remembered is kept");
  assert.equal(readFileSync(path.join(dir, "comments", "tasks", "c1.png"), "utf8"), "png-one");
  assert.equal(readFileSync(path.join(dir, "comments", "c1.png"), "utf8"), "png-one", "the original picture stays");
  assert.ok(!existsSync(path.join(dir, "comments.json")), "the flat file no longer sits where a tool could read it");
  assert.deepEqual(readdirSync(path.join(dir, "comments", ".migrated")).filter((one) => one.startsWith("comments.json")).sort(), ["comments.json", "comments.json.1", "comments.json.2"]);
  assert.equal(json(path.join(dir, "comments", ".migrated", "comments.json")).canvas, "tasks", "the original is byte for byte what it was");
});

test("flat pictures are copied under the same canvas, small copies included", () => {
  const dir = flatFixture();
  migrateLayout(dir);
  assert.deepEqual(json(path.join(dir, "shots", "tasks", "manifest.json")), json(path.join(dir, "shots", "manifest.json.migrated")));
  assert.ok(!existsSync(path.join(dir, "shots", "manifest.json")), "the flat manifest is renamed, never deleted");
  assert.equal(readFileSync(path.join(dir, "shots", "tasks", "list.webp"), "utf8"), "webp-list");
  assert.equal(readFileSync(path.join(dir, "shots", "tasks", "form.webp"), "utf8"), "webp-form");
  assert.equal(readFileSync(path.join(dir, "shots", "tasks", "small", "list.webp"), "utf8"), "small-list");
});

test("seen and changed become the waiting map, and the queue the reviewer saw is the queue they get", () => {
  const dir = flatFixture();
  migrateLayout(dir);
  const profile = json(path.join(dir, "comments", "profile.json"));
  /* d is pictured and never seen: new. b was seen and changed: changed. d's changed entry without seen does not count. */
  assert.deepEqual(profile.waiting, { b: "changed", d: "new" });
  assert.equal(profile.seen, undefined);
  assert.equal(profile.changed, undefined);
  /* The flat review: list was seen, form was pictured and never seen. */
  assert.deepEqual(json(path.join(dir, "comments", "tasks.json")).waiting, { form: "new" });
});

test("a file without maxId gets the highest id its history ever held", () => {
  const dir = flatFixture();
  migrateLayout(dir);
  assert.equal(json(path.join(dir, "comments", "profile.json")).maxId, 8);
  assert.equal(json(path.join(dir, "comments", ".migrated", "profile.json")).seen.length, 3, "the rewritten file's original is kept");
});

test("a second run changes nothing and says nothing", () => {
  const dir = flatFixture();
  migrateLayout(dir);
  const before = readFileSync(path.join(dir, "comments", "profile.json"), "utf8");
  assert.deepEqual(migrateLayout(dir), []);
  assert.equal(readFileSync(path.join(dir, "comments", "profile.json"), "utf8"), before);
});

test("an existing namespaced file is never overwritten by a flat one", () => {
  const dir = flatFixture();
  write(path.join(dir, "comments", "tasks.json"), { comments: [{ id: "c9", screenId: "x", note: "kept" }], maxId: 9 });
  const said = migrateLayout(dir);
  assert.ok(said.some((line) => /was not moved: comments\/tasks\.json already exists/.test(line)), said.join("\n"));
  assert.equal(json(path.join(dir, "comments", "tasks.json")).comments[0].note, "kept");
  assert.ok(existsSync(path.join(dir, "comments.json")), "the flat file stays where it was");
});

test("an unclaimed flat review belongs to main", () => {
  const dir = path.join(scratch(), "design-canvas");
  write(path.join(dir, "comments.json"), { comments: [note("c1")] });
  migrateLayout(dir);
  assert.equal(json(path.join(dir, "comments", "main.json")).comments[0].image, "design-canvas/comments/main/c1.png");
});

test("an install already in today's layout is left alone", () => {
  const dir = path.join(scratch(), "design-canvas");
  write(path.join(dir, "comments", "main.json"), { comments: [{ id: "c1" }], waiting: { a: "new" }, maxId: 1 });
  assert.deepEqual(migrateLayout(dir), []);
  assert.ok(!existsSync(path.join(dir, "comments", ".migrated")));
});

test("an install from before first visits marks every review file as visited and keeps its queue, once", () => {
  const dir = path.join(scratch(), "design-canvas");
  write(path.join(dir, "core", "comment-file.mjs"), "export const CONTRACT = '';\n");
  write(path.join(dir, "comments", "main.json"), { comments: [{ id: "c1" }], waiting: { a: "new", b: "changed" }, maxId: 1 });
  write(path.join(dir, "comments", "done.json"), { comments: [], viewedAt: "2026-01-01T00:00:00.000Z" });
  const said = migrateLayout(dir);
  const main = json(path.join(dir, "comments", "main.json"));
  assert.match(main.viewedAt, /^\d{4}-\d\d-\d\dT/);
  assert.deepEqual(main.waiting, { a: "new", b: "changed" }, "the queue the reviewer had is the queue they keep");
  assert.equal(json(path.join(dir, "comments", "done.json")).viewedAt, "2026-01-01T00:00:00.000Z", "a recorded visit is kept");
  assert.ok(said.some((line) => /comments\/main\.json .*marked as visited/.test(line)), said.join("\n"));
  assert.equal(said.length, 1);
  const before = readFileSync(path.join(dir, "comments", "main.json"), "utf8");
  assert.deepEqual(migrateLayout(dir), []);
  assert.equal(readFileSync(path.join(dir, "comments", "main.json"), "utf8"), before);
});

test("an install whose core already records visits is left alone: an unvisited canvas stays unvisited", () => {
  const dir = path.join(scratch(), "design-canvas");
  write(path.join(dir, "core", "comment-file.mjs"), "/* writes viewedAt */\n");
  write(path.join(dir, "comments", "main.json"), { comments: [], maxId: 1 });
  assert.deepEqual(migrateLayout(dir), []);
  assert.equal(json(path.join(dir, "comments", "main.json")).viewedAt, undefined);
});

test("highestIdInText reads only the id shape a review file writes", () => {
  const diff = ['-      "id": "c41",', '+      "id": "c42",', '       "note": "say \\"id\\": \\"c999\\" in a sentence",', '+      "movedFrom": "tasks:c77",'].join("\n");
  assert.equal(highestIdInText(diff), 42);
  assert.equal(highestIdInText("no ids here"), 0);
});
