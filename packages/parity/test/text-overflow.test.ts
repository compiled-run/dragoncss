// TXT2-f (notes/T149-txt2-spec.md R9 and R10) against the pinned Chrome's committed captures: the engine's truncated fragments
// equal Chrome's text rects on every text-overflow case at DPR 1, 2, 3 and 2.625, the two engine plants Chrome can see are caught,
// and the compiler refuses on native the inline styles its text views cannot give the ellipsis. No Chrome runs here.
import { describe, expect, it } from 'vitest';
import type { EngineFaults } from '@dragon/layout';
import { NO_ENGINE_FAULTS } from '@dragon/layout';
import { ANDROID_MIN_SDK, createProjectWith, nativePrograms, NO_FAULTS } from 'dragon';
import { casesOf, fixtureInput } from '../src/cases.ts';
import type { DprCaseOutcome } from '../src/dpr.ts';
import { committedDprCapture, DPRS, layoutCases, runDprCase } from '../src/dpr.ts';
import { fixtureToInput, PROJECT_ID } from '../src/fixture-reader.ts';
import { TEXT_OVERFLOW } from '../src/fixture-groups/text-overflow.ts';
import { ENVIRONMENT, FIXTURE_GROUPS } from '../src/fixtures.ts';
import { NATIVE_CONFIG } from '../src/native-compile.ts';
import { uprightGlyphLines } from '../src/pixel-reference.ts';
import { compileFixture } from '../src/pipeline.ts';
import { REFERENCE_PLATFORM } from '../src/platform.ts';

const own = new Set(TEXT_OVERFLOW.filter((f) => f.kind === 'layout').map((f) => f.id));
const corpus = layoutCases().filter((f) => own.has(f.spec.id));
const compiled = new Map(corpus.map((f) => [f.spec.id, compileFixture(f.spec, NO_FAULTS, 'enforce').compiled]));

/** Every case's outcome at DPR 1 and every DPR lane, with the given engine faults. */
function outcomes(faults: EngineFaults): DprCaseOutcome[] {
  return corpus.flatMap((f) => f.cases.flatMap((c) => [1, ...DPRS].map((dpr) => runDprCase(c, compiled.get(f.spec.id) as NonNullable<ReturnType<typeof compiled.get>>, dpr, committedDprCapture(c.id, dpr), faults))));
}

const failing = (faults: EngineFaults): string[] => outcomes(faults).filter((o) => o.status === 'fail').map((o) => `${o.id}@${o.dpr}`);

