// css-text-3 §2.1 text-transform at build time (TXT2-e, notes/T149-txt2-spec.md R7): the compiler rewrites static text before
// white-space processing, as Chrome transforms a text node's DOM string before its inline items are built. uppercase and lowercase
// are Unicode 16.0.0 full case mappings with no language (the root locale ICU's CaseMap uses when no lang applies): the simple
// mappings, the unconditional SpecialCasing entries, and Final_Sigma for lowercase, each text node on its own. capitalize ports
// Blink's Capitalize (third_party/blink/renderer/platform/text/capitalize.cc, BSD): word boundaries over the text with the previous
// character of the inline formatting context in front, NBSP read as a space, and the simple titlecase of each word's first UTF-16
// code unit. The web output keeps the authored text and the property; native targets lay out the transformed string.
import { authored, diagnostic } from '../diagnostics/catalogue.ts';
import type { Diagnostic } from '../types.ts';
import type { Txt2eFaults } from '../faults/txt2-e.ts';
import { CASE_IGNORABLE, CASED, FINAL_SIGMA_LOWER, FULL_CODE_POINTS, FULL_LOWER, FULL_UPPER, SIMPLE_LOWER, SIMPLE_TITLE, SIMPLE_UPPER } from './case-data.generated.ts';
import { inRanges, wordBoundaries } from './word-break.ts';
import type { LinkedText } from './link.ts';
import type { ResolvedElement, ResolvedValue } from './resolve.ts';
import { COMPLEX_CONTEXT } from './case-data.generated.ts';

export type TextTransform = 'none' | 'uppercase' | 'lowercase' | 'capitalize';

const NBSP = ' ';

const pairs = (flat: readonly number[]): Map<number, number> => {
  const m = new Map<number, number>();
  for (let i = 0; i < flat.length; i += 2) m.set(flat[i] as number, flat[i + 1] as number);
  return m;
};
let tables: { upper: Map<number, number>; lower: Map<number, number>; title: Map<number, number>; fullUpper: Map<number, string>; fullLower: Map<number, string> } | null = null;
function data(): NonNullable<typeof tables> {
  if (tables === null) {
    const fullUpper = new Map<number, string>();
    const fullLower = new Map<number, string>();
    FULL_CODE_POINTS.forEach((cp, i) => {
      fullUpper.set(cp, FULL_UPPER[i] as string);
      fullLower.set(cp, FULL_LOWER[i] as string);
    });
    tables = { upper: pairs(SIMPLE_UPPER), lower: pairs(SIMPLE_LOWER), title: pairs(SIMPLE_TITLE), fullUpper, fullLower };
  }
  return tables;
}

const codePoints = (s: string): number[] => Array.from(s, (c) => c.codePointAt(0) as number);

/** Full uppercase with no language: SpecialCasing's unconditional entries, else UnicodeData's simple mapping. */
export function upperCase(text: string, faults: Txt2eFaults): string {
  const t = data();
  let out = '';
  for (const cp of codePoints(text)) {
    const full = faults.specialCasingDropped ? undefined : t.fullUpper.get(cp);
    out += full ?? String.fromCodePoint(t.upper.get(cp) ?? cp);
  }
  return out;
}

const cased = (cp: number): boolean => inRanges(CASED, cp);
const caseIgnorable = (cp: number): boolean => inRanges(CASE_IGNORABLE, cp);

/**
 * Unicode 16 §3.13 Final_Sigma at index i: a cased letter, then any case-ignorable characters, come before it, and no case-ignorable
 * characters then a cased letter come after it (a character both cased and case-ignorable counts as case-ignorable, as in ICU).
 */
function finalSigma(cps: readonly number[], i: number): boolean {
  let before = i - 1;
  while (before >= 0 && caseIgnorable(cps[before] as number)) before--;
  if (before < 0 || !cased(cps[before] as number)) return false;
  let after = i + 1;
  while (after < cps.length && caseIgnorable(cps[after] as number)) after++;
  return !(after < cps.length && cased(cps[after] as number));
}

/** Full lowercase with no language: Final_Sigma, SpecialCasing's unconditional entries, else UnicodeData's simple mapping. */
export function lowerCase(text: string, faults: Txt2eFaults): string {
  const t = data();
  const cps = codePoints(text);
  let out = '';
  cps.forEach((cp, i) => {
    if (cp === 0x3a3 && !faults.finalSigmaIgnored && finalSigma(cps, i)) {
      out += FINAL_SIGMA_LOWER;
      return;
    }
    const full = faults.specialCasingDropped ? undefined : t.fullLower.get(cp);
    out += full ?? String.fromCodePoint(t.lower.get(cp) ?? cp);
  });
  return out;
}

/** u_totitle of one UTF-16 code unit: a surrogate maps to itself, so a supplementary letter at a word start keeps its case. */
function titleUnit(unit: string): string {
  const u = unit.charCodeAt(0);
  if (u >= 0xd800 && u <= 0xdfff) return unit;
  return String.fromCodePoint(data().title.get(u) ?? u);
}

/**
 * capitalize.cc Capitalize(string, previous_character): previous is the last UTF-16 code unit before the text in its inline
 * formatting context (a space where there is none).
 */
