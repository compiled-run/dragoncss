// Owner ruling BROWSER-ONLY (Jack, project chat, 2026-10-21): CSS that asks for behaviour only a web browser can have, which a
// native app can never give it, is a build error on iOS and Android that says so, rather than "not supported yet". Harmless hints
// stay on the not-applicable list (profiles/not-applicable-native.ts) and are left out silently. Web keeps its own refusal. Each
// entry says why it is here; keep the list small and explicit.

export type BrowserOnlyEntry = {
  /** A property name (ASCII lower case), or an at-rule name with its @. */
  readonly name: string;
  readonly reason: string;
};

// A view transition starts only from script (document.startViewTransition) or a cross-document navigation (@view-transition),
// and a native app has neither, so these never do anything there. view-transition-name also makes a named box a stacking context in
// Chrome; the error keeps native from silently painting without it.
const VIEW_TRANSITIONS = 'view transitions are browser-only: one starts only from script (document.startViewTransition) or a cross-document navigation, and a native app has neither';

export const BROWSER_ONLY_NATIVE: readonly BrowserOnlyEntry[] = [
  { name: 'view-transition-name', reason: VIEW_TRANSITIONS },
  { name: 'view-transition-class', reason: VIEW_TRANSITIONS },
  { name: 'view-transition-group', reason: VIEW_TRANSITIONS },
  { name: '@view-transition', reason: VIEW_TRANSITIONS },
];

/** The list entry for a property name or an @-prefixed at-rule name (ASCII lower case), or null when it is not on the list. */
export function browserOnlyEntry(name: string): BrowserOnlyEntry | null {
  return BROWSER_ONLY_NATIVE.find((e) => e.name === name) ?? null;
}
