"use client";

/**
 * The design system tab, drawn inside the same surface as every other tab: same pan, same zoom, same drag.
 *
 * A group (Actions, Fields...) is a section panel, the same panel a group of screens is on the other tabs. Each component set is a
 * white card under its name, holding its grids: column headers are the states, row labels the variants, and every cell is
 * the part photographed alone. The labels are text drawn here, not baked into the pictures, so they stay sharp at any zoom.
 *
 * Nothing in this file is for the agent: it is the small visual part of the design system that a person looks at.
 */
import { systemShotUrl } from "./comments-client";
import { SYSTEM_METRICS as M, type SystemLayout } from "./system";

export function SystemWorld({ layout, canvas }: { layout: SystemLayout; canvas: string }) {
  return (
    <>
      {/* The levels first, so their panels paint under the sections they hold. */}
      {layout.levels.map((level) => (
        <div
          key={`level-${level.level}`}
          className="absolute rounded-[56px] bg-white/[0.04]"
          style={{ left: level.panel.x, top: level.panel.y, width: level.panel.w, height: level.panel.h }}
          data-canvas-system-level={level.level}
        />
      ))}
      {layout.levels.map((level) => (
        <h2
          key={`level-title-${level.level}`}
          className="absolute whitespace-nowrap font-semibold tracking-[-0.025em] text-white"
          style={{ left: level.titleBox.x, top: level.titleBox.y, fontSize: M.levelTitle, lineHeight: 1.05 }}
        >
          {level.title}
        </h2>
      ))}
      {layout.sections.map((section) => (
        <div
          key={`panel-${section.id}`}
          className="absolute rounded-[36px] bg-white/[0.07]"
          style={{ left: section.panel.x, top: section.panel.y, width: section.panel.w, height: section.panel.h }}
          data-canvas-system-section={section.id}
        />
      ))}
      {layout.sections.map((section) => (
        <div key={section.id}>
          <h3
            className="absolute whitespace-nowrap font-semibold tracking-[-0.025em] text-white/90"
            style={{ left: section.titleBox.x, top: section.titleBox.y, fontSize: M.sectionTitle, lineHeight: 1.05 }}
          >
            {section.title}
          </h3>
          {section.sets.map((set) => (
            <div key={set.id} data-canvas-system-set={set.id}>
              <div className="absolute" style={{ left: set.titleBox.x, top: set.titleBox.y, width: set.titleBox.w }}>
                <div
                  className="whitespace-nowrap font-semibold tracking-[-0.01em] text-white"
                  style={{ fontSize: M.setTitle, lineHeight: 1.2 }}
                >
                  {set.name}
                </div>
                <div className="mt-1 whitespace-nowrap text-white/45" style={{ fontSize: M.setSource }}>
                  {set.source}
                </div>
              </div>
              <div
                className="absolute rounded-[20px] bg-white"
                style={{ left: set.card.x, top: set.card.y, width: set.card.w, height: set.card.h }}
              />
              {set.blocks.map((block) => (
                <div key={block.id}>
                  <div
                    className="absolute whitespace-nowrap font-semibold text-[#1d2433]"
                    style={{ left: block.titleBox.x, top: block.titleBox.y, fontSize: M.blockTitle, lineHeight: 1.4 }}
                  >
                    {block.title}
                  </div>
                  {block.columns.map((label, i) => (
                    <div
                      key={`c-${i}`}
                      className="absolute flex items-end justify-center whitespace-nowrap pb-2 font-medium text-[#6b7383]"
                      style={{ left: label.box.x, top: label.box.y, width: label.box.w, height: label.box.h, fontSize: M.label }}
                    >
                      {label.text}
                    </div>
                  ))}
                  {block.rows.map((label, i) => (
                    <div
                      key={`r-${i}`}
                      className="absolute flex items-center whitespace-nowrap font-medium text-[#6b7383]"
                      style={{ left: label.box.x, top: label.box.y, width: label.box.w, height: label.box.h, fontSize: M.label }}
                    >
                      {label.text}
                    </div>
                  ))}
                  {block.gaps.map((gap) => (
                    <div
                      key={`g-${gap.x}-${gap.y}`}
                      className="absolute rounded-md border border-dashed border-black/[0.08]"
                      style={{ left: gap.x, top: gap.y, width: gap.w, height: gap.h }}
                    />
                  ))}
                  {block.cells.map((cell) => (
                    // eslint-disable-next-line @next/next/no-img-element -- a picture on the canvas surface, not page content
                    <img
                      key={cell.key}
                      alt=""
                      draggable={false}
                      decoding="async"
                      src={systemShotUrl(canvas, set.id, cell.key, cell.shot.hash)}
                      className="pointer-events-none absolute max-w-none select-none"
                      style={{ left: cell.box.x, top: cell.box.y, width: cell.box.w, height: cell.box.h }}
                      data-canvas-system-cell={`${set.id}/${cell.key}`}
                    />
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
    </>
  );
}
