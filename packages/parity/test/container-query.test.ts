// CQ: container-type: inline-size against the pinned Chrome's committed captures: the engine lays out every container-inline-size
// case as Chrome does at DPR 1, 2, 3 and 2.625, in both directions, and the two engine plants are caught. No Chrome runs here.
import { describe, expect, it } from 'vitest';
import type { EngineFaults } from '@dragon/layout';
import { NO_ENGINE_FAULTS } from '@dragon/layout';
import { NO_FAULTS } from 'dragon';
import type { DprCaseOutcome } from '../src/dpr.ts';
import { committedDprCapture, DPRS, layoutCases, runDprCase } from '../src/dpr.ts';
import { CONTAINER_QUERY } from '../src/fixture-groups/container-query.ts';
import { compileFixture } from '../src/pipeline.ts';

// cq-rules, the group's @container rules case, is checked by its resize lanes (container-rules.test.ts).
const own = new Set(CONTAINER_QUERY.filter((f) => f.kind === 'layout' && f.id !== 'cq-rules').map((f) => f.id));
const corpus = layoutCases().filter((f) => own.has(f.spec.id));
const compiled = new Map(corpus.map((f) => [f.spec.id, compileFixture(f.spec, NO_FAULTS, 'enforce').compiled]));

function outcomes(faults: EngineFaults): DprCaseOutcome[] {
  return corpus.flatMap((f) => f.cases.flatMap((c) => [1, ...DPRS].map((dpr) => runDprCase(c, compiled.get(f.spec.id) as NonNullable<ReturnType<typeof compiled.get>>, dpr, committedDprCapture(c.id, dpr), faults))));
}

const failing = (faults: EngineFaults): string[] => outcomes(faults).filter((o) => o.status === 'fail').map((o) => `${o.id}@${o.dpr}`);

describe('CQ: container-type: inline-size against Chrome 145', () => {
  it('covers container-inline-size in both directions, compiled with no error', () => {
    expect([...own]).toEqual(['container-inline-size']);
    expect(corpus.map((f) => f.cases.length)).toEqual([2]);
    for (const [id, c] of compiled) expect(c.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message), id).toEqual([]);
  });

  it('the engine lays out every case as Chrome does', () => {
    expect(outcomes(NO_ENGINE_FAULTS).filter((o) => o.status === 'fail').map((o) => `${o.id}@${o.dpr}: ${o.reason}`)).toEqual([]);
    // Chrome sizes the shrink-to-fit containers to their padding and border alone, and keeps flow-k's margin inside flow.
    const node = (id: string) => committedDprCapture('container-inline-size', 1).nodes.find((n) => n.id === id);
    expect([node('line-a')?.width, node('rel-a')?.width, node('row-a')?.width, node('grid-a')?.width, node('mc')?.width]).toEqual([6, 6, 6, 6, 6]);
    expect((node('flow-k')?.y as number) - (node('flow')?.y as number)).toBe(9);
  });

  it('planted faults containedContentSized and containerJoinsFlow are caught', () => {
    expect(failing({ ...NO_ENGINE_FAULTS, containedContentSized: true })).toContain('container-inline-size@1');
    expect(failing({ ...NO_ENGINE_FAULTS, containerJoinsFlow: true })).toContain('container-inline-size-rtl@1');
  });
});
