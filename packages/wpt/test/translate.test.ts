import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runTranslation } from '../src/dragon.ts';
import { lockedCommit, pinnedWptDir } from '../src/paths.ts';
import { harnessCalls, resolveHref, translate } from '../src/translate.ts';

const HARNESS = '<script src="/resources/testharness.js"></script><script src="/resources/testharnessreport.js"></script><script src="/resources/check-layout-th.js"></script>';
const page = (css: string, body: string, onload = ` onload="checkLayout('.t')"`, head = ''): string => `<!DOCTYPE html>${HARNESS}${head}<style>${css}</style><body${onload}>${body}</body>`;
const run = (html: string, readWpt: (p: string) => string | null = () => null) => runTranslation(translate('css/x/case.html', html, 'c0ffee', readWpt), 'web').outcome;
const missing = (html: string, readWpt?: (p: string) => string | null): string => {
  const o = run(html, readWpt);
  if (o.status !== 'not-runnable') throw new Error(`expected not-runnable, got ${o.status}`);
  return o.missing;
};

describe('the two scout candidates', () => {
  const wpt = pinnedWptDir();
  const commit = lockedCommit();
  const read = (p: string): string => readFileSync(join(wpt, p), 'utf8');

  it('flexbox-lines-must-be-stretched-by-default translates, names its source, and passes', () => {
    const path = 'css/css-flexbox/flexbox-lines-must-be-stretched-by-default.html';
    const t = translate(path, read(path), commit);
    if (t.kind !== 'fixture') throw new Error(t.missing);
    expect(t.html.startsWith('<!DOCTYPE html>\n')).toBe(true);
    expect(t.html).toContain(`/* Translated from web-platform-tests ${path} at commit ${commit}.`);
    expect(t.html).not.toMatch(/<script|data-expected|onload|<title|<link|<meta/);
    expect(t.sidecar).toEqual({
      source: path,
      wpt: commit,
      viewport: { width: 800, height: 600 },
      subtests: [{ name: '.flex-container 1', target: 'flexContainer', checks: [
        { node: 'flexItem1', element: 11, attribute: 'height', expected: '51' },
        { node: 'flexItem2', element: 12, attribute: 'height', expected: '49' },
      ] }],
    });
    const o = runTranslation(t, 'web').outcome;
    expect(o.status === 'pass' ? [o.subtests, o.checks] : o).toEqual([{ pass: 1, total: 1 }, { pass: 2, total: 2 }]);
  });

  it('percentage-margins-001 lifts every inline style into a class rule, and the compiler gates it', () => {
    const path = 'css/css-flexbox/percentage-margins-001.html';
    const t = translate(path, read(path), commit);
    if (t.kind !== 'fixture') throw new Error(t.missing);
    expect(t.guard).toBeNull();
    expect(t.html).not.toContain('style="');
    expect(t.html).toContain('.wpt-inline-0 { display:flex; flex-direction: column; background-color: salmon; height: 300px; width: 400px; }');
    expect(t.html).toContain('class="flexbox wpt-inline-0"');
    expect(t.sidecar.subtests.map((s) => [s.name, s.checks.length])).toEqual([['.flexbox 1', 4], ['.flexbox 2', 4], ['.flexbox 3', 4]]);
    expect(runTranslation(t, 'web').outcome).toEqual({ status: 'not-runnable', missing: 'DRAGON_UNPROVEN_CONTEXT:margin-top:<percentage>' });
  });
});

