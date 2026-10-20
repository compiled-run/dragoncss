// Fixture group speak (NA-NATIVE-2): Chrome's legacy aural property at each of its six keywords, in any case, inherited, through
// var(), inherit, initial and unset, on blocks, flex items and positioned boxes (speak-values, web and native rows). Chrome draws
// nothing with it, so every keyword changes nothing on any target.
import type { FixtureSpec } from '../fixtures.ts';
import { both } from './define.ts';

export const SPEAK: readonly FixtureSpec[] = [both('speak-values')];
