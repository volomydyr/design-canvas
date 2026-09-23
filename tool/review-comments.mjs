#!/usr/bin/env node
/**
 * design-canvas — READ THE TEAM'S COMMENTS FROM A SHARED CANVAS PAGE, AND ANSWER THEM THERE.
 *
 *   node design-canvas/review-comments.mjs list   --canvas <slug> --file <review.json read from the live page>
 *   node design-canvas/review-comments.mjs answer --canvas <slug> --file <review.json read from the live page> \
 *          --id p3 --text "Moved it under the table"          (or --answers answers.json holding {"p3": "..."})
 *
 * The page built by review-build.mjs saves every comment into `review.json` beside it: the frame, a box in percent
 * of that frame, the words, the author's page id and the time. The agent reads that file off the live page with
 * the Artifact tool (`read_file`, path `review.json`) and hands it to this script.
 *
 * LIST prints the comments nobody has answered yet, one per line, and draws each box onto its screenshot as
 * `review/<slug>/comments/<id>.png`, so the agent looks at exactly what the reviewer pointed at. Open the picture;
 * the words alone are not the comment.
 *
 * ANSWER writes the reply under the comment's pin (`answer: { text, at }`, which the page draws and marks the pin
 * green) into `review/<slug>/review.json`, built on the --file given. That file must be the LIVE one, read just
 * now: the agent then publishes only `review.json` to the page, and a publish built on an older copy drops a
 * teammate's newer note.
 *
 * NOTHING HERE TOUCHES THE CANVAS: not its comments file, not its routes, not the declaration. Sharing is a
 * separate loop that ends in the page.
 *
 * DELETE WITH: the design-canvas/ folder.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const mode = argv[0];
const argOf = (name) => {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 ? argv[at + 1] : undefined;
};
const fail = (message) => {
  console.error(`review-comments: ${message}`);
  process.exit(1);
};

if (mode !== "list" && mode !== "answer") fail("say list or answer first");
const slug = argOf("canvas");
if (!slug || !/^[a-z0-9-]+$/.test(slug)) fail("name the canvas: --canvas <slug>");
const file = argOf("file");
if (!file || !existsSync(file)) fail("--file must name the review.json read from the live page just now");
const review = JSON.parse(readFileSync(file, "utf8"));
if (!Array.isArray(review.comments)) fail(`${file} holds no comments list`);

const out = path.join(HERE, "review", slug);
const pagePath = path.join(out, "index.html");
if (!existsSync(pagePath)) fail(`no built page for "${slug}": run review-build.mjs --canvas ${slug} first`);
const data = JSON.parse(/<script id="canvas-data" type="application\/json">([\s\S]*?)<\/script>/.exec(readFileSync(pagePath, "utf8"))[1]);
const frameOf = new Map(
  data.sections.flatMap((section) => section.frames.map((frame) => [frame.id, { ...frame, section: section.title }])),
);

if (mode === "list") {
  const open = review.comments.filter((comment) => !comment.answer?.text);
  const answered = review.comments.length - open.length;
  if (open.length === 0) {
    console.log(`no open comments (${answered} answered)`);
    process.exit(0);
  }
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  const page = await browser.newPage();
  mkdirSync(path.join(out, "comments"), { recursive: true });
  for (const comment of open) {
    const frame = frameOf.get(comment.frame);
    let picture = "(the frame is no longer on the page, so there is no picture)";
    const shot = path.join(out, "shots", `${comment.frame}.webp`);
    if (frame && existsSync(shot)) {
      const png = await page.evaluate(
        async ({ src, w, h, region, label }) => {
          const image = new Image();
          image.src = src;
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(image, 0, 0, w, h);
          const x = (region.x / 100) * w;
          const y = (region.y / 100) * h;
          /* The canvas's own annotation stroke (core/canvas-frame.tsx), so the picture reads like every hand-off. */
          ctx.lineWidth = 4;
          ctx.strokeStyle = "#e11d48";
          ctx.strokeRect(x, y, (region.w / 100) * w, (region.h / 100) * h);
          ctx.font = "bold 22px system-ui, sans-serif";
          const tw = ctx.measureText(label).width;
          ctx.fillStyle = "#e11d48";
          ctx.fillRect(x, Math.max(0, y - 30), tw + 16, 30);
          ctx.fillStyle = "#ffffff";
          ctx.fillText(label, x + 8, Math.max(22, y - 8));
          return canvas.toDataURL("image/png");
        },
        {
          src: `data:image/webp;base64,${readFileSync(shot).toString("base64")}`,
          w: frame.w,
          h: frame.h,
          region: comment.region,
          label: comment.id,
        },
      );
      picture = path.join(out, "comments", `${comment.id}.png`);
      writeFileSync(picture, Buffer.from(png.split(",")[1], "base64"));
    }
    console.log(
      `${comment.id}  ${frame ? `${frame.section} / ${frame.label}` : comment.frame}  by ${comment.by ?? "unknown"}  ${comment.at ?? ""}\n` +
        `     "${comment.note}"\n     picture: ${path.relative(path.dirname(HERE), picture)}`,
    );
  }
  await browser.close();
  console.log(`${open.length} open, ${answered} answered. Author ids are page ids: the owner names them.`);
}

if (mode === "answer") {
  const answers = argOf("answers")
    ? JSON.parse(readFileSync(argOf("answers"), "utf8"))
    : argOf("id")
      ? { [argOf("id")]: argOf("text") }
      : fail("give --id and --text, or --answers <file>");
  const known = new Set(review.comments.map((comment) => comment.id));
  const unknown = Object.keys(answers).filter((id) => !known.has(id));
  if (unknown.length > 0) fail(`no comment ${unknown.join(", ")} in ${file}`);
  const empty = Object.entries(answers).filter(([, text]) => !String(text ?? "").trim()).map(([id]) => id);
  if (empty.length > 0) fail(`empty answer for ${empty.join(", ")}`);
  const at = new Date().toISOString();
  const comments = review.comments.map((comment) =>
    answers[comment.id] ? { ...comment, answer: { text: String(answers[comment.id]).trim(), at } } : comment,
  );
  mkdirSync(out, { recursive: true });
  const target = path.join(out, "review.json");
  writeFileSync(target, `${JSON.stringify({ ...review, comments }, null, 2)}\n`);
  console.log(`answered ${Object.keys(answers).join(", ")} in ${path.relative(path.dirname(HERE), target)}`);
  console.log(
    `now publish it: Artifact publish, url = the page, file_path ${path.join(out, "index.html")}, root ${out}, ` +
      `files {"review.json": "review.json"} and nothing else, so the pictures and the page stay as they are`,
  );
}
