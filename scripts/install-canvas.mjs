#!/usr/bin/env node
/**
 * design-canvas — install the canvas into a project.
 *
 *   node <skill>/scripts/install-canvas.mjs [--target <repo root>] [--force]
 *
 * WHY THIS IS A SCRIPT AND NOT A LIST OF INSTRUCTIONS. The canvas's design is finished. It is copied
 * unchanged into every project, and the single most likely way to get this wrong is to treat it as
 * something to design again — to restyle it to the target's brand, to swap its buttons for the target's
 * components, to "improve" the chrome. A copy nobody hand-writes cannot drift, and `check-install.mjs`
 * then proves byte for byte that it did not.
 *
 * It writes:
 *   design-canvas/core/*            the generic canvas. Overwritten on every run; never edited per project.
 *   design-canvas/canvas-page.tsx   the page. Overwritten.
 *   design-canvas/capture.mjs       the capture pipeline. Overwritten.
 *   design-canvas/check-canvas.mjs  the oracle. Overwritten.
 *   design-canvas/README.md         the tool's own half, overwritten; everything below the project marker
 *                                near the end of it is the project's own and is kept.
 *   design-canvas/project/*         the adapter, ONLY when it is not there yet. Never overwritten without
 *                                --force, because it is the one part that is written per project.
 *   app/design-canvas/page.tsx      four route stubs, only when they are not there yet: the index, one canvas
 *   app/design-canvas/[canvas]/page.tsx   per URL segment, and the two endpoints.
 *   app/api/design-canvas/comments/route.ts
 *   app/api/design-canvas/shots/route.ts
 *   .gitignore                   three lines, appended when missing.
 *
 * It does NOT touch the Tailwind config, the root layout or the app shell. Those are the seams that
 * differ in every project; it prints exactly what is left to do and `check-install.mjs` fails until they
 * are done.
 */
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function argOf(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
const target = path.resolve(argOf("target") ?? process.cwd());
const force = process.argv.includes("--force");

if (!existsSync(path.join(target, "package.json"))) {
  console.error(
    `No package.json in ${target}. Point --target at the repo root.`,
  );
  process.exit(1);
}

const CANVAS = path.join(target, "design-canvas");
const written = [];
const kept = [];

/**
 * `overwrite: false` means "this file belongs to the project" — the declaration, the states, the route
 * stubs — and `--force` DOES NOT override that. Force is for the core: "re-copy the shipped files over
 * whatever is here". It used to mean "overwrite everything", which replaced a real 28-screen declaration
 * with the starter on a re-install, and the only reason nothing was lost is that the target was a git
 * checkout. A tool that can eat the one file the whole exercise is about, as a side effect of an upgrade,
 * is not a tool anybody should run twice.
 */
function put(from, to, { overwrite = true } = {}) {
  const absolute = path.join(target, to);
  /**
   * NOTHING IS WRITTEN OUTSIDE `--target`, checked rather than assumed.
   *
   * An install was reported dirtying the MAIN checkout as well as the worktree it was pointed at, four
   * times in one session, and one of those reinstalls carried uncommitted skill work into a prototype PR
   * branch. Whatever the route in, the invariant is one line: a path that escapes the target is a bug,
   * and a bug that edits a checkout somebody is working in must stop the install rather than land
   * quietly. `--target` is this script's whole contract.
   */
  const root = path.resolve(target);
  const inside = path.resolve(absolute);
  if (inside !== root && !inside.startsWith(root + path.sep)) {
    console.error(`install-canvas: refusing to write outside --target.\n  target: ${root}\n  path:   ${inside}`);
    process.exit(1);
  }
  if (existsSync(absolute) && !overwrite) {
    kept.push(to);
    return;
  }
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, readFileSync(from));
  written.push(to);
}

/**
 * Every file under the skill's `core/`, relative to it, directories included — `core/__tests__/` holds the
 * route's own test and a flat `readdirSync` handed a directory name to `readFileSync`, which throws EISDIR.
 */
