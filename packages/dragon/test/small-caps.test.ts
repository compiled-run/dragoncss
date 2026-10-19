// TXT-FONTFEAT small caps in the compiler (analysis/computed.ts synthesizesSmallCaps, analysis/small-caps.ts): font-variant-caps:
// small-caps over Ahem lowers each text it reaches with smallCaps, which the engine lays out as Chrome synthesizes it; with
// font-synthesis-small-caps: none Chrome draws the face's own lowercase, so the text is lowered without. What no Chrome case proves is
// refused: a real face, spacing, preserved white space, justification and truncation on every target, and on native a synthetic bold
// or oblique, a decoration, a shadow or a transform. The planted fault smallCapsUnsynthesized lowers no text with smallCaps. Chrome's
// pixels are packages/parity/test/text-font-variant-caps-ahem.test.ts.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { LayoutBox } from '@dragon/layout';
import type { ElementNode, FontMap, FrontEndResult, Origin, SourceRef, TreeNode } from '../src/index.ts';
import type { CompilerFaults } from '../src/faults.ts';
import { ANDROID_MIN_SDK, createProjectWith, iosLayoutProjection, NO_FAULTS } from '../src/internal.ts';
import { DOC, inputFor, staticClass, text } from './helpers.ts';

const ENV = { viewport: { width: 400, height: 300 }, devicePixelRatio: 1, direction: 'ltr', rootFont: 'ua-default' } as const;

function el(ref: SourceRef, id: string, tag: string, classes: string[] = [], children: TreeNode[] = []): ElementNode {
  const origin: Origin = { kind: 'authored', span: { source: ref, start: 0, end: 0 } };
  return { kind: 'element', id, tag, classes: classes.map((name) => staticClass({ owner: DOC, sheet: 's', name }, origin)), attributes: [], children, origin };
}

const vendor = (file: string): Uint8Array => new Uint8Array(readFileSync(new URL(`../../../vendor/fonts/${file}`, import.meta.url)));
const LATO = vendor('Lato/Lato-Regular.ttf');
const MAP: FontMap = { generics: {}, families: { Lato: { mode: 'pinned', family: 'Lato', faces: [{ src: 'fonts/Lato-Regular.ttf', weight: '400' }] } } } as unknown as FontMap;
const withLato = (base: FrontEndResult): FrontEndResult => ({
  ...base,
  snapshot: { ...base.snapshot, assets: [{ id: 'fonts/Lato-Regular.ttf', hash: `sha256:${createHash('sha256').update(LATO).digest('hex')}`, bytes: LATO }] },
});

/** A div d (class w) holding a span s (class i) between two texts. */
const TREE = (r: SourceRef): TreeNode[] => [el(r, 'd', 'div', ['w'], [text(r, 't0', 'Ab '), el(r, 's', 'span', ['i'], [text(r, 't1', 'cd')]), text(r, 't2', ' ef')])];

function compile(css: string, faults: CompilerFaults = NO_FAULTS, android = false) {
  const targets = android ? { ios: { minimum: '15.0' }, android: { minSdk: ANDROID_MIN_SDK.min }, web: {} } : { ios: { minimum: '15.0' }, web: {} };
  return createProjectWith({ projectId: 'test', targets, fonts: MAP } as Parameters<typeof createProjectWith>[0], { faults, profiles: 'derive', direction: 'ltr' }).compile(withLato(inputFor(`body { font-family: Ahem; font-size: 10px; } ${css}`, TREE)));
}

/** Each lowered text leaf as `id:smallCaps`. */
function lowered(css: string, faults: CompilerFaults = NO_FAULTS): string[] {
  const compiled = compile(css, faults);
  expect(compiled.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message)).toEqual([]);
  const p = iosLayoutProjection(compiled, ENV, []);
  if (p.kind !== 'ready') throw new Error(`projection blocked: ${p.reason}`);
  const out: string[] = [];
  const inline = (c: Exclude<LayoutBox['children'][number], LayoutBox>): void => {
    if (c.kind === 'text') out.push(`${c.id}:${String(c.smallCaps)}`);
    else if (c.kind === 'inline') for (const k of c.children) inline(k);
  };
  const walk = (b: LayoutBox): void => {
    for (const c of b.children) {
      if (c.kind === 'box') walk(c);
      else inline(c);
    }
  };
  walk(p.input.root);
  return out;
}

/** The small-caps refusals, as sorted `code target`, and the first message. */
function refused(css: string, android = false): { readonly codes: string[]; readonly message: string | undefined } {
  const ds = compile(css, NO_FAULTS, android).diagnostics.filter((d) => d.severity === 'error' && d.message.startsWith('font-variant-caps: small-caps reaches'));
  return { codes: ds.map((d) => `${d.code} ${String(d.target)}`).sort(), message: ds[0]?.message };
}

