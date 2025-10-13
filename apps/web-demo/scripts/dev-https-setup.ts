#!/usr/bin/env tsx
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { certificateFor } from 'devcert'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const workspaceRoot = path.resolve(path.join(__dirname, '..'))
const certDir = path.join(workspaceRoot, 'certs')
const certPath = path.join(certDir, 'localhost-cert.pem')
const keyPath = path.join(certDir, 'localhost-key.pem')

async function main(): Promise<void> {
  if (existsSync(certPath) && existsSync(keyPath)) {
    console.log(
      [
        'Nimbus dev HTTPS: existing certificate detected.',
        `  Certificate: ${certPath}`,
        `  Key:         ${keyPath}`,
        '',
        'Delete the files if you need to regenerate them.',
      ].join('\n'),
    )
    return
  }

  console.log(
    [
      'Nimbus dev HTTPS: generating trusted certificate via devcert.',
      'You may be prompted for your password so devcert can install the local CA.',
    ].join('\n'),
  )

  const certificate = await certificateFor('localhost', {
    getCaPath: true,
  })

  mkdirSync(certDir, { recursive: true })
  writeFileSync(certPath, certificate.cert)
  writeFileSync(keyPath, certificate.key)

  console.log(
    [
      '',
      'Nimbus dev HTTPS: certificate generation complete.',
      `  Certificate: ${certPath}`,
      `  Key:         ${keyPath}`,
      '',
      'You can now run `npm run dev:https` to start the HTTPS dev server.',
    ].join('\n'),
  )

  process.exit(0)
}

main().catch((error) => {
  console.error(
    `Failed to generate certificates via devcert: ${
      error instanceof Error ? error.message : String(error)
    }`,
  )
  process.exitCode = 1
})
