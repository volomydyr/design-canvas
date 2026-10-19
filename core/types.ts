/**
 * design-canvas core: the declaration and comment types. Generic on purpose.
 *
 * Nothing under `design-canvas/core/` may import from the app's own folders (its state, its data layer) or any app
 * component. The canvas is a viewer: it renders real routes and knows nothing about what they contain. Everything
 * project-specific lives in `design-canvas/project/`.
 *
 * To point this at another project: copy the `design-canvas/` folder and its two route stubs, then write one new
 * declaration. The declaration below is plain data an agent can produce by reading a repo's routes.
 */

/** The query key a screen's pinned state travels on. The core only appends it; what it means is the
 *  project adapter's business, and a project with no adapter simply never declares a state. */
export const CANVAS_STATE_PARAM = "canvas";

/**
 * Which device a screen is. The device is a level of navigation, not a property of one frame.
 *
 * It is an icon switch before the three tabs and sits above the views: it filters the flows, the groups, the
 * explorations and therefore the comments, because a comment is left on a screen and a screen belongs to one device.
 * The review mechanism is the same on both devices, which is why this is a switch and not a second canvas.
 *
 * The switch exists only where both devices do: a declaration whose screens are all one device draws no switch.
 */
export type CanvasDevice = "desktop" | "phone";

/** The device a screen belongs to when it does not say. */
export const DEFAULT_DEVICE: CanvasDevice = "desktop";

/** A box on a picture, as fractions of it (0 to 1), so it survives any size the picture is drawn at. */
export type CanvasBox = { x: number; y: number; w: number; h: number };

/**
 * One real screenshot of another system, backing the frame it hangs beside. See `CanvasScreen.evidence`.
 *
 * The file lives in `design-canvas/evidence/<slug>/`, beside the shots, and is served by the shots route; it is cropped
 * to what matters before it lands there, so the tile on the canvas is readable at a glance.
 */
export type CanvasEvidence = {
  /** The file name inside `design-canvas/evidence/<slug>/`. A name, never a path. */
  file: string;
  /** Its pixel size, so the canvas can lay the tiles out before any of them has loaded. */
  w: number;
  h: number;
  /** Who it is: the system, e.g. "Acme". The one word drawn on the tile. */
  name: string;
  /** Exactly where it comes from (a manual page, a video and its time). Shown only once it is opened large. */
  source?: string;
  /** What it shows, in a sentence. Shown only once it is opened large, so the canvas itself stays pictures. */
  caption?: string;
  /** The part that matters, outlined on the picture. */
  marks?: CanvasBox[];
};

