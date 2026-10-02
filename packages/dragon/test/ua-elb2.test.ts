// ELB-2: the element-key tables, the unmodelled and forced properties, and the dark dataset with its system colors.
import { describe, expect, it } from 'vitest';
import { LONGHANDS } from '../src/css/properties.ts';
import * as dark from '../src/ua/chrome-145.darwin-arm64.dark.generated.ts';
import * as light from '../src/ua/chrome-145.darwin-arm64.generated.ts';
import { darkDatasetFor, referenceDataset, uaDatasetFor } from '../src/ua/datasets.ts';

const KEYS = ['button', 'input', 'input[type=range]', 'a', 'a[href]', 'img', 'span'];
const SYSTEM_COLORS = [
  'Canvas', 'CanvasText', 'LinkText', 'VisitedText', 'ActiveText', 'ButtonFace', 'ButtonText', 'ButtonBorder', 'Field', 'FieldText',
  'Highlight', 'HighlightText', 'SelectedItem', 'SelectedItemText', 'Mark', 'MarkText', 'GrayText', 'AccentColor', 'AccentColorText',
];

describe('element keys (ELB-2)', () => {
  it('are captured in tables of their own; the element-table tags and CapturedTag are unchanged', () => {
    for (const table of [light.elementKeySpecs, light.elementKeyComputed, light.elementKeyLonghands, light.elementKeyDeclared, light.elementKeyContexts, light.elementKeyTextFonts]) {
      expect(Object.keys(table)).toEqual(KEYS);
    }
    for (const table of [light.computed, light.userAgentLonghands, light.userAgentDeclared, light.userAgentContexts, light.userAgentTextFonts]) {
      for (const k of KEYS) expect(k in table, k).toBe(false);
    }
    expect(light.elementKeySpecs.button).toEqual({ tag: 'button', attributes: { type: 'button' } });
    expect(light.elementKeySpecs['a[href]'].attributes['href']).toBeTypeOf('string');
  });
  it('pin the declared values Chrome gives a button, an input, a link and an image', () => {
    expect(light.elementKeyDeclared.button.ltr).toMatchObject({ 'padding-left': '6px', 'padding-top': '1px', 'border-top-style': 'outset', 'border-top-width': '2px', 'font-size': '13.3333px', 'text-align': 'center', 'box-sizing': 'border-box' });
    expect(light.elementKeyDeclared.input.ltr).toMatchObject({ 'padding-left': '2px', 'border-top-style': 'inset', 'border-top-color': 'rgb(118, 118, 118)' });
    expect(light.elementKeyDeclared['input[type=range]'].ltr).toMatchObject({ 'margin-top': '2px', color: 'rgb(16, 16, 16)' });
    expect(light.elementKeyDeclared['a[href]'].ltr).toEqual({ color: 'rgb(0, 0, 238)' });
    expect(light.elementKeyDeclared.a).toEqual({ ltr: {}, rtl: {} });
    expect(light.elementKeyDeclared.span).toEqual({ ltr: {}, rtl: {} });
    expect(light.elementKeyDeclared.img.ltr).toEqual({ 'overflow-x': 'clip', 'overflow-y': 'clip' });
  });
  it('list the UA-set properties no longhand models, and the forced longhands', () => {
    expect(light.userAgentUnmodelled['button']?.ltr).toEqual({ appearance: 'auto', cursor: 'default' });
    expect(light.userAgentUnmodelled['input']?.ltr).toEqual({ appearance: 'auto', cursor: 'text' });
    expect(light.userAgentUnmodelled['a[href]']?.ltr).toMatchObject({ cursor: 'pointer', 'text-decoration-line': 'underline' });
    expect(light.userAgentUnmodelled['ol']?.ltr).toMatchObject({ 'list-style-type': 'decimal' });
    expect(light.userAgentUnmodelled['span']).toEqual({ ltr: {}, rtl: {} });
    expect(light.userAgentForced['input']?.ltr).toEqual({ display: 'inline-block', 'overflow-x': 'clip', 'overflow-y': 'clip' });
    expect(light.userAgentForced['button']?.ltr).toEqual({ display: 'inline-block' });
    // TDEC-a: a[href]'s text-decoration-line is a longhand now, applied from the capture by datasets.ts anyLink.
    for (const [key, dirs] of Object.entries(light.userAgentUnmodelled)) {
      for (const p of Object.keys(dirs.ltr)) expect((LONGHANDS as readonly string[]).includes(p) && !(key === 'a[href]' && p === 'text-decoration-line'), `${key} ${p}`).toBe(false);
    }
    for (const [key, dirs] of Object.entries(light.userAgentForced)) {
      for (const p of Object.keys(dirs.ltr)) expect((LONGHANDS as readonly string[]).includes(p), `${key} ${p}`).toBe(true);
    }
  });
});

