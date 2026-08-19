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
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
