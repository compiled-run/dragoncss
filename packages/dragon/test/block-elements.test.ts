// Block-level elements with Chrome 145's user-agent defaults: the element table, declared UA values (em-relative and per
// direction), and the precise refusals of the defaults Dragon does not model.
import { describe, expect, it } from 'vitest';
import type { ElementNode, Origin, SourceRef, TreeNode } from '../src/index.ts';
import { createProjectWith, NO_FAULTS } from '../src/internal.ts';
import { SUPPORTED_TAGS, UNSTYLED_TAGS } from '../src/analysis/elements.ts';
import { computed, userAgentContexts, userAgentDeclared, userAgentTextFonts } from '../src/ua/chrome-145.darwin-arm64.generated.ts';
import { DOC, explainOne, inputFor, staticClass, text } from './helpers.ts';

const project = (direction: 'ltr' | 'rtl' = 'ltr') =>
  createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, web: {} } }, { faults: NO_FAULTS, profiles: 'derive', direction });

function el(ref: SourceRef, id: string, tag: string, classes: string[] = [], children: TreeNode[] = []): ElementNode {
  const origin: Origin = { kind: 'authored', span: { source: ref, start: 0, end: 0 } };
  return { kind: 'element', id, tag, classes: classes.map((name) => staticClass({ owner: DOC, sheet: 's', name }, origin)), attributes: [], children, origin };
}

const FONT = 'body { font-family: Ahem; }';

describe('the element table', () => {
  it('is exactly the captured tags other than the unstyled probe element, plus the tags that resolve as it', () => {
    expect([...SUPPORTED_TAGS].filter((t) => !UNSTYLED_TAGS.has(t)).sort()).toEqual(Object.keys(computed).filter((t) => t !== 'dragon-unstyled').sort());
    expect([...UNSTYLED_TAGS].every((t) => SUPPORTED_TAGS.has(t) && !(t in computed))).toBe(true);
    expect(SUPPORTED_TAGS.has('pre')).toBe(false);
  });
  it('pins the declared UA values, the ancestor contexts and the unmodelled text fonts Chrome 145 has', () => {
    expect(userAgentDeclared.p.ltr).toEqual({ display: 'block', 'margin-bottom': '1em', 'margin-top': '1em' });
    expect(userAgentDeclared.h1.ltr).toEqual({ display: 'block', 'font-size': '2em', 'margin-bottom': '0.67em', 'margin-top': '0.67em' });
    expect([userAgentDeclared.h2.ltr['font-size'], userAgentDeclared.h3.ltr['font-size'], userAgentDeclared.h4.ltr['font-size'], userAgentDeclared.h5.ltr['font-size'], userAgentDeclared.h6.ltr['font-size']]).toEqual(['1.5em', '1.17em', undefined, '0.83em', '0.67em']);
    expect([userAgentDeclared.h2.ltr['margin-top'], userAgentDeclared.h3.ltr['margin-top'], userAgentDeclared.h4.ltr['margin-top'], userAgentDeclared.h5.ltr['margin-top'], userAgentDeclared.h6.ltr['margin-top']]).toEqual(['0.83em', '1em', '1.33em', '1.67em', '2.33em']);
    expect(userAgentDeclared.ul.ltr['padding-left']).toBe('40px');
    expect(userAgentDeclared.ul.rtl['padding-right']).toBe('40px');
    expect(userAgentDeclared.ul.rtl['padding-left']).toBeUndefined();
    expect(userAgentDeclared.dd.rtl).toEqual({ display: 'block', 'margin-right': '40px' });
    expect(userAgentDeclared.li.ltr).toEqual({ display: 'list-item' });
    expect(userAgentDeclared.hr.ltr['border-top-style']).toBe('inset');
    expect(userAgentDeclared.hr.ltr['margin-left']).toBe('auto');
    expect(userAgentDeclared.hr.ltr['margin-top']).toBe('0.5em');
    expect(userAgentContexts.ul).toEqual(['dl', 'ol', 'ul']);
    expect(userAgentContexts.h1).toEqual([]);
    expect(userAgentTextFonts.h1).toEqual({ 'font-weight': '700' });
    expect(userAgentTextFonts.address).toEqual({ 'font-style': 'italic' });
    expect(userAgentTextFonts.p).toEqual({});
  });
});

