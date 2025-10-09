import { describe, expect, it } from 'vitest'

import type { AlgorithmCatalog, SshEvent } from '../src/api'
import { createClientSession } from '../src/api'
import {
  asAlgorithmName,
  buildServerKexInitPacket,
  createTestClientConfig,
  drainSessionEvents,
  encodeIdentificationLine,
} from './helpers/session-fixtures'

describe('RFC 4253 §7 algorithm negotiation', () => {
  it('selects the first mutual algorithm in client preference order for every category', () => {
    const algorithms: AlgorithmCatalog = {
      keyExchange: [
        asAlgorithmName('curve25519-sha256@libssh.org'),
        asAlgorithmName('diffie-hellman-group14-sha256'),
      ],
      hostKeys: [
        asAlgorithmName('ssh-ed25519'),
        asAlgorithmName('rsa-sha2-256'),
      ],
      ciphers: [
        asAlgorithmName('aes128-gcm@openssh.com'),
        asAlgorithmName('chacha20-poly1305@openssh.com'),
      ],
      macs: [
        asAlgorithmName('AEAD_AES_128_GCM'),
        asAlgorithmName('hmac-sha2-256'),
      ],
      compression: [
        asAlgorithmName('none'),
        asAlgorithmName('zlib@openssh.com'),
      ],
      extensions: [],
    }

    const session = createClientSession(
      createTestClientConfig({
        algorithms,
        guards: { disableAutoUserAuth: true },
      }),
    )

    // drain identification + outbound events
    session.nextEvent()
    session.nextEvent()
    session.flushOutbound()

    const serverIdentification = encodeIdentificationLine(
      'SSH-2.0-Server_Example_1.0',
    )
    const serverKex = buildServerKexInitPacket({
      kexAlgorithms: [
        'diffie-hellman-group14-sha256',
        'curve25519-sha256@libssh.org',
      ],
      hostKeys: ['rsa-sha2-256', 'ssh-ed25519'],
      encryptionClientToServer: [
        'chacha20-poly1305@openssh.com',
        'aes128-gcm@openssh.com',
      ],
      encryptionServerToClient: ['aes128-gcm@openssh.com'],
      macClientToServer: ['AEAD_AES_128_GCM', 'hmac-sha2-256'],
      macServerToClient: ['AEAD_AES_128_GCM'],
      compressionClientToServer: ['zlib@openssh.com', 'none'],
      compressionServerToClient: ['zlib@openssh.com'],
    })

    const combined = new Uint8Array(
      serverIdentification.length + serverKex.length,
    )
    combined.set(serverIdentification, 0)
    combined.set(serverKex, serverIdentification.length)

    session.receive(combined)

    const events = drainSessionEvents(session)
    const kexReceived = events.find(
      (event) => event.type === 'kex-init-received',
    ) as Extract<SshEvent, { type: 'kex-init-received' }> | undefined
    expect(kexReceived).toBeDefined()

    const snapshot = session.inspect()
    expect(snapshot.negotiatedAlgorithms).toEqual({
      kex: 'curve25519-sha256@libssh.org',
      hostKey: 'ssh-ed25519',
      cipherC2s: 'aes128-gcm@openssh.com',
      cipherS2c: 'aes128-gcm@openssh.com',
      macC2s: 'AEAD_AES_128_GCM',
      macS2c: 'AEAD_AES_128_GCM',
      compressionC2s: 'none',
      compressionS2c: 'zlib@openssh.com',
    })
  })
})
