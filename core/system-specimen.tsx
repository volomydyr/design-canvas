"use client";

/**
 * The specimen page: one component set, every cell rendered alone, for `system-capture.mjs` to photograph.
 *
 * Reached at `/design-canvas/system/<set>` through a one-line stub. Nobody reviews this page: each cell is one
 * variant of the part, with neutral content on a plain ground, photographed alone.
 *
 * The page also carries the declaration, as JSON without the render functions, so the capture learns what to shoot from
 * the same file that renders it and never imports project code itself. Any slug, known or not, carries it, which is how
 * the capture lists the sets: it asks for `/design-canvas/system/_`.
 *
 * No transitions and no animations here: a still must show the state, not a frame half way into it.
 */
import { notFound, useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { canvasHidden } from "./types";
import { systemCellKey, systemProblems, type SystemDeclaration } from "./system";

/** The two grounds a part is photographed on. The dark one is for inverse parts. */
export const SYSTEM_GROUND = { light: "#ffffff", dark: "#0f1b24" } as const;
/** Room around the part inside its picture, so a focus ring or a shadow is never cut. */
export const SYSTEM_CELL_PAD = 20;

export function SystemSpecimen({ system }: { system: SystemDeclaration }) {
  if (canvasHidden()) notFound();
  const params = useParams<{ set: string }>();
  const wanted = params?.set ?? "";
  /* An overlay's cell is rendered alone: `?cell=<block>/<row>/<column>`. Read after mount, so the first render matches the server. */
  const [only, setOnly] = useState<string | null | undefined>(undefined);
  useEffect(() => setOnly(new URLSearchParams(window.location.search).get("cell")), []);
  const problems = systemProblems(system);
  const set = system.sets.find((one) => one.id === wanted) ?? null;
  const described = {
    problems,
    sets: system.sets.map((one) => ({
      id: one.id,
      name: one.name,
      level: one.level,
      group: one.group,
      source: one.source,
      blocks: one.blocks.map((block) => ({
        id: block.id,
        title: block.title,
        overlay: block.overlay,
        rows: block.rows,
        columns: block.columns,
        cells: Object.fromEntries(
          one.id === wanted
            ? block.rows.flatMap((row) =>
                block.columns.map((column) => [systemCellKey(block.id, row.id, column.id), column.force ?? null] as const),
              )
            : [],
        ),
      })),
    })),
  };
  return (
    <main
      /* Ready once the page has read which cell it is for: the capture waits for this, never for a fixed time. */
      data-system-ready={only === undefined ? undefined : ""}
      style={{ background: only ? SYSTEM_GROUND.light : "#e9ecef", minHeight: "100vh", padding: only ? 160 : 24 }}
    >
      <style>{`*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}`}</style>
      <script
        id="canvas-system"
        type="application/json"
        /* JSON inside a script tag: `<` is escaped so no string in a label can close the tag. */
        dangerouslySetInnerHTML={{ __html: JSON.stringify(described).replace(/</g, "\\u003c") }}
      />
      {set && problems.length === 0 && only !== undefined
        ? set.blocks.map((block) => (
            <section key={block.id} style={{ display: "flex", flexWrap: "wrap", gap: 16, marginBottom: 32 }}>
              {block.rows.flatMap((row) =>
                block.columns.map((column) => {
                  const key = systemCellKey(block.id, row.id, column.id);
                  /* An overlay renders only when its own cell is asked for: two open dialogs on one page would cover each other. */
                  if (block.overlay && only !== key) return null;
                  if (!block.overlay && only) return null;
                  const part = block.render(row.id, column.id);
                  if (part === null || part === undefined) return null;
                  return (
                    <div
                      key={key}
                      data-system-cell={key}
                      data-system-force={column.force ?? ""}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: SYSTEM_CELL_PAD,
                        background: row.dark ? SYSTEM_GROUND.dark : SYSTEM_GROUND.light,
                      }}
                    >
                      <div data-system-target="" style={{ display: "inline-flex" }}>
                        {part}
                      </div>
                    </div>
                  );
                }),
              )}
            </section>
          ))
        : null}
    </main>
  );
}
