// isolation (compositing-1 §3.2): auto | isolate, initial auto, not inherited, one keyword computed as specified (Chrome 145
// css_properties.json5 field_template keyword). isolate makes the box a stacking context (Blink StyleAdjuster: IsStackingContext),
// which paints in its context's z-index 0 layer like a transformed box (lower/paint/stacking.ts). Dragon draws no mix-blend-mode, so
// the group isolation it also asks for changes nothing a target paints. The grammar is webref's, which lists exactly Chrome 145's
// keywords.
import type { ResolvedElement, ResolvedValue } from '../../analysis/resolve.ts';
import type { PropertyAspect } from '../properties.ts';

export const ISOLATION_LONGHANDS = ['isolation'] as const;
export const ISOLATION_SHORTHANDS = [] as const;
export const ISOLATION_INHERITED: readonly (typeof ISOLATION_LONGHANDS)[number][] = [];
export const ISOLATION_CONTAINER: readonly (typeof ISOLATION_LONGHANDS)[number][] = [];
export const ISOLATION_TEXT_ROLE: readonly (typeof ISOLATION_LONGHANDS)[number][] = [];

export const ISOLATION_ASPECTS: { readonly [P in (typeof ISOLATION_LONGHANDS)[number]]: PropertyAspect } = {
  isolation: { layout: false, paint: true },
};

/** Whether an element's computed isolation is isolate, which makes it a stacking context. */
export function isolates(el: Pick<ResolvedElement, 'props'>): boolean {
  const v = (el.props.get('isolation') as ResolvedValue | undefined)?.value;
  return v !== undefined && v.kind === 'keyword' && v.value === 'isolate';
}
