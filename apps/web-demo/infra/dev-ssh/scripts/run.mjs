#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import https from 'node:https'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import process from 'node:process'
import { ensureCdkEnv, ensureCdkBootstrap } from './aws-env.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const stackDir = path.resolve(__dirname, '..')

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

  if (!providedContextKeys.has('keyName')) {
    const keyName = process.env.MANA_DEV_SSH_KEY_NAME ?? process.env.MANA_DEFAULT_KEY_NAME
    if (!keyName) {
      console.error(
        'Missing key pair context. Set MANA_DEV_SSH_KEY_NAME or pass --context keyName=<pair-name>.',
      )
      process.exit(1)
    }
    contextArgs.push('--context', `keyName=${keyName}`)
  }

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
    const stackName = process.env.MANA_DEV_SSH_STACK_NAME ?? 'mana-dev-ssh-instance'
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

  if (command === 'deploy') {
    cdkArgs.push('--require-approval', 'never')
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
    process.exit(result.status ?? 1)
  }
  process.exit(result.status ?? 0)
}

await main()
