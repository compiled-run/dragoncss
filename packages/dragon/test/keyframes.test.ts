// T065 R10 and §1: @keyframes is accepted at the top level and refused inside a conditional group; its blocks parse into
// offsets, an easing and milestone longhands, with Chrome's rules inside keyframes refused or reported.
import { describe, expect, it } from 'vitest';
import type { KeyframesRule, KeyframesSource } from '../src/css/at-rules/keyframes.ts';
import { parseKeyframesRules } from '../src/css/at-rules/keyframes.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import type { Diagnostic, SourceRef } from '../src/index.ts';

const SRC: SourceRef = { uri: 'dragon-source://test/k.css', revision: 'r1', hash: 'sha256:0' };

function parse(text: string): { rules: KeyframesRule[]; diagnostics: Diagnostic[]; found: string[] } {
  const diagnostics: Diagnostic[] = [];
  const sources: KeyframesSource[] = [];
  parseStylesheet(text, { source: SRC, start: 0, end: text.length }, { id: 's', owner: 'o', scope: 'document' }, 0, diagnostics, [], [], sources);
  const rules = parseKeyframesRules(sources, diagnostics);
  const found = diagnostics.map((d) => `${d.code}: ${text.slice(d.origin.kind === 'authored' ? d.origin.span.start : 0, d.origin.kind === 'authored' ? d.origin.span.end : 0)}`);
  return { rules, diagnostics, found };
}

describe('@keyframes', () => {
  it('accepts a top-level rule with offsets, selector lists, a keyframe easing and shorthand expansion', () => {
    const { rules, diagnostics } = parse('@keyframes spin { from { margin: 1px 2px } 25%, 60.5% { color: rgb(1, 2, 3); animation-timing-function: steps(2) } to { width: 3px } }');
    expect(diagnostics).toEqual([]);
    expect(rules.map((r) => [r.name, r.blocks.map((b) => [b.offsets, b.easing?.text ?? null, b.values.map((v) => v.property)])])).toEqual([
      ['spin', [
        [[0], null, ['margin-top', 'margin-right', 'margin-bottom', 'margin-left']],
        [[0.25, 0.605], 'steps(2)', ['color']],
        [[1], null, ['width']],
      ]],
    ]);
    expect(parse('@keyframes "a b" { to { width: 1px } }').rules.map((r) => r.name)).toEqual(['a b']);
  });

  it('refuses @keyframes inside @media (MQ-R) and a rule Chrome drops, and keeps every other at-rule refused', () => {
    expect(parse('@media (max-width: 500px) { @keyframes k { to { width: 1px } } }').diagnostics.map((d) => d.message)).toEqual(['@keyframes inside @media is not supported (package MQ-R)']);
    for (const bad of ['@keyframes none { to { width: 1px } }', '@keyframes initial { to { width: 1px } }', '@keyframes k;']) {
      expect(parse(bad).diagnostics.map((d) => d.code), bad).toEqual(['DRAGON_UNSUPPORTED_AT_RULE']);
    }
    expect(parse('@-webkit-keyframes k { to { width: 1px } }').diagnostics.map((d) => d.code)).toEqual(['DRAGON_UNSUPPORTED_AT_RULE']);
  });

  it('reports keyframe selectors Chrome drops and timeline ranges (ANIM-S), dropping the block', () => {
    const { rules, found } = parse('@keyframes k { 120% { width: 1px } entry 10% { width: 2px } to { width: 3px } }');
    expect(found).toEqual(['DRAGON_CSS_PARSE: 120%', 'DRAGON_UNSUPPORTED_VALUE: entry 10%']);
    expect(rules[0]?.blocks.map((b) => b.offsets)).toEqual([[1]]);
  });

  it('refuses what Chrome ignores inside keyframes, CSS-wide keywords (ANIM-k), var() (ANIM-v) and keyframe composites (ANIM-c)', () => {
    const { rules, diagnostics } = parse(`@keyframes k { from { width: 1px !important; animation-duration: 2s; animation-composition: add; color: inherit; height: var(--h); foo: 1; } to { width: 2px } }`);
    expect(diagnostics.map((d) => [d.code, /\(package ([A-Za-z-]+)\)/.exec(d.message)?.[1] ?? d.message.split(':')[0]])).toEqual([
      ['DRAGON_UNSUPPORTED_IMPORTANT', '!important on width in @keyframes k'],
      ['DRAGON_UNSUPPORTED_PROPERTY', 'animation-duration has no effect inside @keyframes in Chrome; remove it'],
      ['DRAGON_UNSUPPORTED_VALUE', 'ANIM-c'],
      ['DRAGON_UNSUPPORTED_VALUE', 'ANIM-k'],
      ['DRAGON_UNSUPPORTED_VALUE', 'ANIM-v'],
      ['DRAGON_UNSUPPORTED_PROPERTY', 'foo inside @keyframes k is not supported in milestone 1'],
    ]);
    // The refusals that delete the declaration carry the edit their catalogue entry needs.
    expect(diagnostics.filter((d) => d.code !== 'DRAGON_UNSUPPORTED_VALUE').every((d) => d.fix !== null && 'edits' in d.fix && d.fix.edits.length === 1)).toBe(true);
    expect(rules[0]?.blocks.map((b) => b.values.length)).toEqual([0, 1]);
  });

  it('reports a keyframe easing that is not one timing function, and refuses linear() (ANIM-L)', () => {
    expect(parse('@keyframes k { from { animation-timing-function: ease, linear } }').diagnostics.map((d) => d.code)).toEqual(['DRAGON_CSS_INVALID_VALUE']);
    expect(parse('@keyframes k { from { animation-timing-function: linear(0, 1) } }').diagnostics.map((d) => /package ([A-Z-]+)/.exec(d.message)?.[1])).toEqual(['ANIM-L']);
  });
});
