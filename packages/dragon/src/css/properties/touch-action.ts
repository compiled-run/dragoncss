// touch-action (pointerevents-3 §10.2): auto | none | [ [ pan-x | pan-left | pan-right ] || [ pan-y | pan-up | pan-down ] ||
// pinch-zoom ] | manipulation, not inherited, initial auto. Chrome 145 parses it as TouchAction::ParseSingleValue
// (longhands_custom.cc) does: auto, none or manipulation alone, or up to one keyword from each of the x, y and pinch-zoom groups,
// in any order, kept in x, y, pinch-zoom order. Its computed value is the TouchAction flags the keywords OR together, serialized by
// ComputedStyleUtils::TouchActionFlagsToCSSValue (computed_style_utils.cc), so pan-x pan-y pinch-zoom computes to manipulation.
// No layout or paint aspect: it only decides which touch gestures Chrome hands to the page's scrolling and zooming
// (analysis/touch-action.ts).
import type { CssNode } from 'css-tree';
import type { Span } from '../../types.ts';
import type { ResolvedValue } from '../../analysis/computed.ts';
import { asciiLower } from '../escapes.ts';
import type { Longhand, PropertyAspect } from '../properties.ts';
import type { ParsedValue } from '../stylesheet.ts';

export const TOUCH_ACTION_LONGHANDS = ['touch-action'] as const;
export const TOUCH_ACTION_SHORTHANDS = [] as const;
export const TOUCH_ACTION_INHERITED: readonly (typeof TOUCH_ACTION_LONGHANDS)[number][] = [];
export const TOUCH_ACTION_CONTAINER: readonly (typeof TOUCH_ACTION_LONGHANDS)[number][] = [];
export const TOUCH_ACTION_TEXT_ROLE: readonly (typeof TOUCH_ACTION_LONGHANDS)[number][] = [];

export const TOUCH_ACTION_ASPECTS: { readonly [P in (typeof TOUCH_ACTION_LONGHANDS)[number]]: PropertyAspect } = {
  'touch-action': { layout: false, paint: false },
};

const ALONE: readonly string[] = ['auto', 'none', 'manipulation'];
const GROUPS: readonly (readonly string[])[] = [['pan-x', 'pan-left', 'pan-right'], ['pan-y', 'pan-up', 'pan-down'], ['pinch-zoom']];

/** touch-action as Chrome 145 parses it, any ASCII case; the specified value keeps Chrome's x, y, pinch-zoom order. */
export function parseTouchAction(tokens: readonly CssNode[], _base: Span): ParsedValue {
  const words: string[] = [];
  for (const t of tokens) {
    if (t.type !== 'Identifier') return { kind: 'invalid', reason: 'touch-action takes keywords only' };
    words.push(asciiLower(String(t['name'])));
  }
  if (words.length === 0) return { kind: 'invalid', reason: 'touch-action needs a keyword' };
  const keyword = (value: string): ParsedValue => ({ kind: 'ok', longhands: [{ property: 'touch-action', value: { kind: 'keyword', value }, explicit: true }] });
  if (words.length === 1 && ALONE.includes(words[0] as string)) return keyword(words[0] as string);
  const picked: (string | null)[] = [null, null, null];
  for (const w of words) {
    const g = GROUPS.findIndex((group) => group.includes(w));
    if (g < 0) return { kind: 'invalid', reason: `Chrome 145 does not parse touch-action: ${words.join(' ')}` };
    if (picked[g] !== null) return { kind: 'invalid', reason: `touch-action takes one keyword of ${GROUPS[g]!.join(', ')}` };
    picked[g] = w;
  }
  return keyword(picked.filter((w): w is string => w !== null).join(' '));
}

/** The value parser of the touch-action family (the value hook, css/paint-parsers.ts). */
export const TOUCH_ACTION_VALUE_PARSERS: { readonly [P in (typeof TOUCH_ACTION_LONGHANDS)[number]]: (tokens: readonly CssNode[], base: Span) => ParsedValue } = {
  'touch-action': parseTouchAction,
};

/** The pan directions a computed touch-action allows, of left, right, up and down. */
export function touchActionPans(value: string): ReadonlySet<'left' | 'right' | 'up' | 'down'> {
  if (value === 'auto' || value === 'manipulation') return new Set(['left', 'right', 'up', 'down']);
  const words = value.split(' ');
  const pans = new Set<'left' | 'right' | 'up' | 'down'>();
  if (words.includes('pan-x') || words.includes('pan-left')) pans.add('left');
  if (words.includes('pan-x') || words.includes('pan-right')) pans.add('right');
  if (words.includes('pan-y') || words.includes('pan-up')) pans.add('up');
  if (words.includes('pan-y') || words.includes('pan-down')) pans.add('down');
  return pans;
}

/** TouchActionFlagsToCSSValue: pan-x pan-y pinch-zoom sets the manipulation flags, so it computes to manipulation. */
export function computeTouchAction(props: Map<Longhand, ResolvedValue>): void {
  const v = props.get('touch-action') as ResolvedValue;
  if (v.value.kind === 'keyword' && v.value.value === 'pan-x pan-y pinch-zoom') props.set('touch-action', { ...v, value: { kind: 'keyword', value: 'manipulation' } });
}
