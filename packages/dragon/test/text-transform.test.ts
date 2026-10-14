// TXT2-e (notes/T149-txt2-spec.md R7, R8): text-transform folded into static text at build time. The case data and the word
// boundaries against the Unicode 16.0.0 files and the Chrome 145 probes the spec records, the call site before white-space
// collapsing, the grammar Chrome parses, the native refusals, and each plant caught by a named case. The full corpus against
// Chrome's innerText and Intl.Segmenter is packages/parity/test/text-transform.test.ts.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { TreeNode } from '../src/index.ts';
import { createProjectWith, NO_FAULTS, nativePrograms } from '../src/internal.ts';
import type { CompilerFaults } from '../src/faults.ts';
import type { Txt2eFaults } from '../src/faults/txt2-e.ts';
import { TXT2_E_FAULTS } from '../src/faults/txt2-e.ts';
import { applyTextTransform, capitalize, lowerCase, upperCase } from '../src/analysis/text-transform.ts';
import { wordBoundaries } from '../src/analysis/word-break.ts';
import { CASE_UNICODE_VERSION } from '../src/analysis/case-data.generated.ts';
import { div, inputFor, text } from './helpers.ts';

const F = TXT2_E_FAULTS;
const WORD_BREAK_TEST = new URL('../../../vendor/unicode/16.0.0/WordBreakTest.txt', import.meta.url);
const WORD_BREAK_TEST_SHA256 = 'ad985d5721f3fa6b45495663dfe44180f2f68976100dee0ea7451ef1a8f838e8';

/** The words of a string under a rule set, joined by |. */
const words = (s: string, rules: 'uax29' | 'chrome' = 'chrome'): string => {
  const b = wordBoundaries(s, rules);
  return b.slice(0, -1).map((start, i) => s.slice(start, b[i + 1])).join('|');
};

describe('word boundaries (word-break.ts, R8)', () => {
  it('uax29 rules pass WordBreakTest-16.0.0 N/N', () => {
    const bytes = readFileSync(WORD_BREAK_TEST);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(WORD_BREAK_TEST_SHA256);
    expect(CASE_UNICODE_VERSION).toBe('16.0.0');
    let total = 0;
    const misses: string[] = [];
    for (const raw of bytes.toString('utf8').split('\n')) {
      const body = (raw.split('#')[0] as string).trim();
      if (body === '') continue;
      let s = '';
      const expected: number[] = [];
      for (const t of body.split(/\s+/)) {
        if (t === '÷') expected.push(s.length);
        else if (t !== '×') s += String.fromCodePoint(parseInt(t, 16));
      }
      total++;
      if (JSON.stringify(wordBoundaries(s, 'uax29')) !== JSON.stringify(expected)) misses.push(body);
    }
    expect(misses).toEqual([]);
    expect(total).toBe(1826);
  });
  // Chrome's ICU word rules (Chromium's word.txt with wordbrk.patch) against the annex: each tailoring row, with the Chrome 145
  // result the spec's probe recorded (R8: Capitalize and Intl.Segmenter('word') agree) or that word.txt states.
  const TAILORING: readonly { readonly row: string; readonly text: string; readonly uax29: string; readonly chrome: string }[] = [
    { row: 'full stop between letters is MidNum', text: 'a.b', uax29: 'a.b', chrome: 'a|.|b' },
    { row: 'fullwidth full stop between letters is MidNum', text: 'a．b', uax29: 'a．b', chrome: 'a|．|b' },
    { row: 'colon is not MidLetter', text: 'a:b', uax29: 'a:b', chrome: 'a|:|b' },
    { row: 'small colon is not MidLetter', text: 'a﹕b', uax29: 'a﹕b', chrome: 'a|﹕|b' },
    { row: 'fullwidth colon is not MidLetter', text: 'a：b', uax29: 'a：b', chrome: 'a|：|b' },
    { row: 'full stop between digits stays MidNum', text: '3.5x', uax29: '3.5x', chrome: '3.5x' },
    { row: 'apostrophe stays MidNumLet', text: "can't", uax29: "can't", chrome: "can't" },
    { row: 'Hangul syllables are not ALetter', text: '가a', uax29: '가a', chrome: '가|a' },
  ];
  for (const t of TAILORING) {
    it(`tailoring: ${t.row}`, () => {
      expect(words(t.text, 'uax29')).toBe(t.uax29);
      expect(words(t.text, 'chrome')).toBe(t.chrome);
    });
  }
  it('Chrome splits only where the default rules join at a tailored character: X,Y and foo_bar as the annex', () => {
    expect(words('x,y')).toBe('x|,|y');
    expect(words('foo_bar')).toBe('foo_bar');
  });
});

