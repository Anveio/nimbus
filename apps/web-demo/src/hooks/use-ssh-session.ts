import {
  type BrowserSshSession,
  type ConnectionState,
  connectAndOpenSsh,
} from '@nimbus/websocket/client/web'
import type { TerminalRuntimeResponse } from '@nimbus/vt'
import { useCallback, useEffect, useReducer, useRef } from 'react'

import type { SshFormState } from './use-ssh-form'

interface SessionLogger {
  append(message: string): void
  clear(): void
}

interface PublicKeyInfo {
  readonly algorithm: string
  readonly openssh: string
}

type SessionState =
  | {
      readonly phase: 'idle'
      readonly connectionState: ConnectionState
      readonly publicKey: null
    }
  | {
      readonly phase: 'connecting'
      readonly connectionState: ConnectionState
      readonly publicKey: null
    }
  | {
      readonly phase: 'connected'
      readonly connectionState: ConnectionState
      readonly publicKey: PublicKeyInfo | null
    }
  | {
      readonly phase: 'error'
      readonly connectionState: ConnectionState
      readonly publicKey: null
      readonly error: string
    }

export const initialSessionState: SessionState = {
  phase: 'idle',
  connectionState: 'closed',
  publicKey: null,
}

type SessionAction =
  | { readonly type: 'start-connect' }
  | {
      readonly type: 'connection-state'
      readonly state: ConnectionState
    }
  | { readonly type: 'connected'; readonly state: ConnectionState }
  | { readonly type: 'disconnect' }
  | { readonly type: 'failure'; readonly error: string }
  | {
      readonly type: 'set-public-key'
      readonly publicKey: PublicKeyInfo
    }

export function sessionReducer(
  state: SessionState,
  action: SessionAction,
): SessionState {
  switch (action.type) {
    case 'start-connect':
      return {
        phase: 'connecting',
        connectionState: 'connecting',
        publicKey: null,
      }
    case 'connected':
      return {
        phase: 'connected',
        connectionState: action.state,
        publicKey: null,
      }
    case 'connection-state':
      return {
        ...state,
        connectionState: action.state,
      }
    case 'disconnect':
      return {
        phase: 'idle',
        connectionState: 'closed',
        publicKey: null,
      }
    case 'failure':
      return {
        phase: 'error',
        connectionState: 'closed',
        publicKey: null,
        error: action.error,
      }
    case 'set-public-key':
      if (state.phase !== 'connected') {
        return state
      }
      return {
        ...state,
        publicKey: action.publicKey,
      }
    default:
      return state
  }
}

