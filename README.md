# design-canvas

Designers now design and build in the code of real products that already exist: often years old, or a first version a
teammate built with AI. To improve a product like that, you need to see all of it, every screen and every state, and build
on top of what is there. Drawing pages from scratch and guessing which states exist does not work.

design-canvas is a skill for Claude Code that puts your whole product on one canvas, taken from the running app, so you can
see it, comment on it, and change it with an agent.

## What you get

- **Every screen and every state on one canvas.** The empty list, the error, the dialog three clicks deep, the page a new
  user sees. Grouped side by side so similar states can be compared, and drawn as user flows that show what leads to what.
- **Your components.** A Design System tab shows the shared parts with their variants and states, and agents look them up
  before they write new UI.
- **Comments on the real screens.** Drag a box on any screen and type. The agent gets the picture with your box drawn on it,
  fixes the code, retakes the picture, and you approve or send it back.
- **Explorations side by side.** While a design question is open, a separate tab shows several options next to each other,
  numbered, with like and dislike. What you like survives and the next round builds on it.
- **A page for the team.** Publish the options as one page your teammates can open and comment on, without running the app.

Every frame is a picture of a real page of your app, with an Open button that takes you to that page in the same state.

## How to start

1. **Add the skill to Claude Code:**

   ```
   /plugin marketplace add volomydyr/design-canvas
   /plugin install design-canvas@design-canvas
   ```

2. **Ask it to put your product on a canvas**, in your project: "put every screen and state of the trip planner on a canvas".
   It reads the code, lists the screens and states it found, and asks you to confirm before it builds anything.
3. **Look, comment and build on top of it.** Open the address it gives you, comment on any screen, and ask for options when
   you want to try a different design.

## Requirements

- A Next.js App Router project with React 18 or later.
- Tailwind, or nothing: without Tailwind the canvas uses its own prebuilt stylesheet.
- Playwright, which takes the pictures. The installer tells you the command if it is missing.

Another framework (Vite, Remix, Astro) works if two small API routes are rewritten for its server.

## How it works

- **It copies itself into your project** as one folder, `design-canvas/`, that stays on your machine: git never sees it, and
  the few lines it adds to your app's own files are marked so that no commit or push carries them. Your developers'
  repository never receives canvas code or pictures, and there is no clean-up step before a hand-off. The canvas's own look
  is fixed and is the same in every project.
- **One file lists the screens.** `design-canvas/project/flows.ts` names every screen, the state it is shown in, and the
  words that must be on it. The agent writes it from your code.
- **Pictures, not live pages.** A canvas of dozens of live pages cannot pan or zoom smoothly, so each screen is captured
  with Playwright once it has fully loaded and stopped moving, and checked against the words it should show. Only screens
  whose code changed are captured again.
- **The canvas and its comments stay on your machine.** Your team sees and comments on it through the team page. If you
  want the canvas shared through git instead, say so, and the agent switches the project to shared.
- **Notes for your developers.** When the agent leaves something a developer has to finish, it marks the exact line. At the
  next push you get one list in chat (what, where, why), and the marks are gone from the code.

### Updates

Every commit to this repository is a release: `plugin.json` has no `version` field on purpose, so Claude Code follows the
latest commit. Run `/plugin marketplace update` to take an update, then run the installer once in each project that uses it:

```
node <skill dir>/scripts/install-canvas.mjs --target <project root>
```

It replaces the canvas and its tools and keeps your project's own files: the screen list, the pictures and the comments.
`scripts/check-install.mjs` tells you when a project is behind. `claude plugin validate` warns that the version is missing;
that is intended.

### This repository

It is the git repository, the plugin and the skill at once:

```
.claude-plugin/   the plugin manifest and the marketplace entry
SKILL.md          what the agent follows
core/             the canvas itself, copied byte for byte into every project
tool/             the commands the agent runs (capture, check, round, comments, sharing) and their tests
references/       the detail SKILL.md points to
stubs/            the files the installer writes into a project
scripts/          the installer, the install check and their helpers
```
