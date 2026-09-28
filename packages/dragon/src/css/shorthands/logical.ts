// css-logical-1 §4-§6 in horizontal-tb: each flow-relative longhand maps to one physical longhand per direction. Inline start
// is left in ltr and right in rtl, inline end the opposite; block start and end are top and bottom, and inline and block sizes
// are width and height, in either direction. An inline mapping expands to one value per direction, tagged with it; the cascade
// keeps the one for the element's own direction (analysis/logical.ts). inset (css-logical-1 §4.3) is physical.
import type { Longhand } from '../properties.ts';
import type { LonghandValue } from '../stylesheet.ts';
import type { CssValue } from '../values.ts';
import { kw, LINE_STYLES, LINE_WIDTH_KEYWORDS } from '../values.ts';
import type { ShorthandHandler } from './shared.ts';
import { fourSides } from './shared.ts';

/** The physical longhand a flow-relative longhand maps to: one for either direction, or one per direction. */
type Slot = Longhand | { readonly ltr: Longhand; readonly rtl: Longhand };

type Edge = 'inline-start' | 'inline-end' | 'block-start' | 'block-end';

type PhysicalSide = 'top' | 'right' | 'bottom' | 'left';

/** css-logical-1 §3 (horizontal-tb): the physical side of a flow-relative edge. */
const SIDE: { readonly [E in Edge]: PhysicalSide | { readonly ltr: PhysicalSide; readonly rtl: PhysicalSide } } = {
  'inline-start': { ltr: 'left', rtl: 'right' },
  'inline-end': { ltr: 'right', rtl: 'left' },
  'block-start': 'top',
  'block-end': 'bottom',
};

/** The slot of a physical longhand family on an edge: pattern's "*" is replaced by the physical side. */
function slot(pattern: string, edge: Edge): Slot {
  const side = SIDE[edge];
  const fill = (s: string): Longhand => pattern.replace('*', s) as Longhand;
  return typeof side === 'string' ? fill(side) : { ltr: fill(side.ltr), rtl: fill(side.rtl) };
}

function values(s: Slot, value: CssValue, explicit: boolean): LonghandValue[] {
  if (typeof s === 'string') return [{ property: s, value, explicit }];
  return [{ property: s.ltr, value, explicit, direction: 'ltr' }, { property: s.rtl, value, explicit, direction: 'rtl' }];
}

const physical = (slots: readonly Slot[]): Longhand[] => [...new Set(slots.flatMap((s) => (typeof s === 'string' ? [s] : [s.ltr, s.rtl])))];

/** A handler over slots: expand gives each slot its value (and whether the author set it); a CSS-wide keyword sets every slot. */
function handler(slots: readonly Slot[], expand: (values: readonly CssValue[]) => readonly (readonly [CssValue, boolean])[]): ShorthandHandler {
  return {
    longhands: physical(slots),
    expand: (vs) => expand(vs).flatMap(([v, e], i) => values(slots[i] as Slot, v, e)),
    expandWide: (v) => slots.flatMap((s) => values(s, v, true)),
  };
}

/** One flow-relative longhand. */
const one = (s: Slot): ShorthandHandler => handler([s], (vs) => [[vs[0] as CssValue, true]]);

/** css-logical-1 §4.2-§4.4, §6.1: one or two values over the start and end slots; the end defaults to the start. */
const pair = (start: Slot, end: Slot): ShorthandHandler => handler([start, end], (vs) => {
  const [first, second = first] = vs as [CssValue, CssValue?];
  return [[first, true], [second as CssValue, true]];
});

