import {
  ASCII_CODES,
  C1_CONTROL_BYTES,
  EXTENDED_ASCII,
} from '../utils/constants'
import type { C1TransmissionMode } from '../types'

const CSI_7BIT = '\u001B['

const applyC1Transmission = (
  sequence: string,
  mode: C1TransmissionMode,
): string => {
  if (mode !== '8-bit') {
    return sequence
  }
  return sequence.replaceAll(
    CSI_7BIT,
    String.fromCharCode(C1_CONTROL_BYTES.CSI),
  )
}

const encodeResponse = (sequence: string): Uint8Array => {
  const bytes: number[] = []
  for (let index = 0; index < sequence.length; index += 1) {
    const code = sequence.charCodeAt(index)
    if (code <= EXTENDED_ASCII.BYTE_MAX) {
      bytes.push(code)
      continue
    }
    const point = sequence.codePointAt(index)
    if (point === undefined) {
      bytes.push(ASCII_CODES.QUESTION_MARK)
      continue
    }
    if (point > EXTENDED_ASCII.BYTE_MAX) {
      bytes.push(ASCII_CODES.QUESTION_MARK)
      continue
    }
    bytes.push(point)
  }
  return new Uint8Array(bytes)
}

export const encodeResponsePayload = (
  sequence: string,
  mode: C1TransmissionMode,
): Uint8Array => encodeResponse(applyC1Transmission(sequence, mode))
