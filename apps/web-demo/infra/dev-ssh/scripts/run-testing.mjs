#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import https from 'node:https'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { ensureCdkBootstrap, ensureCdkEnv } from './aws-env.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const stackDir = path.resolve(__dirname, '..')

const KNOWN_COMMANDS = new Set(['deploy', 'destroy', 'synth', 'diff'])
const CDK_APP =
  'npx ts-node --project tsconfig.json bin/testing-instance-connect.ts'

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

function runUpdateCache(mode) {
  const result = spawnSync(
    'npx',
    [
      'tsx',
      path.join(stackDir, 'scripts', 'update-testing-cache.ts'),
      mode === 'write' ? '--write' : '--clear',
    ],
    {
      cwd: stackDir,
      stdio: 'inherit',
      env: process.env,
    },
  )
  if (result.error) {
    console.error(result.error)
    process.exit(result.status ?? 1)
  }
  if ((result.status ?? 0) !== 0) {
    process.exit(result.status ?? 1)
  }
}

async function main() {
  const rawArgs = process.argv.slice(2)

  const refreshIndex = rawArgs.indexOf('--refresh-cache')
  if (refreshIndex !== -1) {
    rawArgs.splice(refreshIndex, 1)
    let envMeta
    try {
      envMeta = await ensureCdkEnv()
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      process.exit(1)
    }
    try {
      await ensureCdkBootstrap(envMeta)
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      process.exit(1)
    }
    runUpdateCache('write')
    return
  }
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
    let allowedIp =
      process.env.NIMBUS_TESTING_ALLOWED_IP ??
      process.env.NIMBUS_DEV_SSH_ALLOWED_IP
    if (!allowedIp) {
      try {
        const ip = await resolvePublicIp()
        allowedIp = `${ip}/32`
      } catch (error) {
        console.error(
          `Unable to determine public IP automatically. Set NIMBUS_TESTING_ALLOWED_IP or pass --context allowedIp=...\n${error instanceof Error ? error.message : String(error)}`,
        )
        process.exit(1)
      }
    }
    contextArgs.push('--context', `allowedIp=${allowedIp}`)
  }

  if (!providedContextKeys.has('stackName')) {
    const stackName =
      process.env.NIMBUS_TESTING_STACK_NAME ?? 'nimbus-dev-ssh-testing'
    contextArgs.push('--context', `stackName=${stackName}`)
  }

  if (!providedContextKeys.has('arch')) {
    const arch =
      process.env.NIMBUS_TESTING_ARCH ?? process.env.NIMBUS_DEV_SSH_ARCH
    undefined
    if (arch) {
      contextArgs.push('--context', `arch=${arch}`)
    }
  }

  const cdkArgs = ['--app', CDK_APP, command, ...contextArgs, ...passthrough]

  if (command === 'deploy') {
    cdkArgs.push('--require-approval', 'never')
  } else if (command === 'destroy') {
    cdkArgs.push('--force')
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

  const result = spawnSync('npx', ['cdk', ...cdkArgs], {
    cwd: stackDir,
    stdio: 'inherit',
    env: process.env,
  })

  if (result.error) {
    console.error(result.error)
    process.exit(result.status ?? 1)
  }

  const status = result.status ?? 0
  if (status !== 0) {
    process.exit(status)
  }

  if (command === 'deploy') {
    runUpdateCache('write')
  } else if (command === 'destroy') {
    runUpdateCache('clear')
  }
}

await main()
