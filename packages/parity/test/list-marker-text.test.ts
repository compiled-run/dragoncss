// GEN-c text markers on the native lanes' host references: the engine's "<li>::marker:text0" fragment is a text node with one line
// of its whole counter text (line-breaks.ts engineTextLines, as DragonTree.apply places it), its marker box a node without lines,
// and the TS engine reference dump names both (native-compare.ts referenceDump), on the list-markers-text fixture.
import { describe, expect, it } from 'vitest';
import { layout, measurerFor } from '@dragon/layout';
import { nativePrograms, programInput } from 'dragon';
import { casesOf, fixtureInput } from '../src/cases.ts';
import { FIXTURES } from '../src/fixtures.ts';
import { breakVector, engineTextLines, leafTexts } from '../src/line-breaks.ts';
import { checkAgainstEngine, referenceDump } from '../src/native-compare.ts';
import { nativeCompileOnce } from '../src/native-compile.ts';

const m = measurerFor('darwin-arm64');
if (m.kind !== 'ok') throw new Error(m.code);
const spec = FIXTURES.find((f) => f.id === 'list-markers-text');
if (spec === undefined) throw new Error('list-markers-text is not registered');
const c = casesOf(spec, fixtureInput(spec))[0];
if (c === undefined) throw new Error('no case');
const p = nativePrograms(nativeCompileOnce(spec, c.environment.direction), c.assignment);
if (p.kind !== 'ready') throw new Error(p.reason);
const program = p.programs.uikit;

describe('list-markers-text on the host references', () => {
  it('gives each text marker one line of its whole text at its fragment, and its box no lines, at every DPR', () => {
    for (const dpr of [1, 2, 2.625, 3]) {
      const input = programInput(program, c.environment.viewport, dpr);
      const texts = engineTextLines(input, m.measurer);
      const d1 = texts.find((t) => t.id === 'd1::marker:text0');
      expect(d1, String(dpr)).toMatchObject({ container: 'd1::marker', lines: [{ start: 0, end: 3, cps: [0x31, 0x2e, 0x20], shifts: [], ellipsis: null, fragments: [[0, 3]] }] });
      expect(texts.some((t) => t.id === 'd1::marker'), String(dpr)).toBe(false);
      const vector = breakVector(c.id, dpr, texts).texts;
      expect(vector.find((t) => t.id === 'r1::marker:text0')?.lines, String(dpr)).toEqual([[0, 5]]);
      expect(vector.find((t) => t.id === 's1::marker:text0')?.lines, String(dpr)).toEqual([[0, 3]]);
    }
    const leaves = leafTexts(program.root);
    expect([leaves.get('d2::marker:text0'), leaves.get('a2::marker:text0'), leaves.get('r1::marker:text0'), leaves.get('s1::marker:text0')]).toEqual(['2. ', 'b. ', 'III. ', '>> ']);
  });

  it('names the marker box an element node and its text a text node in the TS engine reference dump, which equals snapRect of the engine', () => {
    const input = programInput(program, c.environment.viewport, 2);
    const out = layout(input, m.measurer);
    if (out.kind !== 'ok') throw new Error('refused');
    const dump = referenceDump({ platform: 'ios', caseId: c.id, fixture: spec.id, dpr: 2, direction: 'ltr', compilerDigest: 'd', input, engine: out.boxes });
    const node = (id: string) => dump.nodes.find((n) => n.id === id);
    expect([node('d1::marker')?.kind, node('d1::marker')?.lines.length]).toEqual(['element', 0]);
    expect([node('d1::marker:text0')?.kind, node('d1::marker:text0')?.parent, node('d1::marker:text0')?.lines.length]).toEqual(['text', 'd1::marker', 1]);
    expect(checkAgainstEngine(dump, out.boxes).problems).toEqual([]);
  });
});
