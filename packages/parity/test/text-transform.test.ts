// TXT2-e (notes/T149-txt2-spec.md R7, R8) against the pinned Chrome: the build-time transform equals Chrome's innerText over a
// corpus of every code point with a case mapping (each under uppercase, lowercase and capitalize), SpecialCasing, Final_Sigma
// contexts, NBSP, the R8 punctuation set and text runs across inline boxes; the word boundaries equal Chrome's
// Intl.Segmenter('word') over WordBreakTest-16.0.0 and the corpus; Chrome parses exactly Dragon's grammar; and each plant of
// faults/txt2-e.ts makes a named case differ from Chrome. Georgian is refused natively (R7), so it is not compared.
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LinkedText } from '../../dragon/src/analysis/link.ts';
import type { TextTransform } from '../../dragon/src/analysis/text-transform.ts';
import { applyTextTransform, transformRun } from '../../dragon/src/analysis/text-transform.ts';
import { isDictionary, wordBoundaries } from '../../dragon/src/analysis/word-break.ts';
import { FULL_CODE_POINTS, SIMPLE_LOWER, SIMPLE_TITLE, SIMPLE_UPPER } from '../../dragon/src/analysis/case-data.generated.ts';
import type { Txt2eFaults } from '../../dragon/src/faults/txt2-e.ts';
import { TXT2_E_FAULTS } from '../../dragon/src/faults/txt2-e.ts';
import { repoPath } from '../src/paths.ts';

type Page = { setContent(html: string): Promise<void>; evaluate(expression: string): Promise<unknown> };
type Browser = { newPage(o?: object): Promise<Page>; close(): Promise<void> };
const chrome = async (): Promise<Browser> => ((await import(new URL('../src/chrome.ts', import.meta.url).href)) as { launchChrome: () => Promise<Browser> }).launchChrome();

const GEORGIAN = /[Ⴀ-ჿᲐ-Ჿⴀ-⴯]/u;
const TRANSFORMS: readonly Exclude<TextTransform, 'none'>[] = ['uppercase', 'lowercase', 'capitalize'];

/** One corpus case: text runs in one inline formatting context, each in its own span with its own transform, or a <br>. */
type Run = { readonly text: string; readonly transform: TextTransform } | 'br';
type Case = { readonly name: string; readonly runs: readonly Run[] };

const one = (name: string, text: string, transform: TextTransform): Case => ({ name, runs: [{ text, transform }] });

function corpus(): Case[] {
  const cps = new Set<number>();
  for (const list of [SIMPLE_UPPER, SIMPLE_LOWER, SIMPLE_TITLE]) for (let i = 0; i < list.length; i += 2) cps.add(list[i] as number);
  for (const cp of FULL_CODE_POINTS) cps.add(cp);
  const out: Case[] = [];
  for (const cp of [...cps].sort((a, b) => a - b)) {
    const ch = String.fromCodePoint(cp);
    if (GEORGIAN.test(ch)) continue;
    const hex = cp.toString(16).padStart(4, '0');
    out.push(one(`U+${hex} uppercase`, `${ch}a${ch}`, 'uppercase'));
    out.push(one(`U+${hex} lowercase`, `A${ch}a${ch}`, 'lowercase'));
    out.push(one(`U+${hex} capitalize`, `x ${ch}${ch} ${ch}a`, 'capitalize'));
  }
  const sigma: readonly string[] = ['Σ', 'ΑΣ', 'ΣΑ', 'ΑΣΑ', 'ΑΣ Α', "Α'Σ", "ΑΣ'Α", 'ᾼΣ', 'ΑΣͅ', 'ΑΣͅΑ', 'ʰΣ', 'ΑΣ1', 'Α­Σ', 'ΑΣ­Α', 'ΑΣ.Α', 'ΣΑΣ ΣΑΣ', '1Σ', 'ΑΣ‍Α'];
  sigma.forEach((s, i) => out.push(one(`final sigma ${i}`, s, 'lowercase')));
  const words: readonly string[] = ["can't", 'x.y', 'a.b', 'a:b', 'x,y', 'foo_bar', '3.5x', 'e.g.', 'U.S.A', 'a’b', 'a．b', 'a﹕b', 'a：b', 'a·b', '1,000x', 'a1.b2', "a'b.c", '가a', '漢a', 'カa', 'a-b', 'a/b', '(a)', '"a"', 'a b', ' a', 'a  b', 'mIxED cASE', 'ﬁsh ǆemal ǳ', '\u{10428}x \u{1e922}y', 'áb ć', 'éa', '👍a', '🇫🇷a'];
  words.forEach((w, i) => {
    for (const t of TRANSFORMS) out.push(one(`word ${i} ${t}`, w, t));
  });
  const runs = (name: string, transform: TextTransform, ...parts: (string | 'br')[]): Case => ({ name, runs: parts.map((p) => (p === 'br' ? 'br' : { text: p, transform })) });
  out.push(runs('nodes abcd efgh', 'capitalize', 'ab', 'cd', ' ', 'ef', 'gh'));
  out.push(runs('nodes after space', 'capitalize', 'ab ', 'cd'));
  out.push(runs('nodes after nbsp', 'capitalize', 'ab ', 'cd'));
  out.push(runs('nodes after apostrophe', 'capitalize', "can'", 't'));
  out.push(runs('nodes after full stop', 'capitalize', 'a.', 'b'));
  out.push(runs('nodes after digit', 'capitalize', '3', 'x'));
  out.push(runs('nodes across br', 'capitalize', 'ab', 'br', 'cd'));
  // LayoutText::PreviousCharacter is one UChar: after a supplementary letter it is the lone low surrogate (Word_Break Other), so
  // the next node starts a word, though the whole letter (ALetter) would not.
  out.push(runs('nodes after supplementary letter', 'capitalize', '\u{10428}', 'x'));
  out.push(runs('nodes after supplementary letter 2', 'capitalize', 'a\u{1e922}', 'yz'));
  out.push({ name: 'nodes mixed transforms', runs: [{ text: 'ab', transform: 'uppercase' }, { text: 'cd', transform: 'capitalize' }, { text: ' ef', transform: 'none' }, { text: 'gh', transform: 'capitalize' }] });
  out.push(runs('final sigma per node', 'lowercase', 'ΑΣ', 'Α'));
  return out;
}

