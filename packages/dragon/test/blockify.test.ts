// INL-BF: span, a and label with dragon-unstyled's captured defaults, css-display-3 §2.7 blockification as Chrome 145 does it,
// the refusal of inline-level boxes, and the two planted faults.
import { describe, expect, it } from 'vitest';
import type { ElementNode, Origin, SourceRef, TreeNode } from '../src/index.ts';
import { createProjectWith, NO_FAULTS } from '../src/internal.ts';
import type { CompilerFaults } from '../src/faults.ts';
import type { Longhand } from '../src/css/properties.ts';
import { LONGHANDS } from '../src/css/properties.ts';
import type { ResolvedValue } from '../src/analysis/computed.ts';
import { parseValueText, valueToString } from '../src/analysis/computed.ts';
import { blockify, blockifiedDisplay, checkInlineLevel } from '../src/analysis/blockify.ts';
import { SUPPORTED_TAGS, UNSTYLED_TAGS, uaTagOf } from '../src/analysis/elements.ts';
import * as dark from '../src/ua/chrome-145.darwin-arm64.dark.generated.ts';
import * as light from '../src/ua/chrome-145.darwin-arm64.generated.ts';
import type { LinkedElement } from '../src/analysis/link.ts';
import type { ResolvedElement } from '../src/analysis/resolve.ts';
import { resolveTree } from '../src/analysis/resolve.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import type { Diagnostic } from '../src/types.ts';
import { referenceDataset } from '../src/ua/datasets.ts';
import { DOC, inputFor, staticClass, text } from './helpers.ts';

const SRC: SourceRef = { uri: 's.css', revision: 'r', hash: 'h' };
const ORIGIN: Origin = { kind: 'unlocated', reason: 'test' };

const project = (faults: CompilerFaults = NO_FAULTS) =>
  createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, web: {} } }, { faults, profiles: 'derive', direction: 'ltr' });

function el(ref: SourceRef, id: string, tag: string, classes: string[] = [], children: TreeNode[] = []): ElementNode {
  const origin: Origin = { kind: 'authored', span: { source: ref, start: 0, end: 0 } };
  return { kind: 'element', id, tag, classes: classes.map((name) => staticClass({ owner: DOC, sheet: 's', name }, origin)), attributes: [], children, origin };
}

const FONT = 'body { font-family: Ahem; } .f { display: flex; } .g { display: grid; } .ct { display: contents; } .ab { position: absolute; } .fx { position: fixed; } .rel { position: relative; } .ib { display: inline-block; } .if { display: inline-flex; } .it { display: inline-table; }';
const displayOf = (tree: (r: SourceRef) => TreeNode[], id: string, faults: CompilerFaults = NO_FAULTS): string => {
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(FONT, { source: SRC, start: 0, end: FONT.length }, { id: 'sheet', owner: DOC, scope: 'document' }, 0, diagnostics);
  expect(diagnostics).toEqual([]);
  const linked = (n: TreeNode): LinkedElement | null => n.kind !== 'element' ? null : {
    kind: 'element', address: n.id, instance: DOC, owner: DOC, tag: n.tag, attributes: new Map(), node: n,
    classes: n.classes.map((c) => ({ owner: DOC, sheet: 'sheet', name: (c.value[0] as { value: { name: string } }).value.name })),
    children: n.children.map(linked).filter((c): c is LinkedElement => c !== null),
  };
  const body: LinkedElement = { kind: 'element', address: 'body', instance: DOC, owner: DOC, tag: 'body', classes: [], attributes: new Map(), children: tree(SRC).map(linked).filter((c): c is LinkedElement => c !== null), node: { kind: 'element', id: 'body', tag: 'body', classes: [], attributes: [], children: [], origin: ORIGIN } };
  const root = resolveTree({ ...body, address: 'html', tag: 'html', children: [body] }, rules, faults, { direction: 'ltr', rootFont: 'ahem', ua: referenceDataset() });
  const find = (e: ResolvedElement): ResolvedElement | null => {
    if (e.element.address === id) return e;
    for (const c of e.children) if (c.kind === 'element') {
      const hit = find(c);
      if (hit !== null) return hit;
    }
    return null;
  };
  return valueToString(((find(root) as ResolvedElement).props.get('display') as ResolvedValue).value);
};
const codes = (tree: (r: SourceRef) => TreeNode[], faults: CompilerFaults = NO_FAULTS) => project(faults).compile(inputFor(FONT, tree)).diagnostics.map((d) => `${d.code} ${String(d.target)} ${d.message.split(' makes ')[0]}`);

