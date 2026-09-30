// MQ-a Phase B (notes/T025 §3 B): @media through the at-rule handler and the parse driver, the per-band fold in project.ts,
// band blocks in the web CSS, and the native refusal until MQ-R. Chrome proves the web output in packages/parity (the media
// fixture group and the media sweep); these tests pin the compiler's decisions.
import { describe, expect, it } from 'vitest';
import type { Compiled, Diagnostic, FrontEndResult } from '../src/index.ts';
import { createProject } from '../src/index.ts';
import type { CompilerFaults, InternalOptions } from '../src/internal.ts';
import { createProjectWith, NO_FAULTS, WEB_CSS_PATH } from '../src/internal.ts';
import type { AtRuleContext } from '../src/css/at-rules.ts';
import type { EnclosedRules } from '../src/css/stylesheet.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import { div, expectCatalogued, explainOne, inputFor, spanTextOf } from './helpers.ts';

const FONT = 'body { margin: 0; font-family: Ahem; font-size: 10px; }';
// android proves no block width yet, so the fold is checked on ios and web; the public-entry test adds android.
const TARGETS = { ios: { minimum: '15.0' }, web: {} } as const;
type K = 'ios' | 'web';
const compile = (css: string, opts: Partial<InternalOptions> = {}): { input: FrontEndResult; c: Compiled<K> } => {
  const input = inputFor(`${FONT} ${css}`, (r) => [div(r, 'a', ['a'])]);
  return { input, c: createProjectWith({ projectId: 'test', targets: TARGETS }, { faults: NO_FAULTS, profiles: 'enforce', direction: 'ltr', ...opts }).compile(input) };
};
const webCss = (c: Compiled<K>): string => {
  const out = c.outputs.web;
  if (out.kind !== 'ready') throw new Error(`web is ${out.kind}: ${c.diagnostics.map((d) => `${d.code} ${d.message}`).join('; ')}`);
  return (out.files.find((f) => f.path === WEB_CSS_PATH) as { text: string }).text;
};
const width = (c: Compiled<K>, target: K = 'ios'): string => explainOne(c, target, 'a', 'width').value;
const SRC = { uri: 's.css', revision: 'r', hash: 'h' };
const parse = (text: string): { rules: ReturnType<typeof parseStylesheet>; diagnostics: Diagnostic[]; enclosed: EnclosedRules[] } => {
  const diagnostics: Diagnostic[] = [];
  const enclosed: EnclosedRules[] = [];
  const rules = parseStylesheet(text, { source: SRC, start: 0, end: text.length }, { id: 'sheet', owner: 'o', scope: 'document' }, 0, diagnostics, enclosed);
  return { rules, diagnostics, enclosed };
};

const TWO = '.a { width: 10px; height: 5px; } @media (max-width: 400px) { .a { width: 20px; } }';

