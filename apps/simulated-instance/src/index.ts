import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Dockerode from 'dockerode'

// Constants for our containerized SSH instance
const IMAGE_NAME = 'mana-ssh/simulated-instance'
const CONTAINER_NAME = 'mana-ssh-dev-instance'
const SSH_PORT_HOST = 2222
const SSH_PORT_CONTAINER = 22

/**
 * Detects the correct Docker daemon socket path, prioritizing Finch.
 * This allows the script to work seamlessly with both Finch and Docker Desktop.
 * @returns The path to the daemon socket.
 * @throws {Error} if no socket is found.
 */
function getDockerSocketPath(): string {
  const homeDir = os.homedir()

  // Standard paths for different container runtimes
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
      console.log(`Testing socket: ${socketPath}`)
      if (testSocketAccess(socketPath)) {
        console.log('Socket is accessible.')
        return socketPath
      }
      return socketPath
    }
  }

  throw new Error(
    'Could not find a container daemon socket. Please ensure Finch or Docker is installed and running.',
  )
}

function testSocketAccess(socketPath: string): boolean {
  try {
    // Check if socket exists and is accessible
    const stats = fs.statSync(socketPath)
    console.log(`Socket ${socketPath}:`)
    console.log(`- Mode: ${stats.mode.toString(8)}`)
    console.log(`- UID: ${stats.uid}, GID: ${stats.gid}`)
    console.log(`- Is Socket: ${stats.isSocket()}`)

    // Try to access it
    fs.accessSync(socketPath, fs.constants.R_OK | fs.constants.W_OK)
    console.log(`- Access: OK`)
    return true
  } catch (error) {
    console.log(`- Access: FAILED - ${error}`)
    return false
  }
}

/**
 * The main orchestration function.
 * It builds the image, manages the container lifecycle, and handles cleanup.
 */
async function main() {
  console.log('Starting simulated SSH instance...')

  const socketPath = getDockerSocketPath()
  const docker = new Dockerode({ socketPath, timeout: 30000, Promise })

  // 1. Verify connection to the container daemon
  console.log('Pinging container daemon...')
  await docker.ping()
  console.log('Daemon connection successful.')

  // 2. Build the Docker image from the Dockerfile in the parent directory
  console.log(`Building image: ${IMAGE_NAME}...`)

  console.log('Context: ', path.join(__dirname, '..'))
  const stream = await docker
    .buildImage(
      {
        context: path.join(__dirname, '..'),
        src: ['Dockerfile', 'id_rsa.pub'],
      },
      { t: IMAGE_NAME },
    )
    .catch((error: any) => {
      console.error('Connection failed:', {
        message: error.message,
        code: error.code,
        syscall: error.syscall,
        path: error.path,
        socketPath: socketPath,
      })
      throw error
    })

  await new Promise((resolve, reject) => {
    docker.modem.followProgress(stream, (err, res) =>
      err ? reject(err) : resolve(res),
    )
  })
  console.log('Image built successfully.')

  // 3. Check for and remove any existing container with the same name
  const existingContainer = docker.getContainer(CONTAINER_NAME)
  try {
    const containerInfo = await existingContainer.inspect()
    if (containerInfo) {
      console.log(`Found existing container ${CONTAINER_NAME}. Removing...`)
      await existingContainer.remove({ force: true })
      console.log('Existing container removed.')
    }
  } catch (error: any) {
    if (error.statusCode !== 404) {
      throw error // Re-throw if it's not a "not found" error
    }
    // Container doesn't exist, which is fine.
  }

  // 4. Create and start the new container
  console.log(`Creating container ${CONTAINER_NAME}...`)
  const container = await docker.createContainer({
    Image: IMAGE_NAME,
    name: CONTAINER_NAME,
    HostConfig: {
      PortBindings: {
        [`${SSH_PORT_CONTAINER}/tcp`]: [{ HostPort: `${SSH_PORT_HOST}` }],
      },
    },
  })

  await container.start()
  console.log(
    `Container started successfully. SSH server is listening on localhost:${SSH_PORT_HOST}`,
  )
  console.log('Press Ctrl+C to stop the container.')
}

/**
 * Gracefully stops and removes the container on script exit.
 */
async function cleanup() {
  console.log('\nCleaning up resources...')
  const socketPath = getDockerSocketPath()
  const docker = new Dockerode({ socketPath })
  const container = docker.getContainer(CONTAINER_NAME)

  try {
    const containerInfo = await container.inspect()
    if (containerInfo.State.Running) {
      console.log(`Stopping container ${CONTAINER_NAME}...`)
      await container.stop()
    }
    console.log(`Removing container ${CONTAINER_NAME}...`)
    await container.remove()
    console.log('Cleanup complete.')
  } catch (error: any) {
    if (error.statusCode === 404) {
      // Container was already removed or never created.
    } else {
      console.error('An error occurred during cleanup:', error)
    }
  } finally {
    process.exit(0)
  }
}

async function buildWithDebugInfo(docker: Dockerode) {
  const contextPath = path.resolve(__dirname, '..')
  console.log(`Build context path: ${contextPath}`)

  // Check if context directory exists and is accessible
  try {
    const contextStats = fs.statSync(contextPath)
    console.log(`Context directory exists: ${contextStats.isDirectory()}`)
  } catch (error) {
    console.error(`Context directory error:`, error)
    throw error
  }

  // List all files in context directory
  console.log('Files in build context:')
  try {
    const files = fs.readdirSync(contextPath, { withFileTypes: true })
    files.forEach((file) => {
      const filePath = path.join(contextPath, file.name)
      const stats = fs.statSync(filePath)
      console.log(
        `  ${file.name} (${file.isDirectory() ? 'dir' : 'file'}) - ${stats.size} bytes`,
      )
    })
  } catch (error) {
    console.error('Error reading context directory:', error)
    throw error
  }

  // Verify specific required files
  const requiredFiles = ['Dockerfile', 'id_rsa.pub']
  for (const file of requiredFiles) {
    const filePath = path.join(contextPath, file)
    try {
      const stats = fs.statSync(filePath)
      console.log(
        `✓ ${file}: ${stats.size} bytes, readable: ${fs.accessSync(filePath, fs.constants.R_OK) === undefined}`,
      )
    } catch (error) {
      console.error(`✗ ${file}: ${error.message}`)
    }
  }
}

// Register cleanup handlers
process.on('SIGINT', cleanup)
process.on('exit', cleanup)

// Run the main function
main()
