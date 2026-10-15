// PNT1 radius on the host (T046 §2): the radius fixtures' points against the committed Chrome PNGs at every device DPR. A small
// paint model (boxes in tree order, each filling its rounded border box, borders between the rounded border-box and padding-edge
// shapes, rounded overflow clips of ancestors, Skia's 8-bit source-over) predicts each sample's colour from the program and the TS
// paint-radius.ts geometry; every radius, clip and kept base colour point must equal Chrome exactly. This proves the geometry the
// device draws with (percentages, the §5.5 clamp, the padding-edge radii, a rounded double border's two rings) before any device
// runs, and that the points are clear; on radius-double the double-solid plant's model fault must miss Chrome at a point.
import { describe, expect, it } from 'vitest';
import { androidProfile, createProjectWith, iosProfile, laneOnlyNative, nativePrograms, NO_FAULTS, webProfile } from 'dragon';
import { casesOf, fixtureInput } from '../src/cases.ts';
import { DPRS } from '../src/dpr.ts';
import { FIXTURE_GROUPS } from '../src/fixtures.ts';
import { nativeCompile } from '../src/native-host.ts';
import { PLANT_CASES, PLANT_RULES } from '../src/device-run.ts';
import { casePoints, committedPixels, devicePoints } from '../src/pixel-reference.ts';
import { ruleKind } from '../src/samples.ts';
import { boxes, modelAt } from './paint-model.ts';

const RADIUS_FIXTURES = (FIXTURE_GROUPS.find((g) => g.id === 'radius')?.fixtures ?? []).filter((f) => f.kind === 'layout');

describe('PNT1 radius: the paint model at every sample point equals the committed Chrome pixels', () => {
  it('covers the ten radius fixtures in both directions', () => {
    expect(RADIUS_FIXTURES.map((f) => f.id)).toEqual(['radius-basic', 'radius-borders', 'radius-clip', 'radius-clamp', 'radius-cascade', 'radius-longhands', 'radius-logical', 'radius-replaced', 'radius-double', 'radius-double-web']);
  });
  for (const spec of RADIUS_FIXTURES) {
    for (const c of casesOf(spec, fixtureInput(spec))) {
      it(`${c.id} at ${DPRS.join(', ')}`, () => {
        const programs = nativePrograms(nativeCompile(spec, c.environment.direction), c.assignment);
        if (programs.kind !== 'ready') throw new Error(programs.reason);
        const p = programs.programs.uikit;
        let radiusPoints = 0;
        const problems: string[] = [];
        // The double-solid plant (one solid band for a rounded double border) must miss Chrome somewhere on its case.
        let plantCaught = 0;
        let stripePoints = 0;
        for (const dpr of DPRS) {
          const chrome = committedPixels(c.id, dpr);
          if (chrome === null) throw new Error(`${c.id}@${dpr}: no committed Chrome PNG`);
          const list = boxes(p, c.environment.viewport, dpr);
          for (const pt of casePoints(p, c.environment.viewport, dpr)) {
            const kind = ruleKind(pt.rule);
            if (kind === 'edge' || kind === 'glyph') continue;
            if (kind === 'radius' || (kind === 'clip' && pt.rule.split(':').length === 3 && /-(left|right)$/.test(pt.rule))) radiusPoints++;
            const i = (pt.y * chrome.width + pt.x) * 4;
            const got = [chrome.data[i], chrome.data[i + 1], chrome.data[i + 2], chrome.data[i + 3]];
            const want = modelAt(list, pt.x, pt.y);
            if (got.some((v, k) => v !== want[k])) problems.push(`${pt.rule} at ${pt.x},${pt.y} @${dpr}: Chrome ${JSON.stringify(got)}, model ${JSON.stringify(want)}`);
            if (/-stripe$/.test(pt.rule)) stripePoints++;
            const planted = modelAt(list, pt.x, pt.y, null, true);
            if (PLANT_CASES['double-solid'].includes(spec.id) && PLANT_RULES['double-solid'].test(pt.rule) && got.some((v, k) => v !== planted[k])) plantCaught++;
          }
        }
        if (PLANT_CASES['double-solid'].includes(spec.id)) {
          expect(stripePoints, 'rounded double stripe points').toBeGreaterThan(0);
          expect(plantCaught, 'the double-solid model fault').toBeGreaterThan(0);
        }
        expect(problems).toEqual([]);
        expect(radiusPoints, 'radius and rounded clip points').toBeGreaterThan(0);
      });
    }
  }
});

