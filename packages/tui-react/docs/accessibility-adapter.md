# Accessibility Adapter Guide

## Overview
`@mana/tui-react` now ships its accessibility surface as a standalone module. The combo of `useTerminalAccessibilityAdapter` and `TerminalAccessibilityLayer` renders the hidden DOM transcript, live regions, and optional shortcut guide while staying decoupled from the canvas renderer. `<Terminal />` uses the same adapter internally, and host apps can opt-in to the pieces they need if they compose their own shell component.

```
┌────────────────────────────────────┐
│ useTerminalAccessibilityAdapter()  │
│   • transcript rows + IDs          │
│   • aria-describedby metadata      │
│   • caret/status live regions      │
│   • shortcut guide controller      │
└────────────────────────────────────┘
                ▼
┌────────────────────────────────────┐
│ <TerminalAccessibilityLayer />     │
│   Renders hidden DOM + overlay     │
└────────────────────────────────────┘
                ▼
┌────────────────────────────────────┐
│ <Terminal />                       │
│   Handles input + canvas renderer  │
│   Delegates semantics to adapter   │
└────────────────────────────────────┘
```

## Hook API
```ts
const adapter = useTerminalAccessibilityAdapter({
  snapshot,
  snapshotRevision,
  instructions?: ReactNode,
  shortcutGuide?: ShortcutGuideConfig | false,
  onShortcutGuideToggle?: (visible: boolean, reason: ShortcutGuideReason) => void,
})
```

Key fields in `adapter`:
- `instructionsId`, `instructionsContent`, `describedByIds`: plug into the focusable terminal container and hidden instructions block.
- `transcriptRows`, `transcriptId`, `activeDescendantId`: off-screen DOM mirror with row/cell identifiers.
- `caretStatusText`, `statusMessage`, `statusPoliteness`, `announceStatus`: caret + status live regions.
- `shortcuts`: canonical shortcut descriptors (display text + `ariaKeys`).
- `shortcutGuide`: controller with `{ enabled, visible, open(), close(), toggle() }` so hosts can drive their own help experience.

## Layer Component
```tsx
<TerminalAccessibilityLayer
  adapter={adapter}
  instructionsContent={/* optional override */}
/>
```
The layer renders:
- Hidden instructions (`role="note"`) used by `aria-describedby`.
- Transcript log/grid with `data-testid="terminal-transcript-row"` for tests.
- Caret status and notification live regions.
- Default Shift+`?` shortcut guide overlay when `adapter.shortcutGuide.enabled` and `visible`.

## Using `TerminalAccessibilityLayer` Outside `<Terminal />`
1. Create or obtain a `TerminalState` snapshot (e.g., from `TerminalHost` or your own interpreter instance).
2. Call `useTerminalAccessibilityAdapter` with that snapshot and pass the result to your component.
3. Wire container props:
   ```tsx
   const adapter = useTerminalAccessibilityAdapter({ snapshot, snapshotRevision })

   return (
     <div
       role="textbox"
       aria-describedby={adapter.describedByIds.join(' ')}
       aria-activedescendant={adapter.activeDescendantId ?? undefined}
       aria-keyshortcuts={adapter.shortcuts.flatMap(s => s.ariaKeys ?? s.keys).join(' ')}
     >
       <TerminalAccessibilityLayer adapter={adapter} />
       {/* your renderer */}
     </div>
   )
   ```
4. Expose shortcut guide controls through your own UI by calling `adapter.shortcutGuide.open/close/toggle`.

## Shortcut Guide Configuration
`ShortcutGuideConfig` supports:
- `enabled`: disable the built-in overlay entirely (default `true`).
- `initiallyOpen`: show the guide on mount (default `false`).
- `title`, `description`, `content`: replace portions of the modal (still accessible).

`<Terminal />` forwards the same config via its `shortcutGuide` prop and surfaces presses of Shift+`?` through `onShortcutGuideToggle` and the imperative handle methods `openShortcutGuide`, `closeShortcutGuide`, `toggleShortcutGuide`.

## Imperative Handle
`TerminalHandle` now includes the shortcut guide helpers in addition to focus/write/reset:
```ts
interface TerminalHandle {
  openShortcutGuide(): void
  closeShortcutGuide(): void
  toggleShortcutGuide(): void
}
```
Use these when you need to expose your own “Show shortcuts” buttons or automation hooks.

## Testing Notes
- The Playwright harness for `@mana/tui-react` uses `data-testid="terminal-transcript-row"` and the modal dialog semantics to assert transcript mirroring and accessibility.
- When you disable the built-in overlay (via `shortcutGuide: { enabled: false }`), ensure your host still surfaces a discoverable entry point for the provided shortcut metadata.

## Migration Checklist
- Replace calls to the deprecated `useTerminalAccessibility` (if you imported it directly) with `useTerminalAccessibilityAdapter` + `<TerminalAccessibilityLayer />`.
- Update TypeScript imports: the adapter exports live in `packages/tui-react/src/accessibility-layer.tsx` and are re-exported from `@mana/tui-react/accessibility`.
- Review `onShortcutGuideToggle` handlers to ensure they handle both `hotkey` and `imperative` reasons (e.g., closing when the user clicks outside the overlay).
