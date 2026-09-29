---
ignoreTests: false
---
# Tests are reviewed on purpose: a loosened tolerance or a deleted check is the bug we care most about.
# Creating this file replaces Macroscope's defaults, so the text-file defaults are copied first
# (docs.macroscope.com/bug-detection-and-fixes, 2026-09-28). Binary files are always skipped anyway.

# === Macroscope defaults: vendored and dependency directories ===
**/.git/**
**/node_modules/**
**/.pnpm-store/**
**/__Snapshots__/**
**/__snapshots__/**
**/.agents/skills/**
**/.claude/skills/**
**/.github/skills/**
**/.vercel/**
**/vendor/**
**/_vendor/**
**/third_party/**
**/Pods/**

# === Macroscope defaults: build output ===
build/**
out/**
**/target/**
**/dist/**
**/generated/**
**/*.min.js
**/*.min.css
**/*.bundle.js
**/*.d.ts
**/*.gen.ts

# === Macroscope defaults: package manager and lock files ===
**/package.json
**/Package.swift
**/Package.resolved
**/*.pbxproj
**/package-lock.json
**/pnpm-lock.yaml
**/*.lock
**/*.log
**/*.snap
**/*.csv
**/*.jsonl
**/*.js.map

# === Dragon: generated or captured data; review the generator, not its output ===
packages/layout/vectors/**
packages/parity/expected/**
packages/parity/expected-dpr/**
packages/parity/emitted/**
packages/wpt/snapshots/**
packages/wpt/expectations/**
examples/*/chrome/**
**/*.generated.ts
packages/layout/src/script-data.ts
packages/layout/rt-oracle/**
packages/layout/rt-vectors/**
packages/layout/break-vectors/**
packages/parity/expected-breaks/**
packages/parity/expected-pixels/**
packages/dragon/test/fonts/captures/**
packages/dragon/test/fonts/reference/**
packages/dragon/test/forms/chrome-145/**
packages/dragon/test/images/chrome-145/**
packages/dragon/test/images/corpus/**
packages/dragon/test/media/captures/**
packages/dragon/test/media/corpus.json
packages/text-shaper/transcripts/**
docs/research/text-spike/gate/**
docs/research/text-spike/out/**
docs/research/text-spike/lato/out/**
docs/research/text-spike/metric-rounding/captures/**
docs/research/inline-spike/probe/**
docs/research/grid-spike/probe/**
docs/research/float-spike/probe/**
docs/research/writing-mode-spike/probe/**

# === Dragon: not code ===
design/**
docs/goals/**