/** One screen: a real route, and what it is. Adding a screen to the canvas is one entry. */
export type CanvasScreen = {
  /** Stable id, recorded on every comment. Renaming it orphans that screen's comments. */
  id: string;
  /** What it is called, above the tile. */
  label: string;
  /** One line saying what it is. Not a description of the layout: what it is for. */
  note: string;
  /**
   * The real route, including any query the app itself already understands (`?preview=1`).
   *
   * Required on every real screen. Only an explanation frame (`explain` set) may omit it: there is nothing to open or
   * photograph, and a placeholder route would break the rule that no two screens share an address. The oracle fails a
   * screen that has neither `route` nor `explain`.
   */
  route?: string;
  /**
   * A named state applied to the running app inside this frame, as `?canvas=<state>`. Optional: a screen with no state
   * renders the route exactly as it comes, which is all a project without an adapter can do, and is a complete canvas
   * on its own.
   */
  state?: string;
  /** Groups this screen in the by-kind view, where flow order is dropped. */
  kind?: string;
  /**
   * This screen's `kind` may stand alone. Off by default, because a lone kind is usually a screen that belonged in an
   * existing section, and the oracle should catch that.
   *
   * Only the author can tell the two apart: the oracle fails a section of one screen that could join an existing
   * section, while a section of one with no such neighbor (say, the only organization settings screen) is legitimate.
   * The declaration says so here, and a solo group stays a failure everywhere it was not claimed.
   */
  soloKind?: boolean;
  /**
   * Drawn in the user flows only, and left out of the grouped screens.
   *
   * A journey has states a user rarely meets: nothing named yet, an organization that already has an avatar, the second
   * half of an error. They belong in the flow, where the reader follows a path and a branch is the point. They do not
   * belong in the grouped screens, where every frame is a peer of the others and a dozen near-identical edge cases side
   * by side stop being comparable: the main designs go in the grouped screens, the edge cases in the flows.
   *
   * The per-screen mirror of `groupedOnly` on a flow: one flow usually holds both the main path and its edge cases, so
   * the choice is made per screen.
   */
  flowOnly?: boolean;
  /**
   * An explanation frame: this node is a text panel in the user flows, not a picture of a screen.
   *
   * A flow does not end at this product's edge: a sign-in happens on an identity provider's page this repo does not own, a step
   * happens on a phone, a document arrives by email. A flow that silently skips those beats reads as a product that
   * skips a step. This field explains the step, in the words a reviewer needs to follow the arrow through it.
   *
   * The rules, all enforced by the oracle:
   * - Flows only. It never appears in the grouped screens and never in an exploration.
   * - Never captured. No route, no shot, no Open button, no claims: the capture skips it entirely.
   * - Never a mimic. It draws as a dashed, tinted panel that cannot be mistaken for a product screen, because a
   *   faithful-looking stand-in for a page this product does not own is not allowed.
   * - Edges into and out of it follow the normal edge-label rules. It is a real node on the path.
   *
   * `label` is its title (the step's name); this field is the body. Set `explain` and omit `route`.
   */
  explain?: string;
  /**
   * Which kind of non-photographed step an explanation frame is. Each kind has its own chrome, so a reader can tell
   * them apart at a glance:
   *
   * - `"outside"` (the default): a third party's surface, such as an identity provider's sign-in page or an OS print dialog. Its design
   *   is not ours to draw or to change. Dashed neutral ring, "Outside this app".
   * - `"product"`: part of this product's flow, but not capturable from this repo: a page in another repository, a
   *   transactional email, the mobile app. Dashed tinted ring, "In this product, not capturable from here".
   * - `"canvas:<slug>"`: a boundary node, where the step continues in another canvas of this same project. Solid tinted
   *   ring, "Continues in the … canvas", and a live "Open canvas" link when that canvas is served. The flow names where
   *   the journey carries on, without duplicating the other canvas's screens or presenting the step as external.
   *
   * Only read when `explain` is set. An unknown value renders as `"outside"` rather than crashing.
   */
  explainKind?: string;
  /**
   * In an exploration: this frame is a later step of the option with that id. An option's screens (the option itself,
   * then everything `under` it, in declared order) are its flow.
   *
   * One frame is often not enough to judge an option: a direction whose point is a tab one click away has to show the
   * tab both shut and open, and an option built on progressive disclosure is a journey of screens, sometimes 5-10+.
   *
   * When every option is one screen, the panel is one horizontal row; when any option has steps, each option becomes a
   * row of its screens in step order, and the rows stack. Only the option's first frame is numbered and carries a
   * verdict, because a like or a dislike is about the option and not about one of its steps.
   *
   * Ignored outside the exploration view. A step frame is captured, commented on and claimed exactly like any other,
   * and its `label` should name the step ("Choose the reason", "the tab open"), not repeat the option's name.
   */
  under?: string;
  /**
   * A suggestion for another frame of the same panel: the id of the frame it proposes to change.
   *
   * The panel's Today frame (`original`) counts as one of its frames here: a reference or a suggestion under it sits at
   * the top of the panel, before every option.
   *
   * Drawn directly under that frame, in the same column, never as an option of its own (no number, no verdict), and
   * tinted yellow with a yellow edge, so a proposal never reads as the design that was shown; the originals stay black
   * and white. No arrow joins the two: the column says the relation. Suggestions sit beside the frames they change,
   * never in separate sections or boards. Several suggestions for one frame stack downward in declared order. A
   * suggestion draws none of the chrome under a frame (no switch to today, no Wireframe pill, no file badges). A
   * suggestion that is several screens is one row: its later screens carry `under: "<first suggestion's id>"` and run
   * to its right, grouped rather than stacked. Ignored outside the exploration view.
   */
  suggests?: string;
  /**
   * The real screens behind this frame: other systems' screenshots, drawn beside it (to its right, under its sticky
   * note), each named after the system it comes from and outlined on the part that matters; a press opens one large
   * with where it comes from. Allowed on any exploration frame, a demoed one included: evidence that a shown design is
   * right belongs beside it too. Never tinted, never commented on.
   */
  evidence?: CanvasEvidence[];
  /**
   * With `suggests`: this frame hangs where a suggestion would, but it is reference, not a proposal: today's structure
   * or another system's, drawn to compare the suggestions against. So it takes no yellow tint and no "Suggestion:"
   * name: the tint marks proposals, and a diagram of what exists today is an original.
   */
  reference?: boolean;
  /**
   * A sticky note beside the frame: a few words, in neutral language, saying why. A note, not a paragraph, because a
   * text-heavy board does not get read. The copy check caps it like a fragment.
   */
  sticky?: string;
  /**
   * Highlights drawn on the frame: boxes around exactly what changed, each with a word or two. Positions are fractions
   * of the frame (0 to 1), so they survive a recapture at the same size.
   */
  marks?: (CanvasBox & { label?: string })[];
  /**
   * Which highlight the sticky note is about, as an index into `marks`: a line runs from the note to that box. Absent
   * when the note is about the frame as a whole.
   */
  stickyOn?: number;
  /**
   * Text that must be present in the settled frame: the oracle for "this tile shows what its label claims". Two labels
   * resolving to the same state is the failure this catches, and a miss is a build error rather than a note.
   *
   * A list declares several things that must all be there, so one tile proves everything it shows instead of a second
   * tile of the same frame existing only to carry the second claim.
   *
   * Searched in the tile's own document and in every same-origin frame inside it, because a tile is everything rendered
   * in it: a share menu can draw its preview in a frame of its own.
   */
  expect?: string | string[];
  /**
   * Text that must not be present, which is the only oracle an empty state has.
   *
   * It exists for tiles where every positive claim is also true of the screens beside them: an empty trip list and a
   * full one both show the page's title. What separates them is what the page does not say, and a capture with no way
   * to assert that can photograph the wrong state and pass. Same list rule as `expect`, and the same reach: the tile's
   * own document and every same-origin frame inside it.
   */
  expectMissing?: string | string[];
  /**
   * A selector that must resolve inside the tile, in its own document or a nested one. For a state whose whole
   * difference is a picture or an attribute, where no words can prove it: a filled cover has no text in it, and which
   * beat a first-run dialog is on is an attribute on the dialog.
   */
  expectSelector?: string;
  /**
   * Images on this screen never load because the app itself is broken there, and the canvas documents that bug rather
   * than hiding it. The capture normally refuses a shot with an image that has no natural size, because a headless page
   * that never scrolled photographs lazy screens with holes in them; this flag accepts the shot with its broken images
   * showing. It is a flag, not a count, because how many broken images sit in the viewport moves with scroll and row
   * heights. A flagged screen where every image loads fails: the bug is fixed, and this declaration is out of date.
   */
  brokenImages?: boolean;
  /**
   * This page is genuinely this empty. The capture calls a shot under its blank-page byte floor a failure, because a
   * white screenshot usually means the page never arrived. A few real states are sparser than the floor (a public route
   * waiting for its ticket is one grey line on white), and this flag says the near-blank picture is the design. The
   * claims still have to pass, so a page that truly failed to arrive still fails.
   */
  sparse?: boolean;
  /**
   * This surface never settles, by design or by content: a pulsing loading skeleton, a table row whose video plays. The
   * capture normally demands two consecutive identical shots as proof the page is settled and not mid-load; on a
   * perpetually moving surface that proof cannot exist. This flag accepts a single shot as one instant of a moving
   * surface. The claims, the blank floor and the image checks still apply, so a page that failed to arrive still fails.
   */
  animated?: boolean;
  /**
   * This page's inner scroller is the design, so photograph one viewport and stop.
   *
   * The capture normally grows the window to open an inner scroller, because on a surface with a side panel or a long
   * form the content continues below the fold and a one-viewport frame would hide the design. On a data table that
   * inverts: the table's scroller is sized to the viewport, its rows are reached by scrolling inside the frame's Open
   * destination, and its pagination says how many more there are, so growing the window turns one screen into a
   * printout of every row. Around one viewport's height is the right picture of a list.
   *
   * A flag rather than a heuristic, because measuring cannot tell a table's scroller from a form's (both are a bounded
   * box with content past its edge); the declaration knows which surface it points at.
   *
   * It does not change the viewport, so `check-canvas.mjs` still refuses a padded height-only override; it only
   * declines the growth. Claims, the blank floor, image checks and stability are unchanged.
   */
  oneViewport?: boolean;
  /**
   * Preserved history: this state no longer exists in the app, and the picture on file is the last true photograph of
   * it (a settings page before its account connected, an agreement before it was accepted). Any recapture would replace
   * it with today's page, so the capture skips a frozen screen in every mode (the default changed-only run, --all and --only) and says so,
   * the oracle stops suggesting a recapture for it, and the live Open-destination check skips it, because a frozen
   * frame's Open lands on today's page by definition. A frozen screen with no picture yet captures once, then freezes.
   */
  frozen?: boolean;
  /**
   * A field this frame is supposed to show focused, as a selector. Opt-in, and rare: the capture blurs every document
   * before the shutter, because an accidental focus ring misrepresents the resting design. A frame labelled "Typing
   * their address" has to show the field being typed in. The focus goes back after the freeze, with the caret at the
   * end of the value; the caret stays invisible so the two proof shots still match. It is asserted, so a selector that
   * stops matching fails the capture.
   */
  focus?: string;
  /**
   * Which device this screen is. Absent means desktop.
   *
   * The viewport comes with the device (see `CanvasDeclaration.devices`), so a phone screen does not need its own
   * `viewport`, and should not have one: that field is for a genuine one-off. A phone screen's label does not say
   * "phone": the switch above the tabs says which device is being reviewed, so a label names the surface exactly as its
   * desktop twin does.
   */
  device?: CanvasDevice;
  /**
   * The same screen on the other device, by id: the jump button under a frame follows it, as a shortcut beside Open
   * rather than a second navigation.
   *
   * Declared on either side, once. The canvas resolves it both ways, so naming the phone from the desktop entry is
   * enough and the two can never disagree. Absent is the ordinary case and draws no button: either device can have
   * designs the other does not.
   */
  twin?: string;
  /**
   * Renders this one screen at a different viewport, e.g. a phone surface among desktop ones.
   *
   * A device, never padding, and the oracle enforces the difference. Height is the page's to decide: the capture
   * photographs one viewport when the page fits inside `LONG_PAGE_SLACK` of it, and the whole page when it runs past
   * the fold. A viewport here that keeps the canvas's width and only raises its height is refused by
   * `check-canvas.mjs`, because it pads every frame in the group past any real window.
   */
  viewport?: CanvasViewport;
  /**
   * The files this screen is built from, repo-relative: its route file first, then the component that owns the surface.
   * A picture cannot answer "where does this live", so an agent asked to change what is in the frame starts here
   * instead of hunting for it.
   *
   * One or two paths only: a long list goes stale silently, while two paths are checkable, and `check-canvas.mjs`
   * asserts every one of them still exists.
   */
  source?: string[];
  /**
   * A lo-fi wireframe, before there is code. The address of a plain HTML file served outside the app (absolute, or a
   * path joined onto the canvas's `wireframeBase`), photographed like any screen and drawn as an option on the
   * exploration tab. It has no `route` (nothing in the app answers it), no Open button (there is no page to go back
   * to), no `source` badges (no component is behind it), and the oracle skips its live pass and its source rule; its
   * claims are still proved against the served HTML, and the picture is stamped with the HTML's own hash so an edited
   * wireframe recaptures itself.
   *
   * Use it when a redesign has many structural decisions at once: very low fidelity, black and white, rectangular,
   * where only the copy, structure, layout and hierarchy matter. Wireframes live as HTML prototypes, not in the app's
   * code, with today's screen as `original` and several structures drawn as wireframes beside it.
   */
  wireframe?: string;
  /**
   * The screen this frame redesigns, in today's app, or `null`, meaning nothing like it exists today.
   *
   * Every exploration frame carries a switch that flips it, in place, to that screen: the picture becomes today's shot
   * at the frame's size, the caption reads "Today: …", and a second press brings the option back. The screen shown has
   * to be the same state as the option (an empty trip list flips to today's empty trip list, a settings dialog to
   * today's settings dialog), so there is no default: a frame that does not say what it redesigns is refused by the
   * layout, the preflight and the oracle.
   *
   * The id must be a screen the permanent views declare. `null` is the one honest alternative: the frame then draws no
   * switch, and every preflight lists it. The capture remembers a link in the manifest, and a frame that had one and then declares `null`
   * or nothing is refused (`todaySwitchProblems` in tool/preflight-rules.mjs). So every state an option is drawn in has
   * to exist in today's app as a captured screen, reachable by URL or as a still.
   */
  redesigns?: string | null;
  /**
   * This `wireframe` URL is a still of the real app, not a drawing: a page holding one screenshot, taken by driving the
   * running app by hand or by script into a state no URL reaches (a dialog three clicks deep, a filtered list, a scan
   * result). It is what a `redesigns` points at when today's state has no route of its own. The frame's pill then says
   * "Still" instead of "Wireframe", and nothing else changes: no Open (no URL lands there), claims proved against the
   * served page, recaptured when the file changes. Old code needs screenshots to compare against, not pins.
   */
  still?: boolean;
  /**
   * Where a still's Open button goes: the full URL of a running app that shows this state, when one exists somewhere
   * other than the app this canvas captures (another branch's dev server, for one). With it, the still draws Open like
   * a live frame does; without it, a still has no Open. Not re-proved by the oracle: that app is not the one the claims
   * are written against, and the picture is the record.
   */
  opens?: string;
  /**
   * A short list of things to do to the page before the shutter, so a state that only exists after a click needs no pin
   * and no seam in the app.
   *
   * A dialog opened by local state, a menu, a tab, a filled field: a person reaches all of it by pressing things, and
   * none of it by a URL. A `?canvas=<state>` pin for it would put a review-only flag in production code, which is pure
   * waste for old code photographed only to be compared with a redesign. Instead a screen says what a person would do,
   * in order:
   *
   *   steps: [
   *     { click: "Export" },                               // a control by its accessible name (role: button by default)
   *     { fill: "Guests", with: "12" },                    // a field by its label, placeholder or name
   *     { press: "Enter" },                                // a key
   *     { waitText: "Export Trips" },                      // until this text is on the open surface
   *     { closeWelcome: "Got it" },                        // a first-run dialog, only if it is showing
   *     { hover: "Add Photo" },                            // the pointer over a control, left there
   *     { scroll: "css=[data-testid=trip-tabs]" },         // a part of the page brought to the top of what scrolls
   *     { waitFor: "css=[data-testid=trip-list]" },        // until an element is showing (30 seconds, `seconds` up to 300)
   *   ]
   *
   * A target is a name or a selector: `click`, `fill`, `hover`, `scroll`, `waitFor` and `press.on` take the accessible
   * name or `css=<selector>` (Playwright's CSS, so `:has-text()` works), and `nth: -1` is the last match. A large app's
   * controls are mostly found by a test id, which an accessible name cannot reach.
   *
   * The capture and the oracle's Open pass run the same steps through one module (`tool/steps.mjs`), so the picture and
   * the page it claims to be of cannot disagree about what was pressed. An unknown step type throws, in the capture,
   * the oracle and the preflight alike, because a step that does nothing photographs the resting page while claiming a
   * dialog. A step that cannot be done (nothing there, two there, the text never came) is final: the capture names it,
   * lists it apart as a stale declaration, and never runs it again.
   *
   * The Open button under the frame still lands on the route, because nothing in the app knows what was pressed, so a
   * step frame's `note` should say the presses. Steps belong to screens whose state is local to the page; a state the
   * app already reaches by URL stays a pin. A frame whose `opens` names a link that lands in the state says so itself.
   */
  steps?: CanvasStep[];
  /**
   * What the page's data does while the picture is taken: rules for the app's GraphQL requests, so a state that exists
   * only while data is late, refused or empty needs no seam in the app and no hand-driven shooter.
   *
   *   network: [
   *     { hold: "TripList" },                                  // never answered: the page stays in its loading state
   *     { fail: "TripPhotos" },                                // answered with a GraphQL error: the failed state, with its Retry
   *     { answer: "TripPhotos", data: { tripPhotos: { items: [], total: 0 } } },   // an empty list, said by the capture
   *     { answer: "TripArchive", data: null, errors: [{ message: "refused" }] },   // a save the server refused
   *   ]
   *
   * An operation is named the way the app sends it (the request's `operationName`, or the name after `query` or
   * `mutation` in its document), exact and case sensitive. The rules go on the frame's own page, never on the browser,
   * so one frame's held request cannot reach another frame and the capture's second pass starts clean. A rule the page
   * never triggers fails the frame, because a hold that matches nothing would photograph live data under a Loading
   * label with nothing else saying so. A canvas-wide list (`CanvasDeclaration.network`) applies to every frame and
   * proves nothing; a screen's rule for the same operation replaces it.
   *
   * The capture, the oracle's Open pass and the preflight's live pass run the same rules through one module
   * (`tool/network.mjs`), so a loading frame's claims are re-proved on a page that is loading. Rules are part of a
   * picture's identity: a loading, an empty and a failed list share their route and are three pictures. The Open button
   * lands on the route (or on `opens`), where the real data answers, so its hover text says that the picture holds
   * back, fails or answers some of the data. `writes` belongs to the canvas and is refused here.
   */
  network?: CanvasScreenNetworkRule[];
  /**
   * Variants of one component, declared once: a list of names (`["chips", "tabs", "menu"]`) or a count (`4`, meaning 1
   * to 4). The declaration expands, in place, into one real screen per variant, each the same `route` with
   * `?variant=<name>` added (the component's own route reads the parameter, which is the only work the app owes), with
   * the id `<id>-<name>` and the label `<label> <Name>`. Everything else is inherited, so each variant is captured,
   * stamped, claimed, commented on and opened like any screen, and the frames sit together in the group the declaration
   * was in: an exploration's panel, a flow, a section. See `core/variants.ts` for the rules, and what it refuses.
   *
   * `{variant}` inside `expect`, `expectMissing` and `expectSelector` becomes each frame's own variant name, so one
   * declaration proves every frame shows its variant. A variants screen draws no arrows (alternatives are not steps):
   * an edge names one frame, `<id>-<name>`, or none.
   */
  variants?: string[] | number;
  /** Set by the expansion, never declared: the id of the variants screen this frame came from. */
  variantOf?: string;
  /** Set by the expansion, never declared: this frame's variant name, the value `?variant=` carries. */
  variant?: string;
};

