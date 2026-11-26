// ResolveMemo: cases that leave an element's inputs unchanged share its longhands, and every case resolves as it does alone.
import { describe, expect, it } from 'vitest';
import type { ElementNode, Origin, SourceRef } from '../src/index.ts';
import type { LinkedElement, LinkedText } from '../src/analysis/link.ts';
import type { ResolvedElement, ResolvedText } from '../src/analysis/resolve.ts';
import { isShared, newResolveMemo, resolveTree } from '../src/analysis/resolve.ts';
import { isBlockInInline } from '../src/analysis/block-in-inline.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import type { Diagnostic } from '../src/types.ts';
import { referenceDataset } from '../src/ua/datasets.ts';
import { DOC } from './helpers.ts';
import { NO_FAULTS } from '../src/faults.ts';

const SRC: SourceRef = { uri: 's.css', revision: 'r', hash: 'h' };
const ORIGIN: Origin = { kind: 'unlocated', reason: 'test' };
const ENV = { direction: 'ltr', rootFont: 'ahem', ua: referenceDataset() } as const;

const NODES = new Map<string, ElementNode>();
const nodeOf = (id: string, tag: string): ElementNode => {
  const known = NODES.get(id);
  if (known !== undefined) return known;
  const made: ElementNode = { kind: 'element', id, tag, classes: [], attributes: [], children: [], origin: ORIGIN };
  NODES.set(id, made);
  return made;
};
const linked = (id: string, tag: string, classes: string[], children: (LinkedElement | LinkedText)[] = [], attributes: [string, string][] = []): LinkedElement => ({
  kind: 'element', address: id, instance: DOC, owner: DOC, tag, attributes: new Map(attributes), node: nodeOf(id, tag),
  classes: classes.map((name) => ({ owner: DOC, sheet: 'sheet', name })), children,
});
const text = (id: string, value: string): LinkedText => ({ kind: 'text', address: id, node: { kind: 'text', id, text: value, origin: ORIGIN }, instance: DOC, owner: DOC, text: value });
const doc = (...body: LinkedElement[]): LinkedElement => linked('html', 'html', [], [linked('body', 'body', [], body)]);

function rules(css: string) {
  const diagnostics: Diagnostic[] = [];
  const parsed = parseStylesheet(css, { source: SRC, start: 0, end: css.length }, { id: 'sheet', owner: DOC, scope: 'document' }, 0, diagnostics);
  expect(diagnostics).toEqual([]);
  return parsed;
}

const byAddress = (root: ResolvedElement): Map<string, ResolvedElement | ResolvedText> => {
  const out = new Map<string, ResolvedElement | ResolvedText>();
  const walk = (e: ResolvedElement): void => {
    out.set(e.element.address, e);
    for (const c of e.children) {
      if (c.kind === 'element') walk(c);
      else out.set(c.node.address, c);
    }
  };
  walk(root);
  return out;
};

/** Each page resolved in turn with one memo, beside each resolved alone; every element and text must match its lone resolution. */
function shared(css: string, pages: readonly LinkedElement[]): Map<string, ResolvedElement | ResolvedText>[] {
  const rs = rules(css);
  const memo = newResolveMemo(ENV);
  const out = pages.map((p) => byAddress(resolveTree(p, rs, NO_FAULTS, ENV, undefined, memo)));
  pages.forEach((p, k) => {
    const alone = byAddress(resolveTree(p, rs, NO_FAULTS, ENV));
    const got = out[k] as Map<string, ResolvedElement | ResolvedText>;
    expect([...got.keys()]).toEqual([...alone.keys()]);
    for (const [address, el] of alone) expect([...(got.get(address) as ResolvedElement).props]).toEqual([...el.props]);
  });
  return out;
}

