import type {
  ParserOptionOverrides,
  ParserOptions,
  ParserSpec,
  TerminalEmulator,
  TerminalFeatures,
} from '../types'
import { SPEC_FALLBACK } from './spec-defaults'

interface EmulatorProfile {
  readonly baseSpec: ParserSpec
  readonly overrides: ParserOptionOverrides
  readonly featureOverrides?: Partial<TerminalFeatures>
}

const EMULATOR_PROFILES: Record<TerminalEmulator, EmulatorProfile> = {
  xterm: {
    baseSpec: 'vt100',
    overrides: {
      c1Handling: 'spec',
      acceptEightBitControls: true,
      stringLimits: {
        osc: 16384,
        dcs: 16384,
        sosPmApc: 8192,
      },
    },
    featureOverrides: {
      supportsAnsiColors: true,
      supportsDecPrivateModes: true,
      supportsSosPmApc: true,
    },
  },
}

export const getEmulatorProfile = (
  emulator: TerminalEmulator | undefined,
): EmulatorProfile | null => {
  if (!emulator) {
    return null
  }
  return EMULATOR_PROFILES[emulator] ?? null
}

export interface ResolvedEmulator {
  readonly spec: ParserSpec
  readonly overrides: ParserOptionOverrides
  readonly features: Partial<TerminalFeatures>
}

export const resolveEmulatorOverlay = (
  options: ParserOptions,
): ResolvedEmulator => {
  const profile = getEmulatorProfile(options.emulator)
  if (!profile) {
    return {
      spec: options.spec ?? SPEC_FALLBACK,
      overrides: {},
      features: {},
    }
  }

  const spec = options.spec ?? profile.baseSpec

  return {
    spec,
    overrides: profile.overrides,
    features: profile.featureOverrides ?? {},
  }
}
