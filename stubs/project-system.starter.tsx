/**
 * THIS PROJECT'S DESIGN SYSTEM, as component sets: the shared parts and the patterns built on them, by atomic level.
 * `node design-canvas/system-capture.mjs --only <id>` photographs a set, and the canvas's Design System tab draws it.
 * Only shared parts belong here (meant to be reused, or imported by several files), never every component file.
 *
 * THE SHAPE OF A SET, to copy:
 *
 *   import { Button } from "@/components/ui/button";
 *
 *   {
 *     id: "button",                        // a slug
 *     name: "Button",                      // the part's own name, as on the tab
 *     level: "atoms",                      // foundations | atoms | molecules | organisms
 *     group: "Actions",                    // the section it sits in, named by what the parts do: Actions, Fields, Selection
 *     source: "components/ui/button.tsx",  // the file it lives in
 *     blocks: [
 *       {
 *         id: "variants",
 *         title: "Variants and states",
 *         rows: [{ id: "primary", label: "Primary" }, { id: "outline", label: "Outline" }],
 *         columns: [
 *           { id: "default", label: "Default" },
 *           { id: "hover", label: "Hover", force: "hover" },   // force: hover | focus | active, set by the capture
 *           { id: "disabled", label: "Disabled" },
 *         ],
 *         render: (row, column) => (
 *           <Button variant={row === "primary" ? "default" : "outline"} disabled={column === "disabled"}>Button</Button>
 *         ),
 *       },
 *     ],
 *   }
 *
 * Neutral content ("Button", "Label"). Only states the code really has; `render` returns null where a combination does
 * not exist. A row with `dark: true` is shot on a dark ground. A dialog, sheet, menu or popover draws outside its cell:
 * give its block `overlay: { shoot: "[role=dialog]" }` (a selector for the open overlay) and it is shot alone.
 */
import type { SystemDeclaration } from "../core/system";

export const SYSTEM: SystemDeclaration = { sets: [] };