// The translucent rounded double border (radius-double-web): native refuses it (its platform blend is not Skia's 8-bit premultiplied
// fill: device run 38470185768), so the lanes compile the fixture as a lane-only case, which proves web rows only, and the device
// pixel lanes skip that box's points.
describe('PNT1b radius: a translucent rounded double border is proven on web only', () => {
  const spec = RADIUS_FIXTURES.find((f) => f.id === 'radius-double-web');
  const named = /^[a-z]+:alpha(:|$)/;
  it("is lane-only on native, refused by name in a user compile, and its box is the device lanes' blind spot alone", () => {
    if (spec === undefined) throw new Error('no radius-double-web fixture');
    for (const c of casesOf(spec, fixtureInput(spec))) {
      const lanes = nativeCompile(spec, c.environment.direction);
      expect([laneOnlyNative(lanes, 'ios'), laneOnlyNative(lanes, 'android')], c.id).toEqual([true, true]);
      const user = createProjectWith({ projectId: 'dragon-parity', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} } }, { faults: NO_FAULTS, profiles: 'derive', direction: c.environment.direction }).compile(fixtureInput(spec));
      const errs = user.diagnostics.filter((d) => d.severity === 'error');
      expect(errs.map((d) => `${d.target} ${d.message.split(',')[0]}`).sort(), c.id).toEqual(['android alpha is a rounded double border in the translucent colour rgba(192', 'ios alpha is a rounded double border in the translucent colour rgba(192']);
      const r = nativePrograms(lanes, c.assignment);
      if (r.kind !== 'ready') throw new Error(r.reason);
      for (const dpr of DPRS) {
        const all = casePoints(r.programs.uikit, c.environment.viewport, dpr);
        const kept = devicePoints(r.programs.uikit, c.environment.viewport, dpr);
        expect(all.some((q) => q.rule.startsWith('radius:alpha:')), `${c.id}@${dpr}`).toBe(true);
        // Every point named for the box goes; the row keeps its own.
        expect(kept, `${c.id}@${dpr}`).toEqual(all.filter((q) => !named.test(q.rule)));
        expect(kept.some((q) => q.rule.startsWith('interior:row')), `${c.id}@${dpr}`).toBe(true);
      }
    }
  });
  it('drops no point of a radius fixture without a translucent rounded double border', () => {
    for (const s of RADIUS_FIXTURES.filter((f) => f.id !== 'radius-double-web')) {
      for (const c of casesOf(s, fixtureInput(s))) {
        const lanes = nativeCompile(s, c.environment.direction);
        expect(laneOnlyNative(lanes, 'ios'), c.id).toBe(false);
        const r = nativePrograms(lanes, c.assignment);
        if (r.kind !== 'ready') throw new Error(r.reason);
        for (const dpr of DPRS) expect(devicePoints(r.programs.uikit, c.environment.viewport, dpr), `${c.id}@${dpr}`).toEqual(casePoints(r.programs.uikit, c.environment.viewport, dpr));
      }
    }
  });
  it('cites radius-double-web for the web radius rows and never for a native one', () => {
    const cites = (rows: typeof webProfile.rows): string[] => rows.filter((r) => r.feature.startsWith('border-')).flatMap((r) => r.proofs.flatMap((p) => p.cases));
    expect(cites(webProfile.rows)).toEqual(expect.arrayContaining(['radius-double-web', 'radius-double-web-rtl']));
    for (const profile of [iosProfile, androidProfile]) expect(cites(profile.rows).filter((id) => id.startsWith('radius-double-web'))).toEqual([]);
  });
});
