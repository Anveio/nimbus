import { BinaryWriter } from './binary/binary-writer'

export const TERMINAL_MODE_END = 0
export const TERMINAL_MODE_ISPEED = 128
export const TERMINAL_MODE_OSPEED = 129

export interface TerminalModeEntry {
  readonly opcode: number
  readonly argument: number
}

export function encodeTerminalModes(
  entries: ReadonlyArray<TerminalModeEntry>,
): Uint8Array {
  const writer = new BinaryWriter()
  for (const entry of entries) {
    if (!Number.isFinite(entry.argument)) {
      throw new RangeError('Terminal mode argument must be finite')
    }
    if (
      !Number.isInteger(entry.argument) ||
      entry.argument < 0 ||
      entry.argument > 0xffff_ffff
    ) {
      throw new RangeError('Terminal mode argument must be uint32')
    }
    if (!Number.isFinite(entry.opcode)) {
      throw new RangeError('Terminal mode opcode must be finite')
    }
    if (!Number.isInteger(entry.opcode) || entry.opcode < 0 || entry.opcode > 0xff) {
      throw new RangeError('Terminal mode opcode must fit in uint8')
    }
    const opcode = entry.opcode & 0xff
    if (opcode === TERMINAL_MODE_END) {
      continue
    }
    writer.writeUint8(opcode)
    writer.writeUint32(entry.argument >>> 0)
  }
  writer.writeUint8(TERMINAL_MODE_END)
  return writer.toUint8Array()
}
