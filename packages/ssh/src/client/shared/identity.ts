import type {
  GeneratedIdentityConfig,
  GeneratedPublicKeyInfo,
  ResolvedIdentity,
  SshIdentityConfig,
} from '../../api'
import { BinaryReader } from '../../internal/binary/binary-reader'
import { BinaryWriter } from '../../internal/binary/binary-writer'
import { SshInvariantViolation, SshNotImplementedError } from '../../errors'

const ED25519_ALGORITHM = 'ssh-ed25519'

export async function resolveIdentityConfig(
  crypto: Crypto,
  identity: SshIdentityConfig,
): Promise<ResolvedIdentity> {
  if (!identity) {
    throw new SshInvariantViolation('SSH identity (with username) is required')
  }
  switch (identity.mode) {
    case 'generated':
      return generateIdentity(crypto, identity)
    case 'provided':
      return resolveProvidedIdentity(crypto, identity)
    default:
      throw new SshNotImplementedError('Unsupported identity mode')
  }
}

async function generateIdentity(
  crypto: Crypto,
  config: GeneratedIdentityConfig,
): Promise<ResolvedIdentity> {
  const algorithm = config.algorithm ?? 'ed25519'
  switch (algorithm) {
    case 'ed25519':
      return generateEd25519Identity(crypto, config)
    default:
      throw new SshNotImplementedError(
        `Generated identity for algorithm ${algorithm} is not supported yet`,
      )
  }
}

async function generateEd25519Identity(
  crypto: Crypto,
  config: GeneratedIdentityConfig,
): Promise<ResolvedIdentity> {
  if (!crypto.subtle?.generateKey) {
    throw new SshNotImplementedError(
      'Ed25519 identity generation requires WebCrypto SubtleCrypto support',
    )
  }
  const keyPair = await crypto.subtle.generateKey({ name: 'Ed25519' }, false, [
    'sign',
    'verify',
  ])
  if (!isCryptoKeyPair(keyPair)) {
    throw new SshInvariantViolation(
      'WebCrypto failed to generate Ed25519 key pair',
    )
  }
  const publicKeyRaw = await crypto.subtle.exportKey('raw', keyPair.publicKey)
  const publicKey = new Uint8Array(publicKeyRaw)
  const openssh = encodeOpenSshEd25519(publicKey)
  const info: GeneratedPublicKeyInfo = {
    algorithm: 'ed25519',
    publicKey,
    openssh,
  }
  config.onPublicKey?.(info)
  return {
    username: config.username,
    algorithm: ED25519_ALGORITHM,
    publicKey,
    openssh,
    sign(payload) {
      return signWithCryptoKey(crypto, keyPair.privateKey, payload)
    },
  }
}

async function resolveProvidedIdentity(
  crypto: Crypto,
  identity: SshIdentityConfig & { mode: 'provided' },
): Promise<ResolvedIdentity> {
  const algorithm = identity.algorithm
  switch (algorithm) {
    case 'ed25519':
      return resolveProvidedEd25519Identity(crypto, identity)
    default:
      throw new SshNotImplementedError(
        `Provided identity for algorithm ${algorithm} is not supported yet`,
      )
  }
}

async function resolveProvidedEd25519Identity(
  crypto: Crypto,
  identity: SshIdentityConfig & { mode: 'provided'; algorithm: 'ed25519' },
): Promise<ResolvedIdentity> {
  const material = identity.material
  if (material.kind === 'signer') {
    return {
      username: identity.username,
      algorithm: ED25519_ALGORITHM,
      publicKey: new Uint8Array(material.publicKey),
      openssh: encodeOpenSshEd25519(material.publicKey),
      sign: material.sign,
    }
  }
  if (material.kind === 'raw') {
    const privateKey = await importEd25519PrivateKey(
      crypto,
      material.privateKey,
    )
    const publicKey = new Uint8Array(material.publicKey)
    return {
      username: identity.username,
      algorithm: ED25519_ALGORITHM,
      publicKey,
      openssh: encodeOpenSshEd25519(publicKey),
      sign(payload) {
        return signWithCryptoKey(crypto, privateKey, payload)
      },
    }
  }
  if (material.kind === 'openssh') {
    const publicKey = decodeOpenSshEd25519(material.publicKey)
    if (!material.sign) {
      throw new SshInvariantViolation(
        'openssh identity requires a sign implementation when private material is not provided',
      )
    }
    return {
      username: identity.username,
      algorithm: ED25519_ALGORITHM,
      publicKey,
      openssh: material.publicKey,
      sign: material.sign,
    }
  }
  throw new SshNotImplementedError('Unsupported Ed25519 identity material')
}

function isCryptoKeyPair(value: unknown): value is CryptoKeyPair {
  return (
    typeof value === 'object' &&
    value !== null &&
    'privateKey' in value &&
    'publicKey' in value
  )
}

async function signWithCryptoKey(
  crypto: Crypto,
  key: CryptoKey,
  payload: Uint8Array,
): Promise<Uint8Array> {
  const buffer = toArrayBuffer(payload)
  const signature = await crypto.subtle.sign('Ed25519', key, buffer)
  return new Uint8Array(signature)
}

async function importEd25519PrivateKey(
  crypto: Crypto,
  input: Uint8Array,
): Promise<CryptoKey> {
  const keyBytes = new Uint8Array(input)
  if (!crypto.subtle?.importKey) {
    throw new SshNotImplementedError(
      'Ed25519 identity import requires WebCrypto SubtleCrypto support',
    )
  }
  try {
    return await crypto.subtle.importKey(
      'raw',
      toArrayBuffer(keyBytes),
      { name: 'Ed25519' },
      false,
      ['sign'],
    )
  } catch (error) {
    throw new SshInvariantViolation(
      `Failed to import Ed25519 private key: ${String(error)}`,
    )
  }
}

function encodeOpenSshEd25519(publicKey: Uint8Array): string {
  const writer = new BinaryWriter()
  writer.writeString(ED25519_ALGORITHM)
  writer.writeUint32(publicKey.length)
  writer.writeBytes(publicKey)
  return `${ED25519_ALGORITHM} ${toBase64(writer.toUint8Array())}`
}

function decodeOpenSshEd25519(openssh: string): Uint8Array {
  const trimmed = openssh.trim()
  const [algorithm, base64] = trimmed.split(/\s+/, 2)
  if (algorithm !== ED25519_ALGORITHM || !base64) {
    throw new SshInvariantViolation('Unsupported OpenSSH public key format')
  }
  const data = fromBase64(base64)
  const reader = new BinaryReader(data)
  const alg = reader.readString()
  if (alg !== ED25519_ALGORITHM) {
    throw new SshInvariantViolation('Mismatched OpenSSH public key algorithm')
  }
  const keyLength = reader.readUint32()
  const publicKey = reader.readBytes(keyLength)
  return new Uint8Array(publicKey)
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

function fromBase64(value: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(value, 'base64'))
  }
  if (typeof atob === 'function') {
    const binary = atob(value)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i) & 0xff
    }
    return bytes
  }
  throw new Error('Base64 decoding not supported in this environment')
}

function toArrayBuffer(payload: Uint8Array): ArrayBuffer {
  if (
    payload.byteOffset === 0 &&
    payload.byteLength === payload.buffer.byteLength &&
    payload.buffer instanceof ArrayBuffer
  ) {
    return payload.buffer
  }
  return payload.slice().buffer
}