describe('declared UA values', () => {
  it('em defaults follow the parent font size (font-size) and the element font size (margins)', () => {
    const c = project().compile(inputFor(`${FONT} .s { font-size: 20px; }`, (r) => [el(r, 'h1a', 'h1'), el(r, 'd', 'div', ['s'], [el(r, 'h1b', 'h1'), el(r, 'p', 'p'), el(r, 'h5', 'h5')])]));
    expect(c.diagnostics).toEqual([]);
    const v = (id: string, p: string): unknown => explainOne(c, 'ios', id, p).value;
    expect([v('h1a', 'font-size'), v('h1a', 'margin-top'), v('h1a', 'margin-bottom')]).toEqual(['32px', '21.44px', '21.44px']);
    expect([v('h1b', 'font-size'), v('h1b', 'margin-top')]).toEqual(['40px', '26.8px']);
    expect([v('p', 'font-size'), v('p', 'margin-top')]).toEqual(['20px', '20px']);
    expect(explainOne(c, 'ios', 'h1b', 'margin-top').origin).toEqual({ kind: 'builtin', dataset: 'chrome-145.0.7632.6 computed', entry: 'h1 margin-top' });
  });
  it('an author font-size on the element itself scales its UA margins', () => {
    const c = project().compile(inputFor(`${FONT} .o { font-size: 12px; }`, (r) => [el(r, 'h3', 'h3', ['o']), el(r, 'ul', 'ul', ['o'])]));
    expect(explainOne(c, 'ios', 'h3', 'margin-top').value).toBe('12px');
    expect(explainOne(c, 'ios', 'ul', 'margin-top').value).toBe('12px');
  });
  it('an author em or rem font-size is computed before the UA em margins read it, and author em margins read a UA font-size', () => {
    const c = project().compile(inputFor(`${FONT} .s { font-size: 10px; } .e { font-size: 2em; } .r { font-size: 2rem; } .m { margin-top: 1em; }`, (r) => [el(r, 'd', 'div', ['s'], [el(r, 'h3', 'h3', ['e']), el(r, 'h4', 'h4', ['r']), el(r, 'h1', 'h1', ['m'])])]));
    const v = (id: string, p: string): unknown => explainOne(c, 'ios', id, p).value;
    expect([v('h3', 'font-size'), v('h3', 'margin-top')]).toEqual(['20px', '20px']);
    expect([v('h4', 'font-size'), v('h4', 'margin-top')]).toEqual(['32px', '42.56px']);
    expect([v('h1', 'font-size'), v('h1', 'margin-top'), v('h1', 'margin-bottom')]).toEqual(['20px', '20px', '13.4px']);
  });
  it('a logical UA declaration maps to the physical side of the element direction', () => {
    const rtl = project('rtl').compile(inputFor(FONT, (r) => [el(r, 'ul', 'ul'), el(r, 'dd', 'dd')]));
    expect(explainOne(rtl, 'ios', 'ul', 'padding-right').value).toBe('40px');
    expect(explainOne(rtl, 'ios', 'ul', 'padding-left')).toMatchObject({ value: '0px', cascade: 'initial' });
    expect(explainOne(rtl, 'ios', 'dd', 'margin-right').value).toBe('40px');
    expect(explainOne(rtl, 'ios', 'dd', 'margin-left').value).toBe('0px');
    const mixed = project().compile(inputFor(`${FONT} .r { direction: rtl; }`, (r) => [el(r, 'ul', 'ul', ['r'])]));
    expect([explainOne(mixed, 'ios', 'ul', 'padding-left').value, explainOne(mixed, 'ios', 'ul', 'padding-right').value]).toEqual(['0px', '40px']);
  });
  it('an author declaration beats the UA value', () => {
    const c = project().compile(inputFor(`${FONT} .m { margin: 3px; }`, (r) => [el(r, 'p', 'p', ['m'])]));
    expect(explainOne(c, 'ios', 'p', 'margin-top').value).toBe('3px');
  });
});

