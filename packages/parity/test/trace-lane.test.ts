// SELD-R2 PR 4 (notes/T064-seld-r2-spec.md R14): the device-traces lane's host side: the reference lines, the record evaluator on
// fake records, the planted runtime faults it must catch, and the generated machine sources.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { InteractionFaults } from '@dragon/layout';
import { rtInteraction } from '@dragon/layout';
import { emitNativeSupport, TRACE_LINE } from 'dragon';
import { afterAll, describe, expect, it } from 'vitest';
import { deviceTraceSources, evaluateTraces, MAX_TRACE_STEPS, traceFile, traceReference, traceReferenceFor, traceScriptCuts, traceScriptIds } from '../src/trace-lane.ts';

const plant = (name: keyof InteractionFaults): InteractionFaults => ({ ...rtInteraction.NO_INTERACTION_FAULTS, [name]: true });
const dir = mkdtempSync(join(tmpdir(), 'dragon-traces-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Writes a fake device record of every script at a scale, lines from lineOf. */
function writeRecords(scale: number, lineOf: (id: string) => readonly string[]): void {
  for (const id of traceScriptIds()) writeFileSync(traceFile(dir, id, scale), lineOf(id).map((l) => `${l}\n`).join(''));
}

describe('device-traces, host side (SELD-R2 PR 4)', () => {
  it('has a script per interaction group, each reference line well formed and numbered from 0, none cut', () => {
    const ids = traceScriptIds();
    expect(ids).toEqual(expect.arrayContaining(['interaction-hover~trace', 'interaction-hover-rtl~trace', 'interaction-combo~trace']));
    expect(new Set(ids).size).toBe(ids.length);
    expect(traceScriptCuts()).toEqual([]);
    for (const id of ids) {
      const lines = traceReference(id);
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
    for (const id of traceScriptIds()) expect(traceReferenceFor(id, 'android')).toEqual(traceReference(id));
  }, 600_000);

  it('passes a record equal to the reference and fails a missing, cut, malformed or differing one', () => {
    writeRecords(2, traceReference);
    expect(evaluateTraces(dir, 2)).toEqual({ passed: traceScriptIds().length, failed: 0, details: [] });
    const ids = traceScriptIds();
    const [a, b, c, d] = ids as [string, string, string, string];
    expect(evaluateTraces(dir, 3).failed).toBe(ids.length);
    expect(evaluateTraces(dir, 3).details[0]).toContain('no trace record');
    writeRecords(2.625, (id) => {
      const r = traceReference(id);
      if (id === a) return r.slice(0, -1);
      if (id === b) return [...r.slice(0, -1), 'garbage'];
      if (id === c) return r.map((l, i) => (i === 1 ? l.replace(/\t-?\d+$/, '\t7') : l));
      return r;
    });
    if (d !== undefined) writeFileSync(traceFile(dir, d, 2.625), traceReference(d).join('\n'));
    const r = evaluateTraces(dir, 2.625);
    expect(r.failed).toBe(4);
    expect(r.details.join('\n')).toMatch(/lines for/);
    expect(r.details.join('\n')).toMatch(/malformed/);
    expect(r.details.join('\n')).toMatch(/first at trace 1/);
    expect(r.details.join('\n')).toMatch(/newline/);
  }, 600_000);

  // The runtime plants the compiled fixtures can show (interaction-runtime.test.ts names why the others need FORM-a).
  for (const name of ['tapSetsHover', 'hoverWithoutAncestors', 'forcedSetsAncestors', 'focusOnNonFocusable', 'activeWithoutAncestors', 'activeStaysAfterRelease', 'hoverExitOnPress'] as const) {
    it(`fails a record from a runtime with the ${name} plant`, () => {
      const scale = 100 + name.length;
      // A planted runtime that throws stops the device app before it writes the record, so the script has none.
      for (const id of traceScriptIds()) {
        let lines: string[] | null = null;
        try {
          lines = traceReferenceFor(id, 'ios', plant(name));
        } catch {
          lines = null;
        }
        if (lines !== null) writeFileSync(traceFile(dir, id, scale), lines.map((l) => `${l}\n`).join(''));
      }
      expect(evaluateTraces(dir, scale).failed).toBeGreaterThan(0);
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
