import { type CSSProperties, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { CanvasRendererDiagnostics } from '@mana/tui-web-canvas-renderer'
import type { TerminalSelection } from '@mana/vt'
import {
  Terminal,
  type TerminalFrameEvent,
  type TerminalHandle,
} from '../../src/Terminal'
import type {
  TerminalHarnessExports,
  TerminalHarnessInstrumentationOptions,
  TerminalHarnessMountOptions,
  TerminalHarnessOnDataEvent,
  TerminalHarnessShortcutGuideToggleEvent,
} from './harness-types'

const nextFrame = (): Promise<void> =>
  new Promise((resolve) => {
    requestAnimationFrame(() => resolve())
  })

const DEFAULT_STYLE: CSSProperties = {
  width: '640px',
  height: '400px',
}

const TEXT_DECODER = new TextDecoder()

const structuredCloneFallback = <T,>(value: T): T => {
  if (typeof structuredClone === 'function') {
    return structuredClone(value)
  }
  return JSON.parse(JSON.stringify(value)) as T
}

const createHarness = (): TerminalHarnessExports => {
  let root: Root | null = null
  let container: HTMLDivElement | null = null
  const terminalRef = createRef<TerminalHandle>()
  const onDataEvents: TerminalHarnessOnDataEvent[] = []
  const frameEvents: TerminalFrameEvent[] = []
  const diagnosticsEvents: CanvasRendererDiagnostics[] = []
  const cursorSelectionEvents: Array<TerminalSelection | null> = []
  const shortcutGuideToggleEvents: TerminalHarnessShortcutGuideToggleEvent[] =
    []

  const resetEventStores = () => {
    onDataEvents.length = 0
    frameEvents.length = 0
    diagnosticsEvents.length = 0
    cursorSelectionEvents.length = 0
    shortcutGuideToggleEvents.length = 0
  }

  const dispose = () => {
    root?.unmount()
    root = null
    if (container) {
      container.remove()
      container = null
    }
    if (terminalRef.current) {
      terminalRef.current = null
    }
    document.body.innerHTML = ''
    resetEventStores()
  }

  const mount = async (
    options: TerminalHarnessMountOptions = {},
  ): Promise<void> => {
    dispose()
    resetEventStores()

    document.body.innerHTML = `
      <main id="terminal-harness-root" role="main">
        <h1>Mana Terminal Harness</h1>
      </main>
    `

    const host = document.getElementById('terminal-harness-root')
    container = document.createElement('div')
    container.id = 'terminal-harness'

    if (host) {
      host.appendChild(container)
    } else {
      document.body.appendChild(container)
    }

    document.documentElement.lang = 'en'
    document.title = 'tui-react harness'

    const graphicsOptions =
      options.rendererBackend === 'gpu-webgl'
        ? { type: 'webgl' as const }
        : { type: 'canvas-cpu' as const }

    const instrumentationOptions: TerminalHarnessInstrumentationOptions =
      options.instrumentation ?? {}

    const isEnabled = (flag: boolean | undefined, fallback: boolean) =>
      flag ?? fallback

    const captureOnData = isEnabled(instrumentationOptions.onData, true)
    const captureDiagnostics = isEnabled(
      instrumentationOptions.onDiagnostics,
      true,
    )
    const captureFrame = isEnabled(instrumentationOptions.onFrame, true)
    const captureSelection = isEnabled(
      instrumentationOptions.onCursorSelectionChange,
      true,
    )
    const captureShortcutToggle = isEnabled(
      instrumentationOptions.onShortcutGuideToggle,
      true,
    )

    root = createRoot(container)

    root.render(
      <Terminal
        ref={terminalRef}
        accessibility={{
          ariaLabel: options.ariaLabel ?? 'Harness Terminal',
          autoFocus: options.autoFocus ?? false,
        }}
        styling={{
          rows: options.rows,
          columns: options.columns,
          localEcho: options.localEcho ?? true,
          autoResize: options.autoResize ?? false,
        }}
        graphics={graphicsOptions}
        instrumentation={
          captureOnData ||
          captureDiagnostics ||
          captureFrame ||
          captureSelection
            ? {
                onData: captureOnData
                  ? (data) => {
                      onDataEvents.push({
                        text: TEXT_DECODER.decode(data),
                        bytes: Array.from(data),
                      })
                    }
                  : undefined,
                onDiagnostics: captureDiagnostics
                  ? (diagnostics) => {
                      if (diagnostics) {
                        diagnosticsEvents.push(
                          structuredCloneFallback(diagnostics),
                        )
                      }
                    }
                  : undefined,
                onFrame: captureFrame
                  ? (event) => {
                      frameEvents.push(structuredCloneFallback(event))
                    }
                  : undefined,
                onCursorSelectionChange: captureSelection
                  ? (selection) => {
                      cursorSelectionEvents.push(
                        selection ? structuredCloneFallback(selection) : null,
                      )
                    }
                  : undefined,
              }
            : undefined
        }
        onShortcutGuideToggle={
          captureShortcutToggle
            ? (visible, reason) => {
                shortcutGuideToggleEvents.push({ visible, reason })
              }
            : undefined
        }
        style={DEFAULT_STYLE}
        data-testid="terminal-root"
      />,
    )

    await nextFrame()
  }

  const focus = () => {
    terminalRef.current?.focus()
  }

  const write = (data: string) => {
    terminalRef.current?.write(data)
  }

  const compose = (data: string) => {
    const target = document.querySelector<HTMLDivElement>(
      '[data-testid="terminal-root"]',
    )
    if (!target) {
      return
    }
    const text = data ?? ''
    const dispatchComposition = (type: string, value: string) => {
      if (typeof window.CompositionEvent === 'function') {
        target.dispatchEvent(
          new CompositionEvent(type, {
            data: value,
            bubbles: true,
            cancelable: true,
            composed: true,
          }),
        )
        return
      }
      const fallback = new Event(type, {
        bubbles: true,
        cancelable: true,
      }) as Event & { data: string }
      fallback.data = value
      target.dispatchEvent(fallback)
    }

    dispatchComposition('compositionstart', '')
    dispatchComposition('compositionupdate', text)
    dispatchComposition('compositionend', text)

    if (typeof window.InputEvent === 'function') {
      target.dispatchEvent(
        new InputEvent('input', {
          data: text,
          bubbles: true,
          cancelable: true,
          composed: true,
        }),
      )
    } else {
      const fallback = new Event('input', {
        bubbles: true,
        cancelable: true,
      }) as Event & { data: string }
      fallback.data = text
      target.dispatchEvent(fallback)
    }
  }

  const getSnapshot = () => terminalRef.current?.getSnapshot() ?? null

  const getSelection = () => terminalRef.current?.getSelection() ?? null

  const getDiagnostics = () => terminalRef.current?.getDiagnostics() ?? null

  const getOnDataEvents = () => onDataEvents.map((event) => ({ ...event }))

  const resetOnDataEvents = () => {
    onDataEvents.length = 0
  }

  const getFrameEvents = () =>
    frameEvents.map((event) => structuredCloneFallback(event))

  const resetFrameEvents = () => {
    frameEvents.length = 0
  }

  const getDiagnosticsEvents = () =>
    diagnosticsEvents.map((event) => structuredCloneFallback(event))

  const resetDiagnosticsEvents = () => {
    diagnosticsEvents.length = 0
  }

  const getCursorSelectionEvents = () =>
    cursorSelectionEvents.map((selection) =>
      selection ? structuredCloneFallback(selection) : null,
    )

  const resetCursorSelectionEvents = () => {
    cursorSelectionEvents.length = 0
  }

  const getShortcutGuideToggleEvents = () =>
    shortcutGuideToggleEvents.map((event) => ({ ...event }))

  const resetShortcutGuideToggleEvents = () => {
    shortcutGuideToggleEvents.length = 0
  }

  const announceStatus = (
    message: Parameters<TerminalHarnessExports['announceStatus']>[0],
  ) => {
    terminalRef.current?.announceStatus(message)
  }

  const openShortcutGuide = () => {
    terminalRef.current?.openShortcutGuide()
  }

  const closeShortcutGuide = () => {
    terminalRef.current?.closeShortcutGuide()
  }

  const toggleShortcutGuide = () => {
    terminalRef.current?.toggleShortcutGuide()
  }

  const resetTerminal = () => {
    terminalRef.current?.reset()
  }

  return {
    mount,
    dispose,
    focus,
    write,
    compose,
    getSnapshot,
    getSelection,
    getDiagnostics,
    getOnDataEvents,
    resetOnDataEvents,
    getFrameEvents,
    resetFrameEvents,
    getDiagnosticsEvents,
    resetDiagnosticsEvents,
    getCursorSelectionEvents,
    resetCursorSelectionEvents,
    getShortcutGuideToggleEvents,
    resetShortcutGuideToggleEvents,
    announceStatus,
    openShortcutGuide,
    closeShortcutGuide,
    toggleShortcutGuide,
    resetTerminal,
  }
}

declare global {
  interface Window {
    __manaTuiReactTest__?: TerminalHarnessExports
  }
}

window.__manaTuiReactTest__ = createHarness()
