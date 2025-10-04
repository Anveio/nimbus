export type HelloAuth =
  | { readonly scheme: 'bearer'; readonly token: string }
  | { readonly scheme: 'none' }

export type HelloCaps = Readonly<Record<string, unknown>>
export type HelloResume = { readonly token: string }

export type ServerCaps = {
  readonly flow: 'credit'
  readonly maxFrame?: number
  readonly profileAccepted: string
  readonly [key: string]: unknown
}

export type Ctl =
  | {
      readonly t: 'hello'
      readonly proto: 1
      readonly auth?: HelloAuth
      readonly caps?: HelloCaps
      readonly resume?: HelloResume
    }
  | {
      readonly t: 'hello_ok'
      readonly server: string
      readonly caps: ServerCaps
    }
  | {
      readonly t: 'open'
      readonly id: number
      readonly target: { readonly host: string; readonly port: number }
      readonly user: { readonly username: string; readonly auth: unknown }
      readonly term?: {
        readonly cols: number
        readonly rows: number
        readonly env?: Readonly<Record<string, string>>
      }
    }
  | { readonly t: 'open_ok'; readonly id: number; readonly resumeKey?: string }
  | {
      readonly t: 'open_err'
      readonly id: number
      readonly code: string
      readonly msg: string
    }
  | {
      readonly t: 'resize'
      readonly id: number
      readonly cols: number
      readonly rows: number
    }
  | { readonly t: 'signal'; readonly id: number; readonly sig: string }
  | { readonly t: 'close'; readonly id: number; readonly reason?: string }
  | {
      readonly t: 'exit'
      readonly id: number
      readonly code?: number
      readonly sig?: string
    }
  | { readonly t: 'flow'; readonly id: number; readonly credit: number }
  | { readonly t: 'ping'; readonly ts: number }
  | { readonly t: 'pong'; readonly ts: number }

export type CtlType = Ctl['t']

export type DataFrame = {
  readonly stream: 'stdout' | 'stderr'
  readonly id: number
  readonly payload: Uint8Array
}

export function isCtl(value: unknown): value is Ctl {
  if (!isRecord(value) || typeof value.t !== 'string') {
    return false
  }
  switch (value.t) {
    case 'hello':
      return value.proto === 1 && (!value.auth || isValidAuth(value.auth))
    case 'hello_ok':
      return (
        typeof value.server === 'string' &&
        isRecord(value.caps) &&
        value.caps.flow === 'credit'
      )
    case 'open':
      return (
        Number.isInteger(value.id) &&
        value.id >= 0 &&
        isTarget(value.target) &&
        isUser(value.user)
      )
    case 'open_ok':
      return Number.isInteger(value.id)
    case 'open_err':
      return (
        Number.isInteger(value.id) &&
        typeof value.code === 'string' &&
        typeof value.msg === 'string'
      )
    case 'resize':
      return (
        Number.isInteger(value.id) &&
        isPositiveInt(value.cols) &&
        isPositiveInt(value.rows)
      )
    case 'signal':
      return Number.isInteger(value.id) && typeof value.sig === 'string'
    case 'close':
      return (
        Number.isInteger(value.id) &&
        (value.reason === undefined || typeof value.reason === 'string')
      )
    case 'exit':
      return Number.isInteger(value.id)
    case 'flow':
      return Number.isInteger(value.id) && isNonNegativeNumber(value.credit)
    case 'ping':
    case 'pong':
      return typeof value.ts === 'number'
    default:
      return false
  }
}

export function isDataFrame(value: unknown): value is DataFrame {
  if (!isRecord(value)) return false
  if (value.stream !== 'stdout' && value.stream !== 'stderr') return false
  if (!Number.isInteger(value.id)) return false
  return value.payload instanceof Uint8Array
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isValidAuth(auth: unknown): auth is HelloAuth {
  if (!isRecord(auth) || typeof auth.scheme !== 'string') return false
  if (auth.scheme === 'bearer') {
    return typeof auth.token === 'string' && auth.token.length > 0
  }
  return auth.scheme === 'none'
}

function isTarget(
  value: unknown,
): value is { readonly host: string; readonly port: number } {
  return (
    isRecord(value) &&
    typeof value.host === 'string' &&
    Number.isInteger(value.port) &&
    value.port > 0 &&
    value.port <= 65535
  )
}

function isUser(
  value: unknown,
): value is { readonly username: string; readonly auth: unknown } {
  return (
    isRecord(value) && typeof value.username === 'string' && 'auth' in value
  )
}

function isPositiveInt(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && value >= 0 && Number.isFinite(value)
}
