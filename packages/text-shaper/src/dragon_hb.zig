//! dragon_hb: Dragon's shim over unmodified HarfBuzz (vendor/harfbuzz, Chrome 145's pin).
//!
//! It sets HarfBuzz up the way Blink does on macOS (harfbuzz_face.cc, skia_text_metrics.cc,
//! font_custom_platform_data.cc) and hands back integers only: glyph id, cluster, x/y advance,
//! x/y offset and the glyph flags (unsafe-to-break). All float and LayoutUnit arithmetic stays in the
//! engine, so the WASM, iOS and Android builds return identical numbers.

const std = @import("std");

// ---- HarfBuzz C API (declared by hand; the ABI is HarfBuzz's public, stable one) ----

const hb_bool_t = c_int;
const hb_codepoint_t = u32;
const hb_position_t = i32;
const hb_tag_t = u32;
const hb_blob_t = opaque {};
const hb_face_t = opaque {};
const hb_font_t = opaque {};
const hb_font_funcs_t = opaque {};
const hb_buffer_t = opaque {};
const hb_language_t = ?*const anyopaque;
const hb_destroy_func_t = ?*const fn (?*anyopaque) callconv(.c) void;

pub const hb_feature_t = extern struct { tag: hb_tag_t, value: u32, start: c_uint, end: c_uint };
pub const hb_variation_t = extern struct { tag: hb_tag_t, value: f32 };
const hb_glyph_info_t = extern struct { codepoint: hb_codepoint_t, mask: u32, cluster: u32, var1: u32, var2: u32 };
const hb_glyph_position_t = extern struct { x_advance: hb_position_t, y_advance: hb_position_t, x_offset: hb_position_t, y_offset: hb_position_t, v: u32 };
const hb_glyph_extents_t = extern struct { x_bearing: hb_position_t, y_bearing: hb_position_t, width: hb_position_t, height: hb_position_t };
const hb_ot_var_axis_info_t = extern struct { axis_index: c_uint, tag: hb_tag_t, name_id: c_uint, flags: c_uint, min_value: f32, default_value: f32, max_value: f32, reserved: c_uint };

const HB_MEMORY_MODE_DUPLICATE: c_int = 0;

const hb_advance_func_t = *const fn (*hb_font_t, ?*anyopaque, hb_codepoint_t, ?*anyopaque) callconv(.c) hb_position_t;
const hb_advances_func_t = *const fn (*hb_font_t, ?*anyopaque, c_uint, [*]const u8, c_uint, [*]u8, c_uint, ?*anyopaque) callconv(.c) void;

