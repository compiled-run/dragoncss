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
import { NO_OUTLINE_FAULTS, outlineModelAt, outlineOrder, outlines, ringsOver } from './outline-model.ts';
import { outlineWrite } from '../src/paint-samples/outline.ts';

// outline-layers paints outlines in their paint layers, under and inside positioned boxes: pnt1-effects proves it with the Appendix E
// model. outline-transform draws them inside transformed layers, and outline-clip-layer a clipping layer's own outline outside its
// clip: the describe blocks below prove them. This model (boxes in tree order and untransformed, every outline last) leaves them out.
const OUTSIDE_THE_MODEL = ['outline-layers', 'outline-transform', 'outline-clip-layer'];
const OUTLINE_FIXTURES = (FIXTURE_GROUPS.find((g) => g.id === 'outline')?.fixtures ?? []).filter((f) => f.kind === 'layout' && !OUTSIDE_THE_MODEL.includes(f.id));

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

// PNT1-outline-transform: an outline inside a transformed layer (scaled, translated, rotated, scaled about a corner, a child of a
// translated box) is drawn in the layer's view, so it moves with the layer's matrices. Every colour point of such a ring, which
// the transform sample module maps through the matrices and keeps clear of every transformed edge, must be the outline's colour
// in Chrome's pixels. The untransformed rings (what the outline-root-hosted plant draws) must miss some of those points at every DPR.
describe('PNT1 outline: a ring inside a transformed layer is where Chrome draws it', () => {
  const spec = (FIXTURE_GROUPS.find((g) => g.id === 'outline')?.fixtures ?? []).find((f) => f.id === 'outline-transform');
  if (spec === undefined) throw new Error('no outline-transform fixture');
  it('is an outline-root-hosted plant case', () => {
    expect(PLANT_CASES['outline-root-hosted']).toContain('outline-transform');
  });
  for (const c of casesOf(spec, fixtureInput(spec))) {
    it(`${c.id} at ${DPRS.join(', ')}`, () => {
      const programs = nativePrograms(nativeCompile(spec, c.environment.direction), c.assignment);
      if (programs.kind !== 'ready') throw new Error(programs.reason);
      const p = programs.programs.uikit;
      const byId = new Map(p.nodes.map((n) => [n.id, n]));
      const transformed = (id: string): boolean => {
        for (let n = byId.get(id); n !== undefined; n = n.parent === null ? undefined : byId.get(n.parent)) if (((n.facts['transform'] as { ops: readonly unknown[] } | undefined)?.ops.length ?? 0) > 0) return true;
        return false;
      };
      const problems: string[] = [];
      for (const dpr of DPRS) {
        const owners = new Set<string>();
        const chrome = committedPixels(c.id, dpr);
        if (chrome === null) throw new Error(`${c.id}@${dpr}: no committed Chrome PNG`);
        const flat = outlines(p, boxes(p, c.environment.viewport, dpr), dpr, 0);
        let points = 0;
        let missed = 0;
        for (const pt of casePoints(p, c.environment.viewport, dpr)) {
          const m = /^border:(.+):outline-\d+-(top|right|bottom|left)$/.exec(pt.rule);
          if (m === null || !transformed(m[1] as string)) continue;
          const id = m[1] as string;
          const w = outlineWrite({ program: p } as never, id);
          if (w === null) throw new Error(`${id}: an outline point with no outline write`);
          points++;
          owners.add(id);
          const i = (pt.y * chrome.width + pt.x) * 4;
          const got = [chrome.data[i], chrome.data[i + 1], chrome.data[i + 2], chrome.data[i + 3]];
          const want = [w.color.r, w.color.g, w.color.b, 255];
          if (w.color.alpha !== 255) throw new Error(`${id}: a translucent outline is not modelled here`);
          if (got.some((v, k) => v !== want[k])) problems.push(`${pt.rule} at ${pt.x},${pt.y} @${dpr}: Chrome ${JSON.stringify(got)}, outline ${JSON.stringify(want)}`);
          const ring = flat.find((r) => r.box.node.id === id);
          if (ring === undefined || ringsOver([0, 0, 0, 0], [ring], pt.x, pt.y)[3] === 0) missed++;
        }
        expect(points, `transformed outline points @${dpr}`).toBeGreaterThan(0);
        // Every transformed outline is compared at every DPR, the double ring and the transform-origin case included.
        expect([...owners].sort(), `transformed outlines with points @${dpr}`).toEqual(['grow', 'kid', 'press', 'turn']);
        expect(missed, `points the untransformed rings miss @${dpr}`).toBeGreaterThan(0);
      }
      expect(problems).toEqual([]);
    });
  }
});

// A clipping layer's own outline (scaled with a rounded clip, rotated, and positioned with a double ring) is drawn beside its clip
// view, so it moves with the layer and nothing it clips covers it. Every colour point of each ring, mapped through the layer's
// matrices, must be the outline's colour in Chrome's pixels at every DPR.
describe("PNT1 outline: a clipping layer's own outline is drawn outside its clip, where Chrome draws it", () => {
  const spec = (FIXTURE_GROUPS.find((g) => g.id === 'outline')?.fixtures ?? []).find((f) => f.id === 'outline-clip-layer');
  if (spec === undefined) throw new Error('no outline-clip-layer fixture');
  for (const c of casesOf(spec, fixtureInput(spec))) {
    it(`${c.id} at ${DPRS.join(', ')}`, () => {
      const programs = nativePrograms(nativeCompile(spec, c.environment.direction), c.assignment);
      if (programs.kind !== 'ready') throw new Error(programs.reason);
      const p = programs.programs.uikit;
      const problems: string[] = [];
      for (const dpr of DPRS) {
        const chrome = committedPixels(c.id, dpr);
        if (chrome === null) throw new Error(`${c.id}@${dpr}: no committed Chrome PNG`);
        const owners = new Set<string>();
        for (const pt of casePoints(p, c.environment.viewport, dpr)) {
          const m = /^border:(.+):outline-\d+-(top|right|bottom|left)$/.exec(pt.rule);
          if (m === null) continue;
          const id = m[1] as string;
          const w = outlineWrite({ program: p } as never, id);
          if (w === null) throw new Error(`${id}: an outline point with no outline write`);
          owners.add(id);
          const i = (pt.y * chrome.width + pt.x) * 4;
          const got = [chrome.data[i], chrome.data[i + 1], chrome.data[i + 2], chrome.data[i + 3]];
          const want = [w.color.r, w.color.g, w.color.b, 255];
          if (got.some((v, k) => v !== want[k])) problems.push(`${pt.rule} at ${pt.x},${pt.y} @${dpr}: Chrome ${JSON.stringify(got)}, outline ${JSON.stringify(want)}`);
        }
        expect([...owners].sort(), `clipping layers with outline points @${dpr}`).toEqual(['press', 'rel', 'turn']);
      }
      expect(problems).toEqual([]);
    });
  }
});
