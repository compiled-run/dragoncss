// T065 §1: the transition and animation properties parse as Chrome 145 parses them. CHROME holds Chrome's computed longhands
// for each declaration (sorted by name; null where Chrome drops it), measured with getComputedStyle on Chrome 145.0.7632.6.
import { parse } from 'css-tree';
import { describe, expect, it } from 'vitest';
import type { AnimItem, AnimLonghand } from '../src/css/properties/animation.ts';
import { ANIM_INITIAL, ANIMATION_LONGHANDS, animationRefusal, parseAnimationDeclaration, parseAnimationValue, TRANSITION_LONGHANDS } from '../src/css/properties/animation.ts';
import type { Diagnostic } from '../src/types.ts';

const CHROME: readonly (readonly [string, string, readonly string[] | null])[] = [
  ["transition", "margin-right 0.5s ease", ["normal", "0s", "0.5s", "margin-right", "ease"]],
  ["transition", "all 0.3s ease", ["normal", "0s", "0.3s", "all", "ease"]],
  ["transition", "color 0.2s ease, transform 0.2s ease", ["normal, normal", "0s, 0s", "0.2s, 0.2s", "color, transform", "ease, ease"]],
  ["transition", "opacity 0.5s ease, transform 0.5s ease", ["normal, normal", "0s, 0s", "0.5s, 0.5s", "opacity, transform", "ease, ease"]],
  ["transition", "none", ["normal", "0s", "0s", "none", "ease"]],
  ["transition", "none, color 1s", null],
  ["transition", "1s", ["normal", "0s", "1s", "all", "ease"]],
  ["transition", "1s 2s", ["normal", "2s", "1s", "all", "ease"]],
  ["transition", "ease", ["normal", "0s", "0s", "all", "ease"]],
  ["transition", "ease-in 1s color", ["normal", "0s", "1s", "color", "ease-in"]],
  ["transition", "color", ["normal", "0s", "0s", "color", "ease"]],
  ["transition", "0", null],
  ["transition", "-1s", ["normal", "-1s", "0s", "all", "ease"]],
  ["transition", "1s -1s", ["normal", "-1s", "1s", "all", "ease"]],
  ["transition", "color 1s, 2s", ["normal, normal", "0s, 0s", "1s, 2s", "color, all", "ease, ease"]],
  ["transition", "foo 1s", ["normal", "0s", "1s", "foo", "ease"]],
  ["transition", "margin 1s", ["normal", "0s", "1s", "margin", "ease"]],
  ["transition", "inherit", ["normal", "0s", "0s", "all", "ease"]],
  ["transition", "initial, color", null],
  ["transition", "color 1s allow-discrete", ["allow-discrete", "0s", "1s", "color", "ease"]],
  ["transition", "allow-discrete color", ["allow-discrete", "0s", "0s", "color", "ease"]],
  ["transition", "normal 1s", ["normal", "0s", "1s", "all", "ease"]],
  ["transition", "color 1s linear(0, 1)", ["normal", "0s", "1s", "color", "linear(0 0%, 1 100%)"]],
  ["transition", "color 1s steps(2)", ["normal", "0s", "1s", "color", "steps(2)"]],
  ["transition", "color 1s step-end", ["normal", "0s", "1s", "color", "steps(1)"]],
  ["transition", "color 1s cubic-bezier(.5,-1,.5,2)", ["normal", "0s", "1s", "color", "cubic-bezier(0.5, -1, 0.5, 2)"]],
  ["transition", "color 1s cubic-bezier(1.5,0,1,1)", null],
  ["transition", "color 333.3ms", ["normal", "0s", "0.3333s", "color", "ease"]],
  ["transition", "COLOR 1S EASE-IN", ["normal", "0s", "1s", "color", "ease-in"]],
  ["transition", "color 1s, color 2s", ["normal, normal", "0s, 0s", "1s, 2s", "color, color", "ease, ease"]],
  ["transition", "default 1s", null],
  ["transition", "unset 1s", null],
  ["transition", "all, none", null],
  ["transition", "--x 1s", ["normal", "0s", "1s", "--x", "ease"]],
  ["transition", "color 1s ease ease", null],
  ["transition", "color 1s 1s 1s", null],
  ["transition-property", "none", ["normal", "0s", "0s", "none", "ease"]],
  ["transition-property", "all, color, foo", ["normal", "0s", "0s", "all, color, foo", "ease"]],
  ["transition-property", "color, none", null],
  ["transition-property", "inherit", ["normal", "0s", "0s", "all", "ease"]],
  ["transition-duration", "1s, 2s", ["normal", "0s", "1s, 2s", "all", "ease"]],
  ["transition-duration", "-1s", null],
  ["transition-duration", "0", null],
  ["transition-duration", "calc(1s + 100ms)", ["normal", "0s", "1.1s", "all", "ease"]],
  ["transition-duration", "500ms", ["normal", "0s", "0.5s", "all", "ease"]],
  ["transition-timing-function", "steps(4, jump-none)", ["normal", "0s", "0s", "all", "steps(4, jump-none)"]],
  ["transition-timing-function", "steps(1, jump-none)", null],
  ["transition-timing-function", "steps(0)", null],
  ["transition-timing-function", "steps(3, start)", ["normal", "0s", "0s", "all", "steps(3, start)"]],
  ["transition-timing-function", "cubic-bezier(0,0,1,1), ease", ["normal", "0s", "0s", "all", "cubic-bezier(0, 0, 1, 1), ease"]],
  ["transition-delay", "-500ms", ["normal", "-0.5s", "0s", "all", "ease"]],
  ["transition-behavior", "allow-discrete, normal", ["allow-discrete, normal", "0s", "0s", "all", "ease"]],
  ["animation", "album-spin 20s linear infinite", ["replace", "0s", "normal", "20s", "none", "infinite", "album-spin", "running", "normal", "normal", "auto", "linear"]],
  ["animation", "spin 2", ["replace", "0s", "normal", "0s", "none", "2", "spin", "running", "normal", "normal", "auto", "ease"]],
  ["animation", "infinite", ["replace", "0s", "normal", "0s", "none", "infinite", "none", "running", "normal", "normal", "auto", "ease"]],
  ["animation", "none", ["replace", "0s", "normal", "0s", "none", "1", "none", "running", "normal", "normal", "auto", "ease"]],
  ["animation", "none 1s", ["replace", "0s", "normal", "1s", "none", "1", "none", "running", "normal", "normal", "auto", "ease"]],
  ["animation", "a 1s, b 2s", ["replace", "0s, 0s", "normal, normal", "1s, 2s", "none, none", "1, 1", "a, b", "running, running", "normal", "normal", "auto", "ease, ease"]],
  ["animation", "a 1s, none", ["replace", "0s, 0s", "normal, normal", "1s, 0s", "none, none", "1, 1", "a, none", "running, running", "normal", "normal", "auto", "ease, ease"]],
  ["animation", "linear", ["replace", "0s", "normal", "0s", "none", "1", "none", "running", "normal", "normal", "auto", "linear"]],
  ["animation", "ease spin", ["replace", "0s", "normal", "0s", "none", "1", "spin", "running", "normal", "normal", "auto", "ease"]],
  ["animation", "1s 2s 3s", null],
  ["animation", "spin 1s alternate both paused", ["replace", "0s", "alternate", "1s", "both", "1", "spin", "paused", "normal", "normal", "auto", "ease"]],
  ["animation", "paused spin", ["replace", "0s", "normal", "0s", "none", "1", "spin", "paused", "normal", "normal", "auto", "ease"]],
  ["animation", "\"quoted name\" 1s", ["replace", "0s", "normal", "1s", "none", "1", "quoted\\ name", "running", "normal", "normal", "auto", "ease"]],
  ["animation", "spin auto", ["replace", "0s", "normal", "0s", "none", "1", "spin", "running", "normal", "normal", "auto", "ease"]],
  ["animation", "auto spin", ["replace", "0s", "normal", "0s", "none", "1", "spin", "running", "normal", "normal", "auto", "ease"]],
  ["animation", "spin 1s scroll()", null],
  ["animation", "spin 1s auto", null],
  ["animation", "normal", ["replace", "0s", "normal", "0s", "none", "1", "none", "running", "normal", "normal", "auto", "ease"]],
  ["animation", "normal normal", ["replace", "0s", "normal", "0s", "none", "1", "normal", "running", "normal", "normal", "auto", "ease"]],
  ["animation", "forwards 1s", ["replace", "0s", "normal", "1s", "forwards", "1", "none", "running", "normal", "normal", "auto", "ease"]],
  ["animation", "spin -1", null],
  ["animation", "spin 2.5 alternate-reverse", ["replace", "0s", "alternate-reverse", "0s", "none", "2.5", "spin", "running", "normal", "normal", "auto", "ease"]],
  ["animation", "spin initial", null],
  ["animation", "default", null],
  ["animation", "spin 1s replace", null],
  ["animation", "inherit", ["replace", "0s", "normal", "0s", "none", "1", "none", "running", "normal", "normal", "auto", "ease"]],
  ["animation-name", "none, a, \"b\"", ["replace", "0s", "normal", "0s", "none", "1", "none, a, b", "running", "normal", "normal", "auto", "ease"]],
  ["animation-name", "initial", ["replace", "0s", "normal", "0s", "none", "1", "none", "running", "normal", "normal", "auto", "ease"]],
  ["animation-name", "a, none", ["replace", "0s", "normal", "0s", "none", "1", "a, none", "running", "normal", "normal", "auto", "ease"]],
  ["animation-duration", "auto, 1s", ["replace", "0s", "normal", "0s, 1s", "none", "1", "none", "running", "normal", "normal", "auto", "ease"]],
  ["animation-iteration-count", "infinite, 0, 2.5", ["replace", "0s", "normal", "0s", "none", "infinite, 0, 2.5", "none", "running", "normal", "normal", "auto", "ease"]],
  ["animation-iteration-count", "-1", null],
  ["animation-direction", "alternate-reverse", ["replace", "0s", "alternate-reverse", "0s", "none", "1", "none", "running", "normal", "normal", "auto", "ease"]],
  ["animation-fill-mode", "both, none", ["replace", "0s", "normal", "0s", "both, none", "1", "none", "running", "normal", "normal", "auto", "ease"]],
  ["animation-play-state", "paused, running", ["replace", "0s", "normal", "0s", "none", "1", "none", "paused, running", "normal", "normal", "auto", "ease"]],
  ["animation-timeline", "auto", ["replace", "0s", "normal", "0s", "none", "1", "none", "running", "normal", "normal", "auto", "ease"]],
  ["animation-timeline", "scroll()", ["replace", "0s", "normal", "auto", "none", "1", "none", "running", "normal", "normal", "scroll()", "ease"]],
  ["animation-timeline", "none", ["replace", "0s", "normal", "auto", "none", "1", "none", "running", "normal", "normal", "none", "ease"]],
  ["animation-range-start", "normal", ["replace", "0s", "normal", "0s", "none", "1", "none", "running", "normal", "normal", "auto", "ease"]],
  ["animation-range-start", "10%", ["replace", "0s", "normal", "0s", "none", "1", "none", "running", "normal", "10%", "auto", "ease"]],
  ["animation-range", "normal", ["replace", "0s", "normal", "0s", "none", "1", "none", "running", "normal", "normal", "auto", "ease"]],
  ["animation-range", "entry 10% exit 90%", ["replace", "0s", "normal", "0s", "none", "1", "none", "running", "exit 90%", "entry 10%", "auto", "ease"]],
  ["animation-composition", "replace, add", ["replace, add", "0s", "normal", "0s", "none", "1", "none", "running", "normal", "normal", "auto", "ease"]],
  ["animation-timing-function", "linear(0, 0.5 50%, 1)", ["replace", "0s", "normal", "0s", "none", "1", "none", "running", "normal", "normal", "auto", "linear(0 0%, 0.5 50%, 1 100%)"]]
];

