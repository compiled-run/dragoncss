// GEN-a (notes/T151-gen-spec.md R2-R12): ::before and ::after with string content, built as elements of the resolved tree. The
// selectors and their specificity, the cascade and inheritance of a generated box, its text and where it goes in the host's inline
// formatting context, the hosts that may generate one, the refusals of R4, R8 and R12, the statically empty pseudo-elements, the
// web output, and the eight compiler plants.
import { describe, expect, it } from 'vitest';
import type { LayoutBox, InlineChild } from '@dragon/layout';
import type { AttributeBinding, Compiled, ElementNode, FrontEndResult, Origin, SourceRef, TreeNode } from '../src/index.ts';
import { createProjectWith, iosLayoutProjection, NO_FAULTS, resolvedColors, resolvedTextColors, WEB_CSS_PATH, webClassMap } from '../src/internal.ts';
import type { CompilerFaults } from '../src/faults.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import type { Selector } from '../src/css/selectors.ts';
import type { Diagnostic } from '../src/types.ts';
import { always, DOC, eq, expectCatalogued, inputFor, spanTextOf, staticClass, text } from './helpers.ts';

const SOURCE = { uri: 'dragon-source://test/gen.css', revision: 'r1', hash: 'sha256:0' };
const ENV = { viewport: { width: 400, height: 300 }, devicePixelRatio: 1, direction: 'ltr', rootFont: 'ua-default' } as const;
const FONT = 'body { font-family: Ahem; }';

const project = (faults: CompilerFaults = NO_FAULTS, profiles: 'derive' | 'enforce' = 'derive') =>
  createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, web: {} } }, { faults, profiles, direction: 'ltr' });

function el(ref: SourceRef, id: string, tag: string, classes: string[] = [], children: TreeNode[] = [], attributes: AttributeBinding[] = []): ElementNode {
  const origin: Origin = { kind: 'authored', span: { source: ref, start: 0, end: 0 } };
  return { kind: 'element', id, tag, classes: classes.map((name) => staticClass({ owner: DOC, sheet: 's', name }, origin)), attributes, children, origin };
}

const attr = (ref: SourceRef, name: string, value: string | null = ''): AttributeBinding => ({ name, value: [{ when: always, value }], origin: { kind: 'authored', span: { source: ref, start: 0, end: 0 } } });

type Body = (r: SourceRef) => TreeNode[];
const compile = (css: string, body: Body, faults: CompilerFaults = NO_FAULTS, profiles: 'derive' | 'enforce' = 'derive') => project(faults, profiles).compile(inputFor(`${FONT} ${css}`, body));
const messages = (c: Compiled<'ios' | 'web'>): string[] => c.diagnostics.map((d) => `${d.code} ${String(d.target)} ${d.message}`);

/** The resolved element addresses of the one case, in preorder. */
const addresses = (c: Compiled<'ios' | 'web'>): string[] => [...(resolvedColors(c, []) ?? new Map()).keys()];

/** The engine input's boxes and inline children by id, and each text leaf's text. */
function layoutTree(c: Compiled<'ios' | 'web'>): { ids: string[]; texts: Map<string, string>; styles: Map<string, LayoutBox['style']> } {
  const p = iosLayoutProjection(c, ENV, []);
  if (p.kind !== 'ready') throw new Error(`projection blocked: ${p.reason}`);
  const ids: string[] = [];
  const texts = new Map<string, string>();
  const styles = new Map<string, LayoutBox['style']>();
  const inline = (k: InlineChild): void => {
    ids.push(k.id);
    if (k.kind === 'text') texts.set(k.id, k.text);
    if (k.kind === 'inline') for (const x of k.children) inline(x);
  };
  const walk = (b: LayoutBox): void => {
    ids.push(b.id);
    styles.set(b.id, b.style);
    for (const k of b.children) {
      if (k.kind === 'box') walk(k);
      else if (k.kind !== 'replaced') inline(k);
    }
  };
  walk(p.input.root);
  return { ids, texts, styles };
}

function parseSelectors(css: string): { selectors: Selector[]; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  return { selectors: rules.flatMap((r) => r.selectors), diagnostics };
}

const host = (r: SourceRef, children: TreeNode[] = [text(r, 't', 'x')], classes = ['a']): TreeNode[] => [el(r, 'd', 'div', classes, children)];

