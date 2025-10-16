import { spawnSync } from 'node:child_process'

const result = spawnSync('npm', ['run', 'build'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    VITE_E2E: '1',
  },
})

if (result.status !== 0) {
  process.exit(result.status ?? 1)
}
