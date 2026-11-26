// REPL-a under SELD-R states: a state record rebuilds an image as the case emitter writes it, so an img under :active or a component
// state lowers on native (check-in's list rows); a web view, video or svg stays refused by name.
import { describe, expect, it } from 'vitest';
import type { ProgramNode } from '../src/lower/native-program.ts';
import { nodeLit } from '../src/emit/runtime/state.ts';

const node = (writes: readonly object[]): ProgramNode => ({ id: 't1', parent: 'r1', host: 'r1', kind: 'element', native: 'DragonNodeView', clips: false, text: null, writes, facts: {} }) as unknown as ProgramNode;
const image = { kind: 'replaced-image', data: 'iVBORw0KGgo=', width: 160, height: 80, fit: 'cover', layer: true, pixelated: false };

describe('an image in a state program', () => {
  it('is a record write with its data, natural size, fit, layer and pixelation, in each language', () => {
    expect(nodeLit('swift', node([image]))).toContain('.image("iVBORw0KGgo=", 160.0, 80.0, "cover", false)');
    expect(nodeLit('kotlin', node([image]))).toContain('DragonStateWrite.Image("iVBORw0KGgo=", 160.0, 80.0, "cover", true, false)');
    expect(nodeLit('swift', node([{ ...image, pixelated: true }]))).toContain(', true)');
  });
  it('leaves a web view and a run-time image refused by name', () => {
    for (const lang of ['swift', 'kotlin'] as const) {
      for (const kind of ['foreign-view', 'runtime-image'] as const) expect(() => nodeLit(lang, node([{ kind }])), `${lang} ${kind}`).toThrow(`t1: a ${kind} write in a state program is not supported yet (run-time images, web views, videos and svgs under SELD-R states)`);
    }
  });
});