describe('the dark UA dataset (ELB-2)', () => {
  it('is registered per platform next to the light one, and refused elsewhere', () => {
    const d = darkDatasetFor('darwin-arm64');
    expect(d.kind).toBe('ok');
    if (d.kind === 'ok') expect(d.dataset.computed).toBe(dark.computed);
    expect(darkDatasetFor('linux-x64')).toMatchObject({ kind: 'refused', code: 'no-ua-dataset', platform: 'linux-x64' });
    expect(uaDatasetFor('darwin-arm64')).toMatchObject({ kind: 'ok', dataset: { computed: light.computed } });
    expect(referenceDataset().computed).toBe(light.computed);
    expect([light.colorScheme, dark.colorScheme]).toEqual(['light', 'dark']);
    expect([dark.chromeVersion, dark.platform]).toEqual([light.chromeVersion, light.platform]);
  });
  it('covers the same tags and keys, with the dark root colors', () => {
    expect(Object.keys(dark.computed)).toEqual(Object.keys(light.computed));
    expect(Object.keys(dark.elementKeyComputed)).toEqual(KEYS);
    expect(dark.computed.html.color).toBe(dark.systemColors['CanvasText']);
    expect(light.computed.html.color).toBe(light.systemColors['CanvasText']);
    expect(dark.elementKeyDeclared['a[href]'].ltr.color).toBe(dark.systemColors['LinkText']);
    expect(dark.elementKeyDeclared.button.ltr['background-color']).toBe(dark.systemColors['ButtonFace']);
  });
  it('has a system color table for light and dark; names Chrome 145 does not parse are null', () => {
    for (const table of [light.systemColors, dark.systemColors]) expect(Object.keys(table)).toEqual(SYSTEM_COLORS);
    expect([light.systemColors['Canvas'], dark.systemColors['Canvas']]).toEqual(['rgb(255, 255, 255)', 'rgb(18, 18, 18)']);
    expect([light.systemColors['AccentColor'], light.systemColors['AccentColorText'], dark.systemColors['AccentColor']]).toEqual([null, null, null]);
    for (const n of SYSTEM_COLORS.filter((c) => !c.startsWith('Accent'))) expect(light.systemColors[n], n).toBeTypeOf('string');
  });
});

// REPL-0: the replaced keys (iframe, img with a data: src) in tables of their own after the element-key tables.
describe('replaced keys (REPL-0)', () => {
  const REPLACED = ['iframe', 'img[src]'];
  it('are captured in tables of their own, light and dark; the element-key tables do not list them', () => {
    for (const ds of [light, dark]) {
      for (const table of [ds.replacedKeySpecs, ds.replacedKeyComputed, ds.replacedKeyLonghands, ds.replacedKeyDeclared, ds.replacedKeyContexts, ds.replacedKeyTextFonts, ds.replacedKeyUnmodelled, ds.replacedKeyForced]) {
        expect(Object.keys(table)).toEqual(REPLACED);
      }
      for (const table of [ds.elementKeySpecs, ds.userAgentUnmodelled, ds.userAgentForced, ds.computed]) for (const k of REPLACED) expect(k in table, k).toBe(false);
    }
    expect(light.replacedKeySpecs['img[src]'].attributes['src']).toMatch(/^data:image\/png;base64,/);
  });
  it('pin the UA values Chrome gives an iframe and a loaded img', () => {
    const inset = Object.fromEntries(['top', 'right', 'bottom', 'left'].flatMap((s) => [[`border-${s}-style`, 'inset'], [`border-${s}-width`, '2px']]));
    expect(light.replacedKeyDeclared.iframe.ltr).toEqual(inset);
    expect(light.replacedKeyForced.iframe.ltr).toEqual({ 'overflow-x': 'clip', 'overflow-y': 'clip' });
    expect(light.replacedKeyUnmodelled.iframe.ltr).toEqual({ 'overflow-clip-margin': 'content-box' });
    expect(light.replacedKeyDeclared['img[src]']).toEqual(light.elementKeyDeclared.img);
    expect(light.replacedKeyUnmodelled['img[src]'].ltr).toEqual({ 'overflow-clip-margin': 'content-box' });
    expect(light.replacedKeyForced['img[src]']).toEqual({ ltr: {}, rtl: {} });
    expect(dark.replacedKeyDeclared).toEqual(light.replacedKeyDeclared);
  });
});
