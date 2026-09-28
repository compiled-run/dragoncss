// P4 (notes/T013-p3-review-p4-plan.md section 2 items 1, 4, 6 and 9) over every layout case: the one derive-mode native compile per
// fixture and direction gives a layout input equal to nativeLayoutProjection of the enforced { ios, web } compile; expected dumps
// exist at ios 2 and 3 and android 2, 3 and 2.625 with identical CSS-longhand coverage per node; color-border-sides node long
// expects its initial borders as 3 device px; the generated sources hold no stylesheet text, selector, class name or JSON decoding.
import { describe, expect, it } from 'vitest';
import { cssCoverage, emitAndroidViewsCases, emitNativeSupport, emitUikitCases, expectedDump, nativeLayoutProjection, NO_FAULTS, webClassMap } from 'dragon';
import { atDpr, layoutCases } from '../src/dpr.ts';
import { readHtmlFixture } from '../src/fixture-reader.ts';
import { BACKEND_OF, emitCases, expectedEngine, nativeCases } from '../src/native-host.ts';
import { compileFixture } from '../src/pipeline.ts';
import { deviceDprs, layoutCaseIds } from '../src/targets.ts';

const cases = nativeCases();
const m = expectedEngine();
const enforced = new Map<string, ReturnType<typeof compileFixture>['compiled']>();
/** The enforced { ios, web } compile of a fixture and direction, shared by the tests below. */
function enforcedCompile(spec: Parameters<typeof compileFixture>[0], direction: 'ltr' | 'rtl'): ReturnType<typeof compileFixture>['compiled'] {
  const key = `${spec.id} ${direction}`;
  let c = enforced.get(key);
  if (c === undefined) {
    c = compileFixture(spec, NO_FAULTS, 'enforce', direction).compiled;
    enforced.set(key, c);
  }
  return c;
}

describe('the native generation compile (derive mode, ios and android)', () => {
  it('covers every layout case: 261 today, derived from layoutCases()', () => {
    expect(cases.map((c) => c.case.id)).toEqual([...layoutCaseIds()]);
    expect(cases.length).toBe(layoutCases().reduce((n, f) => n + f.cases.length, 0));
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
    expect(equal).toBe(261);
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
    expect(dumps).toBe(261 * 5);
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
  it('hold no stylesheet text, selector, class name or JSON layout decoding', () => {
    const ios = emitUikitCases(emitCases('ios'));
    const android = emitAndroidViewsCases(emitCases('android'));
    const generated = [...ios, ...android].map((f) => f.text).join('\n');
    const support = [...emitNativeSupport('uikit'), ...emitNativeSupport('android-views')].map((f) => f.text).join('\n');
    for (const src of [generated, support]) expect(src).not.toMatch(/JSONDecoder|JSONSerialization|JSONObject|org\.json|kotlinx\.serialization|Codable|Decodable/);
    let rules = 0;
    let classes = 0;
    let webClasses = 0;
    for (const f of layoutCases()) {
      if (f.spec.format === 'html') {
        const css = /<style>([\s\S]*?)<\/style>/.exec(readHtmlFixture(f.spec.id).html)?.[1] ?? '';
        for (const rule of css.split('}').map((r) => r.trim()).filter((r) => r.length > 0)) {
          rules++;
          expect(generated.includes(rule), rule).toBe(false);
        }
        for (const cls of new Set([...css.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((x) => x[1] as string))) {
          classes++;
          expect(new RegExp(`\\.${cls}(?![\\w-])`).test(generated), `.${cls}`).toBe(false);
        }
      }
      for (const direction of new Set(f.cases.map((c) => c.environment.direction))) {
        const web = enforcedCompile(f.spec, direction);
        for (const c of f.cases.filter((x) => x.environment.direction === direction)) {
          for (const w of webClassMap(web, c.assignment)?.values() ?? []) {
            webClasses++;
            expect(generated.includes(w), w).toBe(false);
          }
        }
      }
    }
    console.log(`generated sources: ${ios.length + android.length} files; ${rules} stylesheet rules, ${classes} selector class names and ${webClasses} web class bindings absent`);
    expect(rules).toBeGreaterThan(100);
    expect(webClasses).toBeGreaterThan(100);
  }, 300_000);
});
