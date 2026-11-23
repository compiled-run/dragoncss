// FORM-search: a search field draws as a text field of the same styles in Chrome 145 except while focused with a value (the cancel
// icon), so Dragon compiles a readonly one as a text field whose editor ends before the cancel button, refuses the cases the spec
// keeps refused, and compiles the Markless notes list's search field readonly (notes/FORM-search-spec.md facts 7 and 8, R1, R5).
import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createProjectWith, NO_FAULTS } from 'dragon';
import { launchChrome } from '../src/chrome.ts';
import { ENVIRONMENT } from '../src/fixtures.ts';
import { fixtureToInput, PROJECT_ID } from '../src/fixture-reader.ts';
import { marklessStyleExport } from '../src/markless-style-input.ts';
import { REFERENCE_PLATFORM } from '../src/platform.ts';

const PILL = '* { box-sizing: border-box; }\nbody { margin: 0; font-family: Ahem; font-size: 16px; }\ninput { display: block; font: inherit; color: #000; width: 300px; padding: 12px 16px; border: 1px solid #c9c2ad; border-radius: 999px; background-color: #fffdf7; }';
const page = (field: string, extra = ''): string => `<!DOCTYPE html>\n<html data-dragon-id="html">\n<head>\n<style>\n${PILL}\n${extra}\n</style>\n</head>\n<body data-dragon-id="body">${field}</body>\n</html>\n`;
const errors = (html: string): string[] =>
  createProjectWith({ projectId: PROJECT_ID, targets: { ios: { minimum: '15.0' }, web: {} } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr', platform: REFERENCE_PLATFORM, rootFont: 'ahem', foldViewport: ENVIRONMENT.viewport })
    .compile(fixtureToInput('form-search', html))
    .diagnostics.filter((d) => d.severity === 'error')
    .map((d) => d.message);

describe('a search field (FORM-search)', () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await launchChrome(1);
  }, 120_000);
  afterAll(async () => {
    await browser?.close();
  });

  it("draws as a text field in Chrome except while focused with a value, where Chrome paints the cancel icon", async () => {
    const shot = async (type: string, attrs: string, focus: boolean, hover = false): Promise<string> => {
      const p = await browser.newPage({ viewport: { width: 320, height: 60 } });
      await p.setContent(page(`<input id="i" type="${type}" ${attrs}>`));
      if (focus) await p.focus('#i');
      if (hover) await p.hover('#i');
      const png = (await p.screenshot()).toString('base64');
      await p.close();
      return png;
    };
    for (const [attrs, focus] of [['placeholder="PP PP"', false], ['value="XX XX"', false], ['value="XXXXXXXXXXXXXXXXXX"', false], ['', true]] as const) {
      expect((await shot('search', attrs, focus)) === (await shot('text', attrs, focus)), `${attrs} focused=${focus}`).toBe(true);
    }
    expect((await shot('search', 'value="XX"', true)) === (await shot('text', 'value="XX"', true)), 'focused with a value').toBe(false);
    // The states Dragon compiles: a readonly field with a value hides the icon while focused, hovered or both (R3).
    for (const [focus, hover] of [[true, false], [false, true], [true, true]] as const) {
      expect((await shot('search', 'readonly value="XX"', focus, hover)) === (await shot('text', 'readonly value="XX"', focus, hover)), `readonly with a value, focused=${focus} hovered=${hover}`).toBe(true);
    }
  });

  it('compiles readonly as a text field does, and refuses what the spec keeps refused', () => {
    expect(errors(page('<input data-dragon-id="s" readonly="" type="search" placeholder="PP">'))).toEqual([]);
    expect(errors(page('<input data-dragon-id="s" type="search" value="XX">'))).toEqual([expect.stringMatching(/^<input> s is an editable text control/)]);
    expect(errors(page('<input data-dragon-id="s" readonly="" type="search" value="XX">', 'input { text-align: center; }'))).toEqual([expect.stringMatching(/^text-align: center on the search field s is not supported/)]);
    expect(errors(page('<input data-dragon-id="s" readonly="" type="search" value="XX">', 'input { text-align: right; }'))).toEqual([]);
    expect(errors(page('<input data-dragon-id="s" readonly="" type="search" value="XX">', 'input { direction: rtl; }'))).toContainEqual(expect.stringMatching(/^direction: rtl on <input type=search> s is not supported/));
    expect(errors(page('<input data-dragon-id="s" readonly="" type="search" value="XX">', 'input { text-align: left; }'))).toEqual([]);
    expect(errors(page('<input data-dragon-id="s" readonly="" type="search" placeholder="PP">', 'input::placeholder { margin-right: 2px; }'))).toEqual([expect.stringMatching(/^margin-right: 2px on the placeholder of the search field s is not supported/)]);
    expect(errors(page('<input data-dragon-id="s" readonly="" type="search" placeholder="PP">', 'input::placeholder { text-align: center; }'))).toEqual([expect.stringMatching(/^text-align: center on the placeholder of the search field s is not supported/)]);
    expect(errors(page('<input data-dragon-id="s" readonly="" type="search" placeholder="PP">', 'input::placeholder { text-align: left; }'))).toEqual([]);
    expect(errors(page('<input data-dragon-id="s" readonly="" type="search" value="XX">', 'input::-webkit-search-cancel-button { display: none; }')).length).toBeGreaterThan(0);
  });

  it("compiles the notes list's search field, readonly or edited by the host", () => {
    const css = '* { box-sizing: border-box; }\nbody { margin: 0; font-family: Ahem; font-size: 16px; }\ninput { font: inherit; color: inherit; }\n.search { display: block; width: 100%; margin-bottom: 18px; padding: 12px 16px; border: 1px solid #c9c2ad; border-radius: 999px; background: #fffdf7; }\n';
    const input = (readonly: boolean): string =>
      JSON.stringify({
        version: 'markless.native-style-input/0',
        component: 'Notes',
        nodes: [
          { kind: 'element', id: 'h0', element: 'main', parent: null, attributes: {} },
          { kind: 'element', id: 'h1', element: 'input', parent: 'h0', attributes: { class: 'search', type: 'search', 'aria-label': 'Search notes', placeholder: 'Search notes', ...(readonly ? { readonly: '' } : {}) } },
        ],
        css,
        states: [],
      });
    const refusal = (readonly: boolean): string | null => {
      try {
        marklessStyleExport(input(readonly), 'notes-search.json');
        return null;
      } catch (e) {
        return (e as Error).message;
      }
    };
    expect(refusal(true)).toBeNull();
    // The Markless export compiles with textEditing 'host' (#645), so the editable field compiles too.
    expect(refusal(false)).toBeNull();
  });
});
