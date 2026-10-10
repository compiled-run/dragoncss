// TXT1a-2 phase C (notes/T084-txt1a-2.md, T084J): native lowering accepts the real bundled static faces engine mode accepts, and
// refuses everything else as before: faces outside the manifest, variable faces, synthetic styles; non-Latin text stays refused by
// the engine the device runs.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Compiled, Diagnostic, FrontEndResult } from 'dragon';
import * as dragon from 'dragon';
import type { LayoutInput } from '@dragon/layout';
import { layout as engineLayout } from '@dragon/layout';
import { fixtureInput } from '../src/cases.ts';
import { fixtureToInput } from '../src/fixture-reader.ts';
import { layout } from '../src/fixture-groups/define.ts';
import { withFontMapAssets } from '../src/fixture-groups/fonts.ts';
import { FONT_REFERENCE_MAP } from '../src/font-reference.ts';
import { ENVIRONMENT } from '../src/fixtures.ts';
import { repoPath } from '../src/paths.ts';
import { referenceShapedMeasurer } from '../src/text-shaper-host.ts';

const LATO = 'sha256:d636e4683231f931eda222d588e944d082bfd3bdba02f928bee461c0f185b251';

const inputOf = (id: string): FrontEndResult => withFontMapAssets(fixtureInput(layout(id, ['ltr'], 'ahem')), FONT_REFERENCE_MAP);

// Phase C's lowering is off by default until phase R (InternalOptions.nativeRealFaces); these tests turn it on to keep proving it.
function compile(input: FrontEndResult, nativeRealFaces = true): Compiled<'ios' | 'android' | 'web'> {
  const project = dragon.createProjectWith(
    { projectId: 'dragon-parity', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} }, fonts: FONT_REFERENCE_MAP },
    { faults: dragon.NO_FAULTS, profiles: 'derive', direction: 'ltr', platform: 'darwin-arm64', rootFont: 'ahem', foldViewport: ENVIRONMENT.viewport, nativeRealFaces },
  );
  return project.compile(input);
}

const nativeErrors = (c: Compiled<string>): Diagnostic[] => c.diagnostics.filter((d) => d.severity === 'error' && (d.target === 'ios' || d.target === 'android' || d.target === null));

function nativeInput(c: Compiled<string>): LayoutInput {
  const p = dragon.nativeLayoutProjection(c, ENVIRONMENT, []);
  if (p.kind !== 'ready') throw new Error(p.reason);
  return p.input;
}

/** Every face family an engine input names. */
function families(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) for (const x of v) families(x, out);
  else if (typeof v === 'object' && v !== null) {
    const o = v as Record<string, unknown>;
    if (typeof o['family'] === 'string' && typeof o['size'] === 'number') out.add(o['family']);
    for (const x of Object.values(o)) families(x, out);
  }
  return out;
}

