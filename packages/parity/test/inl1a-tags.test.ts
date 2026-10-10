// T133 INL1a-tags (notes/T044-inl-spec.md R7, taken over by notes/T056-txt1a-spec.md R7): b, strong, em and i are accepted on web,
// and on native only where a real bundled face draws them; synthesis stays refused on native, and Ahem keeps its UA-font refusal.
import { describe, expect, it } from 'vitest';
import type { Compiled, Diagnostic, FrontEndResult } from 'dragon';
import * as dragon from 'dragon';
import { layout as engineLayout } from '@dragon/layout';
import { fixtureInput } from '../src/cases.ts';
import { layout } from '../src/fixture-groups/define.ts';
import { withFontMapAssets } from '../src/fixture-groups/fonts.ts';
import { FONT_REFERENCE_MAP } from '../src/font-reference.ts';
import { ENVIRONMENT } from '../src/fixtures.ts';
import { referenceShapedMeasurer } from '../src/text-shaper-host.ts';

const inputOf = (id: string): FrontEndResult => withFontMapAssets(fixtureInput(layout(id, ['ltr'], 'ahem')), FONT_REFERENCE_MAP);

/** nativeRealFaces: TXT1a-2 phase C's native lowering of real faces, off by default until phase R (InternalOptions.nativeRealFaces). */
function compile(input: FrontEndResult, nativeRealFaces = false): Compiled<'ios' | 'android' | 'web'> {
  const project = dragon.createProjectWith(
    { projectId: 'dragon-parity', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} }, fonts: FONT_REFERENCE_MAP },
    { faults: dragon.NO_FAULTS, profiles: 'derive', direction: 'ltr', platform: 'darwin-arm64', rootFont: 'ahem', foldViewport: ENVIRONMENT.viewport, nativeRealFaces },
  );
  return project.compile(input);
}

/** The input with each swap applied once, in document order, to the next element tagged `from`; asset bytes are kept as they are. */
function retag(input: FrontEndResult, swaps: readonly (readonly [from: string, to: string])[]): FrontEndResult {
  const left = swaps.map(([from, to]) => ({ from, to, done: false }));
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (typeof v !== 'object' || v === null || ArrayBuffer.isView(v)) return v;
    const o = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    const swap = o['kind'] === 'element' ? left.find((s) => !s.done && s.from === o['tag']) : undefined;
    if (swap !== undefined) {
      swap.done = true;
      o['tag'] = swap.to;
    }
    return o;
  };
  const out = walk(input) as FrontEndResult;
  if (left.some((s) => !s.done)) throw new Error('a tag to swap is not in the input');
  return out;
}

const errors = (c: Compiled<string>): Diagnostic[] => c.diagnostics.filter((d) => d.severity === 'error');
const listed = (c: Compiled<string>): string[] => errors(c).map((d) => `${String(d.target)} ${d.code}: ${d.message}`);

describe('b, strong, em and i on native where a real bundled face draws them', () => {
  it('inline-tags-faces is refused on ios and android until TXT1a-2 phase R, ready on web, and the engine lane lays it out', () => {
    const d = compile(inputOf('inline-tags-faces'));
    expect([d.outputs.ios.kind, d.outputs.android.kind, d.outputs.web.kind]).toEqual(['blocked', 'blocked', 'ready']);
    expect(new Set(errors(d).map((x) => `${x.target} ${x.code}`))).toEqual(new Set(['ios DRAGON_UNSUPPORTED_FONT', 'android DRAGON_UNSUPPORTED_FONT']));
    const e = dragon.engineLayoutProjection(d, ENVIRONMENT, []);
    if (e.kind !== 'ready') throw new Error(e.reason);
    expect(engineLayout(e.input, referenceShapedMeasurer()).kind).toBe('ok');
  });

  it('inline-tags-faces compiles on ios, android and web with no error under phase C\'s native lowering, and the engine lays it out', () => {
    const c = compile(inputOf('inline-tags-faces'), true);
    expect(listed(c)).toEqual([]);
    expect([c.outputs.ios.kind, c.outputs.android.kind, c.outputs.web.kind]).toEqual(['analysis-only', 'analysis-only', 'ready']);
    const p = dragon.nativeLayoutProjection(c, ENVIRONMENT, []);
    if (p.kind !== 'ready') throw new Error(p.reason);
    expect(dragon.engineLayoutProjection(c, ENVIRONMENT, [])).toEqual(p);
    expect(engineLayout(p.input, referenceShapedMeasurer()).kind).toBe('ok');
  });

  it('the same text without its tags lays out in fewer faces: the tags change the face the engine is given', () => {
    const tagged = inputOf('inline-tags-faces');
    const plain = retag(tagged, [['b', 'span'], ['b', 'span'], ['b', 'span'], ['strong', 'span'], ['strong', 'span'], ['em', 'span'], ['em', 'span'], ['em', 'span'], ['i', 'span']]);
    const faces = (input: FrontEndResult): number => {
      const p = dragon.engineLayoutProjection(compile(input), ENVIRONMENT, []);
      if (p.kind !== 'ready') throw new Error(p.reason);
      return new Set(JSON.stringify(p.input).match(/sha256:[0-9a-f]{64}/g)).size;
    };
    expect(faces(plain)).toBeLessThan(faces(tagged));
  });
});

