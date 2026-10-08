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
# package.json is reviewed: its scripts are commands (the landing driver's among them), not data.
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
packages/tailwind-sweep/snapshot/**
examples/*/chrome/**
**/*.generated.ts
packages/layout/src/script-data.ts
packages/dragon/src/profiles/web.ts
packages/dragon/src/profiles/ios.ts
packages/dragon/src/profiles/android.ts
packages/dragon/src/profiles/native-lanes.ts
packages/dragon/test/data/grid-corpus-declarations.json
packages/dragon/test/data/grid-fuzz-corpus.json
packages/dragon/test/data/chrome-145-interpolable.json
packages/layout/rt-oracle/**
packages/layout/rt-vectors/**
packages/layout/break-vectors/**
packages/parity/expected-breaks/**
packages/parity/expected-pixels/**
packages/layout/paint-vectors/*/vectors.json
packages/parity/out/**
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
docs/research/skia-aa-oracle/**
docs/research/skia-oracle/**
docs/research/dtxt/widths.json
# Written by scripts/gen-third-party-notices.ts (pnpm notices:gen) from docs/ports.json; chrome-ports.test.ts checks it is current
THIRD_PARTY_NOTICES.md
# General shapes, so a new capture directory is skipped without an edit here
**/captures/**
**/reftest-captures/**
**/chrome-145/**
**/probe/**
**/generated/**
**/out/**
**/vectors/**
**/*-vectors/**
**/*-oracle/**
**/expected-*/**
**/*.generated.*
packages/translate/corpus*.json
packages/layout/test/fixtures/linebreak/*.json
examples/*/dragon/north-star-check.json
docs/research/**/*.json
docs/research/**/*.md
docs/research/**/assets/**

# === Dragon: not code ===
design/**
docs/goals/**
