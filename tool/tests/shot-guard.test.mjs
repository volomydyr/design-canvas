/**
 * Tests for `shot-guard.mjs`: a new picture far smaller than the one it replaces, from a page with almost no text, is a page that
 * did not arrive. The numbers are the ones measured on a 1440 by 900 page at the capture's WebP quality (see the header of the
 * module), and the capture run with the guard on real pages is in `capture-network.test.mjs`.
 *
 *   node --test tool/tests/shot-guard.test.mjs
 *
 * NOT INSTALLED into a project: the installer copies only the files it lists.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { NEAR_EMPTY_CHARS, SHRINK_RATIO, brokenImagesVerdict, brokenShot, textLength } from "../shot-guard.mjs";

const KB = 1024;

test("the two numbers are the ones the header documents", () => {
  assert.equal(SHRINK_RATIO, 0.4);
  assert.equal(NEAR_EMPTY_CHARS, 30);
});

test("a skeleton or a blank page where a real frame was is broken, and the sentence says by how much", () => {
  /* The measured cases: an app shell of 20kb replaced by a grey skeleton of 4kb with no words, and by a blank page of 3kb with one dot. */
  const skeleton = brokenShot({ bytes: 4 * KB, previousBytes: 20 * KB, chars: 0 });
  assert.equal(skeleton, "a picture of 4kb where the last one was 20kb, from a page with 0 characters of text: it looks like a page that did not arrive (sparse: true says the page is meant to be this small)");
  const blank = brokenShot({ bytes: 3 * KB, previousBytes: 20 * KB, chars: 1 });
  assert.match(blank, /^a picture of 3kb where the last one was 20kb, from a page with 1 character of text: it looks like/);
  /* Two broken dev shots: a white page and the route's loading skeleton. */
  assert.ok(brokenShot({ bytes: 8 * KB, previousBytes: 146 * KB, chars: 11 }));
});

test("far smaller is not enough: a real redesign keeps its words and goes through", () => {
  /* A dense table (146kb, 1811 characters) that became one sentence of empty state (11kb, 84 characters): 7 percent of the size, so far smaller, and a page with words on it. */
  assert.equal(brokenShot({ bytes: 11 * KB, previousBytes: 146 * KB, chars: 84 }), null);
  /* Three lines of real copy are 50 characters: a short page is a page. */
  assert.equal(brokenShot({ bytes: 7 * KB, previousBytes: 20 * KB, chars: 50 }), null);
});

test("no text is not enough either: a page that is a picture, as big as it was, goes through", () => {
  assert.equal(brokenShot({ bytes: 14 * KB, previousBytes: 15 * KB, chars: 1 }), null);
  assert.equal(brokenShot({ bytes: 15 * KB, previousBytes: 15 * KB, chars: 0 }), null);
});

test("the lines are exact: 40 percent of the bytes and 30 characters are not over them, one under each is", () => {
  assert.equal(brokenShot({ bytes: 40 * KB, previousBytes: 100 * KB, chars: 0 }), null, "exactly 40 percent is not far smaller");
  assert.ok(brokenShot({ bytes: 40 * KB - 1, previousBytes: 100 * KB, chars: 0 }));
  assert.equal(brokenShot({ bytes: 4 * KB, previousBytes: 100 * KB, chars: 30 }), null, "30 characters is enough text");
  assert.ok(brokenShot({ bytes: 4 * KB, previousBytes: 100 * KB, chars: 29 }));
});

test("a frame with no picture yet is never judged, and `sparse` switches the guard off", () => {
  assert.equal(brokenShot({ bytes: 3 * KB, previousBytes: undefined, chars: 0 }), null, "a first capture has nothing to compare with");
  assert.equal(brokenShot({ bytes: 3 * KB, previousBytes: 0, chars: 0 }), null);
  assert.equal(brokenShot({ bytes: 3 * KB, previousBytes: 20 * KB, chars: 0, sparse: true }), null, "the page IS this empty, as the frame declared");
  assert.ok(brokenShot({ bytes: 3 * KB, previousBytes: 20 * KB, chars: 0, sparse: false }));
});

test("textLength counts what a person would read: whitespace collapsed, ends trimmed", () => {
  assert.equal(textLength("  Fixture App \n\n\t Open Tasks  "), "Fixture App Open Tasks".length);
  assert.equal(textLength(""), 0);
  assert.equal(textLength(undefined), 0);
  assert.equal(textLength("\n \t"), 0);
});

test("a broken image replaces a picture that was no better, and is only refused against one that had fewer holes", () => {
  /* One dead file on the dev media server, and the frame's previous picture had the same hole. */
  assert.equal(brokenImagesVerdict({ broken: 1, previousHoles: 1 }), null, "the old picture is no better: the new one replaces it");
  assert.equal(brokenImagesVerdict({ broken: 1, previousHoles: 2 }), null);
  assert.equal(brokenImagesVerdict({ broken: 1, previousHoles: undefined }), null, "a first capture is written, holes and all");
  assert.equal(brokenImagesVerdict({ broken: 0, previousHoles: 0 }), null, "nothing broken, nothing to say");
  /* A media server down for the moment: the old picture had its photographs and is better evidence. */
  assert.equal(brokenImagesVerdict({ broken: 3, previousHoles: 0 }), "3 broken images where the previous picture had 0");
  assert.equal(brokenImagesVerdict({ broken: 1, previousHoles: 0 }), "1 broken image where the previous picture had 0");
  assert.equal(brokenImagesVerdict({ broken: 3, previousHoles: 0, declared: true }), null, "brokenImages: true, the app really shows it broken");
});
