// SELD-R2 PR 4 (notes/T064-seld-r2-spec.md R14): the device-traces lane's host side: the reference lines, the record evaluator on
// fake records, the planted runtime faults it must catch, and the generated machine sources.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { InteractionFaults } from '@dragon/layout';
import { rtInteraction } from '@dragon/layout';
import { emitNativeSupport, TRACE_LINE } from 'dragon';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { groupHit, interactionGroups, levelInputs } from '../src/interaction-cases.ts';
import { deviceTraceSources, evaluateTraces, MAX_TRACE_STEPS, traceFile, traceReference, traceReferenceFor, traceScriptCuts, traceScriptIds } from '../src/trace-lane.ts';

const plant = (name: keyof InteractionFaults): InteractionFaults => ({ ...rtInteraction.NO_INTERACTION_FAULTS, [name]: true });
// Made in beforeAll: `vitest list` runs module scope but no hooks, so a module-scope folder would leak.
let dir = '';
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'dragon-traces-'));
});
afterAll(() => {
  if (dir !== '') rmSync(dir, { recursive: true, force: true });
});

/** Writes a fake device record of every script at a scale, lines from lineOf. */
function writeRecords(scale: number, lineOf: (id: string) => readonly string[], at: string = dir): void {
  for (const id of traceScriptIds()) writeFileSync(traceFile(at, id, scale), lineOf(id).map((l) => `${l}\n`).join(''));
}

