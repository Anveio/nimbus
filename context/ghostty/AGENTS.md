# Ghostty Context Agent Charter

This charter summarizes why the Ghostty project sits in our context folder and how to work with it when cross-referencing behaviour.

## Mandate
- Track Ghostty’s terminal semantics as a comparative benchmark for selection, input ergonomics, and rendering.
- Provide quick-start commands so we can build, test, and inspect Ghostty when validating behaviour or borrowing UX patterns.

## Boundaries & Notes
- Source lives outside the Mana SSH workspace; this folder only stores reference notes. Do not modify Ghostty code from here.
- Use Ghostty as a specification lens, not as a dependency—mirror behaviours intentionally and document divergences.

## Toolchain Rituals
- Build: `zig build`
- Test: `zig build test`
- Filtered tests: `zig build test -Dtest-filter=<name>`
- Formatting (Zig): `zig fmt .`
- Formatting (misc): `prettier -w .`

## Directory Landmarks
- Core Zig sources: `src/`
- C API surface: `include/ghostty.h`
- macOS app scaffolding: `macos/`
- GTK (Linux/FreeBSD) frontend: `src/apprt/gtk`

## Platform Guidance
- Always use `zig build`; avoid `xcodebuild` when working with the macOS app.

## Memory Bank
### 2025-09-30 – Charter refresh
Clarified Ghostty’s role as a comparative reference, preserved build/test commands, and reiterated platform guidance for future studies.