/** Chrome's computed serialization of one parsed item (times in seconds, auto as 0s, names as identifiers). */
function shown(i: AnimItem): string {
  if (i.kind === 'time') return `${i.seconds}s`;
  if (i.kind === 'easing') return i.easing.text;
  if (i.kind === 'keyword') return i.value;
  if (i.kind === 'name') return i.value.replace(/ /g, '\\ ');
  if (i.kind === 'number') return String(i.value);
  return i.text;
}

function computed(property: string, value: string): string[] | null {
  const r = parseAnimationValue(property, parse(value, { context: 'value', positions: true }));
  if (r.kind === 'invalid') return null;
  const family: readonly AnimLonghand[] = property.startsWith('transition') ? TRANSITION_LONGHANDS : ANIMATION_LONGHANDS;
  // animation-duration: auto computes to 0s on the document timeline, and stays auto on another one.
  const timeline = r.value.longhands.get('animation-timeline');
  const documentTimeline = timeline === undefined || timeline.kind === 'wide' || timeline.items.every((i) => i.kind === 'keyword' && i.value === 'auto');
  const item = (p: AnimLonghand, i: AnimItem): string => (p === 'animation-duration' && i.kind === 'keyword' && documentTimeline ? '0s' : shown(i));
  return [...family].sort().map((p) => {
    const v = r.value.longhands.get(p);
    // A CSS-wide keyword on an element whose parent sets nothing computes to the initial value.
    if (v === undefined || v.kind === 'wide') return item(p, ANIM_INITIAL[p]);
    return v.items.map((i) => item(p, i)).join(', ');
  });
}

