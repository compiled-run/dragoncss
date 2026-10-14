// TXT2-h (notes/T149-txt2-spec.md R12) against the pinned Chrome's committed captures: the engine indents the first formatted line
// as Chrome does on every text-indent case in both directions at DPR 1, 2, 3 and 2.625, and each of the four engine plants is caught
// by a Chrome case. No Chrome runs here.
import { describe, expect, it } from 'vitest';
import type { EngineFaults } from '@dragon/layout';
import { NO_ENGINE_FAULTS } from '@dragon/layout';
import { NO_FAULTS } from 'dragon';
import type { DprCaseOutcome } from '../src/dpr.ts';
import { committedDprCapture, DPRS, layoutCases, runDprCase } from '../src/dpr.ts';
import { TEXT_INDENT } from '../src/fixture-groups/text-indent.ts';
import { compileFixture } from '../src/pipeline.ts';

// The Ahem cases lower natively, so the DPR lane judges them here; text-indent-latin is shaped and judged by the FIXTURES lanes.
const corpus = layoutCases().filter((f) => f.spec.id === 'text-indent-ahem');
const compiledFor = (direction: 'ltr' | 'rtl') => compileFixture(corpus[0]!.spec, NO_FAULTS, 'enforce', direction).compiled;
const compiled = { ltr: compiledFor('ltr'), rtl: compiledFor('rtl') };

/** Every case's outcome at DPR 1 and every DPR lane, with the given engine faults. */
function outcomes(faults: EngineFaults): DprCaseOutcome[] {
  return corpus.flatMap((f) => f.cases.flatMap((c) => [1, ...DPRS].map((dpr) => runDprCase(c, compiled[c.environment.direction], dpr, committedDprCapture(c.id, dpr), faults))));
}

const failing = (faults: EngineFaults): string[] => outcomes(faults).filter((o) => o.status === 'fail').map((o) => `${o.id}@${o.dpr}`);

describe('TXT2-h: text-indent against Chrome 145', () => {
  it('covers the group\'s two layout fixtures, and compiles text-indent-ahem in ltr and rtl with no error', () => {
    expect(TEXT_INDENT.filter((f) => f.kind === 'layout').map((f) => f.id)).toEqual(['text-indent-ahem', 'text-indent-latin']);
    expect(corpus.map((f) => f.cases.map((c) => c.id))).toEqual([['text-indent-ahem', 'text-indent-ahem-rtl']]);
    for (const [direction, c] of Object.entries(compiled)) expect(c.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message), direction).toEqual([]);
  });

  it('the engine lays out every case as Chrome does', () => {
    const all = outcomes(NO_ENGINE_FAULTS);
    expect(all.filter((o) => o.status === 'fail').map((o) => `${o.id}@${o.dpr}: ${o.reason}`)).toEqual([]);
    // Chrome starts the first line at the indent and the line after the <br> at the content edge.
    const capture = committedDprCapture('text-indent-ahem', 1);
    const node = (id: string) => capture.nodes.find((n) => n.id === id);
    expect((node('a1:text0:line0')?.x ?? 0) - (node('a1')?.x ?? 0)).toBe(25);
    expect((node('a6:text1:line0')?.x ?? 0) - (node('a6')?.x ?? 0)).toBe(0);
  });

  it('the planted faults indentEveryLine, indentAfterBr, indentPercentInIntrinsic and indentRtlFromLeft are caught', () => {
    expect(failing({ ...NO_ENGINE_FAULTS, indentEveryLine: true })).toContain('text-indent-ahem@1');
    expect(failing({ ...NO_ENGINE_FAULTS, indentAfterBr: true })).toContain('text-indent-ahem@1');
    expect(failing({ ...NO_ENGINE_FAULTS, indentPercentInIntrinsic: true })).toContain('text-indent-ahem@1');
    expect(failing({ ...NO_ENGINE_FAULTS, indentRtlFromLeft: true })).toContain('text-indent-ahem-rtl@1');
  });
});
