#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import https from 'node:https'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import process from 'node:process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { ensureCdkEnv, ensureCdkBootstrap } from './aws-env.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const stackDir = path.resolve(__dirname, '..')
const repoRoot = path.resolve(__dirname, ...Array(5).fill('..'))
const signerCacheDir = path.resolve(repoRoot, '.mana', 'web-demo')
const signerCachePath = path.resolve(signerCacheDir, 'signer.json')

const KNOWN_COMMANDS = new Set(['deploy', 'destroy', 'synth', 'diff'])

async function resolvePublicIp() {
  return new Promise((resolve, reject) => {
    https
      .get('https://checkip.amazonaws.com/', (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`Failed to resolve public IP: ${res.statusCode}`))
          return
        }
        let data = ''
        res.on('data', (chunk) => {
          data += chunk.toString()
        })
        res.on('end', () => {
          const ip = data.trim()
          if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
            resolve(ip)
          } else {
            reject(new Error(`Unexpected IP response: ${ip}`))
          }
        })
      })
      .on('error', reject)
  })
}

function collectContextKeys(args) {
  const keys = new Set()
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '--context' || arg === '-c') {
      const next = args[i + 1]
      if (next) {
        const key = next.split('=')[0]
        keys.add(key)
        i += 1
      }
    } else if (arg.startsWith('--context=')) {
      const value = arg.substring('--context='.length)
      const key = value.split('=')[0]
      keys.add(key)
    }
  }
  return keys
}

async function main() {
  const rawArgs = process.argv.slice(2)

  let command = 'synth'
  const passthrough = []

  if (rawArgs.length > 0 && KNOWN_COMMANDS.has(rawArgs[0])) {
    command = rawArgs[0]
    rawArgs.shift()
  }

  for (const arg of rawArgs) {
    if (arg === '--deploy') {
      command = 'deploy'
    } else if (arg === '--destroy') {
      command = 'destroy'
    } else if (arg === '--synth') {
      command = 'synth'
    } else if (arg === '--diff') {
      command = 'diff'
    } else {
      passthrough.push(arg)
    }
  }

  const providedContextKeys = collectContextKeys(passthrough)

  const contextArgs = []

  if (!providedContextKeys.has('allowedIp')) {
    let allowedIp = process.env.MANA_DEV_SSH_ALLOWED_IP
    if (!allowedIp) {
      try {
        const ip = await resolvePublicIp()
        allowedIp = `${ip}/32`
      } catch (error) {
        console.error(
          `Unable to determine public IP automatically. Set MANA_DEV_SSH_ALLOWED_IP or pass --context allowedIp=...\n${error instanceof Error ? error.message : String(error)}`,
        )
        process.exit(1)
      }
    }
    contextArgs.push('--context', `allowedIp=${allowedIp}`)
  }

  if (!providedContextKeys.has('stackName')) {
    const stackName =
      process.env.MANA_DEV_SSH_STACK_NAME ?? 'mana-dev-ssh-instance'
    contextArgs.push('--context', `stackName=${stackName}`)
  }

  let envMeta
  try {
    envMeta = await ensureCdkEnv()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }

  if (command === 'deploy' || command === 'destroy' || command === 'diff') {
    try {
      await ensureCdkBootstrap(envMeta)
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      process.exit(1)
    }
  }

  const cdkArgs = [command, ...contextArgs, ...passthrough]
  let outputsFile

  if (command === 'deploy') {
    cdkArgs.push('--require-approval', 'never')
    outputsFile = path.resolve(stackDir, '.cdk-outputs.json')
    cdkArgs.push('--outputs-file', outputsFile)
  } else if (command === 'destroy') {
    cdkArgs.push('--force')
  }

  const result = spawnSync('npx', ['cdk', ...cdkArgs], {
    cwd: stackDir,
    stdio: 'inherit',
    env: process.env,
  })

  if (result.error) {
    console.error(result.error)
    if (outputsFile && existsSync(outputsFile)) {
      rmSync(outputsFile, { force: true })
    }
    process.exit(result.status ?? 1)
  }

  const exitCode = result.status ?? 0

  if (exitCode === 0) {
    if (command === 'deploy' && outputsFile) {
      try {
        updateSignerCacheFromOutputs(outputsFile)
      } catch (error) {
        console.warn(
          `Unable to cache signer configuration: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    } else if (command === 'destroy') {
      removeSignerCache()
    }
  }

  if (outputsFile && existsSync(outputsFile)) {
    rmSync(outputsFile, { force: true })
  }

  process.exit(exitCode)
}

function ensureDirectory(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

function parseOutputs(filePath) {
  if (!existsSync(filePath)) {
    return null
  }
  const raw = readFileSync(filePath, 'utf8')
  const json = JSON.parse(raw)
  let endpoint
  let discoveryEndpoint
  let token
  let defaults
  for (const value of Object.values(json)) {
    if (!value || typeof value !== 'object') {
      continue
    }
    if (
      typeof value.SignerEndpoint === 'string' &&
      value.SignerEndpoint.length > 0
    ) {
      endpoint = value.SignerEndpoint
    }
    if (
      typeof value.DiscoveryEndpoint === 'string' &&
      value.DiscoveryEndpoint.length > 0
    ) {
      discoveryEndpoint = value.DiscoveryEndpoint
    }
    if (typeof value.SignerToken === 'string' && value.SignerToken.length > 0) {
      token = value.SignerToken
    }
    if (
      typeof value.SignerDefaults === 'string' &&
      value.SignerDefaults.length > 0
    ) {
      defaults = value.SignerDefaults
    }
  }

  if (!endpoint || !token) {
    return null
  }

  let parsedDefaults
  if (defaults) {
    try {
      parsedDefaults = JSON.parse(defaults)
    } catch (error) {
      console.warn(
        `Failed to parse signer defaults from stack outputs: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  return {
    endpoint,
    discoveryEndpoint: discoveryEndpoint ?? null,
    token,
    defaults: parsedDefaults,
  }
}

function updateSignerCacheFromOutputs(outputsFile) {
  const data = parseOutputs(outputsFile)
  if (!data) {
    return
  }

  ensureDirectory(signerCacheDir)

  const payload = {
    endpoint: data.endpoint,
    discoveryEndpoint: data.discoveryEndpoint,
    bearerToken: data.token,
    defaults: data.defaults ?? null,
    updatedAt: new Date().toISOString(),
  }
  writeFileSync(signerCachePath, JSON.stringify(payload, null, 2))
  process.stderr.write(
    `Signer configuration written to ${path.relative(repoRoot, signerCachePath)}\n`,
  )
}

function removeSignerCache() {
  if (existsSync(signerCachePath)) {
    rmSync(signerCachePath, { force: true })
    process.stderr.write(
      `Removed signer configuration at ${path.relative(repoRoot, signerCachePath)}\n`,
    )
  }
}

await main()
