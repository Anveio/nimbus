import fs from 'node:fs'
import path from 'node:path'
import Docker from 'dockerode'

export const IMAGE_NAME = 'mana-ssh-instance'
export const CONTAINER_NAME = 'mana-ssh-instance-container'

export function createDockerInstance(): Docker {
  const homeDir = process.env.HOME || ''
  const socketPaths = [
    // 1. Finch (Standard)
    path.join(homeDir, '.finch/finch.sock'),
    // 2. Finch (Alternative, as discovered via lsof)
    '/Applications/Finch/lima/data/finch/sock/finch.sock',
    // 3. Docker Desktop (Standard)
    '/var/run/docker.sock',
  ]

  for (const socketPath of socketPaths) {
    if (fs.existsSync(socketPath)) {
      console.log(`Found active socket at ${socketPath}. Using it.`)
      return new Docker({ socketPath })
    }
  }

  console.error('Could not find a running container runtime socket.')
  console.error('Please ensure Finch or Docker is installed and running.')
  console.error('Searched paths:', socketPaths)
  throw new Error('No valid container runtime socket found.')
}