/**
 * One thing done to the page before the shutter. Exactly one of the keys below; an object with none of them, or with a
 * key this type does not name, is refused with its position in the list. See `CanvasScreen.steps`.
 */
export type CanvasStep =
  | {
      /** The control's accessible name, exact, or `css=<selector>`. A link, tab, menu item, checkbox or radio is found too unless `role` narrows it. */
      click: string;
      /** The ARIA role to look for. Absent means any of button, link, tab, menuitem, option, checkbox, radio, switch. Not with `css=`. */
      role?: string;
      /** A CSS selector to look inside, e.g. `[role=dialog]`. */
      within?: string;
      /** Which match when several controls share the name, counted from 0, or -1 for the last. Absent, several matches is an error. */
      nth?: number;
    }
  | {
      /** The field, by its label, placeholder or accessible name. */
      fill: string;
      /** What to put in it. */
      with: string;
      role?: string;
      within?: string;
    }
  | {
      /** A key, in Playwright's names: "Enter", "Escape", "Tab", "ArrowDown". */
      press: string;
      /** A field to focus first, by the same names `fill` takes. */
      on?: string;
    }
  | {
      /** Text that must be on the open surface (the dialog stack, else the page) before the next step. */
      waitText: string;
    }
  | {
      /**
       * A first-run or promo dialog: `true` performs the click steps in `design-canvas/dismiss.json`, a string names
       * the button to press. Either way it is skipped without a word when nothing is showing, because a welcome
       * dialog is a condition of the browser's storage and not of the design.
       */
      closeWelcome: true | string;
    }
  | {
      /** The control the pointer goes over and stays on, by accessible name or `css=<selector>`: a hover state, a tooltip's trigger. */
      hover: string;
      role?: string;
      within?: string;
      nth?: number;
    }
  | {
      /** What to bring to the top of whatever scrolls around it, by accessible name or `css=<selector>`. */
      scroll: string;
      /** The target is the scroller: set it to this many pixels from its own top instead. */
      to?: number;
      role?: string;
      within?: string;
      nth?: number;
    }
  | {
      /** An element that must be showing before the next step, by accessible name or `css=<selector>`. */
      waitFor: string;
      /** How long to wait for it, a whole number up to 300. Absent means 30. A dev server's first compile may need more. */
      seconds?: number;
      role?: string;
      within?: string;
    };

