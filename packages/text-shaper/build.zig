//! Builds dragon_hb (src/dragon_hb.zig over vendor/harfbuzz, unmodified) three ways:
//!   zig build wasm     -> zig-out/wasm/dragon_hb.wasm (Node: compiler, TS reference engine, tests)
//!   zig build ios      -> zig-out/ios/DragonHB.xcframework (arm64 device + arm64 simulator, static)
//!   zig build android  -> zig-out/android/{arm64-v8a,x86_64}/libdragon_hb.so (plus the JNI glue, src/dragon_hb_jni.zig)
//!   zig build host     -> zig-out/host/libdragon_hb.a (aarch64-macos, static, for SwiftPM: swift/)
//!   zig build host-jni -> zig-out/host-jni/libdragon_hb.dylib (aarch64-macos, with the JNI glue, for the JVM: kotlin/)
//!   zig build          -> all five
//! Android needs an NDK: -Dandroid-ndk=<path> or ANDROID_NDK_HOME. host-jni needs a JDK: -Djava-home=<path> or JAVA_HOME.
const std = @import("std");

const hb_src = "../../vendor/harfbuzz/src";

/// Chromium's harfbuzz-ng BUILD.gn defines (Chrome 145), minus ICU: Dragon uses HarfBuzz's own
/// Unicode data. Plus Blink's build flags that affect arithmetic: no FP contraction.
const hb_flags = [_][]const u8{
    "-std=c++17",
    "-fno-exceptions",
    "-fno-rtti",
    "-fno-threadsafe-statics",
    "-ffp-contract=off",
    "-fno-strict-aliasing",
    "-fvisibility=hidden",
    "-DNDEBUG",
    "-DHAVE_OT",
    "-DHB_NO_MMAP",
    "-DHB_NO_RESOURCE_FORK",
    "-DHB_NO_PAINT=",
    "-DHB_NO_FALLBACK_SHAPE",
    "-DHB_NO_WIN1256",
    "-DHB_NO_BUFFER_VERIFY",
    "-DHB_NO_DRAW",
    "-DHB_NO_BORING_EXPANSION",
    "-DHB_NO_AVAR2",
    "-DHB_NO_PRAGMA_GCC_DIAGNOSTIC_ERROR",
    "-DHB_NO_PRAGMA_GCC_DIAGNOSTIC_WARNING",
};

const Threads = enum { none, pthread };

