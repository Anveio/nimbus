# Terminal Renderer Integration Guide

This document explains how `<Terminal />` in `@nimbus/tui-react` is expected to consume
renderer implementations that follow the contract captured in
`packages/webgl-renderer/docs/renderer-specification-v0.md`. Treat that specification
as the source of truth for event shapes and lifecycle semantics; this guide focuses on
how we wire those requirements into the React host.

## Responsibilities of `<Terminal />`

1. **Renderer session lifecycle**
   - Instantiate a renderer session that implements the specification (WebGL, canvas,
     or custom).
   - Hold onto the session for the lifetime of the component, recreating it when the
     renderer configuration changes (metrics, theme, accessibility profile).
   - Forward snapshot updates via `presentFrame`, `applyUpdates`, and `sync` to keep the
     renderer in lock-step with the runtime snapshot supplied by `@nimbus/vt`.

2. **Event dispatch pipeline**
   - Translate browser events into the renderer `RendererEvent` union.
   - Call the renderer session’s `dispatch(event)` method synchronously so the underlying
     runtime can synthesize DEC/XTerm control sequences.
   - React to `{ handled: false }` responses by applying host-specific fallbacks (e.g.
     requeueing configuration updates).

3. **Runtime updates and instrumentation**
   - Apply `TerminalUpdate`s returned from the runtime bridge back into the renderer
     via `presentFrame` to keep the framebuffer fresh.
   - Send `response` payloads (e.g. DEC mouse reports) to transports through the
     existing instrumentation hooks (`emitData`).

## Mapping DOM Events to `RendererEvent`

The renderer contract expects a much richer payload than the previous thin key/text
pipe. `<Terminal />` must calculate these values before dispatching:

| Browser Event | Renderer Event | Details |
| --- | --- | --- |
| `KeyboardEvent` | `runtime.key` / `runtime.text` | Continue to use the hotkey handler + IME pipeline. |
| `PointerEvent` (`pointerdown`, `pointermove`, `pointerup`, `pointercancel`) | `runtime.pointer` | Provide `action`, `button`, `buttons`, and `cell` coordinates (1-based), plus modifier flags. |
| `WheelEvent` | `runtime.wheel` | Supply signed `deltaX/deltaY`, pointer cell, modifiers. |
| Clipboard paste | `runtime.paste` | Send the plain-text payload; the runtime emits bracketed paste guards when enabled. |
| Selection + cursor gestures | `runtime.selection.*` / `runtime.cursor.*` | Already implemented; ensure event union updates stay in sync. |

### Computing cell coordinates

Pointer and wheel events must describe the terminal cell targeted by the gesture. Use
`TerminalSelection`’s existing layout helpers (cell metrics + viewport origin) to
convert client coordinates into 1-based `{ row, column }` pairs. Clamp to the current
viewport bounds before dispatching.

### Button and modifier mapping

- Translate DOM `event.button`/`event.buttons` into `'left' | 'middle' | 'right' |
  'aux1' | 'aux2' | 'none'` plus the raw mask for combination gestures.
- Populate `modifiers` with boolean flags for `shift`, `alt`, `meta`, `ctrl`. Both
  Alt and Meta count as the `alt` modifier for DEC reporting.

## Applying Runtime Responses

Renderer sessions forward host events to `TerminalRuntime`, which returns batches with:

- `updates`: apply via `presentFrame({ snapshot, updates, reason: 'apply-updates' })`.
- `response`: send to the transport (`instrumentation.emitData`) so the remote host
  receives DEC mouse clicks or bracketed paste sequences.
- `onRuntimeResponse`: use the `<Terminal onRuntimeResponse={...} />` prop (or
  `RendererSessionProvider` equivalent) to stream response callbacks directly from the
  underlying runtime instead of scraping the diff. Every layer above the renderer should
  forward these bytes to its transport – typically by writing them to the active SSH/WebSocket channel.
- `mode` / `pointer-tracking`: update overlays or instrumentation as desired (e.g. show
  when applications request mouse capture).

## Implementation Checklist for `<Terminal />`

0. **Select a renderer backend**
   - Use the default WebGL bundle via `import { Terminal } from '@nimbus/tui-react'` (auto-registers `'webgl'`).
   - Opt into experimental bundles by importing `@nimbus/tui-react/webgl` or `@nimbus/tui-react/canvas`. The latter currently ships a placeholder registry entry while the CPU renderer integration is under construction.
   - Regardless of entry point, you can call `registerRendererBackend()` manually and pass `rendererBackend="..."` to `<Terminal />` when you need to override the default for a given instance.

1. **Expose session dispatch**
   - Extend `useRendererSession` to surface a `dispatch(event)` method that proxies to
     the underlying renderer instance.

2. **Pointer + wheel wiring**
   - Update `terminal-selection.ts` handlers to calculate cell coordinates and call
     `dispatch({ type: 'runtime.pointer', ... })`.
   - Handle wheel events on the accessibility layer or canvas and dispatch
     `runtime.wheel` with the computed metadata.

3. **Clipboard**
   - Replace the current paste path (local echo + transport write) with
     `runtime.paste`, letting the runtime emit bracketed guards when enabled.

4. **Response forwarding**
   - Provide an `onRuntimeResponse` handler that forwards runtime responses to your
     transport. In the Web demo, this means piping the `TerminalRuntimeResponse.data`
     buffer into the active SSH channel.

5. **Testing**
   - Add Vitest coverage verifying the new dispatch path emits the correct event
     shapes.
   - Extend Playwright flows to cover mouse tracking + bracketed paste scenarios once
     transports support the sequences.

Following this checklist ensures `<Terminal />` honours the renderer specification and
allows renderer/runtime pairs (WebGL or future implementations) to speak the same,
fully modelled DEC input dialect.