describe('span, a and label in the element table', () => {
  it('are supported and read dragon-unstyled\'s UA row', () => {
    for (const t of ['span', 'a', 'label']) {
      expect(SUPPORTED_TAGS.has(t)).toBe(true);
      expect(uaTagOf(t)).toBe('dragon-unstyled');
    }
    expect(uaTagOf('div')).toBe('div');
    expect([...UNSTYLED_TAGS].sort()).toEqual(['a', 'br', 'label', 'span']);
  });
  // The captured Chrome tables are what makes dragon-unstyled right for them: no modelled UA declaration, context or text font,
  // and every computed longhand equal to dragon-unstyled's, in light and dark.
  for (const [scheme, ds] of [['light', light], ['dark', dark]] as const) {
    it(`${scheme}: span and a (no href) have no modelled UA rule and compute like dragon-unstyled`, () => {
      for (const k of ['span', 'a'] as const) {
        expect(ds.elementKeySpecs[k].attributes).toEqual({});
        expect(ds.elementKeyLonghands[k]).toEqual([]);
        expect(ds.elementKeyDeclared[k]).toEqual({ ltr: {}, rtl: {} });
        expect(ds.elementKeyContexts[k]).toEqual([]);
        expect(ds.elementKeyTextFonts[k]).toEqual({});
        expect(ds.userAgentUnmodelled[k]).toEqual({ ltr: {}, rtl: {} });
        expect(ds.userAgentForced[k]).toEqual({ ltr: {}, rtl: {} });
        for (const p of LONGHANDS) expect(ds.elementKeyComputed[k][p], `${k} ${p}`).toBe(ds.computed['dragon-unstyled'][p]);
      }
    });
    it(`${scheme}: label has only the unmodelled cursor: default and computes like dragon-unstyled`, () => {
      expect(ds.phrasingKeySpecs.label.attributes).toEqual({});
      expect(ds.phrasingKeyLonghands.label).toEqual([]);
      expect(ds.phrasingKeyDeclared.label).toEqual({ ltr: {}, rtl: {} });
      expect(ds.phrasingKeyContexts.label).toEqual([]);
      expect(ds.phrasingKeyTextFonts.label).toEqual({});
      expect(ds.phrasingKeyUnmodelled.label).toEqual({ ltr: { cursor: 'default' }, rtl: { cursor: 'default' } });
      expect(ds.phrasingKeyForced.label).toEqual({ ltr: {}, rtl: {} });
      expect(LONGHANDS).not.toContain('cursor');
      for (const p of LONGHANDS) expect(ds.phrasingKeyComputed.label[p], `label ${p}`).toBe(ds.computed['dragon-unstyled'][p]);
    });
  }
});

describe('br in the element table (INL1a)', () => {
  it('is supported and reads dragon-unstyled\'s UA row', () => {
    expect(SUPPORTED_TAGS.has('br')).toBe(true);
    expect(uaTagOf('br')).toBe('dragon-unstyled');
  });
  for (const [scheme, ds] of [['light', light], ['dark', dark]] as const) {
    it(`${scheme}: br has no UA rule at all and computes like dragon-unstyled`, () => {
      expect(ds.phrasingKeySpecs.br.attributes).toEqual({});
      expect(ds.phrasingKeyLonghands.br).toEqual([]);
      expect(ds.phrasingKeyDeclared.br).toEqual({ ltr: {}, rtl: {} });
      expect(ds.phrasingKeyContexts.br).toEqual([]);
      expect(ds.phrasingKeyTextFonts.br).toEqual({});
      expect(ds.phrasingKeyUnmodelled.br).toEqual({ ltr: {}, rtl: {} });
      expect(ds.phrasingKeyForced.br).toEqual({ ltr: {}, rtl: {} });
      for (const p of LONGHANDS) expect(ds.phrasingKeyComputed.br[p], `br ${p}`).toBe(ds.computed['dragon-unstyled'][p]);
    });
  }
});

