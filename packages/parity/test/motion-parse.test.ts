// The motion path family against Chrome 145 (css/properties/motion.ts): the grammar takes any value, so Dragon drops no
// declaration; every value it reads as initial, Chrome parses and computes to what the initial longhands compute to, and every
// other value it keeps as written and refuses (analysis/motion.ts). Each planted reading must be caught.
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../../dragon/src/index.ts';
import { valueToString } from '../../dragon/src/analysis/resolve.ts';
import { NON_INITIAL_VALUE_TYPE } from '../../dragon/src/css/properties/initial-only.ts';
import { MOTION_LONGHANDS } from '../../dragon/src/css/properties/motion.ts';
import { parseStylesheet } from '../../dragon/src/css/stylesheet.ts';

const SOURCE = { uri: 'dragon-source://test/motion.css', revision: 'r1', hash: 'sha256:0' };

type Pairs = readonly (readonly [string, string])[];
/** code: Dragon's diagnostic, or null; read: the longhands Dragon sets as [property, text] when it reads the value as initial, else null. */
type Item = { readonly name: string; readonly v: string; readonly code: string | null; readonly read: Pairs | null };
type Seen = { readonly parsed: boolean; readonly authored: string; readonly dragon: string };

function item(name: string, v: string): Item {
  const css = `.a { ${name}: ${v}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  const code = diagnostics[0]?.code ?? null;
  const longhands = rules[0]?.declarations[0]?.longhands ?? [];
  const read = code === null && longhands.length > 0 && longhands.every((l) => !(l.value.kind === 'other' && l.value.type === NON_INITIAL_VALUE_TYPE));
  return { name, v, code, read: read ? longhands.map((l) => [l.property, valueToString(l.value)] as const) : null };
}

// Pinned against Chrome 145.0.7632.6.
const VALUES: { readonly [name: string]: readonly string[] } = {
  'offset-path': ['none', 'NONE', 'None', 'none none', 'normal', 'auto', 'ray(45deg)', 'path("M 0 0 H 10")', 'circle(10px)', 'url(#a)', 'border-box', '0'],
  'offset-distance': ['0', '0px', '0PX', '-0px', '+0', '0.0', '0%', '0em', '10px', '-5px', 'calc(0px)', 'auto'],
  'offset-position': ['normal', 'NORMAL', 'Normal', 'auto', 'center', '0 0', 'left top', 'none'],
  'offset-anchor': ['auto', 'AUTO', 'Auto', 'center', '50% 50%', '0 0', 'normal'],
  'offset-rotate': ['auto', 'AUTO', 'Auto', 'auto 0deg', '0deg auto', '0deg', 'reverse', '30deg', 'auto auto'],
  offset: ['none', 'NONE', 'None', 'none none', 'normal', 'auto', 'none 0px', 'none / auto', 'ray(45deg) 10px', 'auto none', 'left top', 'none 0px auto'],
};

/** How many of VALUES Dragon reads as initial (pinned so a parser change that reads more or fewer is seen). */
const READ = 21;

function judge(items: readonly Item[], seen: readonly Seen[]): string[] {
  return items.flatMap((it, i) => {
    const s = seen[i] as Seen;
    if (it.read === null) return [];
    if (!s.parsed) return [`${it.name}: ${it.v}: read as initial, Chrome drops it`];
    return s.authored !== s.dragon ? [`${it.name}: ${it.v}: Chrome computes ${s.authored}, Dragon's longhands compute ${s.dragon}`] : [];
  });
}

describe('the motion path family: Chrome 145 parsing', () => {
  type Browser = { newPage(): Promise<{ setContent(html: string): Promise<void>; evaluate(expression: string): Promise<unknown> }>; close(): Promise<void> };

  it('every value Dragon reads as initial Chrome parses and computes as the initial longhands do, and the plants are caught', async () => {
    const real = Object.entries(VALUES).flatMap(([name, vs]) => vs.map((v) => item(name, v)));
    const plant = (name: string, v: string, read: Pairs): Item => ({ name, v, code: null, read });
    const planted: { readonly name: string; readonly items: Item[] }[] = [
      { name: 'distanceReadAsInitial', items: [plant('offset-distance', '10px', [['offset-distance', '0px']])] },
      { name: 'rotateReadAsInitial', items: [plant('offset-rotate', '30deg', [['offset-rotate', 'auto']])] },
      { name: 'pathShorthandReadAsInitial', items: [plant('offset', 'ray(45deg) 10px', MOTION_LONGHANDS.map((p) => [p, p === 'offset-path' ? 'none' : p === 'offset-distance' ? '0px' : p === 'offset-position' ? 'normal' : 'auto'] as const))] },
      { name: 'positionAutoReadAsInitial', items: [plant('offset-position', 'auto', [['offset-position', 'normal']])] },
    ];
    const sets = [real, ...planted.map((p) => p.items)];
    const { launchChrome } = (await import(new URL('../src/chrome.ts', import.meta.url).href)) as { launchChrome: () => Promise<Browser> };
    const browser = await launchChrome();
    let seen: Seen[][];
    try {
      const page = await browser.newPage();
      await page.setContent('<!DOCTYPE html><div style="font-size: 20px"><div id="a"></div><div id="c"></div></div>');
      // A string expression: this test project has no DOM types. The authored value on #a, Dragon's longhands on #c, both read as
      // every longhand of the family.
      seen = (await page.evaluate(`(${JSON.stringify(sets)}).map((items) => items.map((it) => {
        const [a, c] = ['a', 'c'].map((id) => document.getElementById(id));
        const read = (e) => ${JSON.stringify(MOTION_LONGHANDS)}.map((p) => getComputedStyle(e).getPropertyValue(p)).join(' | ');
        for (const e of [a, c]) e.removeAttribute('style');
        a.style.setProperty(it.name, it.v);
        const parsed = a.style.getPropertyValue(it.name) !== '';
        for (const [p, v] of it.read ?? []) c.style.setProperty(p, v);
        return { parsed, authored: read(a), dragon: read(c) };
      }))`)) as Seen[][];
    } finally {
      await browser.close();
    }
    expect(judge(real, seen[0] as Seen[])).toEqual([]);
    // The grammar takes any value, so Dragon drops nothing and refuses what it does not read.
    expect(real.filter((it) => it.code !== null)).toEqual([]);
    expect(real.filter((it) => it.read !== null).length).toBe(READ);
    // Chrome keeps a value Dragon does not read in every family member (so a refusal is never of a value Chrome would drop alone).
    expect((seen[0] as Seen[]).filter((s, i) => s.parsed && real[i]?.read === null).length).toBeGreaterThan(20);
    planted.forEach((p, i) => expect(judge(p.items, seen[i + 1] as Seen[]).length, p.name).toBe(p.items.length));
  }, 120_000);
});
