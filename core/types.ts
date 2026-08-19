/**
 * design-canvas CORE — the declaration and comment types. Generic on purpose.
 *
 * BOUNDARY: nothing under `design-canvas/core/` may import from `store/`, `lib/data/`, or any app
 * component. The canvas is a viewer: it renders real routes and knows nothing about what they
 * contain. Everything project-specific lives in `design-canvas/project/`.
 *
 * To point this at another project: copy the `design-canvas/` folder and its two route stubs, then write
 * one new declaration. The declaration below is plain data an agent can produce by reading a repo's
 * routes.
 */

/** The query key a screen's pinned state travels on. The core only appends it; what it MEANS is the
 *  project adapter's business, and a project with no adapter simply never declares a state. */
export const CANVAS_STATE_PARAM = "canvas";

/**
 * WHICH DEVICE A SCREEN IS, and it is a whole level of navigation rather than a property of one frame.
 *
 * The canvas photographed desktop only. The owner asked for phones because the projects it reviews are web
 * projects: *"we could have the same for the mobile because so far I think the skill supports only desktop
 * screenshots. But it would be great to support mobile ones as well … there could be a switch between desktop
 * and mobile done as a icon tab switch or something like that before the three tabs for exploration groups and
 * user flows. And it would just like work like another level of navigation. So if you're in desktop and you're
 * looking at user flows or commenting, you're doing it for desktop only. If you're in mobile, you're doing it
 * for mobile only."*
 *
 * So the device sits ABOVE the three views: it filters the flows, the groups, the explorations and therefore the
 * comments, because a comment is left on a screen and a screen belongs to one device. Nothing about the review
 * mechanism changes — which is the point of doing it this way rather than as a second canvas.
 *
 * THE SWITCH ONLY EXISTS WHERE BOTH DO. *"some projects might be completely desktop based or completely mobile
 * based, but this one, the current one, it's a web project, so it supports both."* A declaration whose screens
 * are all one device draws no switch at all, which is every canvas built before this type existed.
 */
export type CanvasDevice = "desktop" | "phone";

/** The device a screen belongs to when it does not say. Every canvas built before devices existed is desktop. */
export const DEFAULT_DEVICE: CanvasDevice = "desktop";

