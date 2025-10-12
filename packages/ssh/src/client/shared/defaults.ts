import type {
  AlgorithmCatalog,
  AlgorithmName,
  IdentificationConfig,
} from '../../api'

export function createDefaultIdentification(): IdentificationConfig {
  return {
    clientId: 'SSH-2.0-nimbus_ssh_0.0.1',
  }
}

export function createDefaultAlgorithmCatalog(): AlgorithmCatalog {
  const asAlgorithm = (value: string): AlgorithmName => value as AlgorithmName
  return {
    keyExchange: [
      asAlgorithm('curve25519-sha256@libssh.org'),
      asAlgorithm('curve25519-sha256'),
      asAlgorithm('diffie-hellman-group14-sha256'),
    ],
    ciphers: [asAlgorithm('aes128-gcm@openssh.com')],
    macs: [asAlgorithm('AEAD_AES_128_GCM'), asAlgorithm('hmac-sha2-256')],
    hostKeys: [
      asAlgorithm('ssh-ed25519'),
      asAlgorithm('rsa-sha2-512'),
      asAlgorithm('rsa-sha2-256'),
    ],
    compression: [asAlgorithm('none')],
    extensions: [asAlgorithm('ext-info-c')],
  }
}
