import type { FullConfig } from '@playwright/test'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { certificateFor } from 'devcert'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const workspaceRoot = path.resolve(path.join(__dirname, '..'))
const certDir = path.join(workspaceRoot, 'certs')
const defaultCertPath = path.join(certDir, 'localhost-cert.pem')
const defaultKeyPath = path.join(certDir, 'localhost-key.pem')

async function ensureCertificates(certPath: string, keyPath: string): Promise<void> {
  const missing: string[] = []
  if (!existsSync(certPath)) {
    missing.push(certPath)
  }
  if (!existsSync(keyPath)) {
    missing.push(keyPath)
  }

  if (missing.length === 0) {
    return
  }

  console.log(
    [
      'Nimbus dev HTTPS: generating trusted certificates via devcert.',
      'You may be prompted for your password so devcert can install the local CA.',
    ].join('\n'),
  )

  const certificate = await certificateFor('localhost', { getCaPath: true })
  mkdirSync(path.dirname(certPath), { recursive: true })
  writeFileSync(certPath, certificate.cert)
  writeFileSync(keyPath, certificate.key)
}

async function globalSetup(_config: FullConfig): Promise<void> {
  const certPath = process.env.NIMBUS_DEV_CERT ?? defaultCertPath
  const keyPath = process.env.NIMBUS_DEV_KEY ?? defaultKeyPath
  await ensureCertificates(certPath, keyPath)
}

export default globalSetup