describe('TXT2-f: text-overflow: ellipsis against Chrome 145', () => {
  it('covers the four layout fixtures in the ltr environment (text-overflow-rtl sets direction: rtl itself), each compiled with no error', () => {
    expect([...own].sort()).toEqual(['text-overflow-blocks', 'text-overflow-fonts', 'text-overflow-lines', 'text-overflow-rtl']);
    expect(corpus.map((f) => f.cases.length)).toEqual([1, 1, 1, 1]);
    for (const [id, c] of compiled) expect(c.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message), id).toEqual([]);
  });

  it('the engine lays out every case as Chrome does, the full and the truncated fragment of each cut text included', () => {
    const all = outcomes(NO_ENGINE_FAULTS);
    expect(all.filter((o) => o.status === 'fail').map((o) => `${o.id}@${o.dpr}: ${o.reason}`)).toEqual([]);
    // A truncated text reports its whole run, then what is painted: two rects on one line.
    const capture = committedDprCapture('text-overflow-lines', 1);
    const line = (id: string) => capture.nodes.find((n) => n.id === id);
    expect(line('a1:text0:line1')?.y).toBe(line('a1:text0:line0')?.y);
    expect(line('a3:text0:line1')).toBeUndefined();
    // In rtl the truncated part keeps the text's end, at its right edge, and the ellipsis is on its left.
    const rtl = committedDprCapture('text-overflow-rtl', 1);
    const right = (id: string): number => {
      const n = rtl.nodes.find((x) => x.id === id);
      if (n === undefined) throw new Error(`no ${id} in the text-overflow-rtl capture`);
      return n.x + n.width;
    };
    expect(right('r1:text0:line1')).toBe(right('r1:text0:line0'));
  });

  it('the pixel reference draws an rtl truncated text where Chrome paints it: its kept end at the right edge, the ellipsis on its left', () => {
    const spec = FIXTURE_GROUPS.flatMap((g) => g.fixtures).find((f) => f.id === 'text-overflow-rtl');
    if (spec === undefined) throw new Error('no text-overflow-rtl fixture');
    const project = createProjectWith({ projectId: PROJECT_ID, targets: { ...NATIVE_CONFIG } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr', platform: REFERENCE_PLATFORM, rootFont: 'ahem', foldViewport: ENVIRONMENT.viewport, interactionLanes: true });
    const c = casesOf(spec, fixtureInput(spec))[0];
    if (c === undefined) throw new Error('text-overflow-rtl has no case');
    const programs = nativePrograms(project.compile(fixtureInput(spec)), c.assignment);
    if (programs.kind !== 'ready') throw new Error(programs.reason);
    for (const p of [programs.programs.uikit, programs.programs['android-views']]) {
      const glyphs = (id: string): number[][] => {
        const line = uprightGlyphLines(p, ENVIRONMENT.viewport, 1).find((l) => l.id === `${id}:text0:line0`);
        if (line === undefined) throw new Error(`no line for ${id}`);
        return line.glyphs.map((g) => [g.left, g.right]);
      };
      // r1 (XX XX XX XX in 55px): Chrome paints "X XX" at 15..55 and the ellipsis at 5..15.
      expect(glyphs('r1')).toEqual([[15, 25], [35, 45], [45, 55], [5, 15]]);
      // r13 (XXXXXX in 55px): four X at 15..55, the ellipsis at 5..15.
      expect(glyphs('r13')).toEqual([[15, 25], [25, 35], [35, 45], [45, 55], [5, 15]]);
      // r7 (XXXX in 15px): one X at 5..15, the ellipsis over the left edge at -5..5.
      expect(glyphs('r7')).toEqual([[5, 15], [-5, 5]]);
    }
  });

  it('planted faults ellipsisInTextFont and truncateChangesBlockSize are caught', () => {
    expect(failing({ ...NO_ENGINE_FAULTS, ellipsisInTextFont: true })).toContain('text-overflow-fonts@1');
    expect(failing({ ...NO_ENGINE_FAULTS, truncateChangesBlockSize: true })).toContain('text-overflow-lines@1');
  });
});

describe('TXT2-f: what the native text views cannot draw is refused there, not on the web', () => {
  const project = createProjectWith(
    { projectId: PROJECT_ID, targets: { web: {}, ios: { minimum: '15.0' }, android: { minSdk: ANDROID_MIN_SDK.min } } },
    { faults: NO_FAULTS, profiles: 'derive', direction: ENVIRONMENT.direction, platform: REFERENCE_PLATFORM, rootFont: ENVIRONMENT.rootFont },
  );
  const refused = (span: string): string[] => {
    const html = `<!DOCTYPE html>\n<html data-dragon-id="html"><head><style>\nbody{margin:0;font-family:Ahem;font-size:10px}.t{overflow:hidden;white-space:nowrap;text-overflow:ellipsis;width:55px}${span}</style></head><body data-dragon-id="body"><div data-dragon-id="t" class="t">XX<span data-dragon-id="s" class="s">XXXXXXXX</span></div></body></html>\n`;
    return project.compile(fixtureToInput('probe', html)).diagnostics.filter((d) => d.severity === 'error').map((d) => `${d.target ?? '*'} ${d.code}`).sort();
  };

  it('an inline box in another colour is refused on ios and android; one in another size is drawn', () => {
    expect(refused('.s{color:#c00}')).toEqual(['android DRAGON_UNSUPPORTED_VALUE', 'ios DRAGON_UNSUPPORTED_VALUE']);
    expect(refused('.s{font-size:5px}')).toEqual([]);
    expect(refused('.s{}')).toEqual([]);
  });
});
