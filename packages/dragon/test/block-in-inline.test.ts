// BII (CSS2 §9.2.1.1 block-in-inline): an inline box that holds only block-level boxes and collapsible white space, with no box of its
// own, is laid out as their block box (analysis/block-in-inline.ts). The parity fixtures block-in-inline-* compare it with Chrome;
// these pin the compiler: the lowering's block-in-inline box, the web output's computed inline, and the shapes still refused.
import { describe, expect, it } from 'vitest';
import type { LayoutBox } from '@dragon/layout';
import { createProjectWith, iosLayoutProjection, NO_FAULTS, WEB_CSS_PATH } from '../src/internal.ts';
import type { TreeNode } from '../src/index.ts';
import { div, inputFor, text } from './helpers.ts';

const TARGETS = { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} } as const;
const FONT = 'body { margin: 0; font-family: Ahem; font-size: 10px; }';
const ENV = { viewport: { width: 400, height: 300 }, devicePixelRatio: 1, direction: 'ltr', rootFont: 'ua-default' } as const;
type Ref = Parameters<Parameters<typeof inputFor>[1]>[0];
const tagged = (r: Ref, tag: string, id: string, classes: string[], children: TreeNode[] = []): TreeNode => ({ ...div(r, id, classes, children), tag, attributes: [] }) as never;
const compile = (css: string, body: (r: Ref) => TreeNode[]) => createProjectWith({ projectId: 'test', targets: TARGETS }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(inputFor(`${FONT} ${css}`, body));
const errors = (c: ReturnType<typeof compile>): string[] => c.diagnostics.filter((d) => d.severity === 'error').map((d) => `${d.code} ${String(d.target)} ${d.message}`);

function find(b: LayoutBox, id: string): LayoutBox | null {
  if (b.id === id) return b;
  for (const c of b.children) {
    const f = c.kind === 'box' ? find(c, id) : null;
    if (f !== null) return f;
  }
  return null;
}

describe('BII: block-in-inline', () => {
  it('lowers an inline box of blocks and white space as a block-in-inline box, and the web output keeps its display inline', () => {
    const c = compile('.k { height: 10px; }', (r) => [div(r, 'p', [], [tagged(r, 'span', 's', [], [text(r, 'w0', '\n  '), div(r, 'k', ['k']), text(r, 'w1', ' '), div(r, 'j', [], [text(r, 't', 'XX')]), text(r, 'w2', '\n')])])]);
    expect(errors(c)).toEqual([]);
    const p = iosLayoutProjection(c, ENV, []);
    if (p.kind !== 'ready') throw new Error('blocked');
    const s = find(p.input.root, 's') as LayoutBox;
    expect([s.boxType, s.style.display, s.children.map((k) => k.kind)]).toEqual(['block-in-inline', 'block', ['box', 'box']]);
    if (c.outputs.web.kind !== 'ready') throw new Error('web blocked');
    const css = (c.outputs.web.files.find((f) => f.path === WEB_CSS_PATH) as { text: string }).text;
    const rule = css.split('\n}\n').find((r) => r.includes('display: inline;'));
    expect(rule).toBeDefined();
    expect(css).not.toMatch(/display: inline-block/);
  });

  it('keeps refusing an inline box with a box of its own, with text inside or beside it, or holding another such inline box', () => {
    const block = (r: Ref): TreeNode => div(r, 'b', [], [text(r, 't', 'YY')]);
    const cases: [string, (r: Ref) => TreeNode[], string][] = [
      ['.s { padding-left: 1px; }', (r) => [div(r, 'p', [], [tagged(r, 'span', 's', ['s'], [block(r)])])], '(here padding-left: 1px; package BII)'],
      ['.s { background-color: red; }', (r) => [div(r, 'p', [], [tagged(r, 'span', 's', ['s'], [block(r)])])], '(here background-color: rgb(255, 0, 0); package BII)'],
      ['', (r) => [div(r, 'p', [], [tagged(r, 'span', 's', [], [text(r, 'x', 'XX'), block(r)])])], '(here it holds text beside its block-level boxes; package BII)'],
      ['', (r) => [div(r, 'p', [], [tagged(r, 'span', 's', [], [tagged(r, 'em', 'e', [], [block(r)])])])], '(here it holds the inline box e, laid out the same way; package BII)'],
      ['', (r) => [div(r, 'p', [], [text(r, 'x', 'aa '), tagged(r, 'span', 's', [], [block(r)])])], 'the inline box <span> s holds block-level boxes beside the text or inline content of p'],
    ];
    for (const [css, body, message] of cases) {
      const got = errors(compile(css, body)).filter((e) => e.includes(message));
      expect(got.map((e) => e.split(' ').slice(0, 2).join(' ')).sort(), message).toEqual(['DRAGON_UNSUPPORTED_VALUE android', 'DRAGON_UNSUPPORTED_VALUE ios', 'DRAGON_UNSUPPORTED_VALUE web']);
    }
  });
});
