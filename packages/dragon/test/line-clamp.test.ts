// TXT2-g (notes/T149-txt2-spec.md R11): the legacy line clamp in the compiler (analysis/line-clamp.ts): display: -webkit-box with
// -webkit-box-orient: vertical and a -webkit-line-clamp computes to flow-root and lowers to a block with LayoutStyle.lineClamp; the
// web output keeps the authored -webkit-box (planted webkitBoxEmittedAsFlowRoot writes flow-root); the rest is refused with the
// reason. Chrome agreement is proven by the line-clamp fixture group (packages/parity/test/line-clamp.test.ts).
import { describe, expect, it } from 'vitest';
import type { LayoutBox } from '@dragon/layout';
import type { Compiled, FrontEndResult, TreeNode } from '../src/index.ts';
import { createProjectWith, iosLayoutProjection, NO_FAULTS, WEB_CSS_PATH } from '../src/internal.ts';
import type { CompilerFaults } from '../src/faults.ts';
import { div, expectCatalogued, inputFor, text } from './helpers.ts';

const FONT = 'body { margin: 0; font-family: Ahem; font-size: 10px; }';
const ENV = { viewport: { width: 400, height: 300 }, devicePixelRatio: 1, direction: 'ltr', rootFont: 'ua-default' } as const;
const CLAMP = 'display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; width: 55px;';
type K = 'ios' | 'android' | 'web';

type Body = Parameters<typeof inputFor>[1];
const own: Body = (r) => [div(r, 'a', ['a'], [text(r, 't', 'XX XX XX XX XX XX')])];

function compile(css: string, body: Body = own, faults: CompilerFaults = NO_FAULTS): { input: FrontEndResult; c: Compiled<K> } {
  const input = inputFor(`${FONT} ${css}`, body);
  return { input, c: createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} } }, { faults, profiles: 'derive', direction: 'ltr' }).compile(input) };
}

const errors = (c: Compiled<K>): string[] => c.diagnostics.filter((d) => d.severity === 'error').map((d) => `${d.target ?? '*'} ${d.code} ${d.message}`);

function webCss(c: Compiled<K>): string {
  const out = c.outputs.web;
  if (out.kind !== 'ready') throw new Error(`web is ${out.kind}: ${errors(c).join('; ')}`);
  return (out.files.find((f) => f.path === WEB_CSS_PATH) as { text: string }).text;
}

function lowered(c: Compiled<K>, id: string): LayoutBox {
  const p = iosLayoutProjection(c, ENV, []);
  if (p.kind !== 'ready') throw new Error(p.reason);
  const find = (b: LayoutBox): LayoutBox | undefined => (b.id === id ? b : b.children.flatMap((k) => (k.kind === 'box' ? [find(k)] : [])).find((x) => x !== undefined));
  const hit = find(p.input.root);
  if (hit === undefined) throw new Error(`no box ${id}`);
  return hit;
}

describe('TXT2-g: the line-clamp pattern', () => {
  it('computes to flow-root, lowers to a block that clamps after line N, and compiles on every target', () => {
    const { c } = compile(`.a { ${CLAMP} }`);
    expect(errors(c)).toEqual([]);
    expect(lowered(c, 'a').style).toMatchObject({ display: 'block', lineClamp: 2, overflowX: 'hidden', overflowY: 'hidden' });
  });

  it('is case-insensitive and takes Tailwind line-clamp-3 and block-axis', () => {
    const { c } = compile('.a { overflow: hidden; display: -WEBKIT-BOX; -webkit-box-orient: block-axis; -webkit-line-clamp: 3; }');
    expect(errors(c)).toEqual([]);
    expect(lowered(c, 'a').style.lineClamp).toBe(3);
  });

  it('leaves the clamp properties inert without display: -webkit-box', () => {
    const { c } = compile('.a { -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }');
    expect(errors(c)).toEqual([]);
    expect(lowered(c, 'a').style.lineClamp).toBe(0);
    // With -webkit-line-clamp: none the -webkit-box stays Chrome's legacy flexbox, which is refused.
    expect(errors(compile(`.a { ${CLAMP} -webkit-line-clamp: none; }`).c)[0]).toMatch(/^\* DRAGON_UNSUPPORTED_VALUE display: -webkit-box is unsupported/);
  });

  it('writes the authored trio to the web, not the computed flow-root, and leaves other elements without the clamp longhands', () => {
    const css = webCss(compile(`.a { ${CLAMP} }`, (r) => [div(r, 'p', [], [div(r, 'a', ['a'], [text(r, 't', 'XX XX XX XX')])])]).c);
    expect(css).toContain('display: -webkit-box;\n');
    expect(css).toContain('-webkit-box-orient: vertical;\n  -webkit-line-clamp: 2;\n');
    expect(css).not.toContain('flow-root');
    expect(css.match(/-webkit-line-clamp/g)?.length).toBe(1);
  });

  it('planted fault webkitBoxEmittedAsFlowRoot writes display: flow-root', () => {
    const css = webCss(compile(`.a { ${CLAMP} }`, own, { ...NO_FAULTS, webkitBoxEmittedAsFlowRoot: true }).c);
    expect(css).toContain('display: flow-root;\n');
    expect(css).not.toContain('-webkit-box;');
  });

  it('takes block children of inline content, one level down', () => {
    const { c } = compile(`.a { ${CLAMP} }`, (r) => [div(r, 'a', ['a'], [div(r, 'b1', [], [text(r, 't1', 'Hi')]), div(r, 'b2', [], [text(r, 't2', 'Hi')])])]);
    expect(errors(c)).toEqual([]);
  });

  it('refuses -webkit-line-clamp: calc() and keeps -webkit-box-orient values Chrome drops invalid', () => {
    expect(errors(compile(`.a { ${CLAMP} -webkit-line-clamp: calc(1 + 1); }`).c)).toEqual(['* DRAGON_UNSUPPORTED_VALUE -webkit-line-clamp: only none or a whole number of lines is supported']);
    expect(compile('.a { -webkit-line-clamp: 0; }').c.diagnostics.map((d) => d.code)).toEqual(['DRAGON_CSS_INVALID_VALUE']);
  });
});

