// ResolveMemo: cases that leave an element's cascade inputs unchanged share its longhands, and every case resolves as it does alone.
import { describe, expect, it } from 'vitest';
import type { ElementNode, Origin, SourceRef } from '../src/index.ts';
import type { LinkedElement } from '../src/analysis/link.ts';
import type { ResolvedElement } from '../src/analysis/resolve.ts';
import { newResolveMemo, resolveTree } from '../src/analysis/resolve.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import type { Diagnostic } from '../src/types.ts';
import { referenceDataset } from '../src/ua/datasets.ts';
import { DOC } from './helpers.ts';
import { NO_FAULTS } from '../src/faults.ts';

const SRC: SourceRef = { uri: 's.css', revision: 'r', hash: 'h' };
const ORIGIN: Origin = { kind: 'unlocated', reason: 'test' };
const CSS = '.card { padding: 4px; } .card.open { color: red; font-size: 20px; } .note { margin: 2px; }';
const ENV = { direction: 'ltr', rootFont: 'ahem', ua: referenceDataset() } as const;

const node = (id: string, tag: string): ElementNode => ({ kind: 'element', id, tag, classes: [], attributes: [], children: [], origin: ORIGIN });
const linked = (id: string, tag: string, classes: string[], children: LinkedElement[] = []): LinkedElement => ({
  kind: 'element', address: id, instance: DOC, owner: DOC, tag, attributes: new Map(), node: NODES.get(id) as ElementNode,
  classes: classes.map((name) => ({ owner: DOC, sheet: 'sheet', name })), children,
});
const NODES = new Map(['html', 'body', 'card', 'label', 'note'].map((id) => [id, node(id, id === 'html' || id === 'body' ? id : 'div')]));

/** The page in one case: the card open or not, beside a note that no state touches. */
const page = (open: boolean): LinkedElement =>
  linked('html', 'html', [], [linked('body', 'body', [], [
    linked('card', 'div', open ? ['card', 'open'] : ['card'], [linked('label', 'div', [])]),
    linked('note', 'div', ['note']),
  ])]);

function rules() {
  const diagnostics: Diagnostic[] = [];
  const parsed = parseStylesheet(CSS, { source: SRC, start: 0, end: CSS.length }, { id: 'sheet', owner: DOC, scope: 'document' }, 0, diagnostics);
  expect(diagnostics).toEqual([]);
  return parsed;
}

const byAddress = (root: ResolvedElement): Map<string, ResolvedElement> => {
  const out = new Map<string, ResolvedElement>();
  const walk = (e: ResolvedElement): void => {
    out.set(e.element.address, e);
    for (const c of e.children) if (c.kind === 'element') walk(c);
  };
  walk(root);
  return out;
};

describe('resolving cases with one ResolveMemo', () => {
  it('gives every case the longhands it gets alone, and shares those of elements the case does not change', () => {
    const rs = rules();
    const memo = newResolveMemo();
    const closed = byAddress(resolveTree(page(false), rs, NO_FAULTS, ENV, undefined, memo));
    const open = byAddress(resolveTree(page(true), rs, NO_FAULTS, ENV, undefined, memo));
    for (const [shared, alone] of [[closed, byAddress(resolveTree(page(false), rs, NO_FAULTS, ENV))], [open, byAddress(resolveTree(page(true), rs, NO_FAULTS, ENV))]] as const) {
      for (const [address, el] of alone) expect([...(shared.get(address) as ResolvedElement).props]).toEqual([...el.props]);
    }
    for (const address of ['html', 'body', 'note']) expect(open.get(address)?.props).toBe(closed.get(address)?.props);
    // The opened card and the label that inherits its colour and font size take their own.
    for (const address of ['card', 'label']) expect(open.get(address)?.props).not.toBe(closed.get(address)?.props);
  });
});
