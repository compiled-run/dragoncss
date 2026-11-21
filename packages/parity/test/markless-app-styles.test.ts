// The additions an app of several pages needs (docs/markless-native-styles.md "From a Markless style input"): a ui-* attribute
// that follows a state, ids holding "/" or ":" (a component's nodes), and @media bands emitted as the env#band state.
// The input is the settings page of the Markless styles rung S3, as @markless/mobile writes it.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BAND_KEY } from 'dragon';
import { marklessStyleExport } from '../src/markless-style-input.ts';
import { repoPath } from '../src/paths.ts';

const PATH = 'examples/markless-styles/input/app-settings.native-style-input.json';
const TEXT = readFileSync(repoPath(PATH), 'utf8');
type Node = { id: string; element?: string; attributes?: Record<string, string> };
const input = JSON.parse(TEXT) as { nodes: Node[]; states: { cell: string }[] };
const cell = input.states[0]!.cell;
const byClass = (token: string): string => input.nodes.find((n) => n.attributes?.['class']?.split(' ').includes(token))!.id;

describe('an app page: ui-* attributes, component ids and @media bands', () => {
  const { exported } = marklessStyleExport(TEXT, PATH);

  it('keeps every input id, including the ones Dragon cannot use itself', () => {
    const link = input.nodes.find((n) => n.element === 'a')!.id;
    expect(link).toContain(':');
    for (const x of Object.values(exported.targets)) for (const a of x.assignments) {
      const ids = a.nodes.map((n) => n.id);
      expect(ids).toContain(link);
      expect(ids).toContain(`${link}:text0`);
    }
  });

  it('emits the dark band as one more state, with the band table the host evaluates', () => {
    for (const t of ['ios', 'android'] as const) {
      const x = exported.targets[t]!;
      expect(x.states.map((s) => s.key)).toEqual([cell, BAND_KEY]);
      expect(x.bands?.atoms).toEqual([{ feature: 'prefers-color-scheme', comparisons: [], keyword: 'dark' }]);
      expect(x.bands?.bands).toEqual([[false], [true]]);
      const bg = (band: number): unknown => x.assignments.find((a) => a.values[cell] === false && a.values[BAND_KEY] === band)!.nodes.find((n) => n.id === byClass('settings'))!.writes.find((w) => w['kind'] === 'background-color')?.['color'];
      expect([bg(0), bg(1)]).toEqual([{ r: 253, g: 252, b: 249, alpha: 255 }, { r: 29, g: 27, b: 22, alpha: 255 }]);
    }
  });

  it('switches [ui-active] with its cell', () => {
    const x = exported.targets.ios!;
    const bg = (on: boolean): unknown => x.assignments.find((a) => a.values[cell] === on && a.values[BAND_KEY] === 0)!.nodes.find((n) => n.id === byClass('status'))!.writes.find((w) => w['kind'] === 'background-color')?.['color'];
    expect([bg(false), bg(true)]).toEqual([{ r: 233, g: 236, b: 239, alpha: 255 }, { r: 42, g: 157, b: 143, alpha: 255 }]);
  });
});