describe('MQ-a: @media in the parse driver', () => {
  it('a top-level @media gives real rules with its condition; nested @media conjoin; declaration order runs through the blocks', () => {
    const { rules, diagnostics } = parse('.a { width: 1px; } @media (min-width: 100px) { .a { width: 2px; } @media (max-width: 200px) { .a { width: 3px; } } } .a { height: 1px; }');
    expect(diagnostics).toEqual([]);
    expect(rules.map((r) => [r.condition?.map((c) => c.text) ?? null, r.declarations.map((d) => [d.text, d.order])])).toEqual([
      [null, [['1px', 0]]],
      [['(min-width: 100px)'], [['2px', 1]]],
      [['(min-width: 100px)', '(max-width: 200px)'], [['3px', 2]]],
      [null, [['1px', 3]]],
    ]);
  });
  it('css-tree\'s errors inside an @media prelude are not reported (media/parse.ts reads it); errors elsewhere still are', () => {
    expect(parse('@media (390px < width < 410px), (not (width > 5px)), garbage(x) { .a { width: 2px; } }').diagnostics).toEqual([]);
    const text = '@media (390px < width < 410px) { .a { width: 2px; } } .b { width: 1px; ) }';
    const { diagnostics } = parse(text);
    expect(diagnostics.length).toBeGreaterThan(0);
    for (const d of diagnostics) expect([d.code, d.origin.kind === 'authored' && d.origin.span.start >= text.indexOf('.b')]).toEqual(['DRAGON_CSS_PARSE', true]);
    const { rules } = parse('@media (390px < width < 410px) { .a { width: 2px; } }');
    expect(rules.map((r) => r.condition?.map((c) => c.text))).toEqual([['(390px < width < 410px)']]);
  });
  it('the condition carries the at-rule span and the serialised list', () => {
    const text = '@media  SCREEN and (MAX-WIDTH:25em) { .a { width: 2px; } }';
    const [rule] = parse(text).rules;
    const c = rule?.condition?.[0];
    expect(c?.text).toBe('screen and (max-width: 25em)');
    expect(text.slice(c?.span.start, c?.span.end)).toBe(text);
  });
  it('environment features, aspect-ratio, orientation and values Dragon does not evaluate are refused on every target until MQ-R', () => {
    for (const [prelude, why] of [
      ['(prefers-color-scheme: dark)', '(prefers-color-scheme: dark) depends on the device or the user'],
      ['(max-width: 400px) and (resolution: 2dppx)', '(resolution: 2dppx) depends on the device or the user'],
      ['(hover)', '(hover) depends on the device or the user'],
      ['(orientation: portrait)', '(orientation: portrait) is not a width or height feature'],
      ['(min-aspect-ratio: 4/3)', '(min-aspect-ratio: 4 / 3) is not a width or height feature'],
      ['(max-width: 10vw)', '(max-width: 10vw) uses a value Dragon does not evaluate'],
    ] as const) {
      const { rules, diagnostics, enclosed } = parse(`@media ${prelude} { .a { width: 2px; } }`);
      expect(rules, prelude).toEqual([]);
      expect(diagnostics.map((d) => [d.code, d.target, d.message]), prelude).toEqual([['DRAGON_UNSUPPORTED_AT_RULE', null, expect.stringMatching(new RegExp(`^@media .* in the stylesheet is not supported until MQ-R: ${why.replace(/[()/]/g, '\\$&')}; only width and height media features are supported$`))]]);
      expect(enclosed.length, prelude).toBe(1);
    }
  });
  it('@media in a rule block (css-nesting-1) and @media without a block stay refused', () => {
    expect(parse('.a { @media (min-width: 1px) { width: 2px; } }').diagnostics.map((d) => d.message)).toEqual(['@media in a rule block is not supported in milestone 1']);
    expect(parse('@media (min-width: 1px);').diagnostics.map((d) => d.message)).toEqual(['@media in the stylesheet is not supported in milestone 1']);
  });
  it('an unsupported at-rule inside @media is refused with the @media label, and its rules keep the @media condition', () => {
    const { rules, diagnostics, enclosed } = parse('@media (min-width: 1px) { @supports (display: flex) { .a { width: 2px; } } }');
    expect(rules).toEqual([]);
    expect(diagnostics.map((d) => d.message)).toEqual(['@supports in @media is not supported in milestone 1']);
    expect(enclosed[0]?.rules.map((r) => r.condition?.map((c) => c.text))).toEqual([['(min-width: 1px)']]);
  });
  it('@font-face inside @media stays refused (fonts are not resolved per band); a top-level one is still collected', () => {
    const faces: AtRuleContext[] = [];
    const diagnostics: Diagnostic[] = [];
    const text = '@font-face { font-family: A; src: url(a.ttf) } @media (min-width: 1px) { @font-face { font-family: B; src: url(b.ttf) } .a { width: 2px; } }';
    const rules = parseStylesheet(text, { source: SRC, start: 0, end: text.length }, { id: 'sheet', owner: 'o', scope: 'document' }, 0, diagnostics, [], faces);
    expect(faces.map((f) => f.where)).toEqual(['the stylesheet']);
    expect(diagnostics.map((d) => [d.code, d.message])).toEqual([['DRAGON_UNSUPPORTED_AT_RULE', '@font-face in @media is not supported in milestone 1']]);
    expect(rules.map((r) => r.condition?.map((c) => c.text))).toEqual([['(min-width: 1px)']]);
  });
  it('a rule Chrome drops for its selector list does not diagnose its declarations, inside @media too', () => {
    const { diagnostics } = parse('@media (min-width: 1px) { .a, .a::-moz-range-thumb { -webkit-appearance: none; display: grid; } }');
    expect(diagnostics.map((d) => d.code)).toEqual(['DRAGON_SELECTOR_DROPPED']);
  });
});