function normalizeError(error: unknown): string {
  if (error instanceof Error && typeof error.message === 'string') {
    return error.message
  }
  if (typeof error === 'string') {
    return error
  }
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

function parseSshPort(port: string): number {
  const parsed = Number.parseInt(port, 10)
  if (!Number.isFinite(parsed)) {
    return 22
  }
  return parsed
}

type UseSshSessionParams = {
  logger: SessionLogger
}

export function useSshSession({ logger }: UseSshSessionParams) {
  const [state, dispatch] = useReducer(sessionReducer, initialSessionState)
  const sessionRef = useRef<BrowserSshSession | null>(null)
  const disposersRef = useRef<Array<() => void>>([])
  const mountedRef = useRef(true)

  const clearDisposers = useCallback(() => {
    for (const dispose of disposersRef.current) {
      try {
        dispose()
      } catch (error) {
        logger.append(`[ui] listener cleanup failed: ${normalizeError(error)}`)
      }
    }
    disposersRef.current = []
  }, [logger])

  const cleanupSession = useCallback(
    async (reason: string) => {
      clearDisposers()
      const active = sessionRef.current
      if (!active) {
        return
      }
      sessionRef.current = null
      try {
        await active.dispose({ reason })
      } catch (error) {
        logger.append(`[ssh] dispose failed: ${normalizeError(error)}`)
      }
      if (mountedRef.current) {
        dispatch({ type: 'connection-state', state: 'closed' })
      }
    },
    [clearDisposers, logger],
  )

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      void cleanupSession('component-unmount')
    }
  }, [cleanupSession])

  const disconnect = useCallback(async () => {
    await cleanupSession('manual-disconnect')
    dispatch({ type: 'disconnect' })
    logger.append('[ui] session disposed by user.')
  }, [cleanupSession, logger])

  const connect = useCallback(
    async (form: SshFormState, signedUrlInput: string) => {
      const signedUrl = signedUrlInput.trim()
      if (signedUrl.length === 0) {
        const message = 'Request a websocket signed URL before connecting.'
        dispatch({ type: 'failure', error: message })
        logger.append(`[ui] ${message}`)
        return
      }

      const host = form.host.trim()
      if (host.length === 0) {
        const message = 'Provide the SSH host before connecting.'
        dispatch({ type: 'failure', error: message })
        logger.append(`[ui] ${message}`)
        return
      }

      const usernameInput = form.username.trim()
      const username = usernameInput.length > 0 ? usernameInput : 'ec2-user'
      const port = parseSshPort(form.port)

      dispatch({ type: 'start-connect' })
      logger.clear()
      logger.append(
        `[ui] connecting to ssh://${username}@${host}:${port} via websocket`,
      )
      await cleanupSession('reconnecting')

      try {
        const session = await connectAndOpenSsh(
          { url: signedUrl },
          {
            target: { host, port },
            user: { username, auth: { scheme: 'none' } },
            term: { cols: 120, rows: 32 },
          },
          {
            callbacks: {
              onEvent(evt) {
                if (evt.type === 'warning') {
                  logger.append(`[ssh warn] ${evt.message}`)
                } else if (evt.type === 'disconnect') {
                  logger.append(
                    `[ssh] disconnected (${evt.summary.description})`,
                  )
                  if (mountedRef.current) {
                    dispatch({ type: 'disconnect' })
                  }
                  void cleanupSession('ssh-disconnect')
                }
              },
              onDiagnostic(record) {
                logger.append(
                  `[ssh ${record.level}] ${record.code}: ${record.message}`,
                )
              },
            },
            onGeneratedPublicKey(info) {
              logger.append(`[ssh] generated public key (${info.algorithm})`)
              if (mountedRef.current) {
                dispatch({
                  type: 'set-public-key',
                  publicKey: {
                    algorithm: info.algorithm,
                    openssh: info.openssh,
                  },
                })
              }
            },
          },
        )

        const disposers: Array<() => void> = []
        const decoder = new TextDecoder()

        disposers.push(
          session.channel.on('data', (data) => {
            logger.append(`[stdout] ${decoder.decode(data)}`)
          }),
        )
        disposers.push(
          session.channel.on('stderr', (data) => {
            logger.append(`[stderr] ${decoder.decode(data)}`)
          }),
        )
        disposers.push(
          session.channel.on('exit', (payload) => {
            logger.append(
              `[channel] exit code=${payload.code ?? 'n/a'} signal=${
                payload.sig ?? 'n/a'
              }`,
            )
          }),
        )
        disposers.push(
          session.channel.on('error', (channelError) => {
            logger.append(`[channel] error: ${normalizeError(channelError)}`)
          }),
        )
        disposers.push(
          session.connection.on('statechange', (state) => {
            if (mountedRef.current) {
              dispatch({ type: 'connection-state', state })
            }
          }),
        )
        disposers.push(
          session.connection.on('diagnostic', (diag: unknown) => {
            logger.append(`[ws] diagnostic: ${normalizeError(diag)}`)
          }),
        )

        sessionRef.current = session
        disposersRef.current = disposers
        if (mountedRef.current) {
          dispatch({
            type: 'connected',
            state: session.connection.state,
          })
        }
        logger.append('[ui] SSH session established.')
      } catch (error) {
        await cleanupSession('connection-failed')
        const reason = normalizeError(error)
        dispatch({ type: 'failure', error: reason })
        logger.append(`[ui] connection failed: ${reason}`)
      }
    },
    [cleanupSession, logger],
  )

  const handleRuntimeResponse = useCallback(
    (response: TerminalRuntimeResponse) => {
      const session = sessionRef.current
      if (!session) {
        return
      }
      void session.channel.send(response.data).catch((error) => {
        logger.append(
          `[ssh] failed to forward runtime response: ${normalizeError(error)}`,
        )
      })
    },
    [logger],
  )

  return {
    state,
    connect,
    disconnect,
    handleRuntimeResponse,
  }
}

export type { SessionState, PublicKeyInfo }
