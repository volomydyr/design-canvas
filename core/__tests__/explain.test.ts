import { describe, expect, it } from "vitest";

import {
  EXPLAIN_SIZE,
  frameSize,
  layoutFlows,
  layoutKinds,
} from "../graph-layout";
import { allScreens, type CanvasDeclaration } from "../types";

/**
 * The explanation frame's contract, pinned as tests: it is a flows-only text panel — emitted with its own
 * view so every consumer decides about it explicitly, sized as a panel rather than a screen, drawn as a flow
 * node, and absent from the grouped view. The oracle (check-canvas.mjs) enforces the rest at runtime; these
 * cover the pure functions it cannot reach.
 */
const declaration: CanvasDeclaration = {
  title: "Test",
  note: "A declaration with one explanation frame between two screens",
  viewport: { w: 1440, h: 900 },
  frameScale: 0.8,
  flows: [
    {
      id: "buy",
      title: "Buy",
      note: "One journey through a hosted payment page",
      screens: [
        {
          id: "share",
          label: "Share Page",
          note: "Where the buyer starts",
          route: "/share",
          kind: "Pages",
        },
        {
          id: "stripe",
          label: "Stripe Hosted Checkout",
          note: "The step outside this app",
          explain:
            "The buyer enters an address and card on Stripe's own page, then returns.",
        },
        {
          id: "status",
          label: "Order Status",
          note: "Where the buyer lands after paying",
          route: "/order/1",
          kind: "Pages",
        },
      ],
      edges: [
        { from: "share", to: "stripe", label: "Presses Buy now" },
        { from: "stripe", to: "status", label: "When payment lands" },
      ],
    },
  ],
};

describe("explanation frames", () => {
  it("are emitted with their own view, so consumers must decide about them", () => {
    const views = new Map(
      allScreens(declaration).map(({ screen, view }) => [screen.id, view]),
    );
    expect(views.get("stripe")).toBe("explain");
    expect(views.get("share")).toBe("flow");
    expect(views.get("status")).toBe("flow");
  });

  it("take the fixed panel size, never a screen's viewport", () => {
    const explain = declaration.flows[0].screens[1];
    expect(frameSize(explain, declaration)).toEqual(EXPLAIN_SIZE);
    /* And a real screen still scales off the declaration viewport. */
    expect(frameSize(declaration.flows[0].screens[0], declaration)).toEqual({
      w: Math.round(1440 * 0.8),
      h: Math.round(900 * 0.8),
    });
  });

  it("are laid out as flow nodes, marked, with both edges resolved", () => {
    const layout = layoutFlows(declaration);
    const nodes = layout.groups[0].nodes;
    const explain = nodes.find((node) => node.screen.id === "stripe");
    expect(explain?.explain).toBe(true);
    expect(nodes).toHaveLength(3);
    expect(layout.groups[0].edges).toHaveLength(2);
    expect(layout.problems).toEqual([]);
  });

  it("never appear in the grouped view", () => {
    const layout = layoutKinds(declaration);
    const ids = layout.groups.flatMap((group) =>
      group.nodes.map((node) => node.screen.id),
    );
    expect(ids).toEqual(["share", "status"]);
  });
});
