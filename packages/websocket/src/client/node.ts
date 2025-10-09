import { ensureDefaultProfiles, getProfile } from '../protocol'
import { initialiseConnection } from './internal/connection'
import { createChannelTransport } from './internal/ssh-bridge'
import { makeFactory, type RuntimeWebSocket } from './internal/socket'
import type {
  Connection,
  ConnectOptions,
  WebSocketConstructor,
  Channel,
} from './types'
import {
  connectSSH as connectSsh,
  type HostIdentity,
  type NodeConnectOptions as SshNodeConnectOptions,
} from '@mana/ssh/client/node'
import type { DiagnosticRecord } from '@mana/ssh/client/node'
import type { DiagnosticEvent } from '../protocol/diagnostics'

type SshConnectedSession = Awaited<ReturnType<typeof connectSsh>>

export interface NodeConnectOptions extends ConnectOptions {
  readonly WebSocketImpl: WebSocketConstructor
}

export interface NodeSshBridgeOptions
  extends Omit<SshNodeConnectOptions, 'transport' | 'host'> {
  readonly host?: HostIdentity
  readonly closeChannelOnDispose?: boolean
  readonly disposeReason?: string
  readonly onConnectionDiagnostic?: (event: DiagnosticEvent) => void
}

export interface NodeSshSession {
  readonly connection: Connection
  readonly channel: Channel
  readonly ssh: SshConnectedSession
  dispose(options?: { closeChannel?: boolean; reason?: string }): Promise<void>
}

export async function connect(
  options: NodeConnectOptions,
): Promise<Connection> {
  if (!options.WebSocketImpl) {
    throw new Error('Node client requires WebSocketImpl (e.g., from "ws").')
  }

  const factory = async (): Promise<RuntimeWebSocket> => {
    ensureDefaultProfiles()
    const socketFactory = makeFactory(options.WebSocketImpl)
    return socketFactory.create(options.url, resolveProtocols(options))
  }

  return initialiseConnection(factory, options)
}

export async function openSshSession(
  connection: Connection,
  init: Parameters<Connection['openSession']>[0],
  sshOptions: NodeSshBridgeOptions = {},
): Promise<{
  channel: Channel
  ssh: SshConnectedSession
  dispose: NodeSshSession['dispose']
}> {
  const channel = await connection.openSession(init)
  const detachDiagnostic =
    sshOptions.onConnectionDiagnostic != null
      ? connection.on('diagnostic', (event) => {
          sshOptions.onConnectionDiagnostic?.(event as DiagnosticEvent)
        })
      : undefined
  const { transport, dispose: disposeTransport } = createChannelTransport(
    channel,
    {
      onSendError(error) {
        emitDiagnostic(sshOptions.callbacks, {
          timestamp: Date.now(),
          level: 'error',
          code: 'channel-send-failed',
          message: 'Failed to forward SSH payload to websocket channel',
          detail: error,
        })
      },
    },
  )

  if (!init.user?.username) {
    throw new Error('SSH username is required for public key authentication')
  }

  const identityConfig =
    sshOptions.identity ?? {
      mode: 'generated',
      username: init.user.username,
    }

  try {
    const ssh = await connectSsh({
      ...sshOptions,
      identity: identityConfig,
      transport,
      host: sshOptions.host ?? {
        host: init.target.host,
        port: init.target.port,
      },
    })

    const dispose: NodeSshSession['dispose'] = async (options) => {
      const closeChannel =
        options?.closeChannel ?? sshOptions.closeChannelOnDispose ?? true
      const reason =
        options?.reason ?? sshOptions.disposeReason ?? 'ssh-session-disposed'
      detachDiagnostic?.()
      disposeTransport()
      ssh.dispose()
      if (closeChannel) {
        try {
          await channel.close(reason)
        } catch (error) {
          emitDiagnostic(sshOptions.callbacks, {
            timestamp: Date.now(),
            level: 'warn',
            code: 'channel-close-failed',
            message: 'Failed to close websocket SSH channel',
            detail: error,
          })
        }
      }
    }

    return { channel, ssh, dispose }
  } catch (error) {
    disposeTransport()
    detachDiagnostic?.()
    await channel.close('ssh-session-failed').catch(() => {
      /* noop */
    })
    throw error
  }
}

export async function connectAndOpenSsh(
  options: NodeConnectOptions,
  init: Parameters<Connection['openSession']>[0],
  sshOptions: NodeSshBridgeOptions = {},
): Promise<NodeSshSession> {
  const connection = await connect(options)
  try {
    const { channel, ssh, dispose } = await openSshSession(
      connection,
      init,
      sshOptions,
    )
    return {
      connection,
      channel,
      ssh,
      dispose,
    }
  } catch (error) {
    await connection.close(1011, 'ssh-session-failed').catch(() => {
      /* noop */
    })
    throw error
  }
}

function resolveProtocols(
  options: NodeConnectOptions,
): string | string[] | undefined {
  const resolvedProfile =
    typeof options.profile === 'string'
      ? getProfile(options.profile)
      : (options.profile ?? getProfile('mana.v1'))
  const subs = resolvedProfile?.subprotocols
  return subs && subs.length > 0 ? Array.from(subs) : undefined
}

export type {
  Channel,
  ChannelEvents,
  Connection,
  ConnectionEvents,
  ConnectionState,
  ConnectOptions,
  WebSocketConstructor,
} from './types'

function emitDiagnostic(
  callbacks: SshNodeConnectOptions['callbacks'],
  record: DiagnosticRecord,
): void {
  callbacks?.onDiagnostic?.(record)
}
