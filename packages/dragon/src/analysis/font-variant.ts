// TXT-FONTFEAT (css-fonts-4 §6.4-§6.10): the font-variant feature longhands (ligatures, alternates, numeric, east-asian) select
// OpenType features, which Dragon does not apply; Chrome's glyphs are then the same only in a face that has none (Ahem). A non-normal
// value of any of them over text in a real face is refused on every target, once per text. Planted fault fontVariantOnRealFaceAccepted
// accepts it.
import { diagnostic } from '../diagnostics/catalogue.ts';
import { FEATURE_VARIANTS } from '../css/properties/font-variant.ts';
import type { TxtFvFaults } from '../faults/txt-fv.ts';
import type { Diagnostic } from '../types.ts';
import type { ResolvedElement, ResolvedValue } from './resolve.ts';
import { valueToString } from './resolve.ts';

export function checkFontVariant(el: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>, shapedAt: (address: string) => boolean, faults: TxtFvFaults): void {
  if (faults.fontVariantOnRealFaceAccepted) return;
  const set = FEATURE_VARIANTS.filter((p) => {
    const v = el.props.get(p) as ResolvedValue | undefined;
    return v !== undefined && !(v.value.kind === 'keyword' && v.value.value === 'normal');
  });
  if (set.length === 0) return;
  for (const c of el.children) {
    if (c.kind !== 'text' || !shapedAt(c.node.address)) continue;
    const id = `font-variant|${c.node.address}`;
    if (reported.has(id)) continue;
    reported.add(id);
    const what = set.map((p) => `${p}: ${valueToString((el.props.get(p) as ResolvedValue).value)}`).join(' and ');
    for (const t of targets) {
      diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
        origin: c.node.node.origin,
        target: t,
        message: `${what} reaches text ${c.node.address}, which is drawn in a real face: Dragon applies no OpenType feature yet (TXT-FONTFEAT)`,
        manual: `Set ${set.join(' and ')} to normal on the text of ${el.element.address}, or draw it in a face without features.`,
        basis: 'computed-value',
      }));
    }
  }
}
