const INVOCATION_COUNTER_MAX = 0xffff_ffff_ffff_ffffn
export const GCM_TAG_LENGTH_BYTES = 16

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

export async function importAesGcmKey(
  crypto: Crypto,
  keyBytes: Uint8Array,
): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    toArrayBuffer(keyBytes),
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  )
}

export interface AesGcmDirectionState {
  readonly algorithm: 'aes128-gcm@openssh.com'
  key: CryptoKey
  fixedIv: Uint8Array
  invocationCounter: bigint
  sequenceNumber: number
}

export function splitInitialIv(initialIv: Uint8Array): {
  fixed: Uint8Array
  invocation: bigint
} {
  if (initialIv.length !== 12) {
    throw new TypeError('Initial IV for AES-GCM must be 12 bytes')
  }
  const fixed = initialIv.slice(0, 4)
  const counterBytes = initialIv.slice(4)
  let invocation = 0n
  for (const byte of counterBytes) {
    invocation = (invocation << 8n) | BigInt(byte)
  }
  return { fixed, invocation }
}

export function buildNonce(
  fixedIv: Uint8Array,
  invocationCounter: bigint,
): Uint8Array {
  if (fixedIv.length !== 4) {
    throw new TypeError('Fixed IV prefix must be 4 bytes')
  }
  if (invocationCounter < 0n || invocationCounter > INVOCATION_COUNTER_MAX) {
    throw new RangeError('Invocation counter for AES-GCM is out of range')
  }
  const nonce = new Uint8Array(12)
  nonce.set(fixedIv, 0)
  for (let i = 0; i < 8; i += 1) {
    const shift = BigInt(7 - i) * 8n
    nonce[4 + i] = Number((invocationCounter >> shift) & 0xffn)
  }
  return nonce
}

export function computeNextInvocation(counter: bigint): bigint {
  if (counter > INVOCATION_COUNTER_MAX) {
    throw new RangeError('Invocation counter for AES-GCM is out of range')
  }
  if (counter === INVOCATION_COUNTER_MAX) {
    throw new RangeError('AES-GCM invocation counter exhausted')
  }
  return counter + 1n
}

export function computeNextSequence(sequence: number): number {
  if (sequence === 0xffff_ffff) {
    throw new RangeError('SSH packet sequence number exhausted')
  }
  return (sequence + 1) >>> 0
}

export async function encryptAesGcm(params: {
  crypto: Crypto
  state: AesGcmDirectionState
  plaintext: Uint8Array
  additionalData: Uint8Array
}): Promise<{ ciphertext: Uint8Array; tagLength: number }> {
  if (params.state.sequenceNumber === 0xffff_ffff) {
    throw new RangeError(
      'SSH packet sequence number exhausted for AES-GCM cipher',
    )
  }
  if (params.state.invocationCounter === INVOCATION_COUNTER_MAX) {
    throw new RangeError('AES-GCM invocation counter exhausted for SSH cipher')
  }
  const nonce = buildNonce(params.state.fixedIv, params.state.invocationCounter)
  const encrypted = await params.crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(nonce),
      additionalData: toArrayBuffer(params.additionalData),
      tagLength: 128,
    },
    params.state.key,
    toArrayBuffer(params.plaintext),
  )
  params.state.invocationCounter = computeNextInvocation(
    params.state.invocationCounter,
  )
  params.state.sequenceNumber = computeNextSequence(params.state.sequenceNumber)
  return {
    ciphertext: new Uint8Array(encrypted),
    tagLength: GCM_TAG_LENGTH_BYTES,
  }
}

export async function decryptAesGcm(params: {
  crypto: Crypto
  state: AesGcmDirectionState
  packetLength: number
  encrypted: Uint8Array
  additionalData: Uint8Array
}): Promise<Uint8Array> {
  if (params.state.sequenceNumber === 0xffff_ffff) {
    throw new RangeError(
      'SSH packet sequence number exhausted for AES-GCM cipher',
    )
  }
  if (params.state.invocationCounter === INVOCATION_COUNTER_MAX) {
    throw new RangeError('AES-GCM invocation counter exhausted for SSH cipher')
  }
  const nonce = buildNonce(params.state.fixedIv, params.state.invocationCounter)
  const plaintext = await params.crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(nonce),
      additionalData: toArrayBuffer(params.additionalData),
      tagLength: 128,
    },
    params.state.key,
    toArrayBuffer(params.encrypted),
  )
  params.state.invocationCounter = computeNextInvocation(
    params.state.invocationCounter,
  )
  params.state.sequenceNumber = computeNextSequence(params.state.sequenceNumber)
  const view = new Uint8Array(plaintext)
  if (view.length !== params.packetLength) {
    const truncated = view.slice(0, params.packetLength)
    return truncated
  }
  return view
}