/**
 * A screen's steps in words, for the hover text of its Open button: the button lands on the route, because nothing in
 * the app knows what was pressed, so a frame whose state is reached by pressing says how. No full stop, like every hint
 * here.
 */
export function stepsInWords(steps: CanvasStep[] | undefined): string {
  return (steps ?? [])
    .map((step) => {
      if ("click" in step) return `press ${step.click}`;
      if ("fill" in step) return `type "${step.with}" in ${step.fill}`;
      if ("press" in step) return `press ${step.press}${step.on ? ` in ${step.on}` : ""}`;
      if ("waitText" in step) return `wait for "${step.waitText}"`;
      if ("hover" in step) return `point at ${step.hover}`;
      if ("scroll" in step) return `scroll to ${step.scroll}`;
      if ("waitFor" in step) return `wait for ${step.waitFor}`;
      return step.closeWelcome === true ? "close the welcome dialog" : `close ${step.closeWelcome} if it shows`;
    })
    .join(", then ");
}

/**
 * One rule of `network`: what the capture does to one of the page's GraphQL requests. Exactly one of the keys `hold`,
 * `fail`, `answer` or `writes`; an object with none of them, or with a key it does not take, is refused with its
 * position in the list. See `CanvasScreen.network`, and `tool/network.mjs` for how a request is matched.
 */
