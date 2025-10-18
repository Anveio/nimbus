import type { ChannelRequestPayload } from '@nimbus/ssh/client/web'
import {
  TokenBucket,
  createBaudRate,
  type BaudPolicy,
  type TerminalSpeed,
} from '@nimbus/ssh/line-discipline'

const AWS_SERIAL_BAUD_NUMERIC = 115200
const AWS_SERIAL_SYMBOL_BITS = 10
const AWS_SERIAL_BURST_BYTES = 4096

export const AWS_SERIAL_BAUD = createBaudRate(AWS_SERIAL_BAUD_NUMERIC)
export const AWS_SERIAL_BYTES_PER_SECOND = Math.floor(
  AWS_SERIAL_BAUD_NUMERIC / AWS_SERIAL_SYMBOL_BITS,
)

function createAwsSerialSpeed(): TerminalSpeed {
  return {
    input: AWS_SERIAL_BAUD,
    output: AWS_SERIAL_BAUD,
  }
}

export function createAwsSerialBaudPolicy(): BaudPolicy {
  const throttler = new TokenBucket({
    capacity: AWS_SERIAL_BURST_BYTES,
    refillPerSecond: AWS_SERIAL_BYTES_PER_SECOND,
    initialTokens: AWS_SERIAL_BURST_BYTES,
  })
  const speed = createAwsSerialSpeed()
  return {
    requested: { ...speed },
    enforced: { ...speed },
    throttler,
  }
}

interface AwsSerialPtyOptions {
  readonly term?: string
  readonly widthPixels?: number
  readonly heightPixels?: number
}

export function buildAwsSerialPtyRequest(
  columns: number,
  rows: number,
  options: AwsSerialPtyOptions = {},
): ChannelRequestPayload {
  const base = createAwsSerialSpeed()
  return {
    type: 'pty-req',
    term: options.term ?? 'vt100',
    columns,
    rows,
    widthPixels: options.widthPixels,
    heightPixels: options.heightPixels,
    speed: base,
  }
}
