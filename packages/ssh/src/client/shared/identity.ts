import type {
  GeneratedIdentityConfig,
  GeneratedPublicKeyInfo,
  IdentitySign,
  ProvidedIdentityConfig,
  SshIdentityConfig,
} from '../../api'
import { SshNotImplementedError } from '../../errors'

type GeneratedIdentityHooks = {
  readonly onPublicKey?: GeneratedIdentityConfig['onPublicKey']
}

export async function resolveIdentityConfig(
  crypto: Crypto,
  identity: SshIdentityConfig | undefined,
): Promise<ProvidedIdentityConfig> {
  if (!identity || identity.mode === 'generated') {
    const hooks =
      identity?.mode === 'generated'
        ? { onPublicKey: identity.onPublicKey, algorithm: identity.algorithm }
        : { onPublicKey: undefined, algorithm: undefined }
    const algorithm = hooks.algorithm ?? 'ed25519'
    return generateIdentityByAlgorithm(crypto, algorithm, {
      onPublicKey: hooks.onPublicKey,
    })
  }
  return identity
}

async function generateIdentityByAlgorithm(
  crypto: Crypto,
  algorithm: string,
  hooks: GeneratedIdentityHooks,
): Promise<ProvidedIdentityConfig> {
  switch (algorithm) {
    case 'ed25519':
      return generateEd25519Identity(crypto, hooks)
    default:
      throw new SshNotImplementedError(
        `Generated identity for algorithm ${algorithm} is not supported yet`,
      )
  }
}

async function generateEd25519Identity(
  crypto: Crypto,
  hooks: GeneratedIdentityHooks,
): Promise<ProvidedIdentityConfig> {
  if (!crypto.subtle?.generateKey) {
    throw new SshNotImplementedError(
      'Ed25519 identity generation requires WebCrypto SubtleCrypto support',
    )
  }
  const keyPair = await crypto.subtle.generateKey(
    { name: 'Ed25519' },
    false,
    ['sign', 'verify'],
  )
  if (!isCryptoKeyPair(keyPair)) {
    throw new Error('Failed to generate Ed25519 key pair')
  }

  const publicKeyRaw = await crypto.subtle.exportKey('raw', keyPair.publicKey)
  const publicKey = new Uint8Array(publicKeyRaw)
  const sign: IdentitySign = async (payload) => {
    const data = toArrayBuffer(payload)
    const signature = await crypto.subtle.sign('Ed25519', keyPair.privateKey, data)
    return new Uint8Array(signature)
  }

  const openssh = encodeOpenSshEd25519(publicKey)
  const info: GeneratedPublicKeyInfo = {
    algorithm: 'ed25519',
    publicKey,
    openssh,
  }
  hooks.onPublicKey?.(info)

  return {
    mode: 'provided',
    algorithm: 'ed25519',
    material: {
      kind: 'signer',
      publicKey,
      sign,
    },
  }
}

function isCryptoKeyPair(
  candidate: CryptoKeyPair | CryptoKey,
): candidate is CryptoKeyPair {
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    'privateKey' in candidate &&
    'publicKey' in candidate
  )
}

function encodeOpenSshEd25519(publicKey: Uint8Array): string {
  const algorithm = new TextEncoder().encode('ssh-ed25519')
  const totalLength = 4 + algorithm.length + 4 + publicKey.length
  const buffer = new Uint8Array(totalLength)
  let offset = 0
  offset = writeUint32BE(buffer, offset, algorithm.length)
  buffer.set(algorithm, offset)
  offset += algorithm.length
  offset = writeUint32BE(buffer, offset, publicKey.length)
  buffer.set(publicKey, offset)
  const base64 = toBase64(buffer)
  return `ssh-ed25519 ${base64}`
}

function writeUint32BE(target: Uint8Array, offset: number, value: number): number {
  target[offset] = (value >>> 24) & 0xff
  target[offset + 1] = (value >>> 16) & 0xff
  target[offset + 2] = (value >>> 8) & 0xff
  target[offset + 3] = value & 0xff
  return offset + 4
}

function toBase64(data: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(data).toString('base64')
  }
  let binary = ''
  for (let i = 0; i < data.length; i += 1) {
    binary += String.fromCharCode(data[i]!)
  }
  if (typeof btoa === 'function') {
    return btoa(binary)
  }
  throw new Error('Base64 encoding not supported in this environment')
}

function toArrayBuffer(payload: Uint8Array): ArrayBuffer {
  if (
    payload.byteOffset === 0 &&
    payload.byteLength === payload.buffer.byteLength &&
    isArrayBuffer(payload.buffer)
  ) {
    return payload.buffer
  }
  return payload.slice().buffer
}

function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return (
    typeof ArrayBuffer !== 'undefined' &&
    value instanceof ArrayBuffer
  )
}
