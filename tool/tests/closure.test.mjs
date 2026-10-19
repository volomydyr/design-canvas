/**
 * Tests for `closure.mjs`, the import walk the capture stamps frames with and the reuse registry reads.
 *
 *   node --test tool/tests/closure.test.mjs
 *
 * The walk was moved out of `capture.mjs` unchanged, and every stamp on every manifest was computed by its rules, so these
 * tests hold the rules themselves: `@/` and the other aliases follow the tsconfig `paths` (the project root without any), relative imports resolve from the importing file, folders resolve
 * to their `index`, a package is ignored, a `.css` file is listed but never read, and what cannot be resolved is skipped.
 *
 * NOT INSTALLED into a project.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { EXTENSIONS, filesReachedFrom, IMPORT_RE, resolveSpecifier, specifierBase } from "../closure.mjs";

const made = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** A throwaway project: `files` maps a relative path to its text. */
function project(files) {
  const root = mkdtempSync(path.join(tmpdir(), "canvas-closure-test-"));
  made.push(root);
  for (const [rel, text] of Object.entries(files)) {
    const at = path.join(root, rel);
    mkdirSync(path.dirname(at), { recursive: true });
    writeFileSync(at, text);
  }
  return root;
}

test("the extension order and the import pattern are the ones every stamp was computed with", () => {
  assert.deepEqual(EXTENSIONS, [".tsx", ".ts", ".jsx", ".js", ".mjs", ".css"]);
  assert.equal(
    String(IMPORT_RE),
    String(/(?:import|export)[\s\S]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g),
  );
});

test("@/ means the project root, and a relative import resolves from the importing file", () => {
  const root = project({
    "app/page.tsx": `import { A } from "@/components/a";\nimport { B } from "./local-b";\n`,
    "components/a.tsx": `export const A = 1;\n`,
    "app/local-b.ts": `export const B = 2;\n`,
  });
  assert.equal(resolveSpecifier("@/components/a", path.join(root, "app/page.tsx"), root), path.join(root, "components/a.tsx"));
  assert.equal(resolveSpecifier("./local-b", path.join(root, "app/page.tsx"), root), path.join(root, "app/local-b.ts"));
  assert.equal(resolveSpecifier("../components/a", path.join(root, "app/page.tsx"), root), path.join(root, "components/a.tsx"));
  assert.deepEqual(filesReachedFrom(["app/page.tsx"], root), ["app/local-b.ts", "app/page.tsx", "components/a.tsx"]);
});

test("a folder resolves to its index file, and the extension order decides between two candidates", () => {
  const root = project({
    "app/page.tsx": `import { X } from "@/components/x";\nimport { Y } from "@/lib/y";\n`,
    "components/x/index.tsx": `export const X = 1;\n`,
    "lib/y.ts": `export const Y = 1;\n`,
    "lib/y.js": `export const Y = 0;\n`,
  });
  assert.equal(resolveSpecifier("@/components/x", path.join(root, "app/page.tsx"), root), path.join(root, "components/x/index.tsx"));
  /* .ts comes before .js in the order, so the .ts wins. */
  assert.equal(resolveSpecifier("@/lib/y", path.join(root, "app/page.tsx"), root), path.join(root, "lib/y.ts"));
});

test("a package import is ignored, and so is anything that cannot be resolved", () => {
  const root = project({
    "app/page.tsx": `import React from "react";\nimport { Button } from "@radix-ui/react-button";\nimport { Gone } from "@/components/gone";\n`,
  });
  const from = path.join(root, "app/page.tsx");
  assert.equal(resolveSpecifier("react", from, root), null);
  assert.equal(resolveSpecifier("@radix-ui/react-button", from, root), null);
  assert.equal(resolveSpecifier("@/components/gone", from, root), null);
  assert.deepEqual(filesReachedFrom(["app/page.tsx"], root), ["app/page.tsx"]);
});

test("a css file is listed but never parsed", () => {
  const root = project({
    "app/page.tsx": `import "./x";\nimport styles from "./page.css";\n`,
    /* If the walk parsed this file it would follow the import below and list other.ts. */
    "app/page.css": `/* import { Z } from "./other"; */\n`,
    "app/other.ts": `export const Z = 1;\n`,
  });
  assert.deepEqual(filesReachedFrom(["app/page.tsx"], root), ["app/page.css", "app/page.tsx"]);
});

