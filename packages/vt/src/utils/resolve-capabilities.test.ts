import { describe, expect, it } from 'vitest'
import { resolveTerminalCapabilities } from './resolve-capabilities'

describe('resolveTerminalCapabilities', () => {
  it('falls back to vt220 defaults when no options are provided', () => {
    const result = resolveTerminalCapabilities()

    expect(result.parser.spec).toBe('vt220')
    expect(result.parser.emulator).toBeUndefined()
    expect(result.capabilities.spec).toBe('vt220')
    expect(result.capabilities.features.defaultC1Transmission).toBe('8-bit')
  })

  it('derives spec and feature overrides from emulator profile', () => {
    const result = resolveTerminalCapabilities({ emulator: 'xterm' })

    expect(result.parser.emulator).toBe('xterm')
    expect(result.parser.spec).toBe('vt100')
    expect(result.capabilities.spec).toBe('vt100')
    expect(result.capabilities.features.supportsAnsiColors).toBe(true)
    expect(result.capabilities.features.defaultC1Transmission).toBe('8-bit')
  })

  it('honours explicit spec override even when emulator supplies a different base', () => {
    const result = resolveTerminalCapabilities({
      emulator: 'xterm',
      spec: 'vt320',
    })

    expect(result.parser.spec).toBe('vt320')
    expect(result.capabilities.spec).toBe('vt320')
    // vt320 default retains 8-bit C1 transmission
    expect(result.capabilities.features.defaultC1Transmission).toBe('8-bit')
  })

  it('merges feature overrides on top of emulator defaults', () => {
    const result = resolveTerminalCapabilities({
      emulator: 'xterm',
      features: {
        initialRows: 48,
        supportsScrollRegions: false,
      },
    })

    expect(result.capabilities.features.initialRows).toBe(48)
    expect(result.capabilities.features.supportsScrollRegions).toBe(false)
    // ensure other defaults remain intact
    expect(result.capabilities.features.supportsTabStops).toBe(true)
  })
})
