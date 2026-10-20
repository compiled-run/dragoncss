// Fixture group animations (T065 ANIM-b1): one reject fixture per refusal of the spec's §1 table other than ANIM-m (ANIM-b2).
// The frame fixtures that prove the supported rows come with the runtime and its lanes (PR 3).
import type { FixtureSpec } from '../fixtures.ts';
import { reject, rejectTree } from './define.ts';

export const ANIMATIONS: readonly FixtureSpec[] = [
  reject('reject-anim-linear-easing', 'DRAGON_UNSUPPORTED_VALUE', 'width 1s linear(0, 1)', 'transition: linear(0,1) is unsupported: linear() easing is not built yet (package ANIM-L)'),
  reject('reject-anim-allow-discrete', 'DRAGON_UNSUPPORTED_VALUE', 'width 1s allow-discrete', 'transition: allow-discrete is unsupported'),
  reject('reject-anim-composition', 'DRAGON_UNSUPPORTED_VALUE', 'add', 'animation-composition: add is unsupported'),
  reject('reject-anim-timeline', 'DRAGON_UNSUPPORTED_VALUE', 'scroll()', 'animation-timeline: scroll() is unsupported'),
  reject('reject-anim-keyframes-in-media', 'DRAGON_UNSUPPORTED_AT_RULE', '@keyframes k { to { width: 20px; } }', '@keyframes inside @media is not supported (package MQ-R)'),
  reject('reject-anim-keyframe-important', 'DRAGON_UNSUPPORTED_IMPORTANT', 'width: 20px !important', '!important on width in @keyframes k'),
  reject('reject-anim-keyframe-invalid-property', 'DRAGON_UNSUPPORTED_PROPERTY', 'animation-delay: 1s', 'animation-delay has no effect inside @keyframes in Chrome; remove it'),
  reject('reject-anim-keyframe-wide-keyword', 'DRAGON_UNSUPPORTED_VALUE', 'inherit', 'width: inherit in @keyframes k is unsupported'),
  reject('reject-anim-keyframe-currentcolor', 'DRAGON_UNSUPPORTED_VALUE', 'currentcolor', 'background-color: currentcolor in @keyframes k is unsupported'),
  reject('reject-anim-keyframe-unadmitted', 'DRAGON_UNSUPPORTED_VALUE', '2', 'flex-grow in @keyframes k cannot be animated yet'),
  reject('reject-anim-keyframes-per-element', 'DRAGON_UNSUPPORTED_VALUE', '2em', 'width: 2em is unsupported: one @keyframes resolves to different values'),
  reject('reject-anim-var', 'DRAGON_UNSUPPORTED_VALUE', 'var(--t)', 'transition: substitutes to "color 1s linear(0, 1)"'),
  reject('reject-anim-calc-time', 'DRAGON_UNSUPPORTED_VALUE', 'calc(1s + 1ms)', 'transition: calc(1s + 1ms) is unsupported'),
  rejectTree('reject-tree-anim-overlap', 'DRAGON_UNSUPPORTED_VALUE', 'color 1s'),
  rejectTree('reject-tree-anim-timing-change', 'DRAGON_UNSUPPORTED_VALUE', 'k 1s 2'),
  rejectTree('reject-tree-anim-unadmitted', 'DRAGON_UNSUPPORTED_VALUE', 'border-top-width 1s'),
];
