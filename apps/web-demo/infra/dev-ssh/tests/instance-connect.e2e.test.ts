import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { publishEphemeralKey } from '../lib/instance-connect-publisher'

const repoRoot = path.resolve(__dirname, '../../../..', '..')
const cachePath = path.resolve(repoRoot, '.mana', 'testing-instance.json')

const runLiveTest = process.env.MANA_RUN_INSTANCE_CONNECT_TESTS === '1'

describe('EC2 Instance Connect', () => {
  if (!runLiveTest) {
    test.skip(
      'live Instance Connect smoke test (set MANA_RUN_INSTANCE_CONNECT_TESTS=1 to enable)',
      () => {},
    )
    return
  }

  if (!existsSync(cachePath)) {
    test.skip(
      `testing metadata cache not found at ${cachePath}. Deploy the testing stack first.`,
      () => {},
    )
    return
  }

  test(
    'publishes an ephemeral key using the real AWS API',
    async () => {
      const payload = JSON.parse(readFileSync(cachePath, 'utf8')) as {
        stackName: string
        region: string
        testingUser: string
        instanceId: string
      }

      const result = await publishEphemeralKey({
        stackName: payload.stackName,
        region: payload.region,
        osUser: payload.testingUser,
        instanceId: payload.instanceId,
        comment: 'mana-integration-test',
      })

      expect(result.instanceId).toBe(payload.instanceId)
      expect(result.sshPublicKey.startsWith('ssh-ed25519 ')).toBe(true)
      expect(result.privateKey.includes('OPENSSH PRIVATE KEY')).toBe(true)
      expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now())
    },
    { timeout: 60_000 },
  )
})