describe('translator refusals and the compiler gate', () => {
  it('an inline style that a more specific rule would beat after lifting is refused', () => {
    expect(missing(page('.a .t { width: 10px; }', '<div class="a"><div class="t" style="width: 20px" data-expected-width="20"></div></div>'))).toBe('translate:specificity-rewrite');
  });

  it('an #id rule that a compound class rule would beat after rewriting is refused', () => {
    expect(missing(page('#x { width: 10px; } .u.v { width: 20px; }', '<div class="t"><div id="x" class="u v" data-expected-width="10"></div></div>'))).toBe('translate:specificity-rewrite');
  });

  it('an #id rule with no competing declaration is rewritten to a class and runs', () => {
    const t = translate('css/x/case.html', page('#x { width: 10px; height: 5px; }', '<div class="t"><div id="x" data-expected-width="10"></div></div>'), 'c0ffee');
    if (t.kind !== 'fixture') throw new Error(t.missing);
    expect(t.guard).toBeNull();
    expect(t.html).toContain('.wpt-id-0 { width: 10px; height: 5px; }');
    expect(t.html).toContain('<div data-dragon-id="x" class="wpt-id-0">');
    expect(runTranslation(t, 'web').outcome.status).toBe('pass');
  });

  it('script logic, helper scripts and event attributes are refused', () => {
    expect(missing(page('.t { width: 10px; }', `<div class="t" data-expected-width="10"></div><script>document.body.style.width = '10px'; checkLayout('.t');</script>`, ''))).toBe('translate:script');
    expect(missing(page('.t { width: 10px; }', '<div class="t" data-expected-width="10"></div>', undefined, '<script src="/css/support/helper.js"></script>'))).toBe('translate:script-src:helper.js');
    expect(missing(page('.t { width: 10px; }', '<div class="t" onclick="go()" data-expected-width="10"></div>'))).toBe('translate:event-attribute');
  });

  it('a test without a checkLayout call, or with a selector it cannot resolve, is refused', () => {
    expect(missing(page('.t { width: 10px; }', '<div class="t" data-expected-width="10"></div>', ''))).toBe('translate:no-checklayout');
    expect(missing(page('.t { width: 10px; }', '<div class="t" data-expected-width="10"></div>', ` onload="checkLayout('.t:nth-child(1)')"`))).toBe('translate:checklayout-selector');
  });

  it('<span>, an unsupported unit (ex) and non-Ahem text are gated by Dragon itself, not by a list', () => {
    expect(missing(page('.t { width: 100px; }', '<div class="t" data-expected-width="100"><span></span></div>'))).toMatch(/^DRAGON_UNSUPPORTED_ELEMENT:<span /);
    expect(missing(page('.t { width: 10ex; height: 10px; }', '<div class="t" data-expected-width="80"></div>'))).toBe('DRAGON_UNSUPPORTED_VALUE:10ex');
    expect(missing(page('.t { width: 100px; }', '<div class="t" data-expected-height="18">hello</div>'))).toBe('layout-projection:DRAGON_UNSUPPORTED_FONT:hello');
  });

  it('SVG content and scroll-size assertions are not runnable', () => {
    expect(missing(page('.t { width: 10px; }', '<div class="t" data-expected-width="10"><svg></svg></div>'))).toBe('translate:foreign-element');
    expect(missing(page('.t { width: 100px; }', '<div class="t" data-expected-scroll-width="100"></div>'))).toBe('assert:scroll-size');
  });

  it('a linked WPT stylesheet is inlined at its place; a missing one is refused', () => {
    const html = page('.t { height: 5px; }', '<div class="t" data-expected-width="30"></div>', undefined, '<link rel="stylesheet" href="support/w.css">');
    expect(missing(html)).toBe('translate:external-stylesheet');
    const read = (p: string): string | null => (p === 'css/x/support/w.css' ? '.t { width: 30px; }' : null);
    const t = translate('css/x/case.html', html, 'c0ffee', read);
    if (t.kind !== 'fixture') throw new Error(t.missing);
    expect(t.html).toContain('/* <link rel=stylesheet> css/x/support/w.css */\n.t { width: 30px; }');
    expect(run(html, read).status).toBe('pass');
    expect(resolveHref('css/x/case.html', '/css/support/grid.css')).toBe('css/support/grid.css');
    expect(resolveHref('css/x/y/case.html', '../../support/a.css')).toBe('css/support/a.css');
    expect(resolveHref('css/x/case.html', 'http://example.com/a.css')).toBeNull();
  });

  it('harness scripts reduce to their checkLayout selector lists, anything else to null', () => {
    expect(harnessCalls(`setup({ explicit_done: true }); document.fonts.ready.then(() => { checkLayout(".a, .b"); });`)).toEqual(['.a, .b']);
    expect(harnessCalls(`window.addEventListener('load', function () { checkLayout('#c > div', false); done(); });`)).toEqual(['#c > div']);
    expect(harnessCalls(`checkLayout(sel)`)).toBeNull();
    expect(harnessCalls(`let x = 1; checkLayout('.a')`)).toBeNull();
  });
});
