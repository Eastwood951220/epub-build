# EPUB Font Size Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Export only referenced font assets and reduce supported font files to the characters in the book.

**Architecture:** Keep complete fonts in the editable project. During EPUB export, derive a conservative set of referenced font families from global styles, volume overrides, heading styles, and inline chapter markup. Use that ordered set for CSS and ZIP entries. Subset TTF/OTF/WOFF/WOFF2 bytes using a bundled Rust library; retain original bytes if subsetting fails, violates a no-subsetting flag, loses a requested glyph, or does not save space.

**Tech Stack:** Rust, EPUB ZIP exporter, `fontoxide-subset`, existing Rust integration tests.

**Spec:** User approved the two steps in this chat: remove unreferenced fonts, then subset used fonts. Preserve appearance and project data.

## Global Constraints

- No external runtime dependency; macOS and Windows exports must use bundled Rust code.
- Preserve originals in project storage.
- Font file names, CSS face references, and OPF manifest must stay in sync.
- Conservative fallback on unsupported or failed subsetting.

## Review Focus

- Font used only in inline HTML must remain in EPUB.
- Font referenced by a volume or heading style must remain in EPUB.
- Removed font must disappear from CSS, OPF, and ZIP.
- Subsets must retain Chinese, Latin, punctuation, and entity-decoded text.
- Unsupported, malformed, or larger subsets must keep original bytes.

### Task 1: Export only used fonts

**Files:** `src-tauri/src/project/epub_export.rs`, `src-tauri/tests/workflows.rs`.

- [x] Add an integration test with an unused font and fonts used by styles and inline markup; confirm the current export fails the test.
- [x] Select font references conservatively and pass the selected list to CSS and ZIP writing.
- [x] Run targeted and full Rust tests, then commit.

### Task 2: Subset used fonts

**Files:** `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/src/project/epub_export.rs`, `src-tauri/tests/workflows.rs`, `src-tauri/tests/fixtures`.

- [x] Add a small, licensed font fixture and an integration test that checks a real exported subset and character coverage; confirm failure first.
- [x] Bundle a pure Rust subsetter and retain originals on unsupported/failed/no-saving cases.
- [x] Run full Rust tests, frontend tests/build, inspect EPUB output, then commit.

Manual Chinese OTF verification: Source Han Serif SC Regular (24,543,332 bytes) exported as a 13,056-byte OTF subset for a short Chinese chapter; the exported subset retained the chapter and body characters. The full font was used only in a temporary local test and is not stored in this repository.