describe('case mappings (text-transform.ts, R7)', () => {
  it("Chrome's uppercase probe: straße ǆ ﬁ ŉ ΐ", () => {
    expect(upperCase('stra\u00dfe \u01c6 \ufb01 \u0149 \u0390', F)).toBe('STRASSE \u01c4 FI \u02bcN \u0399\u0308\u0301');
  });
  it("Chrome's lowercase probe: İSTANBUL ΣΑΣ ǅ (Final_Sigma)", () => {
    expect(lowerCase('İSTANBUL ΣΑΣ ǅ', F)).toBe('i̇stanbul σας ǆ');
  });
  it('Final_Sigma reads case-ignorable characters on both sides', () => {
    expect(lowerCase('ΑΣ', F)).toBe('ας');
    expect(lowerCase('Σ', F)).toBe('σ');
    expect(lowerCase('ΑΣΑ', F)).toBe('ασα');
    expect(lowerCase("Α'Σ", F)).toBe("α'ς");
    expect(lowerCase("ΑΣ'Α", F)).toBe("ασ'α");
  });
  it("Chrome's capitalize probes (R8): punctuation, the simple titlecase and NBSP", () => {
    expect(capitalize("can't x.y a.b a:b x,y foo_bar 3.5x", ' ', F)).toBe("Can't X.Y A.B A:B X,Y Foo_bar 3.5x");
    expect(capitalize('ﬁsh ǆemal', ' ', F)).toBe('ﬁsh ǅemal');
    expect(capitalize('one two', ' ', F)).toBe('One Two');
  });
  it('capitalize keeps the rest of a word and a supplementary first letter (u_totitle reads one UTF-16 unit)', () => {
    expect(capitalize('mIxED', ' ', F)).toBe('MIxED');
    expect(capitalize('\u{10428}x', ' ', F)).toBe('\u{10428}x');
  });
  it('capitalize carries the previous character: a letter before the text joins its first word', () => {
    expect(capitalize('cd', 'b', F)).toBe('cd');
    expect(capitalize('cd', ' ', F)).toBe('Cd');
    expect(capitalize('cd', ' ', F)).toBe('Cd');
  });
  it('previous is one UTF-16 code unit, as LayoutText::PreviousCharacter returns a UChar: after a supplementary letter, a word starts', () => {
    // The lone low surrogate of U+10428 is Word_Break Other, so x starts a word; the whole letter (ALetter) would join it.
    expect(capitalize('x', '\u{10428}'.slice(-1), F)).toBe('X');
    expect(capitalize('x', 'a', F)).toBe('x');
  });
  it('none returns the text unchanged', () => {
    expect(applyTextTransform('MiXed ß', 'none', ' ', F)).toBe('MiXed ß');
  });
});

