import { resolveEmulatorOverlay } from './internal/emulator-quirks'
import { SPEC_FALLBACK } from './internal/spec-defaults'
import type {
  ParserOptions,
  ParserSpec,
  TerminalCapabilities,
  TerminalFeatures,
} from './types'

const SPEC_FEATURES: Record<ParserSpec, TerminalFeatures> = {
  vt100: {
    initialRows: 24,
    initialColumns: 80,
    supportsAnsiColors: false,
    supportsDecPrivateModes: true,
    supportsSosPmApc: false,
    supportsTabStops: true,
    supportsScrollRegions: true,
    supportsOriginMode: true,
    supportsAutoWrap: true,
    supportsCursorVisibility: true,
    supportsC1TransmissionToggle: false,
    defaultC1Transmission: '7-bit',
    primaryDeviceAttributes: '\u001B[?62;1;2;6;7;8;9c',
    secondaryDeviceAttributes: '\u001B[>62;1;2c',
    supportsNationalReplacementCharsets: false,
  },
  vt220: {
    initialRows: 24,
    initialColumns: 80,
    supportsAnsiColors: true,
    supportsDecPrivateModes: true,
    supportsSosPmApc: true,
    supportsTabStops: true,
    supportsScrollRegions: true,
    supportsOriginMode: true,
    supportsAutoWrap: true,
    supportsCursorVisibility: true,
    supportsC1TransmissionToggle: true,
    defaultC1Transmission: '8-bit',
    primaryDeviceAttributes: '\u001B[?62;1;2;6;7;8;9c',
    secondaryDeviceAttributes: '\u001B[>62;1;2c',
    supportsNationalReplacementCharsets: true,
  },
  vt320: {
    initialRows: 24,
    initialColumns: 80,
    supportsAnsiColors: true,
    supportsDecPrivateModes: true,
    supportsSosPmApc: true,
    supportsTabStops: true,
    supportsScrollRegions: true,
    supportsOriginMode: true,
    supportsAutoWrap: true,
    supportsCursorVisibility: true,
    supportsC1TransmissionToggle: true,
    defaultC1Transmission: '8-bit',
    primaryDeviceAttributes: '\u001B[?62;1;2;6;7;8;9c',
    secondaryDeviceAttributes: '\u001B[>62;1;2c',
    supportsNationalReplacementCharsets: true,
  },
  vt420: {
    initialRows: 24,
    initialColumns: 80,
    supportsAnsiColors: true,
    supportsDecPrivateModes: true,
    supportsSosPmApc: true,
    supportsTabStops: true,
    supportsScrollRegions: true,
    supportsOriginMode: true,
    supportsAutoWrap: true,
    supportsCursorVisibility: true,
    supportsC1TransmissionToggle: true,
    defaultC1Transmission: '8-bit',
    primaryDeviceAttributes: '\u001B[?62;1;2;6;7;8;9c',
    secondaryDeviceAttributes: '\u001B[>62;1;2c',
    supportsNationalReplacementCharsets: true,
  },
  vt520: {
    initialRows: 24,
    initialColumns: 80,
    supportsAnsiColors: true,
    supportsDecPrivateModes: true,
    supportsSosPmApc: true,
    supportsTabStops: true,
    supportsScrollRegions: true,
    supportsOriginMode: true,
    supportsAutoWrap: true,
    supportsCursorVisibility: true,
    supportsC1TransmissionToggle: true,
    defaultC1Transmission: '8-bit',
    primaryDeviceAttributes: '\u001B[?62;1;2;6;7;8;9c',
    secondaryDeviceAttributes: '\u001B[>62;1;2c',
    supportsNationalReplacementCharsets: true,
  },
  vt525: {
    initialRows: 24,
    initialColumns: 80,
    supportsAnsiColors: true,
    supportsDecPrivateModes: true,
    supportsSosPmApc: true,
    supportsTabStops: true,
    supportsScrollRegions: true,
    supportsOriginMode: true,
    supportsAutoWrap: true,
    supportsCursorVisibility: true,
    supportsC1TransmissionToggle: true,
    defaultC1Transmission: '8-bit',
    primaryDeviceAttributes: '\u001B[?62;1;2;6;7;8;9c',
    secondaryDeviceAttributes: '\u001B[>62;1;2c',
    supportsNationalReplacementCharsets: true,
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
  supportsTabStops: overlay.supportsTabStops ?? base.supportsTabStops,
  supportsScrollRegions:
    overlay.supportsScrollRegions ?? base.supportsScrollRegions,
  supportsOriginMode: overlay.supportsOriginMode ?? base.supportsOriginMode,
  supportsAutoWrap: overlay.supportsAutoWrap ?? base.supportsAutoWrap,
  supportsCursorVisibility:
    overlay.supportsCursorVisibility ?? base.supportsCursorVisibility,
  supportsC1TransmissionToggle:
    overlay.supportsC1TransmissionToggle ?? base.supportsC1TransmissionToggle,
  defaultC1Transmission:
    overlay.defaultC1Transmission ?? base.defaultC1Transmission,
  primaryDeviceAttributes:
    overlay.primaryDeviceAttributes ?? base.primaryDeviceAttributes,
  secondaryDeviceAttributes:
    overlay.secondaryDeviceAttributes ?? base.secondaryDeviceAttributes,
  supportsNationalReplacementCharsets:
    overlay.supportsNationalReplacementCharsets ??
    base.supportsNationalReplacementCharsets,
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