describe('selectors (R5)', () => {
  it('::before, ::after and the legacy :before and :after end the subject and add [0, 0, 1]', () => {
    const { selectors, diagnostics } = parseSelectors('.a::before, .a::after, .a:before, .a:after, div::BEFORE { width: 1px; }');
    expect(diagnostics).toEqual([]);
    expect(selectors.map((s) => [s.pseudoElement?.kind, s.pseudoElement?.name, s.specificity])).toEqual([
      ['generated', 'before', [0, 1, 1]],
      ['generated', 'after', [0, 1, 1]],
      ['generated', 'before', [0, 1, 1]],
      ['generated', 'after', [0, 1, 1]],
      ['generated', 'before', [0, 0, 2]],
    ]);
  });
  it('anything after the pseudo-element is refused, naming its owner; ::first-line, ::first-letter and ::marker name GEN-d and GEN-c', () => {
    const refused = (css: string): string[] => parseSelectors(`${css} { width: 1px; }`).diagnostics.map((d) => `${d.code} ${d.message}`);
    expect(refused('.a::before:hover')).toEqual([expect.stringMatching(/^DRAGON_UNSUPPORTED_SELECTOR .*GEN-d8\)$/)]);
    expect(refused('.a::after.b')).toEqual([expect.stringMatching(/^DRAGON_UNSUPPORTED_SELECTOR .*GEN-d\)$/)]);
    expect(refused('.a::first-line')).toEqual([expect.stringMatching(/^DRAGON_UNSUPPORTED_SELECTOR .*GEN-d/)]);
    expect(refused('.a::first-letter')).toEqual([expect.stringMatching(/^DRAGON_UNSUPPORTED_SELECTOR .*GEN-d/)]);
    expect(refused('li::marker')).toEqual([expect.stringMatching(/^DRAGON_UNSUPPORTED_SELECTOR .*GEN-c and GEN-d6/)]);
  });
  it('a pseudo-element inside :is() is invalid in Chrome, and refused as in any forgiving argument', () => {
    const { diagnostics } = parseSelectors(':is(.a::before) { width: 1px; } :not(.a:after) { width: 1px; }');
    expect(diagnostics.map((d) => d.code)).toEqual(['DRAGON_UNSUPPORTED_SELECTOR', 'DRAGON_SELECTOR_DROPPED']);
  });
  it('the statically empty pseudo-elements parse as rules that match nothing', () => {
    const { selectors, diagnostics } = parseSelectors('*, ::before, ::after, ::backdrop, ::file-selector-button { border: 0 solid; } ::placeholder, ::-webkit-datetime-edit-fields-wrapper { color: red; }');
    expect(diagnostics).toEqual([]);
    expect(selectors.map((s) => s.pseudoElement?.kind ?? null)).toEqual([null, 'generated', 'generated', 'static-empty', 'static-empty', 'static-empty', 'static-empty']);
  });
});

