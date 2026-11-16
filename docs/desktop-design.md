# EPUB Studio desktop design

## Goal

Make a Windows/macOS editor for TXT and EPUB books. Users can adjust book-wide heading and body typography, edit selected content, add images within chapters or at every chapter boundary, preview, save a reusable project, and export EPUB 3.

## Approach

Tauri 2 hosts a React/TypeScript editor. Rust owns filesystem access, TXT/EPUB import, project persistence, and EPUB packaging. The editor keeps a single serializable project model with chapter HTML plus global style and optional shared boundary images. Tiptap supplies selection-level formatting and inline images. A read-only preview renders the same chapter HTML and global CSS used for export.

## Decisions

- A project saves as `.epubstudio.json` with embedded image data so it reopens without external assets.
- TXT chapter detection reuses the existing Rust library. Existing EPUB chapter order comes from its package spine.
- EPUB import preserves common text blocks, inline formatting, and embedded images. Unsupported scripts and arbitrary EPUB CSS are discarded for safe editing.
- The global style controls title/body font family, size, line height, and alignment. Selection formatting in Tiptap overrides it locally.
- Opening/ending images are configured once and applied to each chapter; an editor toolbar inserts chapter-specific images at the cursor.
- Source paths are chosen with native dialogs. The UI warns about unsaved changes before replacing a project.
- Windows and macOS builds use the same source and a CI matrix; macOS is built locally, Windows build is verified in CI when available.
