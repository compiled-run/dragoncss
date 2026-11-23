// HIT-atomic-inline: the compiler's R13 box check (interaction.ts hitUnmodelledBox, holdsAtomicLine) and the hit table (rt-hit.ts
// hitRefusal) must agree on every layout case: the compiler refuses a case's interaction rules for an atomic inline's block exactly
// when the table refuses that case for an atomic inline, and every other atomic-inline case the table models and builds.
import { describe, expect, it } from 'vitest';
import type { ResolvedElement } from '../../dragon/src/analysis/resolve.ts';
import { hitUnmodelledBox } from '../../dragon/src/analysis/interaction.ts';
import { internalRecord } from '../../dragon/src/project.ts';
import { caseHitTable, hitRefusal } from '../src/hit-capture.ts';
import { nativeCases } from '../src/native-host.ts';

const ATOMIC_REFUSAL = / is an atomic inline outside an inline formatting context, | has percentage padding around atomic inlines, /;
// Cases with an atomic inline that forms a stacking context (containment, or opacity on a line in an anonymous box): it hits as its
// own layer (HIT-INL2c), so neither side refuses them and the table builds.
const CONTEXT_CASES = ['contain-intrinsic-ahem', 'containment-layout', 'hit-atomic-inline-context'];
const ATOMIC_DISPLAYS = ['inline-block', 'inline-flex', 'inline-grid'];

/** Every element of a resolved tree in preorder. */
function elements(root: ResolvedElement): ResolvedElement[] {
  return [root, ...root.children.flatMap((c) => (c.kind === 'element' ? elements(c as ResolvedElement) : []))];
}

const display = (e: ResolvedElement): string => {
  const v = e.props.get('display');
  return v !== undefined && v.value.kind === 'keyword' ? v.value.value : '';
};

describe('the compiler and the hit table agree on atomic inlines', () => {
  it('refuse the same atomic-inline cases, and the table models the rest', () => {
    let atomic = 0;
    let modelled = 0;
    let contexts = 0;
    for (const n of nativeCases()) {
      const record = internalRecord(n.compiled);
      const resolved = record?.cases.find((c) => c.resolved !== null)?.resolved ?? null;
      if (resolved === null) continue;
      const table = hitRefusal(n);
      const tableRefuses = table !== null && ATOMIC_REFUSAL.test(table);
      // A case the table refuses for an earlier reason proves nothing either way.
      if (table !== null && !tableRefuses) continue;
      const unmodelled = hitUnmodelledBox(resolved);
      const compilerRefuses = unmodelled?.pkg === 'INL2a';
      expect([n.case.id, compilerRefuses], n.case.id).toEqual([n.case.id, tableRefuses]);
      if (CONTEXT_CASES.some((id) => n.case.id === id || n.case.id === `${id}-rtl`)) {
        contexts++;
        expect([n.case.id, unmodelled, table], n.case.id).toEqual([n.case.id, null, null]);
        expect(() => caseHitTable(n), n.case.id).not.toThrow();
      }
      if (!elements(resolved).some((e) => ATOMIC_DISPLAYS.includes(display(e)))) continue;
      if (table !== null) continue;
      atomic++;
      // A case the table does not refuse builds: a refusal-free case that throws here would throw on the phone.
      expect(() => caseHitTable(n), n.case.id).not.toThrow();
      modelled++;
    }
    expect(atomic).toBeGreaterThan(10);
    expect(modelled).toBe(atomic);
    expect(contexts).toBeGreaterThanOrEqual(CONTEXT_CASES.length);
  });
});

// HIT-INL2c paint: hit order follows paint order. In Chrome 145 an atomic inline that forms a stacking context paints over the
// text after it on its line (b1 at 50% red over the Ahem 'b' glyphs), a plain one under it (b01, the glyphs stay black); Dragon's
// native program hosts the context atomics (b1, and l1 in rtl) in html's z0 layer after the flow, and leaves b01 in the flow.
describe('an atomic inline that forms a stacking context paints over its line text (HIT-INL2c)', () => {
  it('in Chrome and in the native program', async () => {
    const { ahemFontFace, launchChrome } = await import('../src/chrome.ts');
    const n = nativeCases().find((c) => c.case.id === 'hit-atomic-inline-context');
    if (n === undefined) throw new Error('no hit-atomic-inline-context case');
    const browser = await launchChrome(1);
    try {
      const page = await browser.newPage({ viewport: { width: n.case.environment.viewport.width, height: n.case.environment.viewport.height } });
      await page.setContent(n.case.authoredHtml);
      await page.addStyleTag({ content: ahemFontFace() });
      await page.evaluate(() => document.fonts.ready);
      const png = await page.screenshot({ type: 'png' });
      const { decodePng } = await import('../src/pixel-reference.ts');
      const img = decodePng(png);
      const pixelAt = async (id: string, fromRight: number): Promise<number[]> => {
        const r = await page.evaluate((i) => (document.querySelector(`[data-dragon-id="${i}"]`) as HTMLElement).getBoundingClientRect().toJSON(), id);
        const x = Math.floor(r.right - fromRight);
        const y = Math.floor(r.top + r.height / 2);
        const o = (y * img.width + x) * 4;
        return [img.data[o] as number, img.data[o + 1] as number, img.data[o + 2] as number];
      };
      // 2 px inside the right edge, where each box overlaps the first 'b' glyph after it.
      expect(await pixelAt('b1', 2)).toEqual([100, 0, 0]);
      expect(await pixelAt('b01', 2)).toEqual([0, 0, 0]);
    } finally {
      await browser.close();
    }
    const order = (id: string) => n.programs.uikit.nodes.find((x) => x.id === id)?.writes.find((w) => w.kind === 'paint-order') as { host: string; bucket: number } | undefined;
    expect([order('b1')?.host, order('b1')?.bucket, order('l1')?.host, order('l1')?.bucket, order('b01')]).toEqual(['html', 1, 'html', 1, undefined]);
  }, 120_000);
});
