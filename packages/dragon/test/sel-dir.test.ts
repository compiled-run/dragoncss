// SEL-dir: :dir(ltr) and :dir(rtl), parsed and matched as Chrome 145 does (css/selector-validity.generated.ts holds the capture).
import { describe, expect, it } from 'vitest';
import type { PseudoClass, Selector } from '../src/css/selectors.ts';
import { DIR_ARGUMENT_VALID, DIR_ATTRIBUTE_DIRECTIONALITY } from '../src/css/selector-validity.generated.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import { dirKeyword, directionality } from '../src/analysis/elements/dir.ts';
import type { Diagnostic } from '../src/types.ts';
import { NO_FAULTS } from '../src/internal.ts';
import type { LinkedElement } from '../src/analysis/link.ts';
import type { ResolvedElement } from '../src/analysis/resolve.ts';
import { resolveTree } from '../src/analysis/resolve.ts';
import { attributeRefusal } from '../src/attributes.ts';
import { DIR_UNICODE_BIDI_REVERTED, DIR_ATTRIBUTE_UNICODE_BIDI } from '../src/css/selector-validity.generated.ts';
import { createProject } from '../src/index.ts';
import type { AttributeBinding, DraftTree, ElementNode } from '../src/index.ts';
import { referenceDataset } from '../src/ua/datasets.ts';
import { always, div, eq, inputFor, text } from './helpers.ts';

const SRC = { uri: 's.css', revision: 'r', hash: 'h' };
const parse = (css: string): { selectors: Selector[]; diagnostics: Diagnostic[] } => {
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SRC, start: 0, end: css.length }, { id: 's', owner: 'o', scope: 'document' }, 0, diagnostics);
  return { selectors: rules.flatMap((r) => [...r.selectors]), diagnostics };
};
const dirOf = (sel: string): PseudoClass | undefined => {
  const { selectors, diagnostics } = parse(`.a${sel} { width: 1px; }`);
  expect(diagnostics, sel).toEqual([]);
  return selectors[0]?.parts[0]?.compound.pseudos.find((p) => p.kind === 'dir');
};
const codes = (css: string): string[] => parse(css).diagnostics.map((d) => d.code);

describe('the :dir() capture', () => {
  it('an argument that differs only in ASCII case matches what its lowercase row matches', () => {
    for (const [arg, row] of Object.entries(DIR_ARGUMENT_VALID)) {
      const lower = DIR_ARGUMENT_VALID[arg.toLowerCase()];
      if (lower !== undefined && /^[A-Za-z]+$/.test(arg)) expect(row, arg).toEqual(lower);
    }
  });
  it('dirKeyword agrees with the directionality Chrome gives every captured dir value, under either parent', () => {
    for (const [value, row] of Object.entries(DIR_ATTRIBUTE_DIRECTIONALITY)) {
      const d = dirKeyword(value);
      if (d === null) expect(row, JSON.stringify(value)).toEqual({ underLtr: 'ltr', underRtl: 'rtl' });
      else expect(row, value).toEqual({ underLtr: d, underRtl: d });
    }
    expect(dirKeyword(' rtl')).toBeNull();
    expect(dirKeyword('RTL')).toBe('rtl');
  });
});

