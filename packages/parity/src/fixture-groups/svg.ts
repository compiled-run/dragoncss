// Fixture group svg (SVG-a1, docs/goals/milestone-2-proof/notes/T-svg-a-spec.md): inline <svg> as a block-level replaced box and
// flex item, drawing <path>,
// <rect> and <circle> with fill, stroke and stroke-width from CSS and presentation attributes, under every viewBox case of
// xMidYMid meet, in both directions. Their shapes are proven by the strict outline differential (svg-compare.ts); the rejects
// name what SVG-a1 refuses.
import { readFileSync } from 'node:fs';
import type { FixtureSpec } from '../fixtures.ts';
import { repoPath } from '../paths.ts';
import { both, reject } from './define.ts';

/** The start tag of the element with this data-dragon-id: an attribute diagnostic spans its element's start tag. */
const startTag = (fixture: string, id: string): string => {
  const m = new RegExp(`<[a-z]+ data-dragon-id="${id}"[^>]*>`).exec(readFileSync(repoPath(`packages/parity/fixtures/${fixture}.html`), 'utf8'));
  if (m === null) throw new Error(`${fixture} has no element ${id}`);
  return m[0];
};

/** The whole element with this data-dragon-id, start tag to end tag: an element diagnostic spans it. */
const element = (fixture: string, id: string, tag: string): string => {
  const m = new RegExp(`<${tag} data-dragon-id="${id}"[\\s\\S]*?</${tag}>`).exec(readFileSync(repoPath(`packages/parity/fixtures/${fixture}.html`), 'utf8'));
  if (m === null) throw new Error(`${fixture} has no <${tag}> ${id}`);
  return m[0];
};

export const SVG: readonly FixtureSpec[] = [
  both('svg-basic'),
  both('svg-viewbox'),
  both('svg-paint'),
  both('svg-flex'),
  both('svg-hidden'),
  reject('reject-svg-inline', 'DRAGON_UNSUPPORTED_VALUE', element('reject-svg-inline', 'a', 'svg'), 'display: inline on <svg> a makes it an inline-level replaced box'),
  reject('reject-svg-ratio', 'DRAGON_UNSUPPORTED_VALUE', element('reject-svg-ratio', 'a', 'svg'), '<svg> a has a viewBox and width and height auto'),
  reject('reject-svg-arc', 'DRAGON_UNSUPPORTED_ATTRIBUTE', startTag('reject-svg-arc', 'p'), 'attribute d="M2 12 A10 10 0 0 1 22 12" on p is not supported: elliptical arc commands are not built yet (package SVG-arc)'),
  reject('reject-svg-units', 'DRAGON_UNSUPPORTED_ATTRIBUTE', startTag('reject-svg-units', 'a'), 'attribute width="2em" on a is not supported: only numbers and px lengths are built (package SVG-units)'),
  reject('reject-svg-group', 'DRAGON_UNSUPPORTED_ELEMENT', element('reject-svg-group', 'g', 'g'), '<g> g is not supported'),
  reject('reject-svg-paint-url', 'DRAGON_UNSUPPORTED_ATTRIBUTE', startTag('reject-svg-paint-url', 'r'), 'attribute fill="url(#p)" on r is not supported'),
  reject('reject-svg-dash', 'DRAGON_UNSUPPORTED_ATTRIBUTE', startTag('reject-svg-dash', 'p'), 'attribute stroke-dasharray on p is not supported: its rendering effect belongs to the SVG dash package SVG-dash'),
  reject('reject-svg-shape-width', 'DRAGON_UNSUPPORTED_VALUE', '5px', 'width: 5px on <rect> r is not supported'),
  reject('reject-svg-shape-outside', 'DRAGON_UNSUPPORTED_ELEMENT', element('reject-svg-shape-outside', 'r', 'rect'), '<rect> r outside an <svg> is not supported'),
  reject('reject-svg-stroke-percent', 'DRAGON_UNSUPPORTED_VALUE', '10%', 'stroke-width: 10% on <rect> r is unsupported'),
];