export type CanvasNetworkRule =
  | {
      /** The operation to hold back for ever: the page stays in its loading state. */
      hold: string;
    }
  | {
      /** The operation to answer with a GraphQL error: the page shows its failed state. */
      fail: string;
      /** The error text the app may print. Absent, a neutral sentence of the capture's own. */
      message?: string;
    }
  | {
      /** The operation to answer with the capture's own response, a read or a write: an empty list, a record, a refusal. */
      answer: string;
      /** What the server returns under `data`, or `null`. Needs this or `errors`. */
      data?: unknown;
      /** The `errors` of the response, a refusal as the server words it: `[{ message: "refused", extensions: { code: 403 } }]`. */
      errors?: Array<Record<string, unknown>>;
    }
  | {
      /**
       * Canvas level only (`CanvasDeclaration.network`): every mutation no rule handles is aborted before it leaves the
       * browser, and every aborted save is logged. A capture that cannot save cannot change the account it is
       * photographing.
       */
      writes: "abort";
    };

/** The rules a screen may carry: everything but `writes`, which belongs to the canvas. */
export type CanvasScreenNetworkRule = Exclude<CanvasNetworkRule, { writes: "abort" }>;

/** What the Open button's hover text says about a frame whose data the capture holds, fails or answers. No full stop, like every hint here. */
export const NETWORK_HINT = "The picture holds back, fails or answers some of the page's data";

/**
 * The address a screen is captured at: its route, plus the state flag when it pins one.
 *
 * NULL FOR AN EXPLANATION FRAME, which has no route on purpose — a missing route once composed into
 * a url ending in `undefined`, so absence is explicit here rather than discovered downstream.
 */
export function screenUrl(
  route: string | undefined,
  state?: string,
): string | null {
  if (!route) return null;
  if (!state) return route;
  const separator = route.includes("?") ? "&" : "?";
  return `${route}${separator}${CANVAS_STATE_PARAM}=${encodeURIComponent(state)}`;
}

/**
 * Where a frame's Open button goes: the declared `opens`, else the address the picture was taken at, else the address the
 * capture would use. The last one carries the pinned state, so a frame not captured yet still opens on its state.
 */
export function openAddress(
  screen: Pick<CanvasScreen, "opens" | "route" | "state">,
  address?: string,
): string | undefined {
  return screen.opens ?? address ?? screenUrl(screen.route, screen.state) ?? undefined;
}

/**
 * The hover text of a frame's Open button, as one pure function so the viewer and its test read the same words.
 *
 * It says where the button goes, and then what the reviewer would not otherwise know. Where the frame declares `opens`,
 * the link already lands in the state the picture shows (the app replays the presses itself), so the steps are left
 * out. Without `opens` the button lands on the route and the steps are how to get to the state. A frame whose data is
 * held, failed or answered by the capture says that its picture is not what the page shows when the real data comes
 * back. No full stop at the end, like every hint here.
 */
export function openHint(
  screen: Pick<CanvasScreen, "opens" | "route" | "state" | "steps" | "network">,
  address?: string,
): string {
  const where = openAddress(screen, address);
  const pressed = !screen.opens && screen.steps?.length ? `, then ${stepsInWords(screen.steps)}` : "";
  const data = (screen.network ?? []).length > 0 ? `. ${NETWORK_HINT}` : "";
  return `Open ${where} in a new tab${pressed}${data}`;
}

export type CanvasViewport = {
  /** The width the page is laid out at, before the tile scales it down. */
  w: number;
  /** The height of the page's own viewport. Frames are viewports, never printouts. */
  h: number;
};

/**
 * One move between two screens, drawn as a real edge on the canvas.
 *
 * A flow is a graph, not a list. A screen can have several outgoing edges and several incoming ones, and the edges that
 * matter most leave the happy path: a skip, a close, an empty trip list. A row of frames with arrows between them says
 * the journey is linear, which is false about every real product, so the only way to say two screens are connected is
 * to name the move that connects them.
 *
 * `label` is what the person did, quoted from the surface wherever the surface has words for it ("Next", "Skip", "Add
 * Photo"), and phrased as a condition where the move has no button ("when they have no trips"). Nothing here invents
 * product copy.
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
   * There is no "back" kind: a Back button and a breadcrumb are things every developer already expects, and drawn
   * returns clutter the canvas for little information. An edge earns its place by saying something that cannot be
   * guessed from the frames themselves.
   */
  kind?: "step" | "branch";
  /**
   * Where on the source screen the move starts: the control the person pressed, named by its exact visible text ("Add
   * Photo") or, prefixed `css=`, by a selector for a control with no text of its own.
   *
   * Measured at capture time: the capture resolves it on the live page into a rectangle and writes the rectangle into
   * the manifest, and a spec that resolves to nothing or to more than one place fails the capture the way a missed
   * claim does, so a region cannot drift away from the control it points at. The flows view draws the measured regions
   * behind a toggle that is off by default (several ringed regions per frame overload a simple flow), numbered to pair
   * each region with its edge. Only edges whose move is a press on something visible take one; conditions ("When the
   * upload finishes") have no origin, and edges out of explanation frames cannot take one.
   */
  origin?: string;
  /**
   * Why a press edge has no origin, when it genuinely cannot have one. The oracle requires every action edge to carry
   * `origin` or this field, so a grey press edge is deliberate rather than a gap in the orange coverage. The valid
   * reasons: the control lives behind a closed menu, the picture shows the same text twice, the edge leaves an
   * explanation card with no picture, or the source frame is frozen history the capture never re-measures. One short
   * sentence naming which.
   */
  noOrigin?: string;
};

/** A journey, as a directed graph: the screens in it, and every move between them. */
export type CanvasFlow = {
  id: string;
  title: string;
  note: string;
  screens: CanvasScreen[];
  /** Every move. Both ends must name a screen in this flow; a dangling id is reported, never drawn. */
  edges: CanvasEdge[];
  /**
   * A set to compare, not a journey: drawn in the grouped view and left out of the flow view.
   *
   * Some groups only answer the grouped view's question, such as one screen photographed once per third-party provider
   * so the marks and the names can be checked against reality. In the flow view such a row of frames with no arrows,
   * beside real journeys, reads as one. A group that is not a user flow belongs only in the grouped screens.
   *
   * The screens are declared and captured like any others; this only decides which view draws them. A flow with this
   * set should have no edges: there is nothing to move between.
   */
  groupedOnly?: boolean;
};