describe(':dir() parsing (Chrome 145 ConsumePseudo kPseudoDir)', () => {
  it.each([
    [':dir(rtl)', 'rtl'],
    [':dir(ltr)', 'ltr'],
    [':dir(RTL)', 'rtl'],
    [':dir(Ltr)', 'ltr'],
    [':dir( rtl )', 'rtl'],
    [':dir(\\72 tl)', 'rtl'],
    [':d\\ir(rtl)', 'rtl'],
    [':dir(auto)', null],
    [':dir(foo)', null],
  ])('%s matches directionality %s', (sel, direction) => {
    expect(dirOf(sel)).toEqual({ kind: 'dir', direction });
  });
  it('specificity is a pseudo-class\'s (0,1,0)', () => {
    expect(parse(':dir(rtl) { width: 1px; }').selectors[0]?.specificity).toEqual([0, 1, 0]);
    expect(parse('.a:dir(foo) { width: 1px; }').selectors[0]?.specificity).toEqual([0, 2, 0]);
  });
  it(':dir() and a bare :dir are invalid, so Chrome drops the rule; inside a forgiving :is() they are refused', () => {
    for (const sel of [':dir()', ':dir']) {
      const { selectors, diagnostics } = parse(`.a${sel}, .b { width: 1px; }`);
      expect(diagnostics.map((d) => d.code), sel).toEqual(['DRAGON_SELECTOR_DROPPED']);
      expect(selectors.every((s) => s.dropped), sel).toBe(true);
    }
    expect(codes(':is(:dir(), .a) { width: 1px; }')).toEqual(['DRAGON_UNSUPPORTED_SELECTOR']);
  });
  it('a quoted argument, two identifiers, or a list fail css-tree\'s parse', () => {
    for (const sel of [':dir("rtl")', ':dir(ltr rtl)', ':dir(ltr, rtl)', ':is(:dir("rtl"), .a)']) expect(codes(`.a${sel} { width: 1px; }`), sel).toContain('DRAGON_CSS_PARSE');
  });
  it('an identifier the capture has no row for is refused as missing data', () => {
    const d = parse('.a:dir(bar) { width: 1px; }').diagnostics;
    expect(d.map((x) => x.code)).toEqual(['DRAGON_UNSUPPORTED_SELECTOR']);
    expect(d[0]?.message).toContain('not captured');
  });
});

describe('directionality (HTML §3.2.6.4)', () => {
  const el = (dir?: string): { attributes: ReadonlyMap<string, string> } => ({ attributes: new Map(dir === undefined ? [] : [['dir', dir]]) });
  it('is the nearest ancestor-or-self dir of ltr or rtl, else ltr; an invalid value is skipped', () => {
    expect(directionality([el(), el()], NO_FAULTS)).toBe('ltr');
    expect(directionality([el(), el('rtl'), el()], NO_FAULTS)).toBe('rtl');
    expect(directionality([el(), el('rtl'), el('ltr')], NO_FAULTS)).toBe('ltr');
    expect(directionality([el(), el('rtl'), el('foo')], NO_FAULTS)).toBe('rtl');
    expect(directionality([el(), el('RTL')], NO_FAULTS)).toBe('rtl');
  });
  it('the planted faults: dirNotInherited reads only the element\'s own dir, dirCaseSensitive skips dir=RTL', () => {
    expect(directionality([el(), el('rtl'), el()], { ...NO_FAULTS, dirNotInherited: true })).toBe('ltr');
    expect(directionality([el(), el('RTL')], { ...NO_FAULTS, dirCaseSensitive: true })).toBe('ltr');
  });
});

const origin = { kind: 'unlocated', reason: 'test' } as const;
const node = (id: string, classes: string[], attributes: [string, string][] = [], children: LinkedElement[] = [], tag = 'div'): LinkedElement => ({
  kind: 'element', address: id, instance: 'doc', owner: 'App', tag, classes: classes.map((name) => ({ owner: 'o', sheet: 'sheet', name })), attributes: new Map(attributes), children,
  node: { kind: 'element', id, tag, classes: [], attributes: [], children: [], origin },
});
/** Resolves body > content under an ltr root and returns every element by address. */
function resolve(css: string, content: LinkedElement[], faults = NO_FAULTS): Map<string, ResolvedElement> {
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SRC, start: 0, end: css.length }, { id: 'sheet', owner: 'o', scope: 'document' }, 0, diagnostics);
  expect(diagnostics).toEqual([]);
  const root = resolveTree(node('html', [], [], [node('body', [], [], content, 'body')], 'html'), rules, faults, { direction: 'ltr', rootFont: 'ahem', ua: referenceDataset() });
  const out = new Map<string, ResolvedElement>();
  const walk = (e: ResolvedElement): void => { out.set(e.element.address, e); for (const c of e.children) if (c.kind === 'element') walk(c); };
  walk(root);
  return out;
}
const prop = (els: Map<string, ResolvedElement>, id: string, p: string): string => {
  const v = els.get(id)?.props.get(p as never)?.value;
  if (v === undefined) throw new Error(`${id} has no ${p}`);
  return v.kind === 'keyword' ? v.value : v.kind === 'length' ? `${v.value}${v.unit}` : JSON.stringify(v);
};
const originOf = (els: Map<string, ResolvedElement>, id: string, p: string): string | undefined => els.get(id)?.props.get(p as never)?.origin;

