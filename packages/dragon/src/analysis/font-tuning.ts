// TXT-FONTFEAT (css-fonts-4 §6.3, §6.13, §7.1): font-kerning, font-language-override and font-optical-sizing switch the face's
// kerning, language system and optical-size axis, which Dragon's shaping leaves at the face's defaults (the initial values); Chrome's
// glyphs then match only in a face that has none of them (Ahem). Another value over text in a real face is refused on every target,
// once per text. Planted fault fontTuningOnRealFaceAccepted accepts it.
import { diagnostic } from '../diagnostics/catalogue.ts';
import { FONT_TUNING_INITIAL, FONT_TUNING_LONGHANDS } from '../css/properties/font-tuning.ts';
import type { TxtFtFaults } from '../faults/txt-ft.ts';
import type { Diagnostic } from '../types.ts';
import type { ResolvedElement, ResolvedValue } from './resolve.ts';
import { valueToString } from './resolve.ts';

export function checkFontTuning(el: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>, shapedAt: (address: string) => boolean, faults: TxtFtFaults): void {
  if (faults.fontTuningOnRealFaceAccepted) return;
  const set = FONT_TUNING_LONGHANDS.filter((p) => {
    const v = el.props.get(p) as ResolvedValue | undefined;
    return v !== undefined && !(v.value.kind === 'keyword' && v.value.value === FONT_TUNING_INITIAL[p]);
  });
  if (set.length === 0) return;
  for (const c of el.children) {
    if (c.kind !== 'text' || !shapedAt(c.node.address)) continue;
    const id = `font-tuning|${c.node.address}`;
    if (reported.has(id)) continue;
    reported.add(id);
    const what = set.map((p) => `${p}: ${valueToString((el.props.get(p) as ResolvedValue).value)}`).join(' and ');
    for (const t of targets) {
      diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
        origin: c.node.node.origin,
        target: t,
        message: `${what} reaches text ${c.node.address}, which is drawn in a real face: Dragon shapes it with the face's default kerning, language system and optical size (TXT-FONTFEAT)`,
        manual: `Set ${set.map((p) => `${p} to ${FONT_TUNING_INITIAL[p]}`).join(' and ')} on the text of ${el.element.address}, or draw it in a face without them.`,
        basis: 'computed-value',
      }));
    }
  }
}
