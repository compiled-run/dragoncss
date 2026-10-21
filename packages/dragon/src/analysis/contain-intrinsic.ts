// css-sizing-4 §5.2: contain-intrinsic-width and -height give a size-contained box its content size (the engine's
// LayoutStyle containIntrinsicWidth and containIntrinsicHeight). Width applies under size or inline-size containment (contain, or
// container-type: inline-size), height under size containment alone; elsewhere the value changes nothing and is accepted. Where it
// applies, a px length or none compiles; auto is refused there, since it takes the box's last remembered size once the box has been
// laid out without size containment (a state or band change can do that), which Dragon does not track. A value the parser does not
// read (css/properties/containment.ts parseIntrinsicSize keeps it as written) is refused everywhere. The flow-relative
// contain-intrinsic-inline-size and -block-size stay at their initial values (analysis/scroll-containment.ts), and since Chrome
// resolves each with its physical counterpart (inline-size with width, block-size with height, horizontal-tb) as one logical property
// group, where the later declaration wins, a non-none width or height is refused wherever an author declares its flow-relative
// counterpart: Dragon cascades them apart, so it cannot tell which one Chrome keeps.
import { authored, diagnostic } from '../diagnostics/catalogue.ts';
import { INTRINSIC_AUTO_TYPE, INTRINSIC_SIZE_LONGHANDS } from '../css/properties/containment.ts';
import type { ContainIntrinsicFaults } from '../faults/contain-intrinsic.ts';
import type { Diagnostic } from '../types.ts';
import { appliedContainment, displayOf } from './containment.ts';
import type { ResolvedElement, ResolvedValue } from './resolve.ts';
import { valueToString } from './resolve.ts';

/** Whether size containment applies to the element's box in the axis contain-intrinsic-width (width) or -height (height) sizes. */
export function intrinsicSizeApplies(el: ResolvedElement, p: (typeof INTRINSIC_SIZE_LONGHANDS)[number]): boolean {
  const size = appliedContainment(el).size;
  if (size === 'size') return true;
  if (p === 'contain-intrinsic-height') return false;
  if (size === 'inline-size') return true;
  const type = (el.props.get('container-type') as ResolvedValue | undefined)?.value;
  const display = displayOf(el);
  return type?.kind === 'keyword' && type.value === 'inline-size' && display !== 'none' && display !== 'inline' && display !== 'contents';
}

/** Refuses an intrinsic size Dragon does not lay out, once per element and longhand, on every target. */
export function checkIntrinsicSize(el: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>, faults: ContainIntrinsicFaults): void {
  for (const p of INTRINSIC_SIZE_LONGHANDS) {
    const v = el.props.get(p) as ResolvedValue | undefined;
    if (v === undefined) continue;
    const value = v.value;
    const applies = intrinsicSizeApplies(el, p);
    if (value.kind === 'keyword' && value.value === 'none') continue;
    const logical = p === 'contain-intrinsic-width' ? 'contain-intrinsic-inline-size' : 'contain-intrinsic-block-size';
    const counterpart = el.props.get(logical) as ResolvedValue | undefined;
    let reason: string | null = null;
    if (counterpart !== undefined && counterpart.declaration !== null) {
      reason = `${logical} is also declared on it, and Chrome keeps whichever of the two is declared later, which Dragon does not track`;
    } else if (value.kind === 'length') {
      if (applies && value.unit !== 'px') reason = `a ${value.unit} length did not compute to px, which the layout engine needs`;
    } else if (value.kind === 'other' && value.type === INTRINSIC_AUTO_TYPE) {
      if (applies && !faults.intrinsicAutoAccepted) reason = 'auto takes the box\'s last remembered size once it has been laid out without size containment, which Dragon does not track';
    } else reason = 'Dragon reads none, a length, or auto with none or a length';
    if (reason === null) continue;
    const id = `contain-intrinsic|${el.element.address}|${p}`;
    if (reported.has(id)) continue;
    reported.add(id);
    const origin = v.declaration !== null ? authored(v.declaration.valueSpan) : el.element.node.origin;
    for (const t of targets) {
      diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
        origin,
        target: t,
        message: `${p}: ${valueToString(value)} on <${el.element.tag}> ${el.element.address} is unsupported: ${reason}`,
        manual: `Give ${el.element.address} a px ${p}, or none.`,
        basis: 'computed-value',
      }));
    }
  }
}