/** One screen: a real route, and what it is. Adding a screen to the canvas is one entry. */
export type CanvasScreen = {
  /** Stable id, recorded on every comment. Renaming it orphans that screen's comments. */
  id: string;
  /** What it is called, above the tile. */
  label: string;
  /** One line saying what it is. Not a description of the layout — what it is FOR. */
  note: string;
  /** The real route, including any query the app itself already understands (`?preview=1`). */
  route: string;
  /**
   * A named state applied to the running app inside this frame, as `?canvas=<state>`. OPTIONAL: a
   * screen with no state renders the route exactly as it comes, which is all a project without an
   * adapter can do — and is a complete canvas on its own.
   */
  state?: string;
  /** Groups this screen in the by-kind view, where flow order is dropped. */
  kind?: string;
  /**
   * IN AN EXPLORATION: this frame SUPPORTS the direction with that id, and is drawn under it.
   *
   * One frame per direction was not enough to judge one. A direction whose whole point is a tab that is one click
   * away has to show the tab BOTH shut and open, or the reviewer is asked to imagine half of it — the owner, on
   * the first round: *"it looks like it's not enough to show one screen, right? for each option like you're not
   * providing me with enough context. like for example you're showing a menu but you not showing the tab that you
   * need to literally show me. So maybe if the exploration requires more screenshots than one, it's okay. just put
   * them under the main exploration screen."*
   *
   * So a direction is a COLUMN: its main frame on top, its supporting frames beneath, and the next direction
   * beside it. Only the main frame is numbered and only the main frame carries a verdict, because a like or a
   * dislike is about the direction and not about one of its pictures.
   *
   * Ignored outside the exploration view. A supporting frame is captured, commented on and claimed exactly like
   * any other, and its `label` should say what it adds ("the tab open"), not repeat the direction's name.
   */
  under?: string;
  /**
   * Text that MUST be present in the settled frame. The oracle for "this tile shows what its label
   * claims" — two labels resolving to the same state is the failure this catches, and a miss is a
   * build error rather than a note.
   *
   * A LIST declares several things that must ALL be there. One tile then proves everything it is
   * showing — the question it asks and the state of the store beside it — rather than a second tile of
   * the same frame existing only to carry the second claim.
   *
   * Searched in the tile's own document AND in every same-origin frame inside it. A tile is everything
   * rendered in it: the share menu draws the storefront in a frame of its own, so a claim about a
   * placeholder band is a claim about a document one level down.
   */
  expect?: string | string[];
  /**
   * Text that must NOT be present, which is the only oracle an EMPTY STATE has.
   *
   * The tiles this exists for are the ones where every positive claim is also true of the screens beside
   * them: a store on day one says the account's name, and so does a store with a full catalog. What
   * separates them is what the page does NOT say — no category strip, no collection band — and a capture
   * with no way to assert that can photograph the wrong state and pass. Same list rule as `expect`, and the
   * same reach: the tile's own document and every same-origin frame inside it.
   */
  expectMissing?: string | string[];
  /**
   * A selector that MUST resolve inside the tile — its own document or a nested one. For a state whose
   * whole difference is a picture or an attribute, where no words can prove it: a filled cover has no
   * text in it, and which beat the first-run frame is on is an attribute on the dialog.
   */
  expectSelector?: string;
  /**
   * A field this frame is supposed to show FOCUSED, as a selector. Opt-in, and rare: the capture blurs every
   * document before the shutter, because an accidental focus ring is a lie about the resting design. A flow's
   * small states include the beat where someone is typing, and that frame has nothing to show without this —
   * the owner, on one labelled "Typing their address": *"if it says that they are typing their address, it
   * actually should show that they're typing their address. It does not right now."* The focus goes back after
   * the freeze, with the caret at the end of the value; the caret stays invisible so the two proof shots still
   * match. It is asserted, so a selector that stops matching fails the capture.
   */
  focus?: string;
  /**
   * WHICH DEVICE THIS SCREEN IS. Absent means desktop, so no existing declaration changes meaning.
   *
   * The viewport comes with the device — see `CanvasDeclaration.devices` — so a phone screen does NOT need its
   * own `viewport`, and should not have one: that field is for a genuine one-off.
   */
  device?: CanvasDevice;
  /* A PHONE SCREEN'S LABEL DOES NOT SAY "PHONE". The switch above the tabs is what says which device is being
     reviewed, and every frame in the view is that device — the owner: *"in the mobile icon it's already obvious
     that they are looking at the mobile designs."* A label names the surface, exactly as its desktop twin does. */
  /**
   * THE SAME SCREEN ON THE OTHER DEVICE, by id, which is what the jump button under a frame follows.
   *
   * The owner asked for it as a shortcut rather than a second navigation: *"you know how under the screens we
   * have a button to open that screen in the real prototype on your local host. So what if we had a similar
   * button … that would be kind of like a shortcut to open the same screen if it's available, but on the other
   * device."*
   *
   * DECLARED ON EITHER SIDE, ONCE. The canvas resolves it both ways, so naming the phone from the desktop entry
   * is enough and the two can never disagree about each other. Absent is the ordinary case and draws no button:
   * *"you also need to consider that there might be no screenshots for some devices. Like, I mean, desktop might
   * have designs that mobile doesn't have. mobile might have designs that desktop doesn't have."*
   */
  twin?: string;
  /**
   * Renders this one screen at a different viewport, e.g. a phone surface among desktop ones.
   *
   * A DEVICE, NEVER PADDING, and the oracle enforces the difference. The owner's rule: *"for all the desktop
   * screens, we need a defined size … like 1440x900 if it's not a page that has more content and available
   * under the scroll, and if it does and the screenshot requires it to show more than just 900 pixels of
   * height, then it should definitely make it longer, like screenshot the whole page."*
   *
   * So height is the PAGE'S to decide: the capture photographs one viewport when the page fits inside
   * `LONG_PAGE_SLACK` of it, and the whole page when it genuinely runs past the fold. Naming a viewport here
   * that keeps the canvas's width and only raises its height is refused by `check-canvas.mjs`, because it pads
   * every frame in the group past any real window — which is how a whole group of frames sat 200px too tall
   * through two rounds of review before anyone noticed.
   */
  viewport?: CanvasViewport;
  /**
   * The files this screen is BUILT FROM, repo-relative: its route file first, then the component that owns
   * the surface. Once a frame is a picture, "where does this live" is a question the picture cannot answer,
   * and an agent asked to change what is in the frame otherwise starts by hunting for it.
   *
   * Kept to one or two paths on purpose. A long list goes stale silently; two paths are checkable, and
   * `check-canvas.mjs` asserts every one of them still exists.
   */
  source?: string[];
};

