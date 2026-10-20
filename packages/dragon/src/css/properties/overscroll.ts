// css-overscroll-1 §2 and css-scroll-anchoring-1 §2: overscroll-behavior-x, -y, -inline and -block, the overscroll-behavior
// shorthand, and overflow-anchor, all initial auto and not inherited (Chrome 145 css_properties.json5). Chrome parses auto, contain
// and none for each overscroll longhand (one or two of them for the shorthand, x then y) and auto, none or visible (a legacy keyword
// that anchors as auto does) for overflow-anchor; it has no chain. They change only how a user's scrolling chains to outer scrollers and whether a scroller follows content that moves
// above it, so no layout lane reads them. On native a Dragon scroll view never anchors, as overflow-anchor: none asks; none turns
// off an iOS scroll view's bounce on that axis (lower/paint/scroll.ts), and contain and none are refused inside a native scroll view
// on that axis, which would take a drag Chrome stops from chaining (analysis/computed-checks.ts checkOverscrollChaining).
//
// css-logical-1 §4: -inline and -block share one logical property group with -x and -y, and in horizontal-tb (the only writing
// mode) map to -x and -y whatever the direction, so Chrome computes -inline as -x and -block as -y. Each declaration sets both
// longhands of its pair, so the per-longhand cascade picks the same winner for both, as Chrome's group cascade does; that holds for a
// CSS-wide keyword and a var() value too (pairedLonghands, used by css/stylesheet.ts).
import type { CssNode } from 'css-tree';
import type { PropertyAspect } from '../properties.ts';
import type { LonghandValue } from '../stylesheet.ts';
import type { CssValue } from '../values.ts';
import { asciiLower } from '../escapes.ts';
import type { InitialOnlyParser } from './initial-only.ts';
import { kwInitial } from './initial-only.ts';

export const OVERSCROLL_LONGHANDS = ['overscroll-behavior-x', 'overscroll-behavior-y', 'overscroll-behavior-inline', 'overscroll-behavior-block', 'overflow-anchor'] as const;
export const OVERSCROLL_SHORTHANDS = ['overscroll-behavior'] as const;
export const OVERSCROLL_INHERITED: readonly (typeof OVERSCROLL_LONGHANDS)[number][] = [];
export const OVERSCROLL_CONTAINER: readonly (typeof OVERSCROLL_LONGHANDS)[number][] = [];
export const OVERSCROLL_TEXT_ROLE: readonly (typeof OVERSCROLL_LONGHANDS)[number][] = [];

type OverscrollLonghand = (typeof OVERSCROLL_LONGHANDS)[number];

export const OVERSCROLL_ASPECTS: { readonly [P in OverscrollLonghand]: PropertyAspect } = {
  'overscroll-behavior-x': { layout: false, paint: true },
  'overscroll-behavior-y': { layout: false, paint: true },
  'overscroll-behavior-inline': { layout: false, paint: true },
  'overscroll-behavior-block': { layout: false, paint: true },
  'overflow-anchor': { layout: false, paint: true },
};

/** Each longhand's initial value. */
export const OVERSCROLL_INITIAL: { readonly [P in OverscrollLonghand]: CssValue } = {
  'overscroll-behavior-x': kwInitial('auto'),
  'overscroll-behavior-y': kwInitial('auto'),
  'overscroll-behavior-inline': kwInitial('auto'),
  'overscroll-behavior-block': kwInitial('auto'),
  'overflow-anchor': kwInitial('auto'),
};

/** The longhands a declaration of each overscroll name sets: its own and the other of its logical pair. */
export const OVERSCROLL_PAIRS = {
  'overscroll-behavior-x': ['overscroll-behavior-x', 'overscroll-behavior-inline'],
  'overscroll-behavior-inline': ['overscroll-behavior-inline', 'overscroll-behavior-x'],
  'overscroll-behavior-y': ['overscroll-behavior-y', 'overscroll-behavior-block'],
  'overscroll-behavior-block': ['overscroll-behavior-block', 'overscroll-behavior-y'],
} as const;

/**
 * The longhands a declaration of a longhand sets: an overscroll longhand and its logical pair, any other longhand alone. The
 * stylesheet gives a CSS-wide keyword and a var() value the same pair, so inherit, initial, revert and a substituted value set both.
 */
export function pairedLonghands<P extends string>(property: P): readonly P[] {
  return property in OVERSCROLL_PAIRS ? (OVERSCROLL_PAIRS[property as keyof typeof OVERSCROLL_PAIRS] as readonly string[] as readonly P[]) : [property];
}

const BEHAVIOURS: ReadonlySet<string> = new Set(['auto', 'contain', 'none']);

/** One keyword token of the set, lowercased, or null. */
function keyword(t: CssNode | undefined, set: ReadonlySet<string>): string | null {
  if (t === undefined || t.type !== 'Identifier') return null;
  const k = asciiLower(String(t['name']));
  return set.has(k) ? k : null;
}

const set = (properties: readonly OverscrollLonghand[], value: string): LonghandValue[] => properties.map((property) => ({ property, value: kwInitial(value), explicit: true }));

function pairParser(name: keyof typeof OVERSCROLL_PAIRS): InitialOnlyParser {
  return (tokens) => {
    const k = tokens.length === 1 ? keyword(tokens[0], BEHAVIOURS) : null;
    return k === null ? { kind: 'invalid', reason: `${name} takes auto, contain or none` } : { kind: 'ok', longhands: set(OVERSCROLL_PAIRS[name], k) };
  };
}

/** overscroll-behavior: one or two of auto, contain and none, x then y; one value sets both axes. */
const shorthand: InitialOnlyParser = (tokens) => {
  const ks = tokens.map((t) => keyword(t, BEHAVIOURS));
  if (ks.length === 0 || ks.length > 2 || ks.some((k) => k === null)) return { kind: 'invalid', reason: 'overscroll-behavior takes one or two of auto, contain and none' };
  const x = ks[0] as string;
  const y = (ks[1] ?? x) as string;
  return { kind: 'ok', longhands: [...set(OVERSCROLL_PAIRS['overscroll-behavior-x'], x), ...set(OVERSCROLL_PAIRS['overscroll-behavior-y'], y)] };
};

const anchor: InitialOnlyParser = (tokens) => {
  const k = tokens.length === 1 ? keyword(tokens[0], new Set(['auto', 'none', 'visible'])) : null;
  return k === null ? { kind: 'invalid', reason: 'overflow-anchor takes auto, none or visible' } : { kind: 'ok', longhands: set(['overflow-anchor'], k) };
};

export const OVERSCROLL_VALUE_PARSERS: { readonly [P in OverscrollLonghand | (typeof OVERSCROLL_SHORTHANDS)[number]]: InitialOnlyParser } = {
  'overscroll-behavior-x': pairParser('overscroll-behavior-x'),
  'overscroll-behavior-y': pairParser('overscroll-behavior-y'),
  'overscroll-behavior-inline': pairParser('overscroll-behavior-inline'),
  'overscroll-behavior-block': pairParser('overscroll-behavior-block'),
  'overflow-anchor': anchor,
  'overscroll-behavior': shorthand,
};
