// T065 R4, R17, R18: the frame cases. Sidecars parse strictly; every frame fixture compiles to a state program and animation
// tables; the derived scripts are deterministic; a zero-elapsed A to B to C equals A to C (R4); the TypeScript animator and the
// engine equal Chrome's committed frame captures at every sample, DPR and direction, with chrome-dual; and each runtime plant
// fails its own fixture's frame lanes.
import { describe, expect, it } from 'vitest';
import { rtEasing, rtInterpolate } from '@dragon/layout';
import { androidProfile, animationFeatures, iosProfile, stateKey, webProfile } from 'dragon';
import type { SlotListing } from 'dragon';
import type { AnimFaults } from '../src/anim-cases.ts';
import { NO_ANIM_FAULTS } from '../src/anim-cases.ts';
import type { AnimCase } from '../src/anim-cases.ts';
import { animCasesOf, animFixtures, frameScript, parseFrames, runFrameScript, simulator } from '../src/anim-cases.ts';
import { animCaseReport, animReport } from '../src/frame-capture.ts';
import { canonicalJsonText } from '../src/state-cases.ts';
import { ANIMATION_CONTEXT, deriveAnimationRows } from '../src/profile-rows.ts';

const cases = animFixtures().flatMap(animCasesOf);
const byFixture = (id: string): AnimCase => {
  const c = cases.find((x) => x.fixture.id === id);
  if (c === undefined) throw new Error(`no frame case of ${id}`);
  return c;
};
const show = (v: rtInterpolate.AnimatedValue): string => rtInterpolate.serializeValue(v, 0, 0, { sin: Math.sin, cos: Math.cos });

describe('frame sidecars', () => {
  it('parse strictly: schema, directions, viewports, spans, sets and grids', () => {
    const ok = { schema: 'dragon-frames/1', directions: ['ltr'], viewports: [[400, 300]], phases: [{ set: [['on', true]], span: 100, grid: 60 }] };
    expect(parseFrames(JSON.stringify(ok), 'x').phases[0]).toEqual({ set: [['on', true]], span: 100, grid: 60 });
    const bad = (patch: object): string => JSON.stringify({ ...ok, ...patch });
    expect(() => parseFrames(bad({ schema: 'x' }), 'x')).toThrow(/schema/);
    expect(() => parseFrames(bad({ directions: [] }), 'x')).toThrow(/directions/);
    expect(() => parseFrames(bad({ viewports: [[400.5, 300]] }), 'x')).toThrow(/viewports/);
    expect(() => parseFrames(bad({ phases: [{ span: -1 }] }), 'x')).toThrow(/span/);
    expect(() => parseFrames(bad({ phases: [{ span: 1, grid: 30 }] }), 'x')).toThrow(/grid/);
    expect(() => parseFrames(bad({ phases: [{ span: 1, pause: true }] }), 'x')).toThrow(/unknown keys pause/);
  });

  it('every frame fixture compiles to a state program and tables, and its script is deterministic and ends in a settle', () => {
    expect(animFixtures().map((f) => f.id)).toContain('anim-triple');
    for (const c of cases) {
      const s = frameScript(c);
      expect(frameScript(c), c.id).toEqual(s);
      const last = s[s.length - 1];
      expect(last?.kind === 'dump' && last.settle, c.id).toBe(true);
      expect(s.every((x) => x.kind !== 'advance' || (Number.isFinite(x.ms) && x.ms > 0)), c.id).toBe(true);
    }
    console.log(`frame cases ${cases.length}, dumps ${cases.reduce((n, c) => n + frameScript(c).filter((x) => x.kind === 'dump').length, 0)}`);
  });
});

describe('R4: one style change event per step', () => {
  // R4's argument is that every value B changes is held at A's by a transition at progress 0, so C sees A's style. Where that does
  // not hold, Chrome differs as Dragon does, and the triple is excluded (both spec corrections, see the PR body):
  // - B creates, reveals, removes or hides an element C transitions: its style before C differs from A's in existing at all, so one
  //   path transitions and the other is its first style there (R7);
  // - B changes a value without a transition at progress 0 (transition none or a zero duration, a negative delay, a jump-start
  //   step): B's value at zero elapsed time is not A's, so C transitions or reverses from it.
  const heldAtStart = (l: SlotListing | null): boolean =>
    l !== null && l.mode === 'listed' && l.duration > 0 && l.delay >= 0
    && !(l.easing.kind === 'steps' && (l.easing.position === 'jump-start' || l.easing.position === 'jump-both' || l.easing.position === 'start'));
  const reveals = (c: AnimCase, b: number): boolean =>
    c.ap.rendered.some((r) => (r.values[b] === true) !== (r.values[c.sp.initial] === true) && c.ap.slots.some((s) => s.node === r.node))
    || c.ap.slots.some((s) => JSON.stringify(s.values[b]) !== JSON.stringify(s.values[c.sp.initial]) && !heldAtStart(s.listings[b] ?? null));
  it('A to B to C at zero elapsed time gives the frames of A to C, for every pair of assignments of every fixture', () => {
    let checked = 0;
    let excluded = 0;
    for (const c of cases) {
      const target = (i: number) => c.sp.states.map((s) => ({ state: s.key, value: (c.sp.assignments[i]?.assignment.find((a) => stateKey(a.state.instance, a.state.state) === s.key) as { value: unknown }).value as never }));
      const n = c.sp.assignments.length;
      for (let b = 0; b < n; b++) for (let k = 0; k < n; k++) {
        if (b === k) continue;
        if (reveals(c, b)) {
          excluded++;
          continue;
        }
        checked++;
        const twice = simulator(c);
        twice.set(target(b));
        twice.set(target(k));
        const once = simulator(c);
        once.set(target(k));
        for (const ms of [0, 125, 400]) {
          twice.animator.advance(ms);
          once.animator.advance(ms);
          // The rendered outcome: a zero-length transition holding the static value counts as no transition.
          expect(canonicalJsonText(twice.animator.program(twice.rt.program())), `${c.id} ${b}->${k} +${ms}`).toBe(canonicalJsonText(once.animator.program(once.rt.program())));
        }
      }
    }
    console.log(`R4: ${checked} triples checked, ${excluded} excluded`);
    expect(checked).toBeGreaterThan(excluded);
  });
});

