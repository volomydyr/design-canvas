/**
 * design-canvas — IS ANYTHING LISTENING AT THE APP'S ADDRESS? Asked once, before any browser or lane starts, by the capture, the
 * oracle and the round, so a dead address is one line in a second and not a timeout per frame.
 *
 * A TCP connection, not a page request: a dev server compiles whatever page is asked for, and the first compile of a large app
 * can take longer than any sensible bound. Connecting only proves something answers at the port, which is the whole question
 * here; whether it is THIS project's server is the round's next check.
 *
 * DELETE WITH: the design-canvas/ folder.
 */
import net from "node:net";

import { die } from "./browser-guards.mjs";

/** Null when something accepts a connection at the address, otherwise why not (`ECONNREFUSED`, `ENOTFOUND`, `ETIMEDOUT`). */
export function unreachable(appUrl, { timeoutMs = 5_000 } = {}) {
  let url;
  try {
    url = new URL(appUrl);
  } catch {
    return Promise.resolve("not an address");
  }
  const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
  return new Promise((resolve) => {
    const socket = net.connect({ host: url.hostname.replace(/^\[|\]$/g, ""), port, autoSelectFamily: true });
    const done = (why) => {
      socket.destroy();
      resolve(why);
    };
    socket.setTimeout(timeoutMs, () => done("ETIMEDOUT"));
    socket.once("connect", () => done(null));
    socket.once("error", (error) => done(String(error?.code ?? error?.message ?? error)));
  });
}

/** The one line a dead address gets, in every tool. */
export const deadAddressLine = (appUrl, why) =>
  `nothing answers at ${appUrl} (${why}). Start this project's dev server, or correct "appUrl" in design-canvas/settings.json`;

/** Stop the run in one line, exit 2, when nothing answers at the address. */
export async function requireAppAnswers(who, appUrl) {
  const why = await unreachable(appUrl);
  if (why) die(who, deadAddressLine(appUrl, why));
}
