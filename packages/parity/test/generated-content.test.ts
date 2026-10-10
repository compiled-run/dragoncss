// GEN-a R9: the pure parts of the generated-box capture (pseudo-capture.ts) on synthetic CDP data, and its two plants.
import { describe, expect, it } from 'vitest';
import { generatedBreakText } from '../src/line-breaks.ts';
import type { Rect4, Snapshot } from '../src/pseudo-capture.ts';
import { generatedNodes, NO_PSEUDO_CAPTURE_FAULTS, pseudoNodesOf, pseudoSetProblems, snapshotGeneratedText, unionRects } from '../src/pseudo-capture.ts';

/**
 * A page at DPR 2: html > body > div#d (data-dragon-id d) holding the text "x" and a ::before whose text wraps on two lines.
 * Snapshot bounds are in device px.
 */
function snapshot(): Snapshot {
  const strings = ['HTML', 'BODY', 'DIV', 'data-dragon-id', 'd', 'before', '#text', 'x', 'aa bb', '::before'];
  return {
    strings,
    documents: [{
      nodes: {
        // 0 #document, 1 html, 2 body, 3 div, 4 ::before, 5 text "x"
        parentIndex: [-1, 0, 1, 2, 3, 3],
        nodeType: [9, 1, 1, 1, 1, 3],
        attributes: [[], [], [], [3, 4], [], []],
        pseudoType: { index: [4], value: [5] },
      },
      layout: { nodeIndex: [4, 5], text: [8, 7] },
      textBoxes: { layoutIndex: [0, 0, 1], bounds: [[0, 0, 64, 32], [0, 32, 64, 32], [0, 64, 32, 32]], start: [0, 3, 0], length: [2, 2, 1] },
    }],
  };
}

describe('unionRects (getBoundingClientRect of fragments)', () => {
  it('starts from the first fragment and unions the non-empty rest', () => {
    expect(unionRects([])).toBeNull();
    expect(unionRects([[5, 6, 0, 10]])).toEqual([5, 6, 0, 10]);
    expect(unionRects([[0, 0, 10, 10], [5, 20, 0, 10], [20, 10, 5, 5]])).toEqual([0, 0, 25, 15]);
    expect(unionRects([[3, 3, 0, 0], [10, 10, 2, 2]])).toEqual([10, 10, 2, 2]);
  });
});

describe('snapshotGeneratedText (R9)', () => {
  const page: Rect4[][] = [[[0, 32, 16, 16]]];
  it('divides the snapshot text boxes by the DPR and names them by the host\'s data-dragon-id', () => {
    const r = snapshotGeneratedText(snapshot(), 2, page);
    expect(r.texts).toEqual([{ host: 'd', type: 'before', text: 'aa bb', boxes: [{ rect: [0, 0, 32, 16], start: 0, length: 2 }, { rect: [0, 16, 32, 16], start: 3, length: 2 }] }]);
    expect([r.lines, r.worst]).toEqual([1, 0]);
  });
  it('fails loud when a real text box differs from its Range rect, as the plant snapshotTextNotScaled makes it at DPR 2', () => {
    expect(() => snapshotGeneratedText(snapshot(), 2, page, { ...NO_PSEUDO_CAPTURE_FAULTS, snapshotTextNotScaled: true })).toThrow(/R9 cross-check: a snapshot text box divided by the DPR differs/);
    expect(() => snapshotGeneratedText(snapshot(), 2, [])).toThrow(/1 light-DOM text nodes, the page 0/);
    expect(() => snapshotGeneratedText(snapshot(), 2, [[[0, 32, 16, 16], [0, 0, 1, 1]]])).toThrow(/1 snapshot text boxes and 2 Range client rects/);
  });
  it('fails loud on a host without data-dragon-id and on text of another pseudo-element', () => {
    const noId = snapshot();
    (noId.documents[0]?.nodes.attributes as number[][])[3] = [];
    expect(() => snapshotGeneratedText(noId, 2, page)).toThrow(/host has no data-dragon-id/);
    const marker = { ...snapshot(), strings: [...snapshot().strings.slice(0, 5), 'marker', ...snapshot().strings.slice(6)] };
    expect(() => snapshotGeneratedText(marker, 2, page)).toThrow(/text in a ::marker pseudo-element/);
  });
});

