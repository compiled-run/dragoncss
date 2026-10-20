// SELD-R2 PR 4 (notes/T064-seld-r2-spec.md R7, R12): the interaction tables and faults as typed literals of the translated engine.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { InteractionTables } from '@dragon/layout';
import { INTERACTION_FAULT_FIELDS, INTERACTION_TABLE_FIELDS, InteractionEmitError, interactionFaultsLit, interactionSupport, interactionTablesLit, TRACE_LINE, traceLineOf } from '../src/emit/runtime/interaction.ts';

const generated = fileURLToPath(new URL('../../layout/generated/', import.meta.url));
const swift = readFileSync(join(generated, 'swift/Sources/DragonLayout/RtInteraction.swift'), 'utf8');
const kotlin = readFileSync(join(generated, 'kotlin/src/main/kotlin/dev/dragon/layout/RtInteraction.kt'), 'utf8');

function swiftParams(cls: string): string[] {
  const at = swift.indexOf(`public final class ${cls} `);
  expect(at, cls).toBeGreaterThan(-1);
  const init = /public init\(([^)]*)\)/.exec(swift.slice(at));
  return (init?.[1] ?? '').split(', ').map((p) => /^_ ([A-Za-z0-9]+):/.exec(p)?.[1] ?? `?${p}`);
}

function kotlinParams(cls: string): string[] {
  const at = kotlin.indexOf(`class ${cls}(\n`);
  expect(at, cls).toBeGreaterThan(-1);
  const body = kotlin.slice(at, kotlin.indexOf('\n)', at));
  return [...body.matchAll(/^ {2}val ([A-Za-z0-9]+):/gm)].map((m) => m[1] as string);
}

const TABLES: InteractionTables = {
  parent: [-1, 0],
  focusable: [false, true],
  touchConsumesTap: [false, false],
  keyboardInput: [false, false],
  chainOf: [0, 1],
  activeChainOf: [0, 0],
  pointerFocusOf: [0, 1],
  keyboardFocusOf: [-1, 1],
  forcedHoverOf: [-1, 0],
  forcedActiveOf: [-1, -1],
  forcedFocusOf: [-1, 1],
  forcedFocusVisibleOf: [-1, -1],
  hoverValues: 2,
  activeValues: 1,
  focusValues: 2,
  combos: [-1, 1, 0, 1],
};

describe('SELD-R2 PR 4: the interaction tables as typed literals', () => {
  it('names the table and fault fields in the order of the generated Swift and Kotlin constructors', () => {
    expect(swiftParams('InteractionTables')).toEqual([...INTERACTION_TABLE_FIELDS]);
    expect(kotlinParams('InteractionTables')).toEqual([...INTERACTION_TABLE_FIELDS]);
    expect(swiftParams('InteractionFaults')).toEqual([...INTERACTION_FAULT_FIELDS]);
    expect(kotlinParams('InteractionFaults')).toEqual([...INTERACTION_FAULT_FIELDS]);
  });

  it('writes every table, and refuses a missing field or a value that is not an index', () => {
    expect(interactionTablesLit('swift', TABLES, 't')).toBe('InteractionTables(JsArray<Double>([-1.0, 0.0]), JsArray<Bool>([false, true]), JsArray<Bool>([false, false]), JsArray<Bool>([false, false]), JsArray<Double>([0.0, 1.0]), JsArray<Double>([0.0, 0.0]), JsArray<Double>([0.0, 1.0]), JsArray<Double>([-1.0, 1.0]), JsArray<Double>([-1.0, 0.0]), JsArray<Double>([-1.0, -1.0]), JsArray<Double>([-1.0, 1.0]), JsArray<Double>([-1.0, -1.0]), 2.0, 1.0, 2.0, JsArray<Double>([-1.0, 1.0, 0.0, 1.0]))');
    expect(interactionTablesLit('kotlin', TABLES, 't')).toContain('InteractionTables(jsArrayOf<Double>(-1.0, 0.0), jsArrayOf<Boolean>(false, true)');
    const { combos: _, ...missing } = TABLES;
    expect(() => interactionTablesLit('swift', missing as InteractionTables, 't')).toThrow(InteractionEmitError);
    expect(() => interactionTablesLit('swift', { ...TABLES, chainOf: [0, 0.5] }, 't')).toThrow(/chainOf\[1\]/);
    expect(() => interactionTablesLit('swift', { ...TABLES, hoverValues: 0 }, 't')).toThrow(/hoverValues/);
  });

  it('writes the faults all off by default and plants exactly the named one', () => {
    expect(interactionFaultsLit(null)).toBe(`InteractionFaults(${INTERACTION_FAULT_FIELDS.map(() => 'false').join(', ')})`);
    const planted = Object.fromEntries(INTERACTION_FAULT_FIELDS.map((f) => [f, f === 'hoverExitOnPress'])) as Record<(typeof INTERACTION_FAULT_FIELDS)[number], boolean>;
    expect(interactionFaultsLit(planted).endsWith(', true)')).toBe(true);
  });

  it('formats record lines in the shape the evaluator reads', () => {
    expect(traceLineOf(0, 1, -1, [], [], -1, -1)).toBe('0\t1\t-1\t-\t-\t-1\t-1');
    expect(traceLineOf(3, 0, 2, [0, 1, 4], [0], 4, -1)).toBe('3\t0\t2\t0,1,4\t0\t4\t-1');
    expect(TRACE_LINE.test('3\t0\t2\t0,1,4\t0\t4\t-1')).toBe(true);
    for (const bad of ['3\t0\t2\t0,,4\t0\t4\t-1', '3\t0\t-2\t-\t-\t-1\t-1', '3 0 2 - - -1 -1', '03\t0\t2\t-\t-\t-1\t-1']) expect(TRACE_LINE.test(bad), bad).toBe(false);
  });

  it('emits a support file per backend that runs the translated runtime', () => {
    const s = interactionSupport('uikit', () => '').text;
    const k = interactionSupport('android-views', () => '').text;
    for (const fn of ['interactionStart', 'pointerMoved', 'pointerExited', 'hoverExitStarted', 'interactionFrame', 'mousePressed', 'mouseReleased', 'touchPressed', 'touchReleased', 'touchCancelled', 'keyPressed', 'forcePseudo', 'remapPointer', 'layoutChanged', 'interactionState', 'hoverMatches', 'activeMatches', 'focusMatch', 'focusVisibleMatch', 'checkInteractionTables']) {
      expect(s).toContain(`rtInteraction_${fn}(`);
      expect(k).toContain(`rtInteraction_${fn}(`);
      expect(swift).toContain(`public func rtInteraction_${fn}(`);
      expect(kotlin).toContain(`fun rtInteraction_${fn}(`);
    }
  });
});
