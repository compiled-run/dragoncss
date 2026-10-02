// The WM-0 dual computed check, which needs the pinned Chrome and so sits with the other Chrome suites, not the platform-free ones.
import { parse } from 'css-tree';
import { describe, expect, it } from 'vitest';
import { list } from '../../dragon/src/css/ast.ts';
import { properties as grammar } from '../../dragon/src/css/grammar.generated.ts';
import { HORIZONTAL_WRITING_MODES } from '../../dragon/src/css/properties/writing-mode.ts';
import { SHORTHAND_HANDLERS } from '../../dragon/src/css/shorthands/index.ts';
import type { ShorthandHandler } from '../../dragon/src/css/shorthands/index.ts';

const SOURCE = { uri: 'dragon-source://test/wm.css', revision: 'r1', hash: 'sha256:0' };

/** Every writing-mode keyword the grammar accepts: webref's five and the six SVG 1.1 values (css-writing-modes-4 Appendix B). */
const KEYWORDS = (grammar['writing-mode']?.syntax ?? '').split('|').map((s) => s.trim());
const VERTICAL = KEYWORDS.filter((k) => !(HORIZONTAL_WRITING_MODES as readonly string[]).includes(k));

// The dual computed check: Dragon accepts a writing-mode keyword exactly when Chrome 145 computes it to horizontal-tb. The planted
// handler verticalAcceptedAsHorizontal accepts every keyword; the same check must catch it.
describe('writing-mode family: Chrome 145 computed values', () => {
  const load = async <T>(file: string): Promise<T> => (await import(new URL(`../src/${file}`, import.meta.url).href)) as T;
  type Browser = { newPage(): Promise<{ setContent(html: string): Promise<void>; evaluate(expression: string): Promise<unknown> }>; close(): Promise<void> };

  /** Whether a handler accepts a grammar-valid writing-mode keyword: its refusal check returns null. */
  const accepts = (h: ShorthandHandler, v: string): boolean => {
    const tokens = list((parse as (text: string, options: object) => ReturnType<typeof parse>)(v, { context: 'value', positions: true }), 'children').filter((n) => n.type !== 'WhiteSpace');
    return (h.refuse?.(tokens, { source: SOURCE, start: 0, end: v.length }, v) ?? null) === null;
  };
  const verticalAcceptedAsHorizontal: ShorthandHandler = { ...SHORTHAND_HANDLERS['writing-mode'], refuse: () => null };

  /** The keywords where Dragon's acceptance and Chrome's computed value disagree. */
  const disagreements = (h: ShorthandHandler, computed: ReadonlyMap<string, string>): string[] =>
    KEYWORDS.filter((k) => accepts(h, k) !== (computed.get(k) === 'horizontal-tb')).map((k) => `${k}: accepted ${String(accepts(h, k))}, Chrome computes ${String(computed.get(k))}`);

  it('every accepted keyword computes to horizontal-tb and every refused one does not; the planted handler is caught', async () => {
    const { launchChrome } = await load<{ launchChrome: () => Promise<Browser> }>('chrome.ts');
    const browser = await launchChrome();
    let computed: Map<string, string>;
    try {
      const page = await browser.newPage();
      await page.setContent('<!DOCTYPE html><div id="d"></div>');
      // A string expression: this test project has no DOM types. Each keyword's computed value, or "unparsed" when Chrome drops it.
      const pairs = (await page.evaluate(`${JSON.stringify(KEYWORDS)}.map((k) => {
        const d = document.getElementById('d');
        d.removeAttribute('style');
        d.style.setProperty('writing-mode', k);
        return [k, d.style.getPropertyValue('writing-mode') === '' ? 'unparsed' : getComputedStyle(d).getPropertyValue('writing-mode')];
      })`)) as [string, string][];
      computed = new Map(pairs);
    } finally {
      await browser.close();
    }
    expect([...computed.values()].filter((v) => v === 'unparsed')).toEqual([]);
    expect(['lr', 'lr-tb', 'rl', 'rl-tb', 'tb', 'tb-rl'].map((k) => [k, computed.get(k)])).toEqual([
      ['lr', 'horizontal-tb'], ['lr-tb', 'horizontal-tb'], ['rl', 'horizontal-tb'], ['rl-tb', 'horizontal-tb'], ['tb', 'vertical-rl'], ['tb-rl', 'vertical-rl'],
    ]);
    expect(disagreements(SHORTHAND_HANDLERS['writing-mode'], computed)).toEqual([]);
    expect(disagreements(verticalAcceptedAsHorizontal, computed)).toEqual(VERTICAL.map((k) => `${k}: accepted true, Chrome computes ${String(computed.get(k))}`));
  });
});
