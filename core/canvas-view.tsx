"use client";

/**
 * design-canvas CORE — the canvas.
 *
 * A CANVAS THAT SHOWS THE PROTOTYPE, not a page of the prototype. It is its own full-viewport surface with
 * no app shell, no sidebar and no app navigation; the product appears only inside the frames.
 *
 * THE CHROME IS THREE THINGS: which grouping, zoom, and a comment mode. Nothing else. A title, a subtitle,
 * a flow index, a comments rail and a line explaining how to pan were all here and are all gone — furniture
 * around a tool whose owner already knows how it works, every piece of it competing with the designs it was
 * supposed to be presenting. The frames and the edges between them are the content; the canvas itself should
 * be almost invisible.
 *
 * The view switch stays, because the views answer different questions and all of them are needed:
 *
 *   FLOWS   each journey as a branching diagram — real edges between frames, every branch a person can take,
 *           including the ones that leave the happy path (a skip, a close, a store with nothing in it).
 *   BY KIND the same frames regrouped by what they ARE, edges dropped. Flow order scatters near-identical
 *           states across the canvas; a row of every empty state side by side is how they show up as
 *           disagreeing with each other.
 *   EXPLORE competing answers to one open design question, side by side at full size, and no edges — the
 *           directions are alternatives rather than steps. The only view that is TEMPORARY: it appears when a
 *           declaration has an `explorations` entry and goes when the question is decided.
 */

/* THE ONE FRAMEWORK IMPORT IN THIS FILE. The canvas is a Next tool — its two API routes already import from
   `next/server` — and this is what lets a canvas switch without reloading the app. */