describe('the refusals that stay', () => {
  it('em and i over Lato (no italic face) are synthetic oblique: refused on ios and android with DRAGON_SYNTHETIC_FONT_STYLE, ready on web', () => {
    const c = compile(inputOf('fonts-tags'));
    const synthetic = errors(c).filter((d) => d.code === 'DRAGON_SYNTHETIC_FONT_STYLE');
    expect(new Set(synthetic.map((d) => d.target))).toEqual(new Set(['ios', 'android']));
    expect(synthetic.some((d) => /^text em:text0 in Lato at font-weight 400 and font-style italic would be drawn in synthetic oblique/.test(d.message))).toBe(true);
    expect(synthetic.some((d) => /^text bi:text0 in Lato at font-weight 700 and font-style italic would be drawn in synthetic oblique/.test(d.message))).toBe(true);
    expect(errors(c).filter((d) => d.target === 'web' || d.target === null)).toEqual([]);
    expect(c.outputs.web.kind).toBe('ready');
    expect(c.outputs.ios.kind).toBe('blocked');
  });

  it('Ahem text in b, strong, em or i keeps the UA-font refusal on ios and android, naming the tag, and is ready on web', () => {
    for (const [tag, set] of [['b', 'font-weight: 700'], ['strong', 'font-weight: 700'], ['em', 'font-style: italic'], ['i', 'font-style: italic']] as const) {
      const c = compile(retag(inputOf('inline-tags'), [['span', tag]]));
      expect(listed(c), tag).toEqual([`android DRAGON_UNSUPPORTED_FONT: text s:text0 inherits ${set} from Chrome's user-agent stylesheet on <${tag}> s; android draws this text in its one regular face, where Chrome synthesizes the bold or oblique (Ahem's synthetic bold and oblique keep every glyph advance, so only the glyphs differ)`, `ios DRAGON_UNSUPPORTED_FONT: text s:text0 inherits ${set} from Chrome's user-agent stylesheet on <${tag}> s; ios draws this text in its one regular face, where Chrome synthesizes the bold or oblique (Ahem's synthetic bold and oblique keep every glyph advance, so only the glyphs differ)`]);
      expect(c.outputs.web.kind, tag).toBe('ready');
    }
  });

  it('a tag inside an ancestor whose UA row sets the same property is accepted since TXT-W1 (html.css specified values: b in h2 is 900)', () => {
    // Was refused by T133 (the captured computed rows held only under a normal parent); text-weight-nested-* are the Chrome cases.
    const nest = (outer: string, inner: string): string[] => {
      // inline-tags t1: <a t1a> holds <label t1l>; Ahem bold or italic text is refused on ios as DRAGON_UNSUPPORTED_FONT, not here.
      const input = retag(inputOf('inline-tags'), [['a', outer], ['label', inner]]);
      return errors(compile(input)).filter((d) => d.code === 'DRAGON_UNSUPPORTED_ELEMENT').map((d) => d.message);
    };
    for (const [outer, inner] of [['strong', 'b'], ['address', 'em'], ['h2', 'em'], ['b', 'i'], ['em', 'b']] as const) expect(nest(outer, inner), `${inner} in ${outer}`).toEqual([]);
    // Lato faces: no error under phase C's native lowering (off by default until TXT1a-2 phase R).
    const bold = compile(inputOf('text-weight-nested-bold'), true);
    expect(listed(bold)).toEqual([]);
  });
});