extern fn hb_blob_create(data: [*]const u8, length: c_uint, mode: c_int, user_data: ?*anyopaque, destroy: hb_destroy_func_t) *hb_blob_t;
extern fn hb_blob_destroy(blob: *hb_blob_t) void;
extern fn hb_blob_get_length(blob: *hb_blob_t) c_uint;
extern fn hb_blob_get_data(blob: *hb_blob_t, length: *c_uint) ?[*]const u8;
extern fn hb_face_create(blob: *hb_blob_t, index: c_uint) *hb_face_t;
extern fn hb_face_destroy(face: *hb_face_t) void;
extern fn hb_face_get_upem(face: *hb_face_t) c_uint;
extern fn hb_face_reference_table(face: *hb_face_t, tag: hb_tag_t) *hb_blob_t;
extern fn hb_ot_var_get_axis_infos(face: *hb_face_t, start: c_uint, count: *c_uint, infos: [*]hb_ot_var_axis_info_t) c_uint;
extern fn hb_ot_layout_table_get_feature_tags(face: *hb_face_t, table: hb_tag_t, start: c_uint, count: *c_uint, tags: [*]hb_tag_t) c_uint;
extern fn hb_font_create(face: *hb_face_t) *hb_font_t;
extern fn hb_font_create_sub_font(parent: *hb_font_t) *hb_font_t;
extern fn hb_font_destroy(font: *hb_font_t) void;
extern fn hb_ot_font_set_funcs(font: *hb_font_t) void;
extern fn hb_font_get_var_coords_normalized(font: *hb_font_t, length: *c_uint) ?[*]const c_int;
extern fn hb_font_set_variations(font: *hb_font_t, variations: [*]const hb_variation_t, length: c_uint) void;
extern fn hb_font_set_scale(font: *hb_font_t, x_scale: c_int, y_scale: c_int) void;
extern fn hb_font_set_ptem(font: *hb_font_t, ptem: f32) void;
extern fn hb_font_set_funcs(font: *hb_font_t, klass: *hb_font_funcs_t, font_data: ?*anyopaque, destroy: hb_destroy_func_t) void;
extern fn hb_font_get_glyph_h_advance(font: *hb_font_t, glyph: hb_codepoint_t) hb_position_t;
extern fn hb_font_get_glyph_extents(font: *hb_font_t, glyph: hb_codepoint_t, extents: *hb_glyph_extents_t) hb_bool_t;
extern fn hb_font_get_nominal_glyph(font: *hb_font_t, unicode: hb_codepoint_t, glyph: *hb_codepoint_t) hb_bool_t;
extern fn hb_font_funcs_create() *hb_font_funcs_t;
extern fn hb_font_funcs_set_glyph_h_advance_func(ffuncs: *hb_font_funcs_t, func: hb_advance_func_t, user_data: ?*anyopaque, destroy: hb_destroy_func_t) void;
extern fn hb_font_funcs_set_glyph_h_advances_func(ffuncs: *hb_font_funcs_t, func: hb_advances_func_t, user_data: ?*anyopaque, destroy: hb_destroy_func_t) void;
extern fn hb_font_funcs_make_immutable(ffuncs: *hb_font_funcs_t) void;
extern fn hb_buffer_create() *hb_buffer_t;
extern fn hb_buffer_destroy(buffer: *hb_buffer_t) void;
extern fn hb_buffer_reset(buffer: *hb_buffer_t) void;
extern fn hb_buffer_add_utf16(buffer: *hb_buffer_t, text: [*]const u16, text_length: c_int, item_offset: c_uint, item_length: c_int) void;
extern fn hb_buffer_set_direction(buffer: *hb_buffer_t, direction: c_uint) void;
extern fn hb_buffer_set_script(buffer: *hb_buffer_t, script: hb_tag_t) void;
extern fn hb_buffer_set_language(buffer: *hb_buffer_t, language: hb_language_t) void;
extern fn hb_buffer_get_length(buffer: *hb_buffer_t) c_uint;
extern fn hb_buffer_get_glyph_infos(buffer: *hb_buffer_t, length: ?*c_uint) [*]hb_glyph_info_t;
extern fn hb_buffer_get_glyph_positions(buffer: *hb_buffer_t, length: ?*c_uint) [*]hb_glyph_position_t;
extern fn hb_glyph_info_get_glyph_flags(info: *const hb_glyph_info_t) c_uint;
extern fn hb_language_from_string(str: [*]const u8, len: c_int) hb_language_t;
extern fn hb_shape(font: *hb_font_t, buffer: *hb_buffer_t, features: ?[*]const hb_feature_t, num_features: c_uint) void;

extern fn malloc(size: usize) ?*anyopaque;
extern fn realloc(ptr: ?*anyopaque, size: usize) ?*anyopaque;
extern fn free(ptr: ?*anyopaque) void;

fn tag(comptime s: *const [4]u8) hb_tag_t {
    return (@as(u32, s[0]) << 24) | (@as(u32, s[1]) << 16) | (@as(u32, s[2]) << 8) | @as(u32, s[3]);
}

fn create(comptime T: type) ?*T {
    const p = malloc(@sizeOf(T)) orelse return null;
    return @ptrCast(@alignCast(p));
}

// ---- Faces ----

pub const Face = struct {
    face: *hb_face_t,
    upem: u32,
    /// Blink on macOS lets HarfBuzz compute advances when the font has `trak` and no `sbix`
    /// (HarfBuzzSkiaFontFuncs::GetFunctions); every other font gets Skia's advance.
    harfbuzz_advances: bool,
    /// FontFormatCheck::ProbeVariableFont: fvar plus glyf (variable TrueType) or CFF2.
    variable: bool,
    hvar_blob: *hb_blob_t,
    hvar: []const u8,
};

fn hasTable(face: *hb_face_t, t: hb_tag_t) bool {
    const blob = hb_face_reference_table(face, t);
    defer hb_blob_destroy(blob);
    return hb_blob_get_length(blob) != 0;
}

