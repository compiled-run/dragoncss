// SELD-R2 §1 (lanes/paint/seld-r2-pr5-design.md): the user-app interaction file of a document holds exactly the tables the lanes
// prove: for every interaction fixture, its declarations equal the lane emit's (deviceTraceSources) byte for byte, up to the private
// name prefix, the program comment line, and the script, fault and case-table lines that only the lanes have. The host apps compile one.
import { describe, expect, it } from 'vitest';
import { documentInteractionEmit, documentInteractionFiles, emitInteractionUserFile } from 'dragon';
import { interactionGroups } from '../src/interaction-cases.ts';
import type { NativeCase } from '../src/native-host.ts';
import { BACKEND_OF, hostSources, iosModules } from '../src/native-host.ts';
import { deviceTraceSources, HOST_USER_FIXTURE, hostUserInteractionSources, traceEmits } from '../src/trace-lane.ts';

/** The table declarations of a generated interaction source: after its "// interaction program" line, up to the lane faults or the user factory. */
function decls(text: string): string {
  const at = text.indexOf('// interaction program ');
  const from = text.indexOf('\n', at);
  const end = text.search(/\n(private let \S+Faults: |private fun \S+Faults\(\)|\/\/\/ The interaction runtime of |\/\*\* The interaction runtime of )/);
  if (at < 0 || end <= from) throw new Error('not an interaction program source');
  return text.slice(from, end);
}

describe('SELD-R2 §1: the user-app interaction file against the lane emit', () => {
  for (const target of ['ios', 'android'] as const) {
    it(`${target}: every interaction fixture's user file declares the lane file's tables byte for byte`, () => {
      const groups = interactionGroups();
      const emits = traceEmits(target);
      const lane = deviceTraceSources(target).filter((f) => /DragonInteractions\d+\.(swift|kt)$/.test(f.path));
      expect(groups.length).toBeGreaterThanOrEqual(8);
      expect(emits.map((e) => e.id)).toEqual(groups.map((g) => g.id));
      expect(lane.length).toBe(groups.length);
      groups.forEach((g, k) => {
        const e = documentInteractionEmit((g.cases[0] as NativeCase).compiled, target);
        if (e === null) throw new Error(`${g.id}: no interaction program`);
        const user = emitInteractionUserFile(BACKEND_OF[target], e, 'doc').text;
        const laneText = (lane[k] as { text: string }).text;
        expect(decls(user).replaceAll('dragonDoc', `dragonInteractions${k}`), g.id).toBe(decls(laneText));
        expect(decls(user).length, g.id).toBeGreaterThan(1000);
        expect(user, g.id).not.toMatch(/Script|CaseTable|DragonInteractionStep/);
      });
    }, 600_000);
  }

  it('the host apps compile one user file, as a ready output ships it, and the mount its header documents', () => {
    const iosPaths = hostSources('ios', 'x').map((f) => f.path);
    expect(iosModules(iosPaths).host).toEqual(expect.arrayContaining(['Dragon/DocInteraction.swift', 'Host/DragonUserMount.swift']));
    expect(hostSources('android', 'x').map((f) => f.path)).toEqual(expect.arrayContaining(['kotlin/dev/dragon/app/DocInteraction.kt', 'kotlin/dev/dragon/host/DragonUserMount.kt']));
    const g = interactionGroups().find((x) => x.id === HOST_USER_FIXTURE);
    if (g === undefined) throw new Error(`no ${HOST_USER_FIXTURE}`);
    for (const target of ['ios', 'android'] as const) {
      const [user, mount] = hostUserInteractionSources(target);
      expect([user]).toEqual(documentInteractionFiles((g.cases[0] as NativeCase).compiled, target));
      // Every statement the header documents is compiled in the host's mount function.
      const documented = [...(user?.text ?? '').matchAll(/^\/\/ {3}(.+)$/gm)].map((m) => m[1] as string);
      expect(documented.length, target).toBeGreaterThanOrEqual(2);
      for (const line of documented) expect(mount?.text, target).toContain(`\n  ${line}\n`);
      expect(mount?.text, target).toMatch(target === 'ios' ? /func dragonUserMount\(_ stage: UIView\) -> DragonInteractionMount \{/ : /fun dragonUserMount\(stage: ViewGroup\): DragonInteractionMount \{/);
    }
  }, 600_000);
});
