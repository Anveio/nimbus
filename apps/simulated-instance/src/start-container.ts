import path from 'node:path'
import { c } from 'tar'
import { CONTAINER_NAME, createDockerInstance, IMAGE_NAME } from './utils'

// Constants

const SSH_PORT = 2222

/**
 * Creates a Docker instance by searching for a valid container runtime socket.
 * @returns A Dockerode instance.
 * @throws {Error} If no valid socket is found.
 */
const docker = createDockerInstance()

/**
 * Builds the Docker image by creating a tar stream of the required files.
 */
async function buildImage() {
  console.log(`Building Docker image: ${IMAGE_NAME}...`)
  try {
    const packageRoot = path.join(__dirname, '..')
    const filesToInclude = ['Dockerfile', 'id_rsa', 'id_rsa.pub']

    // Create a tar stream in memory
    const tarStream = c(
      {
        gzip: false,
        cwd: packageRoot,
      },
      filesToInclude,
    )

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stream = await docker.buildImage(tarStream as any, {
      t: IMAGE_NAME,
    })

    await new Promise<void>((resolve, reject) => {
      docker.modem.followProgress(stream, (err: Error | null) =>
        err ? reject(err) : resolve(),
      )
    })

    console.log('Image built successfully.')
  } catch (error) {
    console.error('Failed to build Docker image:', error)
    process.exit(1)
  }
}

/**
 * Starts the SSH container, mapping the container's port 22 to the host.
 */
async function startContainer() {
  console.log(`Starting container: ${CONTAINER_NAME}...`)

  // First, check if a container with the same name is already running
  await removeContainerIfExists()

  try {
    const container = await docker.createContainer({
      Image: IMAGE_NAME,
      name: CONTAINER_NAME,
      ExposedPorts: { '22/tcp': {} },
      HostConfig: {
        PortBindings: {
          '22/tcp': [{ HostPort: `${SSH_PORT}` }],
        },
      },
    })

    await container.start()
    console.log(
      `Container started successfully. SSH server is listening on port ${SSH_PORT}.`,
    )
    return container
  } catch (error) {
    console.error('Failed to start container:', error)
    process.exit(1)
  }
}

/**
 * Checks for an existing container and removes it if found.
 */
async function removeContainerIfExists() {
  try {
    const container = docker.getContainer(CONTAINER_NAME)
    const data = await container.inspect()
    if (data) {
      console.log('Found existing container. Removing it...')
      if (data.State.Running) {
        await container.stop()
      }
      await container.remove()
      console.log('Existing container removed.')
    }
  } catch (error) {
    // Check if the error is a Dockerode error and has a 404 status code
    if (
      error instanceof Error &&
      'statusCode' in error &&
      error.statusCode === 404
    ) {
      // This is expected if the container doesn't exist, so we can ignore it.
      return
    }
    // For all other errors, log them and exit.
    console.error('Error checking for existing container:', error)
    process.exit(1)
  }
}

/**
 * Gracefully stops and removes the container on script exit.
 */
async function cleanup() {
  console.log('\nCleaning up...')
  await removeContainerIfExists()
  console.log('Cleanup complete. Exiting.')
  process.exit(0)
}

/**
 * Main function to orchestrate the setup.
 */
async function main() {
  // Handle graceful shutdown
  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)

  await buildImage()
  await startContainer()

  console.log('Development environment is ready.')
}

main().catch((error) => {
  console.error('An unexpected error occurred:', error)
  cleanup()
})