describe('MQ-a: the band fold', () => {
  it('the native output is the band holding the fold viewport; each band boundary is exact (max-width is inclusive)', () => {
    expect(width(compile(TWO, { foldViewport: { width: 400, height: 300 } }).c)).toBe('20px');
    expect(width(compile(TWO, { foldViewport: { width: 401, height: 300 } }).c)).toBe('10px');
    expect(width(compile(TWO, { foldViewport: { width: 400.5, height: 300 } }).c)).toBe('10px');
    const folded = compile(TWO, { foldViewport: { width: 400, height: 300 } }).c;
    expect([folded.outputs.ios.kind, folded.outputs.web.kind, folded.ok]).toEqual(['analysis-only', 'ready', true]);
  });
  it('em in a media query is 16px whatever the root font size', () => {
    const css = 'html { font-size: 20px; } .a { width: 10px; } @media (max-width: 25em) { .a { width: 20px; } }';
    expect(width(compile(css, { foldViewport: { width: 400, height: 300 } }).c)).toBe('20px');
    expect(width(compile(css, { foldViewport: { width: 401, height: 300 } }).c)).toBe('10px');
  });
  it('the web output writes the first band, then one @media block per later band with only the declarations that differ', () => {
    const css = webCss(compile(TWO, { foldViewport: { width: 400, height: 300 } }).c);
    // html is dg0, body dg1 and the div dg2.
    expect(css).toMatch(/\n\.dg2 \{\n[^}]*\n {2}width: 20px;\n[^}]*\}\n/);
    expect(css.endsWith('}\n@media (not (max-width: 400px)) {\n.dg2 {\n  width: 10px;\n}\n}\n')).toBe(true);
    // The web output does not depend on the fold viewport; only its header digest does.
    const other = webCss(compile(TWO, { foldViewport: { width: 900, height: 300 } }).c);
    expect(other.split('\n').slice(1)).toEqual(css.split('\n').slice(1));
    expect(other.split('\n')[0]).not.toBe(css.split('\n')[0]);
  });
  it('two overlapping breakpoints give three width bands, each with its own block', () => {
    const css = '.a { width: 10px; } @media screen and (max-width: 768px) { .a { width: 20px; } } @media screen and (max-width: 640px) { .a { width: 30px; } }';
    const text = webCss(compile(css, { foldViewport: { width: 400, height: 300 } }).c);
    expect([...text.matchAll(/^@media (.*) \{$/gm)].map((m) => m[1])).toEqual([
      '(max-width: 768px) and (not (max-width: 640px))',
      '(not (max-width: 768px)) and (not (max-width: 640px))',
    ]);
    expect(width(compile(css, { foldViewport: { width: 640, height: 300 } }).c)).toBe('30px');
    expect(width(compile(css, { foldViewport: { width: 700, height: 300 } }).c)).toBe('20px');
    expect(width(compile(css, { foldViewport: { width: 769, height: 300 } }).c)).toBe('10px');
  });
  it('nested @media applies only where both conditions hold', () => {
    const css = '.a { width: 10px; } @media (min-width: 100px) { @media (max-width: 200px) { .a { width: 20px; } } }';
    expect([99, 100, 200, 201].map((w) => width(compile(css, { foldViewport: { width: w, height: 300 } }).c))).toEqual(['10px', '20px', '20px', '10px']);
  });
  it('a condition without width or height atoms is one band: print never applies, screen always does, and the output is exact natively', () => {
    const { c } = compile('.a { width: 10px; } @media print { .a { width: 20px; } } @media screen { .a { height: 7px; } }');
    expect(c.ok).toBe(true);
    expect(width(c)).toBe('10px');
    expect(explainOne(c, 'ios', 'a', 'height').value).toBe('7px');
    expect(webCss(c)).not.toMatch(/@media/);
  });
  it('a sheet without @media has the digest and web output it had, with or without a fold viewport', () => {
    const plain = compile('.a { width: 10px; }').c;
    const folded = compile('.a { width: 10px; }', { foldViewport: { width: 400, height: 300 } }).c;
    expect(folded.digest).toBe(plain.digest);
    expect(webCss(folded)).toBe(webCss(plain));
  });
  it('a sheet with more than one band digests the band conditions and the fold viewport', () => {
    const digests = [undefined, { width: 400, height: 300 }, { width: 401, height: 300 }].map((foldViewport) => compile(TWO, foldViewport === undefined ? {} : { foldViewport }).c.digest);
    expect(new Set(digests).size).toBe(3);
  });
  it('more than 16 bands is refused on every target, and the conditional rules are not resolved', () => {
    const css = `.a { width: 10px; } ${Array.from({ length: 16 }, (_, k) => `@media (max-width: ${100 + k * 10}px) { .a { width: ${20 + k}px; } }`).join(' ')}`;
    const { input, c } = compile(css, { foldViewport: { width: 400, height: 300 } });
    const refusal = c.diagnostics.filter((d) => d.code === 'DRAGON_UNSUPPORTED_AT_RULE');
    expect(refusal.map((d) => [d.target, d.message])).toEqual([[null, 'the @media rules of this document split the viewport into 17 bands, more than 16, which is not supported until MQ-R']]);
    expect(spanTextOf(input, refusal[0] as Diagnostic)).toBe('@media (max-width: 100px) { .a { width: 20px; } }');
    expect([c.outputs.ios.kind, c.outputs.web.kind]).toEqual(['blocked', 'blocked']);
    expectCatalogued(c.diagnostics);
  });
  it('the rules inside an unsupported at-rule inside @media are analysed for diagnostics, whatever the band', () => {
    const { c } = compile('.a { width: 10px; } @media (max-width: 400px) { .a { width: 20px; } } @supports (display: flex) { @media (max-width: 3px) { .a { display: grid; } } }', { foldViewport: { width: 400, height: 300 } });
    const supports = c.diagnostics.find((d) => d.code === 'DRAGON_UNSUPPORTED_AT_RULE');
    expect(supports?.related.map((r) => r.message)).toEqual([expect.stringMatching(/^DRAGON_UNSUPPORTED_VALUE \[ios\]: display: grid/), expect.stringMatching(/^DRAGON_UNSUPPORTED_VALUE \[web\]: display: grid/)]);
  });
  it('a value unsupported only inside a band outside the fold still blocks web, and not native', () => {
    const { c } = compile('.a { width: 10px; } @media (min-width: 500px) { .a { margin-top: auto; } }', { foldViewport: { width: 400, height: 300 } });
    expect(c.diagnostics.map((d) => [d.code, d.target])).toEqual([['DRAGON_UNPROVEN_CONTEXT', 'web']]);
    expect([c.outputs.ios.kind, c.outputs.web.kind]).toEqual(['analysis-only', 'blocked']);
  });
  it('a fold viewport that is not a finite, non-negative size is refused', () => {
    for (const v of [{ width: Number.NaN, height: 300 }, { width: -1, height: 300 }, { width: 400, height: Number.POSITIVE_INFINITY }]) {
      expect(() => createProjectWith({ projectId: 'test', targets: TARGETS }, { faults: NO_FAULTS, profiles: 'enforce', direction: 'ltr', foldViewport: v })).toThrow(/foldViewport must be a finite, non-negative width and height/);
    }
  });
});

