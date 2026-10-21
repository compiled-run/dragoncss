// compositing-1 §9.2: background-blend-mode is accepted as the single keyword normal alone (css/properties/background-blend.ts).
// Anything else is refused on every target, once per element: no target blends background layers yet, and a blend mode can make
// text over a background unreadable. The value is checked computed, so a mode that arrives through var() or inherit is refused too.
import { authored, diagnostic } from '../diagnostics/catalogue.ts';
import { BACKGROUND_BLEND_INITIAL, isInitialBackgroundBlend } from '../css/properties/background-blend.ts';
import type { BackgroundBlendFaults } from '../faults/background-blend.ts';
import type { Diagnostic } from '../types.ts';
import type { ResolvedElement, ResolvedValue } from './resolve.ts';
import { valueToString } from './resolve.ts';

/** Refuses a background-blend-mode other than normal; planted fault backgroundBlendAccepted accepts it. */
export function checkBackgroundBlend(el: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>, faults: BackgroundBlendFaults): void {
  if (faults.backgroundBlendAccepted) return;
  const v = el.props.get('background-blend-mode') as ResolvedValue;
  if (isInitialBackgroundBlend(v.value)) return;
  const id = `background-blend|${el.element.address}`;
  if (reported.has(id)) return;
  reported.add(id);
  const origin = v.declaration !== null ? authored(v.declaration.valueSpan) : el.element.node.origin;
  for (const t of targets) {
    diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
      origin,
      target: t,
      message: `background-blend-mode: ${valueToString(v.value)} on <${el.element.tag}> ${el.element.address} is unsupported: Dragon blends no background layers yet (BG2); only ${BACKGROUND_BLEND_INITIAL} is accepted`,
      manual: `Remove background-blend-mode from ${el.element.address}, or set background-blend-mode: ${BACKGROUND_BLEND_INITIAL}.`,
      basis: 'computed-value',
    }));
  }
}
