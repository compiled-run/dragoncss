// -webkit-line-break against Chrome 145 (css/aliases/line-break.ts). The parse: through line-break and -webkit-line-break (a
// surrogate in Chrome, css_properties.json5, which Dragon resolves as an alias with its own keywords), Dragon keeps exactly the values
// Chrome keeps, refuses each value Chrome reads differently through the two names, and each kept value computes alike. The cascade:
// wherever the two names compete (declaration order, !important, specificity, inherit, initial, unset), Dragon's computed value is
// Chrome's, which is what resolving the surrogate as an alias claims. The layout: text-line-break-webkit-ahem passes both lanes in
// both directions against a live capture with the profiles enforced, and reject-text-line-break-webkit (after-white-space) is refused
// on every target. Each planted reading must be caught.
import { describe, expect, it } from 'vitest';
import { NO_ENGINE_FAULTS } from '@dragon/layout';
import { createProjectWith, NO_FAULTS } from 'dragon';
import type { Diagnostic } from '../../dragon/src/index.ts';
import { valueToString } from '../../dragon/src/analysis/resolve.ts';
import { parseStylesheet } from '../../dragon/src/css/stylesheet.ts';
import { DOCUMENT_ID, fixtureToInput, PROJECT_ID } from '../src/fixture-reader.ts';
import { FIXTURES } from '../src/fixtures.ts';
import { liveAuthored, runFixture } from '../src/pipeline.ts';

const SOURCE = { uri: 'dragon-source://test/line-break-alias.css', revision: 'r1', hash: 'sha256:0' };
const PROPERTY = 'line-break';
const ALIAS = '-webkit-line-break';

/** value: Dragon's parsed value, null when Dragon drops the declaration, or 'refused' when it refuses it as it parses. */
type Item = { readonly name: string; readonly v: string; readonly value: string | null };
const REFUSED = 'refused';
/** Chrome's reading: whether the name keeps the value and what it computes, the same through the property, and Dragon's value computed. */
type Seen = { readonly parsed: boolean; readonly authored: string; readonly plainParsed: boolean; readonly plain: string; readonly dragon: string };

function item(name: string, v: string): Item {
  const css = `.a { ${name}: ${v}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  if (diagnostics.length > 1) throw new Error(`${name}: ${v}: more than one diagnostic`);
  const code = diagnostics[0]?.code ?? null;
  if (code === 'DRAGON_UNSUPPORTED_VALUE') return { name, v, value: REFUSED };
  if (code !== null && code !== 'DRAGON_CSS_INVALID_VALUE') throw new Error(`${name}: ${v}: unexpected ${code}`);
  const longhands = rules[0]?.declarations[0]?.longhands ?? [];
  if (code === null && (longhands.length !== 1 || longhands[0]?.property !== PROPERTY)) throw new Error(`${name}: ${v}: accepted without exactly one ${PROPERTY} longhand`);
  return { name, v, value: code === null ? valueToString((longhands[0] as (typeof longhands)[number]).value) : null };
}

const VALUES: { readonly [name: string]: readonly string[] } = {
  'line-break': ['auto', 'loose', 'normal', 'strict', 'STRICT', 'anywhere', 'after-white-space', 'none', 'loose strict', '0'],
  '-webkit-line-break': ['auto', 'loose', 'normal', 'strict', 'Loose', 'STRICT', 'anywhere', 'ANYWHERE', 'after-white-space', 'none', 'manual', 'loose strict', '0'],
};

function judge(items: readonly Item[], seen: readonly Seen[]): string[] {
  return items.flatMap((it, i) => {
    const s = seen[i] as Seen;
    const unlike = s.parsed !== s.plainParsed || (s.parsed && s.authored !== s.plain);
    // A value Chrome drops through the alias alone is matched by Dragon dropping it too (-webkit-line-break: anywhere).
    if (unlike && it.value !== REFUSED && !(it.value === null && !s.parsed)) return [`${it.name}: ${it.v}: Chrome reads it unlike ${PROPERTY}: ${it.v}, and Dragon does not refuse it`];
    if (it.value === REFUSED) return [];
    if (it.value === null) return s.parsed ? [`${it.name}: ${it.v}: dropped, Chrome parses it`] : [];
    if (!s.parsed) return [`${it.name}: ${it.v}: kept as ${it.value}, Chrome drops it`];
    return s.authored === s.dragon ? [] : [`${it.name}: ${it.v}: Chrome computes ${s.authored}, Dragon's ${it.value} computes ${s.dragon}`];
  });
}

