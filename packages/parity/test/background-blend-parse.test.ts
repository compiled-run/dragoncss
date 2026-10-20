// background-blend-mode against Chrome 145. The parse: Dragon keeps exactly the values Chrome keeps (each of Chrome's sixteen modes, in
// any ASCII case and in comma lists, never plus-lighter or plus-darker), and each kept value computes alike. The cascade: declaration
// order, !important, specificity, inherit, var() and the CSS-wide keywords give Dragon's computed value Chrome's. Dragon then refuses
// every value but normal (analysis/background-blend.ts), so the cascade cases compile with the profiles derived and that refusal
// planted off. Each planted reading must be caught.
import { describe, expect, it } from 'vitest';
import { createProjectWith, NO_FAULTS } from 'dragon';
import type { Diagnostic } from '../../dragon/src/index.ts';
import { valueToString } from '../../dragon/src/analysis/resolve.ts';
import { parseStylesheet } from '../../dragon/src/css/stylesheet.ts';
import { DOCUMENT_ID, fixtureToInput, PROJECT_ID } from '../src/fixture-reader.ts';

const SOURCE = { uri: 'dragon-source://test/background-blend.css', revision: 'r1', hash: 'sha256:0' };
const PROPERTY = 'background-blend-mode';

/** value: Dragon's parsed value, or null when Dragon drops the declaration. */
type Item = { readonly v: string; readonly value: string | null };
/** Chrome's reading: whether it keeps the value, what it computes, and what Dragon's value computes. */
type Seen = { readonly parsed: boolean; readonly authored: string; readonly dragon: string };

function item(v: string): Item {
  const css = `.a { ${PROPERTY}: ${v}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  if (diagnostics.length > 1) throw new Error(`${v}: more than one diagnostic`);
  const code = diagnostics[0]?.code ?? null;
  if (code !== null && code !== 'DRAGON_CSS_INVALID_VALUE') throw new Error(`${v}: unexpected ${code}`);
  const longhands = rules[0]?.declarations[0]?.longhands ?? [];
  if (code === null && (longhands.length !== 1 || longhands[0]?.property !== PROPERTY)) throw new Error(`${v}: accepted without exactly one ${PROPERTY} longhand`);
  return { v, value: code === null ? valueToString((longhands[0] as (typeof longhands)[number]).value) : null };
}

const MODES = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'];
const OTHERS = ['NORMAL', 'Normal', 'MULTIPLY', 'normal, normal', 'normal,multiply', 'SCREEN , Overlay , normal', 'plus-lighter', 'plus-darker', 'normal, plus-lighter',
  'none', 'auto', 'initial normal', 'normal normal', 'normal,', ', normal', '0', 'add', 'source-over', 'normal / normal'];
const VALUES = [...MODES, ...OTHERS];

function judge(items: readonly Item[], seen: readonly Seen[]): string[] {
  return items.flatMap((it, i) => {
    const s = seen[i] as Seen;
    if (it.value === null) return s.parsed ? [`${it.v}: dropped, Chrome parses it`] : [];
    if (!s.parsed) return [`${it.v}: kept as ${it.value}, Chrome drops it`];
    return s.authored === s.dragon ? [] : [`${it.v}: Chrome computes ${s.authored}, Dragon's ${it.value} computes ${s.dragon}`];
  });
}

/** Rules for .p (the parent) and .a.b (the element d). */
const CASCADE: readonly string[] = [
  '.a { background-blend-mode: multiply; background-blend-mode: normal; }',
  '.a { background-blend-mode: normal; background-blend-mode: multiply; }',
  '.a { background-blend-mode: screen !important; background-blend-mode: normal; }',
  '.a { background-blend-mode: normal !important; } .a { background-blend-mode: screen; }',
  '.a.b { background-blend-mode: overlay; } .a { background-blend-mode: normal; }',
  '.a { background-blend-mode: overlay; } .a { background-blend-mode: normal; }',
  '.p { background-blend-mode: hue; } .a { background-blend-mode: inherit; }',
  '.p { background-blend-mode: hue; }',
  '.a { --v: Difference; background-blend-mode: var(--v); }',
  '.a { --v: normal; background-blend-mode: color; background-blend-mode: var(--v); }',
  '.a { background-blend-mode: var(--missing, luminosity); }',
  '.a { background-blend-mode: exclusion; background-blend-mode: initial; }',
  '.a { background-blend-mode: exclusion; background-blend-mode: unset; }',
  '.p { background-blend-mode: darken; } .a { background-blend-mode: lighten; background-blend-mode: revert; }',
];

const page = (rules: string): string =>
  `<!DOCTYPE html><html data-dragon-id="html"><head><style>body { margin: 0; font-family: Ahem; font-size: 10px; } ${rules}</style></head>` +
  '<body data-dragon-id="body"><div data-dragon-id="p" class="p"><div data-dragon-id="d" class="a b">XX</div></div></body></html>';

