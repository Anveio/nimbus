import { describe, expect, expectTypeOf, it } from 'vitest'
import { connectWeb, connectNode, createNodeWebSocketServer } from './index'
import { ensureDefaultProfiles, getProfile } from './protocol'
import { connect as connectViaWebSubpath } from '@mana/websocket/client/web'
import { connect as connectViaBrowserSubpath } from '@mana/websocket/client/browser'
import { connect as connectViaNodeSubpath } from '@mana/websocket/client/node'
import { createNodeWebSocketServer as serverFactorySubpath } from '@mana/websocket/server/node'
import type { BrowserConnectOptions as BrowserConnectOptionsFromWeb } from '@mana/websocket/client/web'
import type { BrowserConnectOptions as BrowserConnectOptionsFromBrowser } from './client/browser'
import type { NodeConnectOptions as NodeConnectOptionsFromNode } from '@mana/websocket/client/node'
import type { NodeConnectOptions as NodeConnectOptionsFromSource } from './client/node'

describe('public exports', () => {
  it('throws with guidance when imported from the package root', async () => {
    await expect(import('@mana/websocket')).rejects.toThrow(/does not expose a root entry point/)
  })

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

  it('exposes browser client through subpath exports', () => {
    expect(typeof connectViaWebSubpath).toBe('function')
    expect(typeof connectViaBrowserSubpath).toBe('function')
  })

  it('aliases browser client types through /client/web', () => {
    expectTypeOf<BrowserConnectOptionsFromWeb>().toEqualTypeOf<BrowserConnectOptionsFromBrowser>()
  })

  it('exposes node client through subpath exports', () => {
    expect(typeof connectViaNodeSubpath).toBe('function')
  })

  it('aliases node client types through /client/node', () => {
    expectTypeOf<NodeConnectOptionsFromNode>().toEqualTypeOf<NodeConnectOptionsFromSource>()
  })

  it('exposes node server through subpath exports', () => {
    expect(typeof serverFactorySubpath).toBe('function')
  })
})
