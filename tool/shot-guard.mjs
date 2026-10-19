/**
 * design-canvas — THE BROKEN-SHOT GUARD: a new picture that is far smaller than the one it would replace AND comes from a page
 * with almost no text on it is not a design, it is a page that did not arrive, and the picture already on the canvas is kept.
 *
 * WHY THIS EXISTS. The capture already refuses a blank page (a picture under `MIN_BYTES`) and a skeleton it can name (a
 * placeholder it can find on the page). Neither sees a page that arrived as something else: a dev-server run can write
 * broken pictures that pass every check, a white page and the ROUTE's own loading
 * skeleton where a held list's skeleton belonged, found only by a person looking. Each was caught by exactly the
 * pair below, and neither half is enough alone:
 *
 *   FAR SMALLER   a picture's size in bytes is the cheapest measure of how much is in it. A frame that was 120kb and is 15kb
 *                 lost nearly everything it had, but a frame that is small on purpose (a one-line empty state) must be free
 *                 to be small, so size alone would reject real designs.
 *   NO TEXT       a design has words in it. Even an empty state says what it is, so a page with almost no text is either
 *                 blank or still loading. Text alone would reject a page that is genuinely a picture (a photograph, a chart).
 *
 * BOTH TOGETHER are what separates "the page did not arrive" from "the design changed". A first capture has no previous
 * picture to compare with and is never judged here, and `sparse: true` (the page IS this empty) switches the guard off, as it
 * does the blank-page floor.
 *
 * THE NUMBERS, and how they were chosen. Measured on a 1440 by 900 page at the capture's own WebP quality (the pictures and
 * their text are in `tool/tests/shot-guard.test.mjs` and `capture-network.test.mjs`):
 *
 *   a blank white page                       3kb      1 character
 *   a gray skeleton, no words                4 to 8kb 0 to 11 characters
 *   three lines of real copy on white        7kb      50 characters
 *   a page with only a picture on it         15kb     1 character
 *   an app shell, a title and six rows       20kb     284 characters
 *   a dense table of 144 colored cells      146kb    1811 characters
 *
 * "FAR SMALLER" is under 40 percent of the picture it replaces. A real frame is 20 to 150kb, so the skeleton or the blank page
 * that took its place is 2 to 40 percent of it and falls under the line, while a frame that changed a little stays far above it,
 * and so does a page that was a picture to begin with. "NO TEXT" is under 30 characters of visible text in the whole document:
 * three lines of real copy are 50, an app shell is several hundred, a skeleton is none or one short word. A real redesign that
 * made a page far smaller (a dense table that became a one-sentence empty state: 146kb to 11kb, 5 percent) keeps its sentence,
 * so it passes on its words; it is the PAIR that rejects.
 *
 * A rejected picture is reported and held for the second pass, which photographs the frame alone; if it still looks broken
 * the old picture stays and the run fails, naming both sizes and the character count.
 *
 * DELETE WITH: the design-canvas/ folder.
 */

/** The new picture must be under this fraction of the previous one's bytes to count as far smaller. */
export const SHRINK_RATIO = 0.4;

/** Fewer visible characters than this in the whole document is almost no text. */
export const NEAR_EMPTY_CHARS = 30;

/** How many characters of text a page has: whitespace collapsed, the way a person would count what they read. */
export function textLength(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim().length;
}

const kb = (bytes) => `${Math.round(bytes / 1024)}kb`;

/**
 * IS THIS NEW PICTURE A BROKEN ONE? Null when it is not, or a sentence saying why when it is.
 *   `bytes`          the new picture's size
 *   `previousBytes`  the size of the picture it would replace, or nothing when there is none (then nothing is judged)
 *   `chars`          the visible text of the whole document, counted by `textLength`
 *   `sparse`         the screen declared that it is genuinely this empty
 */
export function brokenShot({ bytes, previousBytes, chars, sparse = false }) {
  if (sparse) return null;
  if (!(previousBytes > 0)) return null;
  if (!(bytes < previousBytes * SHRINK_RATIO)) return null;
  if (!(chars < NEAR_EMPTY_CHARS)) return null;
  return `a picture of ${kb(bytes)} where the last one was ${kb(previousBytes)}, from a page with ${chars} character${chars === 1 ? "" : "s"} of text: it looks like a page that did not arrive (sparse: true says the page is meant to be this small)`;
}

/**
 * A BROKEN IMAGE IS PART OF THE PAGE, NOT A PAGE STILL ARRIVING. An image the browser finished loading with nothing to show
 * (`complete` and no natural size: a 404, a file that does not decode) is a hole no wait and no second pass will fill. Refusing
 * the picture for it kept the previous picture of many good frames on every pass, over a single dead file on a dev media
 * server, and a third pass found the same hole. So a broken image no longer refuses a picture by itself:
 * the picture replaces the old one and the run names the image. The one exception is a previous picture that had FEWER holes,
 * which is what a media server that is down for the moment looks like (or a file that was there last time): then the old
 * picture is better evidence and is kept, still without a second pass, because the second pass meets the same dead address.
 * An image that has not finished arriving (`complete` false) is not this: it is still refused and retried as before.
 *
 * Null when the new picture may replace the old one, or a sentence saying why it may not.
 *   `broken`          images on the shot that finished failing
 *   `previousHoles`   holes in the picture it would replace, from its manifest entry (`images.broken`, or `images.empty` for an
 *                     entry written before the two were told apart); nothing when there is no previous picture
 *   `declared`        the screen declared `brokenImages: true`: the app really shows these broken, so nothing is judged
 */
export function brokenImagesVerdict({ broken, previousHoles, declared = false }) {
  if (declared || !(broken > 0)) return null;
  if (previousHoles === undefined || previousHoles === null) return null;
  if (previousHoles >= broken) return null;
  return `${broken} broken image${broken === 1 ? "" : "s"} where the previous picture had ${previousHoles}`;
}
