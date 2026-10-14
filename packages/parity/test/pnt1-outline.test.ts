// PNT1 outline on the host (T046 §2): the outline fixtures' points against the committed Chrome PNGs at every device DPR. The paint
// model of pnt1-radius (boxes in tree order, rounded borders and clips, Skia's 8-bit source-over) paints every outline last, each
// box's descendants' outlines before its own (Blink's BoxFragmentPainter paints kDescendantOutlinesOnly, then kSelfOutlineOnly):
// a solid or double one as the rings of the TS paint-radius.ts outlineRings, a dotted, dashed, groove, ridge, inset or outset one as
// the TS paint-dash.ts outlinePaintOps (Blink's side painter, in the write's colour and 3D tones): what the device draws in the root
// view. Every outline, kept base and radius colour point must equal Chrome exactly. This proves the ring geometry (Blink's snapped
// width and truncated offset, the half-size clamp of a negative offset, the outset radii, double bands of round(width / 3)), the
// side painter's dashes, dots, miters and 3D colours (Color::Dark and Light, CalculateInsetOutsetColor) and the paint order (an
// outline over a later flow sibling, a parent's outline over its child's) before any device runs; every fixture but outline-values
// must have outline points. In each plant's cases (device-run.ts PLANT_CASES), the model with the plant's host twin must fail: the
// rings one device px to the right (outline-offset-1), the nominal dash gap (outline-dash-unfitted), the 3D tones swapped
// (outline-tones-swapped).
import { describe, expect, it } from 'vitest';
import { androidProfile, createProjectWith, iosProfile, laneOnlyNative, nativePrograms, NO_FAULTS, webProfile } from 'dragon';
import { casesOf, fixtureInput } from '../src/cases.ts';
import { PLANT_CASES } from '../src/device-run.ts';
import { DPRS } from '../src/dpr.ts';
import { FIXTURE_GROUPS } from '../src/fixtures.ts';
import { nativeCompile } from '../src/native-host.ts';
import { casePoints, committedPixels, devicePoints } from '../src/pixel-reference.ts';
import { ruleKind } from '../src/samples.ts';
import type { Box, Rgba } from './paint-model.ts';
import { boxes } from './paint-model.ts';
import type { OutlineFaults } from './outline-model.ts';
import { NO_OUTLINE_FAULTS, outlineModelAt, outlineOrder, outlines } from './outline-model.ts';

const OUTLINE_FIXTURES = (FIXTURE_GROUPS.find((g) => g.id === 'outline')?.fixtures ?? []).filter((f) => f.kind === 'layout');

/** Each outline plant's host twin: a shift in device px and the model's faults. */
const TWINS: Record<'outline-offset-1' | 'outline-dash-unfitted' | 'outline-tones-swapped', { readonly shift: number; readonly faults: OutlineFaults }> = {
  'outline-offset-1': { shift: 1, faults: NO_OUTLINE_FAULTS },
  'outline-dash-unfitted': { shift: 0, faults: { dash: { phase1: false, gapUnfitted: true }, tonesSwapped: false } },
  'outline-tones-swapped': { shift: 0, faults: { ...NO_OUTLINE_FAULTS, tonesSwapped: true } },
};
const PLANTS = Object.keys(TWINS) as (keyof typeof TWINS)[];

describe('PNT1 outline: the paint model at every sample point equals the committed Chrome pixels', () => {
  it('covers the seven outline fixtures in both directions', () => {
    expect(OUTLINE_FIXTURES.map((f) => f.id)).toEqual(['outline-values', 'outline-solid', 'outline-double', 'outline-rounded', 'outline-dashed', 'outline-3d', 'outline-web']);
    expect(PLANT_CASES['outline-offset-1']).toEqual(['outline-solid']);
    expect(PLANT_CASES['outline-dash-unfitted']).toEqual(['outline-dashed']);
    expect(PLANT_CASES['outline-tones-swapped']).toEqual(['outline-3d']);
  });
  it('orders a parent outline after its descendants, and siblings in tree order', () => {
    const box = (id: string, parent: string | null): Box => ({ node: { id, parent } as Box['node'], l: 0, t: 0, r: 0, b: 0, border: [], radii: null });
    expect(outlineOrder([box('a', null), box('b', 'a'), box('c', 'b'), box('d', 'a'), box('e', null)]).map((b) => b.node.id)).toEqual(['c', 'b', 'd', 'a', 'e']);
  });
  for (const spec of OUTLINE_FIXTURES) {
    for (const c of casesOf(spec, fixtureInput(spec))) {
      it(`${c.id} at ${DPRS.join(', ')}`, () => {
        const programs = nativePrograms(nativeCompile(spec, c.environment.direction), c.assignment);
        if (programs.kind !== 'ready') throw new Error(programs.reason);
        const p = programs.programs.uikit;
        let outlinePoints = 0;
        const caught = Object.fromEntries(PLANTS.map((k) => [k, 0])) as Record<keyof typeof TWINS, number>;
        const problems: string[] = [];
        for (const dpr of DPRS) {
          const chrome = committedPixels(c.id, dpr);
          if (chrome === null) throw new Error(`${c.id}@${dpr}: no committed Chrome PNG`);
          const list = boxes(p, c.environment.viewport, dpr);
          const rings = outlines(p, list, dpr, 0);
          const twins = PLANTS.map((k) => [k, outlines(p, list, dpr, TWINS[k].shift, TWINS[k].faults)] as const);
          for (const pt of casePoints(p, c.environment.viewport, dpr)) {
            const kind = ruleKind(pt.rule);
            const outline = pt.rule.includes(':outline-');
            const i = (pt.y * chrome.width + pt.x) * 4;
            const got = [chrome.data[i], chrome.data[i + 1], chrome.data[i + 2], chrome.data[i + 3]];
            const differs = (m: Rgba): boolean => got.some((v, k) => v !== m[k]);
            const want = outlineModelAt(list, rings, pt.x, pt.y);
            const planted = twins.map(([k, r]) => [k, outlineModelAt(list, r, pt.x, pt.y)] as const);
            if (kind === 'edge' || kind === 'glyph') {
              // An edge scanline across a ring's outer edge is where the device plant shows (PLANT_RULES takes edge rules). The
              // model is not judged there (an antialiased edge), but a point it gets right that the shifted rings get wrong
              // catches the shift.
              if (kind === 'edge' && outline && !differs(want)) for (const [k, m] of planted) if (differs(m)) caught[k]++;
              continue;
            }
            if (outline) outlinePoints++;
            if (differs(want)) problems.push(`${pt.rule} at ${pt.x},${pt.y} @${dpr}: Chrome ${JSON.stringify(got)}, model ${JSON.stringify(want)}`);
            for (const [k, m] of planted) if (differs(m)) caught[k]++;
          }
        }
        expect(problems).toEqual([]);
        if (spec.id === 'outline-values') {
          // Every outline here paints nothing, so the case has no outline write and no outline point.
          expect(p.nodes.some((n) => n.writes.some((w) => w.kind === 'outline'))).toBe(false);
          expect(outlinePoints).toBe(0);
        } else {
          expect(outlinePoints, 'outline points').toBeGreaterThan(0);
          // A plant runs on its cases only; elsewhere a sample point need not move under its fault.
          for (const k of PLANTS) if (PLANT_CASES[k].includes(spec.id)) expect(caught[k], `the ${k} model fault`).toBeGreaterThan(0);
        }
      });
    }
  }
});

