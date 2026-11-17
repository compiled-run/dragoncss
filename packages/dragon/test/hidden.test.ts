// HTML §15.3.1: `[hidden]:not([hidden=until-found i]) { display: none }` is a UA rule, so any author display beats it.
import { describe, expect, it } from 'vitest';
import type { LinkedElement } from '../src/analysis/link.ts';
import type { ResolvedElement } from '../src/analysis/resolve.ts';
import { resolveTree } from '../src/analysis/resolve.ts';
import { attributeRefusal } from '../src/attributes.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import { NO_FAULTS } from '../src/faults.ts';
import { createProject } from '../src/index.ts';
import type { ElementNode } from '../src/index.ts';
import type { Diagnostic } from '../src/types.ts';
import { referenceDataset } from '../src/ua/datasets.ts';
import { always, div, inputFor } from './helpers.ts';

const SRC = { uri: 's.css', revision: 'r', hash: 'h' };
const origin = { kind: 'unlocated', reason: 'test' } as const;
const el = (id: string, classes: string[], attributes: [string, string][] = [], children: LinkedElement[] = [], tag = 'div'): LinkedElement => ({
  kind: 'element', address: id, instance: 'doc', owner: 'App', tag, classes: classes.map((name) => ({ owner: 'o', sheet: 'sheet', name })), attributes: new Map(attributes), children,
  node: { kind: 'element', id, tag, classes: [], attributes: [], children: [], origin },
});

function display(css: string, attributes: [string, string][]): string {
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SRC, start: 0, end: css.length }, { id: 'sheet', owner: 'o', scope: 'document' }, 0, diagnostics);
  expect(diagnostics).toEqual([]);
  const root = resolveTree(el('html', [], [], [el('body', [], [], [el('t', ['t'], attributes)], 'body')], 'html'), rules, NO_FAULTS, { direction: 'ltr', rootFont: 'ahem', ua: referenceDataset() });
  const t = (root.children[0] as ResolvedElement).children[0] as ResolvedElement;
  const value = t.props.get('display')?.value;
  return value?.kind === 'keyword' ? value.value : JSON.stringify(value);
}

describe('the hidden attribute', () => {
  it('is display: none from the UA origin, with or without a value', () => {
    expect(display('.t { color: red; }', [['hidden', '']])).toBe('none');
    expect(display('.t { color: red; }', [['hidden', 'hidden']])).toBe('none');
    expect(display('.t { color: red; }', [])).toBe('block');
  });

  it('loses to an author display, as every UA rule does', () => {
    expect(display('.t { display: flex; }', [['hidden', '']])).toBe('flex');
  });

  it('compiles, and hidden="until-found" is refused by name (Chrome draws it with content-visibility: hidden)', () => {
    expect(attributeRefusal('div', 'hidden')).toBeNull();
    const attr = (value: string) => ({ name: 'hidden', value: [{ when: always, value }], origin });
    const tree = (value: string) => inputFor('.a { width: 1px; }', (r) => [{ ...div(r, 'a', ['a']), attributes: [attr(value)] } as ElementNode]);
    const project = createProject({ projectId: 'test', targets: { ios: { minimum: '15.0' }, web: {} } });
    expect(project.compile(tree('')).diagnostics).toEqual([]);
    expect(project.compile(tree('until-found')).diagnostics.map((d) => d.code)).toEqual(['DRAGON_UNSUPPORTED_ATTRIBUTE']);
  });
});