/** Rules for .p (the parent) and .a.b (the element d) where the two names compete. */
const CASCADE: readonly string[] = [
  '.a { line-break: strict; -webkit-line-break: loose; }',
  '.a { -webkit-line-break: loose; line-break: strict; }',
  '.a { line-break: strict !important; -webkit-line-break: loose; }',
  '.a { -webkit-line-break: loose !important; } .a { line-break: strict; }',
  '.a.b { -webkit-line-break: normal; } .a { line-break: strict; }',
  '.a { line-break: strict; } .a { -webkit-line-break: loose; }',
  '.p { -webkit-line-break: strict; }',
  '.p { -webkit-line-break: loose; } .a { line-break: inherit; }',
  '.p { line-break: strict; } .a { -webkit-line-break: inherit; }',
  '.a { -webkit-line-break: strict; line-break: initial; }',
  '.a { line-break: normal; -webkit-line-break: unset; }',
];

const page = (rules: string): string =>
  `<!DOCTYPE html><html data-dragon-id="html"><head><style>body { margin: 0; font-family: Ahem; font-size: 10px; } ${rules}</style></head>` +
  '<body data-dragon-id="body"><div data-dragon-id="p" class="p"><div data-dragon-id="d" class="a b">XX</div></div></body></html>';

/** Dragon's computed line-break of d on each target. */
function dragonCascade(rules: string): string {
  const c = createProjectWith({ projectId: PROJECT_ID, targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(fixtureToInput('line-break-cascade', page(rules)));
  const values = (['web', 'ios', 'android'] as const).map((target) => {
    const r = c.explain({ target, at: { node: 'd', instance: DOCUMENT_ID }, property: PROPERTY });
    if (r.kind !== 'found' || r.cases.length !== 1) throw new Error(`${rules}: ${target}: ${JSON.stringify(r)}`);
    return (r.cases[0] as (typeof r.cases)[number]).value;
  });
  if (new Set(values).size !== 1) throw new Error(`${rules}: the targets disagree: ${values.join(', ')}`);
  return values[0] as string;
}

describe('line-break and -webkit-line-break: Chrome 145 parsing and cascade', () => {
  type Browser = { newPage(): Promise<{ setContent(html: string): Promise<void>; evaluate(expression: string): Promise<unknown> }>; close(): Promise<void> };

  it('Dragon keeps exactly the values Chrome keeps, each computes alike from either name, the names cascade as Chrome\'s, and the plants are caught', async () => {
    const real = Object.entries(VALUES).flatMap(([name, vs]) => vs.map((v) => item(name, v)));
    const planted: { readonly name: string; readonly items: Item[] }[] = [
      { name: 'aliasAnywhereKept', items: [{ name: ALIAS, v: 'anywhere', value: 'anywhere' }] },
      { name: 'aliasDropped', items: [{ name: ALIAS, v: 'strict', value: null }] },
      { name: 'aliasStrictReadAsLoose', items: [{ name: ALIAS, v: 'STRICT', value: 'loose' }] },
      { name: 'noneKept', items: [{ name: PROPERTY, v: 'none', value: 'none' }] },
    ];
    const sets = [real, ...planted.map((p) => p.items)];
    const dragon = CASCADE.map(dragonCascade);
    const { launchChrome } = (await import(new URL('../src/chrome.ts', import.meta.url).href)) as { launchChrome: () => Promise<Browser> };
    const browser = await launchChrome();
    let seen: Seen[][];
    const chrome: string[] = [];
    try {
      const tab = await browser.newPage();
      await tab.setContent('<!DOCTYPE html><div id="a"></div><div id="b"></div><div id="c"></div>');
      // A string expression: this test project has no DOM types. The authored value on #a, the same value through the property on #b,
      // Dragon's value on #c, each read as the longhand.
      seen = (await tab.evaluate(`(${JSON.stringify(sets)}).map((items) => items.map((it) => {
        const a = document.getElementById('a'), b = document.getElementById('b'), c = document.getElementById('c');
        for (const e of [a, b, c]) e.removeAttribute('style');
        a.style.setProperty(it.name, it.v);
        b.style.setProperty('${PROPERTY}', it.v);
        const parsed = a.style.getPropertyValue(it.name) !== '';
        const plainParsed = b.style.getPropertyValue('${PROPERTY}') !== '';
        if (it.value !== null && it.value !== 'refused') c.style.setProperty('${PROPERTY}', it.value);
        const read = (e) => getComputedStyle(e).getPropertyValue('${PROPERTY}');
        return { parsed, authored: read(a), plainParsed, plain: read(b), dragon: read(c) };
      }))`)) as Seen[][];
      for (const rules of CASCADE) {
        await tab.setContent(page(rules));
        const both = (await tab.evaluate(`(() => { const s = getComputedStyle(document.querySelector('[data-dragon-id="d"]'));
          return [s.getPropertyValue('${PROPERTY}'), s.getPropertyValue('${ALIAS}')]; })()`)) as [string, string];
        // Both names read the one shared field.
        expect(both[1], rules).toBe(both[0]);
        chrome.push(both[0]);
      }
    } finally {
      await browser.close();
    }
    expect(seen.map((s) => s.length)).toEqual(sets.map((s) => s.length));
    expect(judge(real, seen[0] as Seen[])).toEqual([]);
    // Kept by Dragon: the four strictness levels in any ASCII case through either name; refused: anywhere through line-break, and
    // after-white-space through -webkit-line-break.
    expect(real.filter((it) => it.value !== null && it.value !== REFUSED).map((it) => `${it.name}: ${it.v}`)).toEqual([
      'line-break: auto', 'line-break: loose', 'line-break: normal', 'line-break: strict', 'line-break: STRICT',
      '-webkit-line-break: auto', '-webkit-line-break: loose', '-webkit-line-break: normal', '-webkit-line-break: strict', '-webkit-line-break: Loose', '-webkit-line-break: STRICT',
    ]);
    expect(real.filter((it) => it.value === REFUSED).map((it) => `${it.name}: ${it.v}`)).toEqual(['line-break: anywhere', '-webkit-line-break: after-white-space']);
    // Chrome keeps six line-break values (anywhere among them) and seven -webkit-line-break ones (after-white-space among them).
    expect((seen[0] as Seen[]).filter((x) => x.parsed).length).toBe(13);
    planted.forEach((p, i) => expect(judge(p.items, seen[i + 1] as Seen[]).length, p.name).toBe(p.items.length));
    expect(CASCADE.map((r, i) => `${r} -> ${dragon[i]}`)).toEqual(CASCADE.map((r, i) => `${r} -> ${chrome[i]}`));
    // The cases tell the values apart: each of loose, normal and strict wins somewhere.
    expect(new Set(chrome)).toEqual(new Set(['loose', 'normal', 'strict', 'auto']));
  }, 120_000);
});

describe('-webkit-line-break lays out as line-break against a live Chrome 145 capture', () => {
  const specOf = (id: string) => {
    const f = FIXTURES.find((x) => x.id === id);
    if (f === undefined) throw new Error(`no fixture ${id}`);
    return f;
  };
  it('text-line-break-webkit-ahem passes chrome-dual and linux-dragon-layout in ltr and rtl, and reject-text-line-break-webkit is refused on every target', async () => {
    const { launchChrome } = (await import(new URL('../src/chrome.ts', import.meta.url).href)) as { launchChrome: () => Promise<Parameters<typeof runFixture>[1]> };
    const browser = await launchChrome();
    try {
      const out = await runFixture(specOf('text-line-break-webkit-ahem'), browser, { authored: liveAuthored(browser), faults: NO_FAULTS, engineFaults: NO_ENGINE_FAULTS, profiles: 'enforce' });
      expect(out.reason).toBeNull();
      expect(out.cases.map((c) => [c.direction, c.lanes['chrome-dual'], c.lanes['linux-dragon-layout']])).toEqual([['ltr', 'pass', 'pass'], ['rtl', 'pass', 'pass']]);
      const rejected = await runFixture(specOf('reject-text-line-break-webkit'), browser, { authored: liveAuthored(browser), faults: NO_FAULTS, engineFaults: NO_ENGINE_FAULTS, profiles: 'enforce' });
      expect(rejected.reason).toBeNull();
      expect(rejected.status).toBe('pass');
    } finally {
      await browser.close();
    }
  }, 600_000);
});