export type CanvasViewport = {
  /** The width the page is LAID OUT at, before the tile scales it down. */
  w: number;
  /** The height of the page's own viewport. Frames are viewports, never printouts. */
  h: number;
};

/**
 * One move between two screens, drawn as a real edge on the canvas.
 *
 * A FLOW IS A GRAPH, NOT A LIST. A screen can have several outgoing edges and several incoming ones,
 * and the edges that matter most are the ones that leave the happy path: a skip, a close, a store with
 * nothing in it. A row of frames with an arrow glyph between them says the journey is linear, which is
 * false about every real product, so there is no way to declare one here — the only way to say two
 * screens are connected is to name the move that connects them.
 *
 * `label` is what the person DID, quoted from the surface wherever the surface has words for it ("Next",
 * "Skip", "Set up my store"), and phrased as a condition where the move has no button ("when they own no
 * collections"). Nothing here invents product copy.
 */
export type CanvasEdge = {
  /** Screen id the move starts at. */
  from: string;
  /** Screen id it lands on. */
  to: string;
  /** The press, or the condition. Kept short: it is drawn on the edge itself. */
  label?: string;
  /**
   * `step`   the spine of the journey — solid, and usually unlabelled, because left-to-right order already
   *          says "and then this one".
   * `branch` a move that leaves the happy path — dashed, so the spine still reads at a glance.
   *
   * THERE IS NO "BACK". Returns used to be declarable and drawn as a reverse lane under the row, and they were
   * the single biggest source of clutter on the canvas for the smallest amount of information: a Back button and
   * a breadcrumb are things every developer already expects. An edge earns its place by saying something that
   * cannot be guessed from the frames themselves.
   */
  kind?: "step" | "branch";
};

/** A journey, as a directed graph: the screens in it, and every move between them. */
export type CanvasFlow = {
  id: string;
  title: string;
  note: string;
  screens: CanvasScreen[];
  /** Every move. Both ends must name a screen in THIS flow; a dangling id is reported, never drawn. */
  edges: CanvasEdge[];
  /**
   * A SET TO COMPARE, NOT A JOURNEY: drawn in the grouped view and left out of the flow view.
   *
   * The two permanent views answer different questions, and a few groups only ever answer the second one. The
   * case that produced this: one screen photographed once per third-party provider, so the marks and the names
   * could be checked against reality. In the grouped view that is exactly what the view is for; in the flow view
   * it was a row of eleven frames with no arrows, sitting beside real journeys and reading as one. The owner:
   * *"remove the section who manages in the user flow tab, because we don't need to show it. It's not the user
   * flow. We already show it in the grouped screens."*
   *
   * The screens are declared like any others and captured like any others — this only decides which view draws
   * them. A flow with this set should have no edges: there is nothing to move between.
   */
  groupedOnly?: boolean;
};