describe('TXT2-g: what the engine does not clamp is refused with the reason', () => {
  const refused = (css: string, body: Body = own): string[] => {
    const { c } = compile(css, body);
    expectCatalogued(c.diagnostics);
    return [...new Set(c.diagnostics.filter((d) => d.severity === 'error').map((d) => `${d.target ?? '*'} ${d.message.split(/[:(]/)[0]?.trim()}`))].sort();
  };
  const all = (what: string): string[] => ['android', 'ios', 'web'].map((t) => `${t} ${what}`);
  const at = '-webkit-line-clamp on a';

  it('overflow visible, rtl, a height, text-overflow, preserved white space and letter-spacing', () => {
    expect(refused(`.a { ${CLAMP} overflow: visible; }`)).toEqual(all(`${at} needs overflow`));
    expect(refused(`.a { ${CLAMP} direction: rtl; }`)).toEqual(all(`${at} clamps rtl lines, which Dragon truncates left to right only`));
    expect(refused(`.a { ${CLAMP} max-height: 20px; }`)).toEqual(all(`${at} has a height or max-height, with which Chrome clamps by height as well as by lines`));
    expect(refused(`.a { ${CLAMP} text-overflow: ellipsis; }`)).toEqual(all(`${at} also has text-overflow`));
    expect(refused(`.a { ${CLAMP} white-space: pre-wrap; }`)).toEqual(all(`${at} holds preserved white space`));
    expect(refused(`.a { ${CLAMP} letter-spacing: 1px; }`)).toEqual(all(`${at} holds letter-spaced text`));
  });

  it('nested blocks deeper than one level, and a -webkit-box without both companions or inline', () => {
    const deep: Body = (r) => [div(r, 'a', ['a'], [div(r, 'b', [], [div(r, 'c', [], [text(r, 't', 'XX')])])])];
    expect(refused(`.a { ${CLAMP} }`, deep)).toEqual(all(`${at} holds <div> b, which is not a block of inline content in its formatting context; Chrome counts lines through nested blocks, which Dragon does not yet`));
    expect(refused('.a { display: -webkit-box; -webkit-line-clamp: 2; overflow: hidden; }')).toContain("* display");
    expect(refused('.a { display: -webkit-box; -webkit-box-orient: vertical; overflow: hidden; }')).toContain("* display");
    expect(refused('.a { display: -webkit-inline-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }')).toEqual(all(`${at}`));
  });

  it('on native only, an inline box painted unlike its block', () => {
    const body: Body = (r) => [div(r, 'a', ['a'], [text(r, 't', 'XX XX '), { ...(div(r, 's', ['s'], [text(r, 'u', 'XX XX XX')]) as TreeNode & object), tag: 'span' } as TreeNode])];
    expect(refused(`.a { ${CLAMP} } .s { color: #c00; }`, body)).toEqual(['android -webkit-line-clamp on a', 'ios -webkit-line-clamp on a']);
    expect(refused(`.a { ${CLAMP} } .s { font-size: 5px; }`, body)).toEqual([]);
  });
});