describe('the generated box in the resolved tree (R2, R3, R6)', () => {
  it('::before is the host\'s first child and ::after its last, each with one text child; content normal or none generates none', () => {
    const c = compile(".a::before { content: 'b' 'c'; } .a::after { content: 'z'; } .n::before { content: none; } .n::after { color: red; }", (r) => [el(r, 'd', 'div', ['a'], [text(r, 't', 'x'), el(r, 's', 'span', [], [text(r, 'u', 'y')])]), el(r, 'e', 'div', ['n'], [text(r, 'v', 'w')])]);
    expect(messages(c)).toEqual([]);
    expect(addresses(c).filter((a) => /^[des]/.test(a))).toEqual(['d', 'd::before', 's', 'd::after', 'e']);
    const tree = layoutTree(c);
    expect(tree.ids.filter((i) => /^[ds]/.test(i))).toEqual(['d', 'd::before', 'd::before:text0', 'd:text0', 's', 's:text0', 'd::after', 'd::after:text0']);
    expect(tree.texts.get('d::before:text0')).toBe('bc');
  });
  it('content: \'\' generates an empty box with no text; display: none generates none', () => {
    const c = compile(".a::before { content: ''; } .a::after { content: 'z'; display: none; }", (r) => host(r));
    expect(messages(c)).toEqual([]);
    expect(addresses(c).filter((a) => a.startsWith('d'))).toEqual(['d', 'd::before']);
    expect(layoutTree(c).ids.filter((i) => i.startsWith('d'))).toEqual(['d', 'd::before', 'd:text0']);
  });
  it('cascades only its own pseudo-element\'s rules, by specificity, and an element rule does not reach it', () => {
    const c = compile(".a::before { content: 'x'; color: rgb(1, 0, 0); } div::before { content: 'y'; color: rgb(2, 0, 0); } div.a:before { color: rgb(3, 0, 0); } .a { color: rgb(9, 9, 9); } .a::after { content: 'z'; }", (r) => host(r));
    expect(messages(c)).toEqual([]);
    const colors = resolvedColors(c, []) as ReadonlyMap<string, { color: { r: number } }>;
    expect([colors.get('d')?.color.r, colors.get('d::before')?.color.r, colors.get('d::after')?.color.r]).toEqual([9, 3, 9]);
    expect(layoutTree(c).texts.get('d::before:text0')).toBe('x');
  });
  it('inherits from its host (CSS2 §12.1), including custom properties for var() in content', () => {
    const c = compile(".p { font-size: 10px; } .a { --tw-content: 'v'; color: rgb(5, 0, 0); font-size: 20px; } .a::before { content: var(--tw-content); }", (r) => [el(r, 'p', 'div', ['p'], host(r))]);
    expect(messages(c)).toEqual([]);
    expect((resolvedColors(c, []) as ReadonlyMap<string, { color: { r: number } }>).get('d::before')?.color.r).toBe(5);
    expect(layoutTree(c).texts.get('d::before:text0')).toBe('v');
    expect((resolvedTextColors(c, []) as ReadonlyMap<string, { r: number }>).get('d::before:text0')?.r).toBe(5);
  });
  it('generated text collapses with the host\'s text across the boundary (R7)', () => {
    const c = compile(".a::before { content: 'x  '; } .a::after { content: '  z'; }", (r) => host(r, [text(r, 't', '  y  ')]));
    expect(messages(c)).toEqual([]);
    const t = layoutTree(c).texts;
    expect([t.get('d::before:text0'), t.get('d:text0'), t.get('d::after:text0')]).toEqual(['x ', 'y ', 'z']);
  });
  it('a flex host blockifies its generated boxes (R8)', () => {
    const c = compile(".a { display: flex; } .a::before { content: 'x'; } .a::after { content: ''; position: absolute; inset: 0; }", (r) => [el(r, 'd', 'div', ['a'], [el(r, 'k', 'div', [], [text(r, 't', 'y')])])]);
    expect(messages(c)).toEqual([]);
    const s = layoutTree(c).styles;
    expect([s.get('d::before')?.display, s.get('d::after')?.display, s.get('d::after')?.position]).toEqual(['block', 'block', 'absolute']);
  });
});

