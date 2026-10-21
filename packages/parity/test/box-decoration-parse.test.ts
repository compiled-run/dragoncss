// box-decoration-break against Chrome 145. The parse: through box-decoration-break and -webkit-box-decoration-break (a surrogate in
// Chrome, css_properties.json5, which Dragon resolves as an alias), Dragon keeps exactly the values Chrome keeps, and each kept value
// computes alike. The cascade: wherever the two names compete (declaration order, !important, specificity, inherit, var()), Dragon's
// computed value is Chrome's, which is what resolving the surrogate as an alias claims. Dragon then refuses clone (analysis/box-decoration.ts),
// so the cascade cases compile with the profiles derived and that refusal planted off. Each planted reading must be caught.
import { describe, expect, it } from 'vitest';
import { createProjectWith, NO_FAULTS } from 'dragon';
import type { Diagnostic } from '../../dragon/src/index.ts';
import { valueToString } from '../../dragon/src/analysis/resolve.ts';
import { parseStylesheet } from '../../dragon/src/css/stylesheet.ts';
import { DOCUMENT_ID, fixtureToInput, PROJECT_ID } from '../src/fixture-reader.ts';

const SOURCE = { uri: 'dragon-source://test/box-decoration.css', revision: 'r1', hash: 'sha256:0' };
const PROPERTY = 'box-decoration-break';

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
  'box-decoration-break': ['slice', 'clone', 'SLICE', 'Clone', 'none', 'auto', 'normal', 'slice clone', 'clone slice', 'slice slice', '0', 'slice,', 'initial slice'],
  '-webkit-box-decoration-break': ['slice', 'clone', 'SLICE', 'CLONE', 'none', 'auto', 'slice clone', '0'],
};

function judge(items: readonly Item[], seen: readonly Seen[]): string[] {
  return items.flatMap((it, i) => {
    const s = seen[i] as Seen;
    const unlike = s.parsed !== s.plainParsed || (s.parsed && s.authored !== s.plain);
    if (unlike && it.value !== REFUSED) return [`${it.name}: ${it.v}: Chrome reads it unlike ${PROPERTY}: ${it.v}, and Dragon does not refuse it`];
    if (it.value === REFUSED) return [];
    if (it.value === null) return s.parsed ? [`${it.name}: ${it.v}: dropped, Chrome parses it`] : [];
    if (!s.parsed) return [`${it.name}: ${it.v}: kept as ${it.value}, Chrome drops it`];
    return s.authored === s.dragon ? [] : [`${it.name}: ${it.v}: Chrome computes ${s.authored}, Dragon's ${it.value} computes ${s.dragon}`];
  });
}

/** Rules for .p (the parent) and .a.b (the element d) where the two names compete. */
const CASCADE: readonly string[] = [
  '.a { box-decoration-break: clone; -webkit-box-decoration-break: slice; }',
  '.a { -webkit-box-decoration-break: slice; box-decoration-break: clone; }',
  '.a { -webkit-box-decoration-break: clone; box-decoration-break: slice; }',
  '.a { box-decoration-break: slice; -webkit-box-decoration-break: clone; }',
  '.a { box-decoration-break: clone !important; -webkit-box-decoration-break: slice; }',
  '.a { -webkit-box-decoration-break: slice !important; } .a { box-decoration-break: clone; }',
  '.a.b { -webkit-box-decoration-break: clone; } .a { box-decoration-break: slice; }',
  '.a { box-decoration-break: clone; } .a { -webkit-box-decoration-break: slice; }',
  '.p { -webkit-box-decoration-break: clone; } .a { box-decoration-break: inherit; }',
  '.p { box-decoration-break: clone; } .a { -webkit-box-decoration-break: inherit; }',
  '.p { box-decoration-break: clone; }',
  '.a { --v: clone; -webkit-box-decoration-break: var(--v); }',
  '.a { --v: slice; box-decoration-break: clone; -webkit-box-decoration-break: var(--v); }',
  '.a { -webkit-box-decoration-break: clone; box-decoration-break: initial; }',
  '.a { box-decoration-break: clone; -webkit-box-decoration-break: unset; }',
];

