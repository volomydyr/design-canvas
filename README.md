# design-canvas

When you prototype something complex for developers, you have to show every state: the empty one, the error,
how a page looks for a new user versus someone who has been there a year. Usually that means building a
switcher into the prototype so people can flip between modes, which is annoying to make and makes developers
think the switcher is part of the product. This puts every screen and state on one canvas instead, grouped and
connected into user flows, and lets you comment on any frame and send it back to Claude with the picture
attached. It also has an exploration mode, where Claude sketches a few different takes on a screen and you
pick the one that works.

Nothing on the canvas is a mockup. Every frame is the real route, running, with a state pinned.

## Install

```
/plugin marketplace add volomydyr/design-canvas
/plugin install design-canvas@design-canvas
```

Then ask for a canvas of a feature — "put every screen and state of the checkout on a canvas" — or invoke the
skill directly.

## Updates

**Every commit is a release.** `version` is deliberately left out of `plugin.json`, so Claude Code falls back to
the git commit SHA: anyone who has this installed tracks the latest commit rather than waiting for a version
bump. Changes are picked up with:

```
/plugin marketplace update
```

> Do not add a `version` field unless you want the opposite. With one set, the docs are explicit that "users only
> receive updates when you bump it" — so a fix pushed here would stay invisible until someone edited a number.
> `claude plugin validate` warns that the version is missing; that warning is the intended state.

**Having the newer skill is not the same as updating a project.** The skill copies itself into every project it
is used in, so after taking an update run this once per project:

```
node <skill dir>/scripts/install-canvas.mjs
```

It overwrites the canvas and the tool scripts and deliberately leaves `project/` alone — the declaration, the
pinned states, the pictures and the review all survive. `scripts/check-install.mjs` fails when a project's copy
has drifted, so it is easy to tell which projects are behind.

## What it needs from a project

- **Next.js + Tailwind + Playwright.** The capture drives real routes through Playwright; the install writes a
  page stub and two API route stubs. `capture-run.mjs` builds and serves with `next` by default and takes
  `--build-cmd` / `--serve-cmd` for anything else.
- **Four seams the installer cannot write for you**, printed at the end of every install: the Tailwind content
  glob, a no-app-shell rule for `/design-canvas`, the state-pin line in the root layout, and — for the fast
  capture — `distDir: process.env.CANVAS_BUILD_DIR || ".next"` in the next config, so a capture build never
  overwrites the dev server's `.next`.
- `scripts/check-install.mjs` fails until those are in place, and names the one that is missing.

## Layout

This folder is three things at once, which is why nothing is nested: it is the git repository, the plugin, and
the skill.

```
.claude-plugin/
  marketplace.json     the catalog Claude Code reads, pointing at "./"
  plugin.json          the plugin manifest
SKILL.md               the procedure
core/                  the canvas, checksum-enforced and never edited per project
tool/                  capture-run, capture, check-canvas, drain, dump-screens
references/            the long-form detail SKILL.md points at
stubs/                 the files the installer copies into a project
scripts/               install-canvas, check-install
```

`core/` is byte-for-byte enforced: `scripts/check-install.mjs` fails if a project edited it, because the canvas's
own design travels as-is and is never restyled to fit the app it is reviewing.