describe('TXT1a-2 phase C: native lowering of real bundled faces', () => {
  it('is off by default: native refuses Lato with the font refusal, and the engine lane lowers it in engine mode', () => {
    // The device runtime measures and draws only the bundled Ahem until phase R (emit/native-support.ts DragonBridge.measurer).
    const c = compile(inputOf('text-latin-lato'), false);
    expect(new Set(nativeErrors(c).map((d) => `${d.target} ${d.code}`))).toEqual(new Set(['ios DRAGON_UNSUPPORTED_FONT', 'android DRAGON_UNSUPPORTED_FONT']));
    expect([c.outputs.ios.kind, c.outputs.android.kind]).toEqual(['blocked', 'blocked']);
    expect(dragon.nativeLayoutProjection(c, ENVIRONMENT, []).kind).toBe('blocked');
    const engine = dragon.engineLayoutProjection(c, ENVIRONMENT, []);
    if (engine.kind !== 'ready') throw new Error(engine.reason);
    expect([...families(engine.input.root)].sort()).toEqual([LATO]);
    expect(c.digest).not.toBe(compile(inputOf('text-latin-lato')).digest);
  });

  it('lowers Lato for ios and android with the face id, with no font refusal and the engine projection equal to the native one', () => {
    const c = compile(inputOf('text-latin-lato'));
    expect(nativeErrors(c).map((d) => `${d.code}: ${d.message}`)).toEqual([]);
    expect([c.outputs.ios.kind, c.outputs.android.kind]).toEqual(['analysis-only', 'analysis-only']);
    const input = nativeInput(c);
    expect([...families(input.root)].sort()).toEqual([LATO]);
    expect(dragon.engineLayoutProjection(c, ENVIRONMENT, [])).toEqual(dragon.nativeLayoutProjection(c, ENVIRONMENT, []));
    const r = engineLayout(input, referenceShapedMeasurer());
    expect(r.kind).toBe('ok');
  });

  it('drops the UA font-weight refusal where a real bold face draws the text (Lato-Bold and Inter-Bold under h1 and h2)', () => {
    const c = compile(inputOf('text-latin-faces'));
    expect(nativeErrors(c).map((d) => `${d.code}: ${d.message}`)).toEqual([]);
    expect(families(nativeInput(c).root).size).toBeGreaterThan(3);
  });

  it('keeps refusing a synthetic style on native, with DRAGON_SYNTHETIC_FONT_STYLE', () => {
    const c = compile(inputOf('text-latin-synthetic'));
    const codes = nativeErrors(c).map((d) => `${d.target} ${d.code}`);
    expect(codes).toContain('ios DRAGON_SYNTHETIC_FONT_STYLE');
    expect(codes).toContain('ios DRAGON_UNSUPPORTED_FONT');
    expect(c.outputs.ios.kind).toBe('blocked');
  });

  it('keeps refusing a variable face on native with the existing font message', () => {
    const input = inputOf('text-latin-variable');
    const bytes = new Uint8Array(readFileSync(repoPath('docs/research/text-spike/fonts/Inter-VF.ttf')));
    const swapped = { ...input, snapshot: { ...input.snapshot, assets: input.snapshot.assets.map((a) => (a.id === 'vendor/fonts/Inter/Inter-Regular.ttf' ? { ...a, bytes, hash: `sha256:${createHash('sha256').update(bytes).digest('hex')}` } : a)) } };
    const c = compile(swapped);
    expect(nativeErrors(c).some((d) => d.target === 'ios' && d.code === 'DRAGON_UNSUPPORTED_FONT' && /has no layout mapping \(expected Ahem/.test(d.message))).toBe(true);
    expect(c.outputs.ios.kind).toBe('blocked');
  });

  it('keeps refusing a family that resolves to no bundled face (the platform system-ui), with the existing message', () => {
    const c = compile(inputOf('fonts-platform'));
    expect(nativeErrors(c).some((d) => d.target === 'ios' && d.code === 'DRAGON_UNSUPPORTED_FONT' && /^font-family: system-ui on .* has no layout mapping \(expected Ahem/.test(d.message))).toBe(true);
    expect(c.outputs.ios.kind).toBe('blocked');
  });

  it('leaves non-Latin text to the engine the device runs, which refuses it with a typed code', () => {
    const input = nativeInput(compile(inputOf('text-latin-words')));
    const greek = JSON.parse(JSON.stringify(input).replace('Waves and wind over the quiet harbour', 'Κύματα και άνεμος')) as LayoutInput;
    const r = engineLayout(greek, referenceShapedMeasurer());
    expect(r.kind === 'unsupported' ? r.unsupported.code : r.kind).toBe('text-script');
  });
});

describe('TXT1a-2 phase C off by default: an element whose own font is a real face is refused natively, not only its text', () => {
  // Review of #104: the strut of a block, a <br> or an inline box comes from the element's own font, so a Lato element holding only
  // Ahem text must still be refused on ios and android while the device runtime measures only Ahem (DragonBridge.measurer).
  const probe = (id: string, body: string): FrontEndResult => withFontMapAssets(fixtureToInput(id, `<!DOCTYPE html>
<html data-dragon-id="html">
<head>
<style>
body { margin: 0; font-family: Ahem; }
.lato { font-family: Lato; }
.ahem { font-family: Ahem; }
</style>
</head>
<body data-dragon-id="body">
${body}
</body>
</html>
`), FONT_REFERENCE_MAP);
  const probes: readonly (readonly [string, string])[] = [
    ['block', '<div data-dragon-id="d" class="lato"><span data-dragon-id="s" class="ahem">XX XX</span></div>'],
    ['br', '<div data-dragon-id="d" class="lato"><span data-dragon-id="s" class="ahem">XX</span><br data-dragon-id="b"><span data-dragon-id="t" class="ahem">XX</span></div>'],
    ['inline-box', '<div data-dragon-id="d"><span data-dragon-id="i" class="lato"><span data-dragon-id="s" class="ahem">XX XX</span></span></div>'],
  ];
  it.each(probes)('%s: refused with DRAGON_UNSUPPORTED_FONT on ios and android, and no native projection names Lato', (id, body) => {
    const c = compile(probe(`txt1a-real-strut-${id}`, body), false);
    const fonts = nativeErrors(c).filter((d) => d.code === 'DRAGON_UNSUPPORTED_FONT').map((d) => d.target);
    expect(new Set(fonts)).toEqual(new Set(['ios', 'android']));
    expect([c.outputs.ios.kind, c.outputs.android.kind]).toEqual(['blocked', 'blocked']);
    expect(dragon.nativeLayoutProjection(c, ENVIRONMENT, []).kind).toBe('blocked');
  });
  it.each(probes)('%s: lowered natively with the Lato strut when phase C is on', (id, body) => {
    const c = compile(probe(`txt1a-real-strut-${id}`, body), true);
    expect(nativeErrors(c)).toEqual([]);
    expect(families(nativeInput(c).root).has(LATO)).toBe(true);
  });
});
