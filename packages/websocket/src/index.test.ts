import { connect as connectViaBrowserSubpath } from '@nimbus/websocket/client/browser'
import type { NodeConnectOptions as NodeConnectOptionsFromNode } from '@nimbus/websocket/client/node'
import { connect as connectViaNodeSubpath } from '@nimbus/websocket/client/node'
import type { BrowserConnectOptions as BrowserConnectOptionsFromWeb } from '@nimbus/websocket/client/web'
import { connect as connectViaWebSubpath } from '@nimbus/websocket/client/web'
import { createNodeWebSocketServer as serverFactorySubpath } from '@nimbus/websocket/server/node'
import { describe, expect, expectTypeOf, it } from 'vitest'
import type { BrowserConnectOptions as BrowserConnectOptionsFromBrowser } from './client/browser'
import type { NodeConnectOptions as NodeConnectOptionsFromSource } from './client/node'
import { connectNode, connectWeb, createNodeWebSocketServer } from './index'
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
    expect(getProfile('nimbus.v1')).toBeDefined()
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
