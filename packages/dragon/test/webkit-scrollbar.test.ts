// NA-NATIVE ::-webkit-scrollbar (analysis/webkit-scrollbar.ts): rules that hide a scroll container's scrollbars (display: none, or a
// zero thickness on every axis it scrolls) compile on every target, as ::-webkit-scrollbar { display: none } on web and hidden scroll
// indicators on native; rules that would draw a custom scrollbar on a scroll container are refused on every target.
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../src/index.ts';
import { createProjectWith, nativePrograms, NO_FAULTS } from '../src/internal.ts';
import type { Targets } from '../src/types.ts';
import { div, expectCatalogued, inputFor, text } from './helpers.ts';

const NATIVE: Targets = { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} };

function compile(css: string) {
  const input = inputFor(`body { margin: 0; font-family: Ahem; font-size: 10px; } ${css}`, (r) => [div(r, 'a', ['a'], [div(r, 'b', ['b'], [text(r, 't', 'XX')])])]);
  return createProjectWith({ projectId: 'test', targets: NATIVE }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(input);
}

const errors = (c: ReturnType<typeof compile>): string[] => c.diagnostics.filter((d: Diagnostic) => d.severity === 'error').map((d) => `${d.code} ${d.message}`);
const webCss = (c: ReturnType<typeof compile>): string => JSON.stringify(c.outputs.web);
const indicators = (c: ReturnType<typeof compile>, id: string): boolean[] => {
  const p = nativePrograms(c, []);
  if (p.kind !== 'ready') throw new Error(p.reason);
  return (['uikit', 'android-views'] as const).map((b) => (p.programs[b].nodes.find((x) => x.id === id)?.writes ?? []).some((w) => w.key === 'dragonScroll.indicators'));
};

describe('::-webkit-scrollbar rules that hide the scrollbar', () => {
  for (const css of [
    '.a { overflow: auto; } .a::-webkit-scrollbar { display: none; }',
    '.a { overflow: auto; } .a::-webkit-scrollbar { width: 0; height: 0px; background: transparent; } .a::-webkit-scrollbar-thumb { background: red; }',
    '.a { overflow-x: hidden; overflow-y: scroll; } .a::-webkit-scrollbar { width: 0; }',
    '.a { overflow-x: auto; overflow-y: hidden; } .a::-webkit-scrollbar { height: 0; }',
    '.a { overflow: auto; } ::-webkit-scrollbar { display: none; width: 8px; }',
    '.a { overflow: auto; } .A::-WEBKIT-SCROLLBAR { DISPLAY: NONE; } .a::-webkit-scrollbar { display: none; }',
  ]) {
    it(`compile on every target, hide the indicators and write the rule on web: ${css}`, () => {
      const c = compile(css);
      expectCatalogued(c.diagnostics);
      expect(errors(c)).toEqual([]);
      expect(c.targets).toEqual({ web: 'checked', ios: 'checked', android: 'checked' });
      expect(indicators(c, 'a')).toEqual([true, true]);
      expect(webCss(c)).toMatch(/::-webkit-scrollbar \{\\n {2}display: none;\\n\}/);
    });
  }

  it('leave a scroll container they do not match, and one with scrollbar-width other than auto, as they are', () => {
    const c = compile('.a { overflow: auto; } .c::-webkit-scrollbar { display: none; }');
    expect(errors(c)).toEqual([]);
    expect(indicators(c, 'a')).toEqual([false, false]);
    expect(webCss(c)).not.toContain('::-webkit-scrollbar');
    const thin = compile('.a { overflow: auto; scrollbar-width: thin; } .a::-webkit-scrollbar { display: none; }');
    expect(errors(thin)).toEqual([]);
    expect(indicators(thin, 'a')).toEqual([false, false]);
    expect(webCss(thin)).not.toContain('::-webkit-scrollbar');
  });

  it('style nothing on a box that does not scroll, whatever they say', () => {
    expect(errors(compile('.a::-webkit-scrollbar { width: 8px; } .a::-webkit-scrollbar-thumb { background: red; }'))).toEqual([]);
  });
});

describe('::-webkit-scrollbar rules that draw a custom scrollbar on a scroll container are refused on every target', () => {
  for (const [css, head] of [
    ['.a { overflow: auto; } .a::-webkit-scrollbar { width: 8px; }', 'DRAGON_UNSUPPORTED_SELECTOR width: 8px in a ::-webkit-scrollbar rule draws a custom scrollbar'],
    ['.a { overflow: auto; } .a::-webkit-scrollbar { width: 0; }', 'DRAGON_UNSUPPORTED_SELECTOR a ::-webkit-scrollbar rule that leaves the horizontal scrollbar at its platform thickness'],
    ['.a { overflow: auto; } .a::-webkit-scrollbar { display: none; } .a::-webkit-scrollbar { display: block; }', 'DRAGON_UNSUPPORTED_SELECTOR display: block in a ::-webkit-scrollbar rule is unsupported'],
    ['.a { overflow: auto; } .a::-webkit-scrollbar-thumb { background: red; }', 'DRAGON_UNSUPPORTED_SELECTOR a ::-webkit-scrollbar part rule styles the custom scrollbar'],
    ['.a { overflow: auto; } .a:hover::-webkit-scrollbar { display: none; }', 'DRAGON_UNSUPPORTED_SELECTOR a ::-webkit-scrollbar rule that depends on :hover'],
    ['.a { overflow: auto; } @media (min-width: 1px) { .a::-webkit-scrollbar { display: none; } }', 'DRAGON_UNSUPPORTED_SELECTOR a ::-webkit-scrollbar rule inside @media'],
  ] as const) {
    it(css, () => {
      const c = compile(css);
      expectCatalogued(c.diagnostics);
      expect(errors(c).filter((e) => e.includes('::-webkit-scrollbar')).map((e) => e.slice(0, head.length))).toEqual([head]);
      expect(c.targets).toEqual({ web: 'blocked', ios: 'blocked', android: 'blocked' });
    });
  }
});