// The translucent dashed and ridge outlines (outline-web): native refuses a translucent dotted, dashed or 3D outline (its transparency
// layer composites unlike Skia: device run 38470185768), so the lanes compile the fixture as a lane-only case, which proves web rows
// only, and the device pixel lanes skip those outlines' points.
describe('PNT1 outline: translucent side-painter outlines are proven on web only', () => {
  const spec = OUTLINE_FIXTURES.find((f) => f.id === 'outline-web');
  it("is lane-only on native, refused by name in a user compile, and its outlines are the device lanes' blind spot alone", () => {
    if (spec === undefined) throw new Error('no outline-web fixture');
    for (const c of casesOf(spec, fixtureInput(spec))) {
      const lanes = nativeCompile(spec, c.environment.direction);
      expect([laneOnlyNative(lanes, 'ios'), laneOnlyNative(lanes, 'android')], c.id).toEqual([true, true]);
      const user = createProjectWith({ projectId: 'dragon-parity', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} } }, { faults: NO_FAULTS, profiles: 'derive', direction: c.environment.direction }).compile(fixtureInput(spec));
      const errs = user.diagnostics.filter((d) => d.severity === 'error');
      expect(errs.map((d) => `${d.target} ${d.message.split(',')[0]}`).sort(), c.id).toEqual(['android a5 has a dashed outline in the translucent colour rgba(200', 'android r3 has a ridge outline in the translucent colour rgba(0', 'ios a5 has a dashed outline in the translucent colour rgba(200', 'ios r3 has a ridge outline in the translucent colour rgba(0']);
      const r = nativePrograms(lanes, c.assignment);
      if (r.kind !== 'ready') throw new Error(r.reason);
      for (const dpr of DPRS) {
        const all = casePoints(r.programs.uikit, c.environment.viewport, dpr);
        const kept = devicePoints(r.programs.uikit, c.environment.viewport, dpr);
        expect(all.some((q) => /^[a-z]+:(a5|r3):outline-/.test(q.rule)), `${c.id}@${dpr}`).toBe(true);
        expect(kept.filter((q) => /^[a-z]+:(a5|r3):outline-/.test(q.rule)), `${c.id}@${dpr}`).toEqual([]);
        // Only the outline points go: the boxes' and the stage's own points stay.
        expect(kept, `${c.id}@${dpr}`).toEqual(all.filter((q) => !/^[a-z]+:(a5|r3):outline-/.test(q.rule)));
        expect(kept.some((q) => q.rule.startsWith('interior:stage')), `${c.id}@${dpr}`).toBe(true);
      }
    }
  });
  it('drops no point of an outline fixture without a translucent side-painter outline', () => {
    for (const s of OUTLINE_FIXTURES.filter((f) => f.id !== 'outline-web')) {
      for (const c of casesOf(s, fixtureInput(s))) {
        const r = nativePrograms(nativeCompile(s, c.environment.direction), c.assignment);
        if (r.kind !== 'ready') throw new Error(r.reason);
        expect([laneOnlyNative(nativeCompile(s, c.environment.direction), 'ios')], c.id).toEqual([false]);
        for (const dpr of DPRS) expect(devicePoints(r.programs.uikit, c.environment.viewport, dpr), `${c.id}@${dpr}`).toEqual(casePoints(r.programs.uikit, c.environment.viewport, dpr));
      }
    }
  });
  it('cites outline-web for the web outline rows and never for a native one', () => {
    const cites = (rows: typeof webProfile.rows): string[] => rows.filter((r) => r.feature.startsWith('outline-')).flatMap((r) => r.proofs.flatMap((p) => p.cases));
    expect(cites(webProfile.rows)).toEqual(expect.arrayContaining(['outline-web', 'outline-web-rtl']));
    for (const profile of [iosProfile, androidProfile]) expect(cites(profile.rows).filter((id) => id.startsWith('outline-web'))).toEqual([]);
  });
});
