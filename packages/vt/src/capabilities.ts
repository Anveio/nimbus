import {
  type ParserOptions,
  type ParserSpec,
  type TerminalCapabilities,
  type TerminalFeatures,
} from './types'
import { resolveEmulatorOverlay } from './internal/emulator-quirks'
import { SPEC_FALLBACK } from './internal/spec-defaults'

const SPEC_FEATURES: Record<ParserSpec, TerminalFeatures> = {
  vt100: {
    initialRows: 24,
    initialColumns: 80,
    supportsAnsiColors: false,
    supportsDecPrivateModes: false,
    supportsSosPmApc: false,
  },
  vt220: {
    initialRows: 24,
    initialColumns: 80,
    supportsAnsiColors: true,
    supportsDecPrivateModes: true,
    supportsSosPmApc: true,
  },
  vt320: {
    initialRows: 24,
    initialColumns: 80,
    supportsAnsiColors: true,
    supportsDecPrivateModes: true,
    supportsSosPmApc: true,
  },
  vt420: {
    initialRows: 24,
    initialColumns: 80,
    supportsAnsiColors: true,
    supportsDecPrivateModes: true,
    supportsSosPmApc: true,
  },
  vt520: {
    initialRows: 24,
    initialColumns: 80,
    supportsAnsiColors: true,
    supportsDecPrivateModes: true,
    supportsSosPmApc: true,
  },
  vt525: {
    initialRows: 24,
    initialColumns: 80,
    supportsAnsiColors: true,
    supportsDecPrivateModes: true,
    supportsSosPmApc: true,
  },
}

const mergeFeatures = (
  base: TerminalFeatures,
  overlay: Partial<TerminalFeatures>,
): TerminalFeatures => ({
  initialRows: overlay.initialRows ?? base.initialRows,
  initialColumns: overlay.initialColumns ?? base.initialColumns,
  supportsAnsiColors: overlay.supportsAnsiColors ?? base.supportsAnsiColors,
  supportsDecPrivateModes:
    overlay.supportsDecPrivateModes ?? base.supportsDecPrivateModes,
  supportsSosPmApc: overlay.supportsSosPmApc ?? base.supportsSosPmApc,
})

export const resolveTerminalCapabilities = (
  options: ParserOptions,
): TerminalCapabilities => {
  const emulatorOverlay = resolveEmulatorOverlay(options)
  const spec = options.spec ?? emulatorOverlay.spec ?? SPEC_FALLBACK
  const baseFeatures = SPEC_FEATURES[spec]
  const features = mergeFeatures(baseFeatures, emulatorOverlay.features)

  return {
    spec,
    emulator: options.emulator,
    features,
  }
}
