# T029 Worker: on-device shim equality (T056 retarget)

Worker, 2026-09-29. Binding spec: T056 §"T029 (retargeted, not new)" and the board objective (T029).

- **Worktree / branch:** `/tmp/dragon-t029`, `txt1n-device-replay`, from origin/master `1211f422`.
- **TXT1-N:** already on origin/master (c20cc6c6 and the feature-record commit). Merging `txt1n-shim-bridge` added no content, so the merge was dropped and the two T029 commits sit directly on origin/master.
- **Commits:** `503a74af` (script, tests, README) and `ddb7211e` (generated device results). Not pushed.

## Result

Both devices replay all 4,820 calls of `transcripts/gate.json` (1,100 shape calls, 45,544 glyphs, every nominal-glyph and advance call) with 0 mismatches against the integers dragon_hb.wasm recorded. Each plant is caught on both devices.

| Device | Unplanted | off-by-one | bad-index | fractional-index |
|---|---|---|---|---|
| iPhone 17, iOS 26.5 simulator, arm64 (C3A25EE8…) | 4820 calls, 0 mismatches | 1 mismatch: call 0 shape, int 2: 507648, expected 507649 | refused: call.font 36 of 36 | refused: call.font 0.5 |
| Android 16 (API 36) emulator `dragon-smoke`, arm64-v8a (emulator-5582) | 4820 calls, 0 mismatches | the same single mismatch | refused (IllegalArgumentException) | refused (NumberFormatException "0.5") |

Everything ran under `/tmp/device-lease.sh`, twice. The two runs gave the same results, and the committed `transcripts/device/{ios,android}.txt` files were byte-identical across them.

## Rulings made by research

1. **The off-by-one to settle.** The plant is `plantTranscript('off-by-one')`: it adds 1 to glyphs[2] (the x advance, 16.16) of the first shape call. That is 1/65536 px, the smallest change the ABI can express. A pass must show exactly that mismatch, `MISMATCH call 0 shape: int 2: 507648, expected 507649`, with exit 1. An exit of 1 alone does not count. Before this change, a crash, a missing library or a dex that app_process rejected all exited 1, so any of them would have been read as "plant caught". `judgeDeviceRun` now closes that.
2. **Equality means the whole output.** An unplanted pass needs exit 0, exactly one summary line whose call, shape and glyph counts equal the transcript's (4820/1100/45544), 0 mismatches, and no other output line. This means a partial replay cannot pass.
3. **The script exits 0 only when the expected outcome is seen, and that includes plant runs.** This differs from `replay.ts --swift/--kotlin`, where a plant exits 1. On a device run, "exit 1" cannot tell a caught plant from a harness failure, so the device script judges the outcome itself and prints `PASS … plant <name> caught`.
4. **Device choice is explicit.** `simctl spawn booted` is ambiguous when two simulators are up, and two were ("Dragon Viewer" and "iPhone 17"). The script now needs `--device` when more than one iOS simulator or adb device is up. It uses the iOS 26.5 iPhone 17 and the lane AVD `dragon-smoke` (android-36 image, the P5 matrix image). The driver script booted the emulator itself and shut it down afterwards. The simulator was already booted, so it was left alone.
5. **The two first-run risks from T081 are cleared.** `simctl spawn` passes the child's exit code through (0 when unplanted, 1 when planted, both observed). `app_process` accepts the d8 `--min-api 31` dex on API 36.
6. **Committed device results are tied to their inputs.** Each `.txt` names the gate transcript's sha256, the recording WASM's sha256, the device and the summary. `test/replay-device.test.ts` fails if gate.json or the WASM changes and the device results are not re-run.
7. **Cleanup.** The host work directory is removed after a run (`--build-only` keeps it for inspection). `/data/local/tmp/dragon-hb` is removed from the device in a `finally`, and a failed removal prints a warning. Previously both were left behind. A missing `exit=` marker from `adb shell` is now an error. Previously it was read silently as exit 1.

## Verify

- `/tmp/device-lease.sh /tmp/t029-devices.sh` (twice). The driver boots whatever is down and runs `node packages/text-shaper/scripts/replay-device.ts --platform ios|android --device <id>`, both unplanted and with each of the three `--plant` values. It gave 8/8 PASS on each run, and the lease run exited 0 both times.
- `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test`: exit 0, 108 files, 2266 tests pass (at ddb7211e).
- `replay.ts --check`: byte-identical to a fresh recording of 1260 cases, WASM replay 0 mismatches. `--swift` and `--kotlin` (host): 4820 calls, 0 mismatches. `pnpm run text:gate`: 1260/1260 exact.
- Reviewable diff: 22 KB (3 files); 5 files in total, including the two generated device results.
- **Pinned tests retargeted:** none. The new test is `test/replay-device.test.ts`, with 7 tests: the judge on good output and on short, noisy, crashed and mis-caught output for every plant, plus the committed device results.