/// Creates a face from font file bytes (copied). Returns null on allocation failure.
export fn dhb_face_create(data: [*]const u8, length: u32, index: u32) ?*Face {
    const blob = hb_blob_create(data, length, HB_MEMORY_MODE_DUPLICATE, null, null);
    defer hb_blob_destroy(blob);
    const f = create(Face) orelse return null;
    const face = hb_face_create(blob, index);
    const hvar_blob = hb_face_reference_table(face, tag("HVAR"));
    var hvar_len: c_uint = 0;
    const hvar_data = hb_blob_get_data(hvar_blob, &hvar_len);
    f.* = .{
        .face = face,
        .upem = hb_face_get_upem(face),
        .harfbuzz_advances = hasTable(face, tag("trak")) and !hasTable(face, tag("sbix")),
        .variable = hasTable(face, tag("fvar")) and (hasTable(face, tag("glyf")) or hasTable(face, tag("CFF2"))),
        .hvar_blob = hvar_blob,
        .hvar = if (hvar_data) |d| d[0..hvar_len] else &.{},
    };
    return f;
}

export fn dhb_face_destroy(f: *Face) void {
    hb_blob_destroy(f.hvar_blob);
    hb_face_destroy(f.face);
    free(f);
}

export fn dhb_face_upem(f: *const Face) u32 {
    return f.upem;
}

export fn dhb_face_has_table(f: *const Face, t: u32) u32 {
    return @intFromBool(hasTable(f.face, t));
}

/// Writes up to `capacity` GSUB or GPOS feature tags (all scripts) and returns the total count.
export fn dhb_face_feature_tags(f: *const Face, table: u32, out: [*]u32, capacity: u32) u32 {
    var count: c_uint = capacity;
    return hb_ot_layout_table_get_feature_tags(f.face, table, 0, &count, out);
}

// ---- Fonts ----

pub const Font = struct {
    face: *Face,
    /// The font HarfBuzz shapes with: Blink's `unscaled_font_`, a sub-font of `ot`.
    font: *hb_font_t,
    /// hb_ot font with the same variations (Blink's `ot_font`).
    ot: *hb_font_t,
    /// Same face, no variations, scale = upem: the hmtx advance in font units.
    units: *hb_font_t,
    size: f32,
    /// HVAR table and normalized coordinates when the font is a variable instance.
    hvar: ?Hvar,
};

/// SkiaScalarToHarfBuzzPosition: ClampTo<int>(value * 65536) with a float multiply, truncating.
fn skiaScalarToHarfBuzzPosition(value: f32) i32 {
    const v = value * 65536.0;
    if (std.math.isNan(v)) return 0;
    if (v >= 2147483647.0) return std.math.maxInt(i32);
    if (v <= -2147483648.0) return std.math.minInt(i32);
    return @intFromFloat(v);
}

/// Chrome's glyph advance on macOS: Core Text gives units * size / upem (CGFloat), Skia stores it as
/// a float, subpixel positioning keeps it unrounded, and Blink converts it to 16.16. For a variable
/// instance Core Text adds the HVAR delta unrounded (HarfBuzz's own advances round it to a unit).
fn chromeAdvance(f: *const Font, glyph: hb_codepoint_t) hb_position_t {
    var units: f64 = @floatFromInt(hb_font_get_glyph_h_advance(f.units, glyph));
    if (f.hvar) |*h| units += h.advanceDelta(glyph);
    const width: f32 = @floatCast(units * @as(f64, f.size) / @as(f64, @floatFromInt(f.face.upem)));
    return skiaScalarToHarfBuzzPosition(width);
}