/**
 * One design question, and the answers being compared. The third view.
 *
 * A flow says how a person moves through what exists. An exploration says what a surface could be: several genuinely
 * different answers to one question, drawn side by side at full size so they disagree with each other visibly. Rounds
 * are expressed as declaration rather than as a separate tool. Five, then three, then one is the default shape when the
 * reviewer gives no direction (five options, then three variants of each liked one, then one refined design); the
 * reviewer's words and verdicts override it, and rounds are unlimited. A panel can also hold references, notes and
 * screenshots (`reference`, `sticky`, `evidence`), which are never options.
 *
 * It lives on this canvas because the two hard parts of judging options are already solved here: every frame is a real
 * route of the real app rather than a mockup imitating it, and the comment layer hands back the annotated picture of
 * the exact part being argued with. So explorations are one more tab beside the user flows and the grouped screens, and
 * their feedback goes through the same comment mechanism.
 *
 * There are no edges. Directions are alternatives, not steps: an arrow between two of them would claim a person can get
 * from one to the other, and only one of them will ever exist.
 *
 * Each screen is one direction, and its `label` is the direction's name, because that is what the reviewer says out
 * loud when choosing ("the panel one"). Two or more, or there is nothing to compare.
 *
 * An exploration is scaffolding, meant to be deleted. The other two views are permanent: a project keeps iterating on
 * its flows and its grouped screens and hands them to developers. An exploration is spent the moment it is decided: the
 * chosen direction moves into the groups and flows, its screens are deleted, and in time the whole tab can go. So:
 *
 *   - **The tab is data-driven.** No `explorations` means no third tab. Emptying the array removes the tab, and the
 *     view falls back rather than showing a canvas with nothing on it.
 *   - **Losing a screen is routine, not damage.** `capture.mjs` prunes the picture and the manifest entry of any
 *     screen the declaration stops naming, and the canvas ignores comments whose screen is gone, so a decided
 *     exploration can be deleted in one edit without leaving a count behind.
 *   - **The app-code half goes with it.** A direction usually needs scaffolding to be reachable at a URL, so mark it
 *     `DELETE WITH: the <question> exploration` rather than with the canvas folder: it is the one part of an install
 *     that is deleted earlier than the rest.
 */
export type CanvasExploration = {
  id: string;
  /**
   * What this screen is: the panel's heading, and the first thing read.
   *
   * Name the surface, not the exercise: "The trip list while a photo upload is running", never "Option set A" and never
   * the question alone. A reviewer opening a canvas cold has to know what they are looking at before they can prefer
   * one version of it.
   */
  surface: string;
  /** The question those options answer: "Where does an upload's progress live?" Drawn under the surface. */
  title: string;
  /** What is at stake in the choice. Not a description of the options — the frames are the options. */
  note: string;
  /**
   * Which round this is: a number (1, 2, 3, and so on), or `"refined"` for the last round, one liked option refined
   * against the comments, a panel of one or of that option's own steps.
   *
   * A number, and no words are built from it: the tab has no round heading (it holds more kinds of work than rounds;
   * see SKILL.md, "No heading on the tab"). The round logic still reads it.
   */
  round?: number | "refined";
  /**
   * The rows are pages, not options. A panel that walks several pages of one area (a page per row, its surfaces running
   * beside it under `under`) is not a choice between them, so its rows carry no number and no verdict buttons, the same
   * as a suggestion. A deep dive into one area draws every page of a group in one panel.
   */
  pages?: boolean;
  /**
   * The screen being redesigned: the id of a screen this declaration already draws in its permanent views.
   *
   * Every option's switch shows today's same state (`CanvasScreen.redesigns`), so the panel draws this screen as a frame
   * of its own, marked "Today", unnumbered and with no verdict buttons, only when something hangs under it (`suggests`);
   * it then sits at the top, before every option. It is a reference, never one of the options. The switches and the
   * oracle read it, so it stays required.
   *
   * A reference, never a second declaration: the frame reuses the screen's existing shot, so nothing is captured twice
   * and the duplicate-address rule stays intact. `check-canvas.mjs` fails an exploration without one, and fails one
   * naming an id the flows do not declare.
   */
  original?: string;
  /**
   * Whether the options are built over real code, normally left out: the preflight decides from the files `original`
   * reaches (data calls, mutations, server actions, route handlers, stores, permission checks mean `"real-code"`, none of
   * them `"simple"`) and says which in one line. Set it only when the reviewer says otherwise.
   *
   * In `"real-code"` mode each option is a UI-only file over the original's hooks, handlers and data (the preflight refuses
   * one that makes data calls of its own), the chosen one is folded into the original's files, and `tool/parity.mjs` fails
   * the round when anything those files did at the exploration's first capture is gone.
   */
  mode?: "real-code" | "simple";
  /**
   * The options under comparison, in the order they are numbered, plus, after any option, the later steps of its flow,
   * each marked `under: "<option-id>"` (see `CanvasScreen.under`). An option is one screen when one is enough and a
   * whole journey when its design demands one.
   *
   * The canvas draws 1, 2, 3 on the options from this order, because a reviewer says "number three" out loud, not a
   * name read off a frame. Each option's `note` is what makes it different from its neighbors, not what it is, which
   * the surface above already said.
   */
  screens: CanvasScreen[];
};

