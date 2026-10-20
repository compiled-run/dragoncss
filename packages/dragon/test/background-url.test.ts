// BG2-u part 1: background-image url() (notes/T074-bg2-spec.md R10). The value parses and computes to Chrome's url("...") on
// every target; images/compile.ts reads its source at build time from every resolved case and state (a data: URL anywhere, a src the
// images option maps only where the base is the document's: a <style> or style attribute), so a remote, unmapped or foreign-based
// src is DRAGON_REMOTE_IMAGE at its token, and bytes REPL-a cannot draw are DRAGON_UNSUPPORTED_IMAGE. Web compiles one url() layer
// at size auto with repeat or no-repeat and a px or % position; every other url() stack is refused on every target. The native
// targets refuse every url() layer until part 2; the parity lanes run it lane-only, and the lowering marks the box undrawn.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../src/index.ts';
import { createProjectWith, laneOnlyNative, NO_FAULTS, nativePrograms } from '../src/internal.ts';
import { GRADIENT_LOWERING } from '../src/lower/paint/gradient.ts';
import { ProgramError } from '../src/lower/paint/types.ts';
import type { FrontEndResult, SourceRef, Targets, TreeNode } from '../src/types.ts';
import { DOC, div, explainOne, expectCatalogued, inputFor, spanTextOf, staticClass } from './helpers.ts';

const ALL: Targets = { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} };
const WEB: Targets = { web: {} };
const BASE = 'body { margin: 0; } .a { width: 40px; height: 30px; } ';
// A 16x16 8-bit RGB PNG with four flat quadrants.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAJ0lEQVR42mO4o6GBFWkssMGKGEY10ESDhtsJrOjZPjmsaFQDTTQAACxeShC8sEsIAAAAAElFTkSuQmCC';
const PNG_BYTES = Buffer.from(PNG.slice(PNG.indexOf(',') + 1), 'base64');
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

const tree = (r: SourceRef): TreeNode[] => [div(r, 'a', ['a'], [div(r, 'b', ['b'])])];

type Options = { readonly targets?: Targets; readonly images?: Record<string, string>; readonly lanes?: boolean; readonly profiles?: 'derive' | 'enforce' };
function compileInput(input: FrontEndResult, o: Options = {}) {
  const config = { projectId: 'test', targets: o.targets ?? WEB, ...(o.images === undefined ? {} : { images: o.images }) };
  return createProjectWith(config, { faults: NO_FAULTS, profiles: o.profiles ?? 'derive', direction: 'ltr', ...(o.lanes === true ? { interactionLanes: true } : {}) }).compile(input);
}
/** The input with the PNG as snapshot asset img/a.png. */
const withAsset = (input: FrontEndResult): FrontEndResult => ({
  ...input,
  snapshot: { ...input.snapshot, assets: [{ id: 'img/a.png', hash: `sha256:${createHash('sha256').update(PNG_BYTES).digest('hex')}`, bytes: new Uint8Array(PNG_BYTES) }] },
});
/** The input with its stylesheet moved to a source of its own (a linked stylesheet), whose base is not the document's. */
function external(input: FrontEndResult): FrontEndResult {
  const doc = input.snapshot.sources[0];
  const tree = input.tree;
  const style = tree?.styles[0];
  if (doc === undefined || tree === null || style === undefined) throw new Error('no source');
  const ref: SourceRef = { uri: 'dragon-source://test/theme.css', revision: 'r1', hash: doc.ref.hash };
  return {
    ...input,
    snapshot: { ...input.snapshot, sources: [doc, { ref, text: doc.text, displayPath: 'theme.css' }] },
    tree: { ...tree, styles: [{ ...style, css: { ...style.css, source: ref } }] },
  };
}
const compile = (css: string, o: Options = {}) => compileInput(withAsset(inputFor(BASE + css, tree)), o);
const errors = (c: { diagnostics: readonly Diagnostic[] }): Diagnostic[] => c.diagnostics.filter((d) => d.severity === 'error');
const codes = (c: { diagnostics: readonly Diagnostic[] }): string[] => errors(c).map((d) => `${d.code}${d.target === null ? '' : ` [${d.target}]`}`);
const webCss = (c: ReturnType<typeof compile>): string => {
  const out = c.outputs.web;
  if (out.kind !== 'ready') throw new Error(`web not ready: ${codes(c).join(', ')}`);
  return out.files.map((f) => f.text).join('\n');
};