describe('the dir attribute (HTML §3.2.6.4, §15.3.6)', () => {
  const tree = (attrs: [string, string][] = [['dir', 'rtl']]): LinkedElement[] => [node('d', ['d'], attrs, [node('c', ['c'], [], [node('o', ['o'], [['dir', 'ltr']])])])];
  it(':dir() follows dir down the tree, stopping at a nested dir', () => {
    const els = resolve('.c:dir(rtl) { width: 5px; } .o:dir(ltr) { width: 7px; } .d:dir(ltr) { width: 9px; }', tree());
    expect(prop(els, 'c', 'width')).toBe('5px');
    expect(prop(els, 'o', 'width')).toBe('7px');
    expect(prop(els, 'd', 'width')).toBe('auto');
  });
  it('hints direction below every author rule, and :dir() still follows dir when an author direction wins', () => {
    const els = resolve('.c { width: 1px; } .x { direction: ltr; } .x:dir(rtl) { height: 3px; }', [node('x', ['x'], [['dir', 'rtl']]), ...tree()]);
    expect(prop(els, 'd', 'direction')).toBe('rtl');
    expect(originOf(els, 'd', 'direction')).toBe('presentational-hint');
    expect(prop(els, 'c', 'direction')).toBe('rtl');
    expect(prop(els, 'o', 'direction')).toBe('ltr');
    expect(prop(els, 'x', 'direction')).toBe('ltr');
    expect(prop(els, 'x', 'height')).toBe('3px');
  });
  it('maps flow-relative sides by the element\'s own hinted direction', () => {
    const els = resolve('.d { margin-inline-start: 4px; padding-inline-start: 6px; }', tree());
    expect([prop(els, 'd', 'margin-right'), prop(els, 'd', 'margin-left'), prop(els, 'd', 'padding-right')]).toEqual(['4px', '0px', '6px']);
  });
  it('direction: revert rolls back past the hint to the parent\'s direction, and revert-layer to the hint', () => {
    const inner = (cls: string): LinkedElement[] => [node('p', [], [['dir', 'rtl']], [node(cls, [cls], [['dir', 'ltr']])])];
    const reverted = resolve('.r { direction: revert; margin-inline-start: 2px; }', inner('r'));
    expect([prop(reverted, 'r', 'direction'), prop(reverted, 'r', 'margin-right')]).toEqual(['rtl', '2px']);
    const layered = resolve('.l { direction: revert-layer; margin-inline-start: 2px; }', inner('l'));
    expect([prop(layered, 'l', 'direction'), prop(layered, 'l', 'margin-left')]).toEqual(['ltr', '2px']);
  });
  it('gives the UA isolate Chrome computes per tag where no author unicode-bidi is set; revert keeps it, as it is a UA rule', () => {
    expect(DIR_UNICODE_BIDI_REVERTED).toBe(DIR_ATTRIBUTE_UNICODE_BIDI['span']?.rtl);
    expect(DIR_ATTRIBUTE_UNICODE_BIDI['span']).toEqual({ none: 'normal', ltr: 'isolate', rtl: 'isolate' });
    const span = (cls: string, dir: string | null): LinkedElement => node(cls, [cls], dir === null ? [] : [['dir', dir]], [], 'span');
    const els = resolve('.n { unicode-bidi: normal; } .v { unicode-bidi: revert; }', [span('a', 'rtl'), span('b', null), span('n', 'ltr'), span('v', 'rtl')]);
    expect(prop(els, 'a', 'unicode-bidi')).toBe('isolate');
    expect(originOf(els, 'a', 'unicode-bidi')).toBe('user-agent');
    expect(prop(els, 'b', 'unicode-bidi')).toBe('normal');
    expect(prop(els, 'n', 'unicode-bidi')).toBe('normal');
    expect(prop(els, 'v', 'unicode-bidi')).toBe('isolate');
  });
  it('the planted faults change what :dir() matches: dirNotInherited on an inheriting child, dirCaseSensitive on dir=RTL', () => {
    const css = '.c:dir(rtl) { width: 5px; } .u:dir(rtl) { width: 6px; }';
    const content = [...tree(), node('u', ['u'], [['dir', 'RTL']])];
    expect([prop(resolve(css, content), 'c', 'width'), prop(resolve(css, content), 'u', 'width')]).toEqual(['5px', '6px']);
    expect(prop(resolve(css, content, { ...NO_FAULTS, dirNotInherited: true }), 'c', 'width')).toBe('auto');
    expect(prop(resolve(css, content, { ...NO_FAULTS, dirCaseSensitive: true }), 'u', 'width')).toBe('auto');
  });
});