/// HVAR advance deltas (OpenType ItemVariationStore), evaluated at F2DOT14 normalized coordinates
/// with float region scalars, without rounding the result.
const Hvar = struct {
    data: []const u8,
    coords: [MAX_AXES]c_int,
    axis_count: usize,

    fn u16at(self: *const Hvar, o: usize) ?u16 {
        if (o + 2 > self.data.len) return null;
        return std.mem.readInt(u16, self.data[o..][0..2], .big);
    }
    fn i16at(self: *const Hvar, o: usize) ?i16 {
        return @bitCast(self.u16at(o) orelse return null);
    }
    fn u32at(self: *const Hvar, o: usize) ?u32 {
        if (o + 4 > self.data.len) return null;
        return std.mem.readInt(u32, self.data[o..][0..4], .big);
    }
    fn coord(self: *const Hvar, axis: usize) f32 {
        const c: c_int = if (axis < self.axis_count) self.coords[axis] else 0;
        return @as(f32, @floatFromInt(c)) / 16384.0;
    }

    fn advanceDelta(self: *const Hvar, glyph: u32) f64 {
        return self.delta(glyph) orelse 0;
    }

    fn delta(self: *const Hvar, glyph: u32) ?f64 {
        const store: usize = self.u32at(4) orelse return null;
        const map_off: usize = self.u32at(8) orelse return null;
        // DeltaSetIndexMap (advance mapping), or the implicit outer 0 / inner glyph id.
        var outer: u32 = 0;
        var inner: u32 = glyph;
        if (map_off != 0) {
            if (map_off + 2 > self.data.len) return null;
            const format = self.data[map_off];
            const entry_format = self.data[map_off + 1];
            const count: u32 = if (format == 0) self.u16at(map_off + 2) orelse return null else self.u32at(map_off + 2) orelse return null;
            if (count == 0) return null;
            const data = map_off + @as(usize, if (format == 0) 4 else 6);
            const size: usize = ((entry_format >> 4) & 3) + 1;
            const inner_bits: u5 = @intCast((entry_format & 15) + 1);
            const idx: usize = @min(glyph, count - 1);
            if (data + (idx + 1) * size > self.data.len) return null;
            var v: u32 = 0;
            for (0..size) |k| v = (v << 8) | self.data[data + idx * size + k];
            outer = v >> inner_bits;
            inner = v & ((@as(u32, 1) << inner_bits) - 1);
        }
        const region_list = store + (self.u32at(store + 2) orelse return null);
        const data_count = self.u16at(store + 6) orelse return null;
        if (outer >= data_count) return null;
        const vd = store + (self.u32at(store + 8 + 4 * @as(usize, outer)) orelse return null);
        const item_count = self.u16at(vd) orelse return null;
        if (inner >= item_count) return null;
        const word_raw = self.u16at(vd + 2) orelse return null;
        const long_words = (word_raw & 0x8000) != 0;
        const word_count: usize = word_raw & 0x7fff;
        const region_count: usize = self.u16at(vd + 4) orelse return null;
        const row_size: usize = if (long_words) word_count * 4 + (region_count - word_count) * 2 else word_count * 2 + (region_count - word_count);
        var o: usize = vd + 6 + 2 * region_count + @as(usize, inner) * row_size;
        const axis_count: usize = self.u16at(region_list) orelse return null;
        const regions_total = self.u16at(region_list + 2) orelse return null;
        var sum: f32 = 0;
        for (0..region_count) |k| {
            var dv: i32 = undefined;
            if (k < word_count) {
                if (long_words) {
                    dv = @bitCast(self.u32at(o) orelse return null);
                    o += 4;
                } else {
                    dv = self.i16at(o) orelse return null;
                    o += 2;
                }
            } else if (long_words) {
                dv = self.i16at(o) orelse return null;
                o += 2;
            } else {
                if (o >= self.data.len) return null;
                dv = @as(i8, @bitCast(self.data[o]));
                o += 1;
            }
            const region = self.u16at(vd + 6 + 2 * k) orelse return null;
            if (region >= regions_total) return null;
            var scalar: f32 = 1;
            for (0..axis_count) |a| {
                const r = region_list + 4 + (@as(usize, region) * axis_count + a) * 6;
                const start = @as(f32, @floatFromInt(self.i16at(r) orelse return null)) / 16384.0;
                const peak = @as(f32, @floatFromInt(self.i16at(r + 2) orelse return null)) / 16384.0;
                const end = @as(f32, @floatFromInt(self.i16at(r + 4) orelse return null)) / 16384.0;
                if (peak == 0 or start > peak or peak > end or (start < 0 and end > 0)) continue;
                const c = self.coord(a);
                if (c < start or c > end) {
                    scalar = 0;
                    break;
                }
                if (c == peak) continue;
                scalar *= if (c < peak) (c - start) / (peak - start) else (end - c) / (end - peak);
            }
            sum += scalar * @as(f32, @floatFromInt(dv));
        }
        return sum;
    }
};

fn advanceFunc(_: *hb_font_t, font_data: ?*anyopaque, glyph: hb_codepoint_t, _: ?*anyopaque) callconv(.c) hb_position_t {
    const f: *const Font = @ptrCast(@alignCast(font_data.?));
    return chromeAdvance(f, glyph);
}