describe('plants (faults/txt2-e.ts): each changes its named case', () => {
  const plant = (name: keyof Txt2eFaults): Txt2eFaults => ({ ...F, [name]: true });
  const cases: readonly { readonly name: keyof Txt2eFaults; readonly run: (f: Txt2eFaults) => string; readonly chrome: string }[] = [
    { name: 'finalSigmaIgnored', run: (f) => lowerCase('ΣΑΣ', f), chrome: 'σας' },
    { name: 'specialCasingDropped', run: (f) => upperCase('straße', f), chrome: 'STRASSE' },
    { name: 'capitalizeAfterApostrophe', run: (f) => capitalize("can't", ' ', f), chrome: "Can't" },
    { name: 'capitalizePrevCharReset', run: (f) => capitalize('cd', 'b', f), chrome: 'cd' },
  ];
  it('every fault of the feature has a case', () => {
    expect(cases.map((c) => c.name).sort()).toEqual(Object.keys(F).sort());
  });
  for (const c of cases) {
    it(`${c.name}: unfaulted equals Chrome, planted differs`, () => {
      expect(c.run(F)).toBe(c.chrome);
      expect(c.run(plant(c.name))).not.toBe(c.chrome);
    });
  }
});

/** A compile of one document for web, ios and android with the text-transform faults given. */
function compile(css: string, body: (r: Parameters<typeof div>[0]) => TreeNode[], faults: Partial<CompilerFaults> = {}) {
  return createProjectWith({ projectId: 'test', targets: { web: {}, ios: { minimum: '15.0' }, android: { minSdk: 31 } } }, { faults: { ...NO_FAULTS, ...faults }, profiles: 'derive', direction: 'ltr' })
    .compile(inputFor(`body { margin: 0; font-family: Ahem; font-size: 10px; } ${css}`, body));
}

const span = (r: Parameters<typeof div>[0], id: string, classes: string[], children: TreeNode[]): TreeNode => ({ ...(div(r, id, classes, children) as Extract<TreeNode, { kind: 'element' }>), tag: 'span' });

/** The text of the UIKit program's text nodes, in program order. */
function nativeTexts(c: ReturnType<typeof compile>): string[] {
  const p = nativePrograms(c, []);
  if (p.kind !== 'ready') throw new Error(p.reason);
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v !== null && typeof v === 'object') {
      const o = v as { kind?: unknown; text?: unknown };
      if (o.kind === 'text' && typeof o.text === 'string') out.push(o.text);
      Object.values(o).forEach(walk);
    }
  };
  walk(p.programs.uikit.nodes);
  return out;
}

describe('the call site (resolve.ts) and native output', () => {
  it('the transform comes before white-space collapsing, and ios lays out the transformed string', () => {
    const c = compile('.a { text-transform: uppercase; }', (r) => [div(r, 'a', ['a'], [text(r, 'at', '  straße\n   und   ß  ')])]);
    expect(c.diagnostics).toEqual([]);
    expect(nativeTexts(c)).toContain('STRASSE UND SS');
  });
  it("the previous character carries across text nodes and inline boxes: ab<span>cd</span> <span>ef</span>gh is Abcd Efgh", () => {
    const tree = (r: Parameters<typeof div>[0]): TreeNode[] => [div(r, 'a', ['a'], [text(r, 't1', 'ab'), span(r, 's1', [], [text(r, 't2', 'cd')]), text(r, 't3', ' '), span(r, 's2', [], [text(r, 't4', 'ef')]), text(r, 't5', 'gh')])];
    const c = compile('.a { text-transform: capitalize; }', tree);
    expect(c.diagnostics).toEqual([]);
    expect(nativeTexts(c).join('')).toBe('Abcd Efgh');
    // Plant capitalizePrevCharReset: every node starts a word.
    expect(nativeTexts(compile('.a { text-transform: capitalize; }', tree, { capitalizePrevCharReset: true })).join('')).toBe('AbCd EfGh');
  });
  it('a text inherits its insertion parent\'s transform; none resets it', () => {
    const c = compile('.a { text-transform: uppercase; } .n { text-transform: none; }', (r) => [div(r, 'a', ['a'], [div(r, 'n', ['n'], [text(r, 'nt', 'kept')]), div(r, 'i', [], [text(r, 'it', 'loud')])])]);
    expect(nativeTexts(c)).toEqual(['kept', 'LOUD']);
  });
});

