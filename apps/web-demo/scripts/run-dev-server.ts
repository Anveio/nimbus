#!/usr/bin/env tsx
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { certificateFor } from 'devcert'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const workspaceRoot = path.resolve(path.join(__dirname, '..'))
const certDir = path.join(workspaceRoot, 'certs')
const defaultCertPath = path.join(certDir, 'localhost-cert.pem')
const defaultKeyPath = path.join(certDir, 'localhost-key.pem')

const certPath = process.env.NIMBUS_DEV_CERT ?? defaultCertPath
const keyPath = process.env.NIMBUS_DEV_KEY ?? defaultKeyPath

async function ensureCertificates(): Promise<void> {
  const missing: string[] = []
  if (!existsSync(certPath)) {
    missing.push(certPath)
  }
  if (!existsSync(keyPath)) {
    missing.push(keyPath)
  }

  if (missing.length === 0) {
    console.log(
      [
        'Nimbus dev HTTPS: existing certificate detected.',
        `  Certificate: ${certPath}`,
        `  Key:         ${keyPath}`,
      ].join('\n'),
    )
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

  console.log(
    [
      'Nimbus dev HTTPS: certificate generation complete.',
      `  Certificate: ${certPath}`,
      `  Key:         ${keyPath}`,
    ].join('\n'),
  )
}

async function main(): Promise<void> {
  await ensureCertificates()

  const host = process.env.HOST ?? '127.0.0.1'
  const port = process.env.PORT ?? '3000'

  const args = [
    'dev',
    '--hostname',
    host,
    '--port',
    port,
    '--experimental-https',
    '--experimental-https-cert',
    certPath,
    '--experimental-https-key',
    keyPath,
    ...process.argv.slice(2),
  ]

  console.log('args', args.join(' '))

  console.log(
    [
      '',
      'Nimbus dev HTTPS: launching Next.js dev server.',
      `  URL: https://${host}:${port}`,
    ].join('\n'),
  )

  const child = spawn('next', args, {
    stdio: 'inherit',
    env: process.env,
    cwd: workspaceRoot,
  })

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal)
      return
    }
    process.exit(code ?? 0)
  })
}

main().catch((error) => {
  console.error(
    `Failed to start HTTPS dev server: ${
      error instanceof Error ? error.message : String(error)
    }`,
  )
  process.exit(1)
})
