// Fixture group generated-content (GEN-a, notes/T151-gen-spec.md R2-R12): ::before and ::after with string content, built as
// elements of the resolved tree, inline in a wrapping block, blockified as flex items, absolutely positioned over a host with block
// children, as blocks, through the cascade and var(), beside the Tailwind preflight's statically empty pseudo-elements, and on hr and
// li. An empty inline generated box is proven in ltr only (gen-inline-empty): in rtl the engine places an empty inline box at the
// end of a run where Chrome does not, for real empty spans too. The rejects name the packages that own the rest.
import type { FixtureSpec } from '../fixtures.ts';
import { both, layout, reject, rejectTree } from './define.ts';

export const GENERATED_CONTENT: readonly FixtureSpec[] = [
  both('gen-inline-text'),
  layout('gen-inline-empty'),
  both('gen-flex-items'),
  both('gen-abspos-overlay'),
  both('gen-block'),
  both('gen-cascade'),
  both('gen-static-empty'),
  both('gen-hr-li'),
  reject('reject-gen-counter', 'DRAGON_UNSUPPORTED_VALUE', 'counter(x)', 'content: counter(x) is not supported yet: counters and their scopes (GEN-d1)'),
  reject('reject-gen-quote', 'DRAGON_UNSUPPORTED_VALUE', 'open-quote', 'content: open-quote is not supported yet: quotes and the quote depth (GEN-d2)'),
  reject('reject-gen-attr', 'DRAGON_UNSUPPORTED_VALUE', 'attr(data-x)', 'content: attr(data-x) is not supported yet: attr() (GEN-d3)'),
  reject('reject-gen-url', 'DRAGON_UNSUPPORTED_VALUE', 'url(x.png)', 'content: url(x.png) is not supported yet: an image in content'),
  reject('reject-gen-alt', 'DRAGON_UNSUPPORTED_VALUE', '/', 'content: / is not supported yet: alternative text after "/"'),
  reject('reject-gen-on-img', 'DRAGON_UNSUPPORTED_VALUE', "'x'", 'content: "x" on i::before is not supported yet: <img> is a replaced element'),
  // On master <input> is not a supported element (FORM-a), so the control host is refused as an element before R4 applies.
  reject('reject-gen-on-input-range', 'DRAGON_UNSUPPORTED_ELEMENT', '<input data-dragon-id="r" class="r" type="range">', '<input> r is not supported'),
  reject('reject-gen-display-list-item', 'DRAGON_UNSUPPORTED_VALUE', 'list-item', 'display: list-item on a::before is not supported yet on a generated box (the ::marker package GEN-d6)'),
  reject('reject-gen-preserved-newline', 'DRAGON_UNSUPPORTED_VALUE', '<div data-dragon-id="a" class="a">xx</div>', 'white-space-collapse: preserve on the inline box <::before> a::before'),
  rejectTree('reject-gen-state-dependent', 'DRAGON_UNSUPPORTED_VALUE', "'+'"),
  reject('reject-gen-abspos-beside-text', 'DRAGON_UNSUPPORTED_VALUE', 'absolute', 'position: absolute on a::after beside text in a would place it in the text\'s inline formatting context (CSS2 §9.2.1.1), which milestone 1 does not lay out (POSX-IFC)'),
  reject('reject-gen-placeholder-host', 'DRAGON_UNSUPPORTED_SELECTOR', '::placeholder', '::placeholder is accepted only when no element can host it'),
];