/**
 * ONE DESIGN QUESTION, AND THE ANSWERS BEING COMPARED. The third view.
 *
 * A flow says how a person moves through what exists. An exploration says what a surface could BE: several
 * genuinely different answers to one question, drawn side by side at full size so they disagree with each
 * other visibly. It is the 5-then-3-then-1 funnel, expressed as declaration rather than as a separate tool —
 * round one is an entry with five screens, round two is a second entry with three variants of whichever won.
 *
 * WHY IT LIVES HERE AT ALL, rather than in a gallery of its own. The two hard parts of judging options are
 * both already solved by this canvas and by nothing else: every frame is a REAL route of the real app rather
 * than a mockup imitating it, and the comment layer hands back the annotated picture of the exact part being
 * argued with. Owner: _"what if it could also do the visual explorations? It would be just
 * another tab in addition to user flows and grouped screens… all the feedback will basically be handled
 * through the comments mechanism that we already built."_
 *
 * THERE ARE NO EDGES. Directions are alternatives, not steps: an arrow between two of them would claim a
 * person can get from one to the other, which is false — only one of them will ever exist.
 *
 * Each screen is one direction, and its `label` is the direction's name, because that is what the reviewer
 * says out loud when choosing ("the panel one"). Two or more, or there is nothing to compare.
 *
 * THIS IS SCAFFOLDING, AND IT IS MEANT TO BE DELETED. The other two views are permanent: a project keeps
 * iterating on its flows and its grouped screens and hands them to developers. An exploration is spent the
 * moment it is decided. Owner: _"exploration is more for you… you can decide what you like the
 * most, you can iterate on it and then you can actually use it in the groups and user flows and get rid of
 * the explorations. So at some point, some screens will get deleted from there. and maybe even the whole tab
 * will get deleted."_
 *
 * Three consequences, all of them handled rather than left to be discovered:
 *
 *   - **The tab is data-driven.** No `explorations` means no third tab, which is every canvas built before
 *     this type existed. Emptying the array removes the tab, and the view falls back rather than showing a
 *     canvas with nothing on it.
 *   - **Losing a screen is routine, not damage.** `capture.mjs` already prunes the picture and the manifest
 *     entry of any screen the declaration stops naming, and the canvas ignores comments whose screen is
 *     gone, so a decided exploration can be deleted in one edit without leaving a count behind.
 *   - **The app-code half goes with it.** A direction usually needs scaffolding to be reachable at a URL, so
 *     mark it `DELETE WITH: the <question> exploration` rather than with the canvas folder — it is the one
 *     part of an install that has an earlier deletion date than the rest.
 */
export type CanvasExploration = {
  id: string;
  /**
   * WHAT THIS SCREEN IS — the panel's heading, and the first thing read.
   *
   * Name the surface, not the exercise: "The integration page while a sync is running", never "Option set A"
   * and never the question alone. A reviewer opening a canvas cold has to know what they are looking at before
   * they can have an opinion about which version of it they prefer. Owner: _"you clearly explain
   * what this thing is supposed to be… the title of the group of the section has to be really clear."_
   */
  surface: string;
  /** The question those options answer: "Where does a sync run live?" Drawn under the surface. */
  title: string;
  /** What is at stake in the choice. Not a description of the options — the frames are the options. */
  note: string;
  /**
   * WHICH ROUND THIS IS, as a number: 1, 2, 3, and so on.
   *
   * It used to be free prose — `"5 directions"`, `"Round 2, three variants of each"` — and the canvas dropped that
   * string into a sentence, which produced exactly what you would expect: _"refined. A like brings it back refined,
   * anything unliked is dropped"_. A lowercase fragment, then a full stop, then a second sentence repeating the
   * word. The owner's verdict was "very freaking stupid" and he was being generous.
   *
   * Prose cannot be composed with. A number can: the canvas owns the words for round one, round two, and round
   * three onward, so the heading is written once by the person who designed it rather than assembled at render
   * time out of whatever a declaration happened to say.
   */
  round?: number;
  /**
   * One screen per direction under comparison, IN THE ORDER THEY ARE NUMBERED.
   *
   * The canvas draws 1, 2, 3 on them from this order, because a reviewer says "number three" out loud and a
   * name they have to read off a frame is not something anyone says. Each screen's `note` is what makes it
   * DIFFERENT from its neighbours — not what it is, which the surface above already said.
   */
  screens: CanvasScreen[];
};

