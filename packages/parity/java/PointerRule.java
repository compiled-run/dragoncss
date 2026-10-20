// MQ-R2 (notes/T067-mq-r-spec.md R9, §4): Chromium's own rule for the Android pointer and hover media features, run on the host
// over every source combination to record the readings Dragon's port (packages/layout/src/rt-band.ts androidPointerReadings) must
// give. availablePointerAndHoverTypes and hasSource are TouchDevice.java lines 59-104 at tag 145.0.7632.6
// (ui/android/java/src/org/chromium/ui/base/TouchDevice.java), with the input devices' sources passed in instead of read from
// InputDevice; primaryPointer and primaryHover are GetPrimaryPointerType and GetPrimaryHoverType of
// ui/base/pointer/pointer_device_android.cc (lines 35-55). Run by packages/parity/src/cli/pointer-vectors.ts: each stdin line is
// one set of devices (their sources, space-separated, maybe none), each stdout line the five readings.
//
// Copyright 2014 The Chromium Authors (TouchDevice.java); Copyright 2013 The Chromium Authors (pointer_device_android.cc).
// Use of this source code is governed by a BSD-style license that can be found in the LICENSE file (THIRD_PARTY_NOTICES.md,
// chromium-bsd).

import java.io.BufferedReader;
import java.io.InputStreamReader;

public final class PointerRule {
    // android.view.InputDevice (API 31).
    static final int SOURCE_TOUCHSCREEN = 0x00001002;
    static final int SOURCE_MOUSE = 0x00002002;
    static final int SOURCE_STYLUS = 0x00004002;
    static final int SOURCE_TRACKBALL = 0x00010004;
    static final int SOURCE_TOUCHPAD = 0x00100008;

    // ui/base/pointer/pointer_device.h.
    static final int POINTER_TYPE_NONE = 1 << 0;
    static final int POINTER_TYPE_COARSE = 1 << 1;
    static final int POINTER_TYPE_FINE = 1 << 2;
    static final int HOVER_TYPE_NONE = 1 << 0;
    static final int HOVER_TYPE_HOVER = 1 << 1;

    static int[] availablePointerAndHoverTypes(int[] devices) {
        int pointerTypes = 0;
        int hoverTypes = 0;

        for (int sources : devices) {
            boolean isFinePointer =
                    hasSource(sources, SOURCE_MOUSE)
                            || hasSource(sources, SOURCE_STYLUS)
                            || hasSource(sources, SOURCE_TOUCHPAD)
                            || hasSource(sources, SOURCE_TRACKBALL);
            if (isFinePointer) {
                pointerTypes |= POINTER_TYPE_FINE;
            }
            if (hasSource(sources, SOURCE_TOUCHSCREEN)) {
                pointerTypes |= POINTER_TYPE_COARSE;
            }

            if (hasSource(sources, SOURCE_MOUSE)
                    || hasSource(sources, SOURCE_TOUCHPAD)
                    || hasSource(sources, SOURCE_TRACKBALL)) {
                hoverTypes |= HOVER_TYPE_HOVER;
            }
        }

        if (pointerTypes == 0) pointerTypes = POINTER_TYPE_NONE;
        if (hoverTypes == 0) hoverTypes = HOVER_TYPE_NONE;

        return new int[] {pointerTypes, hoverTypes};
    }

    private static boolean hasSource(int sources, int inputDeviceSource) {
        return (sources & inputDeviceSource) == inputDeviceSource;
    }

    static String primaryPointer(int availablePointerTypes) {
        if ((availablePointerTypes & POINTER_TYPE_COARSE) != 0) return "coarse";
        if ((availablePointerTypes & POINTER_TYPE_FINE) != 0) return "fine";
        return "none";
    }

    static boolean primaryHover(int availableHoverTypes) {
        return (availableHoverTypes & HOVER_TYPE_NONE) == 0;
    }

    public static void main(String[] args) throws Exception {
        BufferedReader in = new BufferedReader(new InputStreamReader(System.in, "UTF-8"));
        StringBuilder out = new StringBuilder();
        String line;
        while ((line = in.readLine()) != null) {
            String t = line.trim();
            String[] parts = t.isEmpty() ? new String[0] : t.split(" ");
            int[] devices = new int[parts.length];
            for (int i = 0; i < parts.length; i++) devices[i] = Integer.parseInt(parts[i]);
            int[] types = availablePointerAndHoverTypes(devices);
            out.append(primaryPointer(types[0])).append(' ')
                    .append(primaryHover(types[1])).append(' ')
                    .append((types[0] & POINTER_TYPE_COARSE) != 0).append(' ')
                    .append((types[0] & POINTER_TYPE_FINE) != 0).append(' ')
                    .append((types[1] & HOVER_TYPE_HOVER) != 0).append('\n');
        }
        System.out.print(out);
    }
}
