// SELD-R2a (notes/T047-runtime-spec.md RT-6(a) and Amendment T064J): the prepare hook of a forced case. It forces pseudo-classes
// with CDP CSS.forcePseudoState on exactly the elements named, as DevTools does, before a capture reads the page.
import type { Page } from 'playwright';
import type { ForcedPseudo } from './cases.ts';

/** Waits two frames, so forced or input-driven style changes are applied before a capture reads the page. */
export async function frames(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
}

/** The prepare hook of a forced case: CSS.forcePseudoState on each named element; an element that is not in the page throws. */
export function forcePseudo(forced: readonly ForcedPseudo[]): (page: Page) => Promise<void> {
  return async (page) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
    const byNode = new Map<number, string[]>();
    for (const f of forced) {
      const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: `[data-dragon-id="${f.address.replace(/["\\]/g, '\\$&')}"]` });
      if (nodeId === 0) throw new Error(`forced ${f.pseudo}: no element with data-dragon-id ${f.address}`);
      byNode.set(nodeId, [...(byNode.get(nodeId) ?? []), f.pseudo]);
    }
    for (const [nodeId, pseudos] of byNode) await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: pseudos });
    await frames(page);
  };
}

/** A case's prepare hook: its forced pseudo-classes, or none. */
export const prepareOf = (c: { readonly forced?: readonly ForcedPseudo[] }): ((page: Page) => Promise<void>) | undefined =>
  c.forced === undefined || c.forced.length === 0 ? undefined : forcePseudo(c.forced);
