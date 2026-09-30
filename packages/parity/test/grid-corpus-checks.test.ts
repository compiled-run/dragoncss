// The G-P differential test's own checks: the corpus parser rejects malformed files, and a refusal counts as owned only when every
// reason is owned by an out-of-scope package.
import { describe, expect, it } from 'vitest';
import { classifyOutcome, parseCorpusFamily } from '../src/grid-corpus.ts';

const result = { c: [0, 0, 64, 64], cols: '10px', rows: '10px', items: [[0, 0, 64, 64]] };
const file = (over: { envs?: unknown; cb?: unknown; after?: unknown; result?: unknown } = {}): string => {
  const envs = over.envs ?? ['dpr1-ltr-horizontal-tb', 'dpr1-rtl-horizontal-tb'];
  const env = (envs as unknown[]).map(() => 0);
  const kase: Record<string, unknown> = { note: '', cb: over.cb ?? [100, 100], html: '<div data-i="i0"></div>', labels: ['i0'], env, distinct: [over.result ?? result] };
  if ('after' in over) kase['after'] = over.after;
  return JSON.stringify({ envs, cases: { k: kase } });
};

describe('corpus parser', () => {
  it('accepts a well-formed file', () => {
    expect(parseCorpusFamily('f', file()).map((c) => c.id)).toEqual(['k']);
  });
  it('rejects duplicate environments, horizontal-tb environments the test does not run, a non-finite wrapper, a non-string after and missing track sizes', () => {
    expect(() => parseCorpusFamily('f', file({ envs: ['dpr1-ltr-horizontal-tb', 'dpr1-ltr-horizontal-tb'] }))).toThrow(/duplicate envs/);
    expect(() => parseCorpusFamily('f', file({ envs: ['dpr1.5-ltr-horizontal-tb'] }))).toThrow(/does not run/);
    expect(() => parseCorpusFamily('f', file({ cb: [7777, 100] }).replace('7777', '1e999'))).toThrow(/bad wrapper size/);
    expect(() => parseCorpusFamily('f', file({ after: 3 }))).toThrow(/after is not a string/);
    expect(() => parseCorpusFamily('f', file({ result: { ...result, cols: undefined } }))).toThrow(/no complete result/);
  });
});

describe('refusal classification', () => {
  it('counts a refusal as owned only when every reason is owned, under the first reason', () => {
    expect(classifyOutcome('k', { kind: 'refused', reasons: ['DRAGON_X: subgrid', 'DRAGON_Y: writing-mode'] })).toEqual({ kind: 'refused', category: 'subgrid' });
    expect(classifyOutcome('k', { kind: 'refused', reasons: ['DRAGON_X: subgrid', 'DRAGON_Y: something else'] })).toMatchObject({ kind: 'problem' });
    expect(classifyOutcome('k', { kind: 'refused', reasons: [] })).toMatchObject({ kind: 'problem' });
  });
  it('judges a mismatch by the pinned list', () => {
    expect(classifyOutcome('k', { kind: 'mismatch', detail: 'x' })).toEqual({ kind: 'problem', detail: 'k: x' });
    expect(classifyOutcome('k', { kind: 'match' })).toEqual({ kind: 'match' });
  });
});
