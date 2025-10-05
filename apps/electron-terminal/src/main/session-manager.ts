import type { DiagnosticRecord } from '@mana/ssh'
import {
  type Channel,
  connectAndOpenSsh as connectAndOpenNodeSsh,
  type NodeSshSession,
} from '@mana/websocket/client/node'
import { ipcMain, type WebContents } from 'electron'
import type {
  SessionDiagnostic,
  SessionOpenOptions,
  SessionResize,
  SessionStatus,
} from '../shared/session-types'

const DEFAULT_TERMINAL_COLUMNS = 80
const DEFAULT_TERMINAL_ROWS = 24

interface ActiveSession {
  send(data: Uint8Array): Promise<void> | void
  resize(dimensions: SessionResize): void
  dispose(reason?: string): Promise<void> | void
}

class EchoSession implements ActiveSession {
  private readonly encoder = new TextEncoder()

  constructor(private readonly notify: SessionNotifier) {
    const banner = this.encoder.encode('Mana Electron Terminal\r\nReady.\r\n')
    queueMicrotask(() => {
      this.notify.emitData(banner)
      this.notify.emitStatus({ type: 'ready' })
    })
  }

  send(data: Uint8Array): void {
    this.notify.emitData(data)
  }

  resize(_dimensions: SessionResize): void {
    // no-op for echo transport
  }

  dispose(reason?: string): void {
    this.notify.emitStatus({ type: 'closed', reason })
  }
}

class SshWebsocketSession implements ActiveSession {
  private session: NodeSshSession | null = null
  private channel: Channel | null = null
  private readonly disposers: Array<() => void> = []

  constructor(
    private readonly options: SessionOpenOptions,
    private readonly notify: SessionNotifier,
  ) {}

  async open(): Promise<void> {
    const websocketUrl = this.options.websocket?.url
    const host = this.options.target
    const credentials = this.options.credentials
    if (!websocketUrl || !host || !credentials?.username) {
      throw new Error('Incomplete SSH websocket session options')
    }

    this.notify.emitStatus({ type: 'connecting' })

    const WebSocketImpl = (globalThis as { WebSocket?: typeof WebSocket })
      .WebSocket
    if (!WebSocketImpl) {
      throw new Error('WebSocket implementation unavailable in main process')
    }

    const nodeSession = await connectAndOpenNodeSsh(
      {
        url: websocketUrl,
        profile: this.options.websocket?.profile,
        WebSocketImpl,
      },
      {
        target: host,
        user: {
          username: credentials.username,
          auth: credentials.password
            ? { type: 'password', value: credentials.password }
            : credentials.privateKey
              ? { type: 'private-key', value: credentials.privateKey }
              : { type: 'password', value: '' },
        },
        term: {
          cols: this.options.terminal?.columns ?? DEFAULT_TERMINAL_COLUMNS,
          rows: this.options.terminal?.rows ?? DEFAULT_TERMINAL_ROWS,
        },
      },
      {
        callbacks: {
          onDiagnostic: (record: DiagnosticRecord) => {
            this.notify.emitDiagnostic({
              level:
                record.level === 'error'
                  ? 'error'
                  : record.level === 'warn'
                    ? 'warn'
                    : 'info',
              code: record.code ?? 'ssh-diagnostic',
              message: record.message ?? 'SSH diagnostic event',
              detail: record.detail,
            })
          },
        },
      },
    )

    this.session = nodeSession
    this.channel = nodeSession.channel

    const disposeData = this.channel.on('data', (payload: Uint8Array) => {
      this.notify.emitData(payload)
    })
    const disposeExit = this.channel.on(
      'exit',
      (
        summary: { readonly code?: number; readonly sig?: string } | undefined,
      ) => {
        this.notify.emitStatus({
          type: 'closed',
          reason: summary?.code != null ? `exit:${summary.code}` : summary?.sig,
        })
      },
    )
    const disposeError = this.channel.on('error', (error: Error) => {
      this.notify.emitDiagnostic({
        level: 'error',
        code: 'channel-error',
        message: 'Channel error',
        detail: error,
      })
    })
    this.disposers.push(disposeData, disposeExit, disposeError)

    this.notify.emitStatus({ type: 'connected' })
    this.notify.emitStatus({ type: 'ready' })
  }

