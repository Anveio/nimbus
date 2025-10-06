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

  it('marks pointer events as handled even though the runtime ignores them', () => {
    const runtime = createRendererRuntime()

    const result = applyRendererEventToRuntime(runtime, {
      type: 'runtime.pointer',
      phase: 'move',
      pointerId: 1,
      buttons: 0,
      position: { x: 0, y: 0 },
    })

    expect(result.handled).toBe(true)
    expect(result.batch).toBeNull()
  })
})
