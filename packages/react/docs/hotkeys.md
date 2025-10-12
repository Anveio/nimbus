# Hotkeys Module

The React host now delegates keyboard handling to `packages/react/src/hotkeys/`.

- `handleTerminalHotkey(event, context)` interprets a `KeyboardEvent` and returns a `HotkeyResult`. It takes care of:
  - Toggle of the Shift + `?` shortcut guide.
  - Local erase for Backspace/Delete when `localEcho` is enabled.
  - Cursor navigation (char/word/line) using interpreter helpers.
  - Fallback emission of escape sequences when the event is not handled locally.
- `HotkeyContext` describes the dependencies that `<Terminal />` wires in: runtime access, selection refs, and host helpers such as `performLocalErase` and `clearSelection`.
- The handler returns a `HotkeyResult` that carries the `rendererEvents` array to forward into the active renderer session along with flags like `preventDefault` and `skipLocalEcho`.
- The module is pure: all DOM/React side-effects (preventDefault, focus recovery) remain in `<Terminal />`, which inspects the returned `HotkeyResult`.
- `<Terminal />` currently performs local erasure by dispatching `runtime.selection.replace` events to the active renderer session before forwarding the `runtime.key` event, matching legacy terminals that rely on hosts for destructive backspace/delete semantics.

Future configurable hotkeys can be layered on top of this module by swapping the registry inside `handleTerminalHotkey` while preserving the same context contract.
