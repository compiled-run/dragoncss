// The used colour scheme (css-color-adjust-1 §2.1). The used scheme selects dark resolution for system colours and UA defaults; the consumers that
// resolve colours (FORM, UA) do not exist yet, so a dark element whose colours need dark resolution is refused here.
import type { Longhand } from '../../css/properties.ts';
import { colorSchemeOf, usedColorSchemeOf } from '../../css/properties/effects.ts';
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import type { ResolvedValue } from '../computed.ts';
import type { ResolvedElement } from '../resolve.ts';
import type { PaintCheck, PaintValues } from './types.ts';

/** The reference environment's preferred scheme: Chrome's default, light (the captures run without prefers-color-scheme). */
export const PREFERS_DARK = false;

/** The used colour scheme of an element from its computed color-scheme. */
export function usedColorScheme(el: { readonly props: ReadonlyMap<Longhand, ResolvedValue> }): 'light' | 'dark' {
  const v = el.props.get('color-scheme');
  if (v === undefined) throw new Error('color-scheme did not resolve');
  return usedColorSchemeOf(colorSchemeOf(v.value), PREFERS_DARK);
}

/**
 * A dark element whose colours need dark resolution: the root (Chrome paints the canvas #121212 and computes its initial color to
 * CanvasText, white) and any element whose color is initial (CanvasText). The captured UA colours of every supported tag are the
 * same under light and dark (test/paint-color-scheme.test.ts pins it), and system colours and light-dark() are refused where they
 * are parsed, so these are the only cases.
 */
const checkColorScheme: PaintCheck = (el: ResolvedElement, targets, diagnostics, reported) => {
  if (usedColorScheme(el) !== 'dark') return;
  const color = el.props.get('color') as ResolvedValue;
  const root = el.element.tag === 'html';
  if (!root && color.origin !== 'initial') return;
  const scheme = el.props.get('color-scheme') as ResolvedValue;
  const origin = scheme.declaration === null ? el.element.node.origin : authored(scheme.declaration.valueSpan);
  const what = root ? `the root ${el.element.address} has a dark used color scheme, so Chrome paints the canvas dark and computes its initial color to CanvasText` : `${el.element.address} has a dark used color scheme and an initial color, which Chrome computes to CanvasText in dark`;
  for (const t of targets) {
    const id = `${t}|color-scheme-dark|${el.element.address}`;
    if (reported.has(id)) continue;
    reported.add(id);
    diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
      origin,
      target: t,
      message: `${what}; Dragon has no dark consumer for the canvas and system colours yet (PNT1 resolves color-scheme; the dark tables are FORM's and UA's)`,
      manual: 'Set color-scheme: dark on body or a descendant with an explicit color, or keep the root light.',
      basis: 'computed-value',
    }));
  }
};

export const EFFECTS_VALUES: PaintValues = { name: 'effects', check: checkColorScheme, compute: () => {} };