test("entries that do not exist are skipped, cycles terminate, and the result is repo-relative and sorted", () => {
  const root = project({
    "z/last.tsx": `import { A } from "@/a/first";\nexport const Z = 1;\n`,
    "a/first.tsx": `import { Z } from "@/z/last";\nexport const A = 1;\n`,
  });
  assert.deepEqual(filesReachedFrom(["z/last.tsx", "nothing/here.tsx"], root), ["a/first.tsx", "z/last.tsx"]);
});

test("a dynamic import and a re-export are followed", () => {
  const root = project({
    "app/page.tsx": `const Lazy = dynamic(() => import("@/components/lazy"));\n`,
    "app/barrel.ts": `export { Barrel } from "@/components/barrel";\n`,
    "components/lazy.tsx": `export default function Lazy() { return null; }\n`,
    "components/barrel.ts": `export const Barrel = 1;\n`,
  });
  assert.deepEqual(filesReachedFrom(["app/page.tsx"], root), ["app/page.tsx", "components/lazy.tsx"]);
  assert.deepEqual(filesReachedFrom(["app/barrel.ts"], root), ["app/barrel.ts", "components/barrel.ts"]);
});

test("in a src/ project, @/ resolves where the tsconfig paths say, comments and trailing commas included", () => {
  const root = project({
    "tsconfig.json": `{\n  // Next's src/ layout\n  "compilerOptions": {\n    /* no baseUrl: paths are relative to this file */\n    "paths": { "@/*": ["./src/*"], },\n  },\n}\n`,
    "src/app/page.tsx": `import { Card } from "@/components/card";\nimport { gen } from "@/generated/client";\n`,
    "src/components/card.tsx": `import { tone } from "@/lib/tone";\nexport const Card = 1;\n`,
    "src/lib/tone.ts": `export const tone = 1;\n`,
    "src/generated/client.ts": `export const gen = 1;\n`,
    /* The same names at the root, which the bundler never reaches. */
    "generated/client.ts": `export const gen = 0;\n`,
    "components/card.tsx": `export const Card = 0;\n`,
  });
  const from = path.join(root, "src/app/page.tsx");
  assert.equal(resolveSpecifier("@/components/card", from, root), path.join(root, "src/components/card.tsx"));
  assert.equal(specifierBase("@/components/gone", from, root), path.join(root, "src/components/gone"));
  assert.deepEqual(filesReachedFrom(["src/app/page.tsx"], root), [
    "src/app/page.tsx",
    "src/components/card.tsx",
    "src/generated/client.ts",
    "src/lib/tone.ts",
  ]);
});

test("baseUrl, a relative extends, jsconfig, other aliases, fallbacks and the longest prefix are read as the bundler reads them", () => {
  const extended = project({
    "tsconfig.base.json": `{ "compilerOptions": { "baseUrl": "src", "paths": { "@/*": ["*"], "~ui/*": ["ui/*", "fallback/*"], "@ui": ["ui/index.ts"], "@ui/special/*": ["special/*"] } } }`,
    "tsconfig.json": `{ "extends": "./tsconfig.base", "compilerOptions": { "strict": true } }`,
    "src/app/page.tsx": ``,
    "src/lib/a.ts": ``,
    "src/fallback/b.tsx": ``,
    "src/ui/index.ts": ``,
    "src/special/c.ts": ``,
    "src/ui/special/c.ts": ``,
  });
  const from = path.join(extended, "src/app/page.tsx");
  assert.equal(resolveSpecifier("@/lib/a", from, extended), path.join(extended, "src/lib/a.ts"));
  assert.equal(resolveSpecifier("~ui/b", from, extended), path.join(extended, "src/fallback/b.tsx"), "the second target when the first has no file");
  assert.equal(resolveSpecifier("@ui", from, extended), path.join(extended, "src/ui/index.ts"), "an exact alias");
  assert.equal(resolveSpecifier("@ui/special/c", from, extended), path.join(extended, "src/special/c.ts"), "the longest prefix wins");
  assert.equal(resolveSpecifier("react", from, extended), null);

  const js = project({ "jsconfig.json": `{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }`, "src/x.js": ``, "x.js": `` });
  assert.equal(resolveSpecifier("@/x", path.join(js, "a.js"), js), path.join(js, "src/x.js"));

  /* No paths anywhere: @/ is the project root, as it always was. */
  const plain = project({ "tsconfig.json": `{ "compilerOptions": {} }`, "lib/x.ts": `` });
  assert.equal(resolveSpecifier("@/lib/x", path.join(plain, "a.ts"), plain), path.join(plain, "lib/x.ts"));
});
