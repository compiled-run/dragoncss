//! JNI glue for dev.dragon.text.DragonHB (kotlin/): thin wrappers over the C ABI in include/dragon_hb.h.
//! Linked only into the Android libdragon_hb.so and the macOS host JNI dylib (build.zig); never into the WASM.
//! No float arithmetic here: sizes and variation values pass through as f32, results are the shim's integers.
const std = @import("std");
const c = @cImport({
    @cInclude("dragon_hb.h");
    @cInclude("jni.h");
});

const Env = [*c]c.JNIEnv;
const alloc = std.heap.c_allocator;

/// The function table (JNINativeInterface in the NDK's jni.h, JNINativeInterface_ in the JDK's).
fn fns(env: Env) c.JNIEnv {
    return env.*;
}

fn handle(comptime T: type, v: c.jlong) ?*T {
    return @ptrFromInt(@as(usize, @bitCast(@as(isize, @intCast(v)))));
}

fn toLong(p: ?*anyopaque) c.jlong {
    return @intCast(@as(isize, @bitCast(@intFromPtr(p))));
}

export fn Java_dev_dragon_text_DragonHB_faceCreate(env: Env, _: c.jclass, data: c.jbyteArray, index: c.jint) c.jlong {
    const e = fns(env);
    const n: usize = @intCast(e.*.GetArrayLength.?(env, data));
    const buf = alloc.alloc(u8, @max(n, 1)) catch return 0;
    defer alloc.free(buf);
    e.*.GetByteArrayRegion.?(env, data, 0, @intCast(n), @ptrCast(buf.ptr));
    return toLong(c.dhb_face_create(buf.ptr, @intCast(n), @bitCast(index)));
}

export fn Java_dev_dragon_text_DragonHB_faceDestroy(_: Env, _: c.jclass, face: c.jlong) void {
    if (handle(c.dhb_face, face)) |f| c.dhb_face_destroy(f);
}

export fn Java_dev_dragon_text_DragonHB_faceUpem(_: Env, _: c.jclass, face: c.jlong) c.jint {
    return @bitCast(c.dhb_face_upem(handle(c.dhb_face, face)));
}

/// variationTags and variationValues are parallel arrays (either may be null for none).
export fn Java_dev_dragon_text_DragonHB_fontCreate(env: Env, _: c.jclass, face: c.jlong, size: c.jfloat, specified_size: c.jfloat, weight: c.jfloat, width: c.jfloat, slope: c.jfloat, optical_sizing_auto: c.jboolean, variation_tags: c.jintArray, variation_values: c.jfloatArray) c.jlong {
    const e = fns(env);
    const n: usize = if (variation_tags == null or variation_values == null) 0 else @intCast(@min(e.*.GetArrayLength.?(env, variation_tags), e.*.GetArrayLength.?(env, variation_values)));
    const settings = alloc.alloc(c.dhb_variation, @max(n, 1)) catch return 0;
    defer alloc.free(settings);
    if (n > 0) {
        const tags = alloc.alloc(c.jint, n) catch return 0;
        defer alloc.free(tags);
        const values = alloc.alloc(c.jfloat, n) catch return 0;
        defer alloc.free(values);
        e.*.GetIntArrayRegion.?(env, variation_tags, 0, @intCast(n), tags.ptr);
        e.*.GetFloatArrayRegion.?(env, variation_values, 0, @intCast(n), values.ptr);
        for (0..n) |i| settings[i] = .{ .tag = @bitCast(tags[i]), .value = values[i] };
    }
    const font = c.dhb_font_create(handle(c.dhb_face, face), size, specified_size, weight, width, slope, if (optical_sizing_auto != 0) 1 else 0, if (n > 0) settings.ptr else null, @intCast(n));
    return toLong(font);
}

export fn Java_dev_dragon_text_DragonHB_fontDestroy(_: Env, _: c.jclass, font: c.jlong) void {
    if (handle(c.dhb_font, font)) |f| c.dhb_font_destroy(f);
}

