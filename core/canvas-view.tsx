"use client";

/**
 * design-canvas core: the canvas. A full-viewport surface with no app shell; the app appears only inside
 * the frames. Views: User Flows (journeys as branching diagrams), Grouped Screens (the same frames grouped by
 * kind, so similar states sit side by side), Exploration (competing directions for one open question, present
 * only while the declaration has `explorations`) and Design System.
 */

/* The one framework import: switching canvases is a client-side navigation, not a reload. */
import { useRouter } from "next/navigation";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/* Relative imports only, and the core's own `cn`: this folder must compile in a repo whose aliases, component
   library and utilities are unknown to it. */
import { CanvasEdgeLayer } from "./canvas-edges";
import { CanvasOriginLayer } from "./canvas-origins";
import { zoomStep } from "./picture-size";
import { CanvasExplain } from "./canvas-explain";
import { CanvasFrame, type NewRegionComment } from "./canvas-frame";
import {
  CanvasSurface,
  type CanvasSurfaceHandle,
  shownZoom,
  ZOOM_STEP,
} from "./canvas-surface";
import { cn } from "./cn";
import {
  BAR_ITEM,
  BAR_PAD,
  BAR_QUIET,
  BAR_SOLID,
  BAR_SQUARE,
  BAR_SURFACE,
  BAR_TAB_ON,
  DIVIDER,
  DOT,
} from "./canvas-motion";
import { copyText, HandoffButton } from "./canvas-handoff";
import { ReviewRow, UndoBar } from "./canvas-review";
import { CanvasSwitcher } from "./canvas-switcher";
import { CanvasSearch } from "./canvas-search";
import { CanvasTooltip } from "./canvas-tooltip";
import { anchorFromHash, canvasSectionAnchors } from "./anchors";
import {
  IconCheck,
  IconComment,
  IconDesktop,
  IconLink,
  IconMinus,
  IconCursorClick,
  IconPhone,
  IconPlus,
} from "./icons";
import {
  addFeedback,
  clearComments,
  deleteComment,
  deleteComments,
  editComment,
  framesOnScreen,
  loadComments,
  markReviewed,
  markViewed,
  loadRealCode,
  loadShots,
  loadSystem,
  belongsOnFrame,
  homeFrameOf,
  reopenedAfterWork,
  reportViewing,
  reviewQueueOn,
  waitingOn,
  saveComment,
  setVerdict,
  verdictsIn,
  type Waiting,
} from "./comments-client";
import {
  chromeWidth,
  type LaidOutNode,
  type Layout,
  layoutExplorations,
  layoutFlows,
  layoutKinds,
  TITLE_LINK_GAP,
  TITLE_LINK_SIZE,
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
  DEFAULT_DEVICE,
  devicesOf,
} from "./types";
import { type SearchEntry, searchEntries } from "./search";
import { handoffPrompt } from "./handoff";
import { layoutSystem, type SystemManifest } from "./system";
import { SystemWorld } from "./system-world";
import { expandVariants } from "./variants";

/** `explore` is temporary: deleted once its question is decided, so it is optional data (see `CanvasExploration`). */
type ViewMode = "flows" | "kinds" | "explore" | "system";

type Landing =
  | { to: "fit" }
  | { to: "screen"; id: string }
  | { to: "frame"; screenId: string; groupId: string }
  | { to: "group"; view: ViewMode; group: string; tried: CanvasDevice[] };

/** The tabs that draw a screen, by where it is declared (`allScreens`); the first is where a jump to it goes. */
const TABS_OF: Record<ReturnType<typeof allScreens>[number]["view"], ViewMode[]> = {
  flow: ["kinds", "flows"],
  flowOnly: ["flows"],
  kinds: ["kinds"],
  exploration: ["explore"],
  explain: [],
};

const TAB_LABEL: Record<ViewMode, string> = {
  kinds: "Grouped Screens",
  flows: "User Flows",
  explore: "Exploration",
  system: "Design System",
};

/** A group's name, in world pixels. Bigger than a frame's name and sized the same way. See canvas-frame. */
const GROUP_SIZE = 132;
/** How far a group's panel extends past the frames and labels inside it. */
const SECTION_PAD = 90;
/** The opening framing waits on this while a linked section is still being found. */
const NOWHERE = { x: 0, y: 0, w: 0, h: 0 };
/** A group's panel as drawn, which is what a link to the section fits. */
const panelOf = (box: { x: number; y: number; w: number; h: number }) => ({
  x: box.x - SECTION_PAD,
  y: box.y - SECTION_PAD,
  w: box.w + SECTION_PAD * 2,
  h: box.h + SECTION_PAD * 2,
});

/** How often the open canvas checks whether the work changed under it; nothing re-renders unless it did. */
const WATCH_MS = 4000;
/** An open canvas repeats its report at least this often, well inside the two minutes a report counts for. */
const VIEWING_BEAT_MS = 60_000;
/** How long the first report waits for the canvas to land on its opening view. */
const VIEWING_FIRST_MS = 1200;

/** How long Approve All can be taken back. Long enough to notice the pill, short enough not to linger. */
const UNDO_MS = 6000;

/** A manifest keyed by screen id. */
const byScreen = (manifest: CanvasShot[]) => Object.fromEntries(manifest.map((shot) => [shot.screenId, shot]));

/** A search result on another canvas, carried across the client-side move; the next view reads it once. */
let arriving: SearchEntry | null = null;