/** Dragon's computed background-blend-mode of d on each target; the backgroundBlendAccepted plant lets a winning mode compile so it can be read. */
function dragonCascade(rules: string): string {
  const c = createProjectWith({ projectId: PROJECT_ID, targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} } }, { faults: { ...NO_FAULTS, backgroundBlendAccepted: true }, profiles: 'derive', direction: 'ltr' }).compile(fixtureToInput('background-blend-cascade', page(rules)));
  const values = (['web', 'ios', 'android'] as const).map((target) => {
    const r = c.explain({ target, at: { node: 'd', instance: DOCUMENT_ID }, property: PROPERTY });
    if (r.kind !== 'found' || r.cases.length !== 1) throw new Error(`${rules}: ${target}: ${JSON.stringify(r)}`);
    return (r.cases[0] as (typeof r.cases)[number]).value;
  });
  if (new Set(values).size !== 1) throw new Error(`${rules}: the targets disagree: ${values.join(', ')}`);
  return values[0] as string;
}

describe('background-blend-mode: Chrome 145 parsing and cascade', () => {
  type Browser = { newPage(): Promise<{ setContent(html: string): Promise<void>; evaluate(expression: string): Promise<unknown> }>; close(): Promise<void> };

  it('Dragon keeps exactly the values Chrome keeps, each computes alike, the cascade is Chrome\'s, and the plants are caught', async () => {
    const real = VALUES.map(item);
    const planted: { readonly name: string; readonly items: Item[] }[] = [
      { name: 'multiplyDropped', items: [{ v: 'multiply', value: null }] },
      { name: 'listDropped', items: [{ v: 'normal, normal', value: null }] },
      { name: 'plusLighterKept', items: [{ v: 'plus-lighter', value: 'plus-lighter' }] },
      { name: 'unknownKept', items: [{ v: 'none', value: 'none' }] },
      { name: 'multiplyReadAsNormal', items: [{ v: 'multiply', value: 'normal' }] },
    ];
    const sets = [real, ...planted.map((p) => p.items)];
    const dragon = CASCADE.map(dragonCascade);
    const { launchChrome } = (await import(new URL('../src/chrome.ts', import.meta.url).href)) as { launchChrome: () => Promise<Browser> };
    const browser = await launchChrome();
    let seen: Seen[][];
    const chrome: string[] = [];
    try {
      const tab = await browser.newPage();
      await tab.setContent('<!DOCTYPE html><div id="a"></div><div id="c"></div>');
      // A string expression: this test project has no DOM types. The authored value on #a and Dragon's value on #c, each read computed.
      seen = (await tab.evaluate(`(${JSON.stringify(sets)}).map((items) => items.map((it) => {
        const a = document.getElementById('a'), c = document.getElementById('c');
        for (const e of [a, c]) e.removeAttribute('style');
        a.style.setProperty('${PROPERTY}', it.v);
        const parsed = a.style.getPropertyValue('${PROPERTY}') !== '';
        if (it.value !== null) c.style.setProperty('${PROPERTY}', it.value);
        const read = (e) => getComputedStyle(e).getPropertyValue('${PROPERTY}');
        return { parsed, authored: read(a), dragon: read(c) };
      }))`)) as Seen[][];
      for (const rules of CASCADE) {
        await tab.setContent(page(rules));
        chrome.push((await tab.evaluate(`getComputedStyle(document.querySelector('[data-dragon-id="d"]')).getPropertyValue('${PROPERTY}')`)) as string);
      }
    } finally {
      await browser.close();
    }
    expect(seen.map((s) => s.length)).toEqual(sets.map((s) => s.length));
    expect(judge(real, seen[0] as Seen[])).toEqual([]);
    // Kept by Dragon and by Chrome: the sixteen modes, the case variants and the comma lists of modes.
    expect(real.filter((it) => it.value !== null).map((it) => it.v)).toEqual([...MODES, 'NORMAL', 'Normal', 'MULTIPLY', 'normal, normal', 'normal,multiply', 'SCREEN , Overlay , normal']);
    expect((seen[0] as Seen[]).filter((s) => s.parsed).length).toBe(MODES.length + 6);
    planted.forEach((p, i) => expect(judge(p.items, seen[i + 1] as Seen[]).length, p.name).toBe(p.items.length));
    expect(CASCADE.map((r, i) => `${r} -> ${dragon[i]}`)).toEqual(CASCADE.map((r, i) => `${r} -> ${chrome[i]}`));
    // The cases tell normal from a mode: both win somewhere.
    expect(chrome).toContain('normal');
    expect(chrome.filter((v) => v !== 'normal').length).toBeGreaterThan(3);
  }, 120_000);
});