export type CanvasDeclaration = {
  title: string;
  note: string;
  /** The viewport every screen is judged at unless it overrides it. Also the desktop device's viewport. */
  viewport: CanvasViewport;
  /**
   * THE VIEWPORT EACH DEVICE IS PHOTOGRAPHED AT, for a declaration that has more than one.
   *
   * `desktop` falls back to `viewport` above, so a canvas that only adds phones writes one entry. A device with
   * no entry and no screens simply does not exist on this canvas.
   *
   * A phone here is a real device size (390 by 844 is an iPhone 15), and the same rule applies as everywhere
   * else: the height is what the page is photographed at when it fits, and a page that runs past the fold is
   * captured whole regardless.
   */
  devices?: Partial<Record<CanvasDevice, CanvasViewport>>;
  /**
   * How big a frame is drawn on the canvas, as a fraction of the size the page really is. 0.8 puts a
   * 1440px desktop page on the canvas at ~1150px: a page being looked at, not a thumbnail of one. The
   * frame is SCALED, never reflowed — the app still lays out at its authored width, so what is being
   * judged is the real design and not the tablet breakpoint.
   */
  frameScale: number;
  flows: CanvasFlow[];
  /**
   * WHAT THE SECTIONS ARE, AND WHAT BELONGS IN EACH ONE — so a screen added later cannot land in the wrong place.
   *
   * `CanvasScreen.kind` is a free string, which was fine while one person held the whole canvas in their head and
   * wrong the moment the canvas outgrew a context window. An error state was filed under "Domain setup" beside the
   * happy path, and the reviewer's note is the reason this field exists: *"This is an error state, so you put it in
   * the wrong section. Btw, this might be a skill problem rather than just your mistake. so investigate please.
   * it's important that even after the canvas becomes reeeeally big, you put new screens in their proper places
   * (groups or flows) or create new ones when needed, even if you start from a blank context but in the project
   * with such a canvas already set up."*
   *
   * Declaring them turns placement from a guess into a checked decision. `whatBelongs` is a sentence the next agent
   * reads before choosing, and the oracle FAILS on any screen whose `kind` is not one of these — so inventing a
   * section is possible (add it here, deliberately) and drifting into the wrong one is not.
   *
   * OPTIONAL, and a declaration without it behaves exactly as it always did: the oracle notes the kinds in use and
   * asks for them to be declared, rather than failing a canvas that predates this field.
   */
  kinds?: { id: string; whatBelongs: string }[];
  /**
   * Optional third view. A declaration with none simply has two tabs, which is every canvas built before
   * this existed.
   */
  explorations?: CanvasExploration[];
};

/**
 * SEVERAL CANVASES IN ONE PROJECT, keyed by the slug that addresses them: `/design-canvas/<slug>`.
 *
 * One project stopped being one canvas the moment a second feature wanted one. Owner: _"we
 * already have one for the storefront stuff, but we need another one for the checkout… what we could do is
 * to handle it by different URLs."_ The slug is the whole of the separation — it addresses the page, and it
 * namespaces the shots and the comments, so two canvases cannot photograph over each other's pictures or
 * mix their reviews.
 *
 * A slug is lowercase, digits and dashes: it is a URL segment and a directory name at the same time.
 */
export type CanvasRegistry = Record<string, CanvasDeclaration>;

/** Rejects anything that cannot be both a URL segment and a directory name. */
export const CANVAS_SLUG = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Every screen in a declaration, from both views, with the group it belongs to.
 *
 * WHY THIS IS A FUNCTION AND NOT A LOOP AT SIX CALL SITES. `flows.flatMap(...)` was written out wherever a
 * screen had to be found by id — the shots route's id guard, the comment record's denormalised label, the
 * oracle's duplicate-address check — and adding explorations to a declaration means every one of those
 * silently stops seeing half the canvas. A screen the route cannot find serves no picture; a screen the
 * oracle cannot find is a duplicate address nobody catches. One walk, used everywhere.
 */
