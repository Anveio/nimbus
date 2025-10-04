import { SshInvariantViolation } from '../../errors'

/**
 * Encodes an unsigned big integer as an SSH mpint (RFC 4251 §5).
 */
export function encodeMpint(value: bigint): Uint8Array {
  if (value < 0n) {
    throw new SshInvariantViolation(
      'mpint encoding does not support negative values',
    )
  }
  if (value === 0n) {
    return new Uint8Array(0)
  }

  let hex = value.toString(16)
  if (hex.length % 2 !== 0) {
    hex = `0${hex}`
  }
  const bytes = hexToUint8Array(hex)
  if ((bytes[0] ?? 0) & 0x80) {
    const extended = new Uint8Array(bytes.length + 1)
    extended[0] = 0
    extended.set(bytes, 1)
    return extended
  }
  return bytes
}

/**
 * Decodes an SSH mpint into a bigint (RFC 4251 §5).
 */
export function decodeMpint(bytes: Uint8Array): bigint {
  if (bytes.length === 0) {
    return 0n
  }
  let hex = ''
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0')
  }
  return BigInt(`0x${hex}`)
}

function hexToUint8Array(hex: string): Uint8Array {
  const normalized = hex.replace(/\s+/g, '')
  if (normalized.length % 2 !== 0) {
    throw new SshInvariantViolation(
      'Hex string must contain an even number of characters',
    )
  }
  const result = new Uint8Array(normalized.length / 2)
  for (let i = 0; i < normalized.length; i += 2) {
    result[i / 2] = parseInt(normalized.slice(i, i + 2), 16)
  }
  return result
}