fn advancesFunc(_: *hb_font_t, font_data: ?*anyopaque, count: c_uint, first_glyph: [*]const u8, glyph_stride: c_uint, first_advance: [*]u8, advance_stride: c_uint, _: ?*anyopaque) callconv(.c) void {
    const f: *const Font = @ptrCast(@alignCast(font_data.?));
    var i: usize = 0;
    while (i < count) : (i += 1) {
        const g: *align(1) const hb_codepoint_t = @ptrCast(first_glyph + i * glyph_stride);
        const a: *align(1) hb_position_t = @ptrCast(first_advance + i * advance_stride);
        a.* = chromeAdvance(f, g.*);
    }
}

var skia_funcs: ?*hb_font_funcs_t = null;

fn skiaFuncs() *hb_font_funcs_t {
    if (skia_funcs) |ff| return ff;
    const ff = hb_font_funcs_create();
    hb_font_funcs_set_glyph_h_advance_func(ff, advanceFunc, null, null);
    hb_font_funcs_set_glyph_h_advances_func(ff, advancesFunc, null, null);
    hb_font_funcs_make_immutable(ff);
    skia_funcs = ff;
    return ff;
}

const MAX_AXES = 64;

fn readU16(d: []const u8, o: usize) ?u16 {
    if (o + 2 > d.len) return null;
    return std.mem.readInt(u16, d[o..][0..2], .big);
}

/// Core Text's normalized coordinates for advances: clamp, normalize, round to F2DOT14, avar, round.
/// HarfBuzz rounds through 16.16 (Inter opsz 16: 1821, Core Text 1820) and keeps its own for GPOS, as in Chrome.
fn coreTextCoords(face: *Face, vars: []const hb_variation_t, out: *[MAX_AXES]c_int) usize {
    var infos: [MAX_AXES]hb_ot_var_axis_info_t = undefined;
    var count: c_uint = MAX_AXES;
    _ = hb_ot_var_get_axis_infos(face.face, 0, &count, &infos);
    const avar_blob = hb_face_reference_table(face.face, tag("avar"));
    defer hb_blob_destroy(avar_blob);
    var avar_len: c_uint = 0;
    const avar: []const u8 = if (hb_blob_get_data(avar_blob, &avar_len)) |d| d[0..avar_len] else &.{};
    var map_off: usize = 8;
    for (infos[0..count], 0..) |a, i| {
        var v: f64 = a.default_value;
        for (vars) |x| {
            if (x.tag == a.tag) v = x.value;
        }
        v = @max(@as(f64, a.min_value), @min(@as(f64, a.max_value), v));
        const def: f64 = a.default_value;
        var nrm: f64 = if (v < def) (v - def) / (def - a.min_value) else if (v > def) (v - def) / (a.max_value - def) else 0;
        nrm = @round(nrm * 16384.0) / 16384.0;
        // avar segment map for this axis.
        if (avar.len >= 8) {
            if (readU16(avar, map_off)) |pairs| {
                const base = map_off + 2;
                var k: usize = 1;
                while (k < pairs) : (k += 1) {
                    const from0: f64 = @as(f64, @floatFromInt(@as(i16, @bitCast(readU16(avar, base + (k - 1) * 4) orelse 0)))) / 16384.0;
                    const to0: f64 = @as(f64, @floatFromInt(@as(i16, @bitCast(readU16(avar, base + (k - 1) * 4 + 2) orelse 0)))) / 16384.0;
                    const from1: f64 = @as(f64, @floatFromInt(@as(i16, @bitCast(readU16(avar, base + k * 4) orelse 0)))) / 16384.0;
                    const to1: f64 = @as(f64, @floatFromInt(@as(i16, @bitCast(readU16(avar, base + k * 4 + 2) orelse 0)))) / 16384.0;
                    if (nrm <= from1) {
                        nrm = if (from1 == from0) to1 else to0 + (nrm - from0) * (to1 - to0) / (from1 - from0);
                        break;
                    }
                }
                map_off = base + @as(usize, pairs) * 4;
            }
        }
        out[i] = @intFromFloat(@round(nrm * 16384.0));
    }
    return count;
}

fn axisRange(infos: []const hb_ot_var_axis_info_t, t: hb_tag_t) ?hb_ot_var_axis_info_t {
    for (infos) |a| if (a.tag == t) return a;
    return null;
}

