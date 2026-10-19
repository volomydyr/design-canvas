import { describe, expect, it } from "vitest";

import { shotsRoute } from "../shots-route";
import { type CanvasDeclaration, NETWORK_HINT, openAddress, openHint, stepsInWords } from "../types";

/**
 * CLICK STEPS, NETWORK RULES AND SUCCESSORS REACH THE TOOLS ONLY IF THE SERVED DECLARATION CARRIES THEM.
 *
 * This route PROJECTS the declaration field by field, and the capture and the oracle read their screens from that
 * projection, so a field that is declared and not projected is a field that does nothing at all. It has happened five
 * times (the file's own comments count them: `viewport`, `device`, `origins`, `oneViewport`, `redesigns`), each found by
 * a run that should have worked and did not. `steps`, `network` and `successors` are the newest fields, `flowId` is what
 * lets a comment follow its frame into the right group, and this holds all four in place. `tool/dump-screens.mjs` is the
 * other path the capture's declaration travels (`--screens-file`, which `capture-run.mjs` and `round.mjs` use), and
 * `tool/tests/capture-network.test.mjs` proves the two paths give the capture the same thing.
 */
const declaration: CanvasDeclaration = {
  title: "Demo Canvas",
  note: "Two screens.",
  viewport: { w: 1440, h: 900 },
  frameScale: 0.8,
  successors: { "old-frame": "settings-open", released: null },
  network: [{ writes: "abort" }, { answer: "Telemetry", data: null }],
  flows: [
    {
      id: "tour",
      title: "Tour",
      note: "A tour.",
      screens: [
        { id: "settings", label: "Settings", note: "The page", route: "/settings" },
        {
          id: "settings-open",
          label: "Settings Open",
          note: "The dialog",
          route: "/settings",
          steps: [{ click: "Export" }, { fill: "Guests", with: "12" }, { press: "Enter" }, { waitText: "Saved" }, { closeWelcome: true }],
        },
        {
          id: "settings-loading",
          label: "Settings Loading",
          note: "The list while it loads",
          route: "/settings",
          steps: [{ hover: "css=[data-testid=host]" }, { scroll: "css=[data-testid=table]", to: 330 }, { waitFor: "css=[data-testid=ready]", seconds: 60 }],
          network: [
            { hold: "SettingsList" },
            { fail: "OtherList", message: "Offline" },
            { answer: "ThirdList", data: { thirdList: { items: [], total: 0 } } },
            { answer: "ArchiveItem", data: null, errors: [{ message: "refused", extensions: { code: 403 } }] },
          ],
        },
      ],
      edges: [],
    },
  ],
};

describe("the served declaration", () => {
  const serve = async () => {
    const response = await shotsRoute(declaration).GET(new Request("http://localhost/api/design-canvas/shots?screens=1"));
    return (await response.json()) as {
      successors: Record<string, string | null>;
      network: unknown[];
      screens: Array<{ id: string; flowId: string; steps: unknown[]; network: unknown[] }>;
    };
  };

  it("carries each screen's steps, in order, and an empty list where there are none", async () => {
    const served = await serve();
    expect(served.screens.find((one) => one.id === "settings")?.steps).toEqual([]);
    expect(served.screens.find((one) => one.id === "settings-open")?.steps).toEqual([
      { click: "Export" },
      { fill: "Guests", with: "12" },
      { press: "Enter" },
      { waitText: "Saved" },
      { closeWelcome: true },
    ]);
  });

  it("carries the new step types and their keys untouched", async () => {
    const served = await serve();
    expect(served.screens.find((one) => one.id === "settings-loading")?.steps).toEqual([
      { hover: "css=[data-testid=host]" },
      { scroll: "css=[data-testid=table]", to: 330 },
      { waitFor: "css=[data-testid=ready]", seconds: 60 },
    ]);
  });

  it("carries each screen's network rules, every key of them, and an empty list where there are none", async () => {
    const served = await serve();
    expect(served.screens.find((one) => one.id === "settings")?.network).toEqual([]);
    expect(served.screens.find((one) => one.id === "settings-loading")?.network).toEqual([
      { hold: "SettingsList" },
      { fail: "OtherList", message: "Offline" },
      { answer: "ThirdList", data: { thirdList: { items: [], total: 0 } } },
      { answer: "ArchiveItem", data: null, errors: [{ message: "refused", extensions: { code: 403 } }] },
    ]);
  });

  it("carries the canvas-wide network rules, `writes` included, and an empty list for a canvas that declares none", async () => {
    const served = await serve();
    expect(served.network).toEqual([{ writes: "abort" }, { answer: "Telemetry", data: null }]);
    const bare: CanvasDeclaration = { ...declaration, network: undefined };
    const response = await shotsRoute(bare).GET(new Request("http://localhost/api/design-canvas/shots?screens=1"));
    expect(((await response.json()) as { network: unknown[] }).network).toEqual([]);
  });

  it("carries the group each screen is drawn in", async () => {
    const served = await serve();
    expect(served.screens.map((one) => one.flowId)).toEqual(["tour", "tour", "tour"]);
  });

  it("carries where a removed frame's comments go, null included", async () => {
    const served = await serve();
    expect(served.successors).toEqual({ "old-frame": "settings-open", released: null });
  });
});