describe('refusals (R3, R4, R8, R12)', () => {
  it('a replaced host and the root generate no box: refused naming REPL and GEN-d', () => {
    const c = compile(".i::before { content: 'x'; } html::after { content: 'y'; }", (r) => [el(r, 'i', 'img', ['i'], [], [attr(r, 'src', 'data:image/png;base64,AA=='), attr(r, 'width', '4'), attr(r, 'height', '4')])]);
    const m = messages(c).filter((x) => x.includes('::'));
    expect(m.some((x) => /content: "x" on i::before is not supported yet: <img> is a replaced element.*REPL/.test(x))).toBe(true);
    expect(m.some((x) => /::after is not supported yet: the root element's.*GEN-d/.test(x))).toBe(true);
  });
  it('display list-item, table and contents on a generated box are refused naming GEN-d6, TBL and GEN-d', () => {
    for (const [d, owner] of [['list-item', 'GEN-d6'], ['table', 'TBL'], ['contents', 'GEN-d']] as const) {
      const m = messages(compile(`.a::before { content: 'x'; display: ${d}; list-style: none; }`, (r) => host(r)));
      expect(m.some((x) => x.startsWith('DRAGON_UNSUPPORTED_VALUE') && x.includes('d::before') && x.includes(owner)), `${d}: ${m.join('\n')}`).toBe(true);
    }
  });
  it('an authored direction on a generated box is refused: it takes its host\'s (R6)', () => {
    const m = messages(compile(".a::before { content: 'x'; direction: rtl; }", (r) => host(r)));
    expect(m.some((x) => x.includes('d::before') && x.includes('direction'))).toBe(true);
  });
  it('content that differs between states is refused naming GEN-d8 (R12); a style change of the same box is not', () => {
    const states = (r: SourceRef): TreeNode[] => [el(r, 'd', 'div', [], [text(r, 't', 'x')], [{ name: 'ui-open', value: [{ when: eq('open', true), value: '' }, { when: { kind: 'not', value: eq('open', true) }, value: null }], origin: { kind: 'authored', span: { source: r, start: 0, end: 0 } } }])];
    const input = (css: string) => {
      const i = inputFor(`${FONT} ${css}`, states);
      if (i.tree === null) throw new Error('no tree');
      return { ...i, tree: { ...i.tree, components: i.tree.components.map((k) => ({ ...k, states: [{ id: 'open', domain: [false, true], initial: false, origin: k.origin }] })) } } as FrontEndResult;
    };
    const refused = project().compile(input("div::after { content: '+'; } div[ui-open]::after { content: '-'; }"));
    expect(messages(refused).some((x) => x.startsWith('DRAGON_UNSUPPORTED_VALUE null the ::after box of d differs') && x.includes('GEN-d8'))).toBe(true);
    const restyled = project().compile(input("div::after { content: '+'; } div[ui-open]::after { color: red; }"));
    expect(messages(restyled)).toEqual([]);
  });
  it('a transition in a rule that styles ::before is refused on every target', () => {
    const m = messages(compile(".a::before { content: 'x'; transition: color 1s; }", (r) => host(r)));
    expect(m.some((x) => x.startsWith('DRAGON_UNSUPPORTED_VALUE null transition') && x.includes('::before') && x.includes('GEN-d8'))).toBe(true);
  });
  it('every refusal is catalogued', () => {
    expectCatalogued(compile(".a::before { content: 'x'; display: table; direction: rtl; transition: color 1s; }", (r) => host(r)).diagnostics);
  });
});

describe('statically empty pseudo-elements (R5)', () => {
  const PREFLIGHT = '*, ::after, ::before, ::backdrop, ::file-selector-button { box-sizing: border-box; border: 0 solid; margin: 0; padding: 0; }';
  it('the Tailwind preflight first rule compiles when no element can host them, and generates no box', () => {
    const c = compile(PREFLIGHT, (r) => host(r));
    expect(messages(c)).toEqual([]);
    expect(addresses(c).filter((a) => a.includes('::'))).toEqual([]);
  });
  it('a host is refused at the pseudo-element: a [popover] for ::backdrop, an input with a placeholder for ::placeholder', () => {
    const popover = compile(PREFLIGHT, (r) => [el(r, 'd', 'div', [], [], [attr(r, 'popover')])]);
    expect(messages(popover).filter((m) => m.startsWith('DRAGON_UNSUPPORTED_SELECTOR'))).toEqual([expect.stringMatching(/^DRAGON_UNSUPPORTED_SELECTOR null ::backdrop is accepted only when no element can host it, but d may: a \[popover\]/), expect.stringMatching(/::file-selector-button .*FORM\)$/)]);
    const input = (css: string) => inputFor(`${FONT} ${css}`, (r) => [el(r, 'f', 'input', [], [], [attr(r, 'placeholder', 'name')])]);
    const i = input('::placeholder { color: red; }');
    const c = project().compile(i);
    const d = c.diagnostics.find((x) => x.code === 'DRAGON_UNSUPPORTED_SELECTOR') as Diagnostic;
    expect(spanTextOf(i, d)).toBe('::placeholder');
    // The planted fault staticEmptyIgnoresHost accepts it.
    expect(project({ ...NO_FAULTS, staticEmptyIgnoresHost: true }).compile(i).diagnostics.filter((x) => x.code === 'DRAGON_UNSUPPORTED_SELECTOR')).toEqual([]);
  });
});

describe('profile contexts (R10)', () => {
  it('content on a generated box is keyed in the pseudo contexts, with an empty inline apart', () => {
    const m = messages(compile(".a::before { content: 'x'; } .a::after { content: ''; } .b::before { content: 'y'; display: block; }", (r) => [...host(r), el(r, 'e', 'div', ['b'], [text(r, 'u', 'v')])], NO_FAULTS, 'enforce'));
    const contexts = [...new Set(m.flatMap((x) => /used in the (\S+) context/.exec(x)?.[1] ?? []))].sort();
    expect(contexts).toEqual(['pseudo-block/ltr', 'pseudo-empty-inline-in-block/ltr', 'pseudo-inline-in-block/ltr']);
  });
});

describe('web output (R10)', () => {
  it('writes .cls::before and .cls::after with content and every longhand, and nothing for a host without one', () => {
    const c = compile(".a::before { content: 'x\"y'; color: rgb(1, 2, 3); } .a::after { content: ''; }", (r) => [...host(r), el(r, 'e', 'div', [], [text(r, 'u', 'v')])]);
    expect(messages(c)).toEqual([]);
    if (c.outputs.web.kind !== 'ready') throw new Error('web blocked');
    const css = (c.outputs.web.files.find((f) => f.path === WEB_CSS_PATH) as { text: string }).text;
    const classOf = webClassMap(c, []) as ReadonlyMap<string, string>;
    const cls = classOf.get('d') as string;
    expect(classOf.has('d::before')).toBe(false);
    const rule = (sel: string): string => (new RegExp(`\\n${sel.replace(/[.:]/g, (m) => `\\${m}`)} \\{\\n([^}]*)\\}`).exec(css)?.[1] ?? '');
    expect(rule(`.${cls}::before`)).toContain('  content: "x\\"y";\n');
    expect(rule(`.${cls}::before`)).toContain('  color: rgb(1, 2, 3);\n');
    expect(rule(`.${cls}::after`)).toContain('  content: "";\n');
    expect(rule(`.${cls}::before`).split('\n').length).toBe(rule(`.${cls}`).split('\n').length);
    expect(css).not.toContain(`.${classOf.get('e') as string}::`);
  });
});

describe('plants (compiler)', () => {
  const css = ".a::before { content: 'b' 'c'; } .a::after { content: '  z'; }";
  const body: Body = (r) => host(r, [text(r, 't', 'y ')]);
  const base = layoutTree(compile(css, body));
  it('pseudoContentNormalGenerates: content normal generates an empty box', () => {
    const c = compile('', body, { ...NO_FAULTS, pseudoContentNormalGenerates: true });
    expect(addresses(c).filter((a) => a.includes('::'))).toContain('d::before');
  });
  it('pseudoAfterFirst: ::after goes before the host\'s content', () => {
    const t = layoutTree(compile(css, body, { ...NO_FAULTS, pseudoAfterFirst: true }));
    expect(t.ids.indexOf('d::after')).toBeLessThan(t.ids.indexOf('d:text0'));
    expect(base.ids.indexOf('d::after')).toBeGreaterThan(base.ids.indexOf('d:text0'));
  });
  it('pseudoInheritsFromHostParent: the box inherits from its host\'s parent', () => {
    const tree: Body = (r) => [el(r, 'p', 'div', ['p'], host(r))];
    const sheet = ".p { color: rgb(1, 0, 0); } .a { color: rgb(2, 0, 0); } .a::before { content: 'x'; }";
    const red = (f: CompilerFaults) => (resolvedColors(compile(sheet, tree, f), []) as ReadonlyMap<string, { color: { r: number } }>).get('d::before')?.color.r;
    expect([red(NO_FAULTS), red({ ...NO_FAULTS, pseudoInheritsFromHostParent: true })]).toEqual([2, 1]);
  });
  it('legacyPseudoAsClass: a single-colon .a:before outweighs a later div.a::before', () => {
    const sheet = ".a:before { content: 'x'; color: rgb(1, 0, 0); } div.a::before { color: rgb(2, 0, 0); }";
    const red = (f: CompilerFaults) => (resolvedColors(compile(sheet, (r) => host(r), f), []) as ReadonlyMap<string, { color: { r: number } }>).get('d::before')?.color.r;
    expect([red(NO_FAULTS), red({ ...NO_FAULTS, legacyPseudoAsClass: true })]).toEqual([2, 1]);
  });
  it('contentFirstStringOnly: content \'b\' \'c\' generates b', () => {
    expect(layoutTree(compile(css, body, { ...NO_FAULTS, contentFirstStringOnly: true })).texts.get('d::before:text0')).toBe('b');
    expect(base.texts.get('d::before:text0')).toBe('bc');
  });
  it('generatedTextCollapsedAlone: the generated text collapses outside its host\'s inline formatting context', () => {
    const tree: Body = (r) => host(r, [text(r, 't', ' y')]);
    const after = (f: CompilerFaults) => layoutTree(compile(".a::before { content: 'x'; }", tree, f)).texts.get('d:text0');
    expect([after(NO_FAULTS), after({ ...NO_FAULTS, generatedTextCollapsedAlone: true })]).toEqual([' y', 'y']);
  });
  it('pseudoOnReplacedGenerated: an img generates its boxes and is accepted', () => {
    const img: Body = (r) => [el(r, 'i', 'img', ['i'], [], [attr(r, 'src', 'data:image/png;base64,AA=='), attr(r, 'width', '4'), attr(r, 'height', '4')])];
    const refused = (f: CompilerFaults) => messages(compile(".i::before { content: 'x'; }", img, f)).filter((m) => m.includes('i::before'));
    expect(refused(NO_FAULTS).length).toBeGreaterThan(0);
    expect(refused({ ...NO_FAULTS, pseudoOnReplacedGenerated: true })).toEqual([]);
  });
});