describe('dir refusals (DRAGON_UNSUPPORTED_ATTRIBUTE)', () => {
  it('compiles on block and inline tags, and is refused on the root, body, SVG, controls, fieldsets and replaced elements', () => {
    for (const tag of ['div', 'span', 'p', 'ul', 'li', 'section', 'a', 'label', 'strong']) expect(attributeRefusal(tag, 'dir'), tag).toBeNull();
    for (const tag of ['html', 'body', 'svg', 'path', 'button', 'input', 'img', 'iframe', 'video', 'fieldset', 'legend']) expect(attributeRefusal(tag, 'dir'), tag).not.toBeNull();
    expect(attributeRefusal('html', 'dir')).toContain('environment direction');
  });
  it('refuses auto and every value other than ltr and rtl, in each arm of a state-dependent dir', () => {
    const project = createProject({ projectId: 'test', targets: { ios: { minimum: '15.0' }, web: {} } });
    const compile = (value: AttributeBinding['value']) => {
      const input = inputFor('.a { width: 1px; }', (r) => [{ ...div(r, 'a', ['a']), attributes: [{ name: 'dir', value, origin }] } as ElementNode]);
      const tree = input.tree as DraftTree;
      const root = tree.components[0] as DraftTree['components'][number];
      return project.compile({ ...input, tree: { ...tree, components: [{ ...root, states: [{ id: 's', domain: ['a', 'b'], initial: 'a', origin: root.origin }] }] } });
    };
    for (const v of ['rtl', 'ltr', 'RTL']) expect(compile([{ when: always, value: v }]).diagnostics, v).toEqual([]);
    for (const v of ['auto', 'foo', '', ' rtl']) {
      const d = compile([{ when: always, value: v }]).diagnostics;
      expect(d.map((x) => x.code), JSON.stringify(v)).toEqual(['DRAGON_UNSUPPORTED_ATTRIBUTE']);
      expect(d[0]?.message).toContain(`dir="${v}"`);
    }
    const arms = compile([{ when: eq('s', 'a'), value: 'rtl' }, { when: always, value: 'auto' }]).diagnostics.filter((x) => x.code === 'DRAGON_UNSUPPORTED_ATTRIBUTE');
    expect(arms.map((x) => x.message)).toEqual([expect.stringContaining('dir="auto"')]);
  });
  it('an inline <span dir=rtl> takes html.css\'s isolate in a right-to-left context, which native refuses (analysis/bidi.ts) and the web compiles', () => {
    const project = createProject({ projectId: 'test', targets: { ios: { minimum: '15.0' }, web: {} } });
    const compile = (dir: string) => project.compile(inputFor('.p { width: 100px; }', (r) => [{ ...div(r, 'p', ['p']), children: [{ ...div(r, 's', []), tag: 'span', attributes: [{ name: 'dir', value: [{ when: always, value: dir }], origin }], children: [text(r, 't', 'XX')] } as ElementNode] }]));
    const refused = compile('rtl').diagnostics.filter((d) => d.code === 'DRAGON_UNSUPPORTED_VALUE');
    expect(refused.map((d) => [d.target, d.message.slice(0, 50)])).toEqual([['ios', "The UA's unicode-bidi: isolate on <span> s can reo"]]);
    expect(compile('ltr').diagnostics.filter((d) => d.code === 'DRAGON_UNSUPPORTED_VALUE')).toEqual([]);
  });
});