describe('background-image url() parses and computes as Chrome 145 serializes it (url("..."))', () => {
  const at = (css: string, node = 'a') => explainOne(compile(`.a { ${css} }`), 'web', node, 'background-image').value;
  it('in the longhand and the shorthand, in any ASCII case and quoting, with its escapes', () => {
    expect(at(`background-image: url(${PNG});`)).toBe(`url("${PNG}")`);
    expect(at(`background: URL('${PNG}') no-repeat 4px 50% #123456;`)).toBe(`url("${PNG}")`);
    expect(explainOne(compile('.a { background-image: url(a.png); }', { images: { 'a.png': 'img/a.png' } }), 'web', 'a', 'background-image').value).toBe('url("a.png")');
    expect(explainOne(compile('.a { background-image: url("a\\"b.png"); }', { images: { 'a"b.png': 'img/a.png' } }), 'web', 'a', 'background-image').value).toBe('url("a\\"b.png")');
  });
  it('a later declaration, the shorthand and inherit work on it; it is not inherited', () => {
    expect(at(`background-image: url(${PNG}); background: red;`)).toBe('none');
    expect(explainOne(compile(`.a { background-image: url(${PNG}); } .b { background-image: inherit; }`), 'web', 'b', 'background-image').value).toBe(`url("${PNG}")`);
    expect(explainOne(compile(`.a { background-image: url(${PNG}); }`), 'web', 'b', 'background-image').value).toBe('none');
  });
  it('web emits it unchanged with the layer longhands', () => {
    const c = compile(`.a { background: url(${PNG}) no-repeat 4px 25% #123456; }`);
    expect(codes(c)).toEqual([]);
    const css = webCss(c);
    expect(css).toContain(`background-image: url("${PNG}")`);
    expect(css).toContain('background-repeat: no-repeat');
  });
});

