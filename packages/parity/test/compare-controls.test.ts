// FORM-a: the host comparison knows an anonymous box inside a form control (a button's text wrapper) as Dragon's own, so a
// button with text beside an element passes on its compared text lines instead of failing as a node Chrome does not have.
import { describe, expect, it } from 'vitest';
import type { ControlBox, LayoutBox, LayoutInput, LayoutRect, LayoutStyle } from '@dragon/layout';
import type { WebCapture } from '../src/capture.ts';
import { compareLayout } from '../src/compare.ts';
import { ENVIRONMENT } from '../src/fixtures.ts';

const style = {} as LayoutStyle;
const lu = (px: number): LayoutRect['x'] => (px * 64) as unknown as LayoutRect['x'];
const rect = (id: string, parent: string | null, y: number, height: number): LayoutRect => ({ id, parent, x: lu(0), y: lu(y), width: lu(40), height: lu(height) });

describe('compareLayout and form controls', () => {
  const anon: LayoutBox = { kind: 'box', id: 'btn:anon0', boxType: 'anonymous', style, children: [{ kind: 'text', id: 't', text: 'XX', font: { family: 'Ahem', size: 10, specifiedSize: { kind: 'px', value: 10 }, absoluteSize: true }, lineHeight: { kind: 'normal' }, whiteSpaceCollapse: 'collapse', textWrapMode: 'wrap' }] };
  const button: ControlBox = { kind: 'control', id: 'btn', boxType: 'element', style, control: { kind: 'button-block' }, children: [anon, { kind: 'box', id: 'el', boxType: 'element', style, children: [] }] };
  const input = { viewport: ENVIRONMENT.viewport, devicePixelRatio: 1, root: { kind: 'box', id: 'root', boxType: 'element', style, children: [button] } } as unknown as LayoutInput;
  const absolute = new Map([rect('root', null, 0, 40), rect('btn', 'root', 0, 30), rect('btn:anon0', 'btn', 0, 10), rect('t', 'btn:anon0', 0, 10), rect('t:line0', 't', 0, 10), rect('el', 'btn', 10, 8)].map((r) => [r.id, r]));
  const node = (r: LayoutRect, kind: 'element' | 'text' | 'line') => ({ id: r.id, kind, hasBox: true, x: r.x / 64, y: r.y / 64, width: r.width / 64, height: r.height / 64, computed: null });
  const capture: WebCapture = { fixture: 'f', chrome: 'c', browser: 'b', platform: 'p', viewport: ENVIRONMENT.viewport, devicePixelRatio: 1, direction: 'ltr', nodes: ['root', 'btn', 'el', 't'].map((id) => node(absolute.get(id) as LayoutRect, id === 't' ? 'text' : 'element')).concat([node(absolute.get('t:line0') as LayoutRect, 'line')]) };

  it('passes a button whose anonymous text box Chrome does not have, on its compared lines', () => {
    const c = compareLayout(capture, absolute, input, ENVIRONMENT);
    expect(c.problems).toEqual([]);
    expect(c.anonymous).toEqual([{ id: 'btn:anon0', lines: ['t:line0'] }]);
  });

  it('still fails a node inside a control that is neither compared nor anonymous', () => {
    const extra = new Map(absolute).set('ghost', rect('ghost', 'btn', 20, 2));
    expect(compareLayout(capture, extra, input, ENVIRONMENT).problems).toEqual(['ghost: Dragon laid out a node Chrome does not have']);
  });
});