export fn Java_dev_dragon_text_DragonHB_glyphAdvance(_: Env, _: c.jclass, font: c.jlong, glyph: c.jint) c.jint {
    return c.dhb_font_glyph_advance(handle(c.dhb_font, font), @bitCast(glyph));
}

export fn Java_dev_dragon_text_DragonHB_nominalGlyph(_: Env, _: c.jclass, font: c.jlong, codepoint: c.jint) c.jint {
    return @bitCast(c.dhb_font_nominal_glyph(handle(c.dhb_font, font), @bitCast(codepoint)));
}

export fn Java_dev_dragon_text_DragonHB_shaperCreate(_: Env, _: c.jclass) c.jlong {
    return toLong(c.dhb_shaper_create());
}

export fn Java_dev_dragon_text_DragonHB_shaperDestroy(_: Env, _: c.jclass, shaper: c.jlong) void {
    if (handle(c.dhb_shaper, shaper)) |s| c.dhb_shaper_destroy(s);
}

/// Shapes text[offset, offset + length) with the whole text as context. features holds 4 ints per feature
/// {tag, value, start, end} (or null). Returns DHB_GLYPH_STRIDE ints per glyph, or null on allocation failure.
export fn Java_dev_dragon_text_DragonHB_shape(env: Env, _: c.jclass, shaper: c.jlong, font: c.jlong, text: c.jstring, offset: c.jint, length: c.jint, script: c.jint, rtl: c.jboolean, language: c.jstring, features: c.jintArray) c.jintArray {
    const e = fns(env);
    const text_len: usize = @intCast(e.*.GetStringLength.?(env, text));
    const units = alloc.alloc(u16, @max(text_len, 1)) catch return null;
    defer alloc.free(units);
    e.*.GetStringRegion.?(env, text, 0, @intCast(text_len), @ptrCast(units.ptr));

    const lang_len: usize = @intCast(e.*.GetStringUTFLength.?(env, language));
    const lang = alloc.alloc(u8, lang_len + 1) catch return null;
    defer alloc.free(lang);
    e.*.GetStringUTFRegion.?(env, language, 0, e.*.GetStringLength.?(env, language), @ptrCast(lang.ptr));

    const nf: usize = if (features == null) 0 else @as(usize, @intCast(e.*.GetArrayLength.?(env, features))) / 4;
    const raw = alloc.alloc(c.jint, @max(nf * 4, 1)) catch return null;
    defer alloc.free(raw);
    const feats = alloc.alloc(c.dhb_feature, @max(nf, 1)) catch return null;
    defer alloc.free(feats);
    if (nf > 0) {
        e.*.GetIntArrayRegion.?(env, features, 0, @intCast(nf * 4), raw.ptr);
        for (0..nf) |i| feats[i] = .{ .tag = @bitCast(raw[i * 4]), .value = @bitCast(raw[i * 4 + 1]), .start = @bitCast(raw[i * 4 + 2]), .end = @bitCast(raw[i * 4 + 3]) };
    }

    const n = c.dhb_shape(handle(c.dhb_shaper, shaper), handle(c.dhb_font, font), units.ptr, @intCast(text_len), @bitCast(offset), @bitCast(length), @bitCast(script), if (rtl != 0) 5 else 4, lang.ptr, @intCast(lang_len), if (nf > 0) feats.ptr else null, @intCast(nf));
    if (n == 0xFFFFFFFF) return null;
    const count: usize = @as(usize, n) * c.DHB_GLYPH_STRIDE;
    const out = e.*.NewIntArray.?(env, @intCast(count));
    if (out == null) return null;
    if (count > 0) e.*.SetIntArrayRegion.?(env, out, 0, @intCast(count), c.dhb_shaper_glyphs(handle(c.dhb_shaper, shaper)));
    return out;
}
