/**
 * design-canvas CORE — every glyph the canvas draws, as paths.
 *
 * WHY NOT AN ICON LIBRARY. This folder used `lucide-react`, and it cost an install: the zoom controls
 * rendered at 4x16px in the project it was ported into, because a library icon takes its size from CSS
 * classes and the class that was meant to size it lost a Tailwind conflict (`px-3.5` from a shared constant
 * against `px-0` from the caller — see `cn.ts` on why nothing here merges classes). An icon whose size
 * depends on the cascade winning an argument is an icon that will be 4px wide in somebody's project.
 *
 * So each one is a component with `width` and `height` ATTRIBUTES, `shrink-0`, and a fixed default. It cannot
 * be squashed by a flex parent, it needs no dependency, and the same file draws the same glyph in every
 * project the canvas is installed in — which is the whole promise of the folder.
 *
 * Rules for adding one: 24x24 viewBox, `currentColor`, stroke 1.75 and no fill unless the glyph is solid,
 * round caps and joins. Nothing here is decorative — every glyph is a control the reviewer presses.
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

export function IconTrash(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 7h16M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7M6 7l1 12a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 17 19l1-12" />
    </Svg>
  );
}

/**
 * The comment mode: a dashed rectangle, because dragging one is exactly what the mode does.
 *
 * The first version tried to draw a marquee AND a mouse cursor inside 24px and came out as a shape nobody
 * could name — "comment icon svg is weird, looks like it recreated it improperly". One idea, four dashes.
 */
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
 * A COMMENT, as a comment is drawn everywhere: a bubble with a tail.
 *
 * NOT the dashed rectangle. That one is the comment TOOL — the shape you drag over a design — and it belongs to the
 * top toolbar, where it stays: *"For comments you should use the comment icon, not the dashed one. And I'm talking
 * about this new element. I'm not saying change it in the top toolbar."* On a switch that means "go to the comments
 * waiting for you", the subject is the comments themselves, so it is the ordinary glyph for one.
 */
export function IconCommentBubble(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20.5 12.25c0 4.15-3.8 7.25-8.5 7.25a9.6 9.6 0 01-2.4-.3L5 20.5l1.35-3.4A6.85 6.85 0 013.5 12.25C3.5 8.1 7.3 5 12 5s8.5 3.1 8.5 7.25z" />
    </Svg>
  );
}

/**
 * NEW SCREENS, on the switch that crosses from the comments to the designs nobody has looked at yet.
 *
 * Two frames, one behind the other, because the destination is a SET of designs rather than one screen. It cannot be
 * the monitor (`IconDesktop`): that glyph belongs to the device switch a few pixels away, and a switch that borrows
 * its neighbour's glyph says the neighbour's thing. It cannot be the dashed rectangle either, which is this tool's
 * comment mark and is the other half of the same control.
 */
export function IconFrames(props: IconProps) {
  return (
    <Svg {...props}>
      {/**
       * FOUR FRAMES IN A GRID, chosen out of four candidates: a frame with a plus (a plus means "create" everywhere
       * else in this tool, and nothing is being created), layers, and an eye. The owner picked this one, and it is the
       * canvas itself in miniature — a wall of screens, which is exactly where pressing it goes.
       *
       * An earlier attempt drew two overlapping frames and he was blunt about it: *"for the new designs icon we need
       * to discuss which icon we should use, because the one you currently have is like completely weird."*
       */}
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

/**
 * Liked, on an exploration option. A thumb up, drawn to the same rules as everything else here: 24x24,
 * `currentColor`, stroke 1.75 — so its colour is the caller's and its size cannot be squashed by a flex parent.
 */
/**
 * THE TWO DEVICES, for the switch above the tabs and the jump under a frame.
 *
 * Icons rather than words, which is how the owner asked for the switch: *"there could be a switch between desktop
 * and mobile done as a icon tab switch or something like that."* Drawn in the same 24-box, same stroke, as every
 * other icon here, so nothing about them reads as imported.
 */
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
      {/**
       * A SPEAKER SLIT AT THE TOP AND A BUTTON AT THE BOTTOM, which took two goes.
       *
       * First the slit was at the top alone, which read as an unfinished rectangle. Then the owner asked for the
       * line at the bottom instead, and on seeing it: *"revert the line in the mobile icon, move it back to the
       * top and just add another element in the bottom which would be the like this circle at the bottom. So then
       * hopefully it will start looking like a mobile icon."* Both elements, which is what every phone glyph has.
       */}
      <rect x="6.5" y="2" width="11" height="20" rx="2.5" />
      <path d="M10.5 5h3" />
      <circle cx="12" cy="18.75" r="1.15" />
    </Svg>
  );
}

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

/**
 * The hover-explanation mark. A real glyph on the same 24x24 grid at the same 1.75 stroke as every other one
 * here — it replaced a `<span>` holding the letter "i" with a background, which sat at 10px and read as a
 * typo rather than a control: _"the info icon is weird. it does not look consistent with other icons that we
 * have and it's too small."_
 */
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
 * WORK IN PROGRESS, for the one button that waits on a write. Three-quarters of a ring so the rotation is
 * visible; the caller spins it with `animate-spin`, because motion belongs to the place that owns the wait.
 */
export function IconSpinner(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3a9 9 0 1 0 9 9" />
    </Svg>
  );
}
