# `@mana-ssh/tui-react` Accessibility Assessment

**Date:** 2025-10-05  
**Prepared by:** Code Assistant (in collaboration with Shovon Hasan)

## Scope
This report evaluates the canvas-backed terminal experience exposed by `@mana-ssh/tui-react` for alignment with WAI-ARIA Authoring Practices, WCAG 2.2 Level AA, and user expectations for an accessible terminal/editor. Focus areas include semantics, keyboard interaction, assistive technology compatibility, visual requirements, and testing procedures. The analysis centers on the primary host component (`packages/tui-react/src/Terminal.tsx`) and its renderer bridge (`packages/tui-react/src/renderer.ts`).

## Expected Accessibility Contract
Users interacting with a web terminal expect:
- **Discoverable semantics:** Clear role metadata (terminal/editor), instructions, and descriptive labelling so assistive technologies announce purpose and interaction model.
- **Readable content:** A DOM-accessible transcript of terminal output with live updates, supporting review of history via screen readers, Braille displays, and text scaling tools.
- **Keyboard parity:** Full control using standard shortcuts (navigation, selection, copy/paste, scrollback) without relying on pointing devices, plus advertised custom bindings via `aria-keyshortcuts` or dedicated help.
- **Input compatibility:** Support for IME composition, dead keys, high-ASCII entry, and modifier combinations without dropped or duplicated characters.
- **State feedback:** Programmatic exposure of caret position, selection ranges, and status changes (e.g., connection events) through ARIA patterns or live regions.
- **Adaptability:** Respect for user preferences (reduced motion, high contrast, enlarged fonts) and avoid hard-coded theming that undermines OS/browser controls.
- **Testing transparency:** Documented manual + automated validation processes (axe, Playwright, screen readers) to prevent regressions and build trust.

## Current Implementation Overview
- The focusable wrapper (`packages/tui-react/src/Terminal.tsx:1190-1210`) exposes `role="textbox"`, `tabIndex={0}`, and `aria-label="Terminal"`. All rendering happens inside a `<canvas>` element.
- Keyboard input is intercepted (`packages/tui-react/src/Terminal.tsx:968-1114`) and re-encoded for the interpreter. Selection state is maintained internally but not projected to the DOM.
- Output is drawn exclusively on the canvas through `useTerminalCanvasRenderer` (`packages/tui-react/src/renderer.ts`), with no textual mirror or live region updates.
- Visual defaults (theme/metrics) are hard-coded (`packages/tui-react/src/Terminal.tsx:49-96`) and do not adjust automatically to user accessibility settings.

## Compliance Assessment (WCAG 2.2 Level AA)
- **Perceivable (1.x):** Fails 1.1.1 (non-text content) and 1.3.1 (info/relationships). Canvas output lacks a text alternative, and there is no DOM structure for rows/cells.
- **Operable (2.x):** Partially compliant. Keyboard input works for terminal commands, but absence of documented shortcuts, focus trapping via default `autoFocus`, and missing scrollback controls create barriers (violating 2.1.2, 2.4.3).
- **Understandable (3.x):** Missing instructions and IME support cause failures of 3.3.2 (input assistance) and 3.1.5 (reading level for non-Latin scripts) due to lost characters.
- **Robust (4.x):** Fails 4.1.2/4.1.3; assistive technologies cannot perceive dynamic changes or selection state because no ARIA live announcements or state descriptors exist.

## Gap Analysis
| Area | Issue | Impact | Severity |
| --- | --- | --- | --- |
| Semantics | `role="textbox"` without `aria-multiline`, roledescription, or descriptive guidance (`packages/tui-react/src/Terminal.tsx:1190-1199`). | Screen readers report an empty single-line control. | High |
| Output discoverability | No DOM transcript or `aria-live` region for terminal output. | Screen reader/Braille users cannot review history or receive updates. | Critical |
| Keyboard help | Custom bindings (e.g., Shift+Arrow for selection) undiscoverable; no `aria-keyshortcuts` or help text. | Users cannot learn interaction model. | Medium |
| IME & composition | Lack of `compositionstart`/`compositionend` handling in `handleKeyDown`. | CJK and accented input break, blocking key markets. | Critical |
| Selection exposure | Internal selection not reflected via `aria-activedescendant`/`aria-selected`. | Assistive tech cannot report current selection or caret. | High |
| Focus strategy | `autoFocus` defaults to true and triggers focus on mount (`packages/tui-react/src/Terminal.tsx:401-403,1154-1158`). | Unexpected focus shift disrupts keyboard flow. | Medium |
| Visual adaptability | Fixed palette/metrics ignore prefers-contrast/prefers-reduced-motion. | Users with vision sensitivities face reduced readability. | Medium |
| Testing | No automated accessibility checks in test suite (`packages/tui-react/test/Terminal.test.tsx`). | Regressions remain undetected. | High |

