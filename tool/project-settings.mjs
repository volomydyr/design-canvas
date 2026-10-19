/**
 * design-canvas — THE PROJECT'S SETTINGS, written once and read by the tools that would otherwise be told every time.
 *
 *   design-canvas/settings.json      committed, the project's own, never overwritten by an install
 *
 *   {
 *     "appUrl": "http://localhost:3042",              where THIS project's dev server answers
 *     "storageState": "design-canvas/auth-state.json", the saved login (a path; its contents are never read here)
 *     "browserChannel": "chrome",                      the installed browser to photograph with, for an app with video
 *     "loginRoute": "/login",                          a sign-in route that is not called login or sign-in
 *     "locales": ["messages/en.json"],                 the shipped copy, for the preflight's claim check
 *     "allowWrites": ["/api/auth/verify"]              parts of an address the write guard lets through: a POST that only reads
 *   }
 *
 * The reuse checks (`checks.mjs`, `registry.mjs`) read three more, none of them needed by any other tool:
 *
 *     "buildFrom": ["tasks", "calendar"]               canvas slugs: the design new work builds from
 *     "designFiles": ["components/reports/", "components/*.hifi.tsx"]   what else is design work: a trailing "/" is a folder, a "*" a glob, else one file
 *     "designMarkers": ["canvas-hifi"]                 a word that marks a file as design work wherever it appears in the text
 *
 * The installer's answer to its one question (add the local hook or not) is NOT here: this file is committed and an answer is
 * about one machine, so the installer keeps it in a file on the machine.
 *
 * WHY THIS EXISTS. A round is one command (`round.mjs`) because the same four facts (the session, the browser, the port,
 * the login route) would otherwise be typed into every command, differently for the capture and the check. They are facts
 * about the PROJECT, so they live in the project, once.
 *
 * THERE IS NO DEFAULT PORT, deliberately. `http://localhost:3000` is what every tool here used to assume, and on a machine
 * with several apps running that is often another project's dev server, which a tool would then check without noticing.
 * A tool that cannot find the port says where to
 * write it; it does not guess. `round.mjs` also proves the server it reaches serves THIS project's declaration.
 *
 * Unknown keys are refused, because a typo in a settings file ("browserchannel") would otherwise read as no setting at all
 * and the tool would quietly run the way it did before the file existed.
 *
 * DELETE WITH: the design-canvas/ folder.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { die } from "./browser-guards.mjs";
import { allowWrites } from "./network.mjs";

const KEYS = [
  "appUrl",
  "storageState",
  "browserChannel",
  "loginRoute",
  "locales",
  "flagPct",
  "buildFrom",
  "designFiles",
  "designMarkers",
  "allowWrites",
];

/** What to write when there is no file: printed in the one line that says so. */
export const SETTINGS_EXAMPLE = `{ "appUrl": "http://localhost:<this project's dev port>", "storageState": "design-canvas/auth-state.json", "browserChannel": "chrome", "locales": ["messages/en.json"] }`;

/**
 * Read `design-canvas/settings.json`. A missing file is an EMPTY settings object, not an error (every tool works without
 * one, as it always did); the tools that cannot work without an address call `requireAppUrl`.
 *
 * Paths in it are relative to the PROJECT ROOT (the folder that holds `design-canvas/`), which is where a person would
 * type them from.
 */
export function loadSettings(canvasDir, who) {
  const settings = parseSettings(canvasDir, (message) => die(who, message));
  /* Every tool that opens a browser reads its settings here first, so the write guard always knows the project's list. */
  allowWrites(settings.allowWrites);
  return settings;
}

/** Thrown by the safe reader's `fail`, so one validation serves both a tool that exits and a hook that must not. */
class SettingsProblem extends Error {}

/**
 * The same read and the same validation as `loadSettings`, for a caller that must NEVER exit the process. `die` exits with
 * code 2, and in a Claude Code PreToolUse hook exit code 2 means "block this edit": a typo in settings.json would then block
 * every edit in the project. So the hook reads through here and gets `{ settings, error }` back: `settings` is the parsed
 * object (null when there is a problem) and `error` is one line (null when there is none).
 */
export function readSettingsSafe(canvasDir) {
  try {
    const settings = parseSettings(canvasDir, (message) => {
      throw new SettingsProblem(message);
    });
    return { settings, error: null };
  } catch (error) {
    return { settings: null, error: String(error?.message ?? error).split("\n")[0] };
  }
}