/** Dragon's text of a case: every run transformed by transformRun, then joined (a <br> as a newline). */
function dragonText(c: Case, faults: Txt2eFaults): string {
  const nodes = c.runs.map((r) => (r === 'br' ? null : ({ kind: 'text', text: r.text, address: '' } as unknown as LinkedText)));
  const out = transformRun(c.runs.map((r, i) => (r === 'br' ? { kind: 'break' as const } : { kind: 'text' as const, node: nodes[i] as LinkedText, transform: r.transform })), faults);
  return nodes.map((n) => (n === null ? '\n' : (out.get(n) as string))).join('');
}

const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const caseHtml = (c: Case): string => `<div>${c.runs.map((r) => (r === 'br' ? '<br>' : `<span style="text-transform:${r.transform}">${escapeHtml(r.text)}</span>`)).join('')}</div>`;
// innerText may report U+00A0 as a space; both sides compare with U+00A0 read as a space.
const nbspAsSpace = (s: string): string => s.replaceAll(' ', ' ');

let browser: Browser;
let page: Page;
beforeAll(async () => {
  browser = await chrome();
  page = await browser.newPage();
}, 120_000);
afterAll(async () => {
  await browser?.close();
});

const CASES = corpus();
let chromeTexts: readonly string[] = [];

async function chromeInnerTexts(cases: readonly Case[]): Promise<string[]> {
  await page.setContent(`<!DOCTYPE html><style>body{margin:0;white-space:pre}</style><body>${cases.map(caseHtml).join('')}</body>`);
  return (await page.evaluate('[...document.body.children].map((d) => d.innerText)')) as string[];
}

/** The names of the cases whose Dragon text differs from Chrome's under the faults. */
function misses(faults: Txt2eFaults): string[] {
  return CASES.flatMap((c, i) => (nbspAsSpace(dragonText(c, faults)) === nbspAsSpace(chromeTexts[i] as string) ? [] : [`${c.name}: dragon ${JSON.stringify(dragonText(c, faults))} chrome ${JSON.stringify(chromeTexts[i])}`]));
}