  send(data: Uint8Array): Promise<void> {
    if (!this.channel) {
      throw new Error('SSH channel is not ready')
    }
    return this.channel.send(data)
  }

  resize(dimensions: SessionResize): void {
    if (!this.channel) {
      return
    }
    this.channel.resize({ cols: dimensions.columns, rows: dimensions.rows })
  }

  async dispose(reason?: string): Promise<void> {
    while (this.disposers.length > 0) {
      const dispose = this.disposers.pop()
      try {
        dispose?.()
      } catch (error) {
        this.notify.emitDiagnostic({
          level: 'warn',
          code: 'listener-cleanup-error',
          message: 'Failed to clean SSH channel listener',
          detail: error,
        })
      }
    }
    if (this.session) {
      await this.session.dispose({ closeChannel: true, reason })
      this.session = null
      this.channel = null
    }
    this.notify.emitStatus({ type: 'closed', reason })
  }
}

interface SessionNotifier {
  emitData(data: Uint8Array): void
  emitStatus(status: SessionStatus): void
  emitDiagnostic(entry: SessionDiagnostic): void
}

export class SessionManager implements SessionNotifier {
  private webContents: WebContents | null = null
  private activeSession: ActiveSession | null = null

  constructor() {
    ipcMain.handle(
      'mana/session/open',
      async (_event, options: SessionOpenOptions) => {
        await this.open(options)
      },
    )

    ipcMain.handle('mana/session/close', async () => {
      await this.close('renderer-request')
    })

    ipcMain.on('mana/session/send', (_event, payload: number[]) => {
      if (!this.activeSession) {
        return
      }
      const buffer = Uint8Array.from(payload)
      void this.activeSession.send(buffer)
    })

    ipcMain.on('mana/session/resize', (_event, dimensions: SessionResize) => {
      this.activeSession?.resize(dimensions)
    })
  }

  registerWebContents(contents: WebContents): void {
    this.webContents = contents
  }

  private async open(options: SessionOpenOptions): Promise<void> {
    await this.close('session-replaced')

    const transport = options.transport ?? 'echo'
    if (transport === 'echo') {
      this.activeSession = new EchoSession(this)
      this.emitStatus({ type: 'connecting' })
      this.emitStatus({ type: 'connected' })
      return
    }

    const sshSession = new SshWebsocketSession(options, this)
    try {
      await sshSession.open()
      this.activeSession = sshSession
    } catch (error) {
      this.emitDiagnostic({
        level: 'error',
        code: 'ssh-session-error',
        message: 'Failed to open SSH websocket session',
        detail: error,
      })
      this.emitStatus({
        type: 'error',
        message:
          error instanceof Error ? error.message : 'Unknown SSH session error',
      })
    }
  }

  private async close(reason?: string): Promise<void> {
    if (!this.activeSession) {
      return
    }
    try {
      await this.activeSession.dispose(reason)
    } catch (error) {
      this.emitDiagnostic({
        level: 'warn',
        code: 'session-dispose-error',
        message: 'Failed to dispose active session',
        detail: error,
      })
    } finally {
      this.activeSession = null
    }
  }

  emitData(data: Uint8Array): void {
    if (this.webContents && !this.webContents.isDestroyed()) {
      this.webContents.send('mana/session/data', Array.from(data))
    }
  }

  emitStatus(status: SessionStatus): void {
    if (this.webContents && !this.webContents.isDestroyed()) {
      this.webContents.send('mana/session/status', status)
    }
  }

  emitDiagnostic(entry: SessionDiagnostic): void {
    if (this.webContents && !this.webContents.isDestroyed()) {
      this.webContents.send('mana/session/diagnostic', entry)
    }
  }
}

export const sessionManager = new SessionManager()
