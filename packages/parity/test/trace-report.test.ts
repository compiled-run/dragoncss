// SELD-R2 R14 (notes/T064-seld-r2-spec.md R2, §4): the host trace lane. Chrome's effective trace, committed in
// packages/parity/expected-traces for every interaction group by the regen step trace-capture, must equal the TypeScript interaction
// runtime at every derived step (hover, focus and focus-visible gated; touch :active and keyboard steps recorded only), R2's style
// check must find no hover style after any touch step, and runtime plants must fail against Chrome. Until CI regen has committed
// the first captures the Chrome comparisons skip, naming why; once any capture exists every group must have a current one.
import { existsSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { rtInteraction } from '@dragon/layout';
import { CHROME_VERSION } from '../src/chrome.ts';
import type { ChromeTraceStep, TraceCapture } from '../src/trace-capture.ts';
import { committedTraces, compareTraces, effective, expectedTraceDir, expectedTracePath, gated, mismatchText, parseTraceCapture, stepsSha256, TRACE_CAPTURE_VERSION, traceCaptureJson, traceDerivation, traceGroups } from '../src/trace-capture.ts';

const groups = traceGroups();
const dir = expectedTraceDir();
const committed = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.trace.json')).sort() : [];
const PENDING = 'no Chrome trace is committed in packages/parity/expected-traces yet: CI regen (step trace-capture, pnpm run parity:trace-capture) writes them';

describe('the host trace lane (R14)', () => {
  it('derives one trace per interaction group and target, the same on every derivation', () => {
    expect(groups.length).toBeGreaterThan(0);
    for (const g of groups) for (const t of ['ios', 'android'] as const) {
      const a = traceDerivation(g, t);
      expect(a.steps.length, `${g.id} ${t}`).toBeGreaterThan(0);
      expect(stepsSha256(traceDerivation(g, t).steps), `${g.id} ${t}`).toBe(stepsSha256(a.steps));
    }
  });

  it('gates hover, focus and focus-visible at every pointer and forced step, and records touch :active and keyboard steps', () => {
    for (const k of ['move', 'exit', 'exit-start', 'frame', 'mouse-down', 'mouse-up', 'force', 'set'] as const) for (const d of ['hover', 'active', 'focus', 'focus-visible', 'style'] as const) expect(gated(k, d), `${k} ${d}`).toBe(true);
    for (const k of ['touch-down', 'touch-up', 'touch-cancel'] as const) {
      expect(gated(k, 'active'), k).toBe(false);
      for (const d of ['hover', 'focus', 'focus-visible', 'style'] as const) expect(gated(k, d), `${k} ${d}`).toBe(true);
    }
    for (const d of ['hover', 'active', 'focus', 'focus-visible'] as const) expect(gated('key', d)).toBe(false);
    const tap: ChromeTraceStep = { kind: 'touch-up', context: 'touch', hoverMedia: false, hover: ['html', 'body', 'a'], active: [], focus: [], focusVisible: [], style: [] };
    expect(effective(tap).hover).toEqual([]);
    expect(effective({ ...tap, kind: 'move', context: 'mouse', hoverMedia: true, style: null }).hover).toEqual(['html', 'body', 'a']);
  });

  it('refuses a malformed capture, one from another version, and one that misses a target', () => {
    const g = groups[0]!;
    const step: ChromeTraceStep = { kind: 'move', context: 'mouse', hoverMedia: true, hover: [], active: [], focus: [], focusVisible: [], style: null };
    const good: TraceCapture = { case: g.id, chrome: CHROME_VERSION, version: TRACE_CAPTURE_VERSION, viewport: { width: 1, height: 1 }, direction: 'ltr', runs: [{ targets: ['ios', 'android'], stepsSha256: 'x', steps: [step] }] };
    expect(parseTraceCapture(g.id, traceCaptureJson(good), 'p')).toEqual(good);
    const bad = (c: unknown): (() => TraceCapture) => () => parseTraceCapture(g.id, JSON.stringify(c), 'p');
    expect(() => parseTraceCapture(g.id, '{', 'p')).toThrow('not JSON');
    expect(bad({ ...good, version: 'dragon.trace-capture/0' })).toThrow('malformed');
    expect(bad({ ...good, runs: [{ ...good.runs[0], targets: ['ios'] }] })).toThrow('misses a target');
    expect(bad({ ...good, runs: [{ ...good.runs[0], steps: [{ ...step, style: [] }] }] })).toThrow('malformed');
    expect(bad({ ...good, runs: [{ ...good.runs[0], steps: [{ ...step, kind: 'touch-up', context: 'touch', style: null }] }] })).toThrow('malformed');
    expect(bad({ ...good, runs: [{ ...good.runs[0], steps: [{ ...step, hover: [1] }] }] })).toThrow('malformed');
  });

  it('has a current Chrome capture of every interaction group and none of another', (ctx) => {
    ctx.skip(committed.length === 0, PENDING);
    expect(committed).toEqual(groups.map((g) => expectedTracePath(g.id).slice(dir.length + 1)).sort());
    for (const g of groups) expect(compareTraces(g, committedTraces(g.id)).problems, g.id).toEqual([]);
  });

  it('equals Chrome\'s effective trace at every gated step, and the style check finds no hover style after a touch step', (ctx) => {
    ctx.skip(committed.length === 0, PENDING);
    let steps = 0;
    const failing: string[] = [];
    for (const g of groups) {
      const r = compareTraces(g, committedTraces(g.id));
      expect(r.problems, g.id).toEqual([]);
      steps += r.steps;
      failing.push(...r.mismatches.filter((m) => m.gated).map(mismatchText));
    }
    expect(failing).toEqual([]);
    expect(steps).toBeGreaterThan(0);
  });
});

describe('planted runtime faults against Chrome (R14, host half)', () => {
  const failing = (faults: Partial<typeof rtInteraction.NO_INTERACTION_FAULTS>): string[] =>
    groups.filter((g) => compareTraces(g, committedTraces(g.id), { ...rtInteraction.NO_INTERACTION_FAULTS, ...faults }).mismatches.some((m) => m.gated)).map((g) => g.id);
  for (const fault of ['tapSetsHover', 'hoverWithoutAncestors', 'activeWithoutAncestors', 'activeStaysAfterRelease', 'focusOnNonFocusable', 'forcedSetsAncestors'] as const) {
    it(`${fault} fails at least one group`, (ctx) => {
      ctx.skip(committed.length === 0, PENDING);
      expect(failing({ [fault]: true })).not.toEqual([]);
    });
  }
});