fn hbModule(b: *std.Build, target: std.Build.ResolvedTarget, optimize: std.builtin.OptimizeMode, threads: Threads) *std.Build.Module {
    const m = b.createModule(.{
        .root_source_file = b.path("src/dragon_hb.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
        .link_libcpp = true,
        .strip = true,
        .pic = true,
    });
    var flags: std.ArrayList([]const u8) = .empty;
    flags.appendSlice(b.allocator, &hb_flags) catch @panic("OOM");
    flags.append(b.allocator, switch (threads) {
        .none => "-DHB_NO_MT",
        .pthread => "-DHAVE_PTHREAD",
    }) catch @panic("OOM");
    m.addCSourceFiles(.{ .root = b.path(hb_src), .files = &.{"harfbuzz.cc"}, .flags = flags.items });
    m.addIncludePath(b.path(hb_src));
    return m;
}

fn libcFile(b: *std.Build, name: []const u8, include_dir: []const u8, sys_include_dir: []const u8, crt_dir: []const u8) std.Build.LazyPath {
    const wf = b.addWriteFiles();
    return wf.add(name, b.fmt(
        "include_dir={s}\nsys_include_dir={s}\ncrt_dir={s}\nmsvc_lib_dir=\nkernel32_lib_dir=\ngcc_dir=\n",
        .{ include_dir, sys_include_dir, crt_dir },
    ));
}

/// src/dragon_hb_jni.zig as an object for a library that already holds the shim; jni.h comes from jni_include.
fn jniObject(b: *std.Build, target: std.Build.ResolvedTarget, optimize: std.builtin.OptimizeMode, jni_include: []const []const u8) *std.Build.Step.Compile {
    const m = b.createModule(.{
        .root_source_file = b.path("src/dragon_hb_jni.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
        .strip = true,
        .pic = true,
    });
    m.addIncludePath(b.path("include"));
    for (jni_include) |dir| m.addSystemIncludePath(.{ .cwd_relative = dir });
    return b.addObject(.{ .name = "dragon_hb_jni", .root_module = m });
}

pub fn build(b: *std.Build) void {
    const optimize = b.option(std.builtin.OptimizeMode, "optimize", "Optimization mode (default ReleaseSmall)") orelse .ReleaseSmall;

    // ---- WASM (wasm32-wasi, no entry point; the loader supplies the few WASI imports) ----
    const wasm_step = b.step("wasm", "Build dragon_hb.wasm");
    {
        const target = b.resolveTargetQuery(.{ .cpu_arch = .wasm32, .os_tag = .wasi });
        const exe = b.addExecutable(.{ .name = "dragon_hb", .root_module = hbModule(b, target, optimize, .none) });
        exe.entry = .disabled;
        exe.wasi_exec_model = .reactor;
        exe.rdynamic = true;
        const install = b.addInstallArtifact(exe, .{ .dest_dir = .{ .override = .{ .custom = "wasm" } } });
        wasm_step.dependOn(&install.step);
    }

    // ---- iOS: static libraries for arm64 device and arm64 simulator, bundled as an xcframework ----
    const ios_step = b.step("ios", "Build DragonHB.xcframework");
    if (b.graph.host.result.os.tag != .macos) {
        // The slices need the Xcode SDKs (xcrun), so a Linux host still configures the other steps.
        const fail = b.addFail("the iOS build needs macOS with Xcode (xcrun)");
        ios_step.dependOn(&fail.step);
    } else {
        const header_dir = b.path("include");
        const Slice = struct { sdk: []const u8, abi: std.Target.Abi, dir: []const u8 };
        const slices = [_]Slice{
            .{ .sdk = "iphoneos", .abi = .none, .dir = "ios-arm64" },
            .{ .sdk = "iphonesimulator", .abi = .simulator, .dir = "ios-arm64-simulator" },
        };
        const xc = b.addSystemCommand(&.{ "sh", "-c", "rm -rf \"$0\" && xcodebuild -create-xcframework \"$@\" -output \"$0\" >/dev/null" });
        const out = b.getInstallPath(.prefix, "ios/DragonHB.xcframework");
        xc.addArg(out);
        for (slices) |s| {
            const sdk = std.mem.trim(u8, b.run(&.{ "xcrun", "--sdk", s.sdk, "--show-sdk-path" }), " \n");
            const target = b.resolveTargetQuery(.{
                .cpu_arch = .aarch64,
                .os_tag = .ios,
                .abi = s.abi,
                .os_version_min = .{ .semver = .{ .major = 15, .minor = 0, .patch = 0 } },
            });
            const lib = b.addLibrary(.{ .name = "dragon_hb", .linkage = .static, .root_module = hbModule(b, target, optimize, .pthread) });
            const inc = b.fmt("{s}/usr/include", .{sdk});
            lib.setLibCFile(libcFile(b, b.fmt("libc-{s}.txt", .{s.sdk}), inc, inc, b.fmt("{s}/usr/lib", .{sdk})));
            const install = b.addInstallArtifact(lib, .{ .dest_dir = .{ .override = .{ .custom = b.fmt("ios/{s}", .{s.dir}) } } });
            xc.step.dependOn(&install.step);
            xc.addArg("-library");
            xc.addFileArg(lib.getEmittedBin());
            xc.addArg("-headers");
            xc.addDirectoryArg(header_dir);
        }
        ios_step.dependOn(&xc.step);
    }

    // ---- Android: shared libraries for arm64-v8a and x86_64 (API 31, Dragon's floor) ----
    const android_step = b.step("android", "Build libdragon_hb.so for arm64-v8a and x86_64");
    {
        const ndk_opt = b.option([]const u8, "android-ndk", "Android NDK root (default: ANDROID_NDK_HOME)");
        const api: u32 = 31;
        if (ndk_opt orelse b.graph.environ_map.get("ANDROID_NDK_HOME")) |ndk| {
            const host_tag = if (b.graph.host.result.os.tag == .macos) "darwin-x86_64" else "linux-x86_64";
            const sysroot = b.fmt("{s}/toolchains/llvm/prebuilt/{s}/sysroot", .{ ndk, host_tag });
            const Abi = struct { arch: std.Target.Cpu.Arch, triple: []const u8, dir: []const u8 };
            const abis = [_]Abi{
                .{ .arch = .aarch64, .triple = "aarch64-linux-android", .dir = "arm64-v8a" },
                .{ .arch = .x86_64, .triple = "x86_64-linux-android", .dir = "x86_64" },
            };
            for (abis) |a| {
                const target = b.resolveTargetQuery(.{
                    .cpu_arch = a.arch,
                    .os_tag = .linux,
                    .abi = .android,
                    .android_api_level = api,
                });
                const lib = b.addLibrary(.{ .name = "dragon_hb", .linkage = .dynamic, .root_module = hbModule(b, target, optimize, .pthread) });
                const libc = libcFile(
                    b,
                    b.fmt("libc-{s}.txt", .{a.triple}),
                    b.fmt("{s}/usr/include", .{sysroot}),
                    b.fmt("{s}/usr/include/{s}", .{ sysroot, a.triple }),
                    b.fmt("{s}/usr/lib/{s}/{d}", .{ sysroot, a.triple, api }),
                );
                lib.setLibCFile(libc);
                // The NDK's jni.h is self-contained (no jni_md.h).
                const jni = jniObject(b, target, optimize, &.{b.fmt("{s}/usr/include", .{sysroot})});
                jni.setLibCFile(libc);
                lib.root_module.addObject(jni);
                // 16 KB page devices (Android 15+) need segment alignment of at least 16 KB.
                lib.link_z_max_page_size = 16384;
                const install = b.addInstallArtifact(lib, .{ .dest_dir = .{ .override = .{ .custom = b.fmt("android/{s}", .{a.dir}) } } });
                android_step.dependOn(&install.step);
            }
        } else {
            const fail = b.addFail("Android build needs an NDK: pass -Dandroid-ndk=<path> or set ANDROID_NDK_HOME");
            android_step.dependOn(&fail.step);
        }
    }

    // ---- macOS host (aarch64): the static library SwiftPM links (swift/) and the JNI dylib the JVM loads (kotlin/) ----
    const host_target = b.resolveTargetQuery(.{
        .cpu_arch = .aarch64,
        .os_tag = .macos,
        .os_version_min = .{ .semver = .{ .major = 13, .minor = 0, .patch = 0 } },
    });
    const host_step = b.step("host", "Build libdragon_hb.a for aarch64-macos (Swift host replay)");
    {
        const lib = b.addLibrary(.{ .name = "dragon_hb", .linkage = .static, .root_module = hbModule(b, host_target, optimize, .pthread) });
        const install = b.addInstallArtifact(lib, .{ .dest_dir = .{ .override = .{ .custom = "host" } } });
        host_step.dependOn(&install.step);
    }
    const host_jni_step = b.step("host-jni", "Build libdragon_hb.dylib with the JNI glue for aarch64-macos (Kotlin host replay)");
    {
        const java_home = b.option([]const u8, "java-home", "JDK home for jni.h (default: JAVA_HOME)") orelse b.graph.environ_map.get("JAVA_HOME");
        if (java_home) |jh| {
            const lib = b.addLibrary(.{ .name = "dragon_hb", .linkage = .dynamic, .root_module = hbModule(b, host_target, optimize, .pthread) });
            lib.root_module.addObject(jniObject(b, host_target, optimize, &.{ b.fmt("{s}/include", .{jh}), b.fmt("{s}/include/darwin", .{jh}) }));
            const install = b.addInstallArtifact(lib, .{ .dest_dir = .{ .override = .{ .custom = "host-jni" } } });
            host_jni_step.dependOn(&install.step);
        } else {
            const fail = b.addFail("host-jni needs a JDK: pass -Djava-home=<path> or set JAVA_HOME");
            host_jni_step.dependOn(&fail.step);
        }
    }

    b.getInstallStep().dependOn(wasm_step);
    b.getInstallStep().dependOn(ios_step);
    b.getInstallStep().dependOn(android_step);
    b.getInstallStep().dependOn(host_step);
    b.getInstallStep().dependOn(host_jni_step);
}
