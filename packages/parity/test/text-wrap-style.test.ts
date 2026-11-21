// TXT-TW: the engine's lines of text-wrap-balance-ahem (fixture group text-wrap), as the compiler lowers it for the native targets,
// at DPR 1 and every DPR lane, in both directions. The expected lines are the ones Blink 145's score pass or bisection picks (layout
// text-wrap.test.ts pins the port); text-wrap-balance.test.ts checks them against a live Chrome. No Chrome runs here.
import { describe, expect, it } from 'vitest';
import type { LayoutBox } from '@dragon/layout';
import { NO_ENGINE_FAULTS, zoomInput } from '@dragon/layout';
import { engineLayoutProjection, NO_FAULTS } from 'dragon';
import { DPRS, layoutCases } from '../src/dpr.ts';
import { compileFixture } from '../src/pipeline.ts';
import { CHANGED, engineLines, EXPECTED, ID } from './text-wrap-lines.ts';

describe('TXT-TW: text-wrap-balance-ahem in the engine', () => {
  it('lowers balance and pretty at zoom 1, and the environment pass zooms them by the device pixel ratio', () => {
    const f = layoutCases().find((x) => x.spec.id === ID) as NonNullable<ReturnType<typeof layoutCases>[number]>;
    const c = f.cases[0] as NonNullable<(typeof f.cases)[number]>;
    const p = engineLayoutProjection(compileFixture(f.spec, NO_FAULTS, 'derive').compiled, c.environment, c.assignment);
    if (p.kind !== 'ready') throw new Error(p.reason);
    const styles = (root: LayoutBox): Record<string, unknown> => {
      const out: Record<string, unknown> = {};
      const walk = (b: LayoutBox): void => {
        out[b.id] = b.style.textWrapStyle;
        for (const k of b.children) if (k.kind === 'box') walk(k);
      };
      walk(root);
      return out;
    };
    const at1 = styles(p.input.root);
    expect(at1['b1']).toEqual({ kind: 'balance', zoom: 1 });
    expect(at1['b8']).toEqual({ kind: 'balance', zoom: 1 });
    expect(at1['p1']).toEqual({ kind: 'pretty', zoom: 1 });
    expect(at1['p5']).toEqual({ kind: 'pretty', zoom: 1 });
    expect(at1['row']).toEqual({ kind: 'auto' });
    expect(styles(zoomInput({ ...p.input, devicePixelRatio: 2.625 }, NO_ENGINE_FAULTS).root)['b4']).toEqual({ kind: 'balance', zoom: 2.625 });
  });

  it('lays out every block as Blink picks its lines, in both directions at DPR 1 and every DPR lane', () => {
    for (const direction of ['ltr', 'rtl'] as const) {
      for (const dpr of [1, ...DPRS]) expect(engineLines(direction, dpr), `${direction} ${dpr}`).toEqual(EXPECTED);
    }
  });

  it('planted fault wrapStyleGreedy changes the lines of every block whose lines are not the greedy ones', () => {
    const planted = engineLines('ltr', 1, { ...NO_ENGINE_FAULTS, wrapStyleGreedy: true });
    const changed = Object.keys(EXPECTED).filter((id) => JSON.stringify(planted[id]) !== JSON.stringify(EXPECTED[id]));
    expect(changed.sort()).toEqual([...CHANGED].sort());
  });
});
