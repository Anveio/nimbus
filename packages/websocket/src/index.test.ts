import { describe, expect, it } from 'vitest'
import {
  createBrowserWebSocketClient,
  createNodeWebSocketClient,
  createNodeWebSocketServer,
} from './index'

describe('public exports', () => {
  it('re-exports browser client factory', () => {
    expect(typeof createBrowserWebSocketClient).toBe('function')
  })

  it('re-exports node client factory', () => {
    expect(typeof createNodeWebSocketClient).toBe('function')
  })

  it('re-exports node server factory', () => {
    expect(typeof createNodeWebSocketServer).toBe('function')
  })
})