/**
 * VIEW ONLY: A CANVAS THAT CAN BE DEPLOYED, because a canvas nobody but its author can open is half a tool.
 *
 * Everything this tool does is dev-only by default and for good reasons: the comment layer reads and writes real
 * files in the repository, which a serverless deployment has neither, and the canvas has no auth of its own. But
 * the frames are just pictures, and the reason they exist is to be looked at by other people — the owner, on
 * sharing one with his developers: *"it would be helpful if it did because I could then share it with my
 * developers. Otherwise, they would need to run this prototype locally to see the canvas."*
 *
 * So `NEXT_PUBLIC_CANVAS_VIEW_ONLY=1` at build time makes exactly one difference: the canvas and its picture
 * route stop 404ing in production, and the comment layer is not there. Not disabled behind a control that
 * refuses — ABSENT: no Comment button, no Hand Off, no Clear All, no drag. Writing is refused at the route as
 * well, because a client is not a permission system.
 *
 * WHAT IT DOES NOT CHANGE: the default. Without the variable a production build behaves exactly as it always
 * has, which is to pretend the tool does not exist.
 *
 * Two things the target project owes a deployment, both in its own README rather than here: the pictures have to
 * be traced into the function bundle (they live outside `public/` on purpose), and `NEXT_PUBLIC_CANVAS_PINS=1`
 * has to be set or every frame's Open button lands on an unpinned page.
 */
export const CANVAS_VIEW_ONLY =
  process.env.NEXT_PUBLIC_CANVAS_VIEW_ONLY === "1";

/** True where the tool must not exist at all: a production build that was not asked to serve a read-only canvas. */
export function canvasHidden(): boolean {
  return process.env.NODE_ENV === "production" && !CANVAS_VIEW_ONLY;
}

/**
 * PUBLISHED: this canvas is the deployed copy, so the comment layer is not here.
 *
 * `CANVAS_VIEW_ONLY` says the BUILD is allowed to serve a canvas; this says the canvas being looked at IS the
 * published one. The difference matters because a project can set the variable in its own config rather than in
 * a dashboard — which is the sane thing for a prototype whose only audience is the team, and the first project to
 * do it found the trap immediately: with the variable always on, the LOCAL canvas lost its comment layer too, and
 * with it the whole reason the tool exists. Reviewing happens in development; publishing happens in production;
 * one flag, two states, and only this one may take the comment layer away.
 */
export const CANVAS_PUBLISHED =
  process.env.NODE_ENV === "production" && CANVAS_VIEW_ONLY;

/** The viewport a screen is photographed at: its own, else its device's, else the canvas's. */
export function viewportFor(
  screen: CanvasScreen,
  declaration: CanvasDeclaration,
): CanvasViewport {
  if (screen.viewport) return screen.viewport;
  const device = screen.device ?? DEFAULT_DEVICE;
  return declaration.devices?.[device] ?? declaration.viewport;
}

/**
 * WHICH DEVICES THIS CANVAS ACTUALLY HAS, in a fixed order, derived from the screens rather than declared.
 *
 * Derived, because a `devices` map with an entry nobody uses would draw a switch to an empty canvas, and the
 * owner's rule is that the switch exists only where both do. One device means no switch.
 */
export function devicesOf(declaration: CanvasDeclaration): CanvasDevice[] {
  const seen = new Set(
    allScreens(declaration).map(({ screen }) => screen.device ?? DEFAULT_DEVICE),
  );
  return (["desktop", "phone"] as CanvasDevice[]).filter((one) => seen.has(one));
}

export function allScreens(declaration: CanvasDeclaration): Array<{
  screen: CanvasScreen;
  /** The flow or exploration it sits in. Recorded on a comment so the file reads on its own. */
  groupId: string;
  groupTitle: string;
  /**
   * WHICH VIEWS DRAW IT. A flow screen appears in both permanent views; a `groupedOnly` flow's screens appear
   * only in the grouped one; an exploration direction appears only in the third. The oracle needs the difference
   * to count frames per view, and it is served to it rather than inferred, because a count that is quietly wrong
   * is how a canvas passes every check while missing half its frames.
   */
  view: "flow" | "kinds" | "exploration";
}> {
  return [
    ...declaration.flows.flatMap((flow) =>
      flow.screens.map((screen) => ({
        screen,
        groupId: flow.id,
        groupTitle: flow.title,
        /* "flow" is drawn by BOTH permanent views; "kinds" only by the grouped one. See `groupedOnly`. */
        view: (flow.groupedOnly ? "kinds" : "flow") as "flow" | "kinds",
      })),
    ),
    ...(declaration.explorations ?? []).flatMap((exploration) =>
      exploration.screens.map((screen) => ({
        screen,
        groupId: exploration.id,
        groupTitle: exploration.title,
        view: "exploration" as const,
      })),
    ),
  ];
}