export function capitalize(text: string, previous: string, faults: Txt2eFaults): string {
  if (text === '') return text;
  const sep = (c: string): string => (c === NBSP ? ' ' : c);
  const prev = faults.capitalizePrevCharReset ? ' ' : previous;
  let withPrevious = sep(prev);
  for (const c of text.split('')) withPrevious += sep(c);
  // Plant capitalizeAfterApostrophe: an apostrophe ends a word, so "can't" becomes "Can'T".
  const bounds = faults.capitalizeAfterApostrophe ? [...new Set([...wordBoundaries(withPrevious), ...apostropheEnds(withPrevious)])].sort((a, b) => a - b) : wordBoundaries(withPrevious);
  let out = '';
  for (let k = 0; k + 1 < bounds.length; k++) {
    const start = bounds[k] as number;
    const end = bounds[k + 1] as number;
    // The first boundary is the previous character's own word start, which is not part of the text.
    if (start > 0) out += text[start - 1] === NBSP ? NBSP : titleUnit(withPrevious[start] as string);
    out += text.slice(start, end - 1);
  }
  return out;
}

function apostropheEnds(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) if (s[i] === "'") out.push(i, i + 1);
  return out;
}

/** The transformed text of one text node. */
export function applyTextTransform(text: string, transform: TextTransform, previous: string, faults: Txt2eFaults): string {
  switch (transform) {
    case 'none':
      return text;
    case 'uppercase':
      return upperCase(text, faults);
    case 'lowercase':
      return lowerCase(text, faults);
    case 'capitalize':
      return capitalize(text, previous, faults);
  }
}

/** The computed text-transform of an element (the four keywords the parser keeps; math-auto is refused there). */
export function textTransformOf(props: ReadonlyMap<string, ResolvedValue>): TextTransform {
  const v = (props.get('text-transform') as ResolvedValue | undefined)?.value;
  if (v === undefined) throw new Error('text-transform is not resolved');
  if (v.kind === 'keyword' && (v.value === 'none' || v.value === 'uppercase' || v.value === 'lowercase' || v.value === 'capitalize')) return v.value;
  throw new Error(`text-transform ${JSON.stringify(v)} is not none, uppercase, lowercase or capitalize`);
}

/**
 * One item of an inline formatting context in tree order, for the transform: a text node with its insertion parent's
 * text-transform, or a box that ends the previous character: a <br> or a replaced element (Chrome takes a space before text after
 * one), or an atomic inline (Chrome takes the last character inside it, which the compiler does not track, so capitalize after one
 * is refused).
 */
export type TransformItem = { readonly kind: 'text'; readonly node: LinkedText; readonly transform: TextTransform } | { readonly kind: 'break' } | { readonly kind: 'atomic' };

const GEORGIAN = /[Ⴀ-ჿᲐ-Ჿⴀ-⴯]/u;

/** Why native targets refuse a text node's transform (keyed by the text node), set by transformRun; web keeps the property. */
const REFUSALS = new WeakMap<LinkedText, string>();

/** The transformed text of each text item of an inline formatting context, carrying the previous character in tree order. */
export function transformRun(items: readonly TransformItem[], faults: Txt2eFaults): Map<LinkedText, string> {
  const out = new Map<LinkedText, string>();
  let previous = ' ';
  let afterAtomic = false;
  for (const it of items) {
    if (it.kind !== 'text') {
      previous = it.kind === 'break' ? '\n' : ' ';
      afterAtomic = it.kind === 'atomic';
      continue;
    }
    const source = it.node.text;
    out.set(it.node, applyTextTransform(source, it.transform, previous, faults));
    REFUSALS.delete(it.node);
    if (it.transform !== 'none' && GEORGIAN.test(source)) {
      REFUSALS.set(it.node, 'it holds Georgian, whose uppercase Chrome maps back from the Mtavruli capitals Unicode 11 added');
    } else if (it.transform === 'capitalize' && afterAtomic) {
      REFUSALS.set(it.node, 'it follows an atomic inline, whose last character Chrome carries into the word boundaries');
    } else if (it.transform === 'capitalize' && codePoints(previous + source).some((cp) => inRanges(COMPLEX_CONTEXT, cp))) {
      REFUSALS.set(it.node, 'it holds Complex_Context text (Thai, Lao, Khmer, Myanmar), whose word boundaries Chrome finds with dictionaries');
    }
    if (source === '') continue;
    previous = (out.get(it.node) as string).slice(-1);
    afterAtomic = false;
  }
  return out;
}

/**
 * The native refusals of transformed text (R7, TXT2-e2): Georgian, capitalize after an atomic inline, and capitalize over
 * Complex_Context text. Web output keeps the authored text and the property, so Chrome transforms it there.
 */
export function checkTextTransform(root: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>): void {
  const native = targets.filter((t) => t === 'ios' || t === 'android');
  if (native.length === 0) return;
  const walk = (el: ResolvedElement): void => {
    for (const c of el.children) {
      if (c.kind === 'element') {
        walk(c);
        continue;
      }
      const reason = REFUSALS.get(c.node);
      if (reason === undefined) continue;
      const transform = textTransformOf(el.props);
      for (const t of native) {
        const id = `${t}|text-transform|${c.node.address}`;
        if (reported.has(id)) continue;
        reported.add(id);
        const v = el.props.get('text-transform') as ResolvedValue;
        const origin = v.declaration === null ? c.node.node.origin : authored(v.declaration.valueSpan);
        diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
          origin,
          target: t,
          message: `text-transform: ${transform} on text ${c.node.address} is unsupported on ${t} until TXT2-e2: ${reason}`,
          manual: `Write the text of ${c.node.address} in the case you want, or set text-transform: none on it.`,
          basis: 'computed-value',
        }));
      }
    }
  };
  walk(root);
}
