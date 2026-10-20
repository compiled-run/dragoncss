// css-text-3 §5.2 word-break at build time (TXT2-d, TXT-BREAK-2). The engine lays break-all out over the Latin set (ASCII, U+00A0 to
// U+00FF and the common punctuation of BREAK_ALL_EXTRA) by Chrome 145's pair table, and keep-all as normal, in Ahem and in a real
// face alike (inline.ts breakAllOpportunities, test/fixtures/linebreak/chrome145-break-all.json); fixture groups text-word-break and
// text-break prove both against Chrome. Every target refuses break-all over any other character, and over U+00AD, whose break Chrome
// draws with a hyphen. auto-phrase has no support row. Refused at the word-break declaration that reaches the text.
import { authored, diagnostic } from '../diagnostics/catalogue.ts';
import type { Txt2dFaults } from '../faults/txt2-d.ts';
import type { Diagnostic } from '../types.ts';
import type { ResolvedElement, ResolvedText, ResolvedValue } from './resolve.ts';

const SOFT_HYPHEN = 0xad;
// The punctuation past U+00FF that the pair table measures (layout inline.ts BREAK_ALL_EXTRA).
const EXTRA: readonly number[] = [0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2018, 0x2019, 0x201c, 0x201d, 0x2026, 0x200b];
// Collapsible white space: a collapsed run is laid out as spaces (break-all is refused with preserved white space elsewhere).
const isWhiteSpace = (cp: number): boolean => cp === 0x09 || cp === 0x0a || cp === 0x0d || cp === 0x0c;
const inSet = (cp: number): boolean => (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff && cp !== SOFT_HYPHEN) || isWhiteSpace(cp) || EXTRA.includes(cp);

export function checkWordBreak(el: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>, faults: Txt2dFaults): void {
  // A text node inherits word-break from el with no declaration of its own, so el's value carries the declaration to point at.
  const v = el.props.get('word-break') as ResolvedValue | undefined;
  if (v === undefined || v.value.kind !== 'keyword' || v.value.value !== 'break-all' || faults.breakAllOutsideSetAccepted) return;
  for (const c of el.children) {
    if (c.kind !== 'text') continue;
    const other = outsideSet(c);
    if (other === null) continue;
    const origin = v.declaration === null ? el.element.node.origin : authored(v.declaration.valueSpan);
    const message = `word-break: break-all on ${c.node.address}, which holds U+${other.toString(16).toUpperCase().padStart(4, '0')}: break-all is laid out over Latin text only (TXT-BREAK-2)`;
    const manual = `Remove the word-break declaration that reaches ${c.node.address}, or keep its text to ASCII, U+00A0 to U+00FF without the soft hyphen, and common punctuation.`;
    for (const t of targets) {
      const id = `${t}|word-break|${JSON.stringify(origin)}|${c.node.address}`;
      if (reported.has(id)) continue;
      reported.add(id);
      diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin, target: t, message, manual, basis: 'computed-value' }));
    }
  }
}

function outsideSet(t: ResolvedText): number | null {
  for (const ch of t.text) {
    const cp = ch.codePointAt(0) as number;
    if (!inSet(cp)) return cp;
  }
  return null;
}