/** The validation itself. `fail(message)` ends the read: the exiting tools pass `die`, the safe reader passes a thrower. */
function parseSettings(canvasDir, fail) {
  const file = path.join(canvasDir, "settings.json");
  const none = {
    file: null,
    appUrl: null,
    port: null,
    storageState: null,
    browserChannel: null,
    loginRoute: null,
    locales: [],
    flagPct: null,
    buildFrom: [],
    designFiles: [],
    designMarkers: [],
    allowWrites: [],
  };
  if (!existsSync(file)) return none;
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    return fail(`design-canvas/settings.json is not valid JSON (${String(error.message).split("\n")[0]})`);
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail("design-canvas/settings.json must be one object, like " + SETTINGS_EXAMPLE);
  /* "port" was a second way to give the address; one way is enough. */
  if (raw.port !== undefined) return fail(`design-canvas/settings.json: "port" is no longer read; write the address instead: "appUrl": "http://localhost:${raw.port}"`);
  for (const key of Object.keys(raw))
    if (!KEYS.includes(key)) return fail(`design-canvas/settings.json has an unknown key "${key}". The keys are: ${KEYS.join(", ")}`);
  const root = path.dirname(canvasDir);
  const text = (key) => {
    if (raw[key] === undefined) return null;
    if (typeof raw[key] !== "string" || raw[key].trim() === "") return fail(`design-canvas/settings.json: "${key}" must be a non-empty string`);
    return raw[key].trim();
  };
  let appUrl = text("appUrl");
  if (appUrl !== null) {
    if (!/^https?:\/\/[^\s/]+/.test(appUrl)) return fail(`design-canvas/settings.json: "appUrl" must start with http:// or https://, got "${appUrl}"`);
    appUrl = appUrl.replace(/\/+$/, "");
  }
  /* The port, read out of the address, for the tools that print it. */
  const port = appUrl !== null && new URL(appUrl).port ? Number(new URL(appUrl).port) : null;
  const locales = raw.locales === undefined ? [] : raw.locales;
  if (!Array.isArray(locales) || locales.some((one) => typeof one !== "string" || one.trim() === ""))
    return fail(`design-canvas/settings.json: "locales" must be a list of file paths`);
  const flagPct = raw.flagPct === undefined ? null : raw.flagPct;
  if (flagPct !== null && !(typeof flagPct === "number" && flagPct >= 0 && flagPct <= 100)) return fail(`design-canvas/settings.json: "flagPct" must be a number from 0 to 100`);
  const strings = (key, what) => {
    const value = raw[key] === undefined ? [] : raw[key];
    if (!Array.isArray(value) || value.some((one) => typeof one !== "string" || one.trim() === ""))
      return fail(`design-canvas/settings.json: "${key}" must be a list of ${what}`);
    return value.map((one) => one.trim());
  };
  const buildFrom = strings("buildFrom", "canvas slugs");
  const badSlug = buildFrom.find((one) => !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(one));
  if (badSlug !== undefined) return fail(`design-canvas/settings.json: "buildFrom" holds "${badSlug}", which is not a canvas slug (letters, digits, - and _)`);
  const designFiles = strings("designFiles", "project-relative paths");
  const designMarkers = strings("designMarkers", "words");
  const allowed = strings("allowWrites", "parts of an address");
  const storage = text("storageState");
  return {
    file,
    appUrl,
    port,
    storageState: storage === null ? null : path.resolve(root, storage),
    browserChannel: text("browserChannel"),
    loginRoute: text("loginRoute"),
    locales: locales.map((one) => path.resolve(root, one)),
    flagPct,
    buildFrom,
    designFiles,
    designMarkers,
    allowWrites: allowed,
  };
}

/** The address of THIS project's app, or the one line that says where to write it. Never a guess. */
export function requireAppUrl(settings, who) {
  if (settings.appUrl) return settings.appUrl;
  return die(
    who,
    settings.file
      ? `design-canvas/settings.json names no "appUrl": write where this project's dev server answers`
      : `there is no design-canvas/settings.json, and this tool does not guess a port (3000 is usually a neighbour's app). Write it once: ${SETTINGS_EXAMPLE}`,
  );
}

/**
 * WHAT ONE RUN USES: a flag (`--url`, `--storage-state`, `--browser-channel`, `--login-route`) wins, then the `CANVAS_*` variable,
 * then the file. `appUrl` is null when neither a flag nor the file names it; the tools that need it say where to write it.
 */
export function runSettings(argv, settings) {
  const flag = (name) => {
    const at = argv.indexOf(`--${name}`);
    return at === -1 ? undefined : argv[at + 1];
  };
  return {
    appUrl: (flag("url") ?? settings.appUrl ?? null)?.replace(/\/+$/, "") ?? null,
    storageState: flag("storage-state") ?? process.env.CANVAS_STORAGE_STATE ?? settings.storageState ?? undefined,
    browserChannel: flag("browser-channel") ?? process.env.CANVAS_BROWSER_CHANNEL ?? settings.browserChannel ?? undefined,
    loginRoute: flag("login-route") ?? process.env.CANVAS_LOGIN_ROUTE ?? settings.loginRoute ?? undefined,
  };
}

/**
 * The environment the other tools read their settings from, built from the file: the capture and the oracle both take the
 * session, the browser and the login route from `CANVAS_*` variables (or flags) exactly as they always did, so one file
 * serves them without either tool learning about it.
 */
export function settingsEnv(settings) {
  return {
    ...(settings.storageState ? { CANVAS_STORAGE_STATE: settings.storageState } : {}),
    ...(settings.browserChannel ? { CANVAS_BROWSER_CHANNEL: settings.browserChannel } : {}),
    ...(settings.loginRoute ? { CANVAS_LOGIN_ROUTE: settings.loginRoute } : {}),
  };
}
