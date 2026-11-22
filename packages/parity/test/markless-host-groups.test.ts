// A see-through group in the Markless export: the hosts draw it without cc's per-tile fold (Dragon's DragonGroupView ported), so the
// export holds only groups cc never folds on any tiling, and refuses the rest by name.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { marklessStyleExport } from '../src/markless-style-input.ts';
import { repoPath } from '../src/paths.ts';

const PATH = 'examples/markless-styles/input/arms.native-style-input.json';
const TEXT = readFileSync(repoPath(PATH), 'utf8');
const withCss = (css: string): string => JSON.stringify({ ...JSON.parse(TEXT), css: `${JSON.parse(TEXT).css}\n${css}` });

describe('see-through groups in the Markless export', () => {
  it('exports a pressed button (a fill, a border and text, scaled) as an opacity-group write and a transform write', () => {
    const { exported } = marklessStyleExport(withCss('.toggle.mk-gf91et { opacity: 0.85; transform: scale(0.97); }'), PATH);
    for (const t of ['ios', 'android'] as const) {
      const writes = exported.targets[t]!.assignments[0]!.nodes.find((n) => n.id === 'h3')!.writes;
      expect(writes.filter((w) => w['kind'] === 'opacity-group' || w['kind'] === 'transform').map((w) => w['kind']), t).toEqual(['opacity-group', 'transform']);
    }
  });

  it('exports a group whose own box draws nothing (text alone never folds)', () => {
    expect(() => marklessStyleExport(withCss('.heading.mk-gf91et { opacity: 0.5; }'), PATH)).not.toThrow();
  });

  it('refuses a group whose own box is one draw op, or that holds a box of one draw op, which cc may fold', () => {
    expect(() => marklessStyleExport(withCss('.details.mk-gf91et { opacity: 0.5; }'), PATH)).toThrow('h4 is a see-through group whose own box is one draw op, which cc may fold; the hosts draw no per-tile fold');
    expect(() => marklessStyleExport(withCss('.details.mk-gf91et { opacity: 0.5; filter: grayscale(1); }'), PATH)).toThrow('h4 is a see-through group whose own box is one draw op, which cc may fold; the hosts draw no per-tile fold');
    expect(() => marklessStyleExport(withCss('.order.mk-gf91et { opacity: 0.5; border: 1px solid #000; }'), PATH)).toThrow('inside the see-through group h0 is one draw op, which cc may fold; the hosts draw no per-tile fold');
  });
});