/// Creates a font the way Blink does for an @font-face font with no descriptors.
///
/// size: the computed pixel size (FontPlatformData::size). specified_size: the CSS specified size
/// (drives `opsz` and ptem). weight/width/slope: the requested font-weight, font-stretch (percent)
/// and oblique angle (degrees, CSS direction). optical_sizing_auto: font-optical-sizing.
/// settings: font-variation-settings, applied after the automatic axes (a later entry wins).
export fn dhb_font_create(face: *Face, size: f32, specified_size: f32, weight: f32, width: f32, slope: f32, optical_sizing_auto: u32, settings: ?[*]const hb_variation_t, settings_count: u32) ?*Font {
    var vars: [MAX_AXES + 4]hb_variation_t = undefined;
    var n: usize = 0;
    if (face.variable) {
        var infos: [MAX_AXES]hb_ot_var_axis_info_t = undefined;
        var count: c_uint = MAX_AXES;
        _ = hb_ot_var_get_axis_infos(face.face, 0, &count, &infos);
        const axes = infos[0..count];
        // FontCustomPlatformData::GetFontPlatformData: with descriptors left at auto, the request is
        // clamped to the axis range when the axis exists.
        const clamp = struct {
            fn f(a: ?hb_ot_var_axis_info_t, v: f32) f32 {
                const r = a orelse return v;
                return @max(r.min_value, @min(r.max_value, v));
            }
        }.f;
        vars[n] = .{ .tag = tag("wght"), .value = clamp(axisRange(axes, tag("wght")), weight) };
        n += 1;
        vars[n] = .{ .tag = tag("wdth"), .value = clamp(axisRange(axes, tag("wdth")), width) };
        n += 1;
        vars[n] = .{ .tag = tag("slnt"), .value = clamp(axisRange(axes, tag("slnt")), -slope) };
        n += 1;
        var explicit_opsz = false;
        if (settings) |s| {
            for (s[0..settings_count]) |v| {
                if (v.tag == tag("opsz")) explicit_opsz = true;
                if (n < vars.len) {
                    vars[n] = v;
                    n += 1;
                }
            }
        }
        if (!explicit_opsz) {
            if (optical_sizing_auto != 0) {
                vars[n] = .{ .tag = tag("opsz"), .value = specified_size };
                n += 1;
            } else if (axisRange(axes, tag("opsz"))) |a| {
                vars[n] = .{ .tag = tag("opsz"), .value = a.default_value };
                n += 1;
            }
        }
    }

    const f = create(Font) orelse return null;
    const ot = hb_font_create(face.face);
    hb_ot_font_set_funcs(ot);
    const units = hb_font_create(face.face);
    hb_ot_font_set_funcs(units);
    if (n > 0) hb_font_set_variations(ot, &vars, @intCast(n));
    const upem: c_int = @intCast(face.upem);
    hb_font_set_scale(units, upem, upem);

    var hvar: ?Hvar = null;
    if (n > 0 and face.hvar.len > 0) {
        var h: Hvar = .{ .data = face.hvar, .coords = undefined, .axis_count = 0 };
        h.axis_count = coreTextCoords(face, vars[0..n], &h.coords);
        hvar = h;
    }

    const font = hb_font_create_sub_font(ot);
    f.* = .{ .face = face, .font = font, .ot = ot, .units = units, .size = size, .hvar = hvar };
    if (!face.harfbuzz_advances) hb_font_set_funcs(font, skiaFuncs(), f, null);
    // HarfBuzzFace::GetScaledFont.
    const scale = skiaScalarToHarfBuzzPosition(size);
    hb_font_set_scale(font, scale, scale);
    hb_font_set_ptem(font, if (specified_size > 0) specified_size else size);
    return f;
}

export fn dhb_font_destroy(f: *Font) void {
    hb_font_destroy(f.font);
    hb_font_destroy(f.ot);
    hb_font_destroy(f.units);
    free(f);
}

/// The 16.16 advance HarfBuzz sees for a glyph (after the Chrome advance function).
export fn dhb_font_glyph_advance(f: *Font, glyph: u32) i32 {
    return hb_font_get_glyph_h_advance(f.font, glyph);
}

/// The default-instance advance in font units (hmtx).
export fn dhb_font_glyph_units(f: *Font, glyph: u32) i32 {
    return hb_font_get_glyph_h_advance(f.units, glyph);
}

