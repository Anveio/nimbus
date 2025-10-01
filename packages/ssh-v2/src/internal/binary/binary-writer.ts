const UTF8_ENCODER = new TextEncoder()

/**
 * Accumulates bytes for SSH packet encoding (RFC 4253 §6).
 */
export class BinaryWriter {
  #chunks: Uint8Array[] = []
  #length = 0

  get length(): number {
    return this.#length
  }

  writeUint8(value: number): void {
    this.#chunks.push(Uint8Array.of(value & 0xff))
    this.#length += 1
  }

  writeUint32(value: number): void {
    const view = new DataView(new ArrayBuffer(4))
    view.setUint32(0, value >>> 0, false)
    this.#push(view)
  }

  writeBigUint64(value: bigint): void {
    const view = new DataView(new ArrayBuffer(8))
    view.setBigUint64(0, value, false)
    this.#push(view)
  }

  writeBoolean(value: boolean): void {
    this.writeUint8(value ? 1 : 0)
  }

  writeBytes(bytes: Uint8Array): void {
    if (bytes.length === 0) {
      return
    }
    this.#chunks.push(bytes)
    this.#length += bytes.length
  }

  writeString(value: string): void {
    const encoded = UTF8_ENCODER.encode(value)
    this.writeUint32(encoded.byteLength)
    this.writeBytes(encoded)
  }

  toUint8Array(): Uint8Array {
    const result = new Uint8Array(this.#length)
    let offset = 0
    for (const chunk of this.#chunks) {
      result.set(chunk, offset)
      offset += chunk.length
    }
    return result
  }

  clear(): void {
    this.#chunks = []
    this.#length = 0
  }

  #push(view: DataView): void {
    const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
    const copy = new Uint8Array(bytes)
    this.#chunks.push(copy)
    this.#length += copy.length
  }
}