describe('pseudoNodesOf and generatedNodes', () => {
  it('lists ::before and ::after by host and refuses any other pseudo-element or a host without an id', () => {
    const doc = { nodeId: 1, nodeType: 9, children: [{ nodeId: 2, nodeType: 1, attributes: ['data-dragon-id', 'd'], pseudoElements: [{ nodeId: 3, nodeType: 1, pseudoType: 'before' }, { nodeId: 4, nodeType: 1, pseudoType: 'after' }] }] };
    expect(pseudoNodesOf(doc)).toEqual([{ host: 'd', type: 'before', nodeId: 3 }, { host: 'd', type: 'after', nodeId: 4 }]);
    expect(() => pseudoNodesOf({ nodeId: 1, nodeType: 1, attributes: ['data-dragon-id', 'li'], pseudoElements: [{ nodeId: 2, nodeType: 1, pseudoType: 'marker' }] })).toThrow(/::marker/);
    expect(() => pseudoNodesOf({ nodeId: 1, nodeType: 1, pseudoElements: [{ nodeId: 2, nodeType: 1, pseudoType: 'before' }] })).toThrow(/no data-dragon-id/);
  });
  it('records the box, its line fragments when inline, its text node and the text\'s lines', () => {
    const text = { host: 'd', type: 'before', text: 'aa bb', boxes: [{ rect: [0, 0, 32, 16] as const, start: 0, length: 2 }, { rect: [0, 16, 32, 16] as const, start: 3, length: 2 }] };
    const nodes = generatedNodes({ host: 'd', type: 'before' }, [[0, 0, 32, 16], [0, 16, 32, 16]], { display: 'inline' }, text);
    expect(nodes.map((n) => [n.id, n.kind, n.x, n.y, n.width, n.height])).toEqual([
      ['d::before', 'element', 0, 0, 32, 32],
      ['d::before:line0', 'line', 0, 0, 32, 16],
      ['d::before:line1', 'line', 0, 16, 32, 16],
      ['d::before:text0', 'text', 0, 0, 32, 32],
      ['d::before:text0:line0', 'line', 0, 0, 32, 16],
      ['d::before:text0:line1', 'line', 0, 16, 32, 16],
    ]);
    const block = generatedNodes({ host: 'd', type: 'after' }, null, { display: 'block' }, undefined);
    expect(block.map((n) => [n.id, n.hasBox])).toEqual([['d::after', false]]);
  });
});

describe('pseudoSetProblems (R9 set check)', () => {
  const capture = { nodes: generatedNodes({ host: 'd', type: 'before' }, [[0, 0, 1, 1]], { display: 'block' }, undefined) };
  it('a box only Chrome or only Dragon has is a problem; the plant pseudoSetUnchecked skips the check', () => {
    expect(pseudoSetProblems(capture, ['html', 'd', 'd::before'])).toEqual([]);
    expect(pseudoSetProblems(capture, ['html', 'd'])).toEqual(['d::before: Chrome generates this box but Dragon does not']);
    expect(pseudoSetProblems(capture, ['d', 'd::before', 'd::after'])).toEqual(['d::after: Dragon generates this box but Chrome does not']);
    expect(pseudoSetProblems(capture, ['html', 'd'], { ...NO_PSEUDO_CAPTURE_FAULTS, pseudoSetUnchecked: true })).toEqual([]);
  });
});

describe('generatedBreakText (line-breaks.ts)', () => {
  it('puts each unit a box covers on that box\'s line, and the rest on none', () => {
    const t = { host: 'd', type: 'before', text: 'aa bb ', boxes: [{ rect: [0, 0, 32, 16] as const, start: 0, length: 2 }, { rect: [0, 16, 32, 16] as const, start: 3, length: 2 }] };
    expect(generatedBreakText(t)).toEqual({ id: 'd::before:text0', data: 'aa bb ', lines: 2, units: [0, 0, -1, 1, 1, -1], blank: [] });
  });
});