export function CanvasView({
  declaration: authored,
  canvas,
  canvases,
}: {
  declaration: CanvasDeclaration;
  /** Which canvas this is (`/design-canvas/<canvas>`), and the namespace its shots and comments are stored under. */
  canvas: string;
  /** Every canvas this project has, listed by the top-left switcher. None or one draws no switcher. */
  canvases?: CanvasRegistry;
}) {
  /** The declaration as drawn: one frame per variant, expanded as the capture route does (`core/variants.ts`). */
  const declaration = useMemo(() => expandVariants(authored), [authored]);
  /** Every screen the declaration draws, with its group and the views that draw it. */
  const screens = useMemo(() => allScreens(declaration), [declaration]);
  /** An open exploration opens first, since it holds the open question; otherwise grouped screens. */
  const [view, setView] = useState<ViewMode>(
    (declaration.explorations ?? []).length > 0 ? "explore" : "kinds",
  );
  /** The devices come from the declaration; the first one (desktop, where both exist) opens. */
  const devices = useMemo(() => devicesOf(declaration), [declaration]);
  const [device, setDevice] = useState<CanvasDevice>(devices[0] ?? "desktop");
  /**
   * Where the canvas goes once the layout holds it, since a tab or device switch rebuilds the layout first:
   * `fit` the whole view (a tab or device switch), a `screen`'s top at reading size (a twin jump, review stepping),
   * a `frame` fitted (a search pick, after the pictures, whose sizes move the frames), or a linked `group`'s panel
   * (tried on each device in turn, also after the pictures).
   */
  const [landing, setLanding] = useState<Landing | null>(null);
  /** The frames arrive once; `revealed` stays true, so a later switch renders them already visible. */
  const [revealed, setRevealed] = useState(false);
  const [comments, setComments] = useState<CanvasComment[]>([]);
  /** The screens waiting for the reviewer, new or changed, as the capture wrote them (`CanvasCommentFile.waiting`). */
  const [queued, setQueued] = useState<Waiting>({});
  /** The review file the hand-off names. */
  const commentsFile = `design-canvas/comments/${canvas}.json`;
  /** The shot manifest. `null` means not read yet, not empty, so frames show the skeleton. See `manifestLoaded`. */
  const [shots, setShots] = useState<Record<string, CanvasShot> | null>(null);
  /** The design system tab's pictures: null until read, and while the project has photographed none. */
  const [system, setSystem] = useState<SystemManifest | null>(null);
  const [commenting, setCommenting] = useState(false);
  /** Whether the reviewer has marked the open question decided (`settled` in handoff.ts); reset when the panel closes. */
  const [settled, setSettled] = useState(false);
  const unsettle = useCallback(() => setSettled(false), []);
  const router = useRouter();

  /** The zoom readout is written to its own text, not held as state, so a zoom gesture does not re-render every frame. */
  const zoomText = useRef<HTMLSpanElement | null>(null);
  /** The zoom rounded up to a power of two, which picks picture sizes; updated only once a zoom rests. */
  const [zoomAt, setZoomAt] = useState(() => zoomStep(0));
  const showZoom = useCallback((zoom: number, settled: boolean) => {
    if (zoomText.current) zoomText.current.textContent = `${shownZoom(zoom)}%`;
    if (settled) setZoomAt(zoomStep(zoom));
  }, []);
  /** Which pin is open, owned here so the review pill can open one from across the canvas. */
  const [openPin, setOpenPin] = useState<string | null>(null);
  /** New pictures wait while a pin is open or a comment is drawn, so the frame under review does not change. */
  const holdPictures = useRef(false);
  holdPictures.current = openPin !== null || commenting;
  /** How far through the review queue, or null when the reviewer has not started stepping. */
  const [at, setAt] = useState<number | null>(null);
  /* True after a plain Approve: `at` then points at the comment after the approved one, not at one on screen. */
  const parked = useRef(false);
  /* Each tab has its own queue, so a position taken on one tab means nothing on the next. */
  useEffect(() => {
    setAt(null);
    parked.current = false;
  }, [view]);
  /** Approve All's undo window: these comments are hidden and deleted only when it closes, so Undo stops the timer. */
  const [removing, setRemoving] = useState<string[] | null>(null);
  const undoTimer = useRef<number | null>(null);
  const surface = useRef<CanvasSurfaceHandle | null>(null);

  /* The design system is the project's, not this canvas's, and a capture of it is rare: read once per canvas. */
  useEffect(() => {
    void loadSystem(canvas).then(setSystem);
  }, [canvas]);

  /** The verdicts, read out of the comments: they are the same records, so one count, prompt and drain cover both. */
  const verdicts = useMemo(() => verdictsIn(comments), [comments]);

  /** Kept or dropped, by screen id. Only exploration frames can carry one. */
  const verdictOf = useMemo(
    () =>
      Object.fromEntries(verdicts.map((one) => [one.screenId, one.value])) as
        Record<string, "like" | "dislike" | undefined>,
    [verdicts],
  );

  /**
   * A verdict lands on the press and the write follows: it is one of two values on one screen with no other client
   * to conflict with. The server's answer wins; a failed write restores the old value and logs the error.
   */
  const onVerdict = useCallback(
    (screenId: string, value: "like" | "dislike" | null) => {
      const screen = screens.find(
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
    [canvas, screens, shots],
  );

  /** Every screen this declaration still names, from both views. */
  const declared = useMemo(
    () => new Set(screens.map((one) => one.screen.id)),
    [screens],
  );

  /** The permanent views' screens by id: what an exploration frame's switch to today resolves against. */
  const permanentById = useMemo(
    () =>
      new Map(
        declaration.flows
          .flatMap((flow) => flow.screens)
          .map((screen) => [screen.id, screen] as const),
      ),
    [declaration],
  );


  /** Whether there is an Exploration tab: data-driven, since an exploration comes and goes with its question. */
  const exploring = (declaration.explorations ?? []).length > 0;

  /** The tabs in reading order. Exploration leads while a question is open and is gone once it is decided. */
  const tabs = useMemo<ViewMode[]>(
    /* The design system comes last, and only once the project has photographed one: a tab with nothing on it is a
       promise the canvas cannot keep. */
    () => [...(exploring ? (["explore"] as const) : []), "kinds", "flows", ...(system ? (["system"] as const) : [])],
    [exploring, system],
  );

  /** A removed exploration or design system must not leave the canvas on a view that no longer exists. */
  useEffect(() => {
    if ((!exploring && view === "explore") || (!system && view === "system")) {
      setView("kinds");
      setLanding({ to: "fit" });
    }
  }, [exploring, system, view]);

  /** What can be drawn: comments whose screen is still declared and that are not inside an open undo window. */
  const visible = useMemo(
    () =>
      comments.filter(
        (comment) =>
          declared.has(comment.screenId) &&
          !(removing ?? []).includes(comment.id),
      ),
    [comments, removing, declared],
  );

  /** The explorations in real-code mode, whose decided round folds the winner into the original's files. */
  const [realCode, setRealCode] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    void loadRealCode(canvas).then((ids) => {
      if (alive) setRealCode(ids);
    });
    return () => {
      alive = false;
    };
  }, [canvas]);

  /** The Hand Off prompt, its summary and what it counts (`handoff.ts`). */
  const prompt = useMemo(
    () =>
      handoffPrompt({
        canvas,
        file: commentsFile,
        explore: view === "explore",
        settled,
        comments,
        removing,
        screens,
        realCode,
      }),
    [canvas, commentsFile, view, settled, comments, removing, screens, realCode],
  );
  const waiting = prompt.waiting;
  /**
   * What waits on this canvas, from `waitingOn`, the function the switcher uses too, so the counts agree. Every frame
   * but the explanation panels counts. Nothing waits on a published canvas: review queues are local only.
   */
  const ownFrames = useMemo(
    () =>
      screens
        .filter(({ view }) => view !== "explain")
        .map(({ screen, groupId }) => ({ screenId: screen.id, groupId })),
    [screens],
  );
  const waitingHere = useMemo(
    () =>
      CANVAS_PUBLISHED
        ? { fresh: [], changed: [], comments: 0 }
        : waitingOn({ frames: ownFrames, shots, waiting: queued, comments }),
    [ownFrames, shots, queued, comments],
  );
  const newScreens = waitingHere.fresh;
  const changedScreens = waitingHere.changed;
  const isNew = useCallback((id: string) => newScreens.includes(id), [newScreens]);
  const isChanged = useCallback((id: string) => changedScreens.includes(id), [changedScreens]);

  /** Which tabs hold new screens, for the tab dots; it reuses `newScreens`, so the dots and the queue agree. */
  const perTab = useCallback((ids: string[]) => {
    const fresh = new Set(ids);
    /* The design system tab has no queue of its own: it holds no frames, so nothing on it can be new to look at. */
    const byTab: Record<ViewMode, string[]> = { flows: [], kinds: [], explore: [], system: [] };
    for (const { screen, view: drawnIn } of screens)
      if (fresh.has(screen.id)) for (const tab of TABS_OF[drawnIn]) byTab[tab].push(screen.id);
    return byTab;
  }, [screens]);
  const unseenByTab = useMemo(() => perTab(newScreens), [perTab, newScreens]);
  /* The changed screens per tab, walked by their own queue. The tab dots stay with the new screens. */
  const changedByTab = useMemo(() => perTab(changedScreens), [perTab, changedScreens]);
  const unseenTabs = useMemo(
    () =>
      new Set<ViewMode>(
        (["flows", "kinds", "explore"] as const).filter((tab) => unseenByTab[tab].length > 0),
      ),
    [unseenByTab],
  );
  /** The queue counts and steps the current tab only. `isNew` stays global: a frame's ring shows wherever it is drawn. */
  const newHere = useMemo(() => unseenByTab[view], [unseenByTab, view]);
  const changedHere = useMemo(() => changedByTab[view], [changedByTab, view]);

  /** The other canvases and their frame counts, read from the declaration so an uncaptured canvas still has a size. */
  const siblings = useMemo(
    () =>
      Object.entries(canvases ?? {}).map(([slug, one]) => {
        /* The frames each canvas draws, variants expanded; one that cannot expand is counted as declared rather than crashing the bar. */
        const drawn = allScreens(
          (() => {
            try {
              return expandVariants(one);
            } catch {
              return one;
            }
          })(),
        );
        return {
          slug,
          title: one.title,
          section: one.section ?? null,
          frames: drawn.length,
          /* What `waitingOn` counts over: every frame but the explanation panels, which are never reviewed. */
          reviewed: drawn
            .filter(({ view }) => view !== "explain")
            .map(({ screen, groupId }) => ({ screenId: screen.id, groupId })),
        };
      }),
    [canvases],
  );
  /**
   * Pictures, comments and what waits, for this canvas and the others in the switcher, read on open, every few seconds
   * and on coming back to the tab, since a capture writes to disk (a shared component can recapture several canvases).
   * State changes only when the answer differs; new pictures wait while a pin is open, and an open undo window or a
   * pending verdict is not overwritten.
   */
  const [elsewhere, setElsewhere] = useState<Record<string, { fresh: number; changed: number; comments: number }>>({});
  const removingNow = useRef(removing);
  removingNow.current = removing;
  useEffect(() => {
    let alive = true;
    const others = CANVAS_PUBLISHED || siblings.length < 2 ? [] : siblings.filter((one) => one.slug !== canvas);
    const lookHere = async (opening: boolean) => {
      const [manifest, notes] = await Promise.all([loadShots(canvas), loadComments(canvas)]);
      if (!alive) return;
      /* Pictures are compared by content hash, which is what a recapture changes. */
      if (opening || !holdPictures.current) setShots((was) => {
        const next = byScreen(manifest);
        const signature = (of: typeof next | null) =>
          of
            ? Object.values(of)
                .map((shot) => `${shot.screenId}:${shot.hash}`)
                .sort()
                .join("|")
            : "";
        return signature(was) === signature(next) ? was : next;
      });
      setQueued((was) => (JSON.stringify(was) === JSON.stringify(notes.waiting) ? was : notes.waiting));
      /* The first visit clears what the canvas collected while it was built; a published canvas has no review to write. */
      if (opening && notes.unvisited && !CANVAS_PUBLISHED)
        void markViewed(canvas).then((left) => {
          if (alive && left) setQueued(left);
        });
      setComments((was) => {
        if (removingNow.current || was.some((one) => one.id.startsWith("pending-")))
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
    const lookElsewhere = async () => {
      if (others.length === 0) return;
      const counts = await Promise.all(
        others.map(async (one) => {
          const [manifest, notes] = await Promise.all([loadShots(one.slug), loadComments(one.slug)]);
          const found = waitingOn({ frames: one.reviewed, shots: byScreen(manifest), waiting: notes.waiting, comments: notes.comments });
          return [one.slug, { fresh: found.fresh.length, changed: found.changed.length, comments: found.comments }] as const;
        }),
      ).catch(() => null);
      if (!alive || !counts) return;
      const next = Object.fromEntries(counts);
      setElsewhere((was) => (JSON.stringify(was) === JSON.stringify(next) ? was : next));
    };
    const look = (opening = false) => {
      if (!alive || (!opening && document.visibilityState !== "visible")) return;
      void lookHere(opening);
      void lookElsewhere();
    };
    look(true);
    const timer = window.setInterval(() => look(), WATCH_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") look();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [canvas, siblings]);
  /* This canvas's own row reads its live queues. */
  const waitingIn = (slug: string) =>
    slug === canvas
      ? { fresh: waitingHere.fresh.length, changed: waitingHere.changed.length, comments: waitingHere.comments }
      : elsewhere[slug];
  const waitsElsewhere = Object.values(elsewhere).some(
    (one) => one.fresh + one.changed + one.comments > 0,
  );

  /* The layout is told what was actually captured, because a whole-page shot is several viewports tall and a
     layout that assumed one viewport would overlap everything under it. */
  const captured = useCallback(
    (id: string) => {
      const shot = shots?.[id];
      /* `origins` rides along so the flow view can draw the interaction-origin rings where the capture
         actually measured them. See `CanvasEdge.origin`. */
      return shot ? { w: shot.w, h: shot.h, origins: shot.origins } : undefined;
    },
    [shots],
  );

  /**
   * The declaration as this device sees it, which every view is laid out from. Filtering screens, groups and edges
   * here scopes the views, comment counts, review bar and hand-off to the device in one place.
   */
  const forDevice = useMemo<CanvasDeclaration>(() => {
    if (devices.length < 2) return declaration;
    /* An explanation panel narrates a step, not a device: the same beat exists on both, so it stays in
       whichever device's flow it is declared in rather than defaulting to desktop and vanishing. */
    const mine = (screen: CanvasScreen) =>
      Boolean(screen.explain) || (screen.device ?? DEFAULT_DEVICE) === device;
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

  const systemLayout = useMemo(() => layoutSystem(system), [system]);
  const layout = useMemo<Layout>(() => {
    /* The design system has no screens, so nothing that walks groups (pins, edges, the review bar) finds anything here. */
    if (view === "system") return { groups: [], box: systemLayout.box, problems: [] };
    if (view === "flows") return layoutFlows(forDevice, captured);
    if (view === "explore") return layoutExplorations(forDevice, captured);
    return layoutKinds(forDevice, captured);
  }, [view, forDevice, captured, systemLayout]);
  const nodes = useMemo(() => layout.groups.flatMap((group) => group.nodes), [layout]);

  /**
   * THIS CANVAS IS OPEN: while the tab is visible the page reports the canvas, tab, device and the frames on screen, when any of
   * that changes (looked at every few seconds, which also catches a pan) and at least once a minute; a hidden or closed tab
   * reports that it is gone. The recapture photographs what is open and on screen first (`reportViewing`). The first report
   * waits for the canvas to land, so the frames on screen are the ones the reviewer sees.
   */
  const seenNow = useRef({ view, device, nodes });
  seenNow.current = { view, device, nodes };
  useEffect(() => {
    if (CANVAS_PUBLISHED) return;
    let last = "";
    let sentAt = 0;
    const report = () => {
      if (document.visibilityState !== "visible") return;
      const now = seenNow.current;
      const transform = surface.current?.read();
      const visible = transform ? framesOnScreen(now.nodes, transform, window.innerWidth, window.innerHeight) : [];
      const key = `${now.view}|${now.device}|${visible.join(",")}`;
      if (key === last && Date.now() - sentAt < VIEWING_BEAT_MS) return;
      last = key;
      sentAt = Date.now();
      void reportViewing(canvas, { tab: now.view, device: now.device, visible });
    };
    const leave = () => {
      last = "";
      void reportViewing(canvas, null);
    };
    const first = window.setTimeout(report, VIEWING_FIRST_MS);
    const timer = window.setInterval(report, WATCH_MS);
    const onVisibility = () => (document.visibilityState === "visible" ? report() : leave());
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", leave);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", leave);
      leave();
    };
  }, [canvas]);

  /** Interaction-origin rings: off by default, and offered only when this view has a measured origin. */
  const [showOrigins, setShowOrigins] = useState(false);
  const hasOrigins = useMemo(
    () =>
      view === "flows" &&
      layout.groups.some((group) =>
        group.edges.some((edge) => edge.originBox),
      ),
    [view, layout],
  );
  const originsOn = hasOrigins && showOrigins;


  /* Every section's anchor, for the link beside each heading and for opening one (`canvasSectionAnchors`). */
  const sectionLinks = useMemo(() => canvasSectionAnchors(declaration), [declaration]);
  const anchorOfGroup = useMemo(
    () => new Map(sectionLinks.map((one) => [`${one.view}:${one.group}`, one.anchor])),
    [sectionLinks],
  );

  /** Bring one screen onto the canvas at reading size, landing on its top so its name is in view on a tall frame. */
  const goToScreen = useCallback(
    (screenId: string) => {
      const node = nodes.find((one) => one.screen.id === screenId);
      if (!node) return;
      surface.current?.centre(
        { x: node.x, y: node.y, w: node.w, h: node.h },
        1,
        "top",
      );
    },
    [nodes],
  );

  /* A section link in the address, read on open and on every hash change: it lands on that section. */
  const [hashRead, setHashRead] = useState(false);
  const linksRef = useRef(sectionLinks);
  linksRef.current = sectionLinks;
  useEffect(() => {
    const read = () => {
      const wanted = anchorFromHash(window.location.hash);
      const found = wanted
        ? linksRef.current.find((one) => one.anchor === wanted)
        : undefined;
      if (found) setLanding({ to: "group", view: found.view, group: found.group, tried: [] });
    };
    read();
    setHashRead(true);
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  const linkedGroup =
    landing?.to === "group" && landing.view === view && shots !== null
      ? layout.groups.find((one) => one.id === landing.group)
      : undefined;

  /** One landing, resolved once the layout (and for search and links, the pictures) can place it. */
  useEffect(() => {
    if (!landing) return;
    if (landing.to === "fit") {
      if (layout.box.w === 0) return;
      surface.current?.frame(layout.box);
    } else if (landing.to === "screen") {
      if (!nodes.some((one) => one.screen.id === landing.id)) return;
      goToScreen(landing.id);
    } else if (landing.to === "frame") {
      if (shots === null) return;
      const matches = nodes.filter((one) => one.screen.id === landing.screenId && !one.incumbent);
      const node = matches.find((one) => one.group.id === landing.groupId) ?? matches[0];
      if (!node) return;
      surface.current?.frame({ x: node.x, y: node.y, w: node.w, h: node.h });
    } else {
      if (shots === null) return;
      if (view !== landing.view) {
        setView(landing.view);
        return;
      }
      const group = layout.groups.find((one) => one.id === landing.group);
      if (!group) {
        const tried = [...landing.tried, device];
        const next = devices.find((one) => !tried.includes(one));
        setLanding(next ? { ...landing, tried } : null);
        if (next) setDevice(next);
        return;
      }
      surface.current?.frame(panelOf(group.box));
    }
    setLanding(null);
  }, [landing, layout, nodes, shots, view, device, devices, goToScreen]);

  /**
   * Where the canvas opens: the whole layout fitted, as on a tab switch (`frame` never magnifies, so a small canvas
   * still lands close in). A link to one section opens on that section instead.
   */
  const opening =
    !hashRead || (landing?.to === "group" && !linkedGroup)
      ? NOWHERE
      : linkedGroup
        ? panelOf(linkedGroup.box)
        : layout.box;
  /** A tab or device switch fits the whole view: each is laid out on its own, so the old placement points at nothing. */
  const switchView = useCallback(
    (next: ViewMode) => {
      if (next === view) return;
      setView(next);
      setLanding({ to: "fit" });
    },
    [view],
  );
  const switchDevice = useCallback(
    (next: CanvasDevice) => {
      if (next === device) return;
      setDevice(next);
      setLanding({ to: "fit" });
    },
    [device],
  );

  /** The section link just pressed: copied, or shown in the tooltip when the clipboard refused it. */
  const [linked, setLinked] = useState<{
    anchor: string;
    url: string;
    copied: boolean;
  } | null>(null);
  const copyLink = useCallback(async (anchor: string) => {
    const { origin, pathname, search } = window.location;
    const url = `${origin}${pathname}${search}#${anchor}`;
    const copied = await copyText(url);
    setLinked({ anchor, url, copied });
    window.setTimeout(
      () => setLinked((was) => (was?.anchor === anchor ? null : was)),
      copied ? 1800 : 8000,
    );
  }, []);

  /**
   * Pin numbers count the visible notes, so "number 6" means one thing everywhere and a pin in an open undo window
   * is gone. Verdicts are not pins: they cover the whole frame and show as the circle on the frame's caption.
   */
  const numbered = useMemo(
    () =>
      visible
        .filter((comment) => !comment.kind || comment.kind === "note")
        .map((comment, index) => ({ comment, n: index + 1, reopened: reopenedAfterWork(comment) })),
    [visible],
  );

  /* A frame gets the pins whose home it is: a screen drawn in several groups carries a comment on the frame of the
     group it was drawn in, or on the first frame with its screen when that group is not on this tab. See `homeFrameOf`. */
  const frames = useMemo(
    () =>
      layout.groups.flatMap((group) =>
        group.nodes.map((node) => ({ screenId: node.screen.id, groupId: node.group.id })),
      ),
    [layout],
  );
  const pinsFor = useCallback(
    (screenId: string, groupId: string) =>
      numbered.filter((pin) =>
        belongsOnFrame(pin.comment, { screenId, groupId }, frames),
      ),
    [numbered, frames],
  );

  /**
   * What the reviewer owes an answer on, for this tab: notes the agent has consumed and the reviewer has not closed,
   * recaptured or not (`stale` only says the picture moved under the outline). Verdicts never count.
   */
  const toReview = useMemo(() => reviewQueueOn(visible, frames), [visible, frames]);
  /* The bar is present when anything waits; `queue` itself is built further down, where both sets exist. */
  const queueLength = newHere.length + changedHere.length + toReview.length;
  /** Which kind the reviewer is standing on, which decides the bar's color and its verb. */
  const onKind: "new" | "changed" | "comments" =
    (at ?? 0) < newHere.length
      ? "new"
      : (at ?? 0) < newHere.length + changedHere.length
        ? "changed"
        : "comments";
  /* Where each kind starts in the one queue, and how many it holds. */
  const kindStart = { new: 0, changed: newHere.length, comments: newHere.length + changedHere.length };
  const kindCount = { new: newHere.length, changed: changedHere.length, comments: toReview.length };
  /** Position and total are taken inside the kind the label names, though the stepper walks one queue across kinds. */
  const kindTotal = kindCount[onKind];
  const kindIndex = (at ?? 0) - kindStart[onKind];

  /* The frame knows its region and its picture; the declaration knows which flow it belongs to and what
     address it was captured at. Both go into the record, so the JSON file reads on its own. */
  const onSave = useCallback(
    async (comment: NewRegionComment) => {
      /* Both views, so a comment on an exploration direction records its question the same way a comment in a
         journey records its flow. */
      /* The frame says which group it was drawn in; the screen alone is ambiguous when it sits in several. */
      const everywhere = screens.filter(
        (one) => one.screen.id === comment.screenId,
      );
      const found =
        everywhere.find((one) => one.groupId === comment.groupId) ??
        everywhere[0];
      const { groupId: drawnIn, ...record } = comment;
      setComments(
        await saveComment(canvas, {
          ...record,
          flowId: found?.groupId ?? drawnIn ?? "",
          label: found?.screen.label ?? comment.screenId,
          route: shots?.[comment.screenId]?.url ?? found?.screen.route ?? "",
          state: found?.screen.state ?? null,
        }),
      );
    },
    [screens, shots, canvas],
  );

  /**
   * Put one comment's outline in the middle of the screen and open its pin. Centering the region rather than the
   * frame keeps the note in view on a tall frame; the padding leaves room for the note under it.
   */
  const focus = useCallback(
    (comment: CanvasComment) => {
      /* The frame the comment was drawn on, when its group is recorded; else the first that shows the screen. */
      const home = homeFrameOf(
        comment,
        nodes.map((one) => ({ screenId: one.screen.id, groupId: one.group.id, node: one })),
      );
      const node = home?.node;
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
    [nodes],
  );

  /**
   * Delete, and if it was awaiting review go to the next one, unless `stay` keeps the view where it is. The index is
   * clamped rather than advanced: the list shrank under it.
   */
  const onDelete = useCallback(
    async (id: string, stay = false) => {
      /** `toReview` is the list the bar counts, so the position lands in the index space the stepper walks. */
      const before = toReview;
      const wasAwaiting = before.some((comment) => comment.id === id);
      /** Where the approved one stood, so the next one shown is the one after it, whether or not the reviewer was stepping. */
      const stood = before.findIndex((comment) => comment.id === id);
      const list = await deleteComment(canvas, id);
      setComments(list);
      if (!wasAwaiting) return;
      const remaining = before.filter((comment) => comment.id !== id);
      if (remaining.length === 0) {
        setAt(null);
        setOpenPin(null);
        return;
      }
      const index = Math.min(
        stood >= 0 ? stood : Math.max((at ?? 0) - newHere.length - changedHere.length, 0),
        remaining.length - 1,
      );
      setAt(newHere.length + changedHere.length + index);
      /* Plain Approve leaves the view where it is. The index already names the next comment, so the bar's Next
         arrow goes to that one rather than past it. */
      if (stay) {
        parked.current = true;
        return;
      }
      focus(remaining[index]);
    },
    /* `canvas` is listed so a switched canvas never deletes from the one this callback was created with. */
    [canvas, toReview, newHere, changedHere, at, focus],
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
    async (id: string, note: string, image: string, shotHash: string) => {
      setComments(await addFeedback(canvas, id, note, image, shotHash));
    },
    [canvas],
  );

  /** The same screen on the other device. `twin` is declared on either side, so the map is read both ways. */
  const twinOf = useMemo(() => {
    const all = screens.map(({ screen }) => screen);
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
  }, [screens]);

  /**
   * One queue of what waits: new screens first (an unseen design outranks a fix already read), then changed screens,
   * then comments. The bar's color and verb say which kind is current.
   */
  const queue = useMemo<
    Array<
      | { kind: "new" | "changed"; screenId: string }
      | { kind: "comment"; comment: CanvasComment }
    >
  >(
    () => [
      ...newHere.map((screenId) => ({ kind: "new" as const, screenId })),
      ...changedHere.map((screenId) => ({ kind: "changed" as const, screenId })),
      ...toReview.map((comment) => ({ kind: "comment" as const, comment })),
    ],
    [newHere, changedHere, toReview],
  );

  /**
   * Stepping to a new frame crosses device and view, then lands on the frame like the device jump; a comment
   * is stepped to inside what is on screen.
   */
  const goToNew = useCallback(
    (screenId: string) => {
      const found = screens.find(
        ({ screen }) => screen.id === screenId,
      );
      if (!found) return;
      const itsDevice = found.screen.device ?? DEFAULT_DEVICE;
      if (itsDevice !== device) setDevice(itsDevice);
      /* The tab in view when it draws the screen, else the first tab that does. */
      const itsView = TABS_OF[found.view].includes(view) ? view : (TABS_OF[found.view][0] ?? "kinds");
      if (itsView !== view) setView(itsView);
      setLanding({ to: "screen", id: screenId });
    },
    [screens, device, view],
  );

  /** Every frame of every canvas in the project, for the search in the toolbar. */
  const searchable = useMemo(
    () => searchEntries(canvases ?? { [canvas]: authored }),
    [canvases, canvas, authored],
  );

  /** A search result: its canvas first, then its device and tab, then the frame itself, fitted. */
  const land = useCallback(
    (hit: SearchEntry) => {
      if (hit.canvas !== canvas) {
        arriving = hit;
        router.push(`/design-canvas/${hit.canvas}`);
        return;
      }
      if (hit.device !== device) setDevice(hit.device);
      if (hit.view !== view) setView(hit.view);
      setLanding({ to: "frame", screenId: hit.screenId, groupId: hit.groupId });
    },
    [canvas, device, view, router],
  );

  useEffect(() => {
    if (arriving?.canvas !== canvas) return;
    const hit = arriving;
    arriving = null;
    land(hit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas]);

  const step = useCallback(
    (to: number) => {
      if (queue.length === 0) return;
      parked.current = false;
      const next = (to + queue.length) % queue.length;
      setAt(next);
      const item = queue[next];
      if (item.kind === "comment") focus(item.comment);
      else goToNew(item.screenId);
    },
    [queue, focus, goToNew],
  );

  /**
   * Review only: the handle `check-canvas.mjs` drives the canvas with, since an infinite canvas has no scroll
   * position to set. Delete with the design-canvas/ folder.
   */
  useEffect(() => {
    const api = {
      goTo: goToScreen,
      fit: () => surface.current?.frame(layout.box),
      zoomBy: (factor: number) => surface.current?.zoomBy(factor),
      setView: switchView,
      /* Which view is actually rendered, so the oracle asks rather than waits and guesses. */
      view: () => view,
      /** Lets the oracle assert every device without clicking the toolbar, and reports which devices exist. */
      setDevice: switchDevice,
      devices: () => devices,
      setCommenting,
      /* Open one comment's box, so the oracle can assert what is drawn under the pin (the answer). */
      openPin: (id: string | null) => setOpenPin(id),
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
  }, [goToScreen, layout, view, devices, switchView, switchDevice]);

  /** Comment mode on `c`; Escape leaves it. */
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

  /** Options per panel: verdicts choose between options, so a panel of one gets no verdict buttons. */
  const optionsInPanel = useMemo(() => {
    const count = new Map<string, number>();
    for (const group of layout.groups)
      for (const node of group.nodes)
        /* Directions, not frames: supporting pictures and the incumbent reference do not count. */
        if (!node.supporting && !node.incumbent)
          count.set(node.group.id, (count.get(node.group.id) ?? 0) + 1);
    return count;
  }, [layout]);

  const frameFor = (node: LaidOutNode) =>
    node.explain ? (
      /* A text panel, not a picture: no shot, no Open, no pins, no verdicts. See canvas-explain.tsx. */
      <div
        key={`${node.group.id}-${node.screen.id}`}
        className="absolute"
        style={{ left: node.x, top: node.y }}
      >
        <CanvasExplain screen={node.screen} />
      </div>
    ) : (
    <div
      key={`${node.group.id}-${node.screen.id}`}
      className="absolute"
      style={{ left: node.x, top: node.y }}
    >
      <CanvasFrame
        canvas={canvas}
        screen={node.screen}
        groupId={node.group.id}
        shot={shots?.[node.screen.id] ?? null}
        manifestLoaded={shots !== null}
        scale={declaration.frameScale}
        pins={pinsFor(node.screen.id, node.group.id)}
        revealed={revealed}
        isNew={isNew(node.screen.id)}
        isChanged={isChanged(node.screen.id)}
        zoomStep={zoomAt}
        /* The flow's own reading order: a column at a time, left to right, and nothing later than 240ms. */
        entranceDelay={Math.min(node.rank * 60, 240)}
        /* Wider than the picture for a phone, so nothing under the frame has to shrink — see `chromeWidth`. */
        chromeW={chromeWidth(node.screen, forDevice, captured)}
        /** The jump to the twin on the other device: it switches device and lands on the twin once laid out. */
        onTwin={(() => {
          const other = twinOf.get(node.screen.id);
          if (!other || devices.length < 2) return null;
          const otherDevice = other.device ?? DEFAULT_DEVICE;
          if (otherDevice === device) return null;
          return {
            device: otherDevice,
            go: () => {
              setDevice(otherDevice);
              setLanding({ to: "screen", id: other.id });
            },
          };
        })()}
        /* Today's screen for an exploration option's switch (`node.today`); none draws no switch. */
        today={(() => {
          const screen = view === "explore" && !node.incumbent && node.today ? permanentById.get(node.today) : undefined;
          return screen ? { screen, shot: shots?.[screen.id] ?? null } : undefined;
        })()}
        /* Notes, not verdicts: the next pin's number has to match the numbering above. */
        nextNumber={numbered.length + 1}
        /* Titles in the grouped view and the exploration, where the title is the direction's name; in a flow the
           arrows explain what happened. */
        showTitle={view !== "flows"}
        /* Numbering and verdicts exist only in the exploration, and never on the incumbent, which is the reference
           the options depart from rather than a candidate. */
        explore={view === "explore" ? { option: node.option, incumbent: node.incumbent, suggestion: node.suggestion } : undefined}
        verdict={node.incumbent ? null : (verdictOf[node.screen.id] ?? null)}
        onVerdict={
          view === "explore" &&
          !node.supporting &&
          !node.incumbent &&
          node.option !== undefined &&
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

  /** Approve All: new and changed screens are marked reviewed; worked comments go after an undo window. */
  const approveAll = () => {
    /** New and changed screens have no per-frame approval: they are something to look at, not a claim to answer. */
    if (onKind !== "comments") {
      const ids = onKind === "new" ? [...newHere] : [...changedHere];
      if (ids.length === 0) return;
      setAt(null);
      void markReviewed(canvas, ids).then(setQueued);
      return;
    }
    const ids = toReview.map((comment) => comment.id);
    if (ids.length === 0) return;
    setOpenPin(null);
    setAt(null);
    setRemoving(ids);
    undoTimer.current = window.setTimeout(() => {
      undoTimer.current = null;
      /* One request for the whole batch: parallel deletes would each rewrite the file from the same list. */
      void deleteComments(canvas, ids).then((list) => {
        setComments(list);
        setRemoving(null);
      });
    }, UNDO_MS);
  };

  return (
    /**
     * The font is named here rather than inherited, like the literal colors, so the canvas looks the same in every
     * project. `--canvas-font` lets a project use the font it already loads, since same-named fonts can differ in metrics.
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
        onZoom={showZoom}
        locked={commenting}
        /* Placed means pointing somewhere worth looking at, which is when the frames may start arriving. */
        onPlaced={() => setRevealed(true)}
      >
        {view === "system" ? <SystemWorld layout={systemLayout} canvas={canvas} /> : null}
        {/* Every section first, so the panels paint under the edges and the frames rather than over them. */}
        
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
        {layout.groups.map((group) => {
          const anchor = anchorOfGroup.get(`${view}:${group.id}`);
          const linkedHere = anchor !== undefined && linked?.anchor === anchor;
          return (
            <Fragment key={group.id}>
              <h2
                className="absolute flex items-center whitespace-nowrap font-semibold tracking-[-0.025em] text-white"
                style={{
                  left: group.box.x,
                  top: group.box.y,
                  fontSize: GROUP_SIZE,
                  lineHeight: 1.05,
                }}
                data-canvas-group={group.id}
              >
                {group.title}
                {/* The section's link: copies this page's address with the section's anchor, which opens the canvas
                    fitted to this panel. Like the verdict buttons, only the glyph at rest; the circle shows on hover. */}
                {anchor ? (
                  <CanvasTooltip
                    compact
                    mark={0}
                    className="shrink-0"
                    label={
                      <button
                        type="button"
                        aria-label="Copy link"
                        onClick={() => void copyLink(anchor)}
                        className="inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full text-white/40 transition-colors duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-white/[0.12] hover:text-white"
                        style={{
                          marginLeft: TITLE_LINK_GAP,
                          height: TITLE_LINK_SIZE,
                          width: TITLE_LINK_SIZE,
                        }}
                        data-canvas-section-link={anchor}
                      >
                        {linkedHere && linked.copied ? (
                          <IconCheck size={TITLE_LINK_SIZE / 2} />
                        ) : (
                          <IconLink size={TITLE_LINK_SIZE / 2} />
                        )}
                      </button>
                    }
                  >
                    {linkedHere ? (linked.copied ? "Link copied" : linked.url) : "Copy link"}
                  </CanvasTooltip>
                ) : null}
              </h2>
              {group.nodes.map(frameFor)}
            </Fragment>
          );
        })}
        {/* The edges come after the frames in the DOM, so they draw above them where the two meet. */}
        <CanvasEdgeLayer groups={layout.groups} showOrigins={originsOn} />
        {/* Above everything, or a highlight around a control would paint under the picture it marks. */}
        {originsOn ? <CanvasOriginLayer groups={layout.groups} /> : null}
      </CanvasSurface>

      {/** The canvas switcher, top left; absent on a one-canvas project. */}
      {siblings.length > 1 ? (
        <CanvasSwitcher
          title={declaration.title}
          canvas={canvas}
          siblings={siblings}
          waitingIn={waitingIn}
          waitsElsewhere={waitsElsewhere}
        />
      ) : null}

      {/* The toolbar: one surface, one row of 32px controls, zones split by hairlines; the shadow lifts it. */}
      <div
        className={cn("absolute left-1/2 top-5 z-[60] flex -translate-x-1/2 items-center gap-1", BAR_SURFACE)}
        data-canvas-chrome=""
        data-canvas-toolbar=""
      >
        {/** The device switch, before the views since it is a level above them; absent on a one-device canvas. */}
        {devices.length > 1 && view !== "system" ? (
          <>
            {devices.map((one) => (
              <button
                key={one}
                type="button"
                aria-pressed={device === one}
                aria-label={one === "phone" ? "Phone screens" : "Desktop screens"}
                title={one === "phone" ? "Phone screens" : "Desktop screens"}
                onClick={() => switchDevice(one)}
                className={cn(
                  BAR_ITEM,
                  BAR_SQUARE,
                  device === one ? BAR_TAB_ON : BAR_QUIET,
                )}
                data-canvas-device={one}
              >
                {/* The phone glyph is tall and narrow, so it is drawn slightly bigger to read the same size as the monitor. */}
                {one === "phone" ? <IconPhone size={17} /> : <IconDesktop size={15} />}
              </button>
            ))}
            {DIVIDER}
          </>
        ) : null}

        {tabs.map((mode) => (
          <button
            key={mode}
            type="button"
            aria-pressed={view === mode}
            onClick={() => switchView(mode)}
            className={cn(
              BAR_ITEM,
              BAR_PAD,
              "relative",
              view === mode ? BAR_TAB_ON : BAR_QUIET,
            )}
          >
            {TAB_LABEL[mode]}
            {/* The corner dot: something on this tab is still new. It stays while you are on the tab and goes once
                everything on it is approved. */}
            {unseenTabs.has(mode) ? (
              <span
                aria-label="Something new to look at"
                className={DOT}
              />
            ) : null}
          </button>
        ))}

        {/** The press-highlights toggle, with the User Flows tab when a measured origin exists; orange like its highlights. */}
        {hasOrigins ? (
          <button
            type="button"
            aria-pressed={showOrigins}
            aria-label="Show press highlights"
            title="Show where each press happens"
            onClick={() => setShowOrigins((was) => !was)}
            className={cn(
              BAR_ITEM,
              BAR_SQUARE,
              showOrigins
                ? "bg-[hsl(28_95%_55%/0.18)] text-[hsl(28_95%_60%)]"
                : BAR_QUIET,
            )}
            data-canvas-origins-toggle=""
          >
            <IconCursorClick />
          </button>
        ) : null}



        {/** The comment layer from here on: absent when published (read-only) and on the design system tab. */}
        {CANVAS_PUBLISHED || view === "system" ? null : DIVIDER}

        {CANVAS_PUBLISHED || view === "system" ? null : (
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
              commenting ? BAR_SOLID : BAR_QUIET,
            )}
          >
            <IconComment />
            Comment
          </button>
        )}

        {/** Hand Off counts only what the agent has not read; answered comments wait in the review bar. */}
        {waiting.length > 0 && !CANVAS_PUBLISHED ? (
          <HandoffButton
            prompt={prompt}
            explore={view === "explore"}
            settled={settled}
            onSettle={() => setSettled((on) => !on)}
            onDismiss={unsettle}
            total={comments.length}
            onClearAll={() => void clearComments(canvas).then(setComments)}
          />
        ) : null}
      </div>

      {/** The zoom, in its own flush bar at the top right, apart from the row of one-off choices. */}
      <div
        className={cn("absolute right-6 top-6 z-[60] flex items-center", BAR_SURFACE)}
        data-canvas-chrome=""
        data-canvas-zoombar=""
      >
        {/* Search sits with zoom: both move the view, and this corner stays on screen and on top at phone width. */}
        <CanvasSearch
          entries={searchable}
          canvas={canvas}
          view={view}
          onPick={land}
          buttonClassName={cn(BAR_ITEM, BAR_SQUARE, BAR_QUIET)}
        />
        {DIVIDER}
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
          title="Fit everything"
          className={cn(BAR_ITEM, "px-2", BAR_QUIET, "tabular-nums")}
          onClick={() => surface.current?.frame(layout.box)}
        >
          <span ref={zoomText}>{`${shownZoom(0.3)}%`}</span>
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

      {/** The review row: the count, an arrow on each side and Approve All; a comment's verdict is given in its pin. */}
      <ReviewRow
        /* Absent when published (Approve All there would do nothing), and while the undo bar stands in its place. */
        show={queueLength > 0 && !CANVAS_PUBLISHED && removing === null}
        onKind={onKind}
        kindCount={kindCount}
        kindIndex={kindIndex}
        kindTotal={kindTotal}
        onSwitch={(kind) => step(kindStart[kind])}
        onPrev={() => step((at ?? 0) - 1)}
        onCurrent={() => step(at ?? 0)}
        onNext={() => step(parked.current ? (at ?? 0) : (at ?? 0) + 1)}
        onApproveAll={approveAll}
      />

      {/** The undo window, in the review row's place. */}
      <UndoBar
        removing={removing}
        onUndo={() => {
  if (undoTimer.current !== null) {
    window.clearTimeout(undoTimer.current);
    undoTimer.current = null;
  }
  setRemoving(null);
}}
      />
    </div>
  );
}