export type CanvasDeclaration = {
  title: string;
  note: string;
  /**
   * The part of the product this canvas belongs to, named the way the product's own navigation names it ("Trips",
   * "Settings"). The index page groups canvases under these headings, in the order the declaration first names each
   * one, so a project with many canvases reads like its own menu. Optional: canvases without one are listed first,
   * ungrouped.
   */
  section?: string;
  /** The viewport every screen is judged at unless it overrides it. Also the desktop device's viewport. */
  viewport: CanvasViewport;
  /**
   * The viewport each device is photographed at, for a declaration that has more than one.
   *
   * `desktop` falls back to `viewport` above, so a canvas that only adds phones writes one entry. A device with no
   * entry and no screens does not exist on this canvas.
   *
   * A phone here is a real device size (390 by 844 is an iPhone 15), and the same rule applies as everywhere else: the
   * height is what the page is photographed at when it fits, and a page that runs past the fold is captured whole.
   */
  devices?: Partial<Record<CanvasDevice, CanvasViewport>>;
  /**
   * How big a frame is drawn on the canvas, as a fraction of the size the page really is. 0.8 puts a 1440px desktop
   * page on the canvas at ~1150px: a page being looked at, not a thumbnail of one. The frame is scaled, never reflowed:
   * the app still lays out at its authored width, so what is judged is the real design and not the tablet breakpoint.
   */
  frameScale: number;
  flows: CanvasFlow[];
  /**
   * What the sections are, and what belongs in each one, so a screen added later cannot land in the wrong place.
   *
   * `CanvasScreen.kind` is a free string, so without this a new screen's section is a guess, and on a large canvas an
   * error state ends up filed beside the happy path. Declared, placement is a checked decision: `whatBelongs` is a
   * sentence the next agent reads before choosing, and the oracle fails any screen whose `kind` is not one of these. A
   * new section is possible (add it here, deliberately); drifting into the wrong one is not.
   *
   * Optional: without it the oracle notes the kinds in use and asks for them to be declared, rather than failing.
   */
  kinds?: { id: string; whatBelongs: string }[];
  /**
   * Text that must appear on no captured frame of this canvas: the tripwire for surfaces that cover pages.
   *
   * A real app brings back its first-run and promo overlays in the capture browser, because their dismissals live in
   * localStorage and localStorage is per origin: the capture origin has never dismissed anything. Per-screen claims
   * cannot catch them, because the page's own text is still in the DOM under the overlay, so every claim passes while
   * every picture is wrong. Listing the overlay's text here ("Welcome to…", a promo's "Don't show this again") fails
   * every polluted frame at capture time.
   *
   * Checked with the same reach as `expect`: the frame's own document and every same-origin frame inside it.
   */
  forbid?: string[];
  /**
   * What the capture does to the page's data on every frame of this canvas: the same rules as `CanvasScreen.network`,
   * plus the one that only a canvas may declare.
   *
   *   network: [{ writes: "abort" }]
   *
   * `writes: "abort"` aborts every mutation no rule handles before it leaves the browser, and logs each aborted save
   * under its frame (a note on the run and a field on the shot), so no capture can change the account it is
   * photographing, even by accident: a press in a frame's steps can reach a Save. Leaving it out allows saves, which a
   * project with a throwaway database may want. Any other rule here applies to every frame whose page asks for the
   * operation, proves nothing, and is replaced by a screen's own rule for the same operation. Both the capture and the
   * oracle's Open pass read it.
   */
  network?: CanvasNetworkRule[];
  /**
   * Where this canvas's lo-fi wireframes are served, e.g. `http://localhost:3070`. A screen's relative
   * `wireframe` path is joined onto it; an absolute one ignores it. Kept on the canvas rather than on every
   * screen so moving the static server changes one line. See `CanvasScreen.wireframe`.
   */
  wireframeBase?: string;
  /**
   * Optional third view. A declaration with none has two tabs.
   */
  explorations?: CanvasExploration[];
  /**
   * Where a removed frame's comments go, by frame id: `{ "x-option-2": "ov-trips" }`.
   *
   * A comment is pinned to a frame, and removing or promoting a frame leaves its pins with nowhere to show: the canvas
   * draws no pin without a picture and the review bar cannot walk to one. A pinned frame's comments must survive until
   * approved, so the declaration names the successor, and the capture moves the live comments there (the region, the
   * words and the thread unchanged, `movedFrom` recording where they sat) before it does anything else. A frame that is
   * gone with a live note on it and no entry here refuses the run, with the frame and the comment ids named. `null` is
   * the one other answer: released on purpose, allowed only for notes the agent has already worked (consumed), because
   * an unread note is feedback nobody has read.
   *
   * It is data about the past, so an entry may stay in the declaration for ever and does no harm; the preflight says
   * when one no longer has any comment left to move.
   */
  successors?: Record<string, string | null>;
};

/**
 * Several canvases in one project, keyed by the slug that addresses them: `/design-canvas/<slug>`.
 *
 * Each canvas has its own URL. The slug is the whole of the separation: it addresses the page, and it namespaces the
 * shots and the comments, so two canvases cannot photograph over each other's pictures or mix their reviews.
 *
 * A slug is lowercase, digits and dashes: it is a URL segment and a directory name at the same time.
 */
export type CanvasRegistry = Record<string, CanvasDeclaration>;

/** Rejects anything that cannot be both a URL segment and a directory name. */
export const CANVAS_SLUG = /^[a-z0-9][a-z0-9-]*$/;

/**
 * View only: a canvas that can be deployed, so people other than its author can open it.
 *
 * Everything this tool does is dev-only by default: the comment layer reads and writes real files in the repository,
 * which a serverless deployment does not have, and the canvas has no auth of its own. The frames are just pictures,
 * though, and developers should not have to run the prototype locally to see them.
 *
 * `NEXT_PUBLIC_CANVAS_VIEW_ONLY=1` at build time makes exactly one difference: the canvas and its picture route stop
 * 404ing in production, and the comment layer is absent, not disabled: no Comment button, no Hand Off, no Clear All, no
 * drag. Writing is refused at the route as well, because a client is not a permission system. Without the variable a
 * production build hides the tool entirely.
 *
 * Two things the target project owes a deployment, both in its own README rather than here: the pictures have to be
 * traced into the function bundle (they live outside `public/` on purpose), and `NEXT_PUBLIC_CANVAS_PINS=1` has to be
 * set or every frame's Open button lands on an unpinned page.
 */
export const CANVAS_VIEW_ONLY =
  process.env.NEXT_PUBLIC_CANVAS_VIEW_ONLY === "1";

/** True where the tool must not exist at all: a production build that was not asked to serve a read-only canvas. */
export function canvasHidden(): boolean {
  return process.env.NODE_ENV === "production" && !CANVAS_VIEW_ONLY;
}

/**
 * Published: this canvas is the deployed copy, so the comment layer is not here.
 *
 * `CANVAS_VIEW_ONLY` says the build is allowed to serve a canvas; this says the canvas being looked at is the published
 * one. A project may set the variable in its own config, so it can be on during development too, and the local canvas
 * must keep its comment layer: reviewing happens in development, publishing in production, and only this flag may take
 * the comment layer away.
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
 * Which devices this canvas actually has, in a fixed order, derived from the screens rather than declared.
 *
 * Derived, because a `devices` map with an entry nobody uses would draw a switch to an empty canvas. One device means
 * no switch.
 */
export function devicesOf(declaration: CanvasDeclaration): CanvasDevice[] {
  const seen = new Set(
    allScreens(declaration).map(({ screen }) => screen.device ?? DEFAULT_DEVICE),
  );
  return (["desktop", "phone"] as CanvasDevice[]).filter((one) => seen.has(one));
}

/**
 * Every screen in a declaration, from both views and the explorations, with the group it belongs to.
 *
 * Use it wherever a screen is found by id (the shots route's id guard, a comment's denormalised label, the oracle's
 * duplicate-address check), so none of them silently misses the explorations.
 */
