// MISC-PAINT: the native border image's stop offsets as the engine resolves them (paint-gradient.ts gradientDesc, Blink's
// Gradient AddStops in float32), so the compiler refuses the stops that would leave the device's plan unmodelled. The one file of
// the analysis that rounds to float32 (ua.test.ts exempts it by path).
/**
 * Whether percent stops resolve apart as the native raster resolves them: paint-gradient.ts gradientDesc's AddStops in f32 (an
 * offset is fround(fround(v) / 100), the first unpositioned stop 0 and the last 1, each positioned stop at least the one before,
 * unpositioned runs spread between their neighbours), then the last offset after the first and, when the offsets leave [0, 1] and
 * are normalised, a span of at least one float epsilon (else the port draws no gradient). The engine's own
 * borderImageStopsModelled runs the same resolution and the shader (border-image.test.ts compares the two).
 */
export function stopsResolveApart(stops: readonly { readonly unit: 'auto' | 'percent' | 'px'; readonly value: number }[]): boolean {
  const f = Math.fround;
  const n = stops.length;
  if (n < 2) return false;
  const offsets: number[] = [];
  const specified: boolean[] = [];
  for (let i = 0; i < n; i++) {
    const s = stops[i] as (typeof stops)[number];
    if (s.unit === 'px') return false;
    let offset = 0;
    let given = false;
    if (s.unit === 'percent') {
      offset = f(f(s.value) / 100);
      given = true;
    } else if (i === 0) given = true;
    else if (i === n - 1) {
      offset = 1;
      given = true;
    }
    if (given && i > 0) {
      let prev = i - 1;
      while (prev > 0 && !(specified[prev] as boolean)) prev--;
      if (offset < (offsets[prev] as number)) offset = offsets[prev] as number;
    }
    offsets.push(offset);
    specified.push(given);
  }
  const first = offsets[0] as number;
  const last = offsets[n - 1] as number;
  if (!(last > first)) return false;
  const normalised = first < 0 || last > 1;
  return !normalised || Math.max(f(last - first), 0) >= 1.1920928955078125e-7;
}
