// The Chrome comparison of a Markless style export (packages/parity/src/markless-style-compare.ts): a box only one side has fails,
// as in native-compare.ts, so a node Chrome or the export drops cannot pass by not being compared.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compareMarklessExport } from '../src/markless-style-compare.ts';
import type { MarklessStyleInput } from '../src/markless-style-input.ts';
import { marklessStyleExport, parseMarklessStyleInput } from '../src/markless-style-input.ts';
import type { NativeStyleExport } from '../src/native-style-export.ts';
import { repoPath } from '../src/paths.ts';

const PATH = 'examples/markless-styles/input/attributes.native-style-input.json';
const TEXT = readFileSync(repoPath(PATH), 'utf8');
const input = parseMarklessStyleInput(TEXT);
const full = marklessStyleExport(TEXT, PATH).exported;
const ios = full.targets.ios;
if (ios === undefined) throw new Error('no ios target');
const exported: NativeStyleExport = { ...full, targets: { ios } };

describe('compareMarklessExport', () => {
  it('compares every box of the attributes rung within the gate', async () => {
    const r = await compareMarklessExport(input, exported);
    expect(r.rows.filter((x) => !x.pass)).toEqual([]);
    expect(r.failed).toBe(0);
    expect(r.compared).toBe(r.rows.length);
    expect(r.compared).toBeGreaterThan(0);
  }, 60_000);

  it('fails a box only Chrome or only the export has', async () => {
    // Chrome lays out no box for h2 or its text; the export drops h1:text0, gives h3:text0 no frame and adds a node Chrome lacks.
    const hidden: MarklessStyleInput = { ...input, nodes: input.nodes.map((n) => (n.kind === 'element' && n.id === 'h2' ? { ...n, attributes: { ...n.attributes, style: 'display: none' } } : n)) };
    const edited: NativeStyleExport = {
      ...exported,
      targets: {
        ios: {
          ...ios,
          assignments: ios.assignments.map((a) => ({
            ...a,
            nodes: [
              ...a.nodes.filter((n) => n.id !== 'h1:text0').map((n) => (n.id === 'h3:text0' ? { ...n, frame: null } : n)),
              { id: 'ghost', parent: 'h0', kind: 'element', native: 'view', text: null, frame: { x: 0, y: 0, width: 3, height: 3 }, borderWidths: null, writes: [] },
            ],
          })),
        },
      },
    };
    const r = await compareMarklessExport(hidden, edited);
    const problems = r.rows.flatMap((x) => (x.problem === undefined ? [] : [`${JSON.stringify(x.values)} ${x.id}: ${x.problem}`]));
    const want = (liked: boolean): string[] => [
      `h1:text0: Chrome has a box but the export has no node`,
      `h2: Chrome generates no box but the export has a frame`,
      `h2:text0: Chrome generates no box but the export has a frame`,
      `h3:text0: Chrome has a box but the export has no frame`,
      `ghost: the export has a framed node Chrome does not have`,
    ].map((p) => `${JSON.stringify({ 'state:liked': liked })} ${p}`);
    expect(problems.sort()).toEqual([...want(false), ...want(true)].sort());
    expect(r.rows.every((x) => x.problem === undefined || (!x.pass && x.maxDeltaDevicePx === null))).toBe(true);
    // Hiding h2 also moves the boxes after it, which fail as measured rows.
    expect(r.failed).toBe(10 + r.rows.filter((x) => x.problem === undefined && !x.pass).length);
    expect(r.compared).toBe(r.rows.length - 10);
  }, 60_000);
});
