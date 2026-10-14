// A text line's deviceEdges on a device dump (native-support.ts dump): the line's content box, snapped from its LU edges like its
// left and right. Beside an atomic inline (INL2a) a line's content top below its line top need not be whole device px at a
// fractional DPR, so the earlier formula (the snapped line top plus that offset in device px) wrote 13.125-like tops that the
// dump encoders refuse (an integer field): the Android host crashed on atomic-inline-block at DPR 2.625 and lost every later
// case's dump. This holds the snapped formula to the engine's snapRect of every atomic-inline text line on both targets at every
// DPR, shows the earlier formula breaks there, and holds the emitted Swift and Kotlin to the snapped formula.
import { describe, expect, it } from 'vitest';
import type { LU } from '@dragon/layout';
import { LU_PER_PX, snapEdge } from '@dragon/layout';
import { emitNativeSupport, programInput } from 'dragon';
import { programOf } from '../src/device-lanes.ts';
import { DPRS } from '../src/dpr.ts';
import { engineTextLines } from '../src/line-breaks.ts';
import { validateNativeDump } from '../src/native-dump.ts';
import { referenceDump } from '../src/native-compare.ts';
import { engineBoxes, nativeCases, referenceMeasurer } from '../src/native-host.ts';

const ATOMIC = nativeCases().filter((n) => n.case.id.startsWith('atomic-inline-'));

/** Each text line of a case: the engine's snapped edges, and the dump's edges by the earlier and by the snapped formula. */
function lineEdges(id: string, target: 'ios' | 'android', dpr: number) {
  const n = ATOMIC.find((x) => x.case.id === id);
  if (n === undefined) throw new Error(`no case ${id}`);
  const texts = engineTextLines(programInput(programOf(n, target), n.case.environment.viewport, dpr), referenceMeasurer());
  return texts.flatMap((t) =>
    t.lines.map((l, j) => {
      const height = l.rect.height;
      // The view's top t cancels: the device places the view at its snapped top, so t * LU + (y - viewTop * LU) is y.
      const lineTop = snapEdge((l.rect.y - l.halfLeading) as LU);
      const earlier = { top: lineTop + l.halfLeading / LU_PER_PX, bottom: lineTop + (l.halfLeading + height) / LU_PER_PX };
      const snapped = { top: snapEdge(l.rect.y), bottom: snapEdge((l.rect.y + height) as LU) };
      return { line: `${t.id}:line${j}`, engine: { top: l.snapped.top, bottom: l.snapped.bottom }, earlier, snapped };
    }),
  );
}

describe('native dump: text line deviceEdges beside atomic inlines', () => {
  it('has atomic-inline cases to check', () => {
    expect(ATOMIC.map((n) => n.case.id)).toContain('atomic-inline-block');
  });
  it('the snapped formula equals the engine snapRect of every text line, both targets, every DPR', () => {
    let lines = 0;
    for (const n of ATOMIC) {
      for (const target of ['ios', 'android'] as const) {
        for (const dpr of [1, ...DPRS]) {
          for (const e of lineEdges(n.case.id, target, dpr)) {
            expect(e.snapped, `${n.case.id} ${target} @${dpr} ${e.line}`).toEqual(e.engine);
            lines++;
          }
        }
      }
    }
    expect(lines).toBeGreaterThan(0);
  });
  it('the earlier formula gives atomic-inline-block a non-integer line top at DPR 2.625, which the dump schema refuses', () => {
    const bad = lineEdges('atomic-inline-block', 'android', 2.625).filter((e) => !Number.isInteger(e.earlier.top) || !Number.isInteger(e.earlier.bottom));
    expect(bad.length).toBeGreaterThan(0);
    const first = bad[0] as (typeof bad)[number];
    // A reference dump with that line top in place: the validator names it not-integer, as the encoders refuse to write it.
    const n = ATOMIC.find((x) => x.case.id === 'atomic-inline-block');
    if (n === undefined) throw new Error('no atomic-inline-block');
    const p = programOf(n, 'android');
    const viewport = n.case.environment.viewport;
    const dump = referenceDump({ platform: 'android', caseId: n.case.id, fixture: n.spec.id, dpr: 2.625, direction: n.case.environment.direction, compilerDigest: n.compiled.digest, input: programInput(p, viewport, 2.625), engine: engineBoxes(p, viewport, 2.625) });
    expect(validateNativeDump(JSON.parse(JSON.stringify(dump))).ok).toBe(true);
    const node = dump.nodes.find((x) => x.lines.length > 0 && x.kind === 'text');
    if (node === undefined) throw new Error('no node with lines');
    const planted = { ...dump, nodes: dump.nodes.map((x) => (x === node ? { ...x, lines: x.lines.map((l, j) => (j === 0 ? { ...l, deviceEdges: { ...l.deviceEdges, top: first.earlier.top } } : l)) } : x)) };
    const v = validateNativeDump(JSON.parse(JSON.stringify(planted)));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.errors.map((x) => `${x.path} ${x.code}`)).toContainEqual(expect.stringMatching(/deviceEdges\.top not-integer$/));
  });
  it('the emitted Swift and Kotlin dumps snap each text line top and bottom from LU', () => {
    const swift = emitNativeSupport('uikit').map((f) => f.text).join('\n');
    const kotlin = emitNativeSupport('android-views').map((f) => f.text).join('\n');
    expect(swift).toContain('let top = try! units_snapEdge(t * units_LU_PER_PX + m.topsLU[k])');
    expect(swift).toContain('let bottom = try! units_snapEdge(t * units_LU_PER_PX + m.topsLU[k] + (m.ascent + m.descent) * units_LU_PER_PX)');
    expect(kotlin).toContain('val top = units_snapEdge(t * units_LU_PER_PX + m[2 + k])');
    expect(kotlin).toContain('val bottom = units_snapEdge(t * units_LU_PER_PX + m[2 + k] + (m[0] + m[1]) * units_LU_PER_PX)');
    expect(swift).not.toContain('halfLeadings[k]');
    expect(kotlin).not.toContain('x.top + m[2 + k]');
  });
});