describe('small caps (TXT-FONTFEAT)', () => {
  it('lowers the texts small-caps reaches with smallCaps, through font-variant-caps, font-variant, font and inheritance', () => {
    expect(lowered('')).toEqual(['d:text0:false', 's:text0:false', 'd:text1:false']);
    expect(lowered('.w { font-variant-caps: small-caps; }')).toEqual(['d:text0:true', 's:text0:true', 'd:text1:true']);
    expect(lowered('.i { font-variant: small-caps; }')).toEqual(['d:text0:false', 's:text0:true', 'd:text1:false']);
    expect(lowered('.w { font: small-caps 10px Ahem; } .i { font-variant-caps: normal; }')).toEqual(['d:text0:true', 's:text0:false', 'd:text1:true']);
  });
  it('lowers without smallCaps where font-synthesis turns small caps off, and the smallCapsUnsynthesized plant lowers none', () => {
    expect(lowered('.w { font-variant-caps: small-caps; font-synthesis-small-caps: none; }')).toEqual(['d:text0:false', 's:text0:false', 'd:text1:false']);
    expect(lowered('.w { font-variant-caps: small-caps; font-synthesis: none; }')).toEqual(['d:text0:false', 's:text0:false', 'd:text1:false']);
    expect(lowered('.w { font-variant-caps: small-caps; font-synthesis: small-caps; }')).toEqual(['d:text0:true', 's:text0:true', 'd:text1:true']);
    expect(lowered('.w { font-variant-caps: small-caps; }', { ...NO_FAULTS, smallCapsUnsynthesized: true })).toEqual(['d:text0:false', 's:text0:false', 'd:text1:false']);
  });
  it('refuses on every target what the engine does not lay out with small capitals', () => {
    const every = ['DRAGON_UNSUPPORTED_VALUE ios', 'DRAGON_UNSUPPORTED_VALUE web'];
    expect(refused('.i { font-variant-caps: small-caps; font-family: Lato; }')).toEqual({ codes: every, message: 'font-variant-caps: small-caps reaches text s:text0, and it is drawn in a real face, which may have its own small capitals (smcp); Dragon synthesizes them over Ahem only' });
    // font-synthesis: none synthesizes nothing, but Chrome still draws a real face's own smcp, so the real face stays refused.
    expect(refused('.i { font-variant-caps: small-caps; font-family: Lato; font-synthesis: none; }')).toEqual({ codes: every, message: 'font-variant-caps: small-caps reaches text s:text0, and it is drawn in a real face, which may have its own small capitals (smcp); Dragon synthesizes them over Ahem only' });
    expect(refused('.i { font-variant-caps: small-caps; font-synthesis-small-caps: none; }').codes).toEqual([]);
    expect(refused('.i { font-variant-caps: small-caps; letter-spacing: 1px; }').codes).toEqual(every);
    expect(refused('.i { font-variant-caps: small-caps; word-spacing: 2px; }').codes).toEqual(every);
    expect(refused('.i { font-variant-caps: small-caps; white-space: pre; }').codes).toEqual(every);
    expect(refused('.w { text-align: justify; } .i { font-variant-caps: small-caps; }')).toEqual({ codes: every, message: 'font-variant-caps: small-caps reaches text s:text0, and its block d is justified, which Dragon does not lay out with small capitals yet' });
    expect(refused('.w { overflow: hidden; text-overflow: ellipsis; } .i { font-variant-caps: small-caps; }').codes).toEqual(every);
  });
  it('refuses on native alone what the native views do not draw with small capitals', () => {
    const native = ['DRAGON_UNSUPPORTED_VALUE android', 'DRAGON_UNSUPPORTED_VALUE ios'];
    expect(refused('.i { font-variant-caps: small-caps; text-decoration: underline; }', true).codes).toEqual(native);
    expect(refused('.i { font-variant-caps: small-caps; text-shadow: 1px 1px red; }', true).codes).toEqual(native);
    expect(refused('.i { font-variant-caps: small-caps; text-transform: uppercase; }', true).codes).toEqual(native);
    expect(refused('.i { font-variant-caps: small-caps; font-weight: bold; }', true).codes).toEqual(['DRAGON_UNSUPPORTED_FONT android', 'DRAGON_UNSUPPORTED_FONT ios']);
    expect(refused('.i { font-variant-caps: small-caps; font-style: italic; }', true).codes).toEqual(['DRAGON_UNSUPPORTED_FONT android', 'DRAGON_UNSUPPORTED_FONT ios']);
    // Unsynthesized bold and oblique are Chrome's regular Ahem, which small caps draws.
    expect(refused('.i { font-variant-caps: small-caps; font-weight: bold; font-style: italic; font-synthesis: none; }', true).codes).toEqual([]);
  });
});
