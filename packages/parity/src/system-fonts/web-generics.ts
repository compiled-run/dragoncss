// Which platform font each system face role is, as the web draws it: Safari on iOS and Chrome on Android, measured 2026-11-18
// (docs/system-fonts.md "Which font each generic is"). A role's faces are the weights and styles the platform has for it.
import type { SystemFaceRole } from 'dragon';
import type { CoreTextFace } from './coretext.ts';

/**
 * lineMetrics 'webkit-15-percent': WebKit adds 0.15 * (ascent + descent), rounded up, to the ascent of this family (FontCocoa.mm;
 * Safari on iOS does it for Helvetica, not for Times New Roman or Courier, measured).
 */
type IosFace = { readonly weight: number; readonly style: 'normal' | 'italic'; readonly face: CoreTextFace; readonly lineMetrics?: 'webkit-15-percent' };

/** UIFont.Weight's nine values, which WebKit requests the system font at for CSS weights 100 to 900. */
const UI_WEIGHTS: readonly (readonly [number, number])[] = [[100, -0.8], [200, -0.6], [300, -0.4], [400, 0], [500, 0.23], [600, 0.3], [700, 0.4], [800, 0.56], [900, 0.62]];
const system = (design: 'default' | 'serif' | 'monospaced'): IosFace[] => UI_WEIGHTS.map(([weight, w]) => ({ weight, style: 'normal', face: { kind: 'system', weight: w, design } }));
const named = (regular: string, bold: string, adjust: Pick<IosFace, 'lineMetrics'> = {}): IosFace[] => [
  { weight: 400, style: 'normal', face: { kind: 'name', postScriptName: regular }, ...adjust },
  { weight: 700, style: 'normal', face: { kind: 'name', postScriptName: bold }, ...adjust },
];

export const IOS_ROLE_FACES: { readonly [R in SystemFaceRole]: readonly IosFace[] } = {
  'system-ui': system('default'),
  'sans-serif': named('Helvetica', 'Helvetica-Bold', { lineMetrics: 'webkit-15-percent' }),
  serif: named('TimesNewRomanPSMT', 'TimesNewRomanPS-BoldMT'),
  monospace: named('Courier', 'Courier-Bold'),
  default: named('TimesNewRomanPSMT', 'TimesNewRomanPS-BoldMT'),
};

/** The fonts.xml family each role is in Chrome on Android; with no font-family Chrome's default is Times New Roman, aliased to serif. */
export const ANDROID_ROLE_FAMILIES: { readonly [R in SystemFaceRole]: string } = {
  'system-ui': 'sans-serif',
  'sans-serif': 'sans-serif',
  serif: 'serif',
  monospace: 'monospace',
  default: 'serif',
};