describe("stepsInWords", () => {
  it("says what a person presses, in order, with no full stop", () => {
    expect(
      stepsInWords([
        { closeWelcome: "Got it" },
        { click: "Export" },
        { fill: "Guests", with: "12" },
        { press: "Enter", on: "Guests" },
        { waitText: "Saved" },
      ]),
    ).toBe('close Got it if it shows, then press Export, then type "12" in Guests, then press Enter in Guests, then wait for "Saved"');
    expect(stepsInWords([{ closeWelcome: true }])).toBe("close the welcome dialog");
    expect(stepsInWords(undefined)).toBe("");
  });

  it("says the three newer types the same way", () => {
    expect(stepsInWords([{ hover: "Add Photo" }, { scroll: "css=[data-testid=trip-tabs]" }, { waitFor: "css=#ready", seconds: 60 }])).toBe(
      "point at Add Photo, then scroll to css=[data-testid=trip-tabs], then wait for css=#ready",
    );
  });
});

describe("openHint, the words under a frame's Open button", () => {
  it("says where it goes, and then how to reach the state when the link lands on the route", () => {
    expect(openHint({ route: "/trips" })).toBe("Open /trips in a new tab");
    expect(openHint({ route: "/trips" }, "/trips?canvas=open")).toBe("Open /trips?canvas=open in a new tab");
    expect(openHint({ route: "/trips", steps: [{ click: "Export" }, { waitText: "Export Trips" }] })).toBe('Open /trips in a new tab, then press Export, then wait for "Export Trips"');
  });

  it("goes to the pinned state before the frame's first capture, and to the captured address after it", () => {
    expect(openAddress({ route: "/trips?show=all", state: "trips-notice" })).toBe("/trips?show=all&canvas=trips-notice");
    expect(openAddress({ route: "/trips", state: "a b" })).toBe("/trips?canvas=a%20b");
    expect(openAddress({ route: "/trips" })).toBe("/trips");
    expect(openAddress({ route: "/trips", state: "open" }, "/trips?canvas=open")).toBe("/trips?canvas=open");
    expect(openAddress({ route: "/trips", state: "open", opens: "http://x/trips" }, "/trips?canvas=open")).toBe("http://x/trips");
    expect(openHint({ route: "/trips?show=all", state: "trips-notice" })).toBe("Open /trips?show=all&canvas=trips-notice in a new tab");
  });

  it("drops the presses where `opens` is declared, because that link already lands in the state", () => {
    expect(openHint({ route: "/trips", opens: "http://localhost:3042/trips?canvasDo=btn%3AMore", steps: [{ click: "More actions" }] })).toBe(
      "Open http://localhost:3042/trips?canvasDo=btn%3AMore in a new tab",
    );
  });

  it("says that the picture holds back, fails or answers some of the data, for a frame that does, in the approved copy", () => {
    expect(NETWORK_HINT).toBe("The picture holds back, fails or answers some of the page's data");
    expect(openHint({ route: "/reports", network: [{ hold: "ReportList" }] })).toBe("Open /reports in a new tab. The picture holds back, fails or answers some of the page's data");
    expect(openHint({ route: "/reports", opens: "http://localhost:3042/reports", network: [{ answer: "ReportList", data: null }], steps: [{ click: "Filter" }] })).toBe(
      "Open http://localhost:3042/reports in a new tab. The picture holds back, fails or answers some of the page's data",
    );
    expect(openHint({ route: "/reports", network: [] })).toBe("Open /reports in a new tab");
  });

  it("never ends in a full stop, and has no dash, like every hint here", () => {
    const hints = [
      openHint({ route: "/a" }),
      openHint({ route: "/a", steps: [{ click: "B" }] }),
      openHint({ route: "/a", network: [{ fail: "X" }] }),
      openHint({ route: "/a", opens: "http://x/a", network: [{ hold: "X" }] }),
    ];
    for (const hint of hints) {
      expect(hint.endsWith(".")).toBe(false);
      expect(hint).not.toMatch(/[–—]/);
    }
  });
});
