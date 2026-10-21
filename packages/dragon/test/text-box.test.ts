// text-box-trim and text-box-edge in the compiler: the lowering to LayoutStyle.textBoxTrim (lower/ios-layout.ts), the web output's
// declarations, and the refusals of analysis/text-box.ts on every target; the planted fault textBoxTrimAccepted accepts every trim.
import { describe, expect, it } from 'vitest';
import type { LayoutBox } from '@dragon/layout';
import type { Compiled, ElementNode, Origin, SourceRef, TreeNode } from '../src/index.ts';
import { createProjectWith, iosLayoutProjection, NO_FAULTS, WEB_CSS_PATH } from '../src/internal.ts';
import type { CompilerFaults } from '../src/faults.ts';
import { DOC, div, inputFor, staticClass, text } from './helpers.ts';

const FONT = 'body { margin: 0; font-family: Ahem; font-size: 10px; line-height: 2; }';
const ENV = { viewport: { width: 400, height: 300 }, devicePixelRatio: 1, direction: 'ltr', rootFont: 'ua-default' } as const;
type K = 'ios' | 'android' | 'web';
type Body = Parameters<typeof inputFor>[1];
const own: Body = (r) => [div(r, 'a', ['a'], [text(r, 't', 'XX XX XX')])];

function el(ref: SourceRef, id: string, tag: string, classes: string[] = [], children: TreeNode[] = []): ElementNode {
  const origin: Origin = { kind: 'authored', span: { source: ref, start: 0, end: 0 } };
  return { kind: 'element', id, tag, classes: classes.map((name) => staticClass({ owner: DOC, sheet: 's', name }, origin)), attributes: [], children, origin };
}

function compile(css: string, body: Body = own, faults: CompilerFaults = NO_FAULTS): Compiled<K> {
  return createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} } }, { faults, profiles: 'derive', direction: 'ltr' }).compile(inputFor(`${FONT} ${css}`, body));
}

const refusals = (c: Compiled<K>): string[] => c.diagnostics.filter((d) => d.message.startsWith('text-box-trim')).map((d) => `${String(d.target)} ${d.message}`);

function lowered(c: Compiled<K>, id: string): LayoutBox {
  const p = iosLayoutProjection(c, ENV, []);
  if (p.kind !== 'ready') throw new Error(p.reason);
  const find = (b: LayoutBox): LayoutBox | undefined => (b.id === id ? b : b.children.flatMap((k) => (k.kind === 'box' ? [find(k)] : [])).find((x) => x !== undefined));
  const hit = find(p.input.root);
  if (hit === undefined) throw new Error(`no box ${id}`);
  return hit;
}

describe('text-box-trim: lowering', () => {
  it('lowers each trim with the under edge of text-box-edge, own, from the shorthand or inherited', () => {
    const cases: [string, unknown][] = [
      ['text-box-trim: trim-both', { start: true, end: true, alphabetic: false }],
      ['text-box-trim: trim-start', { start: true, end: false, alphabetic: false }],
      ['text-box-trim: trim-end; text-box-edge: text alphabetic', { start: false, end: true, alphabetic: true }],
      ['text-box: text', { start: true, end: true, alphabetic: false }],
      ['text-box: trim-start text alphabetic', { start: true, end: false, alphabetic: true }],
      ['text-box: normal', null],
      ['text-box-edge: text alphabetic', null],
    ];
    for (const [decl, want] of cases) {
      const c = compile(`.a { width: 55px; ${decl}; }`);
      expect(refusals(c), decl).toEqual([]);
      expect(lowered(c, 'a').style.textBoxTrim, decl).toEqual(want);
    }
    const inherited = compile('.o { text-box-edge: text alphabetic; } .a { text-box-trim: trim-end; }', (r) => [div(r, 'o', ['o'], [div(r, 'a', ['a'], [text(r, 't', 'XX')])])]);
    expect(refusals(inherited)).toEqual([]);
    expect(lowered(inherited, 'a').style.textBoxTrim).toEqual({ start: false, end: true, alphabetic: true });
    expect(lowered(inherited, 'o').style.textBoxTrim).toBeNull();
  });

  it('writes the declarations to the web output', () => {
    const css = (() => {
      const out = compile('.a { text-box: trim-both text alphabetic; }').outputs.web;
      if (out.kind !== 'ready') throw new Error(out.kind);
      return (out.files.find((f) => f.path === WEB_CSS_PATH) as { text: string }).text;
    })();
    expect(css).toMatch(/text-box-trim: ?trim-both/);
    expect(css).toMatch(/text-box-edge: ?text alphabetic/);
  });
});

describe('text-box-trim: refusals', () => {
  const at = (why: string): string[] => ['android', 'ios', 'web'].map((t) => `${t} text-box-trim: trim-both on <div> a is not laid out on ${t}: ${why}`);

  it('refuses on every target a trim the engine does not lay out; textBoxTrimAccepted accepts it', () => {
    const cases: [string, Body, string][] = [
      ['.a { text-box-trim: trim-both; }', (r) => [div(r, 'a', ['a'], [div(r, 'b', [], [text(r, 't', 'XX')])])], 'it holds <div> b, which is display: block; Chrome trims the first and last lines of nested blocks, which Dragon does not'],
      ['.a { text-box: trim-both cap alphabetic; }', own, 'its text-box-edge is cap alphabetic, whose cap height over edge no Ahem fixture can tell from text'],
      ['.a { text-box: trim-both ex text; }', own, 'its text-box-edge is ex text, whose x-height over edge no Ahem fixture can tell from text'],
      ['.a { text-box-trim: trim-both; display: inline-block; }', own, 'its display is inline-block; Dragon trims a block\'s own lines only'],
      ['.f { display: flex; } .a { text-box-trim: trim-both; }', (r) => [div(r, 'f', ['f'], [div(r, 'a', ['a'], [text(r, 't', 'XX')])])], 'it sits in a display: flex box; Dragon trims a block in a block only'],
      ['.a { text-box-trim: trim-both; position: absolute; }', own, 'it is position: absolute'],
      ['.a { text-box-trim: trim-both; overflow: hidden; }', own, 'its overflow is not visible'],
      ['.a { text-box-trim: trim-both; white-space: pre; }', own, 'its white space is preserved'],
      ['.a { text-box-trim: trim-both; } .s { display: inline-block; }', (r) => [div(r, 'a', ['a'], [text(r, 't', 'XX '), el(r, 's', 'span', ['s'], [text(r, 'u', 'X')])])], 'it holds <span> s, which is display: inline-block; Chrome trims the first and last lines of nested blocks, which Dragon does not'],
    ];
    for (const [css, body, why] of cases) {
      expect(refusals(compile(css, body)), css).toEqual(at(why));
      expect(refusals(compile(css, body, { ...NO_FAULTS, textBoxTrimAccepted: true })), css).toEqual([]);
    }
  });

  it('accepts inline boxes, a <br> and a relative block, and ignores trim none', () => {
    const body: Body = (r) => [div(r, 'a', ['a'], [text(r, 't', 'XX '), el(r, 's', 'span', [], [text(r, 'u', 'X')]), el(r, 'b', 'br'), text(r, 'v', 'XX')])];
    expect(refusals(compile('.a { text-box-trim: trim-both; position: relative; }', body))).toEqual([]);
    expect(refusals(compile('.a { text-box-trim: none; display: flex; }', body))).toEqual([]);
  });
});
