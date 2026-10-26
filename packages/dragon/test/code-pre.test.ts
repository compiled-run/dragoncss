// code and pre (MONOSPACE_UA_TAGS): Chrome's UA font-family: monospace is refused, since Chrome sizes the generic monospace at its
// fixed font size; an author font-family (or font: inherit) replaces it, and the element then compiles. The parity fixtures
// code-pre, reject-element-pre and reject-ua-monospace-code check the same against Chrome 145.
import { describe, expect, it } from 'vitest';
import type { ElementNode, SourceRef, TreeNode } from '../src/index.ts';
import { createProject } from '../src/index.ts';
import { uaTagOf } from '../src/analysis/elements.ts';
import { div, inputFor, staticClass, text } from './helpers.ts';

const el = (ref: SourceRef, tag: string, id: string, classes: string[], children: TreeNode[]): ElementNode => ({
  ...div(ref, id, [], children), tag, classes: classes.map((name) => staticClass({ owner: 'doc', sheet: 's', name }, { kind: 'authored', span: { source: ref, start: 0, end: 0 } })),
});
const compile = (css: string, tag: string) => {
  const project = createProject({ projectId: 'test', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} } });
  return project.compile(inputFor(css, (ref) => [div(ref, 'p', ['p'], [el(ref, tag, 'm', ['m'], [text(ref, 'mt', 'XX')])])]));
};
const monospace = (c: ReturnType<typeof compile>) => c.diagnostics.filter((d) => d.message.includes("user-agent font-family: monospace")).map((d) => d.target);

describe('code and pre take an author font-family', () => {
  it.each(['code', 'pre'])("<%s> with Chrome's UA monospace is refused on every target", (tag) => {
    expect(monospace(compile('.p { font-family: Ahem; } .m { color: #000; }', tag)).sort()).toEqual(['android', 'ios', 'web']);
  });
  it.each(['code', 'pre'])('<%s> with an author font-family, font: inherit or font-family: inherit compiles', (tag) => {
    for (const css of ['.m { font-family: Ahem; }', '.m { font-family: inherit; }', '.m { font: inherit; }']) {
      expect(monospace(compile(`.p { font-family: Ahem; } ${css}`, tag)), css).toEqual([]);
    }
  });
  it.each(['code', 'pre'])('<%s> with font-family: revert rolls back to the UA monospace, and is refused', (tag) => {
    expect(monospace(compile('.p { font-family: Ahem; } .m { font-family: revert; }', tag))).not.toEqual([]);
  });
  it("code reads dragon-unstyled's defaults (its only UA longhand is font-family); pre has its own captured rows", () => {
    expect(uaTagOf('code')).toBe('dragon-unstyled');
    expect(uaTagOf('pre')).toBe('pre');
  });
});