describe('grammar (R2: as Chrome 145 parses it)', () => {
  const codes = (value: string): string[] => compile(`.a { text-transform: ${value}; }`, (r) => [div(r, 'a', ['a'], [text(r, 'at', 'x')])]).diagnostics.map((d) => d.code);
  it('none, uppercase, lowercase and capitalize, in any ASCII case', () => {
    for (const v of ['none', 'uppercase', 'lowercase', 'capitalize', 'UPPERCASE', 'inherit', 'initial', 'unset']) expect(codes(v), v).toEqual([]);
  });
  it('math-auto is refused until TXT2-e2', () => {
    expect(codes('math-auto')).toEqual(['DRAGON_UNSUPPORTED_VALUE']);
  });
  it('full-width, full-size-kana and combinations are invalid (CSSTextTransformFullWidth is off)', () => {
    for (const v of ['full-width', 'full-size-kana', 'uppercase full-width', 'capitalize full-size-kana', 'uppercase lowercase', 'left']) expect(codes(v), v).toEqual(['DRAGON_CSS_INVALID_VALUE']);
  });
});

describe('native refusals (R7, TXT2-e2)', () => {
  const refusals = (css: string, body: (r: Parameters<typeof div>[0]) => TreeNode[]) => compile(css, body).diagnostics.map((d) => `${d.code} ${d.target}`).sort();
  const NATIVE = ['DRAGON_UNSUPPORTED_VALUE android', 'DRAGON_UNSUPPORTED_VALUE ios'];
  it('Georgian under a transform is refused on ios and android; web keeps the property', () => {
    expect(refusals('.a { text-transform: uppercase; }', (r) => [div(r, 'a', ['a'], [text(r, 'at', 'ქართული')])])).toEqual(NATIVE);
    expect(refusals('.a { text-transform: none; }', (r) => [div(r, 'a', ['a'], [text(r, 'at', 'ქართული')])])).toEqual([]);
  });
  it('Georgian under a transform only in a :hover state is refused, whichever interaction state resolves last', () => {
    // interactionPartition resolves every state before checking any: each state's refusals must stay with its own resolved tree.
    const values = (css: string): string[] => compile(css, (r) => [div(r, 'a', ['a'], [text(r, 'at', '\u10e5\u10d0\u10e0\u10d7\u10e3\u10da\u10d8')])]).diagnostics
      .filter((d) => d.code === 'DRAGON_UNSUPPORTED_VALUE').map((d) => `${d.target} ${d.message.slice(0, 56)}`).sort();
    const WANT = ['android text-transform: uppercase on text a:text0 is unsupported', 'ios text-transform: uppercase on text a:text0 is unsupported'];
    expect(values('.a:hover { text-transform: uppercase; }')).toEqual(WANT);
    expect(values('.a:hover { text-transform: uppercase; } .a:active { text-transform: none; }')).toEqual(WANT);
    expect(values('.a:active { text-transform: none; } .a:hover { text-transform: uppercase; }')).toEqual(WANT);
  });
  it('capitalize after an atomic inline is refused', () => {
    expect(refusals('.a { text-transform: capitalize; } .ib { display: inline-block; }', (r) => [div(r, 'a', ['a'], [span(r, 'ib', ['ib'], [text(r, 'it', 'xy')]), text(r, 'at', 'cd')])])).toEqual(NATIVE);
  });
  it('capitalize over Complex_Context text is refused', () => {
    expect(refusals('.a { text-transform: capitalize; }', (r) => [div(r, 'a', ['a'], [text(r, 'at', 'ไทยabc')])])).toEqual(NATIVE);
    expect(refusals('.a { text-transform: uppercase; }', (r) => [div(r, 'a', ['a'], [text(r, 'at', 'ไทยabc')])])).toEqual([]);
  });
});