describe('resolving cases with one ResolveMemo', () => {
  it('shares the longhands of elements and texts the case does not change', () => {
    const page = (open: boolean): LinkedElement => doc(
      linked('card', 'div', open ? ['card', 'open'] : ['card'], [linked('label', 'div', [], [text('label:t', 'Label')])]),
      linked('note', 'div', ['note'], [text('note:t', 'Note')]),
    );
    const [closed, open] = shared('.card { padding: 4px; } .card.open { color: red; font-size: 20px; } .note { margin: 2px; }', [page(false), page(true)]) as [Map<string, ResolvedElement>, Map<string, ResolvedElement>];
    for (const address of ['html', 'body', 'note', 'note:t']) {
      expect(open.get(address)?.props).toBe(closed.get(address)?.props);
    }
    expect(isShared((open.get('note') as ResolvedElement).props)).toBe(true);
    // The opened card and the label and text that inherit its colour and font size take their own.
    for (const address of ['card', 'label', 'label:t']) expect(open.get(address)?.props).not.toBe(closed.get(address)?.props);
  });

  it("gives a button in a disabled fieldset's legend its disabled UA style once another legend comes first", () => {
    const page = (another: boolean): LinkedElement => doc(linked('set', 'fieldset', [], [
      ...(another ? [linked('first', 'legend', [])] : []),
      linked('legend', 'legend', [], [linked('go', 'button', [], [text('go:t', 'Go')])]),
    ], [['disabled', '']]));
    const [enabled, disabled] = shared('.x { color: blue; }', [page(false), page(true)]) as [Map<string, ResolvedElement>, Map<string, ResolvedElement>];
    expect(disabled.get('legend')?.props).toBe(enabled.get('legend')?.props);
    expect(disabled.get('go')?.props).not.toBe(enabled.get('go')?.props);
  });

  it("gives a select's inner element the direction of the option it shows", () => {
    const page = (rtl: boolean): LinkedElement => doc(linked('pick', 'select', [], [linked('one', 'option', rtl ? ['rtl'] : [], [text('one:t', 'One')])]));
    const [ltr, rtl] = shared('.rtl { direction: rtl; }', [page(false), page(true)]) as [Map<string, ResolvedElement>, Map<string, ResolvedElement>];
    expect((rtl.get('pick::inner') as ResolvedElement).props.get('direction')?.value).toEqual({ kind: 'keyword', value: 'rtl' });
    expect((ltr.get('pick::inner') as ResolvedElement).props.get('direction')?.value).toEqual({ kind: 'keyword', value: 'ltr' });
  });

  it('splits an inline box around a block child in every case, leaving the shared longhands as resolved', () => {
    const page = (block: boolean): LinkedElement => doc(linked('wrap', 'span', ['i'], [linked('kid', 'div', block ? [] : ['i'], [text('kid:t', 'X')])]));
    const [first, inline, again] = shared('.i { display: inline; }', [page(true), page(false), page(true)]) as [Map<string, ResolvedElement>, Map<string, ResolvedElement>, Map<string, ResolvedElement>];
    for (const [tree, split] of [[first, true], [inline, false], [again, true]] as const) {
      expect(isBlockInInline(tree.get('wrap') as ResolvedElement)).toBe(split);
      expect((tree.get('wrap') as ResolvedElement).props.get('display')?.value).toEqual({ kind: 'keyword', value: split ? 'block' : 'inline' });
    }
  });

  it('is not used for another environment', () => {
    const rs = rules('.a { margin-inline-start: 4px; }');
    const memo = newResolveMemo(ENV);
    const page = doc(linked('a', 'div', ['a']));
    const ltr = byAddress(resolveTree(page, rs, NO_FAULTS, ENV, undefined, memo));
    const rtl = byAddress(resolveTree(page, rs, NO_FAULTS, { ...ENV, direction: 'rtl' }, undefined, memo));
    expect(isShared((rtl.get('a') as ResolvedElement).props)).toBe(false);
    expect([...(rtl.get('a') as ResolvedElement).props]).toEqual([...(byAddress(resolveTree(page, rs, NO_FAULTS, { ...ENV, direction: 'rtl' })).get('a') as ResolvedElement).props]);
    expect((rtl.get('a') as ResolvedElement).props).not.toBe((ltr.get('a') as ResolvedElement).props);
  });
});