/**
 * One captured screen, as recorded by `capture.mjs`. THE MANIFEST IS THE RECEIPT: a picture on a canvas
 * cannot be interrogated the way a live page can, so everything that was true at the moment the shutter
 * opened is written down here instead, and the canvas shows it.
 */
export type CanvasShot = {
  screenId: string;
  /** The exact address that was open, pinned state included. */
  url: string;
  file: string;
  /** Pixel size of the image. `w` is the viewport the page was laid out at; `h` is the whole page when the
   *  window scrolls, and one viewport when it does not. */
  w: number;
  h: number;
  /** True when this is the whole page rather than one screen of a fixed-height surface. */
  wholePage?: boolean;
  bytes: number;
  capturedAt: string;
  /** Every claim the screen declares, and whether it was actually in the page when it was captured. */
  claims: Array<{ claim: string; met: boolean }>;
  /**
   * TWO CONSECUTIVE CAPTURES CAME OUT IDENTICAL. This is the proof that the picture is of a settled
   * design rather than of a page mid-animation or mid-load: a page that is still moving cannot produce
   * the same bytes twice. `tries` is how many attempts that took.
   */
  stable: boolean;
  tries: number;
  /** Content hash. A comment records the hash it was drawn on, so a recapture can flag it as stale. */
  hash: string;
};

export type CanvasShotManifest = {
  contract: string;
  capturedAt: string;
  viewport: CanvasViewport;
  shots: CanvasShot[];
};

/**
 * WHERE A COMMENT POINTS, on a picture: a rectangle drawn around the thing being talked about, in
 * percentages of the frame so it means the same at any zoom and any capture size.
 *
 * A selector is not available here and pretending otherwise would be worse than this. What the agent gets
 * instead is stronger for a design note: the screenshot with the outline drawn on it, so the region being
 * complained about is literally visible rather than described.
 */
export type CanvasRegion = {
  /** 0-100 from the left edge of the frame. */
  xPct: number;
  /** 0-100 from the top. */
  yPct: number;
  wPct: number;
  hPct: number;
};

/**
 * WHAT KIND OF THING A REVIEWER LEFT ON A SCREEN.
 *
 * A verdict is a comment. That is a decision, and it is the owner's: _"there is a button that appears when you
 * use comments, and it has to be the same exact functionality when you use like or dislike because it's
 * essentially the same exact idea… it's just gonna have predefined comments that are going to be saved to this
 * screenshot."_
 *
 * It is also the only shape that works, for a reason that is not obvious from the outside. The hand-off prompt
 * tells the agent: "when a comment is done, PATCH … with { id, consumed: true }". That single sentence is the
 * whole draining mechanism — it is what stops the pile being handed over twice and what makes the count go down
 * again. A verdict held in its own array would need its own parallel version of that protocol, its own consumed
 * flag, its own place in the count and its own line in the prompt, and an agent that ignored any one of those
 * would leave a canvas permanently claiming twenty-two things to send. As a comment it inherits all of it and
 * adds nothing.
 *
 * `note` is the default when the field is missing, so every comment written before this stays a comment.
 */
export type CanvasCommentKind = "note" | "like" | "dislike";