describe('device-traces, host side (SELD-R2 PR 4)', () => {
  it('has a script per interaction group, each reference line well formed and numbered from 0, none cut', () => {
    const ids = traceScriptIds();
    expect(ids).toEqual(expect.arrayContaining(['interaction-hover~trace', 'interaction-hover-rtl~trace', 'interaction-combo~trace']));
    expect(new Set(ids).size).toBe(ids.length);
    expect(traceScriptCuts()).toEqual([]);
    for (const id of ids) {
      const lines = traceReference(id, 1);
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.length).toBeLessThanOrEqual(MAX_TRACE_STEPS);
      lines.forEach((l, i) => {
        expect(l).toMatch(TRACE_LINE);
        expect(l.split('\t')[0]).toBe(String(i));
      });
      // Some step leaves a hover chain and some an active chain, so the record is not trivially all none.
      expect(lines.some((l) => l.split('\t')[3] !== '-')).toBe(true);
      expect(lines.some((l) => l.split('\t')[4] !== '-')).toBe(true);
    }
  }, 600_000);

  it('gives the same reference on the android-views program as on the uikit one', () => {
    for (const id of traceScriptIds()) for (const dpr of [1, 2.625]) expect(traceReferenceFor(id, 'android', dpr)).toEqual(traceReference(id, dpr));
  }, 600_000);

  it('passes a record equal to the reference and fails a missing, cut, malformed or differing one', () => {
    writeRecords(2, (id) => traceReference(id, 2));
    expect(evaluateTraces(dir, 2)).toEqual({ passed: traceScriptIds().length, failed: 0, details: [] });
    const ids = traceScriptIds();
    const [a, b, c, d] = ids as [string, string, string, string];
    expect(evaluateTraces(dir, 3).failed).toBe(ids.length);
    expect(evaluateTraces(dir, 3).details[0]).toContain('no trace record');
    writeRecords(2.625, (id) => {
      const r = traceReference(id, 2.625);
      if (id === a) return r.slice(0, -1);
      if (id === b) return [...r.slice(0, -1), 'garbage'];
      if (id === c) return r.map((l, i) => (i === 1 ? l.replace(/\t-?\d+$/, '\t7') : l));
      return r;
    });
    if (d !== undefined) writeFileSync(traceFile(dir, d, 2.625), traceReference(d, 2.625).join('\n'));
    const r = evaluateTraces(dir, 2.625);
    expect(r.failed).toBe(4);
    expect(r.details.join('\n')).toMatch(/lines for/);
    expect(r.details.join('\n')).toMatch(/malformed/);
    expect(r.details.join('\n')).toMatch(/first at trace 1/);
    expect(r.details.join('\n')).toMatch(/newline/);
  }, 600_000);

  it('hit tests the reference at the record\'s DPR: a point on a fractional device px edge hits as the device machine does', () => {
    // interaction-combo's point (2, 30) is on c's bottom edge; at 2.625 that is 78.75 device px, inside c's text rect snapped to
    // device px (53 to 79), so the hit is c (table index 4) where DPR 1 gives d (5). The Android device recorded exactly this.
    for (const id of ['interaction-combo~trace', 'interaction-combo-rtl~trace']) {
      const one = traceReference(id, 1);
      const frac = traceReference(id, 2.625);
      expect(frac.length).toBe(one.length);
      const differ = frac.map((l, i) => (l === one[i] ? -1 : i)).filter((i) => i >= 0);
      expect(differ.length).toBe(11);
      expect(differ[0]).toBe(70);
      expect(one[70]).toBe('70\t0\t-1\t0,1,5\t-\t-1\t-1');
      expect(frac[70]).toBe('70\t0\t-1\t0,1,4\t-\t-1\t-1');
    }
    // At the shared ratios every CSS px edge of the fixtures is a whole device px, so the references equal DPR 1's.
    for (const id of traceScriptIds()) for (const dpr of [2, 3]) expect(traceReference(id, dpr)).toEqual(traceReference(id, 1));
    // A DPR-1 record fails at 2.625, and the 2.625 reference passes.
    const at = join(dir, 'fractional');
    mkdirSync(at);
    writeRecords(2.625, (id) => traceReference(id, 1), at);
    const stale = evaluateTraces(at, 2.625);
    expect(stale.failed).toBe(2);
    expect(stale.details.join('\n')).toContain('first at trace 70 (after a move step)');
    writeRecords(2.625, (id) => traceReference(id, 2.625), at);
    expect(evaluateTraces(at, 2.625)).toEqual({ passed: traceScriptIds().length, failed: 0, details: [] });
    const g = interactionGroups()[0];
    if (g === undefined) throw new Error('no interaction group');
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => groupHit(g, levelInputs(g, 'uikit'), bad)).toThrow(/not a positive number/);
  }, 600_000);

  // The runtime plants the compiled fixtures can show (interaction-runtime.test.ts names why the others need FORM-a).
  for (const name of ['tapSetsHover', 'hoverWithoutAncestors', 'forcedSetsAncestors', 'focusOnNonFocusable', 'activeWithoutAncestors', 'activeStaysAfterRelease', 'hoverExitOnPress'] as const) {
    it(`fails a record from a runtime with the ${name} plant`, () => {
      const at = join(dir, name);
      mkdirSync(at);
      // A planted runtime that throws stops the device app before it writes the record, so the script has none.
      for (const id of traceScriptIds()) {
        let lines: string[] | null = null;
        try {
          lines = traceReferenceFor(id, 'ios', 2, plant(name));
        } catch {
          lines = null;
        }
        if (lines !== null) writeFileSync(traceFile(at, id, 2), lines.map((l) => `${l}\n`).join(''));
      }
      expect(evaluateTraces(at, 2).failed).toBeGreaterThan(0);
    }, 600_000);
  }

  it('emits the machine, the scripts and the case table with the API the glue calls', () => {
    const swift = [...emitNativeSupport('uikit'), ...deviceTraceSources('ios')];
    const kotlin = [...emitNativeSupport('android-views'), ...deviceTraceSources('android')];
    const text = (files: typeof swift, path: string): string => {
      const f = files.find((x) => x.path === path);
      if (f === undefined) throw new Error(`no ${path}`);
      return f.text;
    };
    const ss = text(swift, 'Support/DragonInteraction.swift');
    for (const api of ['public final class DragonInteractionMachine', 'public func pointerMoved(_ x: Double, _ y: Double)', 'public func pointerExited()', 'public func hoverExitStarted()', 'public func frame()', 'public func mousePressed(_ x: Double, _ y: Double)', 'public func mouseReleased()', 'public func touchPressed(_ x: Double, _ y: Double)', 'public func touchReleased(_ x: Double, _ y: Double)', 'public func touchCancelled()', 'public func keyPressed(_ modified: Bool)', 'public func forcePseudo(kind: String, element: Int)', 'public func set(state: String, value: String)', 'public var onChange: (() -> Void)?', 'public var onInteractionChange: ((Int, Int, Int, Int) -> Void)?', 'public func traceLine() -> String', 'public func build(_ t: DragonTree)', 'public func input(_ dpr: Double) -> LayoutInput', 'public func attach(_ measurer: TextMeasurer, scale: Double)', 'public let make: () -> DragonInteractionMachine', 'public func run(_ m: DragonInteractionMachine, pointer: DragonPointerInput) -> [String]', 'rtInteraction_layoutChanged', 'rtInteraction_remapPointer', 'rtHit_hitTableOf']) expect(ss).toContain(api);
    const ks = text(kotlin, 'kotlin/dev/dragon/views/DragonInteraction.kt');
    for (const api of ['class DragonInteractionMachine(', 'fun pointerMoved(x: Double, y: Double)', 'fun pointerExited()', 'fun hoverExitStarted()', 'fun frame()', 'fun mousePressed(x: Double, y: Double)', 'fun mouseReleased()', 'fun touchPressed(x: Double, y: Double)', 'fun touchReleased(x: Double, y: Double)', 'fun touchCancelled()', 'fun keyPressed(modified: Boolean)', 'fun forcePseudo(kind: String, element: Int)', 'fun set(state: String, value: String)', 'var onChange: (() -> Unit)?', 'var onInteractionChange: ((Int, Int, Int, Int) -> Unit)?', 'fun traceLine(): String', 'fun build(t: DragonTree)', 'fun input(dpr: Double): LayoutInput', 'fun attach(measurer: TextMeasurer, scale: Double)', 'val make: () -> DragonInteractionMachine', 'fun run(m: DragonInteractionMachine, pointer: DragonPointerInput): List<String>']) expect(ks).toContain(api);
    expect(text(swift, 'Cases/DragonInteractionCaseTable.swift')).toContain('public let dragonInteractionCaseTable: [String: DragonInteractionScript]');
    expect(text(kotlin, 'kotlin/dev/dragon/cases/DragonInteractionCaseTable.kt')).toContain('val dragonInteractionCaseTable: Map<String, DragonInteractionScript>');
    for (const id of traceScriptIds()) {
      expect(swift.some((f) => f.path.startsWith('Cases/DragonInteractions') && f.text.includes(`id: "${id}"`))).toBe(true);
      expect(kotlin.some((f) => f.path.startsWith('kotlin/dev/dragon/cases/DragonInteractions') && f.text.includes(`"${id}"`))).toBe(true);
    }
    // A planted device runtime carries its fault into every emitted machine.
    expect(deviceTraceSources('ios', plant('tapSetsHover')).find((f) => f.path === 'Cases/DragonInteractions000.swift')?.text).toContain('InteractionFaults(true, false');
  }, 600_000);
});
