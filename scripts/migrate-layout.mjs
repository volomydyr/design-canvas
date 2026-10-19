/**
 * design-canvas — MOVE AN OLDER INSTALL TO TODAY'S LAYOUT, once, at install time, so nothing at run time reads an old one.
 *
 *   design-canvas/comments.json + comments/<id>.png   ->  comments/<slug>.json + comments/<slug>/<id>.png
 *   design-canvas/shots/manifest.json + shots/*.webp  ->  shots/<slug>/
 *   `seen` and `changed` in a review file             ->  `waiting` (new: pictured and never seen; changed: as listed)
 *   a review file without `maxId`                     ->  `maxId`, the highest id in the file or anywhere in its history
 *   a review file from before first visits            ->  `viewedAt`, its `waiting` map kept: it was delivered already
 *
 * `<slug>` is the canvas the flat review file names in its `canvas` field, else `main` (the only canvas a flat install had).
 *
 * NOTHING IS DELETED. Pictures are copied and the originals stay where they were (the flat manifest is renamed to
 * `manifest.json.migrated`); a flat review file and its numbered backups move into `comments/.migrated/`, and a review file
 * rewritten in place is copied there first. A target that already exists is never overwritten: that step is skipped and
 * said. Running it again changes nothing.
 *
 * Called once by `install-canvas.mjs`. DELETE WITH: the skill.
 */