function coreFiles(dir, prefix = "") {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory())
      out.push(...coreFiles(path.join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out;
}

/* The core, byte for byte. Whatever is in the skill's core/ is what lands, so adding a file there does
   not mean editing this script. */
const usesVitest = readFileSync(
  path.join(target, "package.json"),
  "utf8",
).includes("vitest");
const skipped = [];
for (const file of coreFiles(path.join(SKILL, "core"))) {
  /* The route's own test is the one shipped file with a test-runner dependency. A project on Jest, or with
     no runner at all, would get an import it cannot resolve and a red suite that is the tool's fault rather
     than its own — so it is installed only where it will run, and named in the report either way. */
  if (file.startsWith("__tests__/") && !usesVitest) {
    skipped.push(`design-canvas/core/${file}`);
    continue;
  }
  put(path.join(SKILL, "core", file), path.join("design-canvas", "core", file));
}

/* `dump-screens.mjs` is not optional: it is how the declaration reaches a capture run against a PRODUCTION
   build, which is the only way captures are repeatable. See the capture section of SKILL.md. */
for (const file of [
  "canvas-page.tsx",
  "capture.mjs",
  /* The one command a capture is actually run with: it builds into its own folder, serves it on its own port,
     captures, re-runs whatever flaked, and stops the server. The four-step procedure it replaces was skippable,
     and got skipped for a whole session. */
  "capture-run.mjs",
  "check-canvas.mjs",
  /* Marking a round's comments as worked, in one command rather than one fetch each — the hand version left
     comments behind twice in one session. */
  "drain.mjs",
  /* Splitting a canvas that has outgrown itself: the declaration is a text edit, but the REVIEW has to be moved
     with the frames or the old file keeps notes about screens it no longer draws. */
  "split-canvas.mjs",
  /* Retiring an exploration owes the reviewer a walk through every screen the winner landed on, and the ones
     that already existed are in `seen` already. This is the only thing that takes them back out of it. */
  "unsee.mjs",
  /* A first delivery starts the reviewer at zero marks: on a first capture every screen is new, so marking any
     is noise. Run once before handing over a new canvas; never again after. */
  "adopt.mjs",
  /* Verdicts are comments, so a verdict the reviewer SAYS instead of clicks is not in the file the next round
     is generated from. That is how a round once resurrected an option he had dropped and dropped the one he
     asked for by name. `check` refuses to let a round be built on an unknown verdict; `record` writes a spoken
     one with his words attached. */
  "verdicts.mjs",
  /* The copy standard, imported by check-canvas.mjs. Without it the oracle cannot start. */
  "copy-rules.mjs",
  "dump-screens.mjs",
]) {
  put(path.join(SKILL, "tool", file), path.join("design-canvas", file));
}

/**
 * The README is the one shipped file that is half the project's. Above the marker is this tool's own
 * description, replaced on every install so an upgrade cannot leave a stale one behind; from the marker
 * down is the project's — its ports, the seams the install cut into that repo, what is known to be broken
 * there — and none of it is derivable from anything the installer can see.
 *
 * It used to be overwritten whole, and the result was an install whose README told a team of developers to
 * open port 3000 when the app ran on 3040, with the real ports recorded only in `package.json` scripts
 * nobody was pointed at. A file that is rewritten from the outside cannot hold local knowledge unless
 * something protects the local half, so this does.
 */
const README_MARKER = "<!-- design-canvas:project";

function putReadme() {
  const to = path.join("design-canvas", "README.md");
  const absolute = path.join(target, to);
  const shipped = readFileSync(path.join(SKILL, "tool", "README.md"), "utf8");
  const shippedAt = shipped.indexOf(README_MARKER);
  if (shippedAt < 0) {
    /* The marker is what makes the split possible; a shipped README without one would silently start
       eating project halves, so this stops rather than guesses. */
    console.error(
      `The skill's tool/README.md has no "${README_MARKER}" marker, so the project's own half cannot be kept.`,
    );
    process.exit(1);
  }
  const existing = existsSync(absolute) ? readFileSync(absolute, "utf8") : "";
  const existingAt = existing.indexOf(README_MARKER);
  const projectHalf =
    existingAt >= 0 ? existing.slice(existingAt) : shipped.slice(shippedAt);
  writeFileSync(
    absolute,
    `${shipped.slice(0, shippedAt)}${projectHalf}`,
    "utf8",
  );
  written.push(existingAt >= 0 ? `${to} (kept this project's half)` : to);
}
putReadme();

/* The adapter, only if there is not one already: this is the part that is written per project, and
   overwriting a real declaration with the starter would throw away the actual work. */
put(
  path.join(SKILL, "stubs", "project-flows.starter.ts"),
  "design-canvas/project/flows.ts",
  {
    overwrite: false,
  },
);
put(
  path.join(SKILL, "stubs", "project-states.starter.ts"),
  "design-canvas/project/states.ts",
  {
    overwrite: false,
  },
);
put(
  path.join(SKILL, "stubs", "project-canvas-state-pin.tsx"),
  "design-canvas/project/canvas-state-pin.tsx",
  { overwrite: false },
);

/* The route stubs. Also never overwritten: a project may have wired them differently, and clobbering a
   working route is a worse failure than telling someone one already exists. */
put(
  path.join(SKILL, "stubs", "app-design-canvas-page.tsx"),
  "app/design-canvas/page.tsx",
  {
    overwrite: false,
  },
);
/* One canvas per URL segment: `/design-canvas/<slug>`. The index above lists them. */
put(
  path.join(SKILL, "stubs", "app-design-canvas-slug-page.tsx"),
  "app/design-canvas/[canvas]/page.tsx",
  { overwrite: false },
);
put(
  path.join(SKILL, "stubs", "app-api-canvas-comments-route.ts"),
  "app/api/design-canvas/comments/route.ts",
  { overwrite: false },
);
put(
  path.join(SKILL, "stubs", "app-api-canvas-shots-route.ts"),
  "app/api/design-canvas/shots/route.ts",
  { overwrite: false },
);

/**
 * WHAT IS IGNORED, AND WHAT IS DELIBERATELY NOT.
 *
 * The comments are one reviewer's working notes plus megabytes of annotated PNGs: consumed, then dead, and a
 * merge conflict inside somebody's feedback is a bad day. Ignored.
 *
 * THE CAPTURED SCREENS ARE NOT IGNORED, changed since after the first project handed its canvas to a
 * team. They are still artefacts — `capture.mjs` regenerates every one — but a checkout without them opens
 * the canvas on empty frames, and the canvas is a thing people are sent to read. Owner: "I think it would be
 * nice to commit the canvas as well, because that's something that the developers might need to look at."
 * 28 screens was 2.6MB of WebP. A project that would rather not carry them adds `design-canvas/shots/` here and
 * accepts that a fresh clone has to capture before it can review.
 */
const IGNORE = [
  "design-canvas/comments/",
  "design-canvas/comments.json",
  /* The rolling backups the route keeps of the file it is about to overwrite. */
  "design-canvas/comments.json.*",
  /* The Playwright storage state the capture logs in with. Live session tokens — never committed. */
  "design-canvas/auth-state.json",
];
const gitignorePath = path.join(target, ".gitignore");
const gitignore = existsSync(gitignorePath)
  ? readFileSync(gitignorePath, "utf8")
  : "";
const missingIgnores = IGNORE.filter((line) => !gitignore.includes(line));
if (missingIgnores.length > 0) {
  writeFileSync(
    gitignorePath,
    `${gitignore}${gitignore.endsWith("\n") || gitignore === "" ? "" : "\n"}
# design feedback from the review canvas, with its annotated pictures. One reviewer's working notes:
# consumed and then dead. The CAPTURED SCREENS in design-canvas/shots/ are committed on purpose, so a
# fresh checkout opens the canvas on real frames.
# DELETE WITH: the design-canvas/ folder.
${missingIgnores.join("\n")}
`,
    "utf8",
  );
  written.push(".gitignore");
}

/**
 * THE MANIFEST IS COMMITTED AND SHOULD STOP DROWNING REVIEWS.
 *
 * `shots/<canvas>/manifest.json` is generated, and it carries a per-file hash map, so one capture run can
 * add thousands of changed lines to a pull request or a review diff — enough, in one case, to crowd real
 * source files out of an automated reviewer's byte budget entirely. It still has to be committed: the
 * oracle reads it and a fresh checkout needs it.
 *
 * So it is marked GENERATED rather than removed. Git then shows it as one changed file instead of a wall
 * of hashes, GitHub collapses it by default, and nothing about how the tools read it changes.
 */
const ATTRIBUTES = [
  "design-canvas/shots/**/manifest.json -diff linguist-generated=true",
];
const attributesPath = path.join(target, ".gitattributes");
const attributes = existsSync(attributesPath) ? readFileSync(attributesPath, "utf8") : "";
const missingAttributes = ATTRIBUTES.filter((line) => !attributes.includes(line.split(" ")[0]));
if (missingAttributes.length > 0) {
  writeFileSync(
    attributesPath,
    `${attributes}${attributes.endsWith("\n") || attributes === "" ? "" : "\n"}
# The capture manifest is generated by design-canvas and carries a per-file hash map. Committed on
# purpose, shown as one line rather than thousands.
# DELETE WITH: the design-canvas/ folder.
${missingAttributes.join("\n")}
`,
    "utf8",
  );
  written.push(".gitattributes");
}

/* The receipt the boundary check verifies against, so "the canvas looks the same in every project" is
   something a script can prove rather than something a reader has to believe. */
const checksums = {};
for (const file of coreFiles(path.join(SKILL, "core"))) {
  if (file.startsWith("__tests__/") && !usesVitest) continue;
  checksums[`core/${file}`] = createHash("sha256")
    .update(readFileSync(path.join(SKILL, "core", file)))
    .digest("hex");
}
mkdirSync(CANVAS, { recursive: true });
writeFileSync(
  path.join(CANVAS, "core", ".checksums.json"),
  `${JSON.stringify(
    {
      contract:
        "sha256 of every file in design-canvas/core/ as the design-canvas skill shipped it. The canvas has one appearance in every project it is installed in; check-install.mjs fails if any of these files was edited here. Adapt the declaration in project/, never the core.",
      installedAt: new Date().toISOString(),
      files: checksums,
    },
    null,
    2,
  )}\n`,
  "utf8",
);

console.log(`installed into ${target}\n`);
for (const file of written) console.log(`  wrote  ${file}`);
for (const file of kept)
  console.log(`  kept   ${file} (already there — not overwritten)`);
for (const file of skipped)
  console.log(
    `  skipped ${file} (this project has no vitest — the core's own test is not installed)`,
  );

console.log(`
Still to do by hand, because every project does these differently. Mark each one
\`DELETE WITH: the design-canvas/ folder\`:

  1. TAILWIND. Add \`design-canvas/\` to the content globs — v3: "./design-canvas/**/*.{ts,tsx}" in
     tailwind.config; v4: @source "../design-canvas"; in the CSS entry. Do this FIRST. Without it every
     class the canvas uses that the app does not already use is silently dropped, and every styling
     observation you make afterwards is meaningless.
  2. NO APP SHELL. However this project decides a route renders without app chrome, put /design-canvas in
     it — the whole subtree, so /design-canvas/<slug> is covered too. The canvas is a canvas that imports the
     prototype, not a page of the prototype.
  3. STATE PINNING (only if any screen declares a \`state\`): render <CanvasStatePin /> from
     design-canvas/project/canvas-state-pin.tsx in the root layout, dev-only, one line.
  4. THE CAPTURE'S OWN BUILD FOLDER, if this is a Next project. In next.config, make the build folder come
     from the environment:

         distDir: process.env.CANVAS_BUILD_DIR || ".next",

     and add \`.next-canvas/\` to .gitignore, and \`".next-canvas/types/**/*.ts"\` to the tsconfig include
     beside the .next one. capture-run.mjs sets CANVAS_BUILD_DIR so its production build lands somewhere
     harmless; WITHOUT that line the variable is ignored, the build overwrites .next, and it takes down the
     dev server the reviewer is looking at. It fails silently, which is why it is on this list.
  5. Write design-canvas/project/flows.ts and name every canvas in its \`CANVASES\` record. Until it is real,
     check-canvas.mjs fails — which is the correct state for a half-written declaration.

Each canvas is addressed by its slug, and the slug namespaces its pictures and its review:

  /design-canvas/<slug>                     the canvas
  design-canvas/shots/<slug>/               its pictures
  design-canvas/comments/<slug>.json        its review

Then, per canvas:
  node design-canvas/capture-run.mjs --canvas <slug> && node design-canvas/check-canvas.mjs --canvas <slug>

Both default to \`main\`, which is the starter registry's one entry, so a single-canvas project can pass
nothing. UPGRADING AN EXISTING INSTALL: the routes keep reading a flat design-canvas/shots/ and
design-canvas/comments.json until the next capture, so nothing breaks in between — but that first namespaced
capture recaptures every screen, because there is no manifest under the new path to compare against.
`);
