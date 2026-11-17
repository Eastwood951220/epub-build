# Editor Responsiveness Implementation Plan

**Goal:** Restore window dragging and chapter context actions, make side panels resizable, and keep large books responsive with visible loading feedback while keeping interface text unselectable and editor images hidden by default.

**Architecture:** Keep the existing native styled UI. A small windowed chapter list renders only visible rows; pure helpers calculate row ranges and panel widths. The editor displays a loading state before parsing a newly selected chapter. Avoid Radix dependencies.

**Tech Stack:** React 19, TypeScript, Tauri 2, Tiptap 3, Vitest.

## Tasks

- [x] Add failing tests for list windowing and bounded panel resizing; implement the pure helpers.
- [x] Render a windowed chapter list with keyboard accessible native styled context actions; preserve volume collapse and selection.
- [x] Add draggable dividers and persist widths; restore window drag on non-interactive header space.
- [x] Stop full-book image scans during typing and defer chapter parsing until loading feedback has painted.
- [x] Block editor input until the selected chapter is loaded and serialize automatic/manual saves.
- [x] Lazy render preview bodies near the viewport so switching chapters does not sanitize the whole book.
- [x] Keep interface labels unselectable; allow selection in book content and form fields.
- [x] Hide editor images initially and provide a toolbar toggle.
- [x] Build and run the frontend tests; inspect the diff for unrelated changes.
