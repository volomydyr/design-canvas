import { describe, expect, it } from "vitest";

import { layoutSystem, systemCellKey, systemProblems, type SystemManifest } from "../system";

/**
 * THE DESIGN SYSTEM TAB'S LAYOUT: component sets grouped by atomic level, each
 * a grid of variants by states, and a combination the part does not have left as an empty spot rather than closing up.
 */
const cell = (w = 100, h = 40) => ({ w, h, hash: "abc" });

const MANIFEST: SystemManifest = {
  builtAt: "2026-10-16T00:00:00.000Z",
  sets: [
    {
      id: "dialog",
      name: "Dialog",
      level: "organisms",
      group: "Overlays",
      source: "components/ui/dialog.tsx",
      blocks: [{ id: "states", title: "States", rows: [{ id: "a", label: "A" }], columns: [{ id: "x", label: "X" }], cells: { [systemCellKey("states", "a", "x")]: cell(400, 300) } }],
    },
    {
      id: "button",
      name: "Button",
      level: "atoms",
      group: "Actions",
      source: "components/ui/button.tsx",
      blocks: [
        {
          id: "variants",
          title: "Variants and states",
          rows: [
            { id: "primary", label: "Primary" },
            { id: "inverse", label: "Inverse", dark: true },
          ],
          columns: [
            { id: "default", label: "Default" },
            { id: "open", label: "Open" },
          ],
          cells: {
            [systemCellKey("variants", "primary", "default")]: cell(120),
            [systemCellKey("variants", "primary", "open")]: cell(120),
            [systemCellKey("variants", "inverse", "default")]: cell(80),
          },
        },
      ],
    },
  ],
};

describe("the design system tab's layout", () => {
  it("draws each group as its own section, one column per atomic level, in atomic order", () => {
    const layout = layoutSystem(MANIFEST);
    /* The dialog is declared first, but an organism's section follows an atom's. */
    expect(layout.sections.map((one) => one.title)).toEqual(["Actions", "Overlays"]);
    /* Related sections sit in a bigger one, their level, named the way groups are named on the other tabs. */
    expect(layout.levels.map((one) => one.title)).toEqual(["Atoms", "Organisms"]);
    const atoms = layout.levels[0].panel;
    const actions = layout.sections[0].panel;
    expect(actions.x >= atoms.x && actions.x + actions.w <= atoms.x + atoms.w).toBe(true);
    /* Each level is its own column: the organism's section sits to the right of the atom's, not under it. */
    expect(layout.sections[0].panel.x + layout.sections[0].panel.w).toBeLessThan(layout.sections[1].panel.x);
  });

  it("keeps a missing combination as an empty spot, and marks the dark row", () => {
    const block = layoutSystem(MANIFEST).sections[0].sets[0].blocks[0];
    expect(block.cells).toHaveLength(3);
    expect(block.gaps).toHaveLength(1);
    expect(block.cells.find((one) => one.key === "variants/inverse/default")?.dark).toBe(true);
    /* A narrow cell is centred under the wide one in its column, so the grid reads as columns. */
    const wide = block.cells.find((one) => one.key === "variants/primary/default")!.box;
    const narrow = block.cells.find((one) => one.key === "variants/inverse/default")!.box;
    expect(narrow.x + narrow.w / 2).toBeCloseTo(wide.x + wide.w / 2);
  });

  it("is empty with nothing photographed, so the tab is not offered", () => {
    expect(layoutSystem(null).box.w).toBe(0);
  });

  it("refuses ids that would name files badly and sets declared twice", () => {
    const render = () => null;
    expect(
      systemProblems({
        sets: [
          { id: "Button", name: "B", level: "atoms", group: "Actions", source: "x", blocks: [] },
          { id: "card", name: "C", level: "atoms", group: "Display", source: "x", blocks: [{ id: "b", title: "", rows: [{ id: "a/b", label: "" }], columns: [], render }] },
          { id: "card", name: "C", level: "atoms", group: "", source: "x", blocks: [] },
        ],
      }),
    ).toEqual([
      'set "Button": an id is lowercase letters, digits and dashes',
      'card/b: "a/b" is not a slug',
      'set "card" is declared twice',
      'set "card": name the section it belongs in (group)',
    ]);
  });
});
