// P4 (notes/T013-p3-review-p4-plan.md section 2 items 1, 4, 6 and 9) over every layout case: the one derive-mode native compile per
// fixture and direction gives a layout input equal to nativeLayoutProjection of the enforced { ios, web } compile; expected dumps
// exist at ios 2 and 3 and android 2, 3 and 2.625 with identical CSS-longhand coverage per node; color-border-sides node long
// expects its initial borders as 3 device px; the generated sources hold no stylesheet text, selector, class name or JSON decoding.
import { describe, expect, it } from 'vitest';
import { cssCoverage, emitAndroidViewsCases, emitNativeSupport, emitUikitCases, expectedDump, nativeLayoutProjection, webClassMap } from 'dragon';
import { declaredLayoutCaseCount, MILESTONE_1_LAYOUT_CASES } from '../src/case-count.ts';
import { atDpr, layoutCases } from '../src/dpr.ts';
import { readHtmlFixture } from '../src/fixture-reader.ts';
import { BACKEND_OF, emitCases, expectedEngine, nativeCases } from '../src/native-host.ts';
import { enforcedCompile } from '../src/pipeline.ts';
import { containedNeedles, dotNames } from '../src/text-search.ts';
import { deviceDprs, layoutCaseIds } from '../src/targets.ts';

const cases = nativeCases();
const m = expectedEngine();
describe('the native generation compile (derive mode, ios and android)', () => {
  it('covers every layout case, derived from layoutCases()', () => {
    expect(cases.map((c) => c.case.id)).toEqual([...layoutCaseIds()]);
    expect(cases.length).toBe(layoutCases().reduce((n, f) => n + f.cases.length, 0));
    expect(cases.length).toBe(declaredLayoutCaseCount());
    expect(cases.length).toBeGreaterThanOrEqual(MILESTONE_1_LAYOUT_CASES);
  });
  it('its layout input deep-equals nativeLayoutProjection of the enforced { ios, web } compile for every case', () => {
    let equal = 0;
    for (const n of cases) {
      const c = enforcedCompile(n.spec, n.case.environment.direction);
      for (const dpr of [1, 2, 3, 2.625]) {
        const env = atDpr(n.case.environment, dpr);
        const want = nativeLayoutProjection(c, env, n.case.assignment);
        const got = nativeLayoutProjection(n.compiled, env, n.case.assignment);
        expect(got).toEqual(want);
        if (got.kind === 'ready') expect(n.programs.uikit.root).toEqual(got.input.root);
      }
      expect(n.programs.uikit.root).toBe(n.programs['android-views'].root);
      equal++;
    }
    expect(equal).toBe(layoutCaseIds().length);
  }, 300_000);
  it('the compile configures ios and android in derive mode and keeps both analysis-only', () => {
    for (const n of cases) {
      expect(Object.keys(n.compiled.outputs).sort()).toEqual(['android', 'ios']);
      expect(n.compiled.outputs.ios.kind).toBe('analysis-only');
      expect(n.compiled.outputs.android.kind).toBe('analysis-only');
    }
  });
});

describe('expected dumps', () => {
  it('exist for every case at ios 2 and 3 and at android 2, 3 and 2.625, with identical CSS-longhand coverage per node', () => {
    let dumps = 0;
    for (const n of cases) expect([...cssCoverage(n.programs.uikit)]).toEqual([...cssCoverage(n.programs['android-views'])]);
    for (const target of ['ios', 'android'] as const) {
      // emitCases projects every expected dump at the target's device DPRs (and throws on any case the engine refuses).
      for (const e of emitCases(target)) {
        expect(e.expectedDigests.map((d) => d.dpr)).toEqual([...deviceDprs(target)]);
        for (const d of e.expectedDigests) expect(d.sha256).toMatch(/^[0-9a-f]{64}$/);
        dumps += e.expectedDigests.length;
      }
    }
    expect(dumps).toBe((['ios', 'android'] as const).reduce((n, t) => n + deviceDprs(t).length * layoutCaseIds().length, 0));
  }, 300_000);
  it('color-border-sides node long expects its initial border widths as 3 device px: 1 pt at scale 3 on iOS, 3 px on Android', () => {
    const n = cases.find((c) => c.case.id === 'color-border-sides');
    if (n === undefined) throw new Error('no color-border-sides');
    const at = (target: 'ios' | 'android', dpr: number) => expectedDump(n.programs[BACKEND_OF[target]], n.case.id, n.case.environment.viewport, dpr, m).nodes.find((x) => x.id === 'long')?.applied;
    expect(at('ios', 3)?.['dragonBorder.widths']).toEqual([1, 1, 1, 1]);
    expect(at('ios', 2)?.['dragonBorder.widths']).toEqual([1.5, 1.5, 1.5, 1.5]);
    for (const dpr of [2, 3, 2.625]) expect(at('android', dpr)?.['dragonBorder.widthsPx']).toEqual([3, 3, 3, 3]);
    expect(at('ios', 3)?.['dragonBorder.styles']).toEqual(['solid', 'solid', 'solid', 'solid']);
  });
});

