// css-anchor-position-1 at build time (lower/anchor-layout.ts): the physical position area of each keyword form, and every part of
// the spec Dragon does not lower refused by name on the native targets while the web output keeps it (the parity fixtures anchor-*
// prove what is lowered against Chrome).
import { describe, expect, it } from 'vitest';
import type { ElementNode, Origin, SourceRef, TreeNode } from '../src/index.ts';
import { createProjectWith, NO_FAULTS } from '../src/internal.ts';
import { physicalArea } from '../src/lower/anchor-layout.ts';
import { DOC, inputFor, staticClass, text } from './helpers.ts';

const project = () => createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, web: {} } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' });

function el(ref: SourceRef, id: string, tag: string, classes: string[] = [], children: TreeNode[] = []): ElementNode {
  const origin: Origin = { kind: 'authored', span: { source: ref, start: 0, end: 0 } };
  return { kind: 'element', id, tag, classes: classes.map((name) => staticClass({ owner: DOC, sheet: 's', name }, origin)), attributes: [], children, origin };
}

/** The error messages per target for a containing block holding an anchor k and a positioned box p (and an inline anchor s). */
function errors(css: string): { readonly ios: string[]; readonly web: string[] } {
  const all = `body { font-family: Ahem; font-size: 10px; } .cb { position: relative; width: 200px; height: 100px; } .k { width: 20px; height: 10px; anchor-name: --k; } .p { position: absolute; width: 10px; height: 10px; } ${css}`;
  const c = project().compile(inputFor(all, (r) => [el(r, 'cb', 'div', ['cb'], [el(r, 'k', 'div', ['k']), el(r, 'x', 'div', [], [el(r, 's', 'span', ['s'], [text(r, 't', 'X')])]), el(r, 'p', 'div', ['p'])])]));
  const at = (t: string): string[] => c.diagnostics.filter((d) => d.severity === 'error' && d.target === t).map((d) => d.message);
  return { ios: at('ios'), web: at('web') };
}

describe('anchor positioning at build time', () => {
  it('turns every keyword form of position-area into its physical rows and columns (position_area.cc ToPhysical)', () => {
    const area = (k: string, rtl = false): string => {
      const a = physicalArea(k.split(' '), rtl, 'p');
      return `${a.rowStart}-${a.rowEnd} ${a.columnStart}-${a.columnEnd}`;
    };
    expect(area('block-end')).toBe('end-end start-end');
    expect(area('block-start')).toBe('start-start start-end');
    expect(area('top left')).toBe('start-start start-start');
    expect(area('left top')).toBe('start-start start-start');
    expect(area('span-left top')).toBe('start-start start-center');
    expect(area('center')).toBe('center-center center-center');
    expect(area('span-all')).toBe('start-end start-end');
    expect(area('start end')).toBe('start-start end-end');
    expect(area('start end', true)).toBe('start-start start-start');
    expect(area('inline-start', true)).toBe('start-end end-end');
    expect(area('span-inline-end', true)).toBe('start-end start-center');
    expect(area('x-start y-end', true)).toBe('end-end end-end');
    expect(area('left', true)).toBe('start-end start-start');
    expect(area('span-start')).toBe('start-center start-center');
  });

  it('lays out an anchored box on both targets', () => {
    expect(errors('.p { position-anchor: --k; position-area: bottom; width: anchor-size(width); top: 2px; }')).toEqual({ ios: [], web: [] });
  });

  it('refuses on native, by name, each part it does not lower, and keeps the web output', () => {
    const refused = (css: string, message: string): void => {
      const e = errors(css);
      expect(e.web, css).toEqual([]);
      expect(e.ios.some((m) => m.includes(message)), `${css}: ${e.ios.join(' | ')}`).toBe(true);
    };
    refused('.p { position-anchor: --k; position-try-fallbacks: --named; }', 'names an @position-try rule');
    refused('.p { position-anchor: --k; margin-top: anchor-size(height); }', 'anchor-size() in a margin is not lowered yet');
    refused('.p { position-anchor: --k; top: anchor-size(height); }', 'anchor-size() in an inset is not lowered yet');
    refused('.p { position-anchor: auto; position-area: top; }', 'uses an implicit anchor element');
    refused('.s { anchor-name: --inline; } .p { position-anchor: --inline; position-area: top; }', 'is an inline box');
    refused('.p { position-anchor: --k; direction: rtl; position-area: top; }', 'has direction rtl in a ltr containing block');
    refused('.p { top: anchor(--k bottom, 1em); }', "an anchor function's fallback 1em is not px, % or 0");
    refused('.p { position-anchor: --k; position-area: top; justify-self: center; }', 'Dragon lowers normal and anchor-center self-alignment on an anchored box');
    refused('.cb { top: anchor(--k bottom, 4px); }', 'an anchor function on a box that is not absolutely positioned takes its fallback');
  });

  it('refuses position-visibility on every target: Dragon hides no anchored box', () => {
    const e = errors('.p { position-anchor: --k; position-area: top; position-visibility: no-overflow; }');
    expect(e.ios.some((m) => m.startsWith('position-visibility: no-overflow on <div> p is unsupported'))).toBe(true);
    expect(e.web.some((m) => m.startsWith('position-visibility: no-overflow on <div> p is unsupported'))).toBe(true);
  });
});
