// The display grammar against Chrome 145: every keyword, and every two- and three-keyword list over the multi-keyword set, is
// accepted by Dragon exactly when Chrome parses it, and an accepted value computes in Chrome as Dragon's value does. Refused
// single keywords are exactly -webkit-box and -webkit-inline-box. Three planted readings must each be caught by the same comparison.
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../../dragon/src/index.ts';
import { valueToString } from '../../dragon/src/analysis/resolve.ts';
import { parseStylesheet } from '../../dragon/src/css/stylesheet.ts';

const SOURCE = { uri: 'dragon-source://test/display.css', revision: 'r1', hash: 'sha256:0' };

type Item = { readonly v: string; readonly code: string | null; readonly message: string | null; readonly value: string | null };
type Seen = { readonly parsed: boolean; readonly authored: string; readonly dragon: string };

function item(v: string): Item {
  const css = `.a { display: ${v}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  if (diagnostics.length > 1) throw new Error(`display: ${v}: more than one diagnostic`);
  const longhands = rules[0]?.declarations[0]?.longhands ?? [];
  const code = diagnostics[0]?.code ?? null;
  if (code === null && longhands.length !== 1) throw new Error(`display: ${v}: accepted without exactly one longhand`);
  return { v, code, message: diagnostics[0]?.message ?? null, value: code === null ? valueToString((longhands[0] as (typeof longhands)[number]).value) : null };
}

const SINGLE = [
  'block', 'inline', 'run-in', 'flow', 'flow-root', 'table', 'flex', 'grid', 'ruby', 'math', 'grid-lanes', 'list-item', 'contents', 'none',
  'table-row-group', 'table-header-group', 'table-footer-group', 'table-row', 'table-cell', 'table-column-group', 'table-column', 'table-caption',
  'ruby-base', 'ruby-text', 'ruby-base-container', 'ruby-text-container', 'inline-block', 'inline-table', 'inline-flex', 'inline-grid', 'inline-grid-lanes',
  '-webkit-box', '-webkit-inline-box', '-webkit-flex', '-webkit-inline-flex', 'inline-list-item', 'block-math', 'block-ruby', 'layout', '-webkit-grid',
  '-WEBKIT-BOX', '-Webkit-Inline-Flex',
];
const PAIR = ['block', 'inline', 'run-in', 'flow', 'flow-root', 'table', 'flex', 'grid', 'ruby', 'math', 'grid-lanes', 'list-item', '-webkit-box', '-webkit-flex', 'inline-block', 'none', 'contents', 'table-cell'];
const TRIPLE = ['block', 'inline', 'run-in', 'flow', 'flow-root', 'flex', 'math', 'list-item', 'table'];
const VALUES = [...SINGLE, ...PAIR.flatMap((a) => PAIR.map((b) => `${a} ${b}`)), ...TRIPLE.flatMap((a) => TRIPLE.flatMap((b) => TRIPLE.map((c) => `${a} ${b} ${c}`)))];
const REFUSED = ['-webkit-box', '-webkit-inline-box', '-WEBKIT-BOX'];

function judge(items: readonly Item[], seen: readonly Seen[]): string[] {
  return items.flatMap((it, i) => {
    const s = seen[i] as Seen;
    if (it.code === null) {
      if (!s.parsed) return [`${it.v}: accepted, Chrome drops it`];
      return s.authored === s.dragon ? [] : [`${it.v}: Chrome computes ${s.authored}, Dragon's ${String(it.value)} computes ${s.dragon}`];
    }
    if (it.code === 'DRAGON_CSS_INVALID_VALUE') return s.parsed ? [`${it.v}: invalid, Chrome parses it`] : [];
    // A refusal is of a value Chrome parses: the legacy box, or a three-keyword list (a multi-token value Dragon does not model).
    if (it.code === 'DRAGON_UNSUPPORTED_VALUE') return s.parsed ? [] : [`${it.v}: refused, Chrome drops it`];
    return [`${it.v}: unexpected ${it.code}`];
  });
}

describe('display: Chrome 145 parsing and computed values', () => {
  type Browser = { newPage(): Promise<{ setContent(html: string): Promise<void>; evaluate(expression: string): Promise<unknown> }>; close(): Promise<void> };

  it('Dragon accepts exactly the values Chrome parses, computes them alike, refuses only the legacy box, and the plants are caught', async () => {
    const real = VALUES.map(item);
    const planted: { readonly name: string; readonly items: Item[] }[] = [
      { name: 'webkitFlexAsBlock', items: real.filter((it) => /^-webkit-(inline-)?flex$/i.test(it.v)).map((it) => ({ ...it, value: 'block' })) },
      { name: 'runInAccepted', items: real.filter((it) => it.v === 'run-in').map((it) => ({ ...it, code: null, value: 'run-in' })) },
      { name: 'webkitBoxInvalid', items: real.filter((it) => REFUSED.includes(it.v)).map((it) => ({ ...it, code: 'DRAGON_CSS_INVALID_VALUE' })) },
    ];
    for (const p of planted) expect(p.items.length, p.name).toBeGreaterThan(0);
    const sets = [real, ...planted.map((p) => p.items)];
    const { launchChrome } = (await import(new URL('../src/chrome.ts', import.meta.url).href)) as { launchChrome: () => Promise<Browser> };
    const browser = await launchChrome();
    let seen: Seen[][];
    try {
      const page = await browser.newPage();
      await page.setContent('<!DOCTYPE html><div><div id="a"></div><div id="c"></div></div>');
      // A string expression: this test project has no DOM types. The authored value on #a, Dragon's value on #c.
      seen = (await page.evaluate(`(${JSON.stringify(sets)}).map((items) => items.map((it) => {
        const a = document.getElementById('a'), c = document.getElementById('c');
        for (const e of [a, c]) e.removeAttribute('style');
        a.style.setProperty('display', it.v);
        const parsed = a.style.getPropertyValue('display') !== '';
        if (it.value !== null) c.style.setProperty('display', it.value);
        return { parsed, authored: getComputedStyle(a).display, dragon: getComputedStyle(c).display };
      }))`)) as Seen[][];
    } finally {
      await browser.close();
    }
    expect(judge(real, seen[0] as Seen[])).toEqual([]);
    const refused = real.filter((it) => it.code === 'DRAGON_UNSUPPORTED_VALUE');
    expect(refused.filter((it) => it.v.split(' ').length === 1).map((it) => it.v)).toEqual(REFUSED);
    for (const it of refused) expect(it.message, it.v).toMatch(it.v.includes(' ') ? /^multi-token value / : /^display: -webkit-(inline-)?box is unsupported: it selects Chrome's legacy -webkit-box layout/);
    // Chrome parses the four legacy keywords, and Dragon accepts -webkit-flex and -webkit-inline-flex as flex and inline-flex.
    expect(real.filter((it) => /^-webkit-(inline-)?flex$/i.test(it.v)).map((it) => [it.v, it.value])).toEqual([['-webkit-flex', 'flex'], ['-webkit-inline-flex', 'inline-flex'], ['-Webkit-Inline-Flex', 'inline-flex']]);
    planted.forEach((p, i) => expect(judge(p.items, seen[i + 1] as Seen[]).length, p.name).toBe(p.items.length));
  }, 120_000);
});
