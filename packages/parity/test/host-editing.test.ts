// A host that edits text itself (compileNativeStyles editing: 'host', InternalOptions hostEditing, a Markless app): an editable text
// field compiles natively, laid out exactly as the same field readonly, which Chrome lays out identically (controls-text-field);
// without the option it stays refused, and another editing value throws.
import { describe, expect, it } from 'vitest';
import { createProjectWith, NO_FAULTS } from 'dragon';
import { compileNativeStyles } from '../../dragon/src/native-styles.ts';
import { nativeProgramFor } from '../../dragon/src/internal.ts';
import { ENVIRONMENT } from '../src/fixtures.ts';
import { fixtureToInput, PROJECT_ID } from '../src/fixture-reader.ts';
import { REFERENCE_PLATFORM } from '../src/platform.ts';

const page = (readonly: boolean): string =>
  `<!DOCTYPE html>\n<html data-dragon-id="html">\n<head>\n<style>\nbody { margin: 0; font-family: Ahem; font-size: 10px; }\ninput { display: block; font: inherit; width: 100px; padding: 2px; border: 1px solid #333; }\n</style>\n</head>\n<body data-dragon-id="body"><input data-dragon-id="t"${readonly ? ' readonly=""' : ''} value="XX"></body>\n</html>\n`;
const compile = (html: string, hostEditing: boolean) =>
  createProjectWith({ projectId: PROJECT_ID, targets: { ios: { minimum: '15.0' } } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr', platform: REFERENCE_PLATFORM, rootFont: 'ahem', foldViewport: ENVIRONMENT.viewport, hostEditing }).compile(fixtureToInput('host-editing', html));
const errors = (html: string, hostEditing: boolean): string[] => compile(html, hostEditing).diagnostics.filter((d) => d.severity === 'error').map((d) => d.message);

describe('an editable text field when the host edits text', () => {
  it('is refused without hostEditing and compiles with it', () => {
    expect(errors(page(false), false)).toContainEqual(expect.stringMatching(/^<input> t is an editable text field/));
    expect(errors(page(false), true)).toEqual([]);
  });
  it('lays out exactly as the same field readonly', () => {
    const program = (readonly: boolean) => {
      const p = nativeProgramFor(compile(page(readonly), true), [], 'ios');
      if (p.kind !== 'ready') throw new Error(p.reason);
      return JSON.stringify(p.program.nodes);
    };
    expect(program(false)).toBe(program(true));
  });
  it("throws on an editing value other than 'host'", () => {
    expect(() => compileNativeStyles({ projectId: PROJECT_ID, name: 'Field', targets: { ios: { minimum: '15.0' } }, viewport: ENVIRONMENT.viewport, editing: 'app' as never }, fixtureToInput('host-editing', page(false)))).toThrow("compileNativeStyles: editing \"app\" is not 'host'");
  });
});
