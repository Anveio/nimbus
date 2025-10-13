/**
 * Placeholder for the future Bun client runtime.
 * Intentionally throws so downstream consumers avoid depending on the surface ahead of its implementation.
 */
export const createBunWebSocketClient = (): never => {
  throw new Error('Nimbus WebSocket client for Bun is not implemented yet.')
}