## Recommendations
### Immediate (Blocker resolution)
1. **Textual mirror + live announcements:** Maintain an offscreen DOM log synchronized with the interpreter buffer, using `aria-live="polite"` and `aria-atomic="false"` for incremental updates.
2. **Role semantics:** Extend container attributes with `aria-multiline="true"`, `aria-roledescription="Terminal"`, and `aria-describedby` pointing to instructions/help content.
3. **Focus opt-in:** Default `autoFocus` to `false` and document opt-in usage. Preserve focus rings and ensure manual focus management is predictable.
4. **IME support:** Handle `compositionstart/updated/end` events to buffer composed text before dispatching to the interpreter.

### Near Term (Quarterly goals)
1. **Interactive proxy element:** Integrate an underlying contenteditable or hidden textarea that mirrors the canonical buffer, enabling native screen reader navigation and selection narration.
2. **Selection state exposure:** Drive `aria-activedescendant` across line elements or map selections via `aria-selected` attributes in the DOM log.
3. **Configurable accessibility themes:** Offer high-contrast and reduced-motion presets, and expose them via props/context. React to `prefers-contrast`/`prefers-reduced-motion` media queries by default.
4. **Instructional UI:** Provide an accessible shortcut guide (`aria-keyshortcuts`, `role="note"`) that explains how to enter command mode, selection gestures, and clipboard behavior.
5. **Automated tests:** Add axe-core checks to Vitest + Playwright suites and cover regression scenarios (focus trap, live region updates, selection announcements).

### Long Term (Strategic investments)
1. **Assistive technology integrations:** Explore the ARIA `role="application"` pattern with virtual cursor overrides, and evaluate browser APIs for Braille display updates.
2. **Status & telemetry announcements:** Surface connection state, errors, and notifications through dedicated `aria-live` regions with severity-based politeness settings.
3. **Documentation:** Publish an Accessibility Guide detailing customization points, known limitations, testing coverage, and manual verification scripts.
4. **Cross-package alignment:** Coordinate with `@mana-ssh/vt` to produce accessible snapshots (text rows, selection metadata) consumable by all renderers, ensuring parity between canvas and DOM experiences.

## Testing & Verification Plan
- **Automated:**
  - Integrate `@axe-core/playwright` into E2E harnesses (`apps/terminal-web-app/test/e2e/app.spec.ts`) to fail builds on critical violations.
  - Extend Vitest suites with DOM snapshots verifying live region updates and role attributes (`packages/tui-react/test/Terminal.test.tsx`).
- **Manual:**
  - Screen reader runs: NVDA + Firefox, JAWS + Chrome, VoiceOver + Safari; includes command entry, history review, selection narration.
  - Keyboard-only audits covering focus trapping, shortcut discoverability, and selection workflows.
  - Visual inspections for contrast ratios (WCAG AA) using tooling like Accessibility Insights or AXE DevTools.
- **Regression logging:** Track accessibility fixes in release notes and add a standing checklist to PR templates.

## Open Questions
- What heuristics should determine when to promote the hidden DOM transcript to a visible “accessible transcript” toggle for all users?
- Should host apps (e.g., `apps/terminal-web-app`) own instructional overlays, or should `@mana-ssh/tui-react` export a default implementation?
- Which locales and input methods are highest priority for IME validation (Chinese Simplified, Japanese, Korean, accented Latin)?

## Next Steps
1. Align on the immediate remediation scope and resource owners across `@mana-ssh/tui-react` and `@mana-ssh/vt`.
2. Author/update specs (`packages/tui-react/AGENTS.md`) to capture accessible renderer contracts before implementation.
3. Schedule pair-testing sessions with assistive technology users once the mirror/log prototype is ready.

