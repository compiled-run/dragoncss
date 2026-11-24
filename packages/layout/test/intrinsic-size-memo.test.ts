// A box's min and max-content sizes, and a formatting context root's layout at one set of constraints, are computed once per layout,
// as Blink keeps LayoutBox::IntrinsicLogicalWidths and CachedLayoutResult. Sizing a flex or grid container lays each item out more
// than once, so without them nested containers re-measured their text exponentially often (the checkin /new page: 531,745 inline
// formatting contexts built over 55 text boxes in one layout).
import { describe, expect, it } from 'vitest';
import type { GridContainerStyle, GridItemStyle, LayoutBox, TrackSize } from '../src/index.ts';
import { absoluteRects, ahemMeasurer, layout } from '../src/index.ts';
import type { TextMeasurer } from '../src/text.ts';
import { box, neutralEnvironment, text } from './helpers.ts';

const AUTO: TrackSize = { kind: 'breadth', breadth: { kind: 'auto' } };
const MAX_CONTENT: TrackSize = { kind: 'breadth', breadth: { kind: 'max-content' } };
const gridStyle: GridContainerStyle = { templateColumns: [], templateRows: [], autoColumns: [MAX_CONTENT], autoRows: [AUTO], explicitColumnCount: 0, explicitRowCount: 0, autoRepeatColumns: null, autoRepeatRows: null, autoFlow: 'row', dense: false, justifyItems: 'normal' };
const item: GridItemStyle = { column: { kind: 'auto', span: 1 }, row: { kind: 'auto', span: 1 }, justifySelf: 'start' };

const words = (inGrid: boolean): LayoutBox => box('t', inGrid ? { gridItem: item } : {}, [text('t:text0', 'XX XXXX')]);
const flexes = (depth: number): LayoutBox => {
  let b = words(false);
  for (let d = depth; d > 0; d--) b = box(`c${d}`, { display: 'flex' }, [b]);
  return b;
};
const grids = (depth: number): LayoutBox => {
  let b = words(true);
  for (let d = depth; d > 0; d--) b = box(`c${d}`, d === 1 ? { display: 'grid', grid: gridStyle } : { display: 'grid', grid: gridStyle, gridItem: item }, [b]);
  return b;
};

function laidOut(root: LayoutBox): { readonly text: readonly number[]; readonly measures: number } {
  let measures = 0;
  const counting: TextMeasurer = { ...ahemMeasurer, measure: (t, f) => (measures++, ahemMeasurer.measure(t, f)), measureRange: (t, s, e, f) => (measures++, ahemMeasurer.measureRange(t, s, e, f)) };
  const viewport = { width: 400, height: 300 };
  const r = layout({ viewport, devicePixelRatio: 1, ...neutralEnvironment(viewport), root: box('root', {}, [root]) }, counting);
  if (r.kind !== 'ok') throw new Error(`unsupported: ${r.unsupported.code}`);
  const t = absoluteRects(r.boxes).get('t');
  if (t === undefined) throw new Error('no box for t');
  return { text: [t.x, t.y, t.width, t.height], measures };
}

describe('nested flex and grid containers measure their text once per layout', () => {
  for (const [name, nest] of [['flex', flexes], ['grid', grids]] as const) {
    it(`${name}: six levels measure the text as often as two, and lay it out in the same box`, () => {
      const two = laidOut(nest(2));
      const six = laidOut(nest(6));
      expect(six.measures).toBe(two.measures);
      expect(six.text).toEqual(two.text);
    });
  }
});
