// The per-fault planted files (planted.ts) together run every FAULTS fault on both targets, once each: a fault missing a file,
// a file naming a fault twice or a file whose name disagrees with its call fails here, so splitting can never drop a fault.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FAULTS } from '../src/faults.ts';

const DIR = dirname(fileURLToPath(import.meta.url));
const CALL = /^plantedFaultTest\('(swift|kotlin)', '([a-z0-9-]+)'\);$/m;

describe('planted fault files', () => {
  it('cover FAULTS on swift and kotlin exactly once each, one (target, fault) per file named after it', () => {
    const files = readdirSync(DIR).filter((f) => /^planted-(swift|kotlin)-.+\.test\.ts$/.test(f)).sort();
    const pairs = files.map((f) => {
      const text = readFileSync(`${DIR}/${f}`, 'utf8');
      const m = CALL.exec(text);
      expect(m, `${f} calls plantedFaultTest once`).not.toBeNull();
      expect(text.match(/plantedFaultTest\(/g)?.length, `${f} calls plantedFaultTest once`).toBe(1);
      const pair = `${m?.[1]} ${m?.[2]}`;
      expect(f, pair).toBe(`planted-${m?.[1]}-${m?.[2]}.test.ts`);
      return pair;
    });
    const want = ['swift', 'kotlin'].flatMap((t) => FAULTS.map((f) => `${t} ${f.id}`));
    expect(pairs.slice().sort()).toEqual(want.slice().sort());
  });
});