describe('animation and transition parsing', () => {
  it('accepts and drops exactly what Chrome 145 does, with the same computed longhands', () => {
    // linear() and calc() are accepted by Chrome and refused by Dragon (below); the rest must match.
    const refused = (v: string): boolean => /linear\(|calc\(/.test(v);
    const wrong = CHROME.filter(([, v]) => !refused(v)).filter(([p, v, want]) => JSON.stringify(computed(p, v)) !== JSON.stringify(want)).map(([p, v, want]) => `${p}: ${v}: chrome ${JSON.stringify(want)}, dragon ${JSON.stringify(computed(p, v))}`);
    expect(wrong).toEqual([]);
    expect(CHROME.length).toBe(96);
    expect(CHROME.filter(([, v]) => refused(v)).map(([p, v]) => [p, v, parseAnimationValue(p, parse(v, { context: 'value' })).kind])).toEqual([
      ['transition', 'color 1s linear(0, 1)', 'ok'],
      ['transition-duration', 'calc(1s + 100ms)', 'invalid'],
      ['animation-timing-function', 'linear(0, 0.5 50%, 1)', 'ok'],
    ]);
  });

  it('refuses the values Chrome accepts that ANIM-b1 does not build, naming the package', () => {
    const refusal = (p: string, v: string): string | null => {
      const r = parseAnimationValue(p, parse(v, { context: 'value', positions: true }));
      if (r.kind !== 'ok') return 'invalid';
      const d = animationRefusal(p, r.value, { source: { uri: 'x', kind: 'css' } as never, start: 0, end: v.length });
      return d === null ? null : (/package ([A-Za-z-]+)/.exec(d.message)?.[1] ?? d.message);
    };
    expect(refusal('transition', 'color 1s linear(0, 1)')).toBe('ANIM-L');
    expect(refusal('animation-timing-function', 'linear(0, 0.5 50%, 1)')).toBe('ANIM-L');
    expect(refusal('transition', 'color 1s allow-discrete')).toBe('ANIM-d');
    expect(refusal('animation-composition', 'replace, add')).toBe('ANIM-c');
    expect(refusal('animation-timeline', 'scroll()')).toBe('ANIM-S');
    expect(refusal('animation-timeline', 'none')).toBe('ANIM-S');
    expect(refusal('animation-range-start', '10%')).toBe('ANIM-S');
    expect(refusal('animation-range', 'entry 10% exit 90%')).toBe('ANIM-S');
    expect(refusal('animation', 'album-spin 20s linear infinite')).toBeNull();
    expect(refusal('transition', 'margin-right 0.5s ease')).toBeNull();
    expect(refusal('animation-timeline', 'auto')).toBeNull();
  });

  it('refuses var() and math functions in a declaration before parsing it', () => {
    const declare = (p: string, v: string): string => {
      const node = parse(v, { context: 'value', positions: true });
      const ds: Diagnostic[] = [];
      const span = { source: { uri: 'x', kind: 'css' } as never, start: 0, end: v.length };
      const r = parseAnimationDeclaration(p, node, { span, valueSpan: span, text: v, source: v, base: span }, ds);
      return r === null ? `${ds[0]?.code} ${/package ([A-Za-z-]+)/.exec(ds[0]?.message ?? '')?.[1] ?? ''}` : 'ok';
    };
    expect(declare('transition-duration', 'calc(1s + 100ms)')).toBe('DRAGON_UNSUPPORTED_VALUE ANIM-k');
    expect(declare('transition', 'var(--t)')).toBe('DRAGON_UNSUPPORTED_VALUE ANIM-v');
    expect(declare('transition', 'color 1s 1s 1s')).toBe('DRAGON_CSS_INVALID_VALUE ');
    expect(declare('transition', 'color 1s')).toBe('ok');
  });
});
