import { CONTAINER_NAME, IMAGE_NAME, createDockerInstance } from './utils'

// Constants

const docker = createDockerInstance()

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
 * Checks for an existing image and removes it if found.
 */
async function removeImageIfExists() {
  try {
    const image = docker.getImage(IMAGE_NAME)
    const data = await image.inspect()
    if (data) {
      console.log('Found existing image. Removing it...')
      await image.remove({ force: true }) // Force removal to deal with tags
      console.log('Existing image removed.')
    }
  } catch (error) {
    // Check if the error is a Dockerode error and has a 404 status code
    if (
      error instanceof Error &&
      'statusCode' in error &&
      error.statusCode === 404
    ) {
      // This is expected if the image doesn't exist, so we can ignore it.
      return
    }
    // For all other errors, log them and exit.
    console.error('Error checking for existing image:', error)
    process.exit(1)
  }
}

/**
 * Gracefully stops and removes the container on script exit.
 */
async function cleanup() {
  console.log('\nCleaning up...')
  await removeContainerIfExists()
  await removeImageIfExists()
  console.log('Cleanup complete. Exiting.')
  process.exit(0)
}
cleanup().catch((error) => {
  console.error('An unexpected error occurred:', error)
})