export function allScreens(declaration: CanvasDeclaration): Array<{
  screen: CanvasScreen;
  /** The flow or exploration it sits in. Recorded on a comment so the file reads on its own. */
  groupId: string;
  groupTitle: string;
  /**
   * Which views draw it. A flow screen appears in both permanent views; a `groupedOnly` flow's screens appear only in
   * the grouped one; an exploration direction appears only in the third; an explanation frame appears only in the flows
   * and is never captured. The oracle needs the difference to count frames per view, and it is served rather than
   * inferred, because a quietly wrong count lets a canvas pass every check while missing frames.
   */
  view: "flow" | "kinds" | "flowOnly" | "exploration" | "explain";
}> {
  return [
    ...declaration.flows.flatMap((flow) =>
      flow.screens.map((screen) => ({
        screen,
        groupId: flow.id,
        groupTitle: flow.title,
        /* "flow" is drawn by both permanent views, "kinds" only by the grouped one, "flowOnly" only by
           the flows, and "explain" only by the flows with no capture behind it. See `groupedOnly` on the
           flow, and `flowOnly` and `explain` on the screen. */
        view: (screen.explain
          ? "explain"
          : flow.groupedOnly
            ? "kinds"
            : screen.flowOnly
              ? "flowOnly"
              : "flow") as "flow" | "kinds" | "flowOnly" | "explain",
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
 * One captured screen, as recorded by `capture.mjs`. The manifest is the receipt: a picture on a canvas cannot be
 * interrogated the way a live page can, so everything that was true when the shutter opened is written down here, and
 * the canvas shows it.
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
  /** The quarter-scale copy in `small/`, drawn while the frame is small on screen. Absent on older shots. */
  small?: { w: number; h: number };
  capturedAt: string;
  /** Every claim the screen declares, and whether it was actually in the page when it was captured. */
  claims: Array<{ claim: string; met: boolean }>;
  /**
   * Two consecutive captures came out identical: the proof that the picture is of a settled design rather than of a
   * page mid-animation or mid-load, because a page that is still moving cannot produce the same bytes twice. `tries` is
   * how many attempts that took.
   */
  stable: boolean;
  tries: number;
  /** Content hash. A comment records the hash it was drawn on, so a recapture can flag it as stale. */
  hash: string;
  /**
   * Where each outgoing edge starts, measured on the live page at the moment of capture: one entry per declared
   * `CanvasEdge.origin` on this screen, with the control's rectangle in picture pixels. The flows view draws these as
   * the interaction-origin rings; the oracle holds them against the declaration. Absent when the screen declares no
   * origins.
   */
  origins?: Array<{
    /** The edge this region belongs to: its target screen id. */
    to: string;
    /** The declared spec, verbatim, so declaration and measurement can be matched one to one. */
    origin: string;
    x: number;
    y: number;
    w: number;
    h: number;
  }>;
};

export type CanvasShotManifest = {
  contract: string;
  capturedAt: string;
  viewport: CanvasViewport;
  shots: CanvasShot[];
  /**
   * What each exploration started from, by exploration id, recorded by its first capture: the commit checked out then,
   * the files its original screen reached, and its mode. The parity check compares with it. A real-code exploration that
   * is no longer declared keeps its base (`retired`) until its check passes.
   */
  bases?: Record<string, CanvasExplorationBase>;
};

/** One exploration's base (`CanvasShotManifest.bases`). Written by `capture.mjs`, read by `tool/parity.mjs`. */
export type CanvasExplorationBase = {
  exploration: string;
  mode: "real-code" | "simple";
  /** The `original` screen's id, and the `source` entries its files were walked from. */
  original: string;
  entries: string[];
  commit: string;
  recordedAt: string;
  /** The code files the original reached at that commit, repo-relative. */
  files: string[];
  /** Files that had uncommitted changes when the base was recorded: those lines are not part of it. */
  dirty?: string[];
  retired?: boolean;
  /** Set when the base was moved to a newer commit (`parity.mjs --base`). */
  movedAt?: string;
};

/**
 * Where a comment points, on a picture: a rectangle drawn around the thing being talked about, in percentages of the
 * frame so it means the same at any zoom and any capture size.
 *
 * No selector is available here. What the agent gets instead is stronger for a design note: the screenshot with the
 * outline drawn on it, so the region in question is visible rather than described.
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
 * What kind of thing a reviewer left on a screen.
 *
 * A verdict is a comment: like and dislike work exactly as comments do, with predefined words saved on the picture.
 * That way a verdict inherits the hand-off's draining mechanism: the prompt tells the agent to PATCH a done comment
 * with `{ id, consumed: true }`, which stops it being handed over twice and brings the count down. A verdict in its own
 * array would need a parallel consumed flag, count and prompt line, and an agent that missed any one of them would
 * leave the count stuck.
 *
 * `note` is the default when the field is missing.
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
   * An agent has read this comment. Not the same as done: consumed stops it being read twice,
   * nothing more.
   */
  consumedAt?: string | null;
  /** The reviewer rewrote the words from the pin. The region and the picture are untouched by an edit. */
  editedAt?: string | null;
  /**
   * Rounds of this comment that have already been answered, oldest first. Written when the reviewer looks at
   * a recaptured screen, decides it is still wrong, and dismisses it with another round of feedback: the note
   * becomes the new words and the old ones move here, so the agent can see what it already tried.
   */
  history?: Array<{ note: string; at: string; answer?: string }>;
  /** The shot this was drawn on. */
  shotHash?: string;
  /** That screen has been captured again since, so what is under the outline may have changed. */
  stale?: boolean;
  /**
   * The agent's answer, when the comment asked something rather than pointed at something wrong.
   *
   * Written by `PATCH { id, answer }`, which also marks the comment consumed, and drawn under the reviewer's words in
   * the open pin, so the answer is read on the canvas where the question was asked, not only in chat. A dismissal moves
   * it into `history` with the words it answered, so the thread keeps both sides.
   */
  answer?: { text: string; at: string } | null;
};

/**
 * What the reviewer thought of one option: the other half of an exploration, beside the comments.
 *
 * A comment says what is wrong with a thing; a verdict says whether the thing survives. A direction can be liked and
 * carry three complaints, or be disliked with nothing wrong beyond being the weaker idea. Keeping them apart lets a
 * hand-off say "drop these two, refine that one, and here is what to fix while you do it". The round after a hand-off
 * drops the disliked options, works on the comments, and builds three more variations of each liked option.
 *
 * Derived, never stored: verdicts live in `comments` as kinds, for the reason on `CanvasCommentKind`. This shape is the
 * canvas reading them back out, so callers need not re-filter by kind.
 */
export type CanvasVerdict = {
  screenId: string;
  value: "like" | "dislike";
};

/** The file's shape on disk (`design-canvas/comments/<slug>.json`). `contract` is written for whoever opens the file cold. */
export type CanvasCommentFile = {
  contract: string;
  updatedAt: string;
  comments: CanvasComment[];
  /**
   * The screens waiting for the reviewer, by frame id: `"new"` for a frame whose first picture arrived after the
   * reviewer's first visit (`viewedAt`), `"changed"` for a frame whose picture changed since the reviewer last approved it.
   * Written only by the capture (`nextWaiting` in `new-frames.mjs`), from what it photographed; approving a frame deletes
   * its key.
   */
  waiting?: Record<string, "new" | "changed">;
  /**
   * When the reviewer first opened this canvas. Absent while the canvas is still being built: the capture queues nothing
   * then, and the first visit sets this and empties `waiting` in one write.
   */
  viewedAt?: string;
  /**
   * The highest comment number this file has ever issued, carried through every write, so an approved comment's number is
   * never handed to another one.
   */
  maxId?: number;
};
