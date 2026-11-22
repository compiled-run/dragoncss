// FORM-attrs: a submit or reset button inside a <form> compiles only when the host runs forms (compileNativeStyles forms: 'host',
// InternalOptions hostForms). Its type changes activation, not rendering: Chrome lays the form's buttons out exactly as with
// type=button, and Dragon's program for them is the type=button program.
import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createProjectWith, NO_FAULTS } from 'dragon';
import { compileNativeStyles } from '../../dragon/src/native-styles.ts';
import { nativeProgramFor } from '../../dragon/src/internal.ts';
import { captureFixture } from '../src/capture.ts';
import { launchChrome } from '../src/chrome.ts';
import { ENVIRONMENT } from '../src/fixtures.ts';
import { fixtureToInput, PROJECT_ID } from '../src/fixture-reader.ts';
import { engineBoxes } from '../src/native-host.ts';
import { REFERENCE_PLATFORM } from '../src/platform.ts';
import { GATE_DEVICE_PX } from '../src/compare.ts';

const CSS = [
  'body { margin: 0; font-family: Ahem; font-size: 10px; }',
  'form { padding: 4px; }',
  'button { display: block; font-family: inherit; font-size: inherit; padding: 1px 6px; margin-bottom: 2px; border: 2px solid #036; }',
  '.n { appearance: none; background-color: #cdf; }',
  '.a { background-color: #fdc; }',
].join('\n');
const TYPES = ['none', 'submit', 'reset', 'bogus', 'button'] as const;
const page = (typed: boolean): string => {
  const buttons = (cls: string): string =>
    TYPES.map((t) => `<button data-dragon-id="${cls}-${t}" class="${cls}"${!typed || t === 'none' ? (typed ? '' : ' type="button"') : ` type="${t}"`}>XX</button>`).join('');
  return `<!DOCTYPE html>\n<html data-dragon-id="html">\n<head>\n<style>\n${CSS}\n</style>\n</head>\n<body data-dragon-id="body"><form data-dragon-id="f">${buttons('n')}${buttons('a')}</form></body>\n</html>\n`;
};
const compileFor = (html: string, hostForms: boolean) =>
  createProjectWith({ projectId: PROJECT_ID, targets: { ios: { minimum: '15.0' } } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr', platform: REFERENCE_PLATFORM, rootFont: 'ahem', foldViewport: ENVIRONMENT.viewport, hostForms }).compile(fixtureToInput('form-buttons-host', html));
const errors = (html: string, hostForms: boolean): string[] => compileFor(html, hostForms).diagnostics.filter((d) => d.severity === 'error').map((d) => d.message);
const programOf = (html: string, hostForms: boolean) => {
  const p = nativeProgramFor(compileFor(html, hostForms), [], 'ios');
  if (p.kind !== 'ready') throw new Error(p.reason);
  return p.program;
};

describe('buttons inside a form, the host running forms', () => {
  it('refuses every submitting and resetting button without hostForms, and none with it', () => {
    const refused = errors(page(true), false).filter((m) => m.includes('inside <form> f'));
    expect(refused.map((m) => m.split(' ')[1]).sort()).toEqual(['a-bogus', 'a-none', 'a-reset', 'a-submit', 'n-bogus', 'n-none', 'n-reset', 'n-submit']);
    expect(errors(page(true), true)).toEqual([]);
    expect(errors(page(false), false)).toEqual([]);
  });

  it("gives the typed buttons the program of type=button: the type changes nothing Dragon writes", () => {
    expect(JSON.stringify(programOf(page(true), true).nodes)).toBe(JSON.stringify(programOf(page(false), true).nodes));
  });

  it('keeps rel and target on a form refused under hostForms', () => {
    const html = page(false).replace('<form data-dragon-id="f">', '<form data-dragon-id="f" rel="noopener" target="_blank">');
    const refused = errors(html, true);
    expect(refused.some((m) => m.startsWith('attribute rel on f'))).toBe(true);
    expect(refused.some((m) => m.startsWith('attribute target on f'))).toBe(true);
  });

  it("throws on a forms value other than 'host'", () => {
    const input = fixtureToInput('form-buttons-host', page(false));
    expect(() => compileNativeStyles({ projectId: PROJECT_ID, name: 'Form', targets: { ios: { minimum: '15.0' } }, viewport: ENVIRONMENT.viewport, forms: 'app' as never }, input)).toThrow("compileNativeStyles: forms \"app\" is not 'host'");
  });

  for (const dpr of [1, 3]) {
    describe(`at DPR ${dpr}`, () => {
      let browser: Browser;
      beforeAll(async () => {
        browser = await launchChrome(dpr);
      }, 120_000);
      afterAll(async () => {
        await browser?.close();
      });
      it('lays out the typed buttons where Chrome puts them, and Chrome puts them where it puts type=button', async () => {
        const env = { ...ENVIRONMENT, devicePixelRatio: dpr };
        const html = page(true);
        const typed = await captureFixture(browser, 'form-buttons-host', html, env, []);
        const plain = await captureFixture(browser, 'form-buttons-host', page(false), env, []);
        const rects = (c: typeof typed) => c.nodes.filter((n) => n.hasBox && n.kind !== 'line').map((n) => [n.id, n.x, n.y, n.width, n.height]);
        expect(rects(typed)).toEqual(rects(plain));
        const program = programOf(html, true);
        const parent = new Map(program.nodes.map((n) => [n.id, n.parent]));
        const boxes = new Map(engineBoxes(program, env.viewport, dpr).map((b) => [b.id, b]));
        const absolute = (id: string): { x: number; y: number; width: number; height: number } => {
          const b = boxes.get(id);
          if (b === undefined) throw new Error(`no engine box ${id}`);
          const up = parent.get(id) ?? null;
          const o = up === null ? { x: 0, y: 0 } : absolute(up);
          return { x: o.x + b.x / 64, y: o.y + b.y / 64, width: b.width / 64, height: b.height / 64 };
        };
        const compared: string[] = [];
        for (const n of typed.nodes) {
          if (!n.hasBox || n.kind === 'line' || !/^[na]-[a-z]+$/.test(n.id)) continue;
          const e = absolute(n.id);
          const delta = Math.max(...(['x', 'y', 'width', 'height'] as const).map((k) => Math.abs(n[k] * dpr - e[k])));
          expect(delta, `${n.id}: Chrome ${JSON.stringify([n.x, n.y, n.width, n.height])}, Dragon ${JSON.stringify(e)}`).toBeLessThanOrEqual(GATE_DEVICE_PX);
          compared.push(n.id);
        }
        expect(compared.sort()).toEqual(TYPES.flatMap((t) => [`a-${t}`, `n-${t}`]).sort());
      });
    });
  }
});
