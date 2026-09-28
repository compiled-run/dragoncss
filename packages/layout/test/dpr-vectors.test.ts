// DPR vectors (vectors/README.md "Device pixel ratios"): packages/layout/vectors/dpr-<N>/<case>.json, written only by
// pnpm run layout:dpr-vectors from the committed DPR captures. The engine must reproduce each exactly, and the milestone-1 platform
// checks hold for the new folders.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { layout, measurerFor, validateLayoutInput } from '../src/index.ts';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'vectors');
const topLevel = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
const DPRS = [2, 3, 2.625];

type VectorFile = { platform: string; measurer: string; input: { devicePixelRatio: number; root: unknown }; output: unknown };

describe('DPR vectors', () => {
  it('the DPR folders hold exactly the DPR sets 2, 3 and 2.625 (the Android extra), each with a snap folder', () => {
    expect(readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()).toEqual(['dpr-2', 'dpr-2.625', 'dpr-3']);
    for (const d of DPRS) expect(readdirSync(join(dir, `dpr-${d}`), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)).toEqual(['snap']);
  });

  for (const dpr of DPRS) {
    const sub = join(dir, `dpr-${dpr}`);
    const files = readdirSync(sub).filter((f) => f.endsWith('.json')).sort();
    it(`DPR ${dpr}: the same ${topLevel.length} case ids as the DPR-1 vectors, and the same ids in its snap folder`, () => {
      expect(files).toEqual(topLevel);
      expect(files.length).toBe(267);
      expect(readdirSync(join(sub, 'snap')).filter((f) => f.endsWith('.json')).sort()).toEqual(topLevel);
    });
    it(`DPR ${dpr}: every vector names darwin-arm64 and ahem/darwin-arm64, passes the validator at devicePixelRatio ${dpr}, and the engine reproduces it exactly`, () => {
      const m = measurerFor('darwin-arm64');
      if (m.kind !== 'ok') throw new Error(m.code);
      for (const f of files) {
        const v = JSON.parse(readFileSync(join(sub, f), 'utf8')) as VectorFile;
        expect([Object.keys(v), v.platform, v.measurer, v.input.devicePixelRatio], f).toEqual([['platform', 'measurer', 'input', 'output'], 'darwin-arm64', 'ahem/darwin-arm64', dpr]);
        const valid = validateLayoutInput(v.input);
        if (!valid.ok) throw new Error(`${f}: ${JSON.stringify(valid.errors)}`);
        const r = layout(valid.input, m.measurer);
        if (r.kind !== 'ok') throw new Error(`${f}: ${r.unsupported.code}`);
        expect(r.boxes, f).toEqual(v.output);
      }
    });
    it(`DPR ${dpr}: the input is the DPR-1 vector input with only devicePixelRatio changed (the compiler does not depend on the ratio)`, () => {
      for (const f of files) {
        const v = JSON.parse(readFileSync(join(sub, f), 'utf8')) as VectorFile;
        const base = JSON.parse(readFileSync(join(dir, f), 'utf8')) as VectorFile;
        expect({ ...v.input, devicePixelRatio: 1 }, f).toEqual(base.input);
      }
    });
    it(`DPR ${dpr}: no file names a platform or a platform default font (notes/T033-linux-lane.md)`, () => {
      expect(readdirSync(sub).filter((f) => /linux/i.test(f))).toEqual([]);
      for (const f of files) expect(readFileSync(join(sub, f), 'utf8'), f).not.toMatch(/Times|linux/);
    });
  }
});
