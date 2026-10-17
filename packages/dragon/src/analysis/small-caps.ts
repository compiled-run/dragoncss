// TXT-FONTFEAT (css-fonts-4 §6.5): font-variant-caps: small-caps over a face without smcp makes Chrome synthesize small capitals:
// each run of lowercase letters is drawn uppercased at 70% of the font size, rounded (HarfBuzzShaper::ShapeSegment,
// SimpleFontData::SmallCapsFontData). The engine lays that out over Ahem and the native text views draw each run at its size. What no
// Chrome case proves is refused once per text: a real face (which may have smcp) and the engine's unported layouts (letter or word
// spacing, preserved white space, justification, a truncated or clamped line) on every target; on native targets also a synthetic
// bold or oblique, a decoration, a shadow or a transform, which the native views draw at one size.
import { diagnostic } from '../diagnostics/catalogue.ts';
import type { Diagnostic, DiagnosticCode } from '../types.ts';
import { synthesisAllowedOf, synthesizesOblique, weightOf } from './computed.ts';
import type { ResolvedElement, ResolvedText, ResolvedValue } from './resolve.ts';
import { valueToString } from './resolve.ts';
import { analyzeDecorations } from './text-decoration.ts';

const text = (el: ResolvedElement, p: Parameters<ResolvedElement['props']['get']>[0]): string => valueToString((el.props.get(p) as ResolvedValue).value);
const isInline = (el: ResolvedElement): boolean => text(el, 'display') === 'inline';

/** Why each target refuses one small-caps text, as [targets, code, reason]; empty when every target draws it. */
function refusals(t: ResolvedText, owner: ResolvedElement, block: ResolvedElement, truncating: string | null, decorated: boolean, targets: readonly string[], realFace: boolean): [readonly string[], DiagnosticCode, string][] {
  const native = targets.filter((x) => x === 'ios' || x === 'android');
  const out: [readonly string[], DiagnosticCode, string][] = [];
  const all = (why: string): void => void out.push([targets, 'DRAGON_UNSUPPORTED_VALUE', why]);
  const onNative = (code: DiagnosticCode, why: string): void => void out.push([native, code, why]);
  if (realFace) all('it is drawn in a real face, which may have its own small capitals (smcp); Dragon synthesizes them over Ahem only');
  const spacing = (['letter-spacing', 'word-spacing'] as const).filter((p) => !['normal', '0px'].includes(valueToString((t.props.get(p) as ResolvedValue).value)));
  if (spacing.length > 0) all(`it has ${spacing.join(' and ')}, which Dragon does not lay out with small capitals yet`);
  if (valueToString((t.props.get('white-space-collapse') as ResolvedValue).value) !== 'collapse') all('its white space is preserved, which Dragon does not lay out with small capitals yet');
  if (text(block, 'text-align') === 'justify') all(`its block ${block.element.address} is justified, which Dragon does not lay out with small capitals yet`);
  if (truncating !== null) all(`${truncating} may end its line in an ellipsis, which Dragon does not place after small capitals yet`);
  if (synthesizesOblique(owner.props)) onNative('DRAGON_UNSUPPORTED_FONT', 'Chrome also draws it in synthetic oblique, which the native views do not combine with small capitals');
  if (synthesisAllowedOf(owner.props).weight && weightOf(owner.props.get('font-weight') as ResolvedValue) >= 600) onNative('DRAGON_UNSUPPORTED_FONT', 'Chrome also draws it in synthetic bold, which the native views do not combine with small capitals');
  if (decorated) onNative('DRAGON_UNSUPPORTED_VALUE', 'a text decoration reaches it, which the native views do not draw over small capitals yet');
  if (text(owner, 'text-shadow') !== 'none') onNative('DRAGON_UNSUPPORTED_VALUE', 'it has a text-shadow, which the native views do not draw for small capitals yet');
  if (text(owner, 'text-transform') !== 'none') onNative('DRAGON_UNSUPPORTED_VALUE', 'it has a text-transform, which the native views do not combine with small capitals yet');
  return out.filter(([on]) => on.length > 0);
}

export function checkSmallCaps(root: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>, shapedAt: (address: string) => boolean): void {
  const decorated = new Set(analyzeDecorations(root).applied.keys());
  // block: the text's block container (its nearest ancestor that is not an inline box); truncating: an ancestor that may truncate its lines.
  const walk = (el: ResolvedElement, block: ResolvedElement, truncating: string | null): void => {
    if (text(el, 'display') === 'none') return;
    const here = el !== root && isInline(el) ? block : el;
    const clamps = text(el, '-webkit-line-clamp') !== 'none' ? `-webkit-line-clamp on ${el.element.address}` : text(el, 'text-overflow') === 'ellipsis' ? `text-overflow: ellipsis on ${el.element.address}` : null;
    const below = truncating ?? clamps;
    for (const c of el.children) {
      if (c.kind === 'element') {
        walk(c, here, below);
        continue;
      }
      if (!c.smallCaps) continue;
      for (const [on, code, why] of refusals(c, el, here, below, decorated.has(c.node.address), targets, shapedAt(c.node.address))) {
        for (const t of on) {
          const id = `${t}|small-caps|${why}|${c.node.address}`;
          if (reported.has(id)) continue;
          reported.add(id);
          diagnostics.push(diagnostic(code, {
            origin: c.node.node.origin,
            target: t,
            message: `font-variant-caps: small-caps reaches text ${c.node.address}, and ${why}`,
            manual: `Set font-variant-caps to normal on the text of ${el.element.address}, or remove what the message names.`,
            ...(code === 'DRAGON_UNSUPPORTED_VALUE' ? { basis: 'computed-value' as const } : {}),
          }));
        }
      }
    }
  };
  walk(root, root, null);
}
