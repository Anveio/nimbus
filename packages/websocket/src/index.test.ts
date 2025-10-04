import { describe, expect, it } from 'vitest'
import { connectWeb, connectNode, createNodeWebSocketServer } from './index'
import { ensureDefaultProfiles, getProfile } from './protocol'

describe('public exports', () => {
  it('re-exports browser connect', () => {
    expect(typeof connectWeb).toBe('function')
  })

  it('re-exports node connect', () => {
    expect(typeof connectNode).toBe('function')
  })

  it('re-exports node server factory', () => {
    expect(typeof createNodeWebSocketServer).toBe('function')
  })

  it('exposes protocol profile helpers', () => {
    ensureDefaultProfiles()
    expect(getProfile('mana.v1')).toBeDefined()
  })
})
