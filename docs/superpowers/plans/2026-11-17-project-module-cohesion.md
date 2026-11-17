# Project Module Cohesion Plan

**Goal:** Give EPUB import, EPUB export, and frontend desktop commands clear module boundaries without changing behavior or public data formats.

**Architecture:** Keep `project` as the public facade for callers. Put EPUB decoding and encoding in sibling modules with explicit dependencies on project types and shared XML escaping. Keep TXT import and project JSON persistence in the facade for this focused pass. Put typed Tauri command calls and their response types in `web/platform/backend.ts` so UI components use one desktop boundary.

**Verification:** Run the existing Rust test suite before and after the move, format touched files and check with Clippy, then build and test the frontend to catch integration changes.

- [x] Move EPUB export and its helpers into `project/epub_export.rs`.
- [x] Move EPUB import and its helpers into `project/epub_import.rs`.
- [x] Keep public `project::{import_book, export_epub, ...}` signatures unchanged.
- [x] Move Tauri command calls and shared response types out of `App.tsx` and `Home.tsx`.
- [x] Run Rust tests, formatting, Clippy and frontend build; review the diff.
