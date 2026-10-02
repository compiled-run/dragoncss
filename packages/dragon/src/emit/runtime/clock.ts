// The runtime clock (notes/T047-runtime-spec.md RT-5): one clock abstraction with two drivers. SELD-R1a wires only the virtual
// driver, in which time moves only by a case script's advance(ms); the display driver (CADisplayLink, Choreographer) comes with
// ANIM-b. The clock holds document timeline time in milliseconds, as a double.
import type { GeneratedFile } from '../../types.ts';

export const CLOCK_RUNTIME_VERSION = 'dragon.runtime-clock/1';

export class ClockError extends Error {}

/** The TypeScript reference of the generated virtual clock. */
export class VirtualClock {
  private t = 0;

  get now(): number {
    return this.t;
  }

  /** Moves time forward by ms; a negative, NaN or infinite step throws and leaves the time unchanged. */
  advance(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) throw new ClockError(`advance(${ms}): a step must be a finite, non-negative number of milliseconds`);
    this.t += ms;
  }
}

// A function, not a constant: emit/native-support.ts reads it while this module may still be initialising (import cycle).
function swiftText(): string {
  return String.raw`import Foundation

/// The document timeline clock in milliseconds (T047 RT-5); every animated value is a function of now.
public protocol DragonClock: AnyObject {
  var now: Double { get }
}

/// The virtual driver: time moves only by advance(ms), so two runs of one script give identical dumps.
public final class DragonVirtualClock: DragonClock {
  public private(set) var now: Double = 0
  public init() {}
  public func advance(_ ms: Double) {
    if !ms.isFinite || ms < 0 { fatalError("dragon: advance(\(ms)): a step must be a finite, non-negative number of milliseconds") }
    now += ms
  }
}
`;
}

// A function, not a constant: emit/native-support.ts reads it while this module may still be initialising (import cycle).
function kotlinText(): string {
  return String.raw`package dev.dragon.views

/** The document timeline clock in milliseconds (T047 RT-5); every animated value is a function of now. */
interface DragonClock {
  val now: Double
}

/** The virtual driver: time moves only by advance(ms), so two runs of one script give identical dumps. */
class DragonVirtualClock : DragonClock {
  override var now: Double = 0.0
    private set
  fun advance(ms: Double) {
    if (!ms.isFinite() || ms < 0.0) throw IllegalStateException("dragon: advance(" + ms + "): a step must be a finite, non-negative number of milliseconds")
    now += ms
  }
}
`;
}

/** The clock support source of a backend. */
export function clockSupport(backend: 'uikit' | 'android-views', header: (what: string) => string): GeneratedFile {
  return backend === 'uikit'
    ? { path: 'Support/DragonClock.swift', text: header('the runtime clock and its virtual driver') + swiftText() }
    : { path: 'kotlin/dev/dragon/views/DragonClock.kt', text: header('the runtime clock and its virtual driver') + kotlinText() };
}