describe('host frame lanes (R18)', () => {
  it('equal Chrome at every sample, DPR and direction, with chrome-dual and the settle rule', () => {
    const r = animReport();
    expect(r.failures.slice(0, 20)).toEqual([]);
    expect(r.passingCases.length).toBe(cases.length);
    console.log(`anim-report: ${r.cases} cases, ${r.samples} samples, ${r.values} values, ${r.boxes} boxes, ${r.dual} chrome-dual, ${r.settles} settles`);
  }, 600_000);

  const plants: readonly (readonly [string, Partial<AnimFaults>, Partial<rtEasing.RtFaults>])[] = [
    ['anim-branch', { transitionOnFirstStyle: true }, {}],
    ['anim-display-none', { displayNoneKeepsTransition: true }, {}],
    ['anim-color-all', { inheritedNotPropagated: true }, {}],
    ['anim-keyframes', { neutralKeyframeStale: true }, {}],
    ['anim-play-state', {}, { pauseLosesPhase: true }],
    ['anim-play-state', {}, { pauseClockRuns: true }],
    ['anim-name-change', {}, { nameChangeKeepsAnimation: true }],
    ['anim-reverse', {}, { noReversalShortening: true }],
    ['anim-keyframes', {}, { perKeyframeEasingIgnored: true }],
    ['anim-overshoot', {}, { nonNegativeUnclamped: true }],
  ];
  for (const [id, anim, rt] of plants) {
    it(`${Object.keys({ ...anim, ...rt }).join(', ')} fails ${id}'s frame lanes`, () => {
      const r = animCaseReport(byFixture(id), [1], { ...rtEasing.NO_RT_FAULTS, ...rt }, { ...NO_ANIM_FAULTS, ...anim });
      expect(r.failures.length).toBeGreaterThan(0);
    });
  }

  it('runs a frame script without a fault to the same dumps every time (the virtual driver uses no wall clock)', () => {
    const c = byFixture('motion-grid');
    const s = frameScript(c);
    const a = runFrameScript(c, s).map((d) => [...d.frame].map(([k, v]) => `${k}=${show(v)}`).join(' '));
    expect(runFrameScript(c, s).map((d) => [...d.frame].map(([k, v]) => `${k}=${show(v)}`).join(' '))).toEqual(a);
  });
});

// The parity.test.ts row checks (M1, M2/M3, the report links), for the animation rows, whose proofs are frame cases: parity.test.ts
// checks the layout rows only (its layoutRows), so each check it applies to a layout row is applied here to an animation row.
describe('animation rows (profile:rows from the frame lanes)', () => {
  const report = animReport();
  const passing = cases.filter((c) => report.passingCases.includes(c.id)).map((c) => ({ id: c.id, features: animationFeatures(c.compiled) }));
  const rowsOf = (rows: readonly { readonly context: string }[]) => rows.filter((r) => r.context === ANIMATION_CONTEXT);

  it('are exactly what profile:rows derives from the passing frame cases, per target (iOS and Android none until device-anim, 3b)', () => {
    expect(rowsOf(webProfile.rows)).toEqual(deriveAnimationRows('web', passing));
    expect(rowsOf(iosProfile.rows)).toEqual(deriveAnimationRows('ios', passing));
    expect(rowsOf(androidProfile.rows)).toEqual(deriveAnimationRows('android', passing));
    expect(rowsOf(iosProfile.rows)).toEqual([]);
    expect(rowsOf(androidProfile.rows)).toEqual([]);
  }, 600_000);

  it('name exactly the passing frame cases that use their key, and every key a passing frame case uses has a row (M1)', () => {
    const rows = webProfile.rows.filter((r) => r.context === ANIMATION_CONTEXT);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.status, row.feature).toBe('exact');
      expect(row.proofs.length, row.feature).toBe(1);
      for (const proof of row.proofs) {
        expect([proof.aspect, proof.lane, proof.valueSubset, proof.context], row.feature).toEqual(['computed-value', 'chrome-dual', row.feature.slice(row.feature.indexOf(':') + 1), ANIMATION_CONTEXT]);
        expect(proof.cases, row.feature).toEqual(passing.filter((c) => c.features.includes(row.feature)).map((c) => c.id));
        expect(proof.cases.length, row.feature).toBeGreaterThan(0);
      }
    }
    const keys = new Set(rows.map((r) => r.feature));
    for (const c of passing) for (const f of c.features) expect(keys.has(f), `${f} used by ${c.id} has no row`).toBe(true);
  }, 600_000);

  it('link every proof case to a frame case that passes its lanes at every DPR and direction (the report links)', () => {
    const ids = new Set(cases.map((c) => c.id));
    // An animation key has no direction facet: the values it proves are computed values, which do not depend on direction; the
    // boxes they move are compared per case, and the frame fixtures that move boxes run in both directions (anim-layout-margin).
    expect(cases.some((c) => c.direction === 'rtl')).toBe(true);
    for (const row of webProfile.rows.filter((r) => r.context === ANIMATION_CONTEXT)) {
      for (const id of row.proofs.flatMap((p) => p.cases)) {
        expect(ids.has(id), id).toBe(true);
        expect(report.passingCases.includes(id), id).toBe(true);
      }
    }
  }, 600_000);
});
