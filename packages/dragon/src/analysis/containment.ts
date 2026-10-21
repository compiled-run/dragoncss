// css-contain-2 §3: where the containment a computed contain value names applies. Layout, paint and
// size containment apply to a box that is not an inline box (Blink LayoutObject::ShouldApplyLayoutContainment and its siblings), so
// on display: inline or contents only style containment is left, which scopes list item ordinals (analysis/markers.ts) and changes
// nothing else Dragon draws (counter() and quotes in content are refused). Layout and paint containment make the box a formatting
// context root, the containing block of its absolutely positioned descendants and a stacking context in its context's z-index 0
// layer; layout containment hides its baseline; paint containment clips its contents to the padding box as overflow: clip does;
// size containment sizes it as if it had no contents (the engine: LayoutStyle containLayout, containPaint, containSize). The cases
// Dragon refuses are in containment-checks.ts.
import type { Containment } from '../css/properties/containment.ts';
import { containmentOf } from '../css/properties/containment.ts';
import type { ResolvedValue } from './computed.ts';
import type { ResolvedElement } from './resolve.ts';

const NONE: Containment = { size: 'none', layout: false, style: false, paint: false };

/** An element's computed display keyword ('' when it has none). */
export const displayOf = (el: ResolvedElement): string => {
  const v = (el.props.get('display') as ResolvedValue | undefined)?.value;
  return v?.kind === 'keyword' ? v.value : '';
};

/** The containment that applies to an element's box: none without a box, style alone on an inline box or display: contents. */
export function appliedContainment(el: ResolvedElement): Containment {
  const asked = containmentOf(el);
  const display = displayOf(el);
  if (display === 'none') return NONE;
  if (display === 'inline' || display === 'contents') return { ...NONE, style: asked.style };
  return asked;
}

/** Whether layout or paint containment applies: the box is a containing block for absolutely positioned descendants and a stacking context. */
export function containsDescendants(el: ResolvedElement): boolean {
  const c = appliedContainment(el);
  return c.layout || c.paint;
}

/** Whether paint containment applies, which clips the contents to the padding box on both axes. */
export function paintContained(el: ResolvedElement): boolean {
  return appliedContainment(el).paint;
}
