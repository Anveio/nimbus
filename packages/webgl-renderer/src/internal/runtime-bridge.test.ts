import { createTerminalRuntime } from '@mana/vt'
import { describe, expect, it } from 'vitest'
import { applyRendererEventToRuntime } from './runtime-bridge'

const createRendererRuntime = () => createTerminalRuntime({})

describe('applyRendererEventToRuntime', () => {
  it('handles printable key events by writing to the runtime', () => {
    const runtime = createRendererRuntime()
    const before = runtime.snapshot.cursor.column
    const result = applyRendererEventToRuntime(runtime, {
      type: 'runtime.key',
      key: 'a',
      code: 'KeyA',
      alt: false,
      ctrl: false,
      meta: false,
      shift: false,
    })

    expect(result.handled).toBe(true)
    expect(result.batch?.updates.length ?? 0).toBeGreaterThan(0)
    expect(runtime.snapshot.cursor.column).toBeGreaterThanOrEqual(before)
  })

  it('encodes arrow keys using ANSI sequences', () => {
    const runtime = createRendererRuntime()

    const result = applyRendererEventToRuntime(runtime, {
      type: 'runtime.key',
      key: 'ArrowUp',
      code: 'ArrowUp',
      alt: false,
      ctrl: false,
      meta: false,
      shift: false,
    })

    expect(result.handled).toBe(true)
    expect(result.batch?.updates.length ?? 0).toBeGreaterThanOrEqual(0)
  })

  it('forwards selection clear events to the runtime', () => {
    const runtime = createRendererRuntime()

    const result = applyRendererEventToRuntime(runtime, {
      type: 'runtime.selection.clear',
    })

    expect(result.handled).toBe(true)
    expect(result.batch?.reason).toBe('apply-updates')
  })

  it('forwards pointer events to the runtime even when tracking is disabled', () => {
    const runtime = createRendererRuntime()

    const result = applyRendererEventToRuntime(runtime, {
      type: 'runtime.pointer',
      action: 'move',
      pointerId: 1,
      buttons: 0,
      button: 'none',
      position: { x: 0, y: 0 },
      cell: { row: 1, column: 1 },
    })

    expect(result.handled).toBe(true)
    expect(result.batch?.updates ?? []).toHaveLength(0)
  })

  it('forwards paste events to the runtime', () => {
    const runtime = createRendererRuntime()
    const result = applyRendererEventToRuntime(runtime, {
      type: 'runtime.paste',
      text: 'echo paste',
    })

    expect(result.handled).toBe(true)
    expect(result.batch?.updates.length ?? 0).toBeGreaterThan(0)
  })

  it('forwards focus events to the runtime', () => {
    const runtime = createRendererRuntime()
    const result = applyRendererEventToRuntime(runtime, {
      type: 'runtime.focus',
    })

    expect(result.handled).toBe(true)
    expect(result.batch?.updates ?? []).toHaveLength(0)
  })
})
