/**
 * design-canvas CORE — class names, joined.
 *
 * Every project has one of these and every one of them is called `cn`, which is exactly why the core
 * carries its own: reaching for the host project's utility is how a folder that is supposed to know
 * nothing about the project it sits in acquires its first import from it, and the second one is always
 * a component. Four lines is cheaper than that boundary.
 *
 * No `tailwind-merge` here on purpose. The core never composes a class list from outside itself, so
 * there are no conflicting utilities to resolve, and a dependency the canvas would have to bring into
 * every repo it is installed in is not worth a merge that never happens.
 *
 * THAT PREMISE IS NOT FREE, AND IT HAS ALREADY COST ONE BUG. "The core never composes a class list from
 * outside itself" holds only while no caller passes an overriding utility. A caller passing `px-0` over a
 * core `px-3.5` keeps BOTH, and the winner is whatever order Tailwind emitted them in rather than the later
 * argument — the broken bar geometry found on 2026-08-17, prevented since by a comment asking callers not to
 * do it. A comment is not a mechanism. Rather than take the dependency, the conflict is made LOUD in
 * development: the same utility family twice in one list is a caller mistake, and it now says so instead of
 * rendering something arbitrary. Production is untouched, so nothing ships a console warning to a reviewer.
 */
const FAMILY = /^-?(p|px|py|pt|pr|pb|pl|m|mx|my|mt|mr|mb|ml|w|h|gap|rounded|z)(?:-|$)/;

export function cn(...parts: Array<string | false | null | undefined>): string {
  const joined = parts.filter(Boolean).join(" ");
  if (typeof process !== "undefined" && process.env?.NODE_ENV !== "production") {
    const seen = new Map<string, string>();
    for (const token of joined.split(/\s+/)) {
      if (!token) continue;
      const family = FAMILY.exec(token)?.[1];
      if (!family) continue;
      const previous = seen.get(family);
      if (previous && previous !== token) {
        console.warn(
          `[design-canvas] two "${family}" utilities in one class list: "${previous}" then "${token}". ` +
            "The core does not merge Tailwind classes, so emission order decides, not argument order. " +
            "Change the core's own value instead of overriding it at the call site.",
        );
      }
      seen.set(family, token);
    }
  }
  return joined;
}
