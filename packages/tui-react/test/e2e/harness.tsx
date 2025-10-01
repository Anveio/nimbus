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
        <h1>Mana SSH Terminal Harness</h1>
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

    root = createRoot(container)

    root.render(
      <Terminal
        ref={terminalRef}
        ariaLabel={options.ariaLabel ?? 'Harness Terminal'}
        rows={options.rows}
        columns={options.columns}
        localEcho={options.localEcho ?? true}
        autoFocus={options.autoFocus ?? true}
        autoResize={options.autoResize ?? false}
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

  const getSnapshot = () => terminalRef.current?.getSnapshot() ?? null

  const getSelection = () => terminalRef.current?.getSelection() ?? null

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
    getSnapshot,
    getSelection,
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