describe('MQ-a: the public entry', () => {
  it('web is ready; ios and android refuse each width @media until MQ-R, located at the at-rule', () => {
    const input = inputFor(`${FONT} ${TWO}`, (r) => [div(r, 'a', ['a'])]);
    const c = createProject({ projectId: 'test', targets: { ...TARGETS, android: { minSdk: 31 } } }).compile(input);
    expect(c.outputs.web.kind).toBe('ready');
    expect([c.outputs.ios.kind, c.outputs.android.kind]).toEqual(['blocked', 'blocked']);
    expect(c.diagnostics.filter((d) => d.target !== 'android' || d.code === 'DRAGON_UNSUPPORTED_AT_RULE').map((d) => [d.code, d.target, spanTextOf(input, d), d.message])).toEqual(['ios', 'android'].map((t) => [
      'DRAGON_UNSUPPORTED_AT_RULE', t, '@media (max-width: 400px) { .a { width: 20px; } }',
      `@media (max-width: 400px) selects rules by the viewport width or height, which the ${t} output does not support until MQ-R`,
    ]));
    expectCatalogued(c.diagnostics);
  });
  it('a sheet whose @media conditions give one band compiles for every target', () => {
    const input = inputFor(`${FONT} @media screen { .a { width: 3px; } }`, (r) => [div(r, 'a', ['a'])]);
    expect(createProject({ projectId: 'test', targets: TARGETS }).compile(input).ok).toBe(true);
  });
});

describe('MQ-a planted compiler faults', () => {
  const faulty = (f: keyof CompilerFaults, w: number): string => width(compile(TWO, { faults: { ...NO_FAULTS, [f]: true }, foldViewport: { width: w, height: 300 } }).c);
  it('mediaConditionIgnored applies every @media rule in every band', () => {
    expect(faulty('mediaConditionIgnored', 401)).toBe('20px');
    expect(webCss(compile(TWO, { faults: { ...NO_FAULTS, mediaConditionIgnored: true }, foldViewport: { width: 400, height: 300 } }).c)).not.toMatch(/@media/);
  });
  it('mediaBandOffByOne takes the band one px wider than the fold viewport', () => {
    expect(faulty('mediaBandOffByOne', 400)).toBe('10px');
    expect(faulty('mediaBandOffByOne', 399)).toBe('20px');
  });
});