describe('the image source is read at build time (images/compile.ts)', () => {
  it('a data: URL compiles on web, in <style>, a linked stylesheet and through var()', () => {
    expect(codes(compile(`.a { background-image: url(${PNG}); }`))).toEqual([]);
    expect(codes(compileInput(withAsset(external(inputFor(`${BASE}.a { background-image: url(${PNG}); }`, tree)))))).toEqual([]);
    expect(codes(compile(`.a { --i: url(${PNG}); background-image: var(--i); }`))).toEqual([]);
  });
  it('a src the images option maps compiles where the base is the document', () => {
    expect(codes(compile('.a { background-image: url(a.png); }', { images: { 'a.png': 'img/a.png' } }))).toEqual([]);
  });
  it('web writes a mapped src as its data: URL, since dragon.css does not share the document base (landing review of #475)', () => {
    const images = { 'a.png': 'img/a.png', 'fonts/b.png': 'img/a.png' };
    const css = webCss(compile(`.a { background: red; } .a:hover { background: url("fonts/b.png") no-repeat 4px 25% red; } .b { background-image: url(a.png); } @media (min-width: 9000px) { .b { background-image: none; } .a { background-image: url(a.png); } }`, { images }));
    expect(css).toContain(`background-image: url("${PNG}")`);
    expect(css).not.toMatch(/url\("?(fonts\/b|a)\.png/);
    expect(css.match(/url\(/g)?.length).toBeGreaterThanOrEqual(3);
    expect(css.match(/url\(/g)?.length).toBe(css.match(/url\("data:image\/png;base64,/g)?.length);
    // The resolved value is the authored src; only the web text is rewritten.
    expect(explainOne(compile('.a { background-image: url(a.png); }', { images }), 'web', 'a', 'background-image').value).toBe('url("a.png")');
  });
  const remote = (c: ReturnType<typeof compile>, input: FrontEndResult, span: string, part: string): void => {
    const d = errors(c).find((x) => x.code === 'DRAGON_REMOTE_IMAGE');
    expect(d, codes(c).join(', ')).toBeDefined();
    expect(d?.target).toBeNull();
    expect(spanTextOf(input, d as Diagnostic)).toBe(span);
    expect(d?.message).toContain(part);
    expect(c.outputs.web.kind).toBe('blocked');
    expectCatalogued(c.diagnostics);
  };
  it('an unmapped or remote src is DRAGON_REMOTE_IMAGE at its url() token, blocking every target', () => {
    for (const [css, span, part] of [
      ['.a { background: url(a.png) red; }', 'url(a.png)', 'url() a.png is not mapped'],
      ['.a { background-image: url("https://example.com/a.png"); }', 'url("https://example.com/a.png")', 'is a remote URL'],
      ['.a { background-image: url(b.png); }', 'url(b.png)', 'url() b.png is not mapped'],
    ] as const) {
      const input = withAsset(inputFor(BASE + css, tree));
      remote(compileInput(input, { targets: ALL, images: css.includes('b.png') ? { 'a.png': 'img/a.png' } : {} }), input, span, part);
    }
  });
  it('a mapped src in a linked stylesheet is DRAGON_REMOTE_IMAGE naming the stylesheet, whose base is not the document', () => {
    const input = withAsset(external(inputFor(`${BASE}.a { background-image: url(a.png); }`, tree)));
    remote(compileInput(input, { images: { 'a.png': 'img/a.png' } }), input, 'url(a.png)', 'it is in the stylesheet dragon-source://test/theme.css, whose base is not the document');
  });
  it('inherit in a linked stylesheet takes the url() base of the parent, where Chrome resolves it (landing review of #475)', () => {
    // .a's url() is in the document's <style>; .b's rule is in the linked sheet theme.css.
    const linked = (child: string): FrontEndResult => {
      const input = inputFor(`${BASE}.a { background-image: url(a.png); }`, (r) => [div(r, 'a', ['a'], [{ ...div(r, 'b', []), classes: [staticClass({ owner: DOC, sheet: 's2', name: 'b' }, { kind: 'authored', span: { source: r, start: 0, end: 0 } })] }])]);
      const tree = input.tree;
      const doc = tree?.documents?.[0];
      if (tree === null || doc === undefined) throw new Error('no tree');
      const ref: SourceRef = { uri: 'dragon-source://test/theme.css', revision: 'r1', hash: `sha256:${createHash('sha256').update(child).digest('hex')}` };
      return {
        ...input,
        snapshot: { ...input.snapshot, sources: [...input.snapshot.sources, { ref, text: child, displayPath: 'theme.css' }] },
        tree: { ...tree, documents: [{ ...doc, styles: [...doc.styles, 's2'] }], styles: [...tree.styles, { id: 's2', css: { source: ref, start: 0, end: child.length }, scope: { kind: 'document' } }] },
      };
    };
    const images = { 'a.png': 'img/a.png' };
    const ok = compileInput(withAsset(linked('.b { width: 10px; height: 10px; background-image: inherit; }')), { images });
    expect(codes(ok)).toEqual([]);
    expect(explainOne(ok, 'web', 'b', 'background-image').value).toBe('url("a.png")');
    // The same src declared in the linked sheet itself is still refused there.
    const own = compileInput(withAsset(linked('.b { width: 10px; height: 10px; background-image: url(a.png); }')), { images });
    expect(errors(own).map((d) => d.message)).toEqual([expect.stringContaining('background-image on b: url() a.png is not read: it is in the stylesheet dragon-source://test/theme.css')]);
  });
  it('a mapped src through var() is DRAGON_REMOTE_IMAGE: the custom property sheet decides the base', () => {
    const c = compile('.a { --i: url(a.png); background-image: var(--i); }', { images: { 'a.png': 'img/a.png' } });
    expect(errors(c).map((d) => d.message)).toEqual([expect.stringContaining('it reaches background-image through var()')]);
  });
  it('a malformed data: URL and a JPEG are DRAGON_UNSUPPORTED_IMAGE', () => {
    const bad = compile('.a { background-image: url("data:image/png;base64"); }');
    expect(codes(bad)).toEqual(['DRAGON_UNSUPPORTED_IMAGE']);
    expect(errors(bad)[0]?.message).toContain('is a malformed data: URL');
    const jpeg = compile(`.a { background-image: url(${JPEG}); }`);
    expect(codes(jpeg)).toEqual(['DRAGON_UNSUPPORTED_IMAGE']);
    expect(errors(jpeg)[0]?.message).toContain('REPL-j');
  });
  it('every resolved state is read: an unmapped src only a :hover rule sets is refused', () => {
    const c = compile(`.a { background-image: url(${PNG}); } .a:hover { background-image: url(h.png); }`, { lanes: true });
    expect(errors(c).filter((d) => d.code === 'DRAGON_REMOTE_IMAGE').map((d) => d.message)).toEqual([expect.stringContaining('url() h.png is not mapped')]);
  });
});

describe('url() stacks web does not draw yet are refused on every target', () => {
  for (const [css, span, part] of [
    [`.a { background-image: url(${PNG}), url(${PNG}); }`, null, 'the one layer of its box'],
    [`.a { background-image: url(${PNG}), linear-gradient(red, blue); }`, null, 'the one layer of its box'],
    [`.a { background-image: url(${PNG}); background-size: cover; }`, 'cover', 'cover is not supported yet (BG2-u)'],
    [`.a { background-image: url(${PNG}); background-size: contain; }`, 'contain', 'contain is not supported yet (BG2-u)'],
    [`.a { background-image: url(${PNG}); background-size: 10px auto; }`, '10px auto', 'a size is not supported yet (BG2-u)'],
    [`.a { background-image: url(${PNG}); background-repeat: space; }`, 'space', 'background-repeat: space on a url() image is not supported yet (BG2-t)'],
    [`.a { background-image: url(${PNG}); background-repeat: repeat round; }`, 'repeat round', 'round on a url() image'],
    [`.a { background-image: url(${PNG}); background-position-x: right 5px; }`, 'right 5px', 'offset from the right edge'],
    [`.a { background-image: url(${PNG}); background-position: left 0px bottom 10%; }`, 'left 0px bottom 10%', 'offset from the bottom edge'],
    [`body { background-image: url(${PNG}); }`, null, 'paints the canvas'],
    [`.a { display: inline; background-image: url(${PNG}); }`, null, 'an inline box is painted per line fragment'],
  ] as const) {
    it(css.slice(0, 90), () => {
      const input = withAsset(inputFor(BASE + css, tree));
      const c = compileInput(input, { targets: ALL });
      const refused = errors(c).filter((d) => d.code === 'DRAGON_UNSUPPORTED_VALUE' && d.message.includes(part));
      expect(refused.map((d) => d.target).sort(), codes(c).join(', ')).toEqual(['android', 'ios', 'web']);
      if (span !== null) expect(spanTextOf(input, refused[0] as Diagnostic)).toBe(span);
      expect(c.outputs.web.kind).toBe('blocked');
      expectCatalogued(c.diagnostics);
    });
  }
  it('one layer at size auto, repeat or no-repeat per axis and a px or % position compiles on web, over a colour', () => {
    for (const css of [
      `background: url(${PNG}) #123456;`,
      `background: url(${PNG}) no-repeat 4px 25%;`,
      `background: url(${PNG}) repeat-x center top; background-origin: content-box; padding: 3px;`,
      `background-image: url(${PNG}); background-repeat: no-repeat repeat; background-position: left 10% top 2px; background-clip: padding-box;`,
    ]) expect(codes(compile(`.a { ${css} }`, { targets: WEB })), css).toEqual([]);
  });
});

describe('the native targets refuse a url() layer until part 2; the parity lanes run it lane-only', () => {
  const css = `.a { background: url(${PNG}) no-repeat 4px 25% #123456; }`;
  it('a user compile draws it on web and refuses it on ios and android, at its background-image, naming BG2-u', () => {
    const input = withAsset(inputFor(BASE + css, tree));
    const c = compileInput(input, { targets: ALL });
    expect(c.outputs.web.kind).toBe('ready');
    expect(c.outputs.ios.kind).toBe('blocked');
    expect(c.outputs.android.kind).toBe('blocked');
    const native = errors(c);
    expect(native.map((d) => `${d.code} [${d.target}]`).sort()).toEqual(['DRAGON_UNSUPPORTED_VALUE [android]', 'DRAGON_UNSUPPORTED_VALUE [ios]']);
    for (const d of native) {
      expect(d.message).toBe('background-image on a: a url() image is drawn on the web target only until the native image layers land (BG2-u)');
      expect(spanTextOf(input, d)).toBe(`url(${PNG}) no-repeat 4px 25% #123456`);
    }
    expectCatalogued(c.diagnostics);
  });
  it('a url() only a :hover rule sets is refused natively too', () => {
    const c = compile(`.a:hover { background-image: url(${PNG}); }`, { targets: ALL });
    expect(codes(c).sort()).toEqual(expect.arrayContaining(['DRAGON_UNSUPPORTED_VALUE [android]', 'DRAGON_UNSUPPORTED_VALUE [ios]']));
    expect(codes(c)).not.toContain('DRAGON_UNSUPPORTED_VALUE [web]');
  });
  it('an enforced compile refuses it natively without a profile row, and the lanes run it lane-only with the box marked undrawn', () => {
    const enforced = compile(css, { targets: ALL, profiles: 'enforce' });
    expect(enforced.outputs.ios.kind).toBe('blocked');
    const lanes = compile(css, { targets: ALL, lanes: true });
    expect(codes(lanes)).toEqual([]);
    expect([laneOnlyNative(lanes, 'ios'), laneOnlyNative(lanes, 'android')]).toEqual([true, true]);
    const p = nativePrograms(lanes, []);
    if (p.kind !== 'ready') throw new Error(p.reason);
    for (const prog of [p.programs.uikit, p.programs['android-views']]) {
      const a = prog.nodes.find((n) => n.id === 'a');
      expect(a?.facts['gradient']).toEqual({ undrawnImage: true });
      expect(a?.writes.some((w) => w.kind === 'background-layers')).toBe(false);
      expect(prog.nodes.filter((n) => n.facts['gradient'] !== undefined).map((n) => n.id)).toEqual(['a']);
    }
    // A box without a url() in the same lanes compile is not lane-only.
    expect(laneOnlyNative(compile(`.a { background: linear-gradient(red, blue); }`, { targets: ALL, lanes: true }), 'ios')).toBe(false);
  });
  it('the lowering refuses a url() layer beside other layers, which every target refuses before it', () => {
    const kw = (value: string) => ({ value: { kind: 'keyword', value } });
    const props = new Map<string, unknown>([
      ['background-image', { value: { kind: 'other', type: 'list', text: `url("${PNG}"), linear-gradient(red, blue)` } }],
      ['background-position-x', { value: { kind: 'percentage', value: 0 } }],
      ['background-position-y', { value: { kind: 'percentage', value: 0 } }],
      ['background-size', kw('auto')],
      ['background-repeat', kw('repeat')],
      ['background-attachment', kw('scroll')],
      ['background-origin', kw('padding-box')],
      ['background-clip', kw('border-box')],
    ]);
    const el = { element: { address: 'a' }, props, children: [] };
    expect(() => GRADIENT_LOWERING.lower({ box: null, el, facts: {} } as never)).toThrow(ProgramError);
    expect(() => GRADIENT_LOWERING.lower({ box: null, el, facts: {} } as never)).toThrow('a: a url() layer beside other layers reached the native lowering, which every target refuses (BG2-u)');
  });
});
