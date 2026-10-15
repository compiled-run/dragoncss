// css-text-3 §5.2 word-break at build time (TXT2-d, notes/T149-txt2-spec.md R15). The engine lays break-all out over ASCII letters,
// digits and spaces, and keep-all as normal (inline.ts buildIfc, breakAllOpportunities); fixture group text-word-break proves both
// over Ahem against Chrome. Every target refuses what no Chrome case proves: break-all over any other character, where Blink's
// break-all line breaker (ICU's line rules with letters and numbers as ideographs) decides, and either value over text drawn in a
// real face, whose shaped line breaker (linebreak.ts) takes normal only. auto-phrase has no support row. Refused at the word-break
// declaration that reaches the text.
import { authored, diagnostic } from '../diagnostics/catalogue.ts';
import type { Txt2dFaults } from '../faults/txt2-d.ts';
import type { Diagnostic } from '../types.ts';
import type { ResolvedElement, ResolvedText, ResolvedValue } from './resolve.ts';

const isAsciiAlphanumeric = (cp: number): boolean => (cp >= 0x30 && cp <= 0x39) || (cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a);
// Collapsible white space: a collapsed run is laid out as spaces (break-all is refused with preserved white space elsewhere).
const isWhiteSpace = (cp: number): boolean => cp === 0x20 || cp === 0x09 || cp === 0x0a || cp === 0x0d || cp === 0x0c;

export function checkWordBreak(el: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>, shapedAt: (address: string) => boolean, faults: Txt2dFaults): void {
  for (const c of el.children) {
    if (c.kind !== 'text') continue;
    const v = c.props.get('word-break') as ResolvedValue;
    const value = v.value.kind === 'keyword' ? v.value.value : null;
    if (value !== 'break-all' && value !== 'keep-all') continue;
    const refuse = (message: string, manual: string): void => {
      const origin = v.declaration === null ? el.element.node.origin : authored(v.declaration.valueSpan);
      for (const t of targets) {
        const id = `${t}|word-break|${JSON.stringify(origin)}|${c.node.address}`;
        if (reported.has(id)) continue;
        reported.add(id);
        diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin, target: t, message, manual, basis: 'computed-value' }));
      }
    };
    if (shapedAt(c.node.address) && !faults.wordBreakOnRealFaceAccepted) {
      refuse(`word-break: ${value} on ${c.node.address}, which is drawn in a real face: word-break ${value} is laid out over Ahem only (TXT2-d)`, `Remove the word-break declaration that reaches ${c.node.address}.`);
      continue;
    }
    if (value === 'break-all' && !faults.breakAllOutsideAsciiAccepted) {
      const other = outsideAscii(c);
      if (other !== null) refuse(`word-break: break-all on ${c.node.address}, which holds U+${other.toString(16).toUpperCase().padStart(4, '0')}: break-all is laid out over ASCII letters, digits and spaces only (TXT2-d)`, `Remove the word-break declaration that reaches ${c.node.address}, or keep its text to ASCII letters, digits and spaces.`);
    }
  }
}

function outsideAscii(t: ResolvedText): number | null {
  for (const ch of t.text) {
    const cp = ch.codePointAt(0) as number;
    if (!isWhiteSpace(cp) && !isAsciiAlphanumeric(cp)) return cp;
  }
  return null;
}
