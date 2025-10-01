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
- The focusable wrapper (`packages/tui-react/src/Terminal.tsx:1231-1320`) exposes `role="textbox"`, `tabIndex={0}`, `aria-label`, `aria-multiline="true"`, `aria-roledescription="Terminal"`, enumerates key gestures via `aria-keyshortcuts`, and wires `aria-describedby` to authored instructions. Focus management is opt-in via the `autoFocus` prop, but the default remains `true`.
- `useTerminalAccessibility` (`packages/tui-react/src/accessibility.tsx`) maintains an off-screen DOM transcript (`role="log"`/`role="grid"`) backed by the interpreter snapshot, including `aria-live` semantics, row/column indices, and `aria-selected` state that reflects the active selection.
- Caret position and host status updates are announced through dedicated live regions (`role="status"`) with politeness levels derived from runtime events.
- Keyboard input is intercepted at the wrapper (`packages/tui-react/src/Terminal.tsx:1002-1148`) and re-encoded for the interpreter, with IME composition buffered via `compositionstart/update/end` handling.
- Visual defaults (theme/metrics) are hard-coded (`packages/tui-react/src/Terminal.tsx:49-96`) and do not yet adapt to user accessibility preferences (contrast, reduced motion).

## Compliance Assessment (WCAG 2.2 Level AA)
- **Perceivable (1.x):** Largely compliant. The DOM transcript/layers satisfy 1.1.1 (non-text alternatives) and 1.3.1 (info relationships), though visual adaptability gaps remain (1.4.3/1.4.11).
- **Operable (2.x):** Partially compliant. Keyboard interaction parity is strong, `aria-keyshortcuts` announces core gestures, yet the default autofocus can unexpectedly steal focus (2.1.2, 2.4.3 risks) and there is no richer help surface for advanced workflows.
- **Understandable (3.x):** Instructions are surfaced via `aria-describedby`, IME sequences now commit reliably, yet we still lack localized guidance for alternative layouts.
- **Robust (4.x):** Compliant for announced states: live regions, `aria-activedescendant`, and selection metadata are present. Continued manual AT validation is needed to confirm interoperability across screen readers.

## Gap Analysis
| Area | Issue | Impact | Severity |
| --- | --- | --- | --- |
| Shortcut guidance depth | `aria-keyshortcuts` exposes combos, but instructions remain terse and there is no discoverable, structured help surface. | Users relying on AT hints may miss multi-step workflows (scrollback, selection anchors). | Medium |
| Focus strategy | `autoFocus` defaults to true and shifts focus on mount (`packages/tui-react/src/Terminal.tsx:424,1190-1199`). | Unexpected focus grabs derail keyboard users navigating the page. | Medium |
| Visual adaptability | Fixed palette/metrics ignore `prefers-contrast` and `prefers-reduced-motion`. | Users needing high contrast or reduced motion must override styles manually. | Medium |
| Documentation currency | Accessibility report and package README do not yet reflect the DOM transcript + live region contract. | Integrators underestimate existing coverage and may duplicate work. | Low |

## Recommendations
### Immediate (Blocker resolution)
1. **Focus opt-in:** Flip the default `autoFocus` to `false`, document the rationale, and ensure focus rings remain visible when consumers opt in.
2. **Shortcut guidance:** Layer richer instructions or a help affordance so users can discover multi-step gestures beyond the terse announcement.
3. **Testing depth:** Extend automated coverage to assert IME flows inside consumer apps and across locales, ensuring regressions are caught early.

### Near Term (Quarterly goals)
1. **Configurable accessibility themes:** Offer high-contrast and reduced-motion presets, reacting to `prefers-contrast` / `prefers-reduced-motion` by default.
2. **Instructional UI:** Layer an accessible shortcut/help surface (toggleable overlay or `role="note"`) that expands beyond the terse default instructions.
3. **Automated tests:** Extend Vitest + Playwright suites with IME simulations, focus regression scenarios, and full axe audits within host apps (`apps/terminal-web-app`).
4. **Documentation refresh:** Publish an Accessibility Guide describing the DOM transcript contract, integration hooks, and host responsibilities.

### Long Term (Strategic investments)
1. **Assistive technology integrations:** Explore the ARIA `role="application"` pattern with virtual cursor overrides, and evaluate browser APIs for Braille display updates.
2. **Advanced telemetry:** Extend status/log channels to cover transport-level changes, task progress, and host notifications with severity-aware politeness.
3. **Cross-package alignment:** Keep `@mana-ssh/vt` exporting rich semantics (line identifiers, bidi markers) so alternate renderers achieve parity with the React host.

## Implementation Strategy
- **Interpreter-first contract:** Continue treating interpreter snapshots/diffs as the semantic source of truth. Any new metadata required for IME buffering or bidi/RTL support should originate in `@mana-ssh/vt`.
- **Renderer isolation:** Keep `@mana-ssh/tui-web-canvas-renderer` focused on rasterization. Accessibility remains a host concern layered through React hooks and DOM adapters.
- **Host accessibility adapter:** Evolve `useTerminalAccessibility` to manage shortcut metadata, focus heuristics, and richer status streams without coupling to renderer internals.
- **Reusable boundary:** Document the semantic update contract so other hosts (future Svelte/Web Components adapters) can reuse the accessibility adapter pattern.

## Testing & Verification Plan
- **Automated:**
  - Maintain `@axe-core/playwright` coverage in both package-level specs (`packages/tui-react/test/e2e/terminal.accessibility.spec.ts`) and consumer apps.
  - Add unit coverage for `useTerminalAccessibility` selection math and IME buffering once implemented.
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