describe('the generated sources', () => {
  // Each fixture's checks run in their own test, its enforced compile included; the corpus test checks every web class binding at once.
  let sources: { readonly files: number; readonly generated: string; readonly support: string } | null = null;
  const sourcesOf = () => {
    if (sources === null) {
      const ios = emitUikitCases(emitCases('ios'));
      const android = emitAndroidViewsCases(emitCases('android'));
      sources = { files: ios.length + android.length, generated: [...ios, ...android].map((f) => f.text).join('\n'), support: [...emitNativeSupport('uikit'), ...emitNativeSupport('android-views')].map((f) => f.text).join('\n') };
    }
    return sources;
  };
  const stylesheetOf = (f: (ReturnType<typeof layoutCases>)[number]): { readonly rules: readonly string[]; readonly classes: readonly string[] } => {
    if (f.spec.format !== 'html') return { rules: [], classes: [] };
    const css = /<style>([\s\S]*?)<\/style>/.exec(readHtmlFixture(f.spec.id).html)?.[1] ?? '';
    return { rules: css.split('}').map((r) => r.trim()).filter((r) => r.length > 0), classes: [...new Set([...css.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((x) => x[1] as string))] };
  };
  // Every rule of the corpus looked up in one pass over the 25 MB of sources, and every '.name' in them read once.
  let index: { readonly rules: ReadonlySet<string>; readonly dotted: ReadonlySet<string> } | null = null;
  const indexOf = () => {
    index ??= { rules: containedNeedles(sourcesOf().generated, layoutCases().flatMap((f) => stylesheetOf(f).rules)), dotted: dotNames(sourcesOf().generated) };
    return index;
  };
  const bindings = new Map<string, readonly string[]>();
  const bindingsOf = (f: (ReturnType<typeof layoutCases>)[number]): readonly string[] => {
    let b = bindings.get(f.spec.id);
    if (b === undefined) {
      const out: string[] = [];
      for (const direction of new Set(f.cases.map((c) => c.environment.direction))) {
        const web = enforcedCompile(f.spec, direction);
        for (const c of f.cases.filter((x) => x.environment.direction === direction)) out.push(...(webClassMap(web, c.assignment)?.values() ?? []));
      }
      b = out;
      bindings.set(f.spec.id, b);
    }
    return b;
  };

  it.each(layoutCases().map((f) => [f.spec.id, f] as const))('%s: none of its stylesheet rules or selector class names', (_id, f) => {
    const { rules, classes } = stylesheetOf(f);
    for (const rule of rules) expect(indexOf().rules.has(rule), rule).toBe(false);
    for (const cls of classes) expect(indexOf().dotted.has(cls), `.${cls}`).toBe(false);
    bindingsOf(f);
  });
  it('hold no stylesheet text, selector, class name or JSON layout decoding', () => {
    const { files, generated, support } = sourcesOf();
    for (const src of [generated, support]) expect(src).not.toMatch(/JSONDecoder|JSONSerialization|JSONObject|org\.json|kotlinx\.serialization|Codable|Decodable/);
    const webChecks = layoutCases().flatMap(bindingsOf);
    const contained = containedNeedles(generated, webChecks);
    for (const w of webChecks) expect(contained.has(w), w).toBe(false);
    const rules = layoutCases().reduce((n, f) => n + stylesheetOf(f).rules.length, 0);
    const classes = layoutCases().reduce((n, f) => n + stylesheetOf(f).classes.length, 0);
    const webClasses = webChecks.length;
    console.log(`generated sources: ${files} files; ${rules} stylesheet rules, ${classes} selector class names and ${webClasses} web class bindings absent`);
    expect(rules).toBeGreaterThan(100);
    expect(webClasses).toBeGreaterThan(100);
  }, 300_000);
});
