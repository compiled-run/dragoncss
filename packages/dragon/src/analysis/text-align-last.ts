// css-text-3 §7.2 text-align-last at build time (TXT2-tal). The engine aligns every line of a block container by text-align, and a
// justified block's last line, and each line before a forced break, at start: text-align-last: auto. Any other value is accepted
// where it puts those lines on the same side as auto in the text's direction (center with text-align: center, start or left in a
// left-to-right justified block, ...), which fixture group text-align-last proves against Chrome; every target refuses the rest at
// the text-align-last declaration, once per block container whose inline formatting context holds text or an atomic inline.
import { authored, diagnostic } from '../diagnostics/catalogue.ts';
import type { Txt2talFaults } from '../faults/txt2-tal.ts';
import type { Diagnostic } from '../types.ts';
import type { ResolvedElement, ResolvedValue } from './resolve.ts';

const keyword = (v: ResolvedValue | undefined): string => (v !== undefined && v.value.kind === 'keyword' ? v.value.value : '');

/** Where a line aligned by `value` sits in `direction`: left, right, center or justify; null for a value the engine does not read. */
function side(value: string, direction: string): string | null {
  const rtl = direction === 'rtl';
  if (value === 'start') return rtl ? 'right' : 'left';
  if (value === 'end') return rtl ? 'left' : 'right';
  if (value === 'left' || value === 'right' || value === 'center' || value === 'justify') return value;
  return null;
}

/**
 * el's own text-align-last, read with its own text-align and direction, where el is a block container whose inline formatting context
 * holds inline content (text or an atomic inline; holdsInline): Chrome aligns the lines by the container's style, so values set on an
 * inline box are ignored.
 */
export function checkTextAlignLast(el: ResolvedElement, holdsInline: boolean, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>, faults: Txt2talFaults): void {
  if (faults.alignLastAccepted || !holdsInline) return;
  const v = el.props.get('text-align-last') as ResolvedValue | undefined;
  const last = keyword(v);
  if (v === undefined || last === 'auto' || last === '') return;
  const align = keyword(el.props.get('text-align') as ResolvedValue | undefined);
  const direction = keyword(el.props.get('direction') as ResolvedValue | undefined);
  // auto's last line: text-align's side, or start in a justified block.
  const auto = side(align === 'justify' ? 'start' : align, direction);
  const own = side(last, direction);
  if (auto !== null && own === auto) return;
  const origin = v.declaration === null ? el.element.node.origin : authored(v.declaration.valueSpan);
  for (const t of targets) {
    const id = `${t}|text-align-last|${el.element.address}`;
    if (reported.has(id)) continue;
    reported.add(id);
    diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
      origin,
      target: t,
      message: `text-align-last: ${last} on ${el.element.address}, whose text-align is ${align} in a ${direction} block: the engine aligns the last line as text-align-last: auto does, at ${auto ?? align} (TXT2-tal)`,
      manual: `Remove the text-align-last declaration that reaches ${el.element.address}, or give it the value that aligns as auto does.`,
      basis: 'computed-value',
    }));
  }
}
