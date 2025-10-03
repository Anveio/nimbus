import type { RendererTheme } from '@mana/tui-web-canvas-renderer'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_METRICS,
  DEFAULT_THEME,
  resolveAccessibilityOptions,
  resolveGraphicsOptions,
  resolveStylingOptions,
} from './terminal-options'

const sampleThemeOverride: RendererTheme = {
  ...DEFAULT_THEME,
  background: '#101010',
  foreground: '#abcdef',
  cursor: { ...DEFAULT_THEME.cursor, opacity: 0.42 },
  selection: { background: '#123456', foreground: '#fedcba' },
}

describe('resolveAccessibilityOptions', () => {
  it('provides sensible defaults when options are absent', () => {
    const resolved = resolveAccessibilityOptions(undefined)
    expect(resolved).toEqual({
      ariaLabel: 'Terminal',
      instructions: null,
      shortcutGuide: {},
      autoFocus: false,
    })
  })

  it('honours provided accessibility configuration', () => {
    const resolved = resolveAccessibilityOptions({
      ariaLabel: 'My terminal',
      instructions: 'Use responsibly',
      shortcutGuide: false,
      autoFocus: true,
    })

    expect(resolved).toEqual({
      ariaLabel: 'My terminal',
      instructions: 'Use responsibly',
      shortcutGuide: false,
      autoFocus: true,
    })
  })
})

describe('resolveStylingOptions', () => {
  it('defaults to auto resize and local echo with baseline theme and metrics', () => {
    const resolved = resolveStylingOptions(undefined)

    expect(resolved.autoResize).toBe(true)
    expect(resolved.localEcho).toBe(true)
    expect(resolved.rows).toBeUndefined()
    expect(resolved.columns).toBeUndefined()
    expect(resolved.theme).toEqual(DEFAULT_THEME)
    expect(resolved.metrics).toEqual(DEFAULT_METRICS)
    expect(resolved.canvasClassName).toBeUndefined()
    expect(resolved.canvasStyle).toBeUndefined()
  })

  it('merges provided theme, metrics, and canvas overrides', () => {
    const resolved = resolveStylingOptions({
      rows: 40,
      columns: 100,
      autoResize: false,
      localEcho: false,
      theme: {
        background: sampleThemeOverride.background,
        selection: { background: '#123456' },
      },
      metrics: {
        devicePixelRatio: 3,
        font: { size: 18 },
        cell: { width: 11 },
      },
      canvas: {
        className: 'terminal-canvas',
        style: { pointerEvents: 'none' },
      },
    })

    expect(resolved.rows).toBe(40)
    expect(resolved.columns).toBe(100)
    expect(resolved.autoResize).toBe(false)
    expect(resolved.localEcho).toBe(false)
    expect(resolved.theme.background).toBe('#101010')
    expect(resolved.theme.selection?.background).toBe('#123456')
    expect(resolved.theme.selection?.foreground).toBe('#ffffff')
    expect(resolved.metrics.devicePixelRatio).toBe(3)
    expect(resolved.metrics.font.size).toBe(18)
    expect(resolved.metrics.cell.width).toBe(11)
    expect(resolved.canvasClassName).toBe('terminal-canvas')
    expect(resolved.canvasStyle).toEqual({ pointerEvents: 'none' })
  })
})

describe('resolveGraphicsOptions', () => {
  it('falls back to auto backend when no options provided', () => {
    const resolved = resolveGraphicsOptions(undefined)
    expect(resolved).toEqual({
      renderer: {
        backend: 'auto',
        fallback: undefined,
        captureDiagnosticsFrame: undefined,
      },
      cursorOverlayStrategy: undefined,
    })
  })

  it('maps canvas-cpu configuration to cpu renderer options', () => {
    const resolved = resolveGraphicsOptions({
      type: 'canvas-cpu',
      captureDiagnosticsFrame: true,
      cursorOverlayStrategy: () => {},
    })

    expect(resolved.renderer).toEqual({
      backend: 'cpu',
      captureDiagnosticsFrame: true,
    })
    expect(typeof resolved.cursorOverlayStrategy).toBe('function')
  })

  it('propagates WebGL specific options', () => {
    const resolved = resolveGraphicsOptions({
      type: 'webgl',
      fallback: 'prefer-gpu',
      contextAttributes: { antialias: false },
      captureDiagnosticsFrame: false,
    })

    expect(resolved.renderer).toEqual({
      backend: 'webgl',
      fallback: 'prefer-gpu',
      webgl: {
        fallback: 'prefer-gpu',
        contextAttributes: { antialias: false },
      },
      captureDiagnosticsFrame: false,
    })
  })

  it('propagates WebGPU specific options', () => {
    const resolved = resolveGraphicsOptions({
      type: 'webgpu',
      fallback: 'prefer-gpu',
      deviceDescriptor: { requiredFeatures: ['timestamp-query'] },
      canvasConfiguration: { devicePixelRatio: 2 },
      captureDiagnosticsFrame: true,
    })

    expect(resolved.renderer).toEqual({
      backend: 'webgpu',
      fallback: 'prefer-gpu',
      webgpu: {
        fallback: 'prefer-gpu',
        deviceDescriptor: { requiredFeatures: ['timestamp-query'] },
        canvasConfiguration: { devicePixelRatio: 2 },
      },
      captureDiagnosticsFrame: true,
    })
  })
})