describe('blockifiedDisplay: Chrome 145.0.7632.6 on a flex item and an absolutely positioned span (notes/T057)', () => {
  const at = (text: string): string | null => {
    const v: ResolvedValue = { value: parseValueText('display', text), origin: 'author', span: null, declaration: null, declared: null, losing: [] };
    const out = blockifiedDisplay(v, NO_FAULTS);
    return out === null ? null : valueToString(out.value);
  };
  it('maps every inline-level and layout-internal display to its block-level equivalent', () => {
    const probed: [string, string][] = [
      ['inline', 'block'], ['inline-block', 'block'], ['inline flow', 'block'], ['inline flow-root', 'block'], ['flow-root inline', 'block'], ['math', 'block'], ['inline math', 'block'],
      ['inline-flex', 'flex'], ['inline flex', 'flex'], ['inline-grid', 'grid'], ['inline grid', 'grid'], ['inline-table', 'table'], ['inline table', 'table'],
      ['ruby', 'block ruby'], ['inline ruby', 'block ruby'], ['-webkit-inline-box', '-webkit-box'],
      ['inline list-item', 'list-item'], ['list-item inline', 'list-item'], ['inline flow list-item', 'list-item'], ['inline flow-root list-item', 'flow-root list-item'], ['flow-root list-item inline', 'flow-root list-item'],
      ['table-row-group', 'block'], ['table-header-group', 'block'], ['table-footer-group', 'block'], ['table-row', 'block'], ['table-cell', 'block'],
      ['table-column-group', 'block'], ['table-column', 'block'], ['table-caption', 'block'], ['ruby-base', 'block'], ['ruby-text', 'block'],
    ];
    for (const [from, to] of probed) expect(at(from), from).toBe(to);
  });
  it('leaves block-level displays, contents and none unchanged', () => {
    for (const v of ['block', 'flex', 'grid', 'table', 'flow-root', 'list-item', 'contents', 'none', 'block flow', 'flow-root list-item']) expect(at(v), v).toBeNull();
  });
  it('inlineFlexToBlock turns inline-flex into block', () => {
    const v: ResolvedValue = { value: parseValueText('display', 'inline-flex'), origin: 'author', span: null, declaration: null, declared: null, losing: [] };
    expect(valueToString((blockifiedDisplay(v, { ...NO_FAULTS, inlineFlexToBlock: true }) as ResolvedValue).value)).toBe('block');
  });
});

