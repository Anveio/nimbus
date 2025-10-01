import { SshDecodeError } from '../../errors'

const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true })

/**
 * Minimal binary reader tailored to SSH packet decoding (RFC 4253 §6).
 */
export class BinaryReader {
  #buffer: Uint8Array
  #offset = 0

  constructor(buffer: Uint8Array) {
    this.#buffer = buffer
  }

  get position(): number {
    return this.#offset
  }

  get remaining(): number {
    return this.#buffer.length - this.#offset
  }

  peek(length: number): Uint8Array {
    this.#ensureAvailable(length)
    return this.#buffer.subarray(this.#offset, this.#offset + length)
  }

  readUint8(): number {
    this.#ensureAvailable(1)
    const value = this.#buffer[this.#offset]
    if (value === undefined) {
      throw new SshDecodeError('Reader overflow while reading uint8')
    }
    this.#offset += 1
    return value
  }

  readUint32(): number {
    const view = this.#readView(4)
    return view.getUint32(0, false)
  }

  readBigUint64(): bigint {
    const view = this.#readView(8)
    return view.getBigUint64(0, false)
  }

  readBoolean(): boolean {
    return this.readUint8() !== 0
  }

  readBytes(length: number): Uint8Array {
    if (length < 0) {
      throw new SshDecodeError(`Cannot read negative byte length (${length})`)
    }
    this.#ensureAvailable(length)
    const slice = this.#buffer.subarray(this.#offset, this.#offset + length)
    this.#offset += length
    return slice
  }

  readString(): string {
    const length = this.readUint32()
    const bytes = this.readBytes(length)
    try {
      return UTF8_DECODER.decode(bytes)
    } catch (error) {
      throw new SshDecodeError('Invalid UTF-8 string in SSH packet', { cause: error })
    }
  }

  skip(length: number): void {
    if (length < 0) {
      throw new SshDecodeError(`Cannot skip negative length (${length})`)
    }
    this.#ensureAvailable(length)
    this.#offset += length
  }

  readRemaining(): Uint8Array {
    const slice = this.#buffer.subarray(this.#offset)
    this.#offset = this.#buffer.length
    return slice
  }

  clone(): BinaryReader {
    const copy = new BinaryReader(this.#buffer)
    copy.#offset = this.#offset
    return copy
  }

  #readView(byteLength: number): DataView {
    this.#ensureAvailable(byteLength)
    const view = new DataView(this.#buffer.buffer, this.#buffer.byteOffset + this.#offset, byteLength)
    this.#offset += byteLength
    return view
  }

  #ensureAvailable(length: number): void {
    if (this.remaining < length) {
      throw new SshDecodeError(
        `Insufficient data: need ${length} byte(s), have ${this.remaining}`,
      )
    }
  }
}