/// Glyph ink extents in 16.16 at the font size: x_bearing, y_bearing (y up), width, height (negative).
export fn dhb_font_glyph_extents(f: *Font, glyph: u32, out: *[4]i32) u32 {
    var e: hb_glyph_extents_t = undefined;
    const ok = hb_font_get_glyph_extents(f.font, glyph, &e);
    out.* = .{ e.x_bearing, e.y_bearing, e.width, e.height };
    return @intFromBool(ok != 0);
}

export fn dhb_font_nominal_glyph(f: *Font, codepoint: u32) u32 {
    var g: hb_codepoint_t = 0;
    return if (hb_font_get_nominal_glyph(f.font, codepoint, &g) != 0) g else 0;
}

// ---- Shaping ----

/// Integers per output glyph: glyph id, cluster, x advance, y advance, x offset, y offset, flags.
pub const GLYPH_STRIDE = 7;

pub const Shaper = struct {
    buffer: *hb_buffer_t,
    out: ?[*]i32,
    capacity: usize,
};

export fn dhb_shaper_create() ?*Shaper {
    const s = create(Shaper) orelse return null;
    s.* = .{ .buffer = hb_buffer_create(), .out = null, .capacity = 0 };
    return s;
}

export fn dhb_shaper_destroy(s: *Shaper) void {
    hb_buffer_destroy(s.buffer);
    free(s.out);
    free(s);
}

/// Shapes text[item_offset, item_offset + item_length) with the whole text as context, the way
/// Blink's CaseMappingHarfBuzzBufferFiller and ShapeRange do. script is an ISO 15924 tag
/// (hb_script_t), direction an hb_direction_t (4 = LTR). Returns the glyph count, or
/// 0xFFFFFFFF on allocation failure; the glyphs are at dhb_shaper_glyphs until the next call.
export fn dhb_shape(s: *Shaper, f: *Font, text: [*]const u16, text_length: u32, item_offset: u32, item_length: u32, script: u32, direction: u32, language: [*]const u8, language_length: u32, features: ?[*]const hb_feature_t, feature_count: u32) u32 {
    const b = s.buffer;
    hb_buffer_reset(b);
    hb_buffer_add_utf16(b, text, @intCast(text_length), item_offset, @intCast(item_length));
    hb_buffer_set_language(b, hb_language_from_string(language, @intCast(language_length)));
    hb_buffer_set_script(b, script);
    hb_buffer_set_direction(b, direction);
    hb_shape(f.font, b, features, feature_count);

    var len: c_uint = 0;
    const infos = hb_buffer_get_glyph_infos(b, &len);
    const pos = hb_buffer_get_glyph_positions(b, null);
    const need = @as(usize, len) * GLYPH_STRIDE;
    if (need > s.capacity) {
        const p = realloc(s.out, need * @sizeOf(i32)) orelse return 0xFFFFFFFF;
        s.out = @ptrCast(@alignCast(p));
        s.capacity = need;
    }
    const out = s.out orelse return 0;
    var i: usize = 0;
    while (i < len) : (i += 1) {
        const o = out + i * GLYPH_STRIDE;
        o[0] = @bitCast(infos[i].codepoint);
        o[1] = @bitCast(infos[i].cluster);
        o[2] = pos[i].x_advance;
        o[3] = pos[i].y_advance;
        o[4] = pos[i].x_offset;
        o[5] = pos[i].y_offset;
        o[6] = @bitCast(hb_glyph_info_get_glyph_flags(&infos[i]));
    }
    return len;
}

export fn dhb_shaper_glyphs(s: *Shaper) ?[*]i32 {
    return s.out;
}

// ---- Memory for hosts without a C allocator of their own (the WASM loader) ----

export fn dhb_alloc(size: u32) ?*anyopaque {
    return malloc(size);
}

export fn dhb_free(ptr: ?*anyopaque) void {
    free(ptr);
}

/// The normalized variation coordinates HarfBuzz uses (F2DOT14 after avar); returns the axis count.
export fn dhb_font_var_coords(f: *Font, out: [*]i32, capacity: u32) u32 {
    var n: c_uint = 0;
    const coords = hb_font_get_var_coords_normalized(f.ot, &n) orelse return 0;
    for (0..@min(n, capacity)) |i| out[i] = coords[i];
    return n;
}