/** css-logical-1 §6.3: width, style and colour of each edge, each omitted one filled with its initial value. */
function border(edges: readonly Edge[]): ShorthandHandler {
  const slots = edges.flatMap((e) => [slot('border-*-width', e), slot('border-*-style', e), slot('border-*-color', e)]);
  return handler(slots, (vs) => {
    let width: CssValue | null = null;
    let style: CssValue | null = null;
    let color: CssValue | null = null;
    for (const v of vs) {
      if (v.kind === 'length' || (v.kind === 'keyword' && LINE_WIDTH_KEYWORDS.has(v.value))) width = v;
      else if (v.kind === 'keyword' && LINE_STYLES.has(v.value)) style = v;
      else color = v;
    }
    const each: [CssValue, boolean][] = [width === null ? [kw('medium'), false] : [width, true], style === null ? [kw('none'), false] : [style, true], color === null ? [kw('currentcolor'), false] : [color, true]];
    return edges.flatMap(() => each);
  });
}

const edgePair = (pattern: string, axis: 'inline' | 'block'): ShorthandHandler => pair(slot(pattern, `${axis}-start`), slot(pattern, `${axis}-end`));

export const LOGICAL_SHORTHANDS = {
  inset: fourSides(['top', 'right', 'bottom', 'left']),
  'inset-inline': edgePair('*', 'inline'),
  'inset-block': edgePair('*', 'block'),
  'inset-inline-start': one(slot('*', 'inline-start')),
  'inset-inline-end': one(slot('*', 'inline-end')),
  'inset-block-start': one(slot('*', 'block-start')),
  'inset-block-end': one(slot('*', 'block-end')),
  'margin-inline': edgePair('margin-*', 'inline'),
  'margin-block': edgePair('margin-*', 'block'),
  'margin-inline-start': one(slot('margin-*', 'inline-start')),
  'margin-inline-end': one(slot('margin-*', 'inline-end')),
  'margin-block-start': one(slot('margin-*', 'block-start')),
  'margin-block-end': one(slot('margin-*', 'block-end')),
  'padding-inline': edgePair('padding-*', 'inline'),
  'padding-block': edgePair('padding-*', 'block'),
  'padding-inline-start': one(slot('padding-*', 'inline-start')),
  'padding-inline-end': one(slot('padding-*', 'inline-end')),
  'padding-block-start': one(slot('padding-*', 'block-start')),
  'padding-block-end': one(slot('padding-*', 'block-end')),
  'border-inline': border(['inline-start', 'inline-end']),
  'border-block': border(['block-start', 'block-end']),
  'border-inline-start': border(['inline-start']),
  'border-inline-end': border(['inline-end']),
  'border-block-start': border(['block-start']),
  'border-block-end': border(['block-end']),
  'border-inline-width': edgePair('border-*-width', 'inline'),
  'border-inline-style': edgePair('border-*-style', 'inline'),
  'border-inline-color': edgePair('border-*-color', 'inline'),
  'border-block-width': edgePair('border-*-width', 'block'),
  'border-block-style': edgePair('border-*-style', 'block'),
  'border-block-color': edgePair('border-*-color', 'block'),
  'border-inline-start-width': one(slot('border-*-width', 'inline-start')),
  'border-inline-start-style': one(slot('border-*-style', 'inline-start')),
  'border-inline-start-color': one(slot('border-*-color', 'inline-start')),
  'border-inline-end-width': one(slot('border-*-width', 'inline-end')),
  'border-inline-end-style': one(slot('border-*-style', 'inline-end')),
  'border-inline-end-color': one(slot('border-*-color', 'inline-end')),
  'border-block-start-width': one(slot('border-*-width', 'block-start')),
  'border-block-start-style': one(slot('border-*-style', 'block-start')),
  'border-block-start-color': one(slot('border-*-color', 'block-start')),
  'border-block-end-width': one(slot('border-*-width', 'block-end')),
  'border-block-end-style': one(slot('border-*-style', 'block-end')),
  'border-block-end-color': one(slot('border-*-color', 'block-end')),
  // css-logical-1 §5.1 (horizontal-tb): the inline size is the width, the block size the height.
  'inline-size': one('width'),
  'block-size': one('height'),
  'min-inline-size': one('min-width'),
  'min-block-size': one('min-height'),
  'max-inline-size': one('max-width'),
  'max-block-size': one('max-height'),
} as const satisfies { readonly [s: string]: ShorthandHandler };
