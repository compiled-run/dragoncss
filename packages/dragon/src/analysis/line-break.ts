// css-text-3 §5.3 line-break at build time (TXT2-lb). The engine lays every text out with auto's line breaking; loose, normal and
// strict break differently only around CJK characters, small kana, iteration marks and CJK punctuation, so they are laid out as auto
// over the text fixture group text-line-break proves equal to auto in Chrome: ASCII letters, digits, white space and the
// punctuation . , - / ( ) ! ? : ; in Ahem. Every target refuses any other character, and text drawn in a real face (whose line
// breaker Chrome runs through ICU's strictness rules, which no Chrome case compares), at the line-break declaration that reaches it.
import { authored, diagnostic } from '../diagnostics/catalogue.ts';
import type { Txt2lbFaults } from '../faults/txt2-lb.ts';
import type { Diagnostic } from '../types.ts';
import type { ResolvedElement, ResolvedValue } from './resolve.ts';

/** The code points the text-line-break fixtures cover, beside ASCII letters and digits. */
const COVERED_PUNCTUATION: ReadonlySet<number> = new Set(Array.from('.,-/()!?:;', (c) => c.codePointAt(0) as number));
const isAsciiAlphanumeric = (cp: number): boolean => (cp >= 0x30 && cp <= 0x39) || (cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a);
// Collapsible white space: a collapsed run is laid out as spaces.
const isWhiteSpace = (cp: number): boolean => cp === 0x20 || cp === 0x09 || cp === 0x0a || cp === 0x0d || cp === 0x0c;
const covered = (cp: number): boolean => isAsciiAlphanumeric(cp) || isWhiteSpace(cp) || COVERED_PUNCTUATION.has(cp);

export function checkLineBreak(el: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>, shapedAt: (address: string) => boolean, faults: Txt2lbFaults): void {
  const v = el.props.get('line-break') as ResolvedValue | undefined;
  if (v === undefined || v.value.kind !== 'keyword' || v.value.value === 'auto') return;
  const value = v.value.value;
  for (const c of el.children) {
    if (c.kind !== 'text') continue;
    const refuse = (message: string, manual: string): void => {
      const origin = v.declaration === null ? el.element.node.origin : authored(v.declaration.valueSpan);
      for (const t of targets) {
        const id = `${t}|line-break|${JSON.stringify(origin)}|${c.node.address}`;
        if (reported.has(id)) continue;
        reported.add(id);
        diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin, target: t, message, manual, basis: 'computed-value' }));
      }
    };
    if (shapedAt(c.node.address) && !faults.lineBreakOnRealFaceAccepted) {
      refuse(`line-break: ${value} on ${c.node.address}, which is drawn in a real face: line-break ${value} is laid out over Ahem only (TXT2-lb)`, `Remove the line-break declaration that reaches ${c.node.address}.`);
      continue;
    }
    if (faults.lineBreakOutsideAsciiAccepted) continue;
    for (const ch of c.text) {
      const cp = ch.codePointAt(0) as number;
      if (covered(cp)) continue;
      refuse(`line-break: ${value} on ${c.node.address}, which holds U+${cp.toString(16).toUpperCase().padStart(4, '0')}: line-break ${value} is laid out as auto over ASCII letters, digits, spaces and . , - / ( ) ! ? : ; only (TXT2-lb)`, `Remove the line-break declaration that reaches ${c.node.address}, or keep its text to those characters.`);
      break;
    }
  }
}