describe('blockification in the resolver', () => {
  it('flex and grid items and absolutely positioned boxes are blockified; an in-flow child of a block is not', () => {
    expect(displayOf((r) => [el(r, 'c', 'div', ['f'], [el(r, 's', 'span', [], [text(r, 't', 'X')])])], 's')).toBe('block');
    expect(displayOf((r) => [el(r, 'c', 'div', ['f'], [el(r, 's', 'a', ['if'])])], 's')).toBe('flex');
    expect(displayOf((r) => [el(r, 'c', 'div', ['f'], [el(r, 's', 'label', ['ib'])])], 's')).toBe('block');
    expect(displayOf((r) => [el(r, 'c', 'div', ['f'], [el(r, 's', 'span', ['it'])])], 's')).toBe('table');
    expect(displayOf((r) => [el(r, 'c', 'div', ['g'], [el(r, 's', 'span')])], 's')).toBe('block');
    expect(displayOf((r) => [el(r, 'c', 'div', ['rel'], [el(r, 's', 'span', ['ab'])])], 's')).toBe('block');
    expect(displayOf((r) => [el(r, 'c', 'div', [], [el(r, 's', 'span', ['fx'])])], 's')).toBe('block');
    expect(displayOf((r) => [el(r, 'c', 'div', ['rel'], [el(r, 's', 'span', ['ab', 'if'])])], 's')).toBe('flex');
    expect(displayOf((r) => [el(r, 'c', 'div', [], [el(r, 's', 'span')])], 's')).toBe('inline');
    expect(displayOf((r) => [el(r, 'c', 'div', [], [el(r, 's', 'span', ['rel'])])], 's')).toBe('inline');
  });
  it('the layout parent skips display: contents, and a flex item\'s children are not flex items', () => {
    expect(displayOf((r) => [el(r, 'c', 'div', ['f'], [el(r, 'k', 'span', ['ct'], [el(r, 's', 'span')])])], 'k')).toBe('contents');
    expect(displayOf((r) => [el(r, 'c', 'div', ['f'], [el(r, 'k', 'span', ['ct'], [el(r, 's', 'span')])])], 's')).toBe('block');
    expect(displayOf((r) => [el(r, 'c', 'div', [], [el(r, 'k', 'div', ['ct'], [el(r, 's', 'span')])])], 's')).toBe('inline');
    expect(displayOf((r) => [el(r, 'c', 'div', ['f'], [el(r, 'b', 'span', [], [el(r, 's', 'span')])])], 's')).toBe('inline');
    expect(displayOf((r) => [el(r, 'c', 'div', ['f'], [el(r, 'b', 'span', ['if'], [el(r, 's', 'span')])])], 's')).toBe('block');
  });
  it('an inline box (display: inline, INL1a) is not refused, an atomic inline is refused on every target, and display: none subtrees are not laid out', () => {
    // INL1a part C1: analysis lets the inline box through; it has no lowering until part C2, so the ios output refuses it there.
    expect(codes((r) => [el(r, 'c', 'div', [], [el(r, 's', 'span', [], [text(r, 't', 'X')])])])).toEqual(['DRAGON_LOWERING_FAILED ios display: inline on s has no layout mapping (expected block | flex)']);
    // An author's inline-block or inline-flex in a block container: an atomic inline (INL2), refused on ios and web by the
    // committed support profiles, with both outputs blocked.
    for (const cls of ['ib', 'if']) {
      const c = createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, web: {} } }, { faults: NO_FAULTS, profiles: 'enforce', direction: 'ltr' }).compile(inputFor(FONT, (r) => [el(r, 'c', 'div', [], [el(r, 's', 'span', [cls], [text(r, 't', 'X')])])]));
      const onDisplay = c.diagnostics.filter((d) => /display/.test(d.message));
      expect([...new Set(onDisplay.map((d) => String(d.target)))].sort(), cls).toEqual(['ios', 'web']);
      expect([c.outputs.ios.kind, c.outputs.web.kind], cls).toEqual(['blocked', 'blocked']);
    }
    const reported: Diagnostic[] = [];
    const atomic = { element: { address: 's', tag: 'span', node: { origin: { kind: 'unlocated', reason: 'test' } } }, props: new Map([['display', { value: parseValueText('display', 'inline-block'), origin: 'user-agent', span: null, declaration: null, declared: null, losing: [] }]]) } as unknown as ResolvedElement;
    checkInlineLevel(atomic, ['ios', 'web'], reported, new Set());
    expect(reported.map((d) => `${d.code} ${String(d.target)} ${d.message.split(' makes ')[0]}`)).toEqual(['DRAGON_UNSUPPORTED_VALUE ios display: inline-block on <span> s', 'DRAGON_UNSUPPORTED_VALUE web display: inline-block on <span> s']);
    expect(codes((r) => [el(r, 'c', 'div', ['f'], [el(r, 's', 'label', [], [text(r, 't', 'X')])])])).toEqual([]);
    expect(project().compile(inputFor(`${FONT} .n { display: none; }`, (r) => [el(r, 'c', 'div', ['n'], [el(r, 's', 'span')])])).diagnostics).toEqual([]);
  });
  it('blockifySkipped leaves a flex item inline: an inline box, which the ios lowering refuses until INL1a part C2 lowers it', () => {
    const faults = { ...NO_FAULTS, blockifySkipped: true };
    const tree = (r: SourceRef) => [el(r, 'c', 'div', ['f'], [el(r, 's', 'span', [], [text(r, 't', 'X')])])];
    expect(displayOf(tree, 's', faults)).toBe('inline');
    expect(codes(tree)).toEqual([]);
    expect(codes(tree, faults)).toEqual(['DRAGON_LOWERING_FAILED ios display: inline on s has no layout mapping (expected block | flex)']);
  });
  it('a parent that was not blockified first is an error, not a silent in-flow child', () => {
    const props = (display: string) => new Map<Longhand, ResolvedValue>([['display', { value: parseValueText('display', display), origin: 'author', span: null, declaration: null, declared: null, losing: [] } as ResolvedValue], ['position', { value: parseValueText('position', 'static'), origin: 'initial', span: null, declaration: null, declared: null, losing: [] } as ResolvedValue]]);
    expect(() => blockify(props('inline'), props('flex'), NO_FAULTS)).toThrow('blockify: the parent was not blockified first');
    const parent = props('inline flex');
    blockify(parent, null, NO_FAULTS);
    const child = props('inline');
    blockify(child, parent, NO_FAULTS);
    expect(valueToString((child.get('display') as ResolvedValue).value)).toBe('block');
  });
  it('inlineFlexToBlock makes a blockified inline-flex a block', () => {
    expect(displayOf((r) => [el(r, 'c', 'div', ['f'], [el(r, 's', 'span', ['if'])])], 's', { ...NO_FAULTS, inlineFlexToBlock: true })).toBe('block');
  });
});
