/**
 * design-canvas CORE — every glyph the canvas draws, as paths.
 *
 * No icon library: a library icon takes its size from CSS classes, which a host project's cascade can break.
 * Each one sets `width` and `height` attributes, `shrink-0` and a fixed default, so no flex parent can squash it.
 *
 * Rules for adding one: 24x24 viewBox, `currentColor`, stroke 1.75 and no fill unless the glyph is solid,
 * round caps and joins.
 */

type IconProps = {
  /** Both dimensions, in screen pixels. 16 is the toolbar's size; the frame chrome uses its own. */
  size?: number;
  className?: string;
};

function Svg({
  size = 16,
  className = "",
  children,
  fill = "none",
}: IconProps & { children: React.ReactNode; fill?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill}
      stroke={fill === "none" ? "currentColor" : "none"}
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
    >
      {children}
    </svg>
  );
}

/** The press-highlights toggle: a cursor mid-click, because it marks where on a frame the press lands. */
export function IconCursorClick(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9.04 9.69a.5.5 0 0 1 .65-.65l11 4.5a.5.5 0 0 1-.07.95l-4.35 1.04a1 1 0 0 0-.74.74l-1.04 4.35a.5.5 0 0 1-.95.07z" />
      <path d="M13.8 4.1 12.4 6" />
      <path d="m5.1 8-2.7-.7" />
      <path d="m6.4 12.5-1.9 1.9" />
      <path d="M7.4 2.4l.7 2.7" />
    </Svg>
  );
}

export function IconMinus(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 12h14" />
    </Svg>
  );
}

export function IconPlus(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

/** Open an evidence screenshot large: four corners pulled outward. */
export function IconExpand(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
    </Svg>
  );
}

/** Search screens: a magnifier. */
export function IconSearch(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </Svg>
  );
}

export function IconClose(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Svg>
  );
}

export function IconLeft(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M15 5l-7 7 7 7" />
    </Svg>
  );
}

export function IconRight(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 5l7 7-7 7" />
    </Svg>
  );
}

export function IconCheck(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 12.5l5 5L20 6.5" />
    </Svg>
  );
}

export function IconCopy(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="9" y="9" width="11" height="11" rx="2.5" />
      <path d="M15 5.5A2.5 2.5 0 0 0 12.5 4h-6A2.5 2.5 0 0 0 4 6.5v6A2.5 2.5 0 0 0 5.5 15" />
    </Svg>
  );
}

/** Beside a section's heading: copies a link that opens the canvas on that section. */
export function IconLink(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M10 14a4.5 4.5 0 0 0 6.36 0l3-3a4.5 4.5 0 0 0-6.36-6.36l-1.25 1.25" />
      <path d="M14 10a4.5 4.5 0 0 0-6.36 0l-3 3a4.5 4.5 0 0 0 6.36 6.36l1.25-1.25" />
    </Svg>
  );
}

export function IconTrash(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 7h16M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7M6 7l1 12a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 17 19l1-12" />
    </Svg>
  );
}

/** The comment mode: a dashed rectangle, because dragging one is exactly what the mode does. */
export function IconComment(props: IconProps) {
  return (
    <Svg {...props}>
      <rect
        x="3.5"
        y="3.5"
        width="17"
        height="17"
        rx="3"
        strokeDasharray="4.5 3.2"
      />
    </Svg>
  );
}

/**
 * A comment, drawn as a bubble with a tail, for the switch to the waiting comments. The dashed rectangle is the
 * comment tool in the toolbar, a different thing.
 */
export function IconCommentBubble(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20.5 12.25c0 4.15-3.8 7.25-8.5 7.25a9.6 9.6 0 01-2.4-.3L5 20.5l1.35-3.4A6.85 6.85 0 013.5 12.25C3.5 8.1 7.3 5 12 5s8.5 3.1 8.5 7.25z" />
    </Svg>
  );
}

/**
 * New screens, on the switch from the comments to the designs not yet looked at: four frames in a grid, the
 * canvas in miniature. Not `IconDesktop`, which the nearby device switch uses.
 */
export function IconFrames(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="3.5" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="3.5" width="7.5" height="7.5" rx="1.5" />
      <rect x="3" y="14" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="14" width="7.5" height="7.5" rx="1.5" />
    </Svg>
  );
}

/** The disclosure mark on the canvas switcher: this control opens something. Rotates when it is open. */
export function IconChevron(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 9.5l6 5.5 6-5.5" />
    </Svg>
  );
}

/** On the Open button under every frame: out of the picture, back to the running page. */
export function IconOpenExternal(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 16L16 8M9.5 8H16v6.5" />
    </Svg>
  );
}

/** The two devices, for the switch above the tabs and the jump under a frame. */
export function IconDesktop(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="2.5" y="4" width="19" height="12.5" rx="1.75" />
      <path d="M8.5 20.5h7M12 16.5v4" />
    </Svg>
  );
}

export function IconPhone(props: IconProps) {
  return (
    <Svg {...props}>
      {/* A speaker slit at the top and a button at the bottom: either alone does not read as a phone. */}
      <rect x="6.5" y="2" width="11" height="20" rx="2.5" />
      <path d="M10.5 5h3" />
      <circle cx="12" cy="18.75" r="1.15" />
    </Svg>
  );
}

/**
 * Today's screen, under an exploration frame: flips an option to the screen it redesigns and back. A clock face,
 * because the frame it flips to is the one already shipped.
 */
export function IconToday(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8.75" />
      <path d="M12 7.5V12l3 2" />
    </Svg>
  );
}

/** Liked, on an exploration option: a thumb up. */
export function IconLike(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7 11v8H4.5A1.5 1.5 0 0 1 3 17.5v-5A1.5 1.5 0 0 1 4.5 11H7Z" />
      <path d="M7 11.5 11 4a2.5 2.5 0 0 1 2.4 3.2L12.8 10h4.9a2 2 0 0 1 1.95 2.45l-1.1 5A2 2 0 0 1 16.6 19H7" />
    </Svg>
  );
}

/** Disliked. The same glyph turned over, so the pair reads as one control rather than two ideas. */
export function IconDislike(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7 13V5H4.5A1.5 1.5 0 0 0 3 6.5v5A1.5 1.5 0 0 0 4.5 13H7Z" />
      <path d="M7 12.5 11 20a2.5 2.5 0 0 0 2.4-3.2L12.8 14h4.9a2 2 0 0 0 1.95-2.45l-1.1-5A2 2 0 0 0 16.6 5H7" />
    </Svg>
  );
}

/** The hover-explanation mark. */
export function IconInfo(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 7.75h.01" />
    </Svg>
  );
}

/**
 * Work in progress, for a button that waits on a write. Three-quarters of a ring so the rotation is visible; the
 * caller spins it with `animate-spin`, because motion belongs to the place that owns the wait.
 */
export function IconSpinner(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3a9 9 0 1 0 9 9" />
    </Svg>
  );
}
