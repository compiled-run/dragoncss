// SELD-R2 (notes/T064-seld-r2-spec.md R1, R15 and §3): the interaction mount's platform glue as generated text. Both platforms
// declare the same pointer input, the machine's pointer entry points in order; the iOS press recognizer observes without taking
// touches and tells a pointer click from a touch; the Android root reads touch without intercepting and hover only from a
// mouse or stylus, deferring the hover-exit clear to the next frame; and only a hovering or pressed pointer moves hover (R1).
import { describe, expect, it } from 'vitest';
import { interactionGlueKotlin, interactionGlueSupport, interactionGlueSwift } from '../src/emit/runtime/interaction-glue.ts';

const swift = interactionGlueSwift();
const kotlin = interactionGlueKotlin();
const ENTRY_POINTS = ['pointerMoved', 'pointerExited', 'hoverExitStarted', 'frame', 'mousePressed', 'mouseReleased', 'touchPressed', 'touchReleased', 'touchCancelled'];

function block(text: string, start: string): string {
  const at = text.indexOf(start);
  expect(at, start).toBeGreaterThan(-1);
  return text.slice(at, text.indexOf('\n}\n', at));
}

describe('the interaction glue', () => {
  it('is one support file per backend', () => {
    const h = (what: string): string => `// ${what}\n`;
    expect(interactionGlueSupport('uikit', h).path).toBe('Support/DragonInteractionGlue.swift');
    expect(interactionGlueSupport('android-views', h).path).toBe('kotlin/dev/dragon/views/DragonInteractionGlue.kt');
    expect(interactionGlueSupport('uikit', h).text.startsWith('// the interaction mount and its UIKit event glue\nimport UIKit\n')).toBe(true);
  });
  it('declares the same pointer input on both platforms, the machine\'s pointer entry points in order, and forwards each to the machine', () => {
    const names = (b: string, re: RegExp): string[] => [...b.matchAll(re)].map((m) => m[1] as string);
    expect(names(block(swift, 'public protocol DragonPointerInput'), /^ {2}func (\w+)\(/gm)).toEqual(ENTRY_POINTS);
    expect(names(block(kotlin, 'interface DragonPointerInput'), /^ {2}fun (\w+)\(/gm)).toEqual(ENTRY_POINTS);
    expect(names(block(swift, 'public final class DragonMachinePointer'), /\{ m\.(\w+)\(/g)).toEqual(ENTRY_POINTS);
    expect(names(block(kotlin, 'class DragonMachinePointer'), /\{ m\.(\w+)\(/g)).toEqual(ENTRY_POINTS);
  });
  it('observes touches on iOS without taking them: a direct or Pencil touch presses as touch, an indirect pointer as mouse', () => {
    const r = block(swift, 'final class DragonPressRecognizer');
    for (const l of ['cancelsTouchesInView = false', 'delaysTouchesBegan = false', 'delaysTouchesEnded = false', 'shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }']) expect(r).toContain(l);
    expect(r).toMatch(/case \.direct, \.pencil:\n\s+tracked = t; mouse = false\n\s+machine\.touchPressed\(x, y\)/);
    expect(r).toMatch(/case \.indirectPointer:\n\s+tracked = t; mouse = true\n\s+machine\.mousePressed\(x, y\)/);
    expect(r).toContain('machine.touchCancelled()');
    const hover = block(swift, 'final class DragonHoverTarget');
    expect(hover).toMatch(/case \.began, \.changed:\n(?:[^\n]*\n){2}\s+machine\.pointerMoved/);
    // A hover end during a pointer press is held until the release (P4), else it clears hover at once.
    expect(hover).toContain('if press?.mouseDown == true { exitHeld = true } else { machine.pointerExited() }');
    expect(r).toContain('if mouse { machine.mouseReleased(); onMouseReleased?() } else {');
  });
  it('reads Android touch without intercepting, hover only from a mouse or stylus, and defers the hover-exit clear to the next frame (R15)', () => {
    const root = block(kotlin, 'class DragonInteractionRoot');
    expect(root).toContain('override fun onInterceptTouchEvent(ev: MotionEvent): Boolean = false');
    expect(root).toContain('val mouse = tool == MotionEvent.TOOL_TYPE_MOUSE');
    expect(root).toContain('val touch = tool == MotionEvent.TOOL_TYPE_FINGER || tool == MotionEvent.TOOL_TYPE_STYLUS');
    expect(root).toContain('if (ev.isFromSource(InputDevice.SOURCE_MOUSE) || ev.isFromSource(InputDevice.SOURCE_STYLUS))');
    expect(root).toMatch(/ACTION_HOVER_EXIT -> \{\n\s+machine\.hoverExitStarted\(\)\n\s+removeCallbacks\(exitFrame\)\n\s+postOnAnimation\(exitFrame\)/);
    // Device px to CSS px through the density the mount lays out at, in double.
    expect(root).toContain('ev.getX(0).toDouble() / scale');
  });
  it('moves hover only from a hover event or a pressed pointer, never from a touch (R1)', () => {
    const moves = (text: string): string[] => text.split('\n').filter((l) => l.includes('machine.pointerMoved'));
    expect(moves(kotlin)).toEqual([
      '      MotionEvent.ACTION_MOVE -> if (mouse) machine.pointerMoved(cssX(ev), cssY(ev))',
      '        MotionEvent.ACTION_HOVER_ENTER, MotionEvent.ACTION_HOVER_MOVE -> machine.pointerMoved(cssX(ev), cssY(ev))',
    ]);
    expect(moves(swift).length).toBe(2);
    expect(block(swift, '  override func touchesMoved')).toContain('guard let t = tracked, mouse, touches.contains(t) else { return }');
  });
});