export type CanvasComment = {
  id: string;
  flowId: string;
  screenId: string;
  /**
   * Absent means `note`. Verdict kinds carry a whole-frame region and predefined words, they never draw a pin
   * (the frame's own button is their readout), and they are replaced rather than appended: one screen holds at
   * most one verdict.
   */
  kind?: CanvasCommentKind;
  /** Denormalised so the JSON file reads on its own, without the declaration beside it. */
  label: string;
  route: string;
  state: string | null;
  region: CanvasRegion;
  /** The screenshot with this comment's outline drawn on it. Repo-relative. Open it, look inside it. */
  image: string;
  note: string;
  createdAt: string;
  /**
   * An agent has READ this comment. Not the same as done: consumed stops it being read twice,
   * nothing more (visual-plan's two-axis rule).
   */
  consumedAt?: string | null;
  /** The reviewer rewrote the words from the pin. The region and the picture are untouched by an edit. */
  editedAt?: string | null;
  /**
   * Rounds of this comment that have already been answered, oldest first. Written when the reviewer looks at
   * a recaptured screen, decides it is still wrong, and dismisses it with another round of feedback: the note
   * becomes the new words and the old ones move here, so the agent can see what it already tried.
   */
  history?: Array<{ note: string; at: string }>;
  /** The shot this was drawn on. */
  shotHash?: string;
  /** That screen has been captured again since, so what is under the outline may have changed. */
  stale?: boolean;
};

/**
 * WHAT THE REVIEWER THOUGHT OF ONE OPTION — the other half of an exploration, beside the comments.
 *
 * A comment says what is wrong with a thing. A verdict says whether the thing survives, and that is a different
 * question: a direction can be liked AND carry three complaints, or be disliked with nothing wrong in it beyond
 * being the weaker idea. Keeping them apart is what lets a hand-off say "drop these two, refine that one, and
 * here is what to fix while you do it".
 *
 * Owner: _"I liked some of the options, I dislike some of the options, I left some comments and then
 * when I hand off it back to you, you kind of start the second round where you remove those that I dislike, you
 * work on the comments that I left, if I left any, and you create three more variations for any options that I
 * liked."_
 *
 * DERIVED, NEVER STORED. Verdicts live in `comments` as kinds, for the reason written on `CanvasCommentKind`.
 * This shape is only the canvas reading them back out, so that the frames and the hand-off can ask "what did the
 * reviewer say about this screen" without every caller re-filtering by kind.
 */
export type CanvasVerdict = {
  screenId: string;
  value: "like" | "dislike";
};

/** The file's shape on disk. `contract` is written for whoever opens the file cold. */
export type CanvasCommentFile = {
  contract: string;
  updatedAt: string;
  /**
   * WHICH CANVAS THIS REVIEW BELONGS TO, and it only appears in the file that predates namespaced reviews.
   *
   * A review is per canvas: `comments/<slug>.json`. An install reviewed before that was true has a flat
   * `comments.json`, and the route falls back to it so those notes are never lost. The fallback was unconditional,
   * which meant EVERY canvas in the project read that one file: a second canvas that had never been reviewed showed
   * the first one's fifteen comments, and its oracle failed on them.
   *
   * So the first write stamps the flat file with the canvas doing the writing, and from then on no other canvas
   * reads it. A write is the right moment: it means a real review is happening there, where a page load means
   * somebody opened a tab.
   */
  canvas?: string;
  comments: CanvasComment[];
  /**
   * SCREEN IDS THE REVIEWER HAS SEEN, which is the whole of the new-screen mechanism's memory.
   *
   * A screen is NEW when it is not in here. The definition is the owner's and it is deliberately narrow: *"new
   * screens are gonna be only the ones that are literally new. Like you just added it as a new screen. If you
   * updated the existing screen, it doesn't count as a new screen... the comment counts as a comment for you to
   * review, but it doesn't count as a new screen."* So the two queues are disjoint by construction, which is what
   * lets one stepper walk both without ambiguity.
   *
   * IT IS SEEDED ON FIRST SIGHT, not left empty. An empty list on an existing canvas would mean all seventy-odd
   * frames are new, which is the opposite of useful — so the canvas writes every currently declared screen into it
   * the first time it finds the key missing, and counting starts from there.
   */
  seen?: string[];
  /**
   * WHICH FILE THIS CAME OUT OF, repo-relative. Served by the route, never written into the file.
   *
   * Two layouts are live at once (see `pathsFor` in `comments-route.ts`), so the hand-off prompt cannot assume
   * one: it named the namespaced path unconditionally and sent an agent to a file that did not exist on every
   * install that predates namespacing.
   */
  file?: string;
};
