// contain-intrinsic-width, -height and contain-intrinsic-size against Chrome 145 (css/properties/containment.ts parseIntrinsicSize):
// every spelling Dragon reads, Chrome parses and computes to what Dragon's longhands compute to; every spelling Chrome drops,
// Dragon does not read (it keeps it as written and refuses it, analysis/contain-intrinsic.ts). Each planted reading must be caught.
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../../dragon/src/index.ts';
import { valueToString } from '../../dragon/src/analysis/resolve.ts';
import { NON_INITIAL_VALUE_TYPE } from '../../dragon/src/css/properties/initial-only.ts';
import { parseStylesheet } from '../../dragon/src/css/stylesheet.ts';

const SOURCE = { uri: 'dragon-source://test/contain-intrinsic.css', revision: 'r1', hash: 'sha256:0' };
const LONGHANDS = ['contain-intrinsic-width', 'contain-intrinsic-height'];

type Pairs = readonly (readonly [string, string])[];
/** read: the longhands Dragon sets as [property, text] when it reads the value, else null (kept as written, refused). */
type Item = { readonly name: string; readonly v: string; readonly read: Pairs | null };
type Seen = { readonly parsed: boolean; readonly authored: string; readonly dragon: string };

function item(name: string, v: string): Item {
  const css = `.a { ${name}: ${v}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  if (diagnostics.length > 0) throw new Error(`${name}: ${v}: ${diagnostics.map((d) => d.code).join(', ')}`);
  const longhands = rules[0]?.declarations[0]?.longhands ?? [];
  const read = longhands.length > 0 && longhands.every((l) => !(l.value.kind === 'other' && l.value.type === NON_INITIAL_VALUE_TYPE));
  return { name, v, read: read ? longhands.map((l) => [l.property, valueToString(l.value)] as const) : null };
}

const ONE = ['none', 'NONE', '0', '0px', '10px', '10PX', '2.5px', '1e2px', '1em', '2rem', '1in', '3pt', 'auto none', 'AUTO None', 'auto 10px', 'auto 0', 'auto 1em', 'auto', 'none auto', '10px auto', 'auto auto', 'auto auto 5px', '-1px', '-0px', '10%', 'auto 10%', '5', 'calc(5px + 5px)', 'auto calc(1px)', 'min-content', 'inherit', 'initial', 'unset'];
const VALUES: { readonly [name: string]: readonly string[] } = {
  'contain-intrinsic-width': ONE,
  'contain-intrinsic-height': ONE,
  'contain-intrinsic-size': [...ONE, '10px 20px', 'none 20px', '10px none', 'auto 10px auto 20px', 'auto 10px 20px', '10px auto 20px', 'auto none none', 'none auto none', 'auto 1em auto 2rem', '10px 20px 30px', 'none none none', 'auto 10px none', '10px -1px', '10px 10%'],
};

/** How many of VALUES Dragon reads (pinned so a parser change that reads more or fewer is seen). */
const READ = 73;

function judge(items: readonly Item[], seen: readonly Seen[]): string[] {
  return items.flatMap((it, i) => {
    const s = seen[i] as Seen;
    if (it.read === null) return [];
    if (!s.parsed) return [`${it.name}: ${it.v}: read, Chrome drops it`];
    return s.authored !== s.dragon ? [`${it.name}: ${it.v}: Chrome computes ${s.authored}, Dragon's longhands compute ${s.dragon}`] : [];
  });
}

describe('contain-intrinsic-size: Chrome 145 parsing', () => {
  type Browser = { newPage(): Promise<{ setContent(html: string): Promise<void>; evaluate(expression: string): Promise<unknown> }>; close(): Promise<void> };

  it('every value Dragon reads Chrome parses and computes as Dragon\'s longhands do, and the plants are caught', async () => {
    const real = Object.entries(VALUES).flatMap(([name, vs]) => vs.map((v) => item(name, v)));
    const plant = (name: string, v: string, read: Pairs): Item => ({ name, v, read });
    const planted: { readonly name: string; readonly items: Item[] }[] = [
      { name: 'oneValueWidthOnly', items: [plant('contain-intrinsic-size', '10px', [['contain-intrinsic-width', '10px']])] },
      { name: 'autoDropped', items: [plant('contain-intrinsic-width', 'auto 10px', [['contain-intrinsic-width', '10px']])] },
      { name: 'negativeRead', items: [plant('contain-intrinsic-width', '-1px', [['contain-intrinsic-width', '-1px']])] },
      { name: 'secondValueToWidth', items: [plant('contain-intrinsic-size', '10px 20px', [['contain-intrinsic-width', '20px'], ['contain-intrinsic-height', '10px']])] },
    ];
    const sets = [real, ...planted.map((p) => p.items)];
    const { launchChrome } = (await import(new URL('../src/chrome.ts', import.meta.url).href)) as { launchChrome: () => Promise<Browser> };
    const browser = await launchChrome();
    let seen: Seen[][];
    try {
      const page = await browser.newPage();
      await page.setContent('<!DOCTYPE html><div style="font-size: 20px"><div id="a"></div><div id="c"></div></div>');
      seen = (await page.evaluate(`(${JSON.stringify(sets)}).map((items) => items.map((it) => {
        const [a, c] = ['a', 'c'].map((id) => document.getElementById(id));
        const read = (e) => ${JSON.stringify(LONGHANDS)}.map((p) => getComputedStyle(e).getPropertyValue(p)).join(' | ');
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
    // Chrome parses a value Dragon does not read only where it is a CSS-wide keyword, a calculation, or auto alone or with a calculation,
    // each of which Dragon keeps and refuses.
    const unread = real.filter((it, i) => it.read === null && (seen[0] as Seen[])[i]?.parsed === true).map((it) => `${it.name}: ${it.v}`);
    expect(unread.every((u) => /: (calc\(|auto calc\(|inherit|initial|unset)/.test(u)), unread.join('\n')).toBe(true);
    expect(real.filter((it) => it.read !== null).length).toBe(READ);
    planted.forEach((p, i) => expect(judge(p.items, seen[i + 1] as Seen[]).length, p.name).toBe(p.items.length));
  }, 120_000);
});
