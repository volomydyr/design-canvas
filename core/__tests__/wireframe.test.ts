import { describe, expect, it } from "vitest";

import { screenUrl, wireframeUrl } from "../shots-route";

/**
 * A wireframe's url is ABSOLUTE on the way out of the projection, because the capture prefixes the app's
 * base onto every other screen's url (`${base}${screen.url}`) and a relative wireframe path would land on
 * the app instead of the static server. `screenUrl` keeps returning app-relative routes, untouched.
 */
describe("wireframeUrl", () => {
  it("joins a relative file onto the canvas's wireframeBase, tolerating stray slashes", () => {
    expect(wireframeUrl("stock-landing-a.html", "http://localhost:3070")).toBe(
      "http://localhost:3070/stock-landing-a.html",
    );
    expect(wireframeUrl("/stock-landing-a.html", "http://localhost:3070/")).toBe(
      "http://localhost:3070/stock-landing-a.html",
    );
  });

  it("leaves an absolute address alone, base or no base", () => {
    expect(wireframeUrl("http://127.0.0.1:9000/x.html", "http://localhost:3070")).toBe(
      "http://127.0.0.1:9000/x.html",
    );
    expect(wireframeUrl("https://example.test/y.html")).toBe("https://example.test/y.html");
  });

  it("does not change how an app route is addressed", () => {
    expect(screenUrl("/stock", undefined)).toBe("/stock");
    expect(screenUrl("/stock", "list-empty")).toBe("/stock?canvas=list-empty");
  });
});
