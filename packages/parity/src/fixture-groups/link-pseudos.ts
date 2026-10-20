// Fixture group link-pseudos (LINK-RT, Selectors-4 §8.1-§8.2): :link and :any-link on a[href] and an a without one, :visited (which
// matches nothing: every link is unvisited, as in the capture's fresh profile), :not(:link), :has(:any-link), an id and a
// selector list, in both directions. The colours come from :any-link rules, since a :link or :visited colour is refused on the web.
import type { FixtureSpec } from '../fixtures.ts';
import { both } from './define.ts';

export const LINK_PSEUDOS: readonly FixtureSpec[] = [both('link-pseudos')];
