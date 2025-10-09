#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { ensureCdkEnv } from './aws-env.mjs'

async function main() {
  let envMeta
  try {
    envMeta = await ensureCdkEnv()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }

  const target = `aws://${envMeta.account}/${envMeta.region}`
  process.stderr.write(`Bootstrapping ${target}\n`)

  const result = spawnSync(
    'npx',
    ['cdk', 'bootstrap', target, ...process.argv.slice(2)],
    {
      stdio: 'inherit',
      env: process.env,
    },
  )

  if (result.error) {
    console.error(result.error)
    process.exit(result.status ?? 1)
  }
  process.exit(result.status ?? 0)
}

await main()