import { execFileSync } from "node:child_process";
import { constants, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

const SLUG = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const writeJson = (file, value) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
/* A copy-on-write clone where the disk supports one, a plain copy elsewhere. */
const copy = (from, to) => {
  mkdirSync(path.dirname(to), { recursive: true });
  copyFileSync(from, to, constants.COPYFILE_FICLONE);
};

/** The highest comment number in a piece of text, counting only the shape a review file writes (`"id": "c<digits>"`). */
export function highestIdInText(text) {
  let max = 0;
  for (const match of String(text).matchAll(/"id": "c(\d+)"/g)) max = Math.max(max, Number.parseInt(match[1], 10));
  return max;
}

/** The highest id a canvas's review ever held, read from every commit of its file in the history repository; 0 without one. */
function historyHighest(canvasDir, slug) {
  const repo = path.join(canvasDir, "comments", ".history");
  if (!existsSync(path.join(repo, ".git"))) return 0;
  try {
    return highestIdInText(
      execFileSync("git", ["-C", repo, "log", "--all", "-U0", "-p", "--format=", "--", `${slug}.json`], {
        encoding: "utf8",
        maxBuffer: 1024 * 1024 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
      }),
    );
  } catch {
    return 0;
  }
}

/** Run every step on one `design-canvas/` folder. Returns the lines it has to say; empty when there was nothing to do. */
export function migrateLayout(canvasDir) {
  const said = [];
  const comments = path.join(canvasDir, "comments");
  const kept = path.join(comments, ".migrated");
  const flat = path.join(canvasDir, "comments.json");
  /* The canvas the flat layout belonged to: the claim in the flat review file, or in its kept copy after a first run. */
  const claimOf = (file) => {
    try {
      const claim = readJson(file).canvas;
      return typeof claim === "string" && SLUG.test(claim) ? claim : null;
    } catch {
      return null;
    }
  };
  const flatSlug = claimOf(flat) ?? claimOf(path.join(kept, "comments.json")) ?? "main";

  /* 1. The flat review file and its pictures. */
  if (existsSync(flat)) {
    let raw = null;
    try {
      raw = readJson(flat);
    } catch {
      said.push(`design-canvas/comments.json does not parse, so it was left where it is: fix or move it by hand`);
    }
    if (raw) {
      const target = path.join(comments, `${flatSlug}.json`);
      if (existsSync(target)) {
        said.push(`design-canvas/comments.json was not moved: comments/${flatSlug}.json already exists. Merge the two by hand`);
      } else {
        const { canvas: _claim, ...rest } = raw;
        const records = (rest.comments ?? []).map((one) => {
          const name = /^design-canvas\/comments\/(c\d+\.png)$/.exec(String(one.image ?? ""))?.[1];
          if (!name) return one;
          const from = path.join(comments, name);
          if (existsSync(from)) copy(from, path.join(comments, flatSlug, name));
          return { ...one, image: `design-canvas/comments/${flatSlug}/${name}` };
        });
        mkdirSync(comments, { recursive: true });
        writeJson(target, { ...rest, comments: records });
        mkdirSync(kept, { recursive: true });
        for (const name of readdirSync(canvasDir).filter((one) => /^comments\.json(\.\d+)?$/.test(one)))
          renameSync(path.join(canvasDir, name), path.join(kept, name));
        said.push(
          `design-canvas/comments.json moved to comments/${flatSlug}.json (${records.length} comment(s), pictures copied to comments/${flatSlug}/); ` +
            `the original and its backups are kept in comments/.migrated/`,
        );
      }
    }
  }

  /* 2. The flat pictures folder. */
  const flatManifest = path.join(canvasDir, "shots", "manifest.json");
  if (existsSync(flatManifest)) {
    const target = path.join(canvasDir, "shots", flatSlug);
    if (existsSync(path.join(target, "manifest.json"))) {
      said.push(`design-canvas/shots/manifest.json was not moved: shots/${flatSlug}/ already has a manifest`);
    } else {
      const manifest = readJson(flatManifest);
      let pictures = 0;
      for (const shot of manifest.shots ?? []) {
        const file = path.basename(String(shot.file ?? ""));
        if (!file) continue;
        for (const sub of ["", "small"]) {
          const from = path.join(canvasDir, "shots", sub, file);
          if (existsSync(from)) {
            copy(from, path.join(target, sub, file));
            if (!sub) pictures += 1;
          }
        }
      }
      copy(flatManifest, path.join(target, "manifest.json"));
      renameSync(flatManifest, `${flatManifest}.migrated`);
      said.push(
        `design-canvas/shots/ copied to shots/${flatSlug}/ (${pictures} picture(s)); the flat pictures and shots/manifest.json.migrated ` +
          `can be deleted once the canvas looks right`,
      );
    }
  }

  /* 3. Every review file: the waiting map, `maxId`, `viewedAt`, and no claim field. An install whose core never wrote
     `viewedAt` predates first visits, so each review file it holds was delivered already: it is marked as visited, keeping
     its queue. A core that writes the field means its files say for themselves whether the canvas was opened. */
  const installedCore = path.join(canvasDir, "core", "comment-file.mjs");
  const beforeFirstVisits =
    existsSync(path.join(canvasDir, "core")) && !(existsSync(installedCore) && readFileSync(installedCore, "utf8").includes("viewedAt"));
  const now = new Date().toISOString();
  if (existsSync(comments)) {
    for (const name of readdirSync(comments).filter((one) => one.endsWith(".json"))) {
      const slug = name.slice(0, -".json".length);
      const file = path.join(comments, name);
      let review;
      try {
        review = readJson(file);
      } catch {
        said.push(`comments/${name} does not parse, so it was not migrated`);
        continue;
      }
      const next = { ...review };
      const notes = [];
      if (!next.waiting && (Array.isArray(review.seen) || Array.isArray(review.changed))) {
        const manifest = path.join(canvasDir, "shots", slug, "manifest.json");
        const pictured = existsSync(manifest) ? (readJson(manifest).shots ?? []).map((shot) => shot.screenId) : [];
        const waiting = {};
        if (Array.isArray(review.seen)) {
          const seen = new Set(review.seen);
          const changed = new Set(review.changed ?? []);
          for (const id of pictured) {
            if (!seen.has(id)) waiting[id] = "new";
            else if (changed.has(id)) waiting[id] = "changed";
          }
        }
        if (Object.keys(waiting).length > 0) next.waiting = waiting;
        notes.push(`${Object.keys(waiting).length} screen(s) waiting`);
      }
      if (beforeFirstVisits && typeof next.viewedAt !== "string") {
        next.viewedAt = now;
        notes.push("marked as visited");
      }
      delete next.seen;
      delete next.changed;
      delete next.canvas;
      if (typeof next.maxId !== "number") {
        const ids = (review.comments ?? []).map((one) => /^c(\d+)$/.exec(String(one.id))?.[1]).filter(Boolean).map(Number);
        const maxId = Math.max(0, ...ids, historyHighest(canvasDir, slug));
        if (maxId > 0) {
          next.maxId = maxId;
          notes.push(`maxId ${maxId}`);
        }
      }
      if (JSON.stringify(next) === JSON.stringify(review)) continue;
      if (!existsSync(path.join(kept, name))) copy(file, path.join(kept, name));
      writeJson(file, next);
      said.push(`comments/${name} moved to the current format (${notes.join(", ") || "old fields dropped"}); the original is kept in comments/.migrated/`);
    }
  }
  return said;
}
