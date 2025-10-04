import type { Ctl, DataFrame } from './messages'

export interface WireProfile {
  readonly id: string
  readonly subprotocols?: readonly string[]
  encodeCtl(msg: Ctl): ArrayBuffer | string
  decodeCtl(frame: ArrayBuffer | string): Ctl | null
  encodeData(
    df: DataFrame,
    caps?: { readonly maxFrame?: number },
  ): (ArrayBuffer | string)[]
  decodeData(frame: ArrayBuffer | string): DataFrame | null
  onNegotiated?(clientCaps: unknown, serverCaps: unknown): void
}

const registry = new Map<string, WireProfile>()

export function registerProfile(profile: WireProfile): void {
  if (registry.has(profile.id)) {
    throw new Error(`WireProfile '${profile.id}' already registered`)
  }
  registry.set(profile.id, profile)
}

export function getProfile(id: string): WireProfile | undefined {
  return registry.get(id)
}

export function listProfiles(): readonly WireProfile[] {
  return [...registry.values()]
}

export function clearProfilesForTest(): void {
  registry.clear()
}
