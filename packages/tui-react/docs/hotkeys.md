# Hotkeys Module

The React host now delegates keyboard handling to `packages/tui-react/src/hotkeys/`.

- `handleTerminalHotkey(event, context)` interprets a `KeyboardEvent` and returns a `HotkeyResult`. It takes care of:
  - Toggle of the Shift + `?` shortcut guide.
  - Local erase for Backspace/Delete when `localEcho` is enabled.
  - Cursor navigation (char/word/line) using interpreter helpers.
  - Fallback emission of escape sequences when the event is not handled locally.
- `HotkeyContext` describes the dependencies that `<Terminal />` wires in: interpreter motion helpers, selection refs, and IO functions (`emitData`, `clearSelection`, etc.).
- The module is pure: all DOM/React side-effects (preventDefault, focus recovery) remain in `<Terminal />`, which inspects the returned `HotkeyResult`.

Future configurable hotkeys can be layered on top of this module by swapping the registry inside `handleTerminalHotkey` while preserving the same context contract.
