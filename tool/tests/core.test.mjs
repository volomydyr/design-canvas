/**
 * The core's own suite (core/__tests__, vitest), run from here so it stays in the skill and never joins a project's tests.
 * It needs React and vitest, which a project carries and the skill does not: point CANVAS_TEST_PROJECT at a project that has
 * both, and the core is copied into a scratch folder beside a link to that project's node_modules.
 *
 *   CANVAS_TEST_PROJECT=/path/to/project node --test tool/tests/core.test.mjs
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PROJECT = process.env.CANVAS_TEST_PROJECT;
const vitest = PROJECT && path.join(PROJECT, "node_modules", ".bin", "vitest");

test("the core's vitest suite passes", { skip: vitest && existsSync(vitest) ? false : "set CANVAS_TEST_PROJECT to a project that has vitest and react to run the core's suite", timeout: 300_000 }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), "canvas-core-"));
  try {
    cpSync(path.join(SKILL, "core"), path.join(dir, "core"), { recursive: true });
    symlinkSync(path.join(PROJECT, "node_modules"), path.join(dir, "node_modules"));
    const run = spawnSync(vitest, ["run", "core"], { cwd: dir, encoding: "utf8" });
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`.trim().split("\n").slice(-30).join("\n"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