import { useRouter } from "next/navigation";
import {
  Fragment,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/* Relative, never through a path alias, and never into the host project. `cn` is the core's own two-line
   copy for the same reason: this folder has to compile in a repo whose tsconfig, component library and
   utilities are all unknown to it. */
import { CanvasEdgeLayer } from "./canvas-edges";
import { CanvasFrame, type NewRegionComment } from "./canvas-frame";
import {
  CanvasSurface,
  type CanvasSurfaceHandle,
  shownZoom,
  ZOOM_STEP,
} from "./canvas-surface";
import { cn } from "./cn";
import {
  BAR_MOTION,
  BAR_MOTION_TINT,
  MOTION_STYLE,
  PANEL_MOTION,
  useDismissOnOutside,
  useOpenState,
} from "./canvas-motion";
import { CanvasTooltip } from "./canvas-tooltip";
import {
  IconCheck,
  IconChevron,
  IconComment,
  IconCommentBubble,
  IconFrames,
  IconCopy,
  IconDesktop,
  IconLeft,
  IconMinus,
  IconPhone,
  IconPlus,
  IconRight,
  IconTrash,
} from "./icons";
import {
  addFeedback,
  clearComments,
  deleteComment,
  deleteComments,
  editComment,
  loadComments,
  markSeen,
  loadShots,
  saveComment,
  setVerdict,
  verdictsIn,
} from "./comments-client";
import {
  chromeWidth,
  FLOW_GAP,
  type LaidOutNode,
  layoutExplorations,
  layoutFlows,
  layoutKinds,
} from "./graph-layout";
import {
  allScreens,
  CANVAS_PUBLISHED,
  type CanvasComment,
  type CanvasDeclaration,
  type CanvasRegistry,
  type CanvasDevice,
  type CanvasScreen,
  type CanvasShot,
  type CanvasVerdict,
  DEFAULT_DEVICE,
  devicesOf,
} from "./types";

/**
 * `explore` is the only one of the three that is temporary. Grouped screens and flows are what a project
 * keeps and hands to developers; an exploration is spent once it is decided, and both its screens and the
 * whole tab are expected to be deleted. Everything below therefore treats it as optional data rather than as
 * a fixed third of the interface — see `CanvasExploration` in types.ts.
 */
type ViewMode = "flows" | "kinds" | "explore";

const TAB_LABEL: Record<ViewMode, string> = {
  kinds: "Grouped Screens",
  flows: "User Flows",
  explore: "Exploration",
};

/** A group's name, in world pixels. Bigger than a frame's name and sized the same way. See canvas-frame. */
const GROUP_SIZE = 132;
/**
 * How far above the first section the round reminder sits, in world pixels. Clear of the 132px group title's own
 * line box, so the two never touch at any zoom.
 */
/**
 * How far the exploration's heading sits above the first section, in world pixels.
 *
 * TWO CONSTRAINTS, and the second is the one that was wrong twice.
 *
 * 1. The block grows DOWNWARD from this offset, so the lift must exceed the block's own height or the supporting
 *    line lands on the first section's panel. That is what 300 did, printing the round on top of the words "The
 *    settings page while a job is running". The heading is ~200 world pixels tall, its gap ~30, its second line
 *    ~82: call it 320 of block.
 * 2. What is left over has to read as MORE separation than one section has from the next, or the heading looks
 *    like it belongs to the first section rather than to all of them. Owner, on a lift of 430: _"it's way too
 *    close to the first section. It has to be vertically more far away than the distance between the sections
 *    themselves."_ So the clearance is `FLOW_GAP` plus a margin, read from the layout rather than copied, and it
 *    cannot silently fall behind if that gap is ever tuned.
 */
const HEADING_BLOCK = 320;
/**
 * MEASURED ON SCREEN, both times, because reasoning about it was wrong in both directions.
 *
 * `FLOW_GAP` is the distance between two group BOXES, and each box insets its visible panel by about 88 world
 * pixels, so the gap a reader actually sees between two sections is ~384 rather than 560. A lift built on
 * `FLOW_GAP * 1.25` put 623 between the heading and the first panel — 1.6x the section gap, and the owner's
 * verdict was _"it's now way too far away"_ after 430 had been _"way too close"_.
 *
 * So the target is stated as what it looks like: clearly more separation than one section has from the next,
 * without the heading floating off on its own. ~1.2x of the visible 384 is 460, plus the 88 of panel inset the
 * lift has to cross to reach the panel's edge.
 */
const HEADING_LIFT = HEADING_BLOCK + 460 + 88;
/**
 * THE EXPLORATION'S HEADING, and it is the largest type the canvas draws.
 *
 * Owner, on the version that was 42% of a section title and tucked inside the first section: _"I was hoping it
 * could be above all the sections, not inside the first section. and I was hoping it to be like clearly the most
 * important thing from the hierarchy perspective here. because why would it be such a small text?"_
 *
 * So it is bigger than `GROUP_SIZE`, not a fraction of it. A section title names one question; this names what
 * the whole tab is asking of the reviewer, and a hierarchy where the parts are drawn larger than the whole is
 * simply wrong. 1.45x lands it clearly above them without needing a second breakpoint at any zoom.
 */
const HEADING_SIZE = Math.round(GROUP_SIZE * 1.45);
/** The sentence under it. Support, so noticeably smaller than the heading and quieter. */
const HEADING_SUB_SIZE = Math.round(GROUP_SIZE * 0.46);
/** How far a group's panel extends past the frames and labels inside it. */
const SECTION_PAD = 90;

/**
 * What the reviewer hands the agent. It names the file and the protocol and nothing else, because the file
 * itself carries its own contract — every comment in it has the screen, the real route, the pinned state, the
 * region, and a picture of that region with the outline drawn on.
 */
/**
 * IT NAMES EVERY ONE OF THEM, and that is not decoration.
 *
 * This said "act on the design comments in <file>" and left the agent to work out which. It read the file, took
 * the ids it happened to see, and worked ten of fifteen — the five it missed included a comment that rejected a
 * whole screen. The reviewer then found work he had given still sitting there: *"I don't know how that's possible
 * that there are comments that were not in my handoff so they either were in the handoff and there is some kind of
 * a bug in the skill that you definitely need to fix."* There was: a prompt that states a count and a list cannot
 * be half-completed by accident, and one that states neither invites exactly that.
 *
 * The ids come from `waiting`, which is the same set the Hand Off badge counts, so the number in the prompt and
 * the number on the button can never disagree.
 */
const handoffLine = (canvas: string, file: string, ids: string[]) =>
  `Act on all ${ids.length} design comment(s) in ${file}: ${ids.join(", ")}. Work every one of them, not a subset — if one seems already handled, say so rather than skipping it silently. Each has an \`image\`: open it and look inside the red outline. When a comment is done, PATCH /api/design-canvas/comments?canvas=${canvas} with { id, consumed: true }.`;

/**
 * WHAT A JUDGED EXPLORATION HANDS OVER, which is a round of work rather than a list of notes.
 *
 * The verdicts and the comments only mean something together: dropping the rejected options is half of a round,
 * and the other half is what the reviewer said about the ones that survived. Spelling the whole round out here
 * is what makes the hand-off an instruction instead of an observation — owner: _"you remove those
 * that I dislike, you work on the comments that I left, if I left any, and you create three more variations for
 * any options that I liked."_
 *
 * IT IS WRITTEN PER PANEL, and that is the whole correctness of it. The funnel narrows one SURFACE at a time —
 * five directions, then three variants of each survivor, then one refined design — and a flat list of liked ids
 * cannot say which stage each surface is at. Two rounds were handed off wrongly before this was per panel:
 *
 *   · a panel with SEVERAL likes needs three variants of EACH of them, and none of anything else. The owner,
 *     after a round that mixed them: _"whenever I like more than one design on a section, it means that I want
 *     to see three options for it in the next round for both things that I selected… in reality we needed to get
 *     six options, three for the first design that I selected and three for the other one"_, and on a variant he
 *     had never picked: _"I don't remember me selecting this option, so I don't understand how you decided why
 *     did you decided to design it in this round? That's weird."_
 *   · a panel down to ONE like is not fanned out again, it is refined until it is approved. The owner: _"the next
 *     one has to be not the three options again. it has to be the selection of what I like the most and the
 *     comments applied to what I like the most, so that I could iterate on it until it's really good and I
 *     completely approve it and it's ready to move to the other two tabs."_
 *
 * AND IT NO LONGER CLAIMS A ROUND NUMBER. It said "Round 2" for every judged canvas forever, because it counted
 * verdicts rather than rounds — so a third round arrived labelled as the second, and the agent went looking for
 * options that had already been deleted.
 */
type HandoffPanel = { title: string; kept: string[]; dropped: string[] };

const explorationHandoff = (canvas: string, file: string, panels: HandoffPanel[]) => {
  const dropped = panels.flatMap((one) => one.dropped);
  const judged = panels.filter((one) => one.kept.length > 0);
  return [
    "The next round of the exploration in design-canvas/project/flows.ts.",
    dropped.length > 0
      ? `DISLIKED, so delete them and the scaffolding only they used: ${dropped.join(", ")}.`
      : "Nothing was disliked.",
    ...judged.map((panel) =>
      panel.kept.length === 1
        ? `In "${panel.title}": ONE liked option, ${panel.kept[0]} — so refine THAT ONE against the comments as a new exploration entry with round: "refined". Do not fan out into three again.`
        : `In "${panel.title}": ${panel.kept.length} liked options, ${panel.kept.join(", ")} — so build three variations of EACH of them, as a new exploration entry with round: "3 variants".`,
    ),
    judged.length === 0 ? "Nothing was liked yet, so do not build variations." : "",
    "Never build a variation of an option that was not liked, and delete the round you are refining: only the current round stays on the canvas.",
    `Work the comments in ${file} first — they apply to the options they sit on, and a variation that ignores them is a wasted round.`,
    "Then recapture with --changed and hand it back.",
  ]
    .filter(Boolean)
    .join(" ");
};

/**
 * One control in the toolbar. Written once, so a tab, a zoom step and the comment toggle cannot end up
 * different heights — which is exactly what happened when the zoom sat inside a track of its own.
 *
 * NO PADDING IN HERE. It carried `px-3.5`, and a caller that needed a square button passed `px-0` expecting
 * to override it. Nothing in this folder merges Tailwind conflicts (`cn` is a joiner — see its own file), so
 * both landed, the later rule in the sheet won, and the zoom buttons ended up with 28px of padding inside a
 * 32px button: the icons rendered 4px wide. Padding is the caller's, always.
 */
/* `whitespace-nowrap` because a third tab put enough width pressure on the bar to wrap "Grouped Screens" and
   "User Flows" onto two lines each, which turned a one-row toolbar into a two-row one. */
const BAR_ITEM =
  "inline-flex h-8 shrink-0 items-center gap-2 whitespace-nowrap rounded-full text-[0.8125rem] font-medium outline-none transition-colors duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)] focus-visible:ring-1 focus-visible:ring-white/40";
const BAR_PAD = "px-3.5";
const BAR_SQUARE = "w-8 justify-center";

/**
 * FOUR KINDS OF CONTROL, FOUR LOOKS. They were two: the selected tab and the primary action were the same
 * white pill, so the bar said "these do the same kind of thing" about a view switch and a hand-off. The
 * owner, looking at it: "you use the same design for an active tab as for an active button… you need to
 * rethink all the actions that we have in this toolbar and just understand how they really should be
 * designed so that it's clear that this is a tab, this is an action, this is an active action."
 *
 * Nothing else about the bar changed — same one row, same 32px controls, same hairlines, on his instruction:
 * "don't change the current design too much, the current issue is more about states."
 *
 *   TAB, selected      a lifted segment: the surface comes forward, the type goes white
 *   TAB, not selected  quiet type, a hover wash, no surface
 *   MODE, engaged      the solid pill. An outline was tried here and rejected on sight — "I liked the active
 *                      state of the comment action before, the new one looks really bad" — so a mode you are
 *                      IN is as loud as the primary action, and what separates a tab from both is the tab's
 *                      lifted segment.
 *   ACTION, primary    solid white
 */
const BAR_TAB_ON = "bg-white/[0.16] text-white";
const BAR_QUIET = "text-white/70 hover:bg-white/[0.08] hover:text-white";
const BAR_MODE_ON = "bg-white text-[hsl(180_15%_5.5%)]";
const BAR_PRIMARY = "bg-white text-[hsl(180_15%_5.5%)]";
/**
 * DESTRUCTIVE, AND THE SAME EVERYWHERE. Clear All here and Delete on a pin do the same kind of irreversible
 * thing and looked like two different buttons — one a quiet ghost, one a quiet ghost. Now both are the
 * annotation red on a red wash: "ensure all delete buttons everywhere look the same and feel like destructive
 * actions." It is the same red the outlines are drawn in, which is the only red this tool owns.
 */
/** On the green pill: the same geometry as a toolbar control, lit for a coloured ground. */
const REVIEW_QUIET =
  "text-white/85 hover:bg-white/[0.16] hover:text-white transition-colors";
const DANGER =
  "text-[hsl(0_84.2%_67%)] transition-colors duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-[hsl(0_84.2%_60.2%_/_0.14)] hover:text-[hsl(0_84.2%_72%)]";

/**
 * THERE IS NO SHORT NAME ANY MORE, because the title IS the name.
 *
 * A helper stood here that cut a title at its first dash or colon, so the switcher showed "Online Store" while the
 * index card showed the whole sentence. Two strings for one canvas, and the owner caught it immediately: *"if we're
 * using one name on the index canvas page, then we should use the same name in the drop down where you can switch
 * between canvases, right? because that's pretty obvious but I clearly see that you do not follow it."*
 *
 * The fix is upstream of both surfaces: `title` is a NAME of four words or fewer, checked by `copy-rules.mjs`, and
 * the sentence that used to be jammed into it lives in `note`, which is what the index draws its description from.
 * Nothing trims anything now.
 */

/**
 * HOW OFTEN THE OPEN CANVAS ASKS WHETHER THE WORK CHANGED UNDER IT.
 *
 * Four seconds: a capture takes a minute or more, so this is never the thing a reviewer waits on, and it is slow
 * enough that a canvas left open all afternoon costs a few hundred reads of a local JSON file. Nothing is
 * re-rendered unless the answer differs.
 */
const WATCH_MS = 4000;

/** How long Approve All can be taken back. Long enough to notice the pill, short enough not to linger. */
const UNDO_MS = 6000;

/* `OPENING_W` / `OPENING_H` STOOD HERE. They were the corner the canvas used to open on, and the launch now
   fits the whole world instead — see `opening` below for the owner's ruling. */

export function CanvasView({
  declaration,
  canvas,
  canvases,
}: {
  declaration: CanvasDeclaration;
  /**
   * Which canvas this is, as it appears in `/design-canvas/<canvas>`. It is also the namespace its shots and
   * its comments are stored under, so two canvases in one project cannot photograph over each other's
   * pictures or mix their reviews. A project with a single canvas passes its one slug.
   */
  canvas: string;
  /**
   * EVERY CANVAS THIS PROJECT HAS, which is what the switcher in the top-left corner lists.
   *
   * A canvas is already this tool's unit of information architecture: it has its own frames, its own comments, its
   * own review queue and its own entry on the index. What was missing was a way to cross between them without
   * going back to that index, and the owner asked for exactly one control: *"this element that could be in the top
   * left corner could be a switcher between different canvases."*
   *
   * OPTIONAL, and a project that passes nothing, or one canvas, draws no switcher at all — the same rule the
   * device switch follows. `CanvasPage` has the registry already, so no caller has to build this.
   */
  canvases?: CanvasRegistry;
}) {
  /**
   * WHICHEVER VIEW THE WORK IS IN. An open exploration wins; otherwise grouped screens.
   *
   * Grouped screens was the unconditional default, because comparing near-identical states side by side is what
   * this canvas is opened for most often. But a declaration with an exploration on it has an OPEN QUESTION, and
   * that is what the reviewer came for — owner: _"I also think the explorations tab has to be the
   * first one when it's available."_ First in the bar, and first on screen.
   */
  const [view, setView] = useState<ViewMode>(
    (declaration.explorations ?? []).length > 0 ? "explore" : "kinds",
  );
  /**
   * WHICH DEVICE IS BEING REVIEWED, which is a level above the three views.
   *
   * Derived from the declaration rather than assumed: a canvas whose screens are all desktop has one device, no
   * switch, and behaves exactly as it did before devices existed. Opening on the first one puts desktop first
   * where both exist, because that is where the work starts on a web project.
   */
  const devices = useMemo(() => devicesOf(declaration), [declaration]);
  const [device, setDevice] = useState<CanvasDevice>(devices[0] ?? "desktop");
  /**
   * A JUMP CANNOT CENTRE WHAT IS NOT LAID OUT YET: switching device rebuilds the layout, so the target is held
   * here and landed on by the effect further down once it exists. It also tells the re-fit to stand aside.
   */
  const [pendingFocus, setPendingFocus] = useState<string | null>(null);
  /**
   * THE DIAGRAM COMPOSES ITSELF, which is this wait's own thesis rather than a loader borrowed from elsewhere.
   *
   * Two loading graphics were tried and both were rejected, the second bluntly: *"the loading visual looks like
   * some weird bar chart. also it should not show the name of the canvas... it should be just a nice simple
   * looking smooth loading animation."* The third attempt is not a graphic at all. Nothing is drawn on the stage;
   * the frames arrive in the order the diagram reads, one column after another, 60ms apart and capped at 240 —
   * which is what a canvas of flows genuinely is while it is being placed, and it is over before it can be
   * mistaken for a wait.
   *
   * IT HAPPENS ONCE. `revealed` stays true, so a frame mounted by a later view or device switch renders already
   * visible: switching tabs is a routine state change and does not get a page-load choreography.
   */
  const [revealed, setRevealed] = useState(false);
  const [comments, setComments] = useState<CanvasComment[]>([]);
  /**
   * WHICH SCREENS THE REVIEWER HAS ALREADY SEEN.
   *
   * `null` means the file has not answered yet, and NOTHING is new while that is true — a canvas that flashed
   * seventy blue frames for a tick before the answer arrived would be worse than no mark at all.
   *
   * `missing` is the other question, and conflating the two cost a round: the seeding effect keyed on `seen ===
   * null`, which is also the state on first mount, so it fired before the fetch and wrote every screen into the
   * file as seen — permanently defeating the mechanism it was supposed to bootstrap. Two names now, because they
   * are two facts.
   */
  const [seen, setSeen] = useState<string[] | null>(null);
  const [seenMissing, setSeenMissing] = useState(false);
  /** Which file the comments were read from, for the hand-off to name. See `CanvasCommentFile.file`. */
  const [commentsFile, setCommentsFile] = useState(
    `design-canvas/comments/${canvas}.json`,
  );
  /**
   * THE MANIFEST, AND `null` MEANS IT HAS NOT ARRIVED — which is a different thing from arriving empty.
   *
   * It was `useState({})`, so "we have not asked yet" and "this canvas has no pictures" were the same value, and
   * every frame said "Not captured yet" for as long as the fetch took. The skeleton then appeared afterwards, for
   * the length of an image decode, which is precisely backwards: _"it DOES NOT do it at the beginning when it
   * actually loads, defeating the whole purpose of such an approach."_ See `manifestLoaded` on `CanvasFrame`.
   */
  const [shots, setShots] = useState<Record<string, CanvasShot> | null>(null);
  const [commenting, setCommenting] = useState(false);
  const [handoff, setHandoff] = useState(false);
  /** Whether the canvas switcher in the top-left corner is open. */
  const [switching, setSwitching] = useState(false);
  /* The only Next import in the view, and it is here so switching canvases does not reload the app. */
  const router = useRouter();
  /* The whole button-plus-panel, so a press on the button itself is not read as a press outside. */
  const handoffRef = useRef<HTMLDivElement | null>(null);
  const switcherRef = useRef<HTMLDivElement | null>(null);
  /** Clear All, pressed once. See the button for why it takes two. */
  const [armed, setArmed] = useState(false);
  const [copied, setCopied] = useState(false);
  /**
   * WHETHER THE HAND-OFF PROMPT OVERFLOWS ITS BOX, and whether the reader has reached the end of it.
   *
   * Both only matter for the fade — see the prompt below. Measured after the panel opens rather than guessed from
   * the text length: the same prompt wraps to a different number of lines in an exploration than in a flow.
   */
  const promptRef = useRef<HTMLParagraphElement | null>(null);
  /** The observer watching the prompt box, kept so a re-attach cannot leave the old one running. */
  const watching = useRef<ResizeObserver | null>(null);
  const [promptScrolls, setPromptScrolls] = useState(false);
  const [promptAtEnd, setPromptAtEnd] = useState(false);

  const [zoom, setZoom] = useState(0.3);
  /** Which pin is open, owned here so the review pill can open one from across the canvas. */
  const [openPin, setOpenPin] = useState<string | null>(null);
  /** How far through the review queue, or null when the reviewer has not started stepping. */
  const [at, setAt] = useState<number | null>(null);
  /**
   * APPROVE ALL ACTS AT ONCE AND OFFERS AN UNDO, rather than asking first. It was a two-press confirm for one
   * round and the owner rejected it on sight: "we don't need a confirmation here, maybe show an undo action
   * for a few seconds instead."
   *
   * The undo is real rather than a re-creation: while these ids are here the comments are hidden from the
   * canvas and NOTHING has been deleted yet. The deletion happens when the window closes, so Undo has nothing
   * to put back — it just stops the timer. Re-creating deleted comments would mean new ids and new pictures,
   * which is not an undo, it is a copy.
   */
  const [removing, setRemoving] = useState<string[] | null>(null);
  const undoTimer = useRef<number | null>(null);
  const surface = useRef<CanvasSurfaceHandle | null>(null);

  useEffect(() => {
    void loadComments(canvas).then(({ comments: loaded, file, seen: known }) => {
      setComments(loaded);
      setCommentsFile(file);
      setSeen(known ?? null);
      setSeenMissing(known === undefined);
    });
    void loadShots(canvas).then((manifest) => {
      setShots(
        Object.fromEntries(manifest.map((shot) => [shot.screenId, shot])),
      );
    });
  }, [canvas]);

  /**
   * AND THEN IT KEEPS ASKING — because a capture happens outside the browser and nothing else can tell this tab.
   *
   * The effect above runs once per canvas. A capture writes new WebPs and a new manifest to DISK; the running app
   * imports neither, so hot reload has nothing to reload and the tab keeps drawing the pictures it fetched when it
   * opened. Every reviewer hit this and one of them knew why; the rest do not: *"the canvas always needs to be
   * refreshed in my browser in order to see the updates … other people might not know and they will just get
   * frustrated not understanding why it's the same as it was, even if the AI agent says that he updated it."*
   *
   * So the canvas asks, every few seconds, whether the manifest or the notes changed under it. Cheap by
   * construction: two JSON reads of a local route, only while the tab is actually being looked at, and state is
   * replaced only when the answer differs from what is on screen — so a quiet canvas re-renders never.
   *
   * TWO THINGS IT REFUSES TO OVERWRITE, both of them local truths the server does not know yet:
   *   - an open undo window (`removing`), whose comments are deliberately hidden until it closes
   *   - an optimistic verdict (`pending-*`), which exists in this tab and not yet in the file
   * In both cases the notes are left alone for this round and picked up on the next one, which is the same
   * mechanism the rest of this view already relies on.
   *
   * It also fixes something nobody reported: two tabs open on one canvas, or the reviewer's own comment written
   * on a phone, now appear on the other screen without a reload.
   */
  useEffect(() => {
    let alive = true;
    const look = async () => {
      if (!alive || document.visibilityState !== "visible") return;
      const [manifest, notes] = await Promise.all([
        loadShots(canvas),
        loadComments(canvas),
      ]);
      if (!alive) return;
      /* The pictures. Keyed by screen id and compared by content hash, which is what a recapture changes. */
      setShots((was) => {
        const next = Object.fromEntries(
          manifest.map((shot) => [shot.screenId, shot]),
        );
        const signature = (of: typeof next | null) =>
          of
            ? Object.values(of)
                .map((shot) => `${shot.screenId}:${shot.hash}`)
                .sort()
                .join("|")
            : "";
        return signature(was) === signature(next) ? was : next;
      });
      setSeen((was) =>
        notes.seen === undefined ||
        (was ?? []).join("|") === notes.seen.join("|")
          ? was
          : notes.seen,
      );
      setComments((was) => {
        if (removing || was.some((one) => one.id.startsWith("pending-")))
          return was;
        const signature = (list: CanvasComment[]) =>
          list
            .map(
              (one) =>
                `${one.id}:${one.note}:${one.consumedAt ?? ""}:${one.stale ? 1 : 0}:${one.kind ?? "note"}`,
            )
            .join("|");
        return signature(was) === signature(notes.comments)
          ? was
          : notes.comments;
      });
    };
    const timer = window.setInterval(() => void look(), WATCH_MS);
    /* Coming back to the tab is the moment a reviewer most expects to see the new work, so it looks then too
       rather than waiting out the rest of the interval. */
    const onVisible = () => {
      if (document.visibilityState === "visible") void look();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [canvas, removing]);

  /**
   * The verdicts, READ OUT OF THE COMMENTS rather than held beside them. See `CanvasCommentKind`: they are the
   * same records, which is what makes one count, one button, one prompt and one drain cover both.
   */
  const verdicts = useMemo(() => verdictsIn(comments), [comments]);

  /** Kept or dropped, by screen id. Only exploration frames can carry one. */
  const verdictOf = useMemo(
    () =>
      Object.fromEntries(verdicts.map((one) => [one.screenId, one.value])) as
        Record<string, "like" | "dislike" | undefined>,
    [verdicts],
  );

  /**
   * A VERDICT LANDS ON THE PRESS, not on the round trip.
   *
   * Owner: _"when I click them I need to wait for like 3 seconds for them to get active. I don't know
   * what causes it, but it is definitely not how it is supposed to respond."_ The cause was this function: it
   * awaited the PATCH and only then set state, so the button's own appearance was gated on a dev-server write
   * that reads the comments file, rotates five numbered backups, writes it and returns the whole thing. Every
   * press paid for all of that before anything moved.
   *
   * So the local list changes first and the write follows. A verdict is a judgement, not a transaction: it is
   * one of two values, it belongs to one screen, and there is no other client to conflict with — which is
   * exactly the case where optimism is honest rather than a lie waiting to be caught. The server's answer still
   * wins when it arrives, so a rejected write corrects itself, and a failed one puts the OLD value back rather
   * than leaving a verdict that looks saved and is not.
   *
   * The rollback is silent because this view has no error surface and inventing one here would be a second
   * change wearing the first one's clothes. A reverting circle is at least not a lie, and the console carries the
   * reason. If verdicts ever start failing in practice, that is when the surface earns its place.
   */
  const onVerdict = useCallback(
    (screenId: string, value: "like" | "dislike" | null) => {
      const screen = allScreens(declaration).find(
        (one) => one.screen.id === screenId,
      );
      let restore: CanvasComment[] = [];
      setComments((was) => {
        restore = was;
        /* Only this screen's verdict goes; a note on the same screen is a different thing and stays. */
        const rest = was.filter(
          (one) =>
            !(
              one.screenId === screenId &&
              (one.kind === "like" || one.kind === "dislike")
            ),
        );
        if (!value) return rest;
        return [
          ...rest,
          {
            /* Provisional until the write answers with the real one. Distinct enough not to collide with `cN`. */
            id: `pending-${screenId}`,
            kind: value,
            flowId: screen?.groupId ?? "",
            screenId,
            label: screen?.screen.label ?? screenId,
            route: screen?.screen.route ?? "",
            state: screen?.screen.state ?? null,
            region: { xPct: 0, yPct: 0, wPct: 100, hPct: 100 },
            image: shots?.[screenId]?.file ?? "",
            note: value === "like" ? "Liked." : "Disliked.",
            createdAt: new Date().toISOString(),
          },
        ];
      });
      void setVerdict(canvas, {
        screenId,
        value,
        flowId: screen?.groupId,
        label: screen?.screen.label,
        route: screen?.screen.route,
        state: screen?.screen.state ?? null,
        image: shots?.[screenId]?.file,
      })
        .then((file) => setComments(file.comments ?? []))
        .catch((error: unknown) => {
          setComments(restore);
          console.error("design-canvas: could not save the verdict", error);
        });
    },
    [canvas, declaration, shots],
  );

  /**
   * THE PANELS THE HAND-OFF IS WRITTEN FROM. Ids rather than labels: the agent edits the declaration, and the id
   * is what it edits by.
   *
   * A VERDICT ON A SCREEN THIS DECLARATION NO LONGER NAMES IS DROPPED HERE. Verdicts outlive the frames they were
   * left on — a spent round is deleted from the declaration but its likes stay in the comment file — and without
   * this filter the hand-off replays them, sending an agent to build variations of options that no longer exist.
   * It happened: a third round was handed off listing four round-1 ids whose components had been deleted.
   */
  const handoffPanels = useMemo(() => {
    const named = new Map(
      allScreens(declaration).map((one) => [
        one.screen.id,
        { groupId: one.groupId, groupTitle: one.groupTitle },
      ]),
    );
    const byPanel = new Map<string, HandoffPanel>();
    for (const verdict of verdicts) {
      const home = named.get(verdict.screenId);
      if (!home) continue;
      const panel =
        byPanel.get(home.groupId) ??
        (() => {
          const fresh: HandoffPanel = { title: home.groupTitle, kept: [], dropped: [] };
          byPanel.set(home.groupId, fresh);
          return fresh;
        })();
      if (verdict.value === "like") panel.kept.push(verdict.screenId);
      if (verdict.value === "dislike") panel.dropped.push(verdict.screenId);
    }
    return [...byPanel.values()];
  }, [verdicts, declaration]);

  /**
   * ONE HAND-OFF, TWO SHAPES. In an exploration the reviewer is deciding between options, so the line describes
   * the ROUND — what to delete, what to build variations of, and to read the comments first. Everywhere else they
   * are commenting on a design that exists, so it stays the line it always was.
   */


  /** Every screen this declaration still names, from both views. */
  const declared = useMemo(
    () => new Set(allScreens(declaration).map((one) => one.screen.id)),
    [declaration],
  );

  /**
   * The rounds in play, as one short phrase. One distinct `round` across every exploration is the common case and
   * reads as a single state ("3 variants"); more than one means the questions are at different depths, and the
   * header says so rather than picking one and being wrong about the others.
   */
  /**
   * THE HEADING, PER ROUND, WRITTEN OUT RATHER THAN ASSEMBLED.
   *
   * Three sets of words, because there are only three kinds of round: the first, where several genuinely different
   * answers are seen side by side; the second, where what survived comes back as variations; and everything after
   * that, which is the same job every time — one design per question, rebuilt from the notes on it. The owner:
   * _"there is essentially a first, a second, and the third and everything after that is the same."_
   *
   * RULES THESE FOLLOW, all his:
   *   - The title says WHAT THIS IS. It does not tell the reviewer what to do; the mark beside it opens the full
   *     explanation for anyone who wants the mechanism.
   *   - The subtitle is ONE sentence with no full stop, because PRODUCT-style supporting copy takes none and
   *     because a second sentence here is a paragraph nobody reads.
   *   - Neither of them restates the other.
   */
  const ROUND_COPY = [
    {
      title: "The first directions",
      note: "Genuinely different answers to each question, drawn as real screens so they disagree visibly",
    },
    {
      title: "Variations on what you kept",
      note: "Three takes on each direction that survived, with your comments worked into every one",
    },
    {
      title: "Refined from your notes",
      note: "One design per question now, rebuilt around the comments you left on the option you kept",
    },
  ] as const;

  const roundCopy = useMemo(() => {
    const rounds = (declaration.explorations ?? [])
      .map((one) => one.round)
      .filter((one): one is number => typeof one === "number" && one > 0);
    /* The FURTHEST round on the tab decides the heading. Sections can legitimately sit at different depths, and
       the honest thing to name is where the work has got to rather than the average of it. */
    const at = rounds.length > 0 ? Math.max(...rounds) : 1;
    return ROUND_COPY[Math.min(at, ROUND_COPY.length) - 1];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [declaration]);

  /**
   * Whether there is a third tab at all. Data-driven, because an exploration is scaffolding: it arrives when
   * a question is open and is deleted once it is answered, and neither event should require touching this
   * file.
   */
  const exploring = (declaration.explorations ?? []).length > 0;

  /**
   * The tabs, in the order they are read. Exploration goes FIRST while there is one, because it is the view the
   * canvas was opened for: an exploration exists only while a question is open, and the answer to that question
   * is what everything else is waiting on. It disappears from the bar entirely once the question is decided, so
   * the two permanent views end up back where they started.
   */
  const tabs = useMemo<ViewMode[]>(
    () => (exploring ? ["explore", "kinds", "flows"] : ["kinds", "flows"]),
    [exploring],
  );

  /**
   * A DELETED EXPLORATION MUST NOT LEAVE THE CANVAS ON A VIEW THAT NO LONGER EXISTS. The reviewer decides,
   * the exploration is removed from the declaration, the page hot-reloads — and without this the canvas is
   * sitting on an empty stage with no panels and no obvious way back.
   */
  useEffect(() => {
    if (!exploring && view === "explore") setView("kinds");
  }, [exploring, view]);

  /**
   * TWO QUEUES, AND THEY BELONG TO DIFFERENT PEOPLE. A comment the agent has not ingested is outbound: it is
   * what Hand off counts. A comment the agent HAS ingested, on a screen photographed since, is inbound: the
   * fix is on screen and only the reviewer can say whether it worked. Nothing counts both, which is the bug
   * the owner found — twelve answered comments offering to be handed off again.
   */
  /**
   * What the canvas shows: everything except comments inside an open undo window, and except comments whose
   * screen the declaration no longer names.
   *
   * THE SECOND FILTER EXISTS BECAUSE EXPLORATION SCREENS GET DELETED. A comment on a direction that was
   * rejected has nothing left to point at — no frame, no picture — but it would go on being counted by Hand
   * off and by the review pill forever, offering work on a screen nobody can look at. It is dropped from the
   * canvas rather than deleted from the file: deleting is the reviewer's word, and the file is their record of
   * what they asked for.
   */
  /**
   * What can be DRAWN: a comment needs a frame to sit on, so one whose screen the declaration no longer names
   * has nowhere to go. That is the only thing this filter means, and it used to mean much more than it should.
   */
  const visible = useMemo(
    () =>
      comments.filter(
        (comment) =>
          declared.has(comment.screenId) &&
          !(removing ?? []).includes(comment.id),
      ),
    [comments, removing, declared],
  );

  /**
   * A COMMENT WHOSE SCREEN IS GONE IS STILL FEEDBACK. This is how a review quietly loses words.
   *
   * `waiting` was computed off `visible`, so it inherited "the declaration still names this screen". Delete an
   * exploration option — which is exactly what the end of a round does — and any unread note sitting on it
   * stopped being counted, stopped appearing in the hand-off, and took the Hand Off button with it when it was
   * the last one. The words were still on disk and nothing on screen said so. It happened for real: two notes
   * about the remedy options survived a round that removed those options, and the canvas showed nothing to
   * hand off at all.
   *
   * So the count is over every unread NOTE, whether or not its frame survives: it cannot be drawn, but it can
   * and must still travel, and the agent reads it out of the file like any other.
   *
   * THE PANEL SAYS NOTHING ABOUT IT. An amber line used to name the homeless notes and their vanished screens,
   * on the reasoning that a number in the pill matching nothing visible is worse. The owner disagreed, twice,
   * and about the same feeling both times: a line he cannot act on and cannot clear reads as an error. *"It
   * doesn't make sense to keep them like this because it looks like some kind of a error or a warning and it
   * confuses me."* Asked directly what should replace it, he chose to drop the line. Nothing is lost: the
   * comment is still counted, still handed off, and still in the file.
   *
   * A SPENT VERDICT IS THE OPPOSITE CASE, and it was being treated as the same one. A like or a dislike on a
   * screen the canvas no longer has was already acted on — acting on it is WHY that round was deleted — and
   * there is nowhere left to approve it. Counting those turned a finished round into a standing amber warning
   * about eight things nobody can do anything about. The owner, looking at it: *"if I left some comment on a
   * screen that got deleted… it means I don't really have to approve it because it was deleted, I cannot approve
   * it anywhere. and it doesn't make sense to keep them here like that… it looks like some kind of a error or a
   * warning and it confuses me."*
   *
   * They stay in the FILE, because he may want to read back what he judged and why: *"maybe you can keep them in
   * the history of your comments until I approve all of them, because I may refer to some older comments."* They
   * simply stop being counted as work.
   */
  const spent = (comment: CanvasComment) =>
    Boolean(comment.kind) &&
    comment.kind !== "note" &&
    !declared.has(comment.screenId);

  const waiting = useMemo(
    () =>
      comments.filter(
        (comment) =>
          !comment.consumedAt &&
          !(removing ?? []).includes(comment.id) &&
          !spent(comment),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [comments, removing, declared],
  );

  /**
   * WHAT IS WAITING, SPLIT BY KIND — one pile, described honestly.
   *
   * `waiting` needs no special case for verdicts any more: a verdict IS a comment, so it is already in there,
   * already counted by the pill, and already drained by the same `{ id, consumed: true }` the agent sends for a
   * note. That is the whole reason for folding the two together.
   */
  const waitingNotes = useMemo(
    () => waiting.filter((one) => !one.kind || one.kind === "note"),
    [waiting],
  );
  const waitingLikes = useMemo(
    () => waiting.filter((one) => one.kind === "like"),
    [waiting],
  );
  const waitingDislikes = useMemo(
    () => waiting.filter((one) => one.kind === "dislike"),
    [waiting],
  );
  /**
   * THE SCREENS THIS REVIEWER HAS NOT SEEN, which is the second thing that can be waiting for them.
   *
   * Every screen the declaration holds, on any device and in any view: a new frame is worth finding wherever it
   * lives, and the stepper switches device and view to reach it. Only ids the file has recorded as seen are
   * excluded, so this is exactly "screens that never existed here before" and never "screens that changed" — that
   * second thing is the comment queue, which has its own bar and its own one-by-one approval.
   */
  const declaredIds = useMemo(
    () => allScreens(declaration).map(({ screen }) => screen.id),
    [declaration],
  );
  /**
   * NOTHING IS NEW ON A PUBLISHED CANVAS, and this is the fix for a bug the reviewer found on a deployment.
   *
   * The blue queue is review chrome, exactly like the comment layer: it exists so the person who asked for the work
   * can walk the frames they have not seen. A published canvas is a link handed to somebody who has seen none of
   * them and cannot approve any of them, so the queue has nothing to offer there.
   *
   * WHAT IT LOOKED LIKE. `seen` lives in the review file, which is gitignored and therefore absent from a
   * deployment, so the seeder below fired, the write was refused with a 405 (`readOnly` in `comments-route.ts`), and
   * the failure path set `seen` to the EMPTY list — which does not mean "unknown", it means "the reviewer has seen
   * nothing". Every frame on the canvas became new: *"it marked literally all screens as new, even though this
   * functionality should be hidden (visible only locally, same as with the comments)."*
   *
   * Two changes, and the second one matters even locally: the queue is empty when published, and a failed write
   * leaves `seen` as null rather than empty, so a canvas whose review file cannot be read claims nothing is new
   * instead of claiming everything is.
   */
  const isNew = useCallback(
    (id: string) => !CANVAS_PUBLISHED && seen !== null && !seen.includes(id),
    [seen],
  );
  const newScreens = useMemo(
    () =>
      CANVAS_PUBLISHED || seen === null
        ? []
        : declaredIds.filter((id) => !seen.includes(id)),
    [declaredIds, seen],
  );

  /**
   * SEEDED ON FIRST SIGHT, or every frame on an existing canvas would be new at once.
   *
   * A canvas installed before this mechanism existed has no `seen` key, and an empty list would mean all
   * seventy-odd of its frames are unseen — which is noise, not a signal. So the first time the key is missing the
   * whole current declaration is written into it and counting starts from there. It runs once: after the write the
   * key exists, so nothing on any later load matches this condition.
   */
  const seeded = useRef(false);
  useEffect(() => {
    /* A published canvas has no review file and refuses writes, so there is nothing to seed and nothing to seed it
       with. Asking anyway produced the 405 that started the bug above. */
    if (CANVAS_PUBLISHED) return;
    if (!seenMissing || seeded.current || declaredIds.length === 0) return;
    seeded.current = true;
    void markSeen(canvas, declaredIds)
      .then((list) => {
        setSeen(list);
        setSeenMissing(false);
      })
      /* NULL, NOT EMPTY. Empty is a claim that the reviewer has seen nothing; null is "we do not know", and not
         knowing has to mean nothing is flagged. */
      .catch(() => setSeen(null));
  }, [seenMissing, declaredIds, canvas]);

  /**
   * WHEN THE PILE INCLUDES A SECOND ROUND, THE PROMPT SAYS WHICH ONES AND WHY IT MATTERS.
   *
   * A dismissal is the next message in a thread: the reviewer's new words replace the note and the answered ones
   * move into `history`. Those new words are almost never self-contained — *"You probably misunderstood me. When I
   * say something like make this text one word longer…"* is a real one from this project — and an agent that reads
   * `note` alone gets a complaint with no subject. The owner asked whether the whole thread travels: *"does the
   * agent get the whole thread and not just the last comment? because with the whole history the agent can really
   * understand the problem, and without it the new comment might sound confusing / not clear where it points at."*
   *
   * It does travel, in the file, and it always did. What was missing was anyone saying so at the moment of the
   * hand-off, which is the only text an agent is guaranteed to read. Same shape as `homelessClause` below.
   */
  const threaded = useMemo(
    () => waiting.filter((one) => (one.history?.length ?? 0) > 0),
    [waiting],
  );
  const threadClause =
    threaded.length === 0
      ? ""
      : ` ${threaded.length} of them (${threaded
          .map((one) => one.id)
          .join(
            ", ",
          )}) are second rounds: read their \`history\` before their \`note\`, oldest first, because the new words answer the old ones and rarely stand alone.`;

  /**
   * WHEN THE PILE INCLUDES NOTES WHOSE FRAME IS GONE, THE PROMPT SAYS SO — and this is the fix for a real
   * confusion rather than a new warning on the canvas.
   *
   * The panel deliberately says nothing about homeless notes: an amber line naming them was tried, and dropped,
   * twice, for the same reason both times — _"It doesn't make sense to keep them like this because it looks like
   * some kind of a error or a warning and it confuses me."_ That ruling stands, and so does the count: an unread
   * note travels whether or not its frame survived, or a round quietly loses words.
   *
   * What was missing sat on the other side of the hand-off. The agent gets a line telling it to open each comment's
   * `image` and look inside the red outline — which is impossible for a note whose screen was deleted, so those two
   * are the ones most likely to be read, half-understood and left undrained. Then the badge still shows them and the
   * reviewer sees work they know they already gave: _"it says I have two comments to handoff even though I clearly
   * dont."_ Naming them in the prompt is what closes that loop, and it costs the canvas nothing.
   */
  const homeless = useMemo(
    () => waiting.filter((one) => !declared.has(one.screenId)),
    [waiting, declared],
  );
  const homelessClause =
    homeless.length === 0
      ? ""
      : ` ${homeless.length} of them (${homeless
          .map((one) => one.id)
          .join(", ")}) point at screens this canvas no longer declares, so they have no picture to open: read the note itself, decide whether it still applies, and drain it either way.`;

  /**
   * ONE HAND-OFF, TWO SHAPES. In an exploration the reviewer is deciding between options, so the line describes
   * the ROUND — what to delete, what to build variations of, and to read the comments first. Everywhere else they
   * are commenting on a design that exists, so it stays the line it always was.
   */
  const handoffText =
    (view === "explore" && handoffPanels.length > 0
      ? explorationHandoff(canvas, commentsFile, handoffPanels)
      : handoffLine(
          canvas,
          commentsFile,
          waiting.map((one) => one.id),
        )) +
    threadClause +
    homelessClause;

  /**
   * MEASURED BY OBSERVER, NOT ONCE ON OPEN — because the panel opens with a transform.
   *
   * A plain effect on `[handoff, handoffText]` runs in the commit that mounts the panel, and the panel arrives
   * scaled: at that instant the box reported `scrollHeight === clientHeight` and the fade never appeared even
   * though the prompt overflowed by 12px. A `ResizeObserver` answers after layout, every time layout changes,
   * which is the only timing that is right whether the panel is animating, the prompt has grown, or the window
   * has been resized.
   */
  /* A CALLBACK REF, not `useEffect` over `handoff`: the panel animates in, so its DOM arrives a frame after the
     intent flips and an effect keyed on `handoff` found `promptRef.current` still null and returned. A callback ref
     runs exactly when the node attaches, which is the only moment there is anything to measure. */
  const promptBox = useCallback((box: HTMLParagraphElement | null) => {
    promptRef.current = box;
    watching.current?.disconnect();
    if (!box) return;
    box.scrollTop = 0;
    setPromptAtEnd(false);
    const measure = () =>
      setPromptScrolls(box.scrollHeight > box.clientHeight + 2);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    watching.current = observer;
  }, []);

  /** The pile in words, naming only the parts that are actually there. */
  const handoffSummary =
    [
      waitingNotes.length > 0
        ? `${waitingNotes.length} comment${waitingNotes.length === 1 ? "" : "s"} to send`
        : null,
      waitingLikes.length > 0 ? `${waitingLikes.length} liked` : null,
      waitingDislikes.length > 0 ? `${waitingDislikes.length} disliked` : null,
    ]
      .filter(Boolean)
      .join(", ") || "Nothing waiting yet";
  const toReview = useMemo(
    () => visible.filter((comment) => comment.consumedAt && comment.stale),
    [visible],
  );
  /* The bar is present when ANYTHING waits, and `queue` itself is built further down where both sets exist. */
  const queueLength = newScreens.length + toReview.length;
  /** Which kind the reviewer is standing on, which decides the bar's colour and its verb. */
  const onNew = (at ?? 0) < newScreens.length;
  /**
   * THE COUNT BELONGS TO THE KIND THE WORD NAMES, and reading it any other way was a lie.
   *
   * One queue, one stepper, the verb changes — that part is the owner's own instruction and it stands. What was
   * wrong is that the NUMBER kept spanning both kinds while the word after it described only the kind under the
   * cursor: one new frame followed by fourteen worked comments rendered as "1 of 15 New", and he read it exactly as
   * it is written: *"I don't understand, did you create 15 new screens or what?"*
   *
   * So the position and the total are both taken inside the current kind. The stepper still walks one queue across
   * the boundary; the label just stops claiming the other side of it.
   */
  const kindTotal = onNew ? newScreens.length : toReview.length;
  const kindIndex = onNew ? (at ?? 0) : (at ?? 0) - newScreens.length;

  /**
   * THE THREE PIECES OF CHROME THAT COME AND GO, each kept mounted through its own exit transition.
   *
   * `useOpenState` returns [present, open]: render while present, put open on `data-open`. Without it React
   * unmounts these the instant their condition flips and there is nothing left on screen to fade.
   */
  const [handoffPresent, handoffOpen] = useOpenState(handoff);
  const [switcherPresent, switcherOpen] = useOpenState(switching);
  /**
   * THE OTHER CANVASES, WITH WHAT IS IN THEM, and nothing when there is nowhere to go.
   *
   * The count is every declared frame across both views and both devices, which is what makes one row comparable
   * to another: a canvas is big or small regardless of how its owner split it into flows. It is read from the
   * declaration rather than from the manifest, so a canvas that has never been captured still says how big it is.
   */
  const siblings = useMemo(
    () =>
      Object.entries(canvases ?? {}).map(([slug, one]) => ({
        slug,
        title: one.title,
        frames: allScreens(one).length,
      })),
    [canvases],
  );
  /* AND THE BAR IS ABSENT WHEN PUBLISHED, belt and braces: the two queues are empty there, and a bar that offers
     Approve All on a canvas nobody can write to would be a control that lies. */
  const [reviewPresent, reviewOpen] = useOpenState(
    queueLength > 0 && !CANVAS_PUBLISHED,
  );
  const [undoPresent, undoOpen] = useOpenState(removing !== null);
  /* Held separately because the bar outlives `removing`: it is still fading when the list is already null. */
  const [undoCount, setUndoCount] = useState(0);
  useEffect(() => {
    if (removing !== null) setUndoCount(removing.length);
  }, [removing]);

  /* A press anywhere else puts the hand-off panel away. The comment draft deliberately does NOT do this:
     _"otherwise the user can by accident close it, removing all the text that they wrote."_ */
  const closeHandoff = useCallback(() => {
    setHandoff(false);
    setArmed(false);
  }, []);
  useDismissOnOutside(handoff, handoffRef, closeHandoff);
  /**
   * A PRESS OUTSIDE CLOSES IT, and Escape too — which is what every other panel in this tool already did.
   *
   * The switcher shipped without it and the owner met the gap immediately: *"maybe if I open this dropdown and I
   * click outside of it, it should close. that's the expected behavior."* He is right, and the fix is the hook the
   * hand-off panel has used all along rather than a second mechanism beside it.
   */
  const closeSwitcher = useCallback(() => setSwitching(false), []);
  useDismissOnOutside(switching, switcherRef, closeSwitcher);

  /* The layout is told what was actually captured, because a whole-page shot is several viewports tall and a
     layout that assumed one viewport would overlap everything under it. */
  const captured = useCallback(
    (id: string) => {
      const shot = shots?.[id];
      return shot ? { w: shot.w, h: shot.h } : undefined;
    },
    [shots],
  );

  /**
   * THE DECLARATION AS THIS DEVICE SEES IT, which is what every view is laid out from.
   *
   * The device filters the screens, so it filters the groups and the edges with them: a flow with nothing on this
   * device is not an empty flow, it is not this device's flow at all, and an edge with one end missing is not
   * drawable. Filtering here rather than in three layout functions is what keeps the views from disagreeing about
   * what exists — and it means the comment counts, the review bar and the hand-off are all scoped to the device
   * for free, because every one of them starts from the screens on screen.
   */
  const forDevice = useMemo<CanvasDeclaration>(() => {
    if (devices.length < 2) return declaration;
    const mine = (screen: CanvasScreen) =>
      (screen.device ?? DEFAULT_DEVICE) === device;
    const flows = declaration.flows
      .map((flow) => {
        const screens = flow.screens.filter(mine);
        const ids = new Set(screens.map((one) => one.id));
        return {
          ...flow,
          screens,
          edges: flow.edges.filter(
            (edge) => ids.has(edge.from) && ids.has(edge.to),
          ),
        };
      })
      .filter((flow) => flow.screens.length > 0);
    const explorations = (declaration.explorations ?? [])
      .map((one) => ({ ...one, screens: one.screens.filter(mine) }))
      .filter((one) => one.screens.length > 0);
    return { ...declaration, flows, explorations };
  }, [declaration, devices.length, device]);

  const layout = useMemo(() => {
    if (view === "flows") return layoutFlows(forDevice, captured);
    if (view === "explore") return layoutExplorations(forDevice, captured);
    return layoutKinds(forDevice, captured);
  }, [view, forDevice, captured]);


  /**
   * WHERE THE CANVAS OPENS: FITTED, the same as switching tabs.
   *
   * It used to frame the first group's corner — `OPENING_W` by `OPENING_H`, about a third scale — on the
   * argument that fitting everything lands at 6% where nothing can be read. The owner overruled it once the
   * launch state made the moment visible: *"when the loading finishes, the canvas has to fit the screen instead
   * of zooming into the first screenshot."*
   *
   * He had already settled the same question for tab switching, and in the same direction: a full fit of a wide
   * world is far out, and *"I wouldn't say it's worse than the emptiness it fixed… I like how it works."* So
   * launching and switching now do one thing rather than two, and `frame` never magnifies, so a canvas holding
   * a few frames still lands close in.
   */
  const opening = useMemo(() => {
    if (layout.groups.length === 0) return layout.box;
    /**
     * THE EXPLORATION'S HEADING IS PART OF WHAT IS FITTED. It sits `HEADING_LIFT` above the first group, and a
     * fit measured from the groups alone put it off the top of the screen — the one thing on the tab that says
     * which round this is, invisible until the reviewer happened to pan up.
     */
    const lift = view === "explore" ? HEADING_LIFT : 0;
    return {
      x: layout.box.x,
      y: layout.box.y - lift,
      w: layout.box.w,
      h: layout.box.h + lift,
    };
  }, [layout, view]);

  /**
   * A NEW TAB OPENS FITTED, not wherever the last one was left.
   *
   * Owner: _"when I switch between the tabs, I should always get to the center of the canvas and zoomed out
   * fully. so kind of like fit the screen instead of keeping the same placement where I was on the previous
   * tab when I go to a new one because usually there is like nothing there and I just end up in an empty area
   * of the canvas when I switch tabs, which is confusing."_
   *
   * He is describing a real geometry problem, not a preference. The three views are laid out independently:
   * the flows diagram is wide and shallow, the kinds view is a tall stack, the exploration is a wide band. A
   * transform that framed group four of one is pointing at nothing in another, and "nothing" on an infinite
   * canvas gives the reviewer no clue which way to drag.
   *
   * `frame` on the whole layout box is Figma's zoom-to-fit, and the surface clamps the zoom, so the worst case
   * is far out rather than broken. Skipped on the first render — the surface does its own opening framing,
   * which is deliberately tighter than a fit, and doing both would land at fit and lose it.
   */
  /**
   * KEYED ON THE DEVICE AS WELL AS THE VIEW, because switching device is the same kind of move.
   *
   * The owner: *"when I switch between desktop and mobile modes, I should get the same treatment as when I switch
   * between tabs, meaning that I should get to the center of the whole canvas and fit to the screen."* And the
   * geometry says the same thing: the two devices are laid out independently, so a transform that framed a
   * desktop flow points at nothing on a canvas of phones.
   */
  const framedView = useRef<string | null>(null);
  useEffect(() => {
    if (layout.box.w === 0) return;
    const key = `${view}:${device}`;
    if (framedView.current === null) {
      framedView.current = key;
      return;
    }
    if (framedView.current === key) return;
    framedView.current = key;
    /* A JUMP IS NOT A SWITCH. The device jump under a frame changes device on purpose and then lands on one
       screen; fitting the whole canvas first would throw the reviewer out to 7% and back. `pendingFocus` is the
       flag that says this move already has a destination. */
    if (pendingFocus) return;
    /**
     * A NEW TAB FITS, WHATEVER THAT COSTS IN ZOOM.
     *
     * I briefly changed this to frame the tab's opening corner instead, on the grounds that a full fit measured 7%
     * and nothing on the page could be read. That was overruled, and correctly: _"I wouldn't say it's worse than the
     * emptiness it fixed… I like how it works. I think that's how I asked it to work."_ The 7% is not a bug, it is
     * what fitting a genuinely wide world looks like — and it answers the original complaint completely, which was
     * landing in empty space because the three views are laid out independently.
     *
     * The refinement is in `frame` itself rather than here: fit shrinks and never magnifies, so a tab holding a few
     * frames lands close in and a tab holding many lands far out. Same rule, two outcomes.
     */
    surface.current?.frame(layout.box);
  }, [view, device, layout, pendingFocus]);

  /** The number on a pin is its place in the whole list, so "number 6" means one thing everywhere. */
  /* Numbered off the VISIBLE set, so a pin inside an open undo window is gone from the canvas rather than
     sitting there un-openable. */
  /**
   * NOTES ONLY. A verdict is a comment, but it is not a PIN: it covers the whole frame, it has no rectangle
   * anybody drew, and its readout is the coloured circle on the frame's own caption. Drawing it here would put a
   * full-frame outline and a numbered marker on every option the reviewer judged, which is both noise and a lie
   * about what was annotated — and it would shift every real pin's number as verdicts came and went.
   */
  const numbered = useMemo(
    () =>
      visible
        .filter((comment) => !comment.kind || comment.kind === "note")
        .map((comment, index) => ({ comment, n: index + 1 })),
    [visible],
  );

  const pinsFor = useCallback(
    (screenId: string) =>
      numbered.filter((pin) => pin.comment.screenId === screenId),
    [numbered],
  );

  /* The frame knows its region and its picture; the declaration knows which flow it belongs to and what
     address it was captured at. Both go into the record, so the JSON file reads on its own. */
  const onSave = useCallback(
    async (comment: NewRegionComment) => {
      /* Both views, so a comment on an exploration direction records its question the same way a comment in a
         journey records its flow. */
      const found = allScreens(declaration).find(
        (one) => one.screen.id === comment.screenId,
      );
      setComments(
        await saveComment(canvas, {
          ...comment,
          flowId: found?.groupId ?? "",
          label: found?.screen.label ?? comment.screenId,
          route: shots?.[comment.screenId]?.url ?? found?.screen.route ?? "",
          state: found?.screen.state ?? null,
        }),
      );
    },
    [declaration, shots, canvas],
  );

  /**
   * Put one comment's OUTLINE in the middle of the screen and open its pin.
   *
   * Centring the frame instead is fine until a frame is 3000px tall, and then the note opens below the fold:
   * the stepper takes you to a screen and hides the thing it took you there for. The region is a percentage
   * of the frame and the node's box is the frame in world coordinates, so the outline's world rect is a
   * multiplication; the padding keeps the note's own height in view under it.
   */
  const focus = useCallback(
    (comment: CanvasComment) => {
      const node = layout.groups
        .flatMap((group) => group.nodes)
        .find((one) => one.screen.id === comment.screenId);
      if (node) {
        const PADDING = 420;
        const region = comment.region;
        surface.current?.centre(
          {
            x: node.x + (region.xPct / 100) * node.w,
            y: node.y + (region.yPct / 100) * node.h,
            w: Math.max((region.wPct / 100) * node.w, 200),
            h: (region.hPct / 100) * node.h + PADDING,
          },
          1,
        );
      }
      setOpenPin(comment.id);
    },
    [layout],
  );

  /**
   * Delete, and — if what was deleted was awaiting review — go straight to the next one awaiting review.
   * Owner: "when I'm approving comments and I click approve and there are other comments that need my
   * approval, I should automatically see the next one right after clicking approve." The queue is recomputed
   * from the SERVER's answer rather than from state, because state still has the one just approved in it, and
   * the index is clamped instead of advanced: the list shrank under it, so staying put IS advancing.
   */
  const onDelete = useCallback(
    async (id: string) => {
      const before = comments.filter(
        (comment) => comment.consumedAt && comment.stale,
      );
      const wasAwaiting = before.some((comment) => comment.id === id);
      /**
       * WHERE THE APPROVED ONE STOOD IN THE QUEUE, so the next one shown is the one AFTER it.
       *
       * This used `at ?? 0`, the stepper's own index, which is right when the reviewer is stepping and wrong when
       * they are not: approving the third pin directly sent them to the FIRST comment awaiting approval, which
       * from the reviewer's seat is a jump to somewhere unrelated. Taking the position from the comment actually
       * approved makes "the next one" mean the next one in both cases.
       */
      const stood = before.findIndex((comment) => comment.id === id);
      const list = await deleteComment(canvas, id);
      setComments(list);
      if (!wasAwaiting) return;
      const queue = list.filter(
        (comment) => comment.consumedAt && comment.stale,
      );
      if (queue.length === 0) {
        setAt(null);
        setOpenPin(null);
        return;
      }
      /* The list shrank under that position, so staying at it IS advancing — clamped for the last one. */
      const index = Math.min(stood >= 0 ? stood : (at ?? 0), queue.length - 1);
      setAt(index);
      focus(queue[index]);
    },
    /* `canvas` was missing and the lint rule was right: a canvas switched under this callback would delete from
       the one it was created with. Harmless today, since the page remounts per slug, and cheap to be correct. */
    [canvas, comments, at, focus],
  );

  /** The reviewer rewriting their own words, from the pin. Awaited, so the pin closes on the saved text. */
  const onEdit = useCallback(
    async (id: string, note: string) => {
      setComments(await editComment(canvas, id, note));
    },
    [canvas],
  );

  /** Dismissed with another round of feedback: new words, new picture, back into the agent's queue. */
  const onFeedback = useCallback(
    async (id: string, note: string, image: string) => {
      setComments(await addFeedback(canvas, id, note, image));
    },
    [canvas],
  );

  /**
   * Bring one screen onto the canvas at reading size, landing on its TOP rather than its middle.
   *
   * A frame is often several viewports tall, and the middle of one is a place with no name on it. The owner, on
   * arriving there after a device jump: *"I should get to the top of it. So I could see the top of the screenshot
   * and the name of the screenshot."* The same is true of stepping to a comment, so both use this.
   */
  const goToScreen = useCallback(
    (screenId: string) => {
      const node = layout.groups
        .flatMap((group) => group.nodes)
        .find((one) => one.screen.id === screenId);
      if (!node) return;
      surface.current?.centre(
        { x: node.x, y: node.y, w: node.w, h: node.h },
        1,
        "top",
      );
    },
    [layout],
  );

  /**
   * THE SAME SCREEN ON THE OTHER DEVICE, resolved in both directions from one declaration.
   *
   * `twin` is declared once, on either side — naming the phone from the desktop entry is enough — so this reads
   * the map forwards and backwards. A screen with no twin gets no entry and therefore no button, which is the
   * ordinary case: *"desktop might have designs that mobile doesn't have. mobile might have designs that desktop
   * doesn't have."*
   */
  const twinOf = useMemo(() => {
    const all = allScreens(declaration).map(({ screen }) => screen);
    const byId = new Map(all.map((one) => [one.id, one]));
    const pairs = new Map<string, CanvasScreen>();
    for (const one of all) {
      if (!one.twin) continue;
      const other = byId.get(one.twin);
      if (!other) continue;
      pairs.set(one.id, other);
      /* The reverse, unless that side named its own twin and disagrees — in which case its own word wins. */
      if (!pairs.has(other.id)) pairs.set(other.id, one);
    }
    return pairs;
  }, [declaration]);

  useEffect(() => {
    if (!pendingFocus) return;
    const here = layout.groups
      .flatMap((group) => group.nodes)
      .some((one) => one.screen.id === pendingFocus);
    if (!here) return;
    goToScreen(pendingFocus);
    setPendingFocus(null);
  }, [pendingFocus, layout, goToScreen]);

  /** Step to the nth comment awaiting review. Wraps at both ends: a dead end needs a disabled state, which
   *  is one more thing on screen. */
  /**
   * ONE QUEUE OF THINGS WAITING, and the two kinds in it can never be the same frame.
   *
   * The owner chose this over two bars: *"One queue, one stepper, the verb changes."* New frames come first,
   * because a design nobody has seen outranks a fix they have already read, and the bar tells you which kind you
   * are on by its colour and its action. The two sets are disjoint because "new" means a screen that never existed
   * here before, so no comment from a previous round can be sitting on one.
   */
  const queue = useMemo<
    Array<
      | { kind: "new"; screenId: string }
      | { kind: "comment"; comment: CanvasComment }
    >
  >(
    () => [
      ...newScreens.map((screenId) => ({ kind: "new" as const, screenId })),
      ...toReview.map((comment) => ({ kind: "comment" as const, comment })),
    ],
    [newScreens, toReview],
  );

  /**
   * STEPPING TO A NEW FRAME CROSSES DEVICE AND VIEW, because a frame is worth finding wherever it lives.
   *
   * A comment is stepped to inside whatever is on screen, which is how it has always worked. A new frame may be a
   * phone screen while the canvas shows desktop, or an exploration direction while it shows a flow, so the stepper
   * moves those two first and lands with `pendingFocus`, the same mechanism the device jump under a frame uses.
   */
  const goToNew = useCallback(
    (screenId: string) => {
      const found = allScreens(declaration).find(
        ({ screen }) => screen.id === screenId,
      );
      if (!found) return;
      const itsDevice = found.screen.device ?? DEFAULT_DEVICE;
      if (itsDevice !== device) setDevice(itsDevice);
      const itsView: ViewMode = found.view === "exploration" ? "explore" : view === "flows" && found.view === "flow" ? "flows" : "kinds";
      if (itsView !== view) setView(itsView);
      if (itsDevice !== device || itsView !== view) setPendingFocus(screenId);
      else goToScreen(screenId);
    },
    [declaration, device, view, goToScreen],
  );

  const step = useCallback(
    (to: number) => {
      if (queue.length === 0) return;
      const next = (to + queue.length) % queue.length;
      setAt(next);
      const item = queue[next];
      if (item.kind === "new") goToNew(item.screenId);
      else focus(item.comment);
    },
    [queue, focus, goToNew],
  );

  /**
   * REVIEW ONLY — the handle `check-canvas.mjs` drives the canvas with. An infinite canvas has no scroll
   * position to set, so the oracle needs a way to say "put that frame in view" that does not depend on where
   * the canvas happens to be.
   *
   * DELETE WITH: the design-canvas/ folder.
   */
  useEffect(() => {
    const api = {
      goTo: goToScreen,
      fit: () => surface.current?.frame(layout.box),
      zoomBy: (factor: number) => surface.current?.zoomBy(factor),
      setView: (next: ViewMode) => setView(next),
      /**
       * DRIVEN BY THE ORACLE so it can assert every device rather than the one the canvas opens on.
       *
       * The alternative was for the check script to click the toolbar button, which couples it to the chrome's
       * markup; `setView` was exposed for the same reason and this is its sibling. It also reports which devices
       * exist, so the script does not have to infer them from the declaration a second time.
       */
      setDevice: (next: CanvasDevice) => setDevice(next),
      devices: () => devices,
      setCommenting,
      read: () => surface.current?.read(),
      /* What is grouped with what, so the oracle can assert it rather than measure pixels for it. */
      groups: () =>
        layout.groups.map((group) => ({
          id: group.id,
          title: group.title,
          screens: group.nodes.map((node) => node.screen.id),
        })),
    };
    (window as unknown as { __devCanvas?: typeof api }).__devCanvas = api;
    return () => {
      delete (window as unknown as { __devCanvas?: typeof api }).__devCanvas;
    };
  }, [goToScreen, layout]);

  /**
   * Comment mode on `c`, and nothing else.
   *
   * THERE WAS A `k` FOR SWITCHING VIEW, AND IT IS GONE. The tabs are right there in the toolbar, one press
   * away and labelled; a shortcut that does the same thing is undiscoverable and redundant — the owner's
   * verdict: _"I dont think we need the 'K' shortcut, it's not discovarable and redundant."_
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const el = event.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      /* No shortcut into a layer that is not there. */
      if (event.key === "c" && !CANVAS_PUBLISHED) setCommenting((on) => !on);
      else if (event.key === "Escape") setCommenting(false);
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /**
   * HOW MANY OPTIONS THE PANEL THIS FRAME SITS IN HOLDS, which decides whether it can be judged at all.
   *
   * Like and dislike are a CHOICE BETWEEN options. On a panel that has narrowed to one they are a choice
   * between it and nothing, which is not what they mean — the owner: *"if there is just one screenshot in a
   * section in the exploration, we don't need like or dislike anymore because how would you choose anything
   * there if there is just one option? It's not smart."* The comment layer stays, because a single design is
   * exactly what still needs remarks before it is approved.
   */
  const optionsInPanel = useMemo(() => {
    const count = new Map<string, number>();
    for (const group of layout.groups)
      for (const node of group.nodes)
        /* DIRECTIONS, not frames: a lone direction with three supporting pictures is still a panel of one, and
           the verdict buttons stay away from it. */
        if (!node.supporting)
          count.set(node.group.id, (count.get(node.group.id) ?? 0) + 1);
    return count;
  }, [layout]);

  const frameFor = (node: LaidOutNode) => (
    <div
      key={`${node.group.id}-${node.screen.id}`}
      className="absolute"
      style={{ left: node.x, top: node.y }}
    >
      <CanvasFrame
        canvas={canvas}
        screen={node.screen}
        shot={shots?.[node.screen.id] ?? null}
        manifestLoaded={shots !== null}
        scale={declaration.frameScale}
        pins={pinsFor(node.screen.id)}
        revealed={revealed}
        isNew={isNew(node.screen.id)}
        /* The flow's own reading order: a column at a time, left to right, and nothing later than 240ms. */
        entranceDelay={Math.min(node.rank * 60, 240)}
        /* Wider than the picture for a phone, so nothing under the frame has to shrink — see `chromeWidth`. */
        chromeW={chromeWidth(node.screen, forDevice, captured)}
        /**
         * The jump to the other device, when the declaration names one. It switches the device and centres the
         * twin once the new layout exists (`pendingFocus`), which is what makes it read as moving the canvas
         * rather than opening a second thing.
         */
        onTwin={(() => {
          const other = twinOf.get(node.screen.id);
          if (!other || devices.length < 2) return null;
          const otherDevice = other.device ?? DEFAULT_DEVICE;
          if (otherDevice === device) return null;
          return {
            device: otherDevice,
            go: () => {
              setDevice(otherDevice);
              setPendingFocus(other.id);
            },
          };
        })()}
        /* Notes, not verdicts: the next pin's number has to match the numbering above. */
        nextNumber={numbered.length + 1}
        /* Titles belong to the grouped view; in a flow the arrows explain what happened. In an exploration the
           title is the direction's NAME, which is the whole basis of choosing between them. */
        showTitle={view !== "flows"}
        /* Numbering and the two verdict buttons exist in the exploration and nowhere else: a grouped screen is
           not an option, so there is nothing to number it against and nothing to keep or drop. */
        optionNumber={view === "explore" && !node.supporting ? node.rank + 1 : undefined}
        verdict={verdictOf[node.screen.id] ?? null}
        onVerdict={
          view === "explore" &&
          !node.supporting &&
          (optionsInPanel.get(node.group.id) ?? 0) > 1
            ? (value) => onVerdict(node.screen.id, value)
            : undefined
        }
        commenting={commenting}
        onSave={onSave}
        onDeletePin={onDelete}
        onEditPin={onEdit}
        onFeedback={onFeedback}
        openPin={openPin}
        onOpenPin={setOpenPin}
      />
    </div>
  );

  return (
    /**
     * The font is named here rather than inherited, for the same reason the colours are literals: the canvas
     * looks the same in every project it is installed in, and a host app's body font would change its type
     * scale under it. Inter where it is available, the platform's own UI face otherwise.
     *
     * `--canvas-font` IS THE ONE ESCAPE HATCH, and it exists because "Inter" and a project's Inter are not
     * always the same metrics. Measured while installing this into a Next app that loads Inter through
     * `next/font`: "Share menu" at 600 weight and 23px came out 124.84px wide against the stack below and
     * 132.73px against the app's own `__Inter_f367f3` — same typeface by name, 6% apart, which is a visible
     * shift in every caption on the canvas. A project that would rather have the font it already loads sets
     * `--canvas-font` in its own CSS, which is a seam in the project rather than an edit to this file. Unset
     * is the default and the default is deliberate.
     */
    <div
      className="fixed inset-0 overflow-hidden bg-[hsl(192_12%_13%)]"
      style={{
        fontFamily:
          'var(--canvas-font, Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif)',
      }}
    >
      <CanvasSurface
        ref={surface}
        world={layout.box}
        opening={opening}
        onZoom={setZoom}
        locked={commenting}
        /* Placed means pointing somewhere worth looking at, which is when the frames may start arriving. */
        onPlaced={() => setRevealed(true)}
      >
        {/* Every section first, so the panels paint UNDER the edges and the frames rather than over them. */}
        {/**
         * THE EXPLORATION TAB'S HEADING, above every section rather than inside the first one.
         *
         * It is a heading, so it lives in the WORLD and pans away once the reviewer is working — the same as any
         * heading on any page. What it is not any more is a caption: it is the largest type on the canvas, the
         * sections read as its parts, and the copy leads with the verb because the first thing the reviewer needs
         * is what to DO, not where they are.
         *
         * The full mechanism is one hover away rather than on screen: _"don't treat it as a complete explanation
         * for a completely new user. It's more of a like, brief reminder how it works."_
         */}
        {view === "explore" && layout.groups.length > 0 ? (
          <div
            /* `data-canvas-chrome` is the pan surface's own escape hatch: without it a press or a hover here
               starts a world-drag and the pointer never reaches the mark. See trap 18. */
            data-canvas-chrome=""
            className="absolute z-[70] whitespace-nowrap"
            style={{
              left: layout.groups[0].box.x,
              top: layout.groups[0].box.y - HEADING_LIFT,
            }}
          >
            <div
              className="flex items-center gap-[0.34em] font-bold tracking-[-0.02em] text-white"
              style={{ fontSize: HEADING_SIZE, lineHeight: 1.05 }}
            >
              {roundCopy.title}
              {/* The mark scales with the heading, because a fixed 15px dot beside 190px type is invisible.
                  0.34 was still too timid — _"why is it so small if you put it near such a big headline?"_ — so
                  it is half the type size now, which lands it at roughly the heading's own cap height. */}
              <CanvasTooltip
                label={null}
                mark={Math.round(HEADING_SIZE * 0.5)}
                title="How a round works"
              >
                A like is exclusive: unliked options are rejected, not pending. A liked option returns as three
                variations with its comments worked first. And a section you left untouched was built on
                something you did not pick, so it is wrong rather than pending — it gets rebuilt, not re-asked.
              </CanvasTooltip>
            </div>
            {/**
             * THE ROUND SUPPORTS RATHER THAN LEADS. Read off the declarations rather than written down anywhere:
             * each exploration carries its own `round`, so this states the set of them. One round across the
             * board is the normal case; a mix means some questions are further along than others, and saying so
             * is better than picking one and being wrong about the rest.
             */}
            <div
              className="mt-[0.5em] font-medium text-white/45"
              style={{ fontSize: HEADING_SUB_SIZE, lineHeight: 1.35 }}
            >
              {roundCopy.note}
            </div>
          </div>
        ) : null}

        {layout.groups.map((group) => (
          <div
            key={`section-${group.id}`}
            className="absolute rounded-[36px] bg-white/[0.07]"
            style={{
              left: group.box.x - SECTION_PAD,
              top: group.box.y - SECTION_PAD,
              width: group.box.w + SECTION_PAD * 2,
              height: group.box.h + SECTION_PAD * 2,
            }}
            data-canvas-section={group.id}
          />
        ))}
        <CanvasEdgeLayer groups={layout.groups} />
        {layout.groups.map((group) => (
          <Fragment key={group.id}>
            {/**
             * THE GROUP IS A SECTION, and that is what says "these belong together" — not a word saying so.
             *
             * It used to be a badge reading "screen group · 6 screens" over the title, which is a label
             * explaining a relationship the canvas should simply show. A panel one step lighter than the stage
             * shows it: everything inside the panel is one set, the gaps between panels are the boundaries, and
             * nothing has to be read to know it. The title sits inside its own panel, and the count goes with
             * it where it is a fact rather than a caption.
             */}
            <h2
              className="absolute whitespace-nowrap font-semibold tracking-[-0.025em] text-white"
              style={{
                left: group.box.x,
                top: group.box.y,
                fontSize: GROUP_SIZE,
                lineHeight: 1.05,
              }}
              data-canvas-group={group.id}
            >
              {group.title}
            </h2>
            {group.nodes.map(frameFor)}
          </Fragment>
        ))}
      </CanvasSurface>

      {/**
       * THE TOOLBAR: one bar, one row, everything in it the same height.
       *
       * It was a bar containing a track containing pills, beside another track containing buttons — containers
       * inside containers, which made the zoom controls sit taller than the tabs and gave the whole thing three
       * nested outlines. Now there is one surface and one row of 32px controls, the active choice marked by a
       * single white pill and the zones separated by hairlines rather than by boxes. No ring around the bar
       * either: the shadow is what lifts it off the stage.
       */}
      {/**
       * WHICH CANVAS YOU ARE IN, TOP LEFT, and it is one control because a canvas is one choice.
       *
       * The canvas is already this tool's top level of information architecture: its own frames, its own comments,
       * its own review queue, its own index entry. The owner reached the same conclusion out loud after talking
       * himself out of a bigger idea: *"maybe this element that could be in the top left corner could be a switcher
       * between different canvases like that."* Nothing new is declared for it — it reads the registry the project
       * already passes to the page.
       *
       * THE SAME SURFACE AS THE TOOLBAR, holding one action, so the corner reads as another instrument of the same
       * kit rather than as a new kind of thing. The panel underneath borrows the hand-off's recipe for the same
       * reason.
       *
       * ABSENT ON A ONE-CANVAS PROJECT, like the device switch on a one-device canvas: a control whose menu would
       * hold the page you are already on is a control that does nothing.
       */}
      {siblings.length > 1 ? (
        <div
          ref={switcherRef}
          className="absolute left-5 top-5 z-[60]"
          data-canvas-switcher=""
        >
          <div
            className="flex items-center rounded-full bg-[hsl(180_15%_5.5%)] px-2 py-2 shadow-[0px_4px_16px_0px_rgba(0,0,0,0.04),0px_10px_32px_0px_rgba(0,0,0,0.04)]"
            data-canvas-chrome=""
          >
            <button
              type="button"
              aria-expanded={switching}
              title="Switch canvas"
              onClick={() => setSwitching((was) => !was)}
              className={cn(BAR_ITEM, BAR_PAD, BAR_QUIET)}
            >
              {/* Truncated anyway: a project can declare a longer title than the copy checker allows. */}
              <span className="max-w-[220px] truncate">{declaration.title}</span>
              <IconChevron
                className={cn(
                  "transition-transform motion-reduce:transition-none",
                  switching && "rotate-180",
                )}
              />
            </button>
          </div>
          {switcherPresent ? (
            <div
              data-open={switcherOpen}
              style={MOTION_STYLE}
              className={cn(
                "absolute left-0 top-[calc(100%+12px)] w-[320px] origin-top-left rounded-2xl bg-[hsl(180_15%_5.5%)] p-2 shadow-[0px_4px_16px_0px_rgba(0,0,0,0.04),0px_10px_32px_0px_rgba(0,0,0,0.04)]",
                PANEL_MOTION,
              )}
              data-canvas-chrome=""
            >
              {siblings.map((one) => (
                /**
                 * A LINK, TRAVELLED CLIENT-SIDE, and the difference is the whole of what the owner saw.
                 *
                 * A plain `href` is a document navigation: the app unmounts, the browser paints its own blank page,
                 * and the canvas comes back through a cold boot. Between two canvases in the same app that reads as
                 * a fault — *"when I switch between canvases, I should see our nice smooth animation instead of some
                 * buggy flashlight experience that I currently get sometimes."* The flash was the reload.
                 *
                 * `router.push` keeps the app mounted, so the new canvas arrives the way a canvas is supposed to:
                 * held blank behind the loader while its world is placed, then fitted to the screen. It is still a
                 * real `<a href>` underneath, so the row can be opened in a new tab and read by a screen reader as
                 * the link it is.
                 */
                <a
                  key={one.slug}
                  href={`/design-canvas/${one.slug}`}
                  onClick={(event) => {
                    /* Let the browser have the modified presses: new tab, new window, download. */
                    if (
                      event.metaKey ||
                      event.ctrlKey ||
                      event.shiftKey ||
                      event.altKey ||
                      event.button !== 0
                    )
                      return;
                    event.preventDefault();
                    setSwitching(false);
                    if (one.slug !== canvas) router.push(`/design-canvas/${one.slug}`);
                  }}
                  aria-current={one.slug === canvas ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2 rounded-xl px-3 py-2.5 text-[0.8125rem] transition-colors",
                    one.slug === canvas
                      ? "bg-white/[0.08] text-white"
                      : "text-white/70 hover:bg-white/[0.06] hover:text-white",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {one.title}
                  </span>
                  {/* The count, not a thumbnail strip: the canvas behind this panel is already the picture view. */}
                  <span className="shrink-0 tabular-nums text-white/35">
                    {one.frames}
                  </span>
                </a>
              ))}
              <span className="mx-3 my-1 block h-px bg-white/[0.08]" />
              <a
                href="/design-canvas"
                onClick={(event) => {
                  if (
                    event.metaKey ||
                    event.ctrlKey ||
                    event.shiftKey ||
                    event.altKey ||
                    event.button !== 0
                  )
                    return;
                  event.preventDefault();
                  setSwitching(false);
                  router.push("/design-canvas");
                }}
                className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-[0.8125rem] text-white/55 transition-colors hover:bg-white/[0.06] hover:text-white"
              >
                All canvases
              </a>
            </div>
          ) : null}
        </div>
      ) : null}

      <div
        className="absolute left-1/2 top-5 z-[60] flex -translate-x-1/2 items-center gap-1 rounded-full bg-[hsl(180_15%_5.5%)] px-2 py-2 shadow-[0px_4px_16px_0px_rgba(0,0,0,0.04),0px_10px_32px_0px_rgba(0,0,0,0.04)]"
        data-canvas-chrome=""
        data-canvas-toolbar=""
      >
        {/**
         * THE DEVICE, BEFORE THE VIEWS, because it is a level above them.
         *
         * The owner's shape: *"there could be a switch between desktop and mobile done as a icon tab switch or
         * something like that before the three tabs for exploration groups and user flows. And it would just like
         * work like another level of navigation."* Icons rather than words, so the bar does not grow two more word
         * pills; the same 32px control and the same white active pill as the tabs, so it reads as one bar.
         *
         * ABSENT ON A ONE-DEVICE CANVAS, which is every canvas built before this and every project that is only
         * one of the two.
         */}
        {devices.length > 1 ? (
          <>
            {devices.map((one) => (
              <button
                key={one}
                type="button"
                aria-pressed={device === one}
                aria-label={one === "phone" ? "Phone screens" : "Desktop screens"}
                title={one === "phone" ? "Phone screens" : "Desktop screens"}
                onClick={() => setDevice(one)}
                className={cn(
                  BAR_ITEM,
                  BAR_SQUARE,
                  device === one ? BAR_TAB_ON : BAR_QUIET,
                )}
                data-canvas-device={one}
              >
                {/* The phone glyph is drawn tall and narrow, so at an equal size it reads smaller than the
                    monitor beside it: *"the phone one can be, the SVG can be just slightly bigger, just a
                    bit."* */}
                {one === "phone" ? <IconPhone size={17} /> : <IconDesktop size={15} />}
              </button>
            ))}
            <span className="mx-1 h-5 w-px bg-white/[0.14]" />
          </>
        ) : null}

        {tabs.map((mode) => (
          <button
            key={mode}
            type="button"
            aria-pressed={view === mode}
            onClick={() => setView(mode)}
            className={cn(
              BAR_ITEM,
              BAR_PAD,
              view === mode ? BAR_TAB_ON : BAR_QUIET,
            )}
          >
            {TAB_LABEL[mode]}
          </button>
        ))}


        {/**
         * EVERYTHING FROM HERE IS THE COMMENT LAYER, and a published canvas has none of it.
         *
         * `CANVAS_PUBLISHED` is the deployed, read-only copy — see its note in types.ts. The layer is ABSENT there
         * rather than present and refusing: a Comment button that cannot save, a Hand Off that hands nothing off
         * and a Clear All over an empty review are three lies about what the page can do. The divider goes with
         * them, or the toolbar ends on a rule with nothing after it.
         */}
        {CANVAS_PUBLISHED ? null : (
          <span className="mx-1 h-5 w-px bg-white/[0.14]" />
        )}

        {CANVAS_PUBLISHED ? null : (
          <button
            type="button"
            aria-pressed={commenting}
            title={
              commenting ? "Drag a box on any screen" : "Comment on a screen"
            }
            onClick={() => setCommenting((on) => !on)}
            className={cn(
              BAR_ITEM,
              BAR_PAD,
              commenting ? BAR_MODE_ON : BAR_QUIET,
            )}
          >
            <IconComment />
            Comment
          </button>
        )}

        {/**
         * THE HANDOFF, AND WHAT IT MAY COUNT. Two questions this had no answer to: how do these reach an
         * agent, and are they leaving rubbish in the repository. Both are answered in one place.
         *
         * IT COUNTS ONLY WHAT THE AGENT HAS NOT READ, which it did not, and the difference matters enough
         * that the owner caught it with twelve comments on screen: "it still shows me that I can hand it off
         * by copying the prompt, but there's really no comments that I should send back to the agent." A
         * comment the agent has ingested is waiting for the REVIEWER now — that is the pill in the corner,
         * not this. So this button, and this count, appear only while something is genuinely outbound.
         */}
        {waiting.length > 0 && !CANVAS_PUBLISHED ? (
          <div className="relative" ref={handoffRef}>
            <button
              type="button"
              aria-expanded={handoff}
              onClick={() => {
                setArmed(false);
                setHandoff((open) => !open);
              }}
              /* The one solid pill on the canvas: this is the action the whole comment layer exists for. */
              className={cn(BAR_ITEM, BAR_PAD, BAR_PRIMARY)}
            >
              Hand Off
              {/**
               * THE COUNT IS EVERYTHING WAITING TO TRAVEL, and verdicts are in it because they are comments.
               *
               * Owner: _"when I select a like or dislike nothing really tells me that it's ready for
               * a handover or like it does when I leave a comment. Why is that?"_ It was literally true, and in
               * two ways: this whole button is gated on there being something outbound, and "outbound" meant
               * comments, so with no comments on the canvas the button did not exist at all. A verdict is the
               * instruction that deletes an option or
               * orders three variations of it, so it is exactly as much a thing to hand off as a comment is, and
               * the pill has to say so the moment it is given.
               *
               * One number rather than two, because the panel underneath already breaks it into
               * "N comments to send, K liked and M disliked" — the pill's job is only to show that the pile grew.
               */}
              <span className="tabular-nums opacity-55">{waiting.length}</span>
            </button>
            {/* Mounted through its own exit, so closing fades rather than blinks — see `useOpenState`. */}
            {handoffPresent ? (
              <div
                data-open={handoffOpen}
                style={MOTION_STYLE}
                className={cn(
                  "absolute right-0 top-[calc(100%+12px)] w-[420px] origin-top-right rounded-2xl bg-[hsl(180_15%_5.5%)] p-4 shadow-[0px_4px_16px_0px_rgba(0,0,0,0.04),0px_10px_32px_0px_rgba(0,0,0,0.04)]",
                  PANEL_MOTION,
                )}
              >
                {/* Only the parts that exist. "0 comments to send, 3 liked" is what this said before verdicts
                    were counted, and a zero nobody needs is the kind of line that makes a reader distrust the
                    rest of the panel. */}
                <p className="text-[0.8125rem] text-white">
                  {handoffSummary}. Give the agent this line:
                </p>
                {/**
                 * A FIXED HEIGHT WITH THE SCROLL INSIDE IT, AND NO SCROLLBAR.
                 *
                 * Owner: _"this prompt area should have a fixed height and a scroll inside it if it as long as in
                 * this example, with a clear visual treatement that it's scrollable, BUT without a scroll bar (I
                 * hate scrollbars)."_ An exploration hand-off runs to a dozen lines — the round, what to delete,
                 * what to build variations of — and it was pushing the Copy button and Clear All off the panel.
                 *
                 * The "there is more" signal is a FADE at the bottom edge, done with `mask-image` so it is the text
                 * itself thinning out rather than a gradient laid over it: no extra element, no border, nothing to
                 * misalign. It is removed once the reader reaches the end, which is what makes it a signal instead
                 * of decoration.
                 *
                 * 12px, up from 10: it is a paragraph somebody actually reads before pasting it.
                 */}
                <p
                  ref={promptBox}
                  onScroll={(event) => {
                    const box = event.currentTarget;
                    setPromptAtEnd(
                      box.scrollTop + box.clientHeight >= box.scrollHeight - 2,
                    );
                  }}
                  className="mt-2 max-h-[168px] overflow-y-auto rounded-lg bg-white/[0.06] px-4 py-3 text-[0.75rem] font-medium leading-relaxed text-white/60 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                  style={
                    promptScrolls && !promptAtEnd
                      ? {
                          maskImage:
                            "linear-gradient(to bottom, black calc(100% - 28px), transparent)",
                          WebkitMaskImage:
                            "linear-gradient(to bottom, black calc(100% - 28px), transparent)",
                        }
                      : undefined
                  }
                >
                  {handoffText}
                </p>
                <div className="mt-3 flex items-center gap-2">
                  <button
                    type="button"
                    className="inline-flex h-8 items-center gap-1.5 rounded-full bg-white px-3 text-[0.75rem] font-medium text-[hsl(180_15%_5.5%)]"
                    onClick={() => {
                      void navigator.clipboard?.writeText(handoffText);
                      setCopied(true);
                      window.setTimeout(() => setCopied(false), 1800);
                    }}
                  >
                    {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                    {copied ? "Copied" : "Copy"}
                  </button>
                  {/**
                   * CLEAR ALL ASKS FIRST, and it earned that the hard way — twice.
                   *
                   * This button deletes every comment and every picture in one press, and both times it has been
                   * fired by accident it was fired by a script: once by a unit test probing the route, and once by
                   * a Playwright check that walked the panel and pressed what it found. The second one destroyed a
                   * real review — nine verdicts and two open notes — which was recoverable only because the route
                   * keeps rotations of the file beside it.
                   *
                   * One press arms it and says what the number is; the second does it. Not a dialog: PRODUCT.md
                   * bans stacking a modal on an open surface, and this panel is already the surface. It disarms
                   * when the panel closes, so the armed state can never be left lying around.
                   */}
                  <button
                    type="button"
                    className={cn(
                      "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[0.75rem] font-medium",
                      DANGER,
                    )}
                    onClick={() => {
                      if (!armed) {
                        setArmed(true);
                        return;
                      }
                      void clearComments(canvas).then(setComments);
                      setArmed(false);
                      setHandoff(false);
                    }}
                  >
                    <IconTrash size={14} />
                    {armed ? `Delete all ${comments.length}?` : "Clear All"}
                  </button>
                  {/**
                   * WHERE THE FILES LIVE IS A TOOLTIP NOW, not a paragraph under the buttons. It was three
                   * lines of prose about gitignoring, on screen every time the panel opened, answering a
                   * question nobody asks twice: "the hint at the bottom it should rather be hidden into some
                   * kind of a tooltip. It doesn't make sense to show it all the time."
                   */}
                  {/* THE WORD IS THE TARGET, not a dot beside it. Owner: _"even the word 'Where?' should be
                      showing the tooltip on hover."_ `CanvasTooltip` takes the label, so there is one hover
                      region around the word and the mark rather than two things sitting next to each other. */}
                  <CanvasTooltip
                    className="ml-auto text-[0.75rem] font-medium text-white/35"
                    label="Where?"
                    title="Where these live"
                  >
                    In `design-canvas/comments/`, one JSON file and a picture per note. Both are gitignored, so
                    nothing reaches the repository, and Clear all empties them.
                  </CanvasTooltip>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {/**
       * THE ZOOM, IN ITS OWN BAR AT THE TOP RIGHT.
       *
       * It sat in the top toolbar between the tabs and the comment control, which put a continuous adjustment in
       * the middle of a row of one-off choices. The owner moved it: *"move this outside the top toolbar to become
       * a separate toolbar at the bottom right corner of the canvas. also decrease the horizontal space between
       * minus, percentage and plus to 0px."*
       *
       * Flush, so the three read as one control rather than three: no gap on this row, and the padding is on the
       * items. Same surface, same height, same radius as the top bar, so it is the same instrument in two places.
       *
       * AND THEN IT MOVED AGAIN, to the top right: *"move the zoom in and zoom out bar from the bottom where it is
       * currently placed in the bottom right part and move it to the top right corner of the canvas."* Which also
       * gets it out from under the review row, whose switch now reaches further left and right than the bar did.
       */}
      <div
        className="absolute right-6 top-6 z-[60] flex items-center rounded-full bg-[hsl(180_15%_5.5%)] px-2 py-2 shadow-[0px_4px_16px_0px_rgba(0,0,0,0.04),0px_10px_32px_0px_rgba(0,0,0,0.04)]"
        data-canvas-chrome=""
        data-canvas-zoombar=""
      >
        <button
          type="button"
          aria-label="Zoom out"
          className={cn(BAR_ITEM, BAR_QUIET, BAR_SQUARE)}
          onClick={() => surface.current?.zoomBy(1 / ZOOM_STEP)}
        >
          <IconMinus />
        </button>
        <button
          type="button"
          title="Fit Everything"
          className={cn(BAR_ITEM, "px-2", BAR_QUIET, "tabular-nums")}
          onClick={() => surface.current?.frame(layout.box)}
        >
          {shownZoom(zoom)}%
        </button>
        <button
          type="button"
          aria-label="Zoom in"
          className={cn(BAR_ITEM, BAR_QUIET, BAR_SQUARE)}
          onClick={() => surface.current?.zoomBy(ZOOM_STEP)}
        >
          <IconPlus />
        </button>
      </div>

      {/**
       * WHAT IS WAITING FOR YOU. One pill, one state, bottom centre, and the only green thing in the tool.
       *
       * A canvas is big and after a round of fixes the answered pins are scattered across it: "I can imagine
       * that canvas can be really, really big with lots of designs and just looking for the screenshots where
       * you left a comment might be a bit frustrating. So we need a better control."
       *
       * Three corrections went into it, all his. It sat bottom-RIGHT in the toolbar's own near-black, which
       * made it read as more chrome — "it should have a different color treatment, e.g. green instead of black
       * like the main toolbar, so it grabs more attention". It had a collapsed form and an expanded form —
       * "no need to have two states". And the first draft carried a heading, the screen's name and a Done
       * button — "way too overengineered. I need total simplicity."
       *
       * So: the count, an arrow either side of it, and Approve All. Pressing the count centres the one you are
       * on. The verdict itself is given in the pin, where the outline and the words are.
       */}
      {reviewPresent ? (
        /**
         * THE SWITCH AND THE BAR TRAVEL TOGETHER, in one centred row.
         *
         * The bar used to centre itself. It cannot any more: the switch has to sit immediately to its LEFT, and the
         * bar's width changes with its label, so anything anchored to the centre would drift away from its edge.
         * The pair is centred instead, which keeps the two touching at every width.
         */
        <div
          className="absolute bottom-6 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-2"
          data-canvas-review-row=""
        >
          {/**
           * ONE BUTTON THAT IS THE OTHER QUEUE, wearing the other queue's colour and carrying its count.
           *
           * Two kinds of thing wait on a canvas — designs nobody has seen, and comments already worked — and the bar
           * shows one of them at a time. Which meant the other one was invisible: the reviewer had no way of knowing
           * it was there. The owner asked for it directly: *"it would be nice if we had some kind of a switch between
           * the designs and the comments, because right now it's not quite clear that there are some of them here and
           * there … to the left from this bar there could be another bar with just one action icon inside of it. So if
           * we are showing a blue bar with new screens, then that other one has to be green and show a comment icon
           * and vice versa … And both could have a numbered badge."*
           *
           * So it is always the OPPOSITE of the bar beside it: colour, glyph and number. It only exists when there is
           * something on the other side, because a switch to an empty queue is a dead control.
           */}
          {newScreens.length > 0 && toReview.length > 0 ? (
            /**
             * IT IS A BAR, NOT A BUTTON — the same container as the one beside it, holding one ordinary action.
             *
             * The first version was a single coloured oval with a glyph in it, which is a control this tool does not
             * have. The owner: *"the size of this thing should be the same as the size of the other toolbar, meaning
             * that it has to be like the same container with one action inside. and the action has to be the same
             * like everywhere else. the same exact treatment and visual approach, instead of a new oval action that
             * you just invented."* So: the review bar's own surface, padding, radius and shadow, and inside it a
             * `BAR_ITEM` square in `REVIEW_QUIET` — byte for byte the treatment every other action in these bars
             * wears. Its height therefore matches without being stated.
             */
            <div
              style={MOTION_STYLE}
              className={cn(
                "relative flex items-center rounded-full p-1.5 shadow-[0px_4px_16px_0px_rgba(0,0,0,0.18),0px_10px_32px_0px_rgba(0,0,0,0.22)]",
                "transition-[background-color] motion-reduce:transition-none",
                onNew ? "bg-[hsl(154_46%_30%)]" : "bg-[hsl(206_58%_36%)]",
              )}
              data-canvas-chrome=""
              data-canvas-review-switch={onNew ? "comments" : "new"}
            >
              <button
                type="button"
                title={onNew ? "Comments to review" : "New screens"}
                aria-label={
                  onNew
                    ? `Comments to review (${toReview.length})`
                    : `New screens (${newScreens.length})`
                }
                onClick={() => step(onNew ? newScreens.length : 0)}
                className={cn(BAR_ITEM, REVIEW_QUIET, BAR_SQUARE)}
              >
                {/* BOTH GLYPHS, STACKED, ONE FADING OUT AS THE OTHER FADES IN — over the same 220ms as the tint, so
                    the whole control changes as one gesture instead of the colour easing while the icon cuts. */}
                <span className="relative grid h-4 w-4 place-items-center">
                  <IconCommentBubble
                    className={cn(
                      "absolute transition-opacity motion-reduce:transition-none",
                      onNew ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <IconFrames
                    className={cn(
                      "absolute transition-opacity motion-reduce:transition-none",
                      onNew ? "opacity-0" : "opacity-100",
                    )}
                  />
                </span>
              </button>
              {/* THE COUNT, IN THE CORNER. White on the bar's own hue rather than a third colour: it is a number, not
                  another state. `tabular-nums` so two digits do not shift its width. */}
              <span
                className={cn(
                  "pointer-events-none absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-white px-1 text-[0.625rem] font-semibold leading-none tabular-nums",
                  onNew ? "text-[hsl(154_46%_24%)]" : "text-[hsl(206_58%_30%)]",
                )}
              >
                {onNew ? toReview.length : newScreens.length}
              </span>
            </div>
          ) : null}
        <div
          data-open={reviewOpen}
          style={MOTION_STYLE}
          /* `gap` LIVES ON THE GROUPS NOW, NOT HERE. Owner: _"reduce the horizontal space between the chevrons
             and the action that's in between those two chevrons... it should be 0 pixels there."_ A single
             `gap-1` on this row could not say that, because it spaced the arrows AND the divider AND Approve
             All with one number. Two groups, so the triplet can be flush and the rest can breathe. */
          /**
           * BLUE FOR NEW SCREENS, GREEN FOR COMMENTS, and the bar changes as you step.
           *
           * The owner: *"regarding the outline I think that it actually has to be blue, like light blue. and the
           * toolbar has to be blue as well. Then, with this approach, it will be really clear when you're looking
           * at new screens and making decisions based on the new screens, or you're looking at the comments that
           * were updated and you need to approve them or not."* The frames carry the same blue on their own edge,
           * so the bar and the thing it is pointing at are visibly one state.
           */
          className={cn(
            /* 10px ON THE RIGHT, 6 EVERYWHERE ELSE: *"increase the right side padding in the toolbar here by 4 more
               px."* Approve All is the widest thing in the bar and it sat too near the edge, which the arrows and
               the count did not because they are square. */
            "flex items-center rounded-full p-1.5 pr-2.5 shadow-[0px_4px_16px_0px_rgba(0,0,0,0.18),0px_10px_32px_0px_rgba(0,0,0,0.22)]",
            onNew ? "bg-[hsl(206_58%_36%)]" : "bg-[hsl(154_46%_30%)]",
            BAR_MOTION_TINT,
          )}
          data-canvas-chrome=""
          data-canvas-review={onNew ? "new" : "comments"}
        >
          {/* The stepper: arrow, count, arrow, flush against each other so they read as one control. */}
          <div className="flex items-center" data-canvas-stepper="">
          <button
            type="button"
            aria-label="Previous"
            className={cn(BAR_ITEM, REVIEW_QUIET, BAR_SQUARE)}
            onClick={() => step((at ?? 0) - 1)}
          >
            <IconLeft />
          </button>
          {/* No glyph, and 10px of padding rather than 14: the count is the label, and a dot in front of a
              number said nothing the number did not. Tighter to the chevrons by 4px on each side. */}
          <button
            type="button"
            title="Go to this one"
            className={cn(BAR_ITEM, "px-2.5", REVIEW_QUIET, "tabular-nums")}
            onClick={() => step(at ?? 0)}
          >
            {kindIndex + 1} of {kindTotal}{" "}
            {onNew ? "New Screens" : "Comments to Review"}
          </button>
          <button
            type="button"
            aria-label="Next"
            className={cn(BAR_ITEM, REVIEW_QUIET, BAR_SQUARE)}
            onClick={() => step((at ?? 0) + 1)}
          >
            <IconRight />
          </button>
          </div>
          <span className="mx-1.5 h-5 w-px bg-white/25" />
          <button
            type="button"
            className={cn(BAR_ITEM, "px-2.5", REVIEW_QUIET)}
            onClick={() => {
              /**
               * NEW SCREENS HAVE NO PER-FRAME APPROVAL, only this.
               *
               * The owner talked himself out of one, and he is right: *"maybe for the new designs, it doesn't make
               * sense to have a single Approve button near each, because like, what if you don't click it? it
               * doesn't really make sense. And you just need the Approve all button. And you need the navigation to
               * look at all the new designs. I think that's the only real value here… because for the comments it's
               * really important you do it one by one."* A comment is a claim to answer; a new screen is only
               * something to have looked at.
               */
              if (onNew) {
                const ids = [...newScreens];
                if (ids.length === 0) return;
                setAt(null);
                void markSeen(canvas, ids).then(setSeen);
                return;
              }
              const ids = toReview.map((comment) => comment.id);
              if (ids.length === 0) return;
              setOpenPin(null);
              setAt(null);
              setRemoving(ids);
              undoTimer.current = window.setTimeout(() => {
                undoTimer.current = null;
                /* ONE REQUEST FOR THE WHOLE BATCH. This fanned out a DELETE per comment, and since each
                   one rewrites the records file they all read the same list: the last write won and every
                   other approval came back — "it keeps my old comments even after I approve all of them".
                   The next comment was then numbered as though nothing had been approved, because a pin is
                   numbered by its position in the list. */
                void deleteComments(canvas, ids).then((list) => {
                  setComments(list);
                  setRemoving(null);
                });
              }, UNDO_MS);
            }}
          >
            {/* THE SAME WORD FOR BOTH, on his instruction: *"you could use the same language which is
                approve"*. What it does differs — one marks screens seen, the other deletes answered comments —
                but from the reviewer's seat both are "I have looked at these and they are fine". */}
            Approve All
          </button>
        </div>
        </div>
      ) : null}

      {/**
       * THE UNDO WINDOW. Same place and same green as the pill it stands in for, because it is the same
       * conversation continuing: you approved several, and for a few seconds you can say you did not.
       */}
      {undoPresent ? (
        <div
          data-open={undoOpen}
          style={MOTION_STYLE}
          className={cn(
            "absolute bottom-6 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-1 rounded-full bg-[hsl(154_46%_30%)] p-1.5 shadow-[0px_4px_16px_0px_rgba(0,0,0,0.18),0px_10px_32px_0px_rgba(0,0,0,0.22)]",
            BAR_MOTION,
          )}
          data-canvas-chrome=""
          data-canvas-undo=""
        >
          {/* `undoCount` rather than `removing.length`: this element outlives `removing` by one transition so it
             can fade out, and reading a field off null is how that would crash. */}
          <span className="px-2.5 text-[0.8125rem] font-medium text-white/85">
            Approved {undoCount}
          </span>
          <button
            type="button"
            className={cn(BAR_ITEM, "px-2.5", REVIEW_QUIET)}
            onClick={() => {
              if (undoTimer.current !== null) {
                window.clearTimeout(undoTimer.current);
                undoTimer.current = null;
              }
              setRemoving(null);
            }}
          >
            Undo
          </button>
        </div>
      ) : null}
    </div>
  );
}