describe('text-transform against Chrome innerText (R7)', () => {
  it('reads Chrome', async () => {
    chromeTexts = await chromeInnerTexts(CASES);
    expect(chromeTexts.length).toBe(CASES.length);
    expect(CASES.length).toBeGreaterThan(4000);
  }, 120_000);
  it('every corpus case equals Chrome N/N', () => {
    expect(misses(TXT2_E_FAULTS)).toEqual([]);
  });
  const PLANTS: { readonly [P in keyof Txt2eFaults]: string } = {
    finalSigmaIgnored: 'final sigma 1',
    specialCasingDropped: 'U+00df uppercase',
    capitalizeAfterApostrophe: 'word 0 capitalize',
    capitalizePrevCharReset: 'nodes abcd efgh',
  };
  it('every fault of the feature has a named case', () => {
    expect(Object.keys(PLANTS).sort()).toEqual(Object.keys(TXT2_E_FAULTS).sort());
  });
  for (const [name, caseName] of Object.entries(PLANTS) as [keyof Txt2eFaults, string][]) {
    it(`plant ${name} makes ${caseName} differ from Chrome`, () => {
      const planted = misses({ ...TXT2_E_FAULTS, [name]: true });
      expect(planted.some((m) => m.startsWith(`${caseName}:`)), planted.slice(0, 5).join('\n')).toBe(true);
    });
  }
  it('none leaves the text as written', () => {
    expect(applyTextTransform('MiXed ß', 'none', ' ', TXT2_E_FAULTS)).toBe('MiXed ß');
  });
});

describe("word boundaries against Chrome's Intl.Segmenter('word') (R8)", () => {
  /** Chrome's boundaries of each string, as UTF-16 offsets from 0 to its length. */
  async function segmenter(strings: readonly string[]): Promise<number[][]> {
    return (await page.evaluate(`(() => { const s = new Intl.Segmenter('en-US', { granularity: 'word' }); return (${JSON.stringify(strings)}).map((t) => { const b = [...s.segment(t)].map((x) => x.index); if (t.length > 0) b.push(t.length); return b; }); })()`)) as number[][];
  }
  /** Boundaries outside dictionary runs: ICU's dictionary engines split those, which never changes a case mapping. */
  const outsideDictionary = (s: string, bounds: readonly number[]): number[] => bounds.filter((b) => {
    const pair = b >= 2 && /[\ud800-\udbff]/.test(s[b - 2] as string) && /[\udc00-\udfff]/.test(s[b - 1] as string);
    const before = b > 0 ? s.codePointAt(pair ? b - 2 : b - 1) : undefined;
    const after = b < s.length ? s.codePointAt(b) : undefined;
    return !(before !== undefined && after !== undefined && isDictionary(before) && isDictionary(after));
  });
  it('WordBreakTest-16.0.0 and the corpus strings: equal N/N', async () => {
    const strings: string[] = [];
    for (const raw of readFileSync(repoPath('vendor/unicode/16.0.0/WordBreakTest.txt'), 'utf8').split('\n')) {
      const body = (raw.split('#')[0] as string).trim();
      if (body === '') continue;
      strings.push(body.split(/\s+/).filter((t) => t !== '÷' && t !== '×').map((h) => String.fromCodePoint(parseInt(h, 16))).join(''));
    }
    for (const c of CASES) for (const r of c.runs) if (r !== 'br' && r.transform === 'capitalize') strings.push(` ${r.text.replaceAll(' ', ' ')}`);
    const got = await segmenter(strings);
    const bad = strings.flatMap((s, i) => {
      const ours = outsideDictionary(s, wordBoundaries(s, 'chrome'));
      const theirs = outsideDictionary(s, got[i] as number[]);
      return JSON.stringify(ours) === JSON.stringify(theirs) ? [] : [`${JSON.stringify(s)}: dragon ${ours.join(',')} chrome ${theirs.join(',')}`];
    });
    expect(bad).toEqual([]);
    expect(strings.length).toBeGreaterThan(1826);
  }, 120_000);
});

describe('grammar (R2): Chrome 145 parses exactly what Dragon accepts', () => {
  it('none, capitalize, uppercase, lowercase and math-auto parse; full-width, full-size-kana and pairs do not', async () => {
    const values = ['none', 'capitalize', 'uppercase', 'lowercase', 'math-auto', 'UPPERCASE', 'full-width', 'full-size-kana', 'uppercase full-width', 'capitalize full-size-kana', 'uppercase lowercase', 'left'];
    const parsed = (await page.evaluate(`(${JSON.stringify(values)}).map((v) => CSS.supports('text-transform', v))`)) as boolean[];
    expect(Object.fromEntries(values.map((v, i) => [v, parsed[i]]))).toEqual({
      none: true, capitalize: true, uppercase: true, lowercase: true, 'math-auto': true, UPPERCASE: true,
      'full-width': false, 'full-size-kana': false, 'uppercase full-width': false, 'capitalize full-size-kana': false, 'uppercase lowercase': false, left: false,
    });
  });
});