const page = (rules: string): string =>
  `<!DOCTYPE html><html data-dragon-id="html"><head><style>body { margin: 0; font-family: Ahem; font-size: 10px; } ${rules}</style></head>` +
  '<body data-dragon-id="body"><div data-dragon-id="p" class="p"><div data-dragon-id="d" class="a b">XX</div></div></body></html>';

/** Dragon's computed box-decoration-break of d on each target; the boxDecorationAccepted plant lets a winning clone compile so it can be read. */
function dragonCascade(rules: string): string {
  const c = createProjectWith({ projectId: PROJECT_ID, targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} } }, { faults: { ...NO_FAULTS, boxDecorationAccepted: true }, profiles: 'derive', direction: 'ltr' }).compile(fixtureToInput('box-decoration-cascade', page(rules)));
  const values = (['web', 'ios', 'android'] as const).map((target) => {
    const r = c.explain({ target, at: { node: 'd', instance: DOCUMENT_ID }, property: PROPERTY });
    if (r.kind !== 'found' || r.cases.length !== 1) throw new Error(`${rules}: ${target}: ${JSON.stringify(r)}`);
    return (r.cases[0] as (typeof r.cases)[number]).value;
  });
  if (new Set(values).size !== 1) throw new Error(`${rules}: the targets disagree: ${values.join(', ')}`);
  return values[0] as string;
}

describe('box-decoration-break and -webkit-box-decoration-break: Chrome 145 parsing and cascade', () => {
  type Browser = { newPage(): Promise<{ setContent(html: string): Promise<void>; evaluate(expression: string): Promise<unknown> }>; close(): Promise<void> };

  it('Dragon keeps exactly the values Chrome keeps, each computes alike from either name, the names cascade as Chrome\'s, and the plants are caught', async () => {
    const real = Object.entries(VALUES).flatMap(([name, vs]) => vs.map((v) => item(name, v)));
    const planted: { readonly name: string; readonly items: Item[] }[] = [
      { name: 'cloneDropped', items: [{ name: 'box-decoration-break', v: 'clone', value: null }] },
      { name: 'aliasDropped', items: [{ name: '-webkit-box-decoration-break', v: 'slice', value: null }] },
      { name: 'unknownKept', items: [{ name: 'box-decoration-break', v: 'none', value: 'none' }] },
      { name: 'cloneReadAsSlice', items: [{ name: 'box-decoration-break', v: 'clone', value: 'slice' }] },
      { name: 'aliasCloneReadAsSlice', items: [{ name: '-webkit-box-decoration-break', v: 'CLONE', value: 'slice' }] },
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
          return [s.getPropertyValue('${PROPERTY}'), s.getPropertyValue('-webkit-box-decoration-break')]; })()`)) as [string, string];
        // Both names read the one shared field.
        expect(both[1], rules).toBe(both[0]);
        chrome.push(both[0]);
      }
    } finally {
      await browser.close();
    }
    expect(seen.map((s) => s.length)).toEqual(sets.map((s) => s.length));
    expect(judge(real, seen[0] as Seen[])).toEqual([]);
    // Kept by Dragon and by Chrome: slice and clone in each ASCII case, through either name; nothing is refused as it parses.
    expect(real.filter((it) => it.value !== null).map((it) => `${it.name}: ${it.v}`)).toEqual([
      'box-decoration-break: slice', 'box-decoration-break: clone', 'box-decoration-break: SLICE', 'box-decoration-break: Clone',
      '-webkit-box-decoration-break: slice', '-webkit-box-decoration-break: clone', '-webkit-box-decoration-break: SLICE', '-webkit-box-decoration-break: CLONE',
    ]);
    expect((seen[0] as Seen[]).filter((s) => s.parsed).length).toBe(8);
    planted.forEach((p, i) => expect(judge(p.items, seen[i + 1] as Seen[]).length, p.name).toBe(p.items.length));
    expect(CASCADE.map((r, i) => `${r} -> ${dragon[i]}`)).toEqual(CASCADE.map((r, i) => `${r} -> ${chrome[i]}`));
    // The cases tell the two values apart: each wins somewhere.
    expect(new Set(chrome)).toEqual(new Set(['slice', 'clone']));
  }, 120_000);
});
