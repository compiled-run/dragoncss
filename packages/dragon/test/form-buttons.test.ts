// FORM-attrs: a button inside a <form> submits or resets it when activated, which the native outputs do not do, so only
// type=button compiles there (project.ts checkFormButtons); rel and target on a form govern submission and stay refused.
import { describe, expect, it } from 'vitest';
import type { AttributeBinding, ElementNode, SourceRef, TreeNode } from '../src/index.ts';
import { createProject } from '../src/index.ts';
import { attributeRefusal } from '../src/attributes.ts';
import { always, div, inputFor } from './helpers.ts';

const at = (ref: SourceRef) => ({ kind: 'authored', span: { source: ref, start: 0, end: 0 } }) as const;
const attr = (ref: SourceRef, name: string, value: AttributeBinding['value']): AttributeBinding => ({ name, value, origin: at(ref) });
const el = (ref: SourceRef, tag: string, id: string, attributes: AttributeBinding[], children: TreeNode[] = []): ElementNode => ({ ...div(ref, id, [], children), tag, attributes });
const refusals = (body: (ref: SourceRef) => TreeNode[]): string[] =>
  createProject({ projectId: 'test', targets: { web: {} } }).compile(inputFor('', body)).diagnostics.filter((d) => d.message.includes('inside <form>')).map((d) => d.message);

describe('buttons inside a form', () => {
  it('refuses a button with no type, type submit, reset or an invalid type inside a form', () => {
    const typed = (value: string | null) => (ref: SourceRef) => [el(ref, 'form', 'f', [], [el(ref, 'button', 'b', value === null ? [] : [attr(ref, 'type', [{ when: always, value }])])])];
    expect(refusals(typed(null))).toEqual(['<button> b inside <form> f submits the form (and Chrome navigates) when activated (type missing, so submit), which the native outputs do not do']);
    expect(refusals(typed('SUBMIT'))).toHaveLength(1);
    expect(refusals(typed('menu'))).toHaveLength(1);
    expect(refusals(typed('reset'))).toEqual(['<button> b inside <form> f resets the form when activated (type reset), which the native outputs do not do']);
  });
  it('accepts type=button inside a form (in any case), and any button outside one', () => {
    expect(refusals((ref) => [el(ref, 'form', 'f', [], [el(ref, 'div', 'd', [], [el(ref, 'button', 'b', [attr(ref, 'type', [{ when: always, value: 'Button' }])])])])])).toEqual([]);
    expect(refusals((ref) => [el(ref, 'div', 'f', [], [el(ref, 'button', 'b', [])])])).toEqual([]);
  });
  it('keeps rel and target refused on a form, where they govern submission', () => {
    expect(attributeRefusal('form', 'rel')).toContain('LINK-RT');
    expect(attributeRefusal('form', 'target')).toContain('LINK-RT');
    expect(attributeRefusal('div', 'target')).toBeNull();
  });
});
