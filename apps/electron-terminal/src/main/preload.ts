import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { contextBridge, ipcRenderer } from 'electron'
import type {
  SessionDiagnostic,
  SessionOpenOptions,
  SessionResize,
  SessionStatus,
} from '../shared/session-types'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

type DataListener = (data: Uint8Array) => void
type StatusListener = (status: SessionStatus) => void
type DiagnosticListener = (diagnostic: SessionDiagnostic) => void

const dataListeners = new Set<DataListener>()
const statusListeners = new Set<StatusListener>()
const diagnosticListeners = new Set<DiagnosticListener>()

const createRemoval =
  <T>(set: Set<T>, item: T) =>
  () => {
    set.delete(item)
  }

ipcRenderer.on('mana/session/data', (_event, payload: number[]) => {
  const buffer = Uint8Array.from(payload)
  for (const listener of dataListeners) {
    listener(buffer)
  }
})

ipcRenderer.on('mana/session/status', (_event, status: SessionStatus) => {
  for (const listener of statusListeners) {
    listener(status)
  }
})

ipcRenderer.on(
  'mana/session/diagnostic',
  (_event, diagnostic: SessionDiagnostic) => {
    for (const listener of diagnosticListeners) {
      listener(diagnostic)
    }
  },
)

const defaultSession = resolveDefaultSession()

const bridge = Object.freeze({
  version: resolveAppVersion(),
  session: {
    open(options?: SessionOpenOptions) {
      const resolved = { ...defaultSession, ...(options ?? {}) }
      return ipcRenderer.invoke('mana/session/open', resolved)
    },
    close() {
      return ipcRenderer.invoke('mana/session/close')
    },
    send(data: Uint8Array) {
      ipcRenderer.send('mana/session/send', Array.from(data))
    },
    resize(dimensions: SessionResize) {
      ipcRenderer.send('mana/session/resize', dimensions)
    },
    onData(listener: DataListener) {
      dataListeners.add(listener)
      return createRemoval(dataListeners, listener)
    },
    onStatus(listener: StatusListener) {
      statusListeners.add(listener)
      return createRemoval(statusListeners, listener)
    },
    onDiagnostic(listener: DiagnosticListener) {
      diagnosticListeners.add(listener)
      return createRemoval(diagnosticListeners, listener)
    },
    getDefaultOptions(): SessionOpenOptions {
      return clone(defaultSession)
    },
  },
} as const)

contextBridge.exposeInMainWorld('mana', bridge)

function resolveAppVersion(): string {
  try {
    const pkgPath = join(__dirname, '../../package.json')
    const contents = readFileSync(pkgPath, 'utf-8')
    const parsed = JSON.parse(contents) as { version?: string }
    return parsed.version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

function resolveDefaultSession(): SessionOpenOptions {
  const transport = process.env.MANA_ELECTRON_TRANSPORT ?? 'echo'
  if (transport === 'ssh-websocket') {
    return {
      transport: 'ssh-websocket',
      target: {
        host: process.env.MANA_ELECTRON_SSH_HOST ?? '127.0.0.1',
        port: Number(process.env.MANA_ELECTRON_SSH_PORT ?? '22'),
      },
      websocket: {
        url:
          process.env.MANA_ELECTRON_WEBSOCKET_URL ?? 'ws://localhost:8080/ssh',
        profile: process.env.MANA_ELECTRON_WEBSOCKET_PROFILE,
      },
      credentials: {
        username: process.env.MANA_ELECTRON_SSH_USERNAME ?? 'mana',
        password: process.env.MANA_ELECTRON_SSH_PASSWORD,
        privateKey: process.env.MANA_ELECTRON_SSH_PRIVATE_KEY,
      },
    }
  }
  return {
    transport: 'echo',
    terminal: {
      columns: 80,
      rows: 24,
    },
  }
}

function clone<T>(input: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(input)
  }
  return JSON.parse(JSON.stringify(input)) as T
}