describe('refusals of UA defaults Dragon does not model', () => {
  const codes = (input: ReturnType<typeof inputFor>) => project().compile(input).diagnostics.map((d) => `${d.code} ${String(d.target)}`);
  it('heading and address text: ios only, since Chrome draws the UA font-weight and font-style on web', () => {
    const c = project().compile(inputFor(FONT, (r) => [el(r, 'h2', 'h2', [], [text(r, 't', 'XX')]), el(r, 'a', 'address', [], [el(r, 'ad', 'div', [], [text(r, 'u', 'X')])])]));
    expect(c.diagnostics.map((d) => [d.code, d.target, d.message.split(' from ')[0]])).toEqual([
      ['DRAGON_UNSUPPORTED_FONT', 'ios', 'text h2:text0 inherits font-weight: 700'],
      ['DRAGON_UNSUPPORTED_FONT', 'ios', 'text ad:text0 inherits font-style: italic'],
    ]);
    expect(c.outputs.web.kind).toBe('ready');
    expect(c.outputs.ios.kind).toBe('blocked');
  });
  it('heading text is refused for each configured native target: android as ios, and only the configured ones', () => {
    const input = inputFor(FONT, (r) => [el(r, 'h2', 'h2', [], [text(r, 't', 'XX')])]);
    const run = (targets: Parameters<typeof createProjectWith>[0]['targets']) => createProjectWith({ projectId: 'test', targets }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(input);
    const all = run({ ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} });
    expect(all.diagnostics.map((d) => [d.code, d.target, d.message.split(' from ')[0]]).sort()).toEqual([
      ['DRAGON_UNSUPPORTED_FONT', 'android', 'text h2:text0 inherits font-weight: 700'],
      ['DRAGON_UNSUPPORTED_FONT', 'ios', 'text h2:text0 inherits font-weight: 700'],
    ]);
    expect(all.diagnostics.find((d) => d.target === 'android')?.message).toMatch(/android draws this text in its one regular face/);
    expect([all.outputs.ios.kind, all.outputs.android.kind, all.outputs.web.kind]).toEqual(['blocked', 'blocked', 'ready']);
    const android = run({ android: { minSdk: 31 }, web: {} });
    expect(android.diagnostics.map((d) => [d.code, d.target])).toEqual([['DRAGON_UNSUPPORTED_FONT', 'android']]);
    expect(android.outputs.android.kind).toBe('blocked');
    expect(run({ web: {} }).diagnostics).toEqual([]);
  });
  it('headings without text compile on every target', () => {
    expect(codes(inputFor(FONT, (r) => [el(r, 'h1', 'h1'), el(r, 'h6', 'h6'), el(r, 'p', 'p', [], [text(r, 't', 'XX')])]))).toEqual([]);
  });
  it('display: list-item from the UA sheet is refused on every target; an authored display: block is not', () => {
    expect(codes(inputFor(FONT, (r) => [el(r, 'ul', 'ul', [], [el(r, 'li', 'li')])]))).toEqual(['DRAGON_UNSUPPORTED_VALUE ios', 'DRAGON_UNSUPPORTED_VALUE web']);
    expect(codes(inputFor(`${FONT} .b { display: block; }`, (r) => [el(r, 'ul', 'ul', [], [el(r, 'li', 'li', ['b'])])]))).toEqual([]);
  });
  it('hr: the UA inset border is refused; an authored border-style is not', () => {
    expect(codes(inputFor(FONT, (r) => [el(r, 'hr', 'hr')]))).toEqual(['DRAGON_UNSUPPORTED_VALUE ios', 'DRAGON_UNSUPPORTED_VALUE web']);
    expect(codes(inputFor(`${FONT} .s { border-style: solid; }`, (r) => [el(r, 'hr', 'hr', ['s'])]))).toEqual([]);
  });
  it('a list inside a list or dl is refused at any depth, with no target', () => {
    const c = project().compile(inputFor(FONT, (r) => [el(r, 'dl', 'dl', [], [el(r, 'd', 'div', [], [el(r, 'ol', 'ol')])])]));
    expect(c.diagnostics.map((d) => [d.code, d.target, d.message])).toEqual([['DRAGON_UNSUPPORTED_ELEMENT', null, expect.stringMatching(/^<ol> ol inside <dl> dl: /)]]);
  });
  it('a UA font size below the minimum logical font size is refused only when no authored px size is in the chain', () => {
    const nest = (r: SourceRef, cls: string[]) => [el(r, 'a', 'h6', cls, [el(r, 'ad', 'div', [], [el(r, 'b', 'h6', [], [el(r, 'bd', 'div', [], [el(r, 'c', 'h6')])])])])];
    expect(codes(inputFor(FONT, (r) => nest(r, [])))).toEqual(['DRAGON_UNSUPPORTED_VALUE ios', 'DRAGON_UNSUPPORTED_VALUE web']);
    expect(codes(inputFor(`${FONT} .px { font-size: 10.72px; }`, (r) => nest(r, ['px'])))).toEqual([]);
  });
  it('pre is not in the element table', () => {
    const c = project().compile(inputFor(FONT, (r) => [el(r, 'pre', 'pre')]));
    expect(c.diagnostics.map((d) => [d.code, d.message])).toEqual([['DRAGON_UNSUPPORTED_ELEMENT', expect.stringMatching(/^<pre> pre is not supported \(supported: html, body, div, p, h1/)]]);
  });
});
