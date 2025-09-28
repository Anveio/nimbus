# Canvas Renderer Test Specification

This document enumerates the behaviours we expect the canvas renderer to support and the regression coverage we maintain (or plan to add). It is organised by feature area so we can track progress from the VT output all the way to the browser surface.

## Legend

- ✅ Covered by automated tests today
- 🟡 Planned test (scenario defined, implementation pending)
- ⛔️ Out of scope / blocked by missing renderer capability

---

## 1. Frame initialisation & theming

| Scenario | Status | Notes |
| --- | --- | --- |
| Initial render paints theme background across entire viewport | ✅ | `createCanvasRenderer` initialises canvas dimensions, fills theme background (`createCanvasRenderer.test.ts` "initial-background"). |
| Theme swap repaints background colour without changing diagnostics semantics | ✅ | `setTheme` test ensures redraw + diagnostics update. |
| Palette swap retains existing glyphs but updates colours in-place | 🟡 | Requires partial repaint support once implemented. |

## 2. Cell rendering & colour attributes

| Scenario | Status | Notes |
| --- | --- | --- |
| Applying a cell update with background colour repaints the correct rectangle | ✅ | `update-cell-bg` comparison. |
| Foreground palette colour renders glyphs with the expected tone | ✅ | New `foreground-palette` test to assert against rendered text. |
| Truecolour (24-bit) foreground/background combinations | 🟡 | Needs renderer support for RGB SGR codes. |
| SGR reset restores default attributes | 🟡 | Add when attribute state machine is wired. |

## 3. Text layout & typography

| Scenario | Status | Notes |
| --- | --- | --- |
| Baseline alignment uses metrics.baseline when drawing text | ✅ | Verified implicitly by `foreground-palette` image match. |
| Bold/intense glyphs switch font weight | 🟡 | Dependent on renderer exposing separate bold font metrics. |
| Combining characters & surrogate pairs occupy single cell width | 🟡 | Requires interpreter snapshot with combining runs. |

## 4. Cursor & selection state

| Scenario | Status | Notes |
| --- | --- | --- |
| Visible block cursor draws using theme cursor colour | ✅ | Pixel probe test (`cursor` case). |
| Cursor blink toggles via diagnostics instrumentation | 🟡 | Need timer-driven renderer support. |
| Selection overlay draws translucent rectangle matching selection bounds | ⛔️ | Feature not implemented yet. |

## 5. Resizing & metrics

| Scenario | Status | Notes |
| --- | --- | --- |
| Resizing with updated metrics adjusts backing store & DPR scaling | ✅ | `resize` test ensures width/height changes. |
| Renderer recomputes tab stops / cursor bounds on resize | 🟡 | Add when renderer exposes snapshots of these mechanics. |

## 6. Diagnostics & instrumentation

| Scenario | Status | Notes |
| --- | --- | --- |
| Last-frame diagnostics capture draw call count and frame duration | ✅ | Assertions in existing tests verify non-null metrics. |
| Diagnostics exposed via events (e.g. onFrame) | 🟡 | Reserved for future instrumentation hook. |

## 7. Advanced media (future work)

| Scenario | Status | Notes |
| --- | --- | --- |
| Sixel image render path matches expected pixel output | ⛔️ | Renderer support not yet implemented. |
| Inline image (kitty graphics) placement & scaling | ⛔️ | Requires feature work. |
| Emoji / colour font rendering baseline alignment | 🟡 | Add high-coverage fixtures once fallback pipeline lands. |

---

## Test naming conventions

Each automated scenario writes artefacts under `test/__artifacts__/<case>/` so failures have a pointer to actual vs expected output. When adding new tests:

1. Document the scenario here with ✅/🟡/⛔️.
2. Use a descriptive `caseName` slug (e.g. `foreground-palette`), matching the table entry.
3. Ensure expected images are generated deterministically to keep the diff noise-free.

This spec evolves alongside renderer capability; when the implementation grows (e.g. selection painting, RGB colours) we’ll promote 🟡/⛔️ entries to ✅ as the tests land.
