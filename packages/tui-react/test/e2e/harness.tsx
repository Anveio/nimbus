import { createCanvasRenderer, type CreateCanvasRenderer } from '@mana/tui-web-canvas-renderer'
import type { RendererBackendConfig } from '@mana/tui-web-canvas-renderer'
import { type CSSProperties, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Terminal, type TerminalHandle } from '../../src/Terminal'
import type {
  TerminalHarnessExports,
  TerminalHarnessMountOptions,
  TerminalHarnessOnDataEvent,
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

const createHarness = (): TerminalHarnessExports => {
  let root: Root | null = null
  let container: HTMLDivElement | null = null
  const terminalRef = createRef<TerminalHandle>()
  const onDataEvents: TerminalHarnessOnDataEvent[] = []

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
  }

  const mount = async (
    options: TerminalHarnessMountOptions = {},
  ): Promise<void> => {
    dispose()
    onDataEvents.length = 0

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

    const backendConfig: RendererBackendConfig | undefined =
      options.rendererBackend === 'gpu-webgl'
        ? { type: 'gpu-webgl', fallback: 'prefer-gpu' }
        : options.rendererBackend === 'cpu-2d'
          ? { type: 'cpu-2d' }
          : undefined

    const rendererFactory: CreateCanvasRenderer | undefined = backendConfig
      ? (rendererOptions) =>
          createCanvasRenderer({
            ...rendererOptions,
            backend: backendConfig,
          })
      : undefined

    root = createRoot(container)

    root.render(
      <Terminal
        ref={terminalRef}
        ariaLabel={options.ariaLabel ?? 'Harness Terminal'}
        rows={options.rows}
        columns={options.columns}
        localEcho={options.localEcho ?? true}
        autoFocus={options.autoFocus ?? false}
        autoResize={options.autoResize ?? false}
        renderer={rendererFactory}
        onData={(data) => {
          onDataEvents.push({
            text: TEXT_DECODER.decode(data),
            bytes: Array.from(data),
          })
        }}
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
      const fallback = new Event('input', { bubbles: true, cancelable: true }) as Event & { data: string }
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

  const announceStatus = (
    message: Parameters<TerminalHarnessExports['announceStatus']>[0],
  ) => {
    terminalRef.current?.announceStatus(message)
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
    announceStatus,
  }
}

declare global {
  interface Window {
    __manaTuiReactTest__?: TerminalHarnessExports
  }
}

window.__manaTuiReactTest__ = createHarness()
