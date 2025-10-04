function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  const { buffer, byteOffset, byteLength } = view
  const sharedArrayBufferExists = typeof SharedArrayBuffer !== 'undefined'
  const requiresCopy =
    byteOffset !== 0 ||
    byteLength !== buffer.byteLength ||
    (sharedArrayBufferExists && buffer instanceof SharedArrayBuffer)
  if (!requiresCopy) {
    return buffer as ArrayBuffer
  }
  const copy = view.slice()
  return copy.buffer as ArrayBuffer
}

function concatBytes(items: ReadonlyArray<Uint8Array>): Uint8Array {
  let total = 0
  for (const item of items) {
    total += item.length
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const item of items) {
    out.set(item, offset)
    offset += item.length
  }
  return out
}

export type HashAlgorithm = 'SHA-256'

export interface KdfParams {
  readonly crypto: Crypto
  readonly hashAlgorithm: HashAlgorithm
  readonly sharedSecret: Uint8Array
  readonly exchangeHash: Uint8Array
  readonly sessionId: Uint8Array
  readonly letter: number
  readonly length: number
}

async function hash(
  crypto: Crypto,
  algorithm: HashAlgorithm,
  input: Uint8Array,
): Promise<Uint8Array> {
  const buffer = await crypto.subtle.digest(algorithm, toArrayBuffer(input))
  return new Uint8Array(buffer)
}

export async function deriveKeyMaterial(
  params: KdfParams,
): Promise<Uint8Array> {
  const {
    crypto,
    hashAlgorithm,
    sharedSecret,
    exchangeHash,
    sessionId,
    letter,
    length,
  } = params
  if (length <= 0) {
    return new Uint8Array(0)
  }

  let output = new Uint8Array(0)
  let roundInput = new Uint8Array(
    concatBytes([
      sharedSecret,
      exchangeHash,
      new Uint8Array([letter]),
      sessionId,
    ]),
  )

  while (output.length < length) {
    const digest = await hash(crypto, hashAlgorithm, roundInput)
    const combined = concatBytes([output, digest])
    output = new Uint8Array(combined)
    if (output.length >= length) {
      break
    }
    const nextInput = concatBytes([sharedSecret, exchangeHash, digest])
    roundInput = new Uint8Array(nextInput)
  }

  return new Uint8Array(output.slice(0, length))
}
